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
// A payment can carry a tip (tip_cents), on top of the lines it pays for:
// its own line on Stripe's page, kept apart from the till amount, and
// refunded only if nothing the payment paid for still stands.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_BILL_ATTEMPTS = 10;     // payment attempts per table per 5 minutes
const QR_BILL_PENDING_HINT = 600; // "being paid…" shown for 10 minutes at most
const QR_TIP_MAX = 50000;         // a tip: at most 500 € …
// … and at most the amount it is added to; anything more is a slip of the finger.

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
        // Staff can cancel part of a line (or all of it): only what is left
        // is on the bill.
        $qty = (int) $r['qty'] - (int) $r['void_qty'];
        if ($qty <= 0) {
            continue;
        }
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
            'qty' => $qty,
            'price' => (int) $r['unit_cents'],
            'amount' => (int) $r['unit_cents'] * $qty,
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
    // What is owed back covers lines first; only a payment left with no
    // lines at all gives its tip back too (see qr_bill_owe).
    $amount = (int) $p['amount_cents'];
    $due = (int) $p['refund_due_cents'];
    $tip = (int) ($p['tip_cents'] ?? 0);
    return [
        'id' => (int) $p['id'],
        'code' => (string) $p['code'],
        'tabId' => (int) $p['tab_id'],
        'table' => (int) $p['table_no'],
        'status' => (string) $p['status'],
        'amount' => $amount,
        // The tip on top of the lines, and what is left of it after refunds.
        'tip' => $tip,
        'tipNet' => $tip - max(0, $due - $amount),
        'overlap' => (int) $p['overlap_cents'],
        'refundDue' => (int) $p['refund_due_cents'] - (int) $p['refunded_cents'],
        'refunded' => (int) $p['refunded_cents'],
        'refundError' => (int) $p['refund_error'] === 1,
        'createdAt' => (int) $p['created_at'],
        'paidAt' => (int) $p['paid_at'],
        'payerName' => (string) ($p['payer_name'] ?? ''),
        // For the till: what the lines come to after what is owed back (the
        // tip is shown apart), what was entered in Clock, and voided there.
        'net' => $amount - min($due, $amount),
        'tillAt' => (int) $p['till_at'],
        'tillCents' => (int) $p['till_cents'],
        'tillVoidAt' => (int) $p['till_void_at'],
        'tillVoidCents' => (int) ($p['till_void_cents'] ?? 0),
        'seq' => (int) $p['seq'],
    ];
}

/**
 * A payment's lines, for the till list and the payment page. qty is how many
 * the payment covered when it was made — the line's amount then, over its
 * unit price — whatever staff cancelled of the line since.
 */
function qr_bill_payment_lines(PDO $pdo, int $paymentId): array
{
    $stmt = $pdo->prepare('SELECT i.unit_cents, i.name_bg, i.name_en, i.detail_bg, i.detail_en, i.size, o.code, b.amount_cents
        FROM bill_payment_items b
        JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line
        JOIN orders o ON o.id = b.order_id
        WHERE b.payment_id = ? ORDER BY b.order_id, b.line');
    $stmt->execute([$paymentId]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$row) {
        $row['qty'] = (int) $row['unit_cents'] > 0 ? intdiv((int) $row['amount_cents'], (int) $row['unit_cents']) : 1;
    }
    unset($row);
    return $rows;
}

/**
 * Start paying chosen lines of a table's bill. Validated in one write
 * transaction against the bill as it is now; the Checkout Session is made
 * afterwards (qr_bill_checkout), outside the lock.
 *
 * Body: {"table": 7, "items": [{"code": "R-4K7Q", "line": 0}, …],
 *        "expectedAmount": 2380, "tip": 240, "lang": "bg"}
 * expectedAmount is the lines' total as the guest saw it; tip (optional,
 * cents) goes on top, at most the lines' total and QR_TIP_MAX.
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
    $tip = $body['tip'] ?? 0;
    if (!is_int($tip) || $tip < 0 || $tip > QR_TIP_MAX || (is_int($expected) && $tip > $expected)) {
        return [400, ['ok' => false, 'error' => 'invalid', 'field' => 'tip']];
    }
    // Without a tip the hash is what it always was.
    $payloadHash = hash('sha256', json_encode($tip > 0 ? [$table, array_keys($picked), $tip] : [$table, array_keys($picked)]));

    return qr_write(function (PDO $pdo) use ($table, $picked, $lang, $expected, $tip, $payloadHash, $idemKey, $now) {
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
            (code, tab_id, table_no, token_hash, idem_key, payload_hash, amount_cents, tip_cents, lang, ip_hash, created_at, seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$code, (int) $tab['id'], $table, hash('sha256', $token), $idemKey, $payloadHash, $amount, $tip, $lang, qr_ip_hash(), $now, $seq]);
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
        $params['line_items'][] = [
            'quantity' => (int) $line['qty'],
            'price_data' => [
                'currency' => 'eur',
                'unit_amount' => (int) $line['unit_cents'],
                'product_data' => ['name' => qr_stripe_line_name($line, $lang)],
            ],
        ];
    }
    if ((int) $p['tip_cents'] > 0) {
        $params['line_items'][] = [
            'quantity' => 1,
            'price_data' => [
                'currency' => 'eur',
                'unit_amount' => (int) $p['tip_cents'],
                'product_data' => ['name' => $lang === 'en' ? 'Tip for the team' : 'Бакшиш за екипа'],
            ],
        ];
    }
    list($status, $session) = qr_stripe('POST', '/v1/checkout/sessions', $params, 'raya-qr-bill-' . $paymentId);
    if ($status !== 200 || empty($session['id']) || empty($session['url'])) {
        error_log('raya-qr: checkout session for bill payment ' . $paymentId . ' failed: HTTP ' . $status
            . ' ' . (string) ($session['error']['code'] ?? $session['error']['message'] ?? ''));
        return '';
    }
    if ((int) ($session['amount_total'] ?? -1) !== (int) $p['amount_cents'] + (int) $p['tip_cents']) {
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
        if ((int) ($object['amount_total'] ?? -1) !== (int) $p['amount_cents'] + (int) $p['tip_cents'] || ($object['currency'] ?? '') !== 'eur') {
            error_log('raya-qr: paid session ' . $object['id'] . ' does not match bill payment ' . $id);
            return null;
        }
        $seq = qr_bump_seq($pdo);
        // First confirmed payment wins a line. A line that is no longer
        // unpaid — paid by someone else meanwhile, settled by staff, or its
        // order cancelled — is owed back to this payer; so is any part of a
        // line staff cancelled while the guest was paying.
        $items = $pdo->prepare("SELECT b.*, i.paid_via, i.unit_cents, i.qty, i.void_qty, o.status AS order_status FROM bill_payment_items b
            JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line
            JOIN orders o ON o.id = b.order_id WHERE b.payment_id = ?");
        $items->execute([$id]);
        $overlap = 0;
        $mark = $pdo->prepare("UPDATE order_items SET paid_via = 'online', bill_payment_id = ? WHERE order_id = ? AND line = ? AND paid_via = ''");
        $touchOrder = $pdo->prepare('UPDATE orders SET seq = ?, updated_at = ? WHERE id = ?');
        foreach ($items->fetchAll() as $item) {
            $standing = (int) $item['unit_cents'] * ((int) $item['qty'] - (int) $item['void_qty']);
            if ($item['paid_via'] !== '' || $standing <= 0 || !in_array($item['order_status'], ['new', 'accepted', 'served'], true)) {
                $overlap += (int) $item['amount_cents'];
                continue;
            }
            $overlap += max(0, (int) $item['amount_cents'] - $standing);
            $mark->execute([$id, $item['order_id'], $item['line']]);
            $touchOrder->execute([$seq, $now, $item['order_id']]);
        }
        $pdo->prepare("UPDATE bill_payments SET status = 'paid', paid_at = ?, payment_intent = ?, payer_name = ?, checkout_url = '',
            overlap_cents = ?, seq = ? WHERE id = ?")
            ->execute([$now, (string) ($object['payment_intent'] ?? ''), qr_payer_name($object), $overlap, $seq, $id]);
        qr_bill_owe($pdo, $id, $overlap, $seq);
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
    // What staff cancelled line by line before is owed back already.
    $stmt = $pdo->prepare("SELECT bill_payment_id, SUM(unit_cents * (qty - void_qty)) AS amount FROM order_items
        WHERE order_id = ? AND paid_via = 'online' GROUP BY bill_payment_id");
    $stmt->execute([$order['id']]);
    $owed = $stmt->fetchAll();
    $ids = [];
    foreach ($owed as $o) {
        if ((int) $o['amount'] > 0) {
            qr_bill_owe($pdo, (int) $o['bill_payment_id'], (int) $o['amount'], $seq);
            $ids[] = (int) $o['bill_payment_id'];
        }
    }
    $pdo->prepare("UPDATE order_items SET paid_via = 'refunded' WHERE order_id = ? AND paid_via = 'online'")->execute([$order['id']]);
    qr_touch_tab($pdo, (int) $order['tab_id'], $seq);
    return $ids;
}

/**
 * A bill payment now owes $cents more back to its payer: lines paid twice,
 * cancelled, or cut short by staff. Once nothing of what it paid for still
 * stands, its tip goes back too — a tip for nothing is not a tip. Inside a
 * write transaction; the refund itself is qr_bill_refund_due(), after it.
 */
function qr_bill_owe(PDO $pdo, int $paymentId, int $cents, int $seq)
{
    if ($cents <= 0) {
        return;
    }
    $find = $pdo->prepare('SELECT amount_cents, tip_cents, refund_due_cents FROM bill_payments WHERE id = ?');
    $find->execute([$paymentId]);
    $p = $find->fetch();
    $find->closeCursor();
    if (!is_array($p)) {
        return;
    }
    $amount = (int) $p['amount_cents'];
    $lines = min($amount, min((int) $p['refund_due_cents'], $amount) + $cents);
    $due = $lines + ($lines >= $amount ? (int) $p['tip_cents'] : 0);
    $pdo->prepare('UPDATE bill_payments SET refund_due_cents = ?, seq = ? WHERE id = ?')->execute([$due, $seq, $paymentId]);
}
