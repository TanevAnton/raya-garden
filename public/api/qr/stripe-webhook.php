<?php
// POST /api/qr/stripe-webhook.php — Stripe's signed notifications about
// payments. The only thing that marks an order paid (see _lib/pay.php).
//
// Register this URL in the Stripe Dashboard (Developers → Webhooks) with
// these events, and put the endpoint's signing secret in the config:
//   checkout.session.completed
//   checkout.session.async_payment_succeeded
//   checkout.session.async_payment_failed
//   checkout.session.expired
//   charge.refunded
//
// 200 applied, or not ours and ignored · 400 bad signature or body ·
// 503 payments not configured · 500 anything else (Stripe retries).
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/pay.php';
require __DIR__ . '/_lib/bill.php';

qr_require_method('POST');
$config = qr_config();
$secret = (string) ($config['stripe_webhook_secret'] ?? '');
if ($secret === '') {
    qr_fail(503, 'payments_not_configured');
}
$payload = file_get_contents('php://input', false, null, 0, 1048576);
$signature = isset($_SERVER['HTTP_STRIPE_SIGNATURE']) ? (string) $_SERVER['HTTP_STRIPE_SIGNATURE'] : '';
// Real time, deliberately — never the test clock: the signature's age is
// Stripe's clock against ours.
if (!is_string($payload) || !qr_stripe_signature_ok($payload, $signature, $secret, time())) {
    qr_fail(400, 'bad_signature');
}
$event = json_decode($payload, true);
if (!is_array($event)) {
    qr_fail(400, 'invalid');
}
foreach (qr_stripe_event($event, qr_now()) as $paymentId) {
    // Lines of a table's bill that someone else had paid first: give this
    // payer their share back. If Stripe refuses now, staff see it and retry.
    qr_bill_refund_due($paymentId);
}
qr_json(200, ['ok' => true]);
