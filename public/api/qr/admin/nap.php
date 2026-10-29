<?php
// GET /api/qr/admin/nap.php — НАП's tables (Наредба Н-18, Annex 29 т. 18;
// _lib/nap.php), on screen or as a spreadsheet:
//   ?table=18.1 … 18.5 | nom_items | nom_operations | nom_payments | nom_sites
//          | nom_workplaces | nom_operators | nom_roles | nom_rights
//   &from=2026-10-01&to=2026-10-31   Sofia dates (the nomenclatures ignore them)
//   &fu=DT279013                     one fiscal printer (its serial number)
//   &operator=0002                   one operator
//   &format=csv                      the whole table as CSV; else JSON, the
//                                    first 500 rows and how many there are
// For a manager or the auditor.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/history.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/nap.php';

const QR_NAP_SCREEN_ROWS = 500;

qr_require_method('GET');
qr_require_admin(false, 'manager');
$table = isset($_GET['table']) ? (string) $_GET['table'] : '';
if (!in_array($table, QR_NAP_TABLES, true)) {
    qr_fail(400, 'invalid', ['field' => 'table']);
}
$from = isset($_GET['from']) ? (string) $_GET['from'] : '';
$to = isset($_GET['to']) ? (string) $_GET['to'] : '';
if (!qr_is_date($from) || !qr_is_date($to) || $from > $to) {
    qr_fail(400, 'invalid', ['field' => 'dates']);
}
if ((new DateTime($from))->diff(new DateTime($to))->days >= QR_EXPORT_DAYS) {
    qr_fail(400, 'invalid', ['field' => 'dates', 'maxDays' => QR_EXPORT_DAYS]);
}
$fu = isset($_GET['fu']) ? (string) $_GET['fu'] : '';
$operator = isset($_GET['operator']) ? (string) $_GET['operator'] : '';
if (($fu !== '' && !preg_match('/^[A-Za-z0-9]{8}$/', $fu)) || ($operator !== '' && !preg_match('/^\d{4}$/', $operator))) {
    qr_fail(400, 'invalid', ['field' => $fu !== '' && !preg_match('/^[A-Za-z0-9]{8}$/', $fu) ? 'fu' : 'operator']);
}

$pdo = qr_db();
$pdo->exec('BEGIN');
try {
    $data = qr_nap_table($pdo, $table, $from, $to, $fu, $operator);
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    $pdo->exec('ROLLBACK');
    throw $e;
}

if (($_GET['format'] ?? '') === 'csv') {
    $name = 'raya-nap-' . str_replace('.', '-', $table) . '-' . ($from === $to ? $from : $from . '_' . $to) . '.csv';
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex');
    echo "\xEF\xBB\xBF" . qr_csv_row(array_map('qr_csv_text', $data['columns']));
    foreach ($data['rows'] as $row) {
        echo qr_csv_row(array_map('qr_csv_text', $row));
    }
    exit;
}
qr_json(200, [
    'ok' => true,
    'table' => $table,
    'columns' => $data['columns'],
    'rows' => array_slice($data['rows'], 0, QR_NAP_SCREEN_ROWS),
    'total' => count($data['rows']),
]);
