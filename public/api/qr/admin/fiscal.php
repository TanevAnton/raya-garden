<?php
// POST /api/qr/admin/fiscal.php — a fiscal receipt that did not print, from
// „За касата“ (_lib/fiscal.php):
//
//   {"id": 5, "action": "retry"}   print it again: one that failed, or — once
//                                  someone looked at the printer and found
//                                  nothing — one that stopped at 'check'
//   {"action": "zreport"}          the day's Z report (closes the day)
//   {"action": "xreport"}          an X report (the day so far, closes nothing)
//   {"action": "duplicate"}        a duplicate of the last receipt
//
// Entering it by hand instead is the tick on „За касата“ (till.php).
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/bill.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$id = $body['id'] ?? null;
$action = (string) ($body['action'] ?? '');
if (in_array($action, QR_FISCAL_COMMANDS, true)) {
    list($status, $response) = qr_fiscal_command_request($action, qr_now());
    qr_json($status, $response);
}
if (!is_int($id) || $action !== 'retry') {
    qr_fail(400, 'invalid');
}
list($status, $response) = qr_fiscal_retry($id);
qr_json($status, $response);
