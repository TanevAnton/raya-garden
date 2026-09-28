<?php
// POST /api/qr/admin/till.php — the "За касата" list: orders guests paid on
// the phone still have to be entered in the till (Clock), which this system
// cannot reach. Staff tick them off here.
//
//   {"id": 12, "entered": true|false}   entered in the till (or undo)
//   {"id": 12, "voided": true|false}    voided there after a refund (or undo)
//
// Only for orders paid on the phone. Every tick takes a change number, so
// every tablet's list agrees.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$id = $body['id'] ?? null;
$column = array_key_exists('voided', $body) ? 'till_void_at' : (array_key_exists('entered', $body) ? 'till_at' : null);
$value = $body['voided'] ?? $body['entered'] ?? null;
if (!is_int($id) || $column === null || !is_bool($value)) {
    qr_fail(400, 'invalid');
}
$now = qr_now();
list($status, $response) = qr_write(function (PDO $pdo) use ($id, $column, $value, $now) {
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    if (!is_array($order) || !in_array($order['pay_status'], ['paid', 'refunded'], true)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    if ($column === 'till_void_at' && ($order['pay_status'] !== 'refunded' || (int) $order['till_at'] === 0)) {
        return [409, ['ok' => false, 'error' => 'not_voidable', 'order' => qr_order_json($order)]];
    }
    $seq = qr_bump_seq($pdo);
    $pdo->prepare("UPDATE orders SET $column = ?, seq = ? WHERE id = ?")->execute([$value ? $now : 0, $seq, $id]);
    $find->execute([$id]);
    return [200, ['ok' => true, 'order' => qr_order_json($find->fetch())]];
});
qr_json($status, $response);
