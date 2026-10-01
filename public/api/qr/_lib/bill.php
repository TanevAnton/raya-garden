<?php
// The table's bill — payment mode 'tab' ("Сметка накрая").
//
// On such an evening an order goes straight to staff, as when guests pay
// staff, and joins the bill (tab) of its table: every phone that orders for
// table 7 adds to the same bill. At the end anyone at the table opens the
// bill, chooses lines — all of them, only their own, any mix — and pays for
// them on Stripe's page. What is left can be paid by the next person, or
// settled by staff ("Платено на място"), who then close the bill.
//
// Nothing is locked while someone is paying: two people may pick the same
// line. Whichever payment Stripe confirms first gets the line; the other
// payment's share for it is owed back and refunded automatically
// (refund_due_cents). The same holds when staff cancel an order whose lines
// were already paid. A refund that fails stays visible to staff until it is
// retried and succeeds.
//
// A tab belongs to a table and an evening (the service date). A new evening
// starts new tabs; a tab staff closed starts a new one on the next order.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_BILL_ATTEMPTS = 10;     // payment attempts per table per 5 minutes
const QR_BILL_PENDING_HINT = 600; // "being paid…" shown for 10 minutes at most

/** The open tab of a table tonight, or null; with $create, made if missing. Inside qr_write() only. */
function qr_open_tab(PDO $pdo, int $table, string $evening, bool $create, int $now)
{
    $find = $pdo->prepare('SELECT * FROM tabs WHERE table_no = ? AND evening = ? AND closed_at = 0 ORDER BY id DESC LIMIT 1');
    $find->execute([$table, $evening]);
    $tab = $find->fetch();
    $find->closeCursor();
    if (is_array($tab) || !$create) {
        return is_array($tab) ? $tab : null;
    }
    $pdo->prepare('INSERT INTO tabs (table_no, evening, opened_at, seq) VALUES (?, ?, ?, ?)')
        ->execute([$table, $evening, $now, qr_bump_seq($pdo)]);
    $find->execute([$table, $evening]);
    $tab = $find->fetch();
    $find->closeCursor();
    return $tab;
}

/** Something on this tab changed: give it the next change number, so every screen refetches it. */
function qr_touch_tab(PDO $pdo, int $tabId, int $seq = 0)
{
    if ($tabId > 0) {
        $pdo->prepare('UPDATE tabs SET seq = ? WHERE id = ?')->execute([$seq > 0 ? $seq : qr_bump_seq($pdo), $tabId]);
    }
}

/**
 * Every line on a tab — from its orders that were not cancelled — with its
 * state: unpaid, pending (someone is on Stripe's page for it right now),
 * online (paid on a phone) or staff (settled on the spot).
 */
function qr_tab_lines(PDO $pdo, int $tabId, int $now): array
{
    $stmt = $pdo->prepare("SELECT o.id AS order_id, o.code, o.created_at, o.guest_name, i.*
        FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.tab_id = ? AND o.status IN ('new', 'accepted', 'served')
        ORDER BY o.created_at, o.id, i.line");
    $stmt->execute([$tabId]);
    $rows = $stmt->fetchAll();
    $pending = $pdo->prepare("SELECT i.order_id, i.line FROM bill_payments p
        JOIN bill_payment_items i ON i.payment_id = p.id
        WHERE p.tab_id = ? AND p.status = 'pending' AND p.created_at > ?");
    $pending->execute([$tabId, $now - QR_BILL_PENDING_HINT]);
    $busy = [];
    foreach ($pending->fetchAll() as $p) {
        $busy[$p['order_id'] . ':' . $p['line']] = true;
    }
    $lines = [];
    foreach ($rows as $r) {
        $state = $r['paid_via'] === 'online' || $r['paid_via'] === 'staff' ? $r['paid_via'] : 'unpaid';
        if ($state === 'unpaid' && isset($busy[$r['order_id'] . ':' . $r['line']])) {
            $state = 'pending';
        }
        $lines[] = [
            'orderId' => (int) $r['order_id'],
            'code' => (string) $r['code'],
            'line' => (int) $r['line'],
            'nameBg' => (string) $r['name_bg'],
            'nameEn' => (string) $r['name_en'],
            'detailBg' => (string) $r['detail_bg'],
            'detailEn' => (string) $r['detail_en'],
            'size' => (string) $r['size'],
            'qty' => (int) $r['qty'],
            'price' => (int) $r['unit_cents'],
            'amount' => (int) $r['unit_cents'] * (int) $r['qty'],
            'state' => $state,
            'orderedAt' => (int) $r['created_at'],
            // The name the guest gave when ordering, if any: "Мария: 2 × бира".
            'name' => (string) $r['guest_name'],
        ];
    }
    return $lines;
}

/** A tab with its lines and totals. $forStaff adds its payments and what is owed back. */
function qr_tab_json(PDO $pdo, array $tab, int $now, bool $forStaff): array
{
    $lines = qr_tab_lines($pdo, (int) $tab['id'], $now);
    $totals = ['total' => 0, 'paidOnline' => 0, 'paidStaff' => 0, 'unpaid' => 0];
    foreach ($lines as $l) {
        $totals['total'] += $l['amount'];
        if ($l['state'] === 'online') {
            $totals['paidOnline'] += $l['amount'];
        } elseif ($l['state'] === 'staff') {
            $totals['paidStaff'] += $l['amount'];
        } else {
            $totals['unpaid'] += $l['amount'];
        }
    }
    $out = [
        'id' => (int) $tab['id'],
        'table' => (int) $tab['table_no'],
        'evening' => (string) $tab['evening'],
        'openedAt' => (int) $tab['opened_at'],
        'closedAt' => (int) $tab['closed_at'],
        'lines' => $lines,
        'totals' => $totals,
    ];
    if ($forStaff) {
        $out['seq'] = (int) $tab['seq'];
        $stmt = $pdo->prepare("SELECT * FROM bill_payments WHERE tab_id = ? AND status IN ('paid', 'pending') ORDER BY id");
        $stmt->execute([(int) $tab['id']]);
        $out['payments'] = array_map('qr_bill_payment_json', $stmt->fetchAll());
    } else {
        foreach ($out['lines'] as &$l) {
            unset($l['orderId']); // guests know orders by their codes only
        }
        unset($l);
    }
    return $out;
}

function qr_bill_payment_json(array $p): array
{
    return [
        'id' => (int) $p['id'],
        'code' => (string) $p['code'],
        'tabId' => (int) $p['tab_id'],
        'table' => (int) $p['table_no'],
        'status' => (string) $p['status'],
        'amount' => (int) $p['amount_cents'],
        'overlap' => (int) $p['overlap_cents'],
        'refundDue' => (int) $p['refund_due_cents'] - (int) $p['refunded_cents'],
        'refunded' => (int) $p['refunded_cents'],
        'refundError' => (int) $p['refund_error'] === 1,
        'createdAt' => (int) $p['created_at'],
        'paidAt' => (int) $p['paid_at'],
        'payerName' => (string) ($p['payer_name'] ?? ''),
        // For the till: what the payment comes to after what is owed back,
        // and what was entered in Clock.
        'net' => (int) $p['amount_cents'] - (int) $p['refund_due_cents'],
        'tillAt' => (int) $p['till_at'],
        'tillCents' => (int) $p['till_cents'],
        'tillVoidAt' => (int) $p['till_void_at'],
        'seq' => (int) $p['seq'],
    ];
}

/** A payment's lines, for the till list and the payment page. */
function qr_bill_payment_lines(PDO $pdo, int $paymentId): array
{
    $stmt = $pdo->prepare('SELECT i.qty, i.unit_cents, i.name_bg, i.name_en, i.detail_bg, i.detail_en, i.size, o.code, b.amount_cents
        FROM bill_payment_items b
        JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line
        JOIN orders o ON o.id = b.order_id
        WHERE b.payment_id = ? ORDER BY b.order_id, b.line');
    $stmt->execute([$paymentId]);
    return $stmt->fetchAll();
}

/**
 * Start paying chosen lines of a table's bill. Validated in one write
 * transaction against the bill as it is now; the Checkout Session is made
 * afterwards (qr_bill_checkout), outside the lock.
 *
 * Body: {"table": 7, "items": [{"code": "R-4K7Q", "line": 0}, …],
 *        "expectedAmount": 2380, "lang": "bg"}
 * Returns [httpStatus, body].
 */
function qr_bill_pay(array $body, string $idemKey, int $now): array
{
    $table = $body['table'] ?? null;
    $items = $body['items'] ?? null;
    if (!is_int($table) || !is_array($items) || count($items) < 1 || count($items) > 200 || array_values($items) !== $items) {
        return [400, ['ok' => false, 'error' => 'invalid']];
    }
    $picked = [];
    foreach ($items as $item) {
        if (!is_array($item) || !is_string($item['code'] ?? null) || !is_int($item['line'] ?? null)
            || !preg_match('/^R-[A-Z0-9]{4}$/', $item['code'])) {
            return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'items']];
        }
        $picked[$item['code'] . ':' . $item['line']] = [$item['code'], $item['line']];
    }
    ksort($picked);
    $lang = ($body['lang'] ?? 'bg') === 'en' ? 'en' : 'bg';
    $expected = $body['expectedAmount'] ?? null;
    $payloadHash = hash('sha256', json_encode([$table, array_keys($picked)]));

    return qr_write(function (PDO $pdo) use ($table, $picked, $lang, $expected, $payloadHash, $idemKey, $now) {
        $token = hash_hmac('sha256', 'bill|' . $idemKey, qr_secret());
        $find = $pdo->prepare('SELECT * FROM bill_payments WHERE idem_key = ?');
        $find->execute([$idemKey]);
        $existing = $find->fetch();
        $find->closeCursor();
        if (is_array($existing)) {
            if (!hash_equals((string) $existing['payload_hash'], $payloadHash)) {
                return [409, ['ok' => false, 'error' => 'idempotency_conflict']];
            }
            return [200, ['ok' => true, 'replayed' => true, 'token' => $token, 'payment' => qr_bill_payment_json($existing)]];
        }

        $settings = $pdo->query('SELECT * FROM settings WHERE id = 1')->fetch();
        if (!qr_stripe_configured()) {
            return [409, ['ok' => false, 'error' => 'payments_not_configured']];
        }
        $tab = qr_open_tab($pdo, $table, (string) $settings['service_date'], false, $now);
        if ($tab === null) {
            return [409, ['ok' => false, 'error' => 'no_bill']];
        }
        // Only lines that are on this bill and still unpaid. Anything else
        // means the guest's screen is out of date: say which, change nothing.
        $lines = [];
        foreach (qr_tab_lines($pdo, (int) $tab['id'], $now) as $l) {
            $lines[$l['code'] . ':' . $l['line']] = $l;
        }
        $gone = [];
        $amount = 0;
        foreach ($picked as $key => $p) {
            if (!isset($lines[$key]) || !in_array($lines[$key]['state'], ['unpaid', 'pending'], true)) {
                $gone[] = ['code' => $p[0], 'line' => $p[1]];
                continue;
            }
            $amount += $lines[$key]['amount'];
        }
        if ($gone || $expected !== $amount) {
            return [409, ['ok' => false, 'error' => 'changed', 'gone' => $gone, 'amount' => $amount,
                'bill' => qr_tab_json($pdo, $tab, $now, false)]];
        }
        $count = $pdo->prepare('SELECT COUNT(*) FROM bill_payments WHERE table_no = ? AND created_at > ?');
        $count->execute([$table, $now - QR_LIMIT_WINDOW]);
        $recent = (int) $count->fetchColumn();
        $count->closeCursor();
        if ($recent >= QR_BILL_ATTEMPTS) {
            return [429, ['ok' => false, 'error' => 'rate_limited', 'retryAfter' => QR_LIMIT_WINDOW]];
        }

        qr_forget_names($pdo, $now);
        $seq = qr_bump_seq($pdo);
        $code = qr_bill_code($pdo, $now);
        $pdo->prepare('INSERT INTO bill_payments
            (code, tab_id, table_no, token_hash, idem_key, payload_hash, amount_cents, lang, ip_hash, created_at, seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$code, (int) $tab['id'], $table, hash('sha256', $token), $idemKey, $payloadHash, $amount, $lang, qr_ip_hash(), $now, $seq]);
        $paymentId = (int) $pdo->lastInsertId();
        $insert = $pdo->prepare('INSERT INTO bill_payment_items (payment_id, order_id, line, amount_cents) VALUES (?, ?, ?, ?)');
        foreach ($picked as $key => $p) {
            $insert->execute([$paymentId, $lines[$key]['orderId'], $p[1], $lines[$key]['amount']]);
        }
        qr_touch_tab($pdo, (int) $tab['id'], $seq); // "being paid…" for the others at the table
        $find = $pdo->prepare('SELECT * FROM bill_payments WHERE id = ?');
        $find->execute([$paymentId]);
        return [201, ['ok' => true, 'token' => $token, 'payment' => qr_bill_payment_json($find->fetch())]];
    });
}

/** "P-7K3M": a payment's short code, like an order's. */
function qr_bill_code(PDO $pdo, int $now): string
{
    $alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    $check = $pdo->prepare('SELECT 1 FROM bill_payments WHERE code = ? AND created_at > ?');
    for ($attempt = 0; $attempt < 50; $attempt++) {
        $code = 'P-';
        for ($i = 0; $i < 4; $i++) {
            $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }
        $check->execute([$code, $now - 172800]);
        $taken = $check->fetchColumn();
        $check->closeCursor();
        if ($taken === false) {
            return $code;
        }
    }
    throw new RuntimeException('no free payment code');
}

/**
 * The Checkout Session for a pending bill payment: made once, then reused.
 * Outside any write transaction. Returns the payment page URL, or ''.
 */
function qr_bill_checkout(int $paymentId, int $now): string
{
    $pdo = qr_db();
    $find = $pdo->prepare('SELECT * FROM bill_payments WHERE id = ?');
    $find->execute([$paymentId]);
    $p = $find->fetch();
    $find->closeCursor(); // before calling Stripe — see qr_write()
    if (!is_array($p) || $p['status'] !== 'pending') {
        return '';
    }
    if ($p['checkout_url'] !== '' && (int) $p['checkout_expires'] > $now) {
        return (string) $p['checkout_url'];
    }
    if ($p['checkout_session'] !== '') {
        return '';
    }
    $lang = $p['lang'] === 'en' ? 'en' : 'bg';
    $params = [
        'mode' => 'payment',
        'client_reference_id' => 'bill-' . $paymentId,
        'locale' => $lang,
        'expires_at' => (int) $p['created_at'] + QR_PAY_WINDOW,
        'success_url' => qr_public_url() . '/menu/?lang=' . $lang . '&billpaid=' . rawurlencode((string) $p['code']),
        'cancel_url' => qr_public_url() . '/menu/?lang=' . $lang . '&billunpaid=' . rawurlencode((string) $p['code']),
        'integration_identifier' => QR_STRIPE_FLOW,
        'metadata' => ['bill_payment_id' => (string) $paymentId, 'payment_code' => (string) $p['code'], 'table' => (string) $p['table_no']],
        'payment_intent_data' => [
            'description' => 'RAYA Garden · ' . ($lang === 'en' ? 'bill, table ' : 'сметка, маса ') . $p['table_no'] . ' · ' . $p['code'],
            'metadata' => ['bill_payment_id' => (string) $paymentId, 'payment_code' => (string) $p['code']],
        ],
        'line_items' => [],
    ];
    foreach (qr_bill_payment_lines($pdo, $paymentId) as $line) {
        $name = $lang === 'en' ? $line['name_en'] : $line['name_bg'];
        $detail = trim(($lang === 'en' ? $line['detail_en'] : $line['detail_bg']) . ' ' . $line['size']);
        $params['line_items'][] = [
            'quantity' => (int) $line['qty'],
            'price_data' => [
                'currency' => 'eur',
                'unit_amount' => (int) $line['unit_cents'],
                'product_data' => ['name' => $detail !== '' ? $name . ' · ' . $detail : $name],
            ],
        ];
    }
    list($status, $session) = qr_stripe('POST', '/v1/checkout/sessions', $params, 'raya-qr-bill-' . $paymentId);
    if ($status !== 200 || empty($session['id']) || empty($session['url'])) {
        error_log('raya-qr: checkout session for bill payment ' . $paymentId . ' failed: HTTP ' . $status
            . ' ' . (string) ($session['error']['code'] ?? $session['error']['message'] ?? ''));
        return '';
    }
    if ((int) ($session['amount_total'] ?? -1) !== (int) $p['amount_cents']) {
        error_log('raya-qr: checkout session ' . $session['id'] . ' total differs from bill payment ' . $paymentId);
        return '';
    }
    qr_write(function (PDO $pdo) use ($paymentId, $session) {
        $pdo->prepare("UPDATE bill_payments SET checkout_session = ?, checkout_url = ?, checkout_expires = ?
            WHERE id = ? AND checkout_session = ''")
            ->execute([(string) $session['id'], (string) $session['url'], (int) ($session['expires_at'] ?? 0), $paymentId]);
    });
    return (string) $session['url'];
}

/**
 * The guest backed out of Stripe's page: close that session at Stripe, so
 * the lines stop showing as "being paid". If Stripe says it is no longer
 * open — it was paid after all — nothing changes here; the webhook decides.
 */
function qr_bill_abandon(string $token, int $now): array
{
    $pdo = qr_db();
    $find = $pdo->prepare('SELECT * FROM bill_payments WHERE token_hash = ?');
    $find->execute([hash('sha256', $token)]);
    $p = $find->fetch();
    $find->closeCursor();
    if (!is_array($p)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    if ($p['status'] === 'pending' && $p['checkout_session'] !== '') {
        list($status) = qr_stripe('POST', '/v1/checkout/sessions/' . rawurlencode((string) $p['checkout_session']) . '/expire', [],
            'raya-qr-bill-expire-' . $p['id']);
        if ($status === 200) {
            qr_write(function (PDO $pdo) use ($p) {
                $seq = qr_bump_seq($pdo);
                $pdo->prepare("UPDATE bill_payments SET status = 'expired', checkout_url = '', seq = ? WHERE id = ? AND status = 'pending'")
                    ->execute([$seq, $p['id']]);
                qr_touch_tab($pdo, (int) $p['tab_id'], $seq);
            });
        }
    } elseif ($p['status'] === 'pending') {
        qr_write(function (PDO $pdo) use ($p) {
            $seq = qr_bump_seq($pdo);
            $pdo->prepare("UPDATE bill_payments SET status = 'expired', seq = ? WHERE id = ? AND status = 'pending'")->execute([$seq, $p['id']]);
            qr_touch_tab($pdo, (int) $p['tab_id'], $seq);
        });
    }
    $find = $pdo->prepare('SELECT * FROM bill_payments WHERE id = ?');
    $find->execute([$p['id']]);
    return [200, ['ok' => true, 'payment' => qr_bill_payment_json($find->fetch())]];
}

/**
 * A verified Stripe event about a bill payment, inside the webhook's
 * transaction. Returns the payment id when money is now owed back (lines
 * someone else paid first), for qr_bill_refund_due() after the commit.
 */
function qr_bill_event(PDO $pdo, string $type, array $object, int $now)
{
    $find = $pdo->prepare('SELECT * FROM bill_payments WHERE checkout_session = ?');
    $find->execute([(string) $object['id']]);
    $p = $find->fetch();
    $find->closeCursor();
    if (!is_array($p)) {
        return null;
    }
    $id = (int) $p['id'];
    if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
        if (($object['payment_status'] ?? '') !== 'paid' || $p['status'] === 'paid') {
            return null;
        }
        if ((int) ($object['amount_total'] ?? -1) !== (int) $p['amount_cents'] || ($object['currency'] ?? '') !== 'eur') {
            error_log('raya-qr: paid session ' . $object['id'] . ' does not match bill payment ' . $id);
            return null;
        }
        $seq = qr_bump_seq($pdo);
        // First confirmed payment wins a line. A line that is no longer
        // unpaid — paid by someone else meanwhile, settled by staff, or its
        // order cancelled — is owed back to this payer.
        $items = $pdo->prepare("SELECT b.*, i.paid_via, o.status AS order_status FROM bill_payment_items b
            JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line
            JOIN orders o ON o.id = b.order_id WHERE b.payment_id = ?");
        $items->execute([$id]);
        $overlap = 0;
        $mark = $pdo->prepare("UPDATE order_items SET paid_via = 'online', bill_payment_id = ? WHERE order_id = ? AND line = ? AND paid_via = ''");
        $touchOrder = $pdo->prepare('UPDATE orders SET seq = ?, updated_at = ? WHERE id = ?');
        foreach ($items->fetchAll() as $item) {
            if ($item['paid_via'] !== '' || !in_array($item['order_status'], ['new', 'accepted', 'served'], true)) {
                $overlap += (int) $item['amount_cents'];
                continue;
            }
            $mark->execute([$id, $item['order_id'], $item['line']]);
            $touchOrder->execute([$seq, $now, $item['order_id']]);
        }
        $pdo->prepare("UPDATE bill_payments SET status = 'paid', paid_at = ?, payment_intent = ?, payer_name = ?, checkout_url = '',
            overlap_cents = ?, refund_due_cents = refund_due_cents + ?, seq = ? WHERE id = ?")
            ->execute([$now, (string) ($object['payment_intent'] ?? ''), qr_payer_name($object), $overlap, $overlap, $seq, $id]);
        qr_touch_tab($pdo, (int) $p['tab_id'], $seq);
        return $overlap > 0 ? $id : null;
    }
    if (($type === 'checkout.session.expired' || $type === 'checkout.session.async_payment_failed') && $p['status'] === 'pending') {
        $seq = qr_bump_seq($pdo);
        $pdo->prepare("UPDATE bill_payments SET status = ?, checkout_url = '', seq = ? WHERE id = ?")
            ->execute([$type === 'checkout.session.expired' ? 'expired' : 'failed', $seq, $id]);
        qr_touch_tab($pdo, (int) $p['tab_id'], $seq);
    }
    return null;
}

/**
 * Pay back what a bill payment is owed (refund_due − refunded), if anything.
 * Outside any transaction. The idempotency key names the amount already
 * refunded, so a retry of the same step — or two tablets at once — makes one
 * refund, and the stored total only moves if it has not moved meanwhile.
 * Returns true when nothing is owed any more.
 */
function qr_bill_refund_due(int $paymentId): bool
{
    $pdo = qr_db();
    $find = $pdo->prepare('SELECT * FROM bill_payments WHERE id = ?');
    $find->execute([$paymentId]);
    $p = $find->fetch();
    $find->closeCursor();
    if (!is_array($p) || $p['status'] !== 'paid') {
        return true;
    }
    $due = (int) $p['refund_due_cents'] - (int) $p['refunded_cents'];
    if ($due <= 0) {
        return true;
    }
    $before = (int) $p['refunded_cents'];
    list($status, $refund) = qr_stripe('POST', '/v1/refunds', [
        'payment_intent' => (string) $p['payment_intent'],
        'amount' => $due,
        'reason' => 'requested_by_customer',
        'metadata' => ['bill_payment_id' => (string) $paymentId, 'payment_code' => (string) $p['code']],
    ], 'raya-qr-bill-refund-' . $paymentId . '-' . $before . '-' . $due);
    $ok = $status === 200 && !empty($refund['id']);
    if (!$ok) {
        error_log('raya-qr: refund of ' . $due . ' for bill payment ' . $paymentId . ' failed: HTTP ' . $status
            . ' ' . (string) ($refund['error']['code'] ?? ''));
    }
    qr_write(function (PDO $pdo) use ($p, $ok, $due, $before) {
        $seq = qr_bump_seq($pdo);
        if ($ok) {
            $pdo->prepare('UPDATE bill_payments SET refunded_cents = refunded_cents + ?, refund_error = 0, seq = ? WHERE id = ? AND refunded_cents = ?')
                ->execute([$due, $seq, $p['id'], $before]);
        } else {
            $pdo->prepare('UPDATE bill_payments SET refund_error = 1, seq = ? WHERE id = ?')->execute([$seq, $p['id']]);
        }
        qr_touch_tab($pdo, (int) $p['tab_id'], $seq);
    });
    return $ok;
}

/**
 * Staff cancel an order that is on a bill: lines already paid on a phone are
 * owed back to whoever paid them. Inside the cancel's write transaction;
 * returns the payment ids to refund after the commit.
 */
function qr_bill_cancel_order(PDO $pdo, array $order, int $seq): array
{
    $stmt = $pdo->prepare("SELECT bill_payment_id, SUM(unit_cents * qty) AS amount FROM order_items
        WHERE order_id = ? AND paid_via = 'online' GROUP BY bill_payment_id");
    $stmt->execute([$order['id']]);
    $owed = $stmt->fetchAll();
    $due = $pdo->prepare('UPDATE bill_payments SET refund_due_cents = refund_due_cents + ?, seq = ? WHERE id = ?');
    $ids = [];
    foreach ($owed as $o) {
        $due->execute([(int) $o['amount'], $seq, $o['bill_payment_id']]);
        $ids[] = (int) $o['bill_payment_id'];
    }
    $pdo->prepare("UPDATE order_items SET paid_via = 'refunded' WHERE order_id = ? AND paid_via = 'online'")->execute([$order['id']]);
    qr_touch_tab($pdo, (int) $order['tab_id'], $seq);
    return $ids;
}
