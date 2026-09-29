<?php
// POST /api/qr/bill-abandon.php {"token": "…"} — the guest came back from
// Stripe's page without paying: close that payment page, so the lines stop
// showing as "being paid" to the others at the table. If it was paid after
// all, nothing changes — Stripe's webhook has the last word.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/pay.php';
require __DIR__ . '/_lib/bill.php';

qr_require_method('POST');
$body = qr_body();
$token = $body['token'] ?? null;
if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) {
    qr_fail(400, 'invalid', ['field' => 'token']);
}
list($status, $response) = qr_bill_abandon($token, qr_now());
if (isset($response['payment'])) {
    unset($response['payment']['id'], $response['payment']['tabId'], $response['payment']['seq']);
}
qr_json($status, $response);
