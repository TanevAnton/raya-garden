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
    $payloadHash = hash('sha256', json_encode([$table, $lines], JSON_UNESCAPED_UNICODE));
    $expectedTotal = $body['expectedTotal'] ?? null;

    return qr_write(function (PDO $pdo) use ($lines, $table, $lang, $payloadHash, $idemKey, $now, $expectedTotal) {
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
        if ($removed || $soldOutLines || $priceChanged || $expectedTotal !== $total) {
            return [409, [
                'ok' => false,
                'error' => 'changed',
                'removed' => $removed,
                'soldOut' => $soldOutLines,
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

        // 6. Store it, with names and prices copied in: a menu edited later
        //    never changes an order already placed.
        $seq = qr_bump_seq($pdo);
        $code = qr_new_code($pdo, $now);
        $insert = $pdo->prepare('INSERT INTO orders
            (code, token_hash, idem_key, payload_hash, table_no, status, total_cents, lang, ip_hash, created_at, updated_at, seq)
            VALUES (?, ?, ?, ?, ?, \'new\', ?, ?, ?, ?, ?, ?)');
        $insert->execute([$code, hash('sha256', $token), $idemKey, $payloadHash, $table, $total, $lang, $ipHash, $now, $now, $seq]);
        $orderId = (int) $pdo->lastInsertId();
        $insertLine = $pdo->prepare('INSERT INTO order_items
            (order_id, line, item_id, variant_id, choice_id, name_bg, name_en, detail_bg, detail_en, size, unit_cents, qty, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($resolved as $n => $r) {
            list($line, $item, $variant, $choice) = $r;
            $detailBg = trim(($variant['bg'] ?? '') . ($choice ? ' · ' . $choice['bg'] : ''), ' ·');
            $detailEn = trim(($variant['en'] ?? '') . ($choice ? ' · ' . $choice['en'] : ''), ' ·');
            $insertLine->execute([
                $orderId, $n, $item['id'], $variant['id'], $choice ? $choice['id'] : '',
                $item['bg'], $item['en'], $detailBg, $detailEn, (string) $variant['size'],
                (int) $variant['price'], $line['qty'], $line['note'],
            ]);
        }
        $pdo->prepare('INSERT INTO order_events (order_id, from_status, to_status, at) VALUES (?, \'\', \'new\', ?)')
            ->execute([$orderId, $now]);

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
