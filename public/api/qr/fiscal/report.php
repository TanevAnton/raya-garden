<?php
// POST /api/qr/fiscal/report.php — the fiscal bridge says what happened to a
// receipt it claimed (_lib/fiscal.php, qr_fiscal_report). X-Raya-Bridge-Key:
// <the bridge's key>.
//
//   {"id": 12, "event": "submitted", "taskId": "raya-l-12-1", "usn": "DT279013-0001-0000007"}
//   {"id": 12, "event": "printed", "receiptNumber": "0000085",
//    "receiptDateTime": "2026-10-19T13:55:18", "fiscalMemorySerialNumber": "02517985",
//    "receiptAmount": 32.7}
//   {"id": 12, "event": "failed", "error": "E201 The fiscal memory is full"}
//   {"id": 12, "event": "check", "error": "…"}
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/pay.php';

qr_require_method('POST');
qr_fiscal_require_bridge();
$body = qr_body();
$id = $body['id'] ?? null;
$event = $body['event'] ?? null;
if (!is_int($id) || !is_string($event)) {
    qr_fail(400, 'invalid');
}
// A report or duplicate (see qr_fiscal_command_report), or a receipt.
list($status, $response) = !empty($body['command'])
    ? qr_fiscal_command_report($id, $event, $body, qr_now())
    : qr_fiscal_report($id, $event, $body, qr_now());
qr_json($status, $response);
