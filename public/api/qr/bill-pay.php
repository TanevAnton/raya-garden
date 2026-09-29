<?php
// POST /api/qr/bill-pay.php — pay chosen lines of a table's bill.
//
// Header  Idempotency-Key: one per attempt, reused on every retry of it.
// Body    {"table": 7, "lang": "bg", "expectedAmount": 2380,
//          "items": [{"code": "R-4K7Q", "line": 0}, …]}
//
// 201 {ok, token, payment, checkoutUrl}   go to Stripe's page
// 200 {…, replayed}                        this attempt was already made
// 409 changed {gone, amount, bill}         some lines were paid or cancelled
//     meanwhile — the phone shows the bill as it is now
//     | no_bill | idempotency_conflict | payments_not_configured
// 502 payment_unavailable {token, payment} Stripe unreachable: retry
// 429 rate_limited · 400 invalid
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/pay.php';
require __DIR__ . '/_lib/bill.php';

qr_require_method('POST');
$idemKey = isset($_SERVER['HTTP_IDEMPOTENCY_KEY']) ? (string) $_SERVER['HTTP_IDEMPOTENCY_KEY'] : '';
if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $idemKey)) {
    qr_fail(400, 'invalid', ['field' => 'idempotency_key']);
}
$now = qr_now();
list($status, $response) = qr_bill_pay(qr_body(), $idemKey, $now);
if (!empty($response['ok']) && $response['payment']['status'] === 'pending') {
    $url = qr_bill_checkout((int) $response['payment']['id'], $now);
    if ($url === '') {
        qr_json(502, ['ok' => false, 'error' => 'payment_unavailable'] + $response);
    }
    $response['checkoutUrl'] = $url;
}
if (isset($response['payment'])) {
    unset($response['payment']['id'], $response['payment']['tabId'], $response['payment']['seq']);
}
qr_json($status, $response);
