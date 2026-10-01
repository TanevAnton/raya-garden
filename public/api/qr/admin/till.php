<?php
// POST /api/qr/admin/till.php — the "За касата" list: orders guests paid on
// the phone still have to be entered in the till (Clock), which this system
// cannot reach. Staff tick them off here.
//
//   {"id": 12, "entered": true|false}   entered in the till (or undo)
//   {"id": 12, "voided": true|false}    voided there after a refund (or undo)
//
//   {"paymentId": 9, "entered": true|false}  a payment from a table's bill,
//                                           entered for its net amount
//   {"paymentId": 9, "voided": true|false}   a refund after that, voided
//
// Only for what was paid on the phone. Every tick takes a change number, so
// every tablet's list agrees.
//
// What is entered is the net amount at the time (till_cents). A refund after
// that — the whole order, or one line of it — leaves the entry above the
// net: the difference is to void, and ticking it records what was voided
// (till_void_cents), so a later refund shows up again for its own amount.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/bill.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$id = $body['id'] ?? null;
$column = array_key_exists('voided', $body) ? 'till_void_at' : (array_key_exists('entered', $body) ? 'till_at' : null);
$value = $body['voided'] ?? $body['entered'] ?? null;
if (!array_key_exists('paymentId', $body) && (!is_int($id) || $column === null || !is_bool($value))) {
    qr_fail(400, 'invalid');
}
$now = qr_now();
if (array_key_exists('paymentId', $body)) {
    $paymentId = $body['paymentId'];
    if (!is_int($paymentId) || $column === null || !is_bool($value)) {
        qr_fail(400, 'invalid');
    }
    list($status, $response) = qr_write(function (PDO $pdo) use ($paymentId, $column, $value, $now) {
        $find = $pdo->prepare("SELECT * FROM bill_payments WHERE id = ? AND status = 'paid'");
        $find->execute([$paymentId]);
        $p = $find->fetch();
        $find->closeCursor();
        if (!is_array($p)) {
            return [404, ['ok' => false, 'error' => 'not_found']];
        }
        $net = qr_bill_payment_json($p)['net'];
        if ($column === 'till_void_at' && $value && ((int) $p['till_at'] === 0 || (int) $p['till_cents'] - (int) $p['till_void_cents'] <= $net)) {
            return [409, ['ok' => false, 'error' => 'not_voidable', 'payment' => qr_bill_payment_json($p)]];
        }
        $seq = qr_bump_seq($pdo);
        if ($column === 'till_at') {
            $pdo->prepare('UPDATE bill_payments SET till_at = ?, till_cents = ?, till_void_at = 0, till_void_cents = 0, seq = ? WHERE id = ?')
                ->execute([$value ? $now : 0, $value ? $net : 0, $seq, $paymentId]);
        } else {
            $pdo->prepare('UPDATE bill_payments SET till_void_at = ?, till_void_cents = ?, seq = ? WHERE id = ?')
                ->execute([$value ? $now : 0, $value ? (int) $p['till_cents'] - $net : 0, $seq, $paymentId]);
        }
        $find->execute([$paymentId]);
        $p = $find->fetch();
        $find->closeCursor();
        return [200, ['ok' => true, 'payment' => qr_bill_payment_json($p)]];
    });
    qr_json($status, $response);
}
list($status, $response) = qr_write(function (PDO $pdo) use ($id, $column, $value, $now) {
    $find = $pdo->prepare('SELECT * FROM orders WHERE id = ?');
    $find->execute([$id]);
    $order = $find->fetch();
    $find->closeCursor();
    if (!is_array($order) || !in_array($order['pay_status'], ['paid', 'refunded'], true)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    $net = qr_order_json($order, false)['net'];
    if ($column === 'till_void_at' && $value && ((int) $order['till_at'] === 0 || (int) $order['till_cents'] - (int) $order['till_void_cents'] <= $net)) {
        return [409, ['ok' => false, 'error' => 'not_voidable', 'order' => qr_order_json($order)]];
    }
    $seq = qr_bump_seq($pdo);
    if ($column === 'till_at') {
        $pdo->prepare('UPDATE orders SET till_at = ?, till_cents = ?, till_void_at = 0, till_void_cents = 0, seq = ? WHERE id = ?')
            ->execute([$value ? $now : 0, $value ? $net : 0, $seq, $id]);
    } else {
        $pdo->prepare('UPDATE orders SET till_void_at = ?, till_void_cents = ?, seq = ? WHERE id = ?')
            ->execute([$value ? $now : 0, $value ? (int) $order['till_cents'] - $net : 0, $seq, $id]);
    }
    $find->execute([$id]);
    return [200, ['ok' => true, 'order' => qr_order_json($find->fetch())]];
});
qr_json($status, $response);
