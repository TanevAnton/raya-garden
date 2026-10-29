<?php
// GET /api/qr/admin/audit.php — the operations log on screen (Наредба Н-18,
// Annex 29 т. 16), newest first, 200 rows at a time, filtered by any of:
//   ?from=2026-10-01&to=2026-10-31   Sofia dates (default: today)
//   &operator=0002                   an operator's code
//   &kind=line_void                  a kind of action (_lib/nap.php, QR_AUDIT_KINDS)
//   &before=1234                     the next page: rows older than this id
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

const QR_AUDIT_PAGE = 200;

qr_require_method('GET');
qr_require_admin(false, 'manager');
$today = (new DateTime('@' . qr_now()))->setTimezone(new DateTimeZone(QR_TZ))->format('Y-m-d');
$from = isset($_GET['from']) && $_GET['from'] !== '' ? (string) $_GET['from'] : $today;
$to = isset($_GET['to']) && $_GET['to'] !== '' ? (string) $_GET['to'] : $from;
if (!qr_is_date($from) || !qr_is_date($to) || $from > $to) {
    qr_fail(400, 'invalid', ['field' => 'dates']);
}
$operator = isset($_GET['operator']) ? (string) $_GET['operator'] : '';
$kind = isset($_GET['kind']) ? (string) $_GET['kind'] : '';
$before = isset($_GET['before']) ? (int) $_GET['before'] : 0;
if (($operator !== '' && !preg_match('/^\d{4}$/', $operator)) || ($kind !== '' && !isset(QR_AUDIT_KINDS[$kind]))) {
    qr_fail(400, 'invalid', ['field' => $kind !== '' && !isset(QR_AUDIT_KINDS[$kind]) ? 'kind' : 'operator']);
}
$start = (new DateTime($from . ' 00:00', new DateTimeZone(QR_TZ)))->getTimestamp();
$end = (new DateTime($to . ' 00:00', new DateTimeZone(QR_TZ)))->modify('+1 day')->getTimestamp();

$where = ['at >= ?', 'at < ?'];
$args = [$start, $end];
if ($operator !== '') {
    $where[] = 'operator = ?';
    $args[] = $operator;
}
if ($kind !== '') {
    $where[] = 'kind = ?';
    $args[] = $kind;
}
if ($before > 0) {
    $where[] = 'id < ?';
    $args[] = $before;
}
$pdo = qr_db();
$stmt = $pdo->prepare('SELECT * FROM audit_log WHERE ' . implode(' AND ', $where) . ' ORDER BY id DESC LIMIT ' . (QR_AUDIT_PAGE + 1));
$stmt->execute($args);
$rows = $stmt->fetchAll();
$more = count($rows) > QR_AUDIT_PAGE;
$rows = array_slice($rows, 0, QR_AUDIT_PAGE);
$operators = [];
foreach ($pdo->query("SELECT operator, MAX(operator_name) AS name FROM audit_log WHERE operator <> '' GROUP BY operator ORDER BY operator")->fetchAll() as $o) {
    $operators[] = ['code' => (string) $o['operator'], 'name' => (string) $o['name']];
}
$kinds = [];
foreach (QR_AUDIT_KINDS as $code => $k) {
    $kinds[] = ['code' => $code, 'name' => $k[0]];
}
qr_json(200, [
    'ok' => true,
    'from' => $from,
    'to' => $to,
    'rows' => array_map(function ($r) {
        return [
            'id' => (int) $r['id'],
            'at' => (int) $r['at'],
            'kind' => (string) $r['kind'],
            'kindName' => QR_AUDIT_KINDS[$r['kind']][0] ?? (string) $r['kind'],
            'ref' => (string) $r['ref'],
            'amount' => (int) $r['amount_cents'],
            'detail' => (string) $r['detail'],
            'operator' => (string) $r['operator'],
            'operatorName' => (string) $r['operator_name'],
        ];
    }, $rows),
    'more' => $more,
    'operators' => $operators,
    'kinds' => $kinds,
]);
