<?php
// POST /api/qr/admin/order.php {"id": 12, "action": "accept"|"serve"|"cancel",
// "from": "<status the screen showed>", "reason": "…"} — move an order on.
//
//   new → accepted → served;  new or accepted → cancelled (reason required)
//
// "from" must still be the order's status: if another tablet moved it first,
// the answer is 409 with the order as it is now, and nothing changes.
// Every move is written to order_events.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

const QR_MOVES = [
    'accept' => [['new'], 'accepted'],
    'serve' => [['accepted'], 'served'],
    'cancel' => [['new', 'accepted'], 'cancelled'],
];

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$id = $body['id'] ?? null;
$action = $body['action'] ?? null;
$from = $body['from'] ?? null;
$reason = isset($body['reason']) && is_string($body['reason']) ? trim(preg_replace('/[\p{Cc}\p{Cf}\s]+/u', ' ', $body['reason'])) : '';
if (!is_int($id) || !is_string($action) || !isset(QR_MOVES[$action]) || !is_string($from)) {
    qr_fail(400, 'invalid');
}
if ($action === 'cancel' && ($reason === '' || mb_strlen($reason) > 200)) {
    qr_fail(400, 'invalid', ['field' => 'reason']);
}
$now = qr_now();
list($status, $response) = qr_write(function (PDO $pdo) use ($id, $action, $from, $reason, $now) {
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    if (!is_array($order)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    list($allowedFrom, $to) = QR_MOVES[$action];
    if ($order['status'] !== $from || !in_array($from, $allowedFrom, true)) {
        return [409, ['ok' => false, 'error' => 'stale', 'order' => qr_order_json($order)]];
    }
    $seq = qr_bump_seq($pdo);
    $pdo->prepare('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = ?, seq = ? WHERE id = ?')
        ->execute([$to, $action === 'cancel' ? $reason : '', $now, $seq, $id]);
    $pdo->prepare('INSERT INTO order_events (order_id, from_status, to_status, reason, at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$id, $from, $to, $reason, $now]);
    $find->execute([$id]);
    return [200, ['ok' => true, 'order' => qr_order_json($find->fetch())]];
});
qr_json($status, $response);
