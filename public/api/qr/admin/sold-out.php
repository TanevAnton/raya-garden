<?php
// POST /api/qr/admin/sold-out.php {"itemId": "tiramisu", "soldOut": true} — mark
// a dish sold out tonight, or back. Takes effect at once: the next order with
// it is answered with a "changed" list instead of being placed.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$itemId = $body['itemId'] ?? null;
$soldOut = $body['soldOut'] ?? null;
if (!is_string($itemId) || !isset(qr_menu_index()[$itemId]) || !is_bool($soldOut)) {
    qr_fail(400, 'invalid');
}
$now = qr_now();
$seq = qr_write(function (PDO $pdo) use ($itemId, $soldOut, $now) {
    if ($soldOut) {
        $pdo->prepare('INSERT OR IGNORE INTO sold_out (item_id, since) VALUES (?, ?)')->execute([$itemId, $now]);
    } else {
        $pdo->prepare('DELETE FROM sold_out WHERE item_id = ?')->execute([$itemId]);
    }
    return qr_bump_seq($pdo);
});
qr_json(200, ['ok' => true, 'soldOut' => qr_sold_out(), 'seq' => $seq]);
