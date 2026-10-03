<?php
// Paying on the phone, with Stripe Checkout (Stripe's own payment page).
//
// The flow, when the evening's payment mode is 'online':
//
//   1. order.php stores the order as 'pending_payment' — invisible to staff —
//      and asks Stripe for a Checkout Session for exactly the order's lines
//      and total, priced by the server (qr_checkout_for), and the guest's tip
//      if they chose one, as a line of its own.
//   2. The phone goes to Stripe's page (card, Apple Pay, Google Pay …).
//   3. Stripe tells stripe-webhook.php, signed. Only that makes an order
//      'new' and 'paid' (qr_stripe_event) — never the phone coming back to
//      the menu, which can fail to happen after a successful payment.
//   4. A paid order cancelled by staff is refunded first (qr_refund), tip
//      and all. One line of it cancelled is owed back and refunded right
//      after, for that line only (qr_order_refund_due); the tip stays.
//
// No card data ever reaches this server. No Stripe SDK either: the host runs
// PHP 7.3 without Composer, so this is Stripe's REST API over cURL — three
// calls — pinned to one API version.
//
// Configuration (raya-qr-config.php, above the web root; written by the
// deploy from GitHub secrets — see docs/qr-ordering/SETUP.md):
//   'stripe_secret_key'     a RESTRICTED key (rk_…): Checkout Sessions and
//                           Refunds, write — nothing else
//   'stripe_webhook_secret' the endpoint's signing secret (whsec_…)
//   'public_url'            where Stripe sends the guest back
//                           (default https://rayagarden.bg)
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_STRIPE_VERSION = '2026-08-26.dahlia';
// Tags these sessions in the Stripe Dashboard, to tell this flow apart.
const QR_STRIPE_FLOW = 'raya_qr_menu_hkzvqmwe';
// How long a guest has to pay. Fixed from the order's own time, so a retry
// of the same request to Stripe sends identical parameters.
const QR_PAY_WINDOW = 3600;
// Signed webhook deliveries older than this are refused (replays).
const QR_WEBHOOK_TOLERANCE = 300;

/**
 * One call to Stripe's API. Returns [httpStatus, decodedBody]; status 0 when
 * Stripe could not be reached at all. The key is never logged or returned.
 */
function qr_stripe(string $method, string $path, array $params = [], string $idempotencyKey = ''): array
{
    $config = qr_config();
    $base = 'https://api.stripe.com';
    // Tests point this at a fake Stripe; production never sets RAYA_QR_TEST.
    $override = getenv('RAYA_QR_STRIPE_API');
    if (getenv('RAYA_QR_TEST') === '1' && is_string($override) && $override !== '') {
        $base = rtrim($override, '/');
    }
    $headers = [
        'Authorization: Bearer ' . (string) ($config['stripe_secret_key'] ?? ''),
        'Stripe-Version: ' . QR_STRIPE_VERSION,
    ];
    if ($idempotencyKey !== '') {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
    ]);
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params, '', '&'));
    }
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false) {
        return [0, []];
    }
    $body = json_decode((string) $raw, true);
    return [$status, is_array($body) ? $body : []];
}

function qr_public_url(): string
{
    $config = qr_config();
    $url = (string) ($config['public_url'] ?? '');
    return rtrim($url !== '' ? $url : 'https://rayagarden.bg', '/');
}

/**
 * The Checkout Session for a pending order: made once, then reused. Called
 * outside any write transaction — a slow answer from Stripe must not hold
 * the database's write lock while other tables are ordering.
 *
 * Returns the payment page's URL, or '' if Stripe could not be reached (the
 * phone retries with the same Idempotency-Key, which lands back here).
 */
function qr_checkout_for(int $orderId, int $now): string
{
    $pdo = qr_db();
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$orderId]);
    $order = $find->fetch();
    $find->closeCursor(); // before calling Stripe — see qr_write()
    if (!is_array($order) || $order['status'] !== 'pending_payment') {
        return '';
    }
    if ($order['checkout_url'] !== '' && (int) $order['checkout_expires'] > $now) {
        return (string) $order['checkout_url'];
    }
    if ($order['checkout_session'] !== '') {
        return ''; // made, and expired: this order can no longer be paid
    }

    $lines = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
    $lines->execute([$orderId]);
    $lang = $order['lang'] === 'en' ? 'en' : 'bg';
    $params = [
        'mode' => 'payment',
        'client_reference_id' => (string) $orderId,
        'locale' => $lang,
        'expires_at' => (int) $order['created_at'] + QR_PAY_WINDOW,
        'success_url' => qr_public_url() . '/menu/?lang=' . $lang . '&paid=' . rawurlencode((string) $order['code']),
        'cancel_url' => qr_public_url() . '/menu/?lang=' . $lang . '&unpaid=' . rawurlencode((string) $order['code']),
        'integration_identifier' => QR_STRIPE_FLOW,
        'metadata' => ['order_id' => (string) $orderId, 'order_code' => (string) $order['code'], 'table' => (string) $order['table_no']],
        'payment_intent_data' => [
            'description' => 'RAYA Garden · ' . $order['code'] . ' · ' . ($lang === 'en' ? 'table ' : 'маса ') . $order['table_no'],
            'metadata' => ['order_id' => (string) $orderId, 'order_code' => (string) $order['code']],
        ],
        'line_items' => [],
    ];
    foreach ($lines->fetchAll() as $line) {
        $params['line_items'][] = [
            'quantity' => (int) $line['qty'],
            'price_data' => [
                'currency' => 'eur',
                'unit_amount' => (int) $line['unit_cents'],
                'product_data' => ['name' => qr_stripe_line_name($line, $lang)],
            ],
        ];
    }
    if ((int) $order['tip_cents'] > 0) {
        $params['line_items'][] = [
            'quantity' => 1,
            'price_data' => [
                'currency' => 'eur',
                'unit_amount' => (int) $order['tip_cents'],
                'product_data' => ['name' => $lang === 'en' ? 'Tip for the team' : 'Бакшиш за екипа'],
            ],
        ];
    }
    // No payment_method_types: the methods offered are chosen in the Stripe
    // Dashboard (cards, Apple Pay, Google Pay …), not hard-coded here.

    list($status, $session) = qr_stripe('POST', '/v1/checkout/sessions', $params, 'raya-qr-checkout-' . $orderId);
    if ($status !== 200 || empty($session['id']) || empty($session['url'])) {
        error_log('raya-qr: checkout session for order ' . $orderId . ' failed: HTTP ' . $status
            . ' ' . (string) ($session['error']['code'] ?? $session['error']['message'] ?? ''));
        return '';
    }
    if ((int) ($session['amount_total'] ?? -1) !== (int) $order['total_cents'] + (int) $order['tip_cents']) {
        error_log('raya-qr: checkout session ' . $session['id'] . ' total differs from order ' . $orderId);
        return '';
    }
    qr_write(function (PDO $pdo) use ($orderId, $session) {
        $pdo->prepare("UPDATE orders SET checkout_session = ?, checkout_url = ?, checkout_expires = ?
            WHERE id = ? AND checkout_session = ''")
            ->execute([(string) $session['id'], (string) $session['url'], (int) ($session['expires_at'] ?? 0), $orderId]);
    });
    return (string) $session['url'];
}

/**
 * A line as Stripe's payment page shows it: "Бургас 63 · 100 мл",
 * "Салата „Цезар“ · с пиле 400 g". The size is added unless the detail
 * already says it (a size choice such as "100 мл").
 */
function qr_stripe_line_name(array $line, string $lang): string
{
    $name = (string) ($lang === 'en' ? $line['name_en'] : $line['name_bg']);
    $detail = (string) ($lang === 'en' ? $line['detail_en'] : $line['detail_bg']);
    $size = (string) $line['size'];
    if ($size !== '' && strpos($detail, (string) strtok($size, ' ')) === false) {
        $detail = trim($detail . ' ' . $size);
    }
    return $detail !== '' ? $name . ' · ' . $detail : $name;
}

/**
 * Is this a genuine Stripe delivery? The Stripe-Signature header is
 * "t=<unix time>,v1=<hex>[,v1=…]": an HMAC-SHA256, with the endpoint's
 * signing secret, over "<t>.<raw body>". Older than five minutes is refused,
 * so a captured delivery cannot be replayed later.
 */
function qr_stripe_signature_ok(string $payload, string $header, string $secret, int $now): bool
{
    if ($secret === '' || $header === '') {
        return false;
    }
    $time = null;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        $pair = explode('=', trim($part), 2);
        if (count($pair) !== 2) {
            continue;
        }
        if ($pair[0] === 't' && ctype_digit($pair[1])) {
            $time = (int) $pair[1];
        } elseif ($pair[0] === 'v1') {
            $signatures[] = $pair[1];
        }
    }
    if ($time === null || !$signatures || abs($now - $time) > QR_WEBHOOK_TOLERANCE) {
        return false;
    }
    $expected = hash_hmac('sha256', $time . '.' . $payload, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) {
            return true;
        }
    }
    return false;
}

/**
 * Apply one verified Stripe event, exactly once: the event id is recorded in
 * the same transaction as its effect, so a redelivery changes nothing, and a
 * failure rolls both back for Stripe to retry.
 *
 * Returns the ids of bill payments that are now owed money back (see
 * bill.php) — refunded by the caller after the commit.
 */
function qr_stripe_event(array $event, int $now): array
{
    $id = (string) ($event['id'] ?? '');
    $type = (string) ($event['type'] ?? '');
    $object = $event['data']['object'] ?? null;
    if ($id === '' || !is_array($object)) {
        return [];
    }
    return qr_write(function (PDO $pdo) use ($id, $type, $object, $now) {
        $seen = $pdo->prepare('INSERT OR IGNORE INTO stripe_events (id, type, at) VALUES (?, ?, ?)');
        $seen->execute([$id, $type, $now]);
        if ($seen->rowCount() === 0) {
            return []; // already applied
        }
        $pdo->prepare('DELETE FROM stripe_events WHERE at < ?')->execute([$now - 30 * 86400]);

        if ($type === 'charge.refunded') {
            // Refunded in the Stripe Dashboard rather than by cancelling here.
            if (($object['refunded'] ?? false) === true && !empty($object['payment_intent'])) {
                $find = $pdo->prepare("SELECT * FROM orders WHERE payment_intent = ? AND pay_status = 'paid'");
                $find->execute([(string) $object['payment_intent']]);
                $order = $find->fetch();
                if (is_array($order)) {
                    $seq = qr_bump_seq($pdo);
                    $pdo->prepare("UPDATE orders SET pay_status = 'refunded', updated_at = ?, seq = ? WHERE id = ?")
                        ->execute([$now, $seq, $order['id']]);
                }
            }
            return [];
        }
        if (strpos($type, 'checkout.session.') !== 0 || empty($object['id'])) {
            return [];
        }
        $find = $pdo->prepare('SELECT * FROM orders WHERE checkout_session = ?');
        $find->execute([(string) $object['id']]);
        $order = $find->fetch();
        $find->closeCursor();
        if (!is_array($order)) {
            // A payment from a table's bill — or not one of ours at all
            // (another integration on the same account).
            $owed = function_exists('qr_bill_event') ? qr_bill_event($pdo, $type, $object, $now) : null;
            return $owed ? [$owed] : [];
        }
        $orderId = (int) $order['id'];

        if ($type === 'checkout.session.completed' || $type === 'checkout.session.async_payment_succeeded') {
            // With slower payment methods "completed" arrives while the money
            // is still on its way ('unpaid'); the order waits for
            // async_payment_succeeded.
            if (($object['payment_status'] ?? '') !== 'paid' || $order['pay_status'] === 'paid' || $order['pay_status'] === 'refunded') {
                return [];
            }
            if ((int) ($object['amount_total'] ?? -1) !== (int) $order['total_cents'] + (int) $order['tip_cents'] || ($object['currency'] ?? '') !== 'eur') {
                error_log('raya-qr: paid session ' . $object['id'] . ' does not match order ' . $orderId);
                return [];
            }
            $seq = qr_bump_seq($pdo);
            // A payment that lands after we gave up on it still counts: the
            // guest paid, so the order goes to staff.
            $pdo->prepare("UPDATE orders SET status = 'new', pay_status = 'paid', paid_at = ?, payment_intent = ?,
                payer_name = ?, checkout_url = '', updated_at = ?, seq = ? WHERE id = ?")
                ->execute([$now, (string) ($object['payment_intent'] ?? ''), qr_payer_name($object), $now, $seq, $orderId]);
            $pdo->prepare("INSERT INTO order_events (order_id, from_status, to_status, reason, at) VALUES (?, ?, 'new', 'paid', ?)")
                ->execute([$orderId, $order['status'], $now]);
            return [];
        }
        if ($type === 'checkout.session.async_payment_failed' || $type === 'checkout.session.expired') {
            if ($order['status'] !== 'pending_payment') {
                return [];
            }
            $seq = qr_bump_seq($pdo);
            $payStatus = $type === 'checkout.session.expired' ? 'expired' : 'failed';
            $pdo->prepare("UPDATE orders SET status = 'expired', pay_status = ?, checkout_url = '', updated_at = ?, seq = ? WHERE id = ?")
                ->execute([$payStatus, $now, $seq, $orderId]);
            $pdo->prepare("INSERT INTO order_events (order_id, from_status, to_status, reason, at) VALUES (?, 'pending_payment', 'expired', ?, ?)")
                ->execute([$orderId, $payStatus, $now]);
        }
        return [];
    });
}

/**
 * The name the guest gave on Stripe's payment page — the cardholder, or the
 * Apple Pay / Google Pay account — from a Checkout Session. Only the name:
 * email and card details are never kept here.
 */
function qr_payer_name(array $session): string
{
    $name = $session['customer_details']['name'] ?? '';
    return is_string($name) ? qr_clean_name($name, 80) : '';
}

/**
 * Give a paid order's money back, in full. One refund per order, however
 * many times this is called (Stripe idempotency). Returns the refund id,
 * 'already' if Stripe says it was refunded before, or null on failure.
 */
function qr_refund(array $order)
{
    list($status, $refund) = qr_stripe('POST', '/v1/refunds', [
        'payment_intent' => (string) $order['payment_intent'],
        'reason' => 'requested_by_customer',
        'metadata' => ['order_id' => (string) $order['id'], 'order_code' => (string) $order['code']],
    ], 'raya-qr-refund-' . $order['id']);
    if ($status === 200 && !empty($refund['id'])) {
        return (string) $refund['id'];
    }
    if (($refund['error']['code'] ?? '') === 'charge_already_refunded') {
        return 'already';
    }
    error_log('raya-qr: refund for order ' . $order['id'] . ' failed: HTTP ' . $status
        . ' ' . (string) ($refund['error']['code'] ?? ''));
    return null;
}

/**
 * Pay back what a phone-paid order is owed (refund_due − refunded): lines
 * staff cancelled one by one. Outside any transaction. As for bill payments
 * (qr_bill_refund_due), the idempotency key names the amount refunded
 * before, so a retry or two tablets at once make one refund. Returns true
 * when nothing is owed any more.
 */
function qr_order_refund_due(int $orderId): bool
{
    $pdo = qr_db();
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$orderId]);
    $order = $find->fetch();
    $find->closeCursor(); // before calling Stripe — see qr_write()
    if (!is_array($order) || $order['pay_status'] !== 'paid') {
        return true;
    }
    $due = (int) $order['refund_due_cents'] - (int) $order['refunded_cents'];
    if ($due <= 0) {
        return true;
    }
    $before = (int) $order['refunded_cents'];
    list($status, $refund) = qr_stripe('POST', '/v1/refunds', [
        'payment_intent' => (string) $order['payment_intent'],
        'amount' => $due,
        'reason' => 'requested_by_customer',
        'metadata' => ['order_id' => (string) $orderId, 'order_code' => (string) $order['code']],
    ], 'raya-qr-order-refund-' . $orderId . '-' . $before . '-' . $due);
    $ok = $status === 200 && !empty($refund['id']);
    if (!$ok) {
        error_log('raya-qr: refund of ' . $due . ' for order ' . $orderId . ' failed: HTTP ' . $status
            . ' ' . (string) ($refund['error']['code'] ?? ''));
    }
    qr_write(function (PDO $pdo) use ($orderId, $ok, $due, $before) {
        $seq = qr_bump_seq($pdo);
        if ($ok) {
            $pdo->prepare("UPDATE orders SET refunded_cents = refunded_cents + ?, refund_error = 0, seq = ?
                WHERE id = ? AND refunded_cents = ? AND pay_status = 'paid'")
                ->execute([$due, $seq, $orderId, $before]);
        } else {
            $pdo->prepare('UPDATE orders SET refund_error = 1, seq = ? WHERE id = ?')->execute([$seq, $orderId]);
        }
    });
    return $ok;
}
