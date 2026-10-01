<?php
// POST /api/qr/admin/waiters.php {"tables": {"3": "Иван", "4": "Иван", "7": "Мария"}}
// — who serves which table tonight. The whole list each time: tables left
// out have no waiter. The staff screen shows the table's waiter on every
// order card and bill for it.
//
// Waiters belong to the evening (the service date): a new evening starts
// with none, and an earlier evening's list is deleted on the next save.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

const QR_MAX_WAITER_NAME = 30;

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$tables = $body['tables'] ?? null;
if (!is_array($tables) || count($tables) > QR_MAX_TABLES) {
    qr_fail(400, 'invalid', ['field' => 'tables']);
}
$clean = [];
foreach ($tables as $table => $name) {
    $table = filter_var($table, FILTER_VALIDATE_INT);
    if ($table === false || $table < 1 || $table > QR_MAX_TABLES || !is_string($name)) {
        qr_fail(400, 'invalid', ['field' => 'tables']);
    }
    $name = qr_clean_name($name, QR_MAX_WAITER_NAME + 1);
    if ($name === '' || mb_strlen($name) > QR_MAX_WAITER_NAME) {
        qr_fail(400, 'invalid', ['field' => 'name', 'table' => $table]);
    }
    $clean[$table] = $name;
}
$evening = (string) qr_settings()['service_date'];
if ($evening === '') {
    qr_fail(409, 'not_configured');
}
$seq = qr_write(function (PDO $pdo) use ($clean, $evening) {
    $pdo->exec('DELETE FROM waiters');
    $insert = $pdo->prepare('INSERT INTO waiters (evening, table_no, name) VALUES (?, ?, ?)');
    foreach ($clean as $table => $name) {
        $insert->execute([$evening, $table, $name]);
    }
    return qr_bump_seq($pdo);
});
qr_json(200, ['ok' => true, 'evening' => $evening, 'waiters' => (object) qr_waiters(qr_db(), $evening), 'seq' => $seq]);
