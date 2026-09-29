<?php
// POST /api/qr/admin/bill.php — the "Сметки" screen's actions on a table's
// bill (see ../_lib/bill.php):
//
//   {"action": "settle", "tabId": 5}     everything still unpaid was paid on
//        the spot (cash or card terminal) — marks those lines "staff"
//   {"action": "close", "tabId": 5}      done with this bill; the table's next
//        order starts a new one. Refused while anything is unpaid (409 unpaid).
//   {"action": "refund", "paymentId": 9} retry money owed back to a payer
//        (paid twice in a race, or cancelled after payment) — 502 if Stripe
//        still refuses
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
$action = $body['action'] ?? null;
$now = qr_now();

if ($action === 'refund') {
    $paymentId = $body['paymentId'] ?? null;
    if (!is_int($paymentId)) {
        qr_fail(400, 'invalid');
    }
    $ok = qr_bill_refund_due($paymentId);
    $find = qr_db()->prepare('SELECT * FROM bill_payments WHERE id = ?');
    $find->execute([$paymentId]);
    $p = $find->fetch();
    $find->closeCursor();
    if (!is_array($p)) {
        qr_fail(404, 'not_found');
    }
    qr_json($ok ? 200 : 502, ['ok' => $ok] + ($ok ? [] : ['error' => 'refund_failed']) + ['payment' => qr_bill_payment_json($p)]);
}

$tabId = $body['tabId'] ?? null;
if (!is_int($tabId) || !in_array($action, ['settle', 'close'], true)) {
    qr_fail(400, 'invalid');
}
list($status, $response) = qr_write(function (PDO $pdo) use ($tabId, $action, $now) {
    $find = $pdo->prepare('SELECT * FROM tabs WHERE id = ?');
    $find->execute([$tabId]);
    $tab = $find->fetch();
    $find->closeCursor();
    if (!is_array($tab)) {
        return [404, ['ok' => false, 'error' => 'not_found']];
    }
    if ((int) $tab['closed_at'] > 0) {
        return [409, ['ok' => false, 'error' => 'closed', 'tab' => qr_tab_json($pdo, $tab, $now, true)]];
    }
    $unpaid = 0;
    foreach (qr_tab_lines($pdo, $tabId, $now) as $l) {
        $unpaid += in_array($l['state'], ['unpaid', 'pending'], true) ? $l['amount'] : 0;
    }
    $seq = qr_bump_seq($pdo);
    if ($action === 'settle') {
        $pdo->prepare("UPDATE order_items SET paid_via = 'staff'
            WHERE paid_via = '' AND order_id IN (SELECT id FROM orders WHERE tab_id = ? AND status IN ('new', 'accepted', 'served'))")
            ->execute([$tabId]);
        $pdo->prepare("UPDATE orders SET seq = ? WHERE tab_id = ? AND status IN ('new', 'accepted', 'served')")->execute([$seq, $tabId]);
    } else {
        if ($unpaid > 0) {
            return [409, ['ok' => false, 'error' => 'unpaid', 'unpaid' => $unpaid, 'tab' => qr_tab_json($pdo, $tab, $now, true)]];
        }
        $pdo->prepare('UPDATE tabs SET closed_at = ? WHERE id = ?')->execute([$now, $tabId]);
    }
    qr_touch_tab($pdo, $tabId, $seq);
    $find->execute([$tabId]);
    $tab = $find->fetch();
    $find->closeCursor();
    return [200, ['ok' => true, 'tab' => qr_tab_json($pdo, $tab, $now, true)]];
});
qr_json($status, $response);
