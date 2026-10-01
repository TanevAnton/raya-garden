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
// Cancelling an order the guest paid on the phone refunds it first, in full.
// If Stripe refuses or cannot be reached: 502 refund_failed and the order is
// NOT cancelled — staff try again. Two tablets cancelling at once still make
// one refund (Stripe idempotency); the second gets the usual 409 stale.
//
// An order on a table's bill ("Сметка накрая") is cancelled at once; any of
// its lines already paid on a phone are owed back to whoever paid them and
// refunded right after (_lib/bill.php). A refund that fails then is shown on
// "Сметки" with a retry, and the answer says so (refundPending).
//
// One line, not the whole order (_lib/order.php, qr_void_line):
//   {"id": 12, "action": "void", "line": 0, "qty": 1, "have": 3, "reason": "…"}
// cancels qty of line 0, which the screen showed with 3 still on it. Paid
// on the phone, that amount is refunded right after; a failed refund stays
// owed, shown on the order with a retry:
//   {"id": 12, "action": "refund"}
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/bill.php';
require dirname(__DIR__) . '/_lib/order.php';

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
$now = qr_now();

if ($action === 'refund' && is_int($id)) {
    $ok = qr_order_refund_due($id);
    $find = qr_db()->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    $find->closeCursor();
    if (!is_array($order)) {
        qr_fail(404, 'not_found');
    }
    qr_json($ok ? 200 : 502, ['ok' => $ok] + ($ok ? [] : ['error' => 'refund_failed']) + ['order' => qr_order_json($order)]);
}
if ($action === 'void') {
    $line = $body['line'] ?? null;
    $qty = $body['qty'] ?? null;
    $have = $body['have'] ?? null;
    if (!is_int($id) || !is_int($line) || !is_int($qty) || $qty < 1 || !is_int($have)) {
        qr_fail(400, 'invalid');
    }
    if ($reason === '' || mb_strlen($reason) > 200) {
        qr_fail(400, 'invalid', ['field' => 'reason']);
    }
    list($status, $response, $refundOrder, $owed) = qr_void_line($id, $line, $qty, $have, $reason, $now);
    if ($refundOrder && !qr_order_refund_due($id)) {
        $response['refundPending'] = true;
    }
    foreach ($owed as $paymentId) {
        if (!qr_bill_refund_due($paymentId)) {
            $response['refundPending'] = true;
        }
    }
    if ($status === 200 && ($refundOrder || $owed)) {
        $find = qr_db()->prepare('SELECT * FROM orders WHERE id = ?');
        $find->execute([$id]);
        $response['order'] = qr_order_json($find->fetch());
        $find->closeCursor();
    }
    qr_json($status, $response);
}
if (!is_int($id) || !is_string($action) || !isset(QR_MOVES[$action]) || !is_string($from)) {
    qr_fail(400, 'invalid');
}
if ($action === 'cancel' && ($reason === '' || mb_strlen($reason) > 200)) {
    qr_fail(400, 'invalid', ['field' => 'reason']);
}
$refundId = null;
if ($action === 'cancel') {
    $find = qr_db()->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    $find->closeCursor(); // before the refund call and the write — see qr_write()
    if (is_array($order) && $order['pay_status'] === 'paid' && $order['status'] === $from
        && in_array($from, QR_MOVES['cancel'][0], true)) {
        $refundId = qr_refund($order);
        if ($refundId === null) {
            qr_fail(502, 'refund_failed', ['order' => qr_order_json($order)]);
        }
    }
}
list($status, $response, $owed) = qr_write(function (PDO $pdo) use ($id, $action, $from, $reason, $now, $refundId) {
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    $find->closeCursor();
    if (!is_array($order)) {
        return [404, ['ok' => false, 'error' => 'not_found'], []];
    }
    list($allowedFrom, $to) = QR_MOVES[$action];
    if ($order['status'] !== $from || !in_array($from, $allowedFrom, true)) {
        return [409, ['ok' => false, 'error' => 'stale', 'order' => qr_order_json($order)], []];
    }
    if ($action === 'cancel' && $order['pay_status'] === 'paid' && $refundId === null) {
        // Paid after the check above: go round again rather than cancel unrefunded.
        return [409, ['ok' => false, 'error' => 'stale', 'order' => qr_order_json($order)], []];
    }
    $seq = qr_bump_seq($pdo);
    $pdo->prepare('UPDATE orders SET status = ?, cancel_reason = ?, updated_at = ?, seq = ? WHERE id = ?')
        ->execute([$to, $action === 'cancel' ? $reason : '', $now, $seq, $id]);
    if ($refundId !== null) {
        // Refunded in full: whatever was still owed for single lines is in it.
        $pdo->prepare("UPDATE orders SET pay_status = 'refunded', refund_id = ?,
            refund_due_cents = total_cents, refunded_cents = total_cents, refund_error = 0 WHERE id = ?")
            ->execute([$refundId === 'already' ? '' : $refundId, $id]);
    }
    $pdo->prepare('INSERT INTO order_events (order_id, from_status, to_status, reason, at) VALUES (?, ?, ?, ?, ?)')
        ->execute([$id, $from, $to, $reason, $now]);
    $owed = [];
    if ((int) $order['tab_id'] > 0) {
        $owed = $action === 'cancel' ? qr_bill_cancel_order($pdo, $order, $seq) : [];
        qr_touch_tab($pdo, (int) $order['tab_id'], $seq);
    }
    $find->execute([$id]);
    return [200, ['ok' => true, 'order' => qr_order_json($find->fetch())], $owed];
});
foreach ($owed as $paymentId) {
    if (!qr_bill_refund_due($paymentId)) {
        $response['refundPending'] = true;
    }
}
qr_json($status, $response);
