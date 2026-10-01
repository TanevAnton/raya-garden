<?php
// GET /api/qr/order-status.php?t=<token>[,<token>…] — a guest's own orders.
//
// A token is 256 bits, handed out once when the order is placed and kept in
// that phone's session storage. Only its SHA-256 is stored, so the database
// alone cannot be used to read anyone's order either. Unknown tokens are
// simply absent from the answer: nothing distinguishes "wrong" from "never
// existed", and the short order codes are never accepted here.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';

qr_require_method('GET');
$raw = isset($_GET['t']) ? (string) $_GET['t'] : '';
$tokens = array_slice(array_unique(array_filter(explode(',', $raw))), 0, 20);
$orders = [];
$find = qr_db()->prepare('SELECT * FROM orders WHERE token_hash = ?');
foreach ($tokens as $token) {
    if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
        continue;
    }
    $find->execute([hash('sha256', $token)]);
    $row = $find->fetch();
    if (is_array($row)) {
        $order = qr_order_json($row);
        unset($order['seq'], $order['id'], $order['tillAt'], $order['tillVoidAt'], $order['payerName']);
        $order['token'] = $token;
        // Still waiting for the phone payment: where to finish it.
        $order['payUrl'] = $row['status'] === 'pending_payment' && (int) $row['checkout_expires'] > qr_now()
            ? (string) $row['checkout_url'] : '';
        $orders[] = $order;
    }
}
qr_json(200, ['ok' => true, 'orders' => $orders, 'now' => qr_now()]);
