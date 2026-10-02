<?php
// GET /api/qr/admin/history.php — "История" on the staff screen.
//
//   (no parameters)          every evening with orders, newest first
//   ?evening=2026-10-03      that evening's report (_lib/history.php)
//
// Read in one snapshot (BEGIN … COMMIT), so the figures agree with each
// other while orders keep arriving.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/bill.php';
require dirname(__DIR__) . '/_lib/history.php';

qr_require_method('GET');
qr_require_admin(false);
$evening = isset($_GET['evening']) ? (string) $_GET['evening'] : null;
if ($evening !== null && !qr_is_date($evening)) {
    qr_fail(400, 'invalid', ['field' => 'evening']);
}
$pdo = qr_db();
$pdo->exec('BEGIN');
try {
    $body = $evening === null
        ? ['ok' => true, 'evenings' => qr_history_evenings($pdo)]
        : ['ok' => true, 'report' => qr_history_report($pdo, $evening)];
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    $pdo->exec('ROLLBACK');
    throw $e;
}
qr_json(200, $body);
