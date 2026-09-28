<?php
// POST /api/qr/order.php — place an order.
//
// Header  Idempotency-Key: one random id per checkout attempt, reused on
//         every retry of that attempt. The same key never makes two orders.
// Body    {"table": 7, "lang": "bg", "expectedTotal": 2480,
//          "lines": [{"itemId": "caesar", "variantId": "chicken",
//                     "choiceId": "", "qty": 2, "note": "", "price": 990}],
//          "website": ""}                       ← honeypot, must stay empty
//
// 201 {ok, token, order}           created — only after the commit
// 200 {ok, replayed, token, order} this attempt was already placed
// 409 closed | table_invalid | changed (removed / soldOut / priceChanged)
//     | idempotency_conflict
// 429 rate_limited · 400 invalid · 503 storage/menu unavailable
//
// When guests pay on the phone the order is 'pending_payment' and the answer
// also carries checkoutUrl, Stripe's payment page for it. If Stripe cannot be
// reached: 502 payment_unavailable, with token and order — the phone retries
// with the same Idempotency-Key, which reuses the order and asks Stripe again.
//
// The rules themselves are in _lib/order.php.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/order.php';
require __DIR__ . '/_lib/pay.php';

qr_require_method('POST');
$idemKey = isset($_SERVER['HTTP_IDEMPOTENCY_KEY']) ? (string) $_SERVER['HTTP_IDEMPOTENCY_KEY'] : '';
if (!preg_match('/^[A-Za-z0-9-]{16,64}$/', $idemKey)) {
    qr_fail(400, 'invalid', ['field' => 'idempotency_key']);
}
$body = qr_body();
if (isset($body['website']) && $body['website'] !== '') {
    // Only a bot fills the invisible field. Refuse without saying why.
    qr_fail(400, 'invalid', ['field' => 'body']);
}
$now = qr_now();
list($status, $response) = qr_place_order($body, $idemKey, $now);
if (!empty($response['ok']) && $response['order']['status'] === 'pending_payment') {
    $url = qr_checkout_for((int) $response['order']['id'], $now);
    if ($url === '') {
        qr_json(502, ['ok' => false, 'error' => 'payment_unavailable'] + $response);
    }
    $response['checkoutUrl'] = $url;
}
qr_json($status, $response);
