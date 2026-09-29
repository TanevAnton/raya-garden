<?php
// GET /api/qr/admin/feed.php?since=<seq> — what changed since the admin screen
// last asked. Every change (an order placed or moved on, a setting, a sold-out
// item) takes the next number in one counter, inside its own write
// transaction; SQLite commits one writer at a time, so the numbers are in
// commit order and "everything after N" can never skip one. since=0 is the
// first load: every open order, and everything from the last two days.
//
// Orders still waiting for (or never given) a phone payment are not staff
// business and are left out. Paid orders still to be entered in the till —
// or voided there after a refund — are always included, however old.
//
// The read is one snapshot (BEGIN … COMMIT), so the counter and the rows
// agree. A screen that was offline for a minute simply asks with its old
// number and gets everything it missed.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/bill.php';

qr_require_method('GET');
qr_require_admin(false);
$since = isset($_GET['since']) ? max(0, (int) $_GET['since']) : 0;
$now = qr_now();
$pdo = qr_db();
$pdo->exec('BEGIN');
try {
    $settings = qr_settings();
    if ($since === 0) {
        $stmt = $pdo->prepare("SELECT * FROM orders
            WHERE status NOT IN ('pending_payment', 'expired')
              AND (created_at > ? OR status IN ('new', 'accepted')
                   OR (pay_status = 'paid' AND till_at = 0)
                   OR (pay_status = 'refunded' AND till_at > 0 AND till_void_at = 0))
            ORDER BY created_at");
        $stmt->execute([$now - 172800]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM orders WHERE seq > ? AND status NOT IN ('pending_payment', 'expired') ORDER BY seq");
        $stmt->execute([$since]);
    }
    $orders = [];
    foreach ($stmt->fetchAll() as $row) {
        $orders[] = qr_order_json($row);
    }
    // Tables' bills ("Сметка накрая"): open ones, and ones closed today;
    // after that, any bill that changed. Payments from bills for the till
    // list: still to enter, to void, or owed a refund, and anything recent.
    if ($since === 0) {
        $stmt = $pdo->prepare('SELECT * FROM tabs WHERE closed_at = 0 OR closed_at > ? ORDER BY table_no');
        $stmt->execute([$now - 43200]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM tabs WHERE seq > ? ORDER BY table_no');
        $stmt->execute([$since]);
    }
    $tabs = [];
    foreach ($stmt->fetchAll() as $tab) {
        $tabs[] = qr_tab_json($pdo, $tab, $now, true);
    }
    if ($since === 0) {
        $stmt = $pdo->prepare("SELECT * FROM bill_payments WHERE status = 'paid'
            AND (paid_at > ? OR till_at = 0 OR refund_due_cents > refunded_cents
                 OR (till_at > 0 AND till_void_at = 0 AND amount_cents - refund_due_cents < till_cents)) ORDER BY paid_at");
        $stmt->execute([$now - 172800]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM bill_payments WHERE status = 'paid' AND seq > ? ORDER BY paid_at");
        $stmt->execute([$since]);
    }
    $billPayments = [];
    foreach ($stmt->fetchAll() as $p) {
        $json = qr_bill_payment_json($p);
        $json['lines'] = array_map(function ($l) {
            return ['qty' => (int) $l['qty'], 'nameBg' => (string) $l['name_bg'], 'detailBg' => (string) $l['detail_bg'], 'code' => (string) $l['code']];
        }, qr_bill_payment_lines($pdo, (int) $p['id']));
        $billPayments[] = $json;
    }
    $soldOut = qr_sold_out();
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    $pdo->exec('ROLLBACK');
    throw $e;
}
qr_json(200, [
    'ok' => true,
    'seq' => (int) $settings['seq'],
    'full' => $since === 0,
    'orders' => $orders,
    'state' => qr_state($settings, $now),
    'soldOut' => $soldOut,
    'tabs' => $tabs,
    'billPayments' => $billPayments,
    'now' => $now,
]);
