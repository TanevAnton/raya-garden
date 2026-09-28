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
    'now' => $now,
]);
