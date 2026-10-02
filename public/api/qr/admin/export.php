<?php
// GET /api/qr/admin/export.php — the history as a spreadsheet (CSV, opens in
// Excel), for one evening or a stretch of them:
//
//   ?kind=lines&evening=2026-10-03           every order line of the evening
//   ?kind=lines&month=2026-10                … of every evening in October
//   ?kind=lines&from=2026-10-01&to=2026-12-31
//   ?kind=payments&…                         card payments on the phone instead
//
// A stretch of at most QR_EXPORT_DAYS days. _lib/history.php has the columns.
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
$kind = isset($_GET['kind']) ? (string) $_GET['kind'] : '';
if (!in_array($kind, ['lines', 'payments'], true)) {
    qr_fail(400, 'invalid', ['field' => 'kind']);
}
if (isset($_GET['evening'])) {
    $from = $to = (string) $_GET['evening'];
} elseif (isset($_GET['month'])) {
    $month = (string) $_GET['month'];
    $from = $month . '-01';
    $to = qr_is_date($from) ? (new DateTime($from))->format('Y-m-t') : '';
} else {
    $from = isset($_GET['from']) ? (string) $_GET['from'] : '';
    $to = isset($_GET['to']) ? (string) $_GET['to'] : '';
}
if (!qr_is_date($from) || !qr_is_date($to) || $from > $to) {
    qr_fail(400, 'invalid', ['field' => 'dates']);
}
if ((new DateTime($from))->diff(new DateTime($to))->days >= QR_EXPORT_DAYS) {
    qr_fail(400, 'invalid', ['field' => 'dates', 'maxDays' => QR_EXPORT_DAYS]);
}

$name = 'raya-' . ($kind === 'lines' ? 'poruchki' : 'plashtania') . '-' . ($from === $to ? $from : $from . '_' . $to) . '.csv';
header('Content-Type: text/csv; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '"');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
echo "\xEF\xBB\xBF";
$pdo = qr_db();
$pdo->exec('BEGIN');
try {
    $out = function (string $row) {
        echo $row;
    };
    if ($kind === 'lines') {
        qr_export_lines($pdo, $from, $to, $out);
    } else {
        qr_export_payments($pdo, $from, $to, $out);
    }
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    $pdo->exec('ROLLBACK');
    throw $e;
}
