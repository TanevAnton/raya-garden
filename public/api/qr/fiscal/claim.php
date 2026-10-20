<?php
// POST /api/qr/fiscal/claim.php — the fiscal bridge in the restaurant asks for
// the next receipt to print (_lib/fiscal.php). X-Raya-Bridge-Key: <the
// bridge's key>.
//
//   {"version": "1.0.0", "printer": {"id": "dt279013", "serialNumber": "DT279013",
//    "ok": true, "message": ""}}
// With "check": true the bridge's state is recorded and nothing is claimed
// (node bridge.mjs --check).
//
// 200 {"ok": true, "job": {…} | null, "pollMs": 3000} · 401 wrong key ·
// 503 printing receipts is off.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/pay.php';

qr_require_method('POST');
qr_fiscal_require_bridge();
$body = qr_body();
$job = qr_fiscal_claim($body, qr_now());
// Nothing waiting: ask again a little later. Something printed: right away.
qr_json(200, ['ok' => true, 'job' => $job, 'pollMs' => $job === null ? 3000 : 0, 'mode' => qr_fiscal_mode()]);
