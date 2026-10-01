<?php
// Placing an order: POST /api/qr/order.php. See ../order.php.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

/**
 * Validate and store one order. Everything happens inside a single
 * BEGIN IMMEDIATE transaction, so the checks and the write see the same
 * state: an item cannot be sold out, or ordering paused, between the check
 * and the insert.
 *
 * Returns [httpStatus, body].
 */
function qr_place_order(array $body, string $idemKey, int $now): array
{
    $lines = qr_parse_lines($body);
    $table = $body['table'] ?? null;
    if (!is_int($table)) {
        return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'table']];
    }
    $lang = ($body['lang'] ?? 'bg') === 'en' ? 'en' : 'bg';
    // The guest's own name, optional — for staff, and on the table's bill.
    // Not part of the payload hash: a retry with the name edited is still
    // the same order.
    $rawName = $body['name'] ?? '';
    if (!is_string($rawName)) {
        return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'name']];
    }
    $guestName = qr_clean_name($rawName, QR_MAX_NAME + 1);
    if (mb_strlen($guestName) > QR_MAX_NAME) {
        return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'name']];
    }
    $payloadHash = hash('sha256', json_encode([$table, $lines], JSON_UNESCAPED_UNICODE));
    $expectedTotal = $body['expectedTotal'] ?? null;

    return qr_write(function (PDO $pdo) use ($lines, $table, $lang, $guestName, $payloadHash, $idemKey, $now, $expectedTotal) {
        $secret = qr_secret();
        $token = hash_hmac('sha256', 'order|' . $idemKey, $secret);

        // 1. The same attempt again — a double tap, or a retry after a
        //    dropped connection. Answer with the order already made, even if
        //    ordering has closed since; never make a second one.
        $stmt = $pdo->prepare('SELECT * FROM orders WHERE idem_key = ?');
        $stmt->execute([$idemKey]);
        $existing = $stmt->fetch();
        if (is_array($existing)) {
            if (!hash_equals((string) $existing['payload_hash'], $payloadHash)) {
                return [409, ['ok' => false, 'error' => 'idempotency_conflict']];
            }
            return [200, ['ok' => true, 'replayed' => true, 'token' => $token, 'order' => qr_order_json($existing)]];
        }

        // 2. Is ordering open?
        $settings = $pdo->query('SELECT * FROM settings WHERE id = 1')->fetch();
        $state = qr_state($settings, $now);
        if (!$state['open']) {
            return [409, ['ok' => false, 'error' => 'closed', 'state' => $state]];
        }

        // 3. A real, enabled table.
        if ($table < 1 || $table > $state['tables'] || in_array($table, $state['disabledTables'], true)) {
            return [409, ['ok' => false, 'error' => 'table_invalid', 'state' => $state]];
        }

        // 4. Every line against the menu and tonight's sold-out list. Prices
        //    come from the menu only; what the guest's phone showed is used
        //    solely to notice that it has changed.
        $menu = qr_menu_index();
        $soldOut = array_flip(qr_sold_out());
        $removed = [];
        $soldOutLines = [];
        $stationClosed = [];
        $priceChanged = [];
        $resolved = [];
        foreach ($lines as $n => $line) {
            $item = $menu[$line['itemId']] ?? null;
            $variant = null;
            $choice = null;
            if (is_array($item) && ($item['orderable'] ?? true) !== false) {
                foreach ($item['variants'] as $v) {
                    if ($v['id'] === $line['variantId']) {
                        $variant = $v;
                    }
                }
                if (isset($item['choices'])) {
                    foreach ($item['choices']['options'] as $c) {
                        if ($c['id'] === $line['choiceId']) {
                            $choice = $c;
                        }
                    }
                }
            }
            $choiceOk = isset($item['choices']) ? $choice !== null : $line['choiceId'] === '';
            if ($variant === null || !$choiceOk) {
                $removed[] = ['line' => $n, 'itemId' => $line['itemId'], 'variantId' => $line['variantId']];
                continue;
            }
            if (isset($soldOut[$item['id']])) {
                $soldOutLines[] = ['line' => $n, 'itemId' => $item['id']];
                continue;
            }
            // The kitchen may close before the bar (or the bar first).
            if (!$state['stations'][$item['station']]['open']) {
                $stationClosed[] = ['line' => $n, 'itemId' => $item['id'], 'station' => $item['station']];
                continue;
            }
            if ($line['price'] !== (int) $variant['price']) {
                $priceChanged[] = [
                    'line' => $n,
                    'itemId' => $item['id'],
                    'variantId' => $variant['id'],
                    'was' => $line['price'],
                    'now' => (int) $variant['price'],
                ];
            }
            $resolved[] = [$line, $item, $variant, $choice];
        }
        $total = 0;
        foreach ($resolved as $r) {
            $total += (int) $r[2]['price'] * $r[0]['qty'];
        }
        if ($removed || $soldOutLines || $stationClosed || $priceChanged || $expectedTotal !== $total) {
            return [409, [
                'ok' => false,
                'error' => 'changed',
                'removed' => $removed,
                'soldOut' => $soldOutLines,
                'stationClosed' => $stationClosed,
                'priceChanged' => $priceChanged,
                'total' => $total,
                'expectedTotal' => $expectedTotal,
            ]];
        }

        // 5. Limits: a table, and a network address, can only order so often.
        $since = $now - QR_LIMIT_WINDOW;
        $count = $pdo->prepare('SELECT COUNT(*) FROM orders WHERE table_no = ? AND created_at > ?');
        $count->execute([$table, $since]);
        if ((int) $count->fetchColumn() >= QR_TABLE_LIMIT) {
            return [429, ['ok' => false, 'error' => 'rate_limited', 'scope' => 'table', 'retryAfter' => QR_LIMIT_WINDOW]];
        }
        $ipHash = qr_ip_hash();
        $count = $pdo->prepare('SELECT COUNT(*) FROM orders WHERE ip_hash = ? AND created_at > ?');
        $count->execute([$ipHash, $since]);
        if ((int) $count->fetchColumn() >= QR_IP_LIMIT) {
            return [429, ['ok' => false, 'error' => 'rate_limited', 'scope' => 'network', 'retryAfter' => QR_LIMIT_WINDOW]];
        }
        // The address stand-in is only needed for the limit above, so it is
        // not kept once an order is older than the window.
        $pdo->prepare("UPDATE orders SET ip_hash = '' WHERE ip_hash <> '' AND created_at <= ?")->execute([$since]);
        qr_forget_names($pdo, $now);

        // 6. Store it, with names and prices copied in: a menu edited later
        //    never changes an order already placed. When guests pay on the
        //    phone it waits, unseen by staff, until Stripe confirms the
        //    payment (_lib/pay.php).
        //    On a "pay at the end" evening it joins its table's bill.
        //    Food goes to the kitchen and drinks to the bar: each station
        //    with something to make starts at 'new'.
        $status = $state['payment'] === 'online' ? 'pending_payment' : 'new';
        $tab = $state['payment'] === 'tab' ? qr_open_tab($pdo, $table, (string) $settings['service_date'], true, $now) : null;
        $stations = array_fill_keys(QR_STATIONS, '');
        foreach ($resolved as $r) {
            $stations[$r[1]['station']] = 'new';
        }
        $seq = qr_bump_seq($pdo);
        $code = qr_new_code($pdo, $now);
        $insert = $pdo->prepare('INSERT INTO orders
            (code, token_hash, idem_key, payload_hash, table_no, status, pay_status, total_cents, lang, ip_hash, created_at, updated_at, seq, tab_id, guest_name,
             kitchen_status, bar_status, evening)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $insert->execute([$code, hash('sha256', $token), $idemKey, $payloadHash, $table, $status,
            $status === 'pending_payment' ? 'pending' : '', $total, $lang, $ipHash, $now, $now, $seq, $tab ? (int) $tab['id'] : 0, $guestName,
            $stations['kitchen'], $stations['bar'], (string) $settings['service_date']]);
        if ($tab) {
            qr_touch_tab($pdo, (int) $tab['id'], $seq);
        }
        $orderId = (int) $pdo->lastInsertId();
        $insertLine = $pdo->prepare('INSERT INTO order_items
            (order_id, line, item_id, variant_id, choice_id, name_bg, name_en, detail_bg, detail_en, size, unit_cents, qty, note, station)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($resolved as $n => $r) {
            list($line, $item, $variant, $choice) = $r;
            $detailBg = trim(($variant['bg'] ?? '') . ($choice ? ' · ' . $choice['bg'] : ''), ' ·');
            $detailEn = trim(($variant['en'] ?? '') . ($choice ? ' · ' . $choice['en'] : ''), ' ·');
            $insertLine->execute([
                $orderId, $n, $item['id'], $variant['id'], $choice ? $choice['id'] : '',
                $item['bg'], $item['en'], $detailBg, $detailEn, (string) $variant['size'],
                (int) $variant['price'], $line['qty'], $line['note'], $item['station'],
            ]);
        }
        $pdo->prepare('INSERT INTO order_events (order_id, from_status, to_status, at) VALUES (?, \'\', ?, ?)')
            ->execute([$orderId, $status, $now]);

        $stmt = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
        $stmt->execute([$orderId]);
        return [201, ['ok' => true, 'token' => $token, 'order' => qr_order_json($stmt->fetch())]];
    });
}

/**
 * The lines, checked for shape: 1–50 of them, a quantity of 1–20 each, a
 * note of at most 200 characters with control and invisible formatting
 * characters removed. A malformed request is a 400 — the guest's page never
 * sends one, so this is someone poking at the endpoint.
 */
function qr_parse_lines(array $body): array
{
    $raw = $body['lines'] ?? null;
    if (!is_array($raw) || count($raw) < 1 || count($raw) > QR_MAX_LINES || array_values($raw) !== $raw) {
        qr_fail(400, 'invalid', ['field' => 'lines']);
    }
    $lines = [];
    foreach ($raw as $n => $line) {
        if (!is_array($line)) {
            qr_fail(400, 'invalid', ['field' => 'lines', 'line' => $n]);
        }
        $itemId = $line['itemId'] ?? null;
        $variantId = $line['variantId'] ?? null;
        $choiceId = $line['choiceId'] ?? '';
        $qty = $line['qty'] ?? null;
        $price = $line['price'] ?? null;
        $note = $line['note'] ?? '';
        if (!is_string($itemId) || !is_string($variantId) || !(is_string($choiceId) || $choiceId === null)
            || !is_int($qty) || $qty < 1 || $qty > QR_MAX_QTY || !is_int($price) || !is_string($note)
            || strlen($itemId) > 80 || strlen($variantId) > 40) {
            qr_fail(400, 'invalid', ['field' => 'lines', 'line' => $n]);
        }
        $note = preg_replace('/[\p{Cc}\p{Cf}]+/u', ' ', $note);
        if ($note === null) {
            qr_fail(400, 'invalid', ['field' => 'note', 'line' => $n]);
        }
        $note = trim(preg_replace('/\s+/u', ' ', $note));
        if (mb_strlen($note) > QR_MAX_NOTE) {
            qr_fail(400, 'invalid', ['field' => 'note', 'line' => $n]);
        }
        $lines[] = [
            'itemId' => $itemId,
            'variantId' => $variantId,
            'choiceId' => (string) $choiceId,
            'qty' => $qty,
            'price' => $price,
            'note' => $note,
        ];
    }
    return $lines;
}

/**
 * A short code for people — "R-4K7Q" — read out across a table and matched
 * on the admin screen. Random, not sequential, so it says nothing about how
 * many orders there were; unique among the last two days' orders. No 0/O,
 * 1/I/L.
 */
function qr_new_code(PDO $pdo, int $now): string
{
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $check = $pdo->prepare('SELECT 1 FROM orders WHERE code = ? AND created_at > ?');
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $code = 'R-';
        for ($i = 0; $i < 4; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $check->execute([$code, $now - 172800]);
        if ($check->fetchColumn() === false) {
            return $code;
        }
    }
    throw new RuntimeException('no free order code');
}

/**
 * Staff cancel part of an order — some or all of one line — rather than the
 * whole order: "one of the three mojitos, we are out of mint". The rest of
 * the order stands. In one write transaction:
 *
 *   - the line's void_qty grows, and the order's void_cents with it;
 *   - paid on the phone: that amount is owed back (refund_due_cents) and
 *     refunded right after the commit (qr_order_refund_due);
 *   - on a table's bill: unpaid, it simply drops off the bill; paid on a
 *     phone, it is owed back to whoever paid it (qr_bill_owe); paid on the
 *     spot, the answer says how much to hand back (cashBack);
 *   - a station left with nothing to make is 'cancelled', and the order's
 *     own status follows from the stations still making something.
 *
 * The last thing left on an order is not cancelled this way — that is
 * cancelling the order (409 last_line). $have is how many of the line the
 * screen showed: if another tablet changed it first, 409 stale and nothing
 * changes.
 *
 * Returns [httpStatus, body, refundTheOrder, billPaymentIdsOwed].
 */
function qr_void_line(int $id, int $line, int $qty, int $have, string $reason, int $now): array
{
    return qr_write(function (PDO $pdo) use ($id, $line, $qty, $have, $reason, $now) {
        $order = qr_find_order($pdo, $id);
        if ($order === null) {
            return [404, ['ok' => false, 'error' => 'not_found'], false, []];
        }
        $items = qr_order_items($pdo, $id);
        $target = $items[$line] ?? null;
        if (!in_array($order['status'], ['new', 'accepted', 'served'], true) || $target === null
            || (int) $target['qty'] - (int) $target['void_qty'] !== $have) {
            return [409, ['ok' => false, 'error' => 'stale', 'order' => qr_order_json($order)], false, []];
        }
        if ($qty > $have) {
            return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'qty'], false, []];
        }
        $left = 0;
        foreach ($items as $item) {
            $left += (int) $item['qty'] - (int) $item['void_qty'];
        }
        if ($left - $qty < 1) {
            return [409, ['ok' => false, 'error' => 'last_line', 'order' => qr_order_json($order)], false, []];
        }
        return qr_void_cuts($pdo, $order, $items, [$line => $qty], $reason, $now);
    });
}

/**
 * One station's part of an order cancelled, the other station's kept: the
 * bar has none of the drinks, the kitchen carries on with the food. Every
 * line of the station still standing is taken off as qr_void_line() would,
 * with the same refunds. $from is the station's status the screen showed.
 * Only while the other station still has something to make — otherwise it is
 * cancelling the order (409 last_station).
 *
 * Returns [httpStatus, body, refundTheOrder, billPaymentIdsOwed].
 */
function qr_cancel_station(int $id, string $station, string $from, string $reason, int $now): array
{
    return qr_write(function (PDO $pdo) use ($id, $station, $from, $reason, $now) {
        $order = qr_find_order($pdo, $id);
        if ($order === null) {
            return [404, ['ok' => false, 'error' => 'not_found'], false, []];
        }
        if (!in_array($order['status'], ['new', 'accepted', 'served'], true) || $order[$station . '_status'] !== $from
            || !in_array($from, ['new', 'accepted'], true)) {
            return [409, ['ok' => false, 'error' => 'stale', 'order' => qr_order_json($order)], false, []];
        }
        $items = qr_order_items($pdo, $id);
        $cuts = [];
        $others = 0;
        foreach ($items as $n => $item) {
            $standing = (int) $item['qty'] - (int) $item['void_qty'];
            if ($item['station'] === $station) {
                if ($standing > 0) {
                    $cuts[$n] = $standing;
                }
            } else {
                $others += $standing;
            }
        }
        if ($others < 1) {
            return [409, ['ok' => false, 'error' => 'last_station', 'order' => qr_order_json($order)], false, []];
        }
        return qr_void_cuts($pdo, $order, $items, $cuts, $reason, $now);
    });
}

function qr_find_order(PDO $pdo, int $id)
{
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    $find->closeCursor();
    return is_array($order) ? $order : null;
}

/** An order's lines, by line number. */
function qr_order_items(PDO $pdo, int $id): array
{
    $stmt = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
    $stmt->execute([$id]);
    $items = [];
    foreach ($stmt->fetchAll() as $item) {
        $items[(int) $item['line']] = $item;
    }
    return $items;
}

/**
 * Take $cuts (line => how many) off an order, checked already, inside the
 * caller's write transaction: the money as qr_void_line() describes, stations
 * left with nothing marked 'cancelled', the order's status recomputed.
 */
function qr_void_cuts(PDO $pdo, array $order, array $items, array $cuts, string $reason, int $now): array
{
    $id = (int) $order['id'];
    $paid = $order['pay_status'] === 'paid';
    $seq = qr_bump_seq($pdo);
    $amount = 0;
    $owed = [];
    $cashBack = 0;
    $voidLine = $pdo->prepare('UPDATE order_items SET void_qty = void_qty + ?, void_reason = ? WHERE order_id = ? AND line = ?');
    $event = $pdo->prepare('INSERT INTO order_events (order_id, from_status, to_status, reason, at) VALUES (?, ?, ?, ?, ?)');
    foreach ($cuts as $line => $qty) {
        $item = $items[$line];
        $cents = (int) $item['unit_cents'] * $qty;
        $amount += $cents;
        $voidLine->execute([$qty, $reason, $id, $line]);
        $items[$line]['void_qty'] = (int) $item['void_qty'] + $qty;
        $event->execute([$id, $order['status'], $order['status'], 'line ' . ($line + 1) . ' -' . $qty . ': ' . $reason, $now]);
        if ((int) $order['tab_id'] > 0) {
            if ($item['paid_via'] === 'online') {
                qr_bill_owe($pdo, (int) $item['bill_payment_id'], $cents, $seq);
                $owed[(int) $item['bill_payment_id']] = true;
            } elseif ($item['paid_via'] === 'staff') {
                $cashBack += $cents;
            }
        }
    }
    // A station with nothing left to make is done with this order.
    $standing = array_fill_keys(QR_STATIONS, 0);
    foreach ($items as $item) {
        $station = in_array($item['station'], QR_STATIONS, true) ? $item['station'] : 'kitchen';
        $standing[$station] += (int) $item['qty'] - (int) $item['void_qty'];
    }
    foreach (QR_STATIONS as $station) {
        if ($order[$station . '_status'] !== '' && $standing[$station] === 0) {
            $order[$station . '_status'] = 'cancelled';
        }
    }
    $overall = qr_overall_status($order);
    $pdo->prepare('UPDATE orders SET void_cents = void_cents + ?, refund_due_cents = refund_due_cents + ?,
        kitchen_status = ?, bar_status = ?, status = ?, updated_at = ?, seq = ? WHERE id = ?')
        ->execute([$amount, $paid ? $amount : 0, $order['kitchen_status'], $order['bar_status'], $overall, $now, $seq, $id]);
    if ($overall !== $order['status']) {
        $event->execute([$id, $order['status'], $overall, 'stations', $now]);
    }
    if ((int) $order['tab_id'] > 0) {
        qr_touch_tab($pdo, (int) $order['tab_id'], $seq);
    }
    $body = ['ok' => true, 'order' => qr_order_json(qr_find_order($pdo, $id)), 'amount' => $amount];
    if ($cashBack > 0) {
        $body['cashBack'] = $cashBack;
    }
    return [200, $body, $paid, array_keys($owed)];
}
