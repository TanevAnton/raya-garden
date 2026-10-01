<?php
// GET /api/qr/bill.php?table=7[&t=<payment token>,…] — the table's bill on a
// "pay at the end" evening: every line ordered for the table tonight, from
// every phone, and what is paid. With payment tokens (this phone's own
// payments), also how each of those went.
//
// Works after ordering has closed — people pay at the end. See _lib/bill.php.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/pay.php';
require __DIR__ . '/_lib/bill.php';

qr_require_method('GET');
$table = isset($_GET['table']) && ctype_digit((string) $_GET['table']) ? (int) $_GET['table'] : 0;
if ($table < 1 || $table > QR_MAX_TABLES) {
    qr_fail(400, 'invalid', ['field' => 'table']);
}
$now = qr_now();
$pdo = qr_db();
$pdo->exec('BEGIN');
try {
    $settings = qr_settings();
    $find = $pdo->prepare('SELECT * FROM tabs WHERE table_no = ? AND evening = ? AND closed_at = 0 ORDER BY id DESC LIMIT 1');
    $find->execute([$table, (string) $settings['service_date']]);
    $tab = $find->fetch();
    $find->closeCursor();
    $bill = is_array($tab) ? qr_tab_json($pdo, $tab, $now, false) : null;
    $payments = [];
    $raw = isset($_GET['t']) ? (string) $_GET['t'] : '';
    $mine = $pdo->prepare('SELECT * FROM bill_payments WHERE token_hash = ?');
    foreach (array_slice(array_unique(array_filter(explode(',', $raw))), 0, 20) as $token) {
        if (!preg_match('/^[0-9a-f]{64}$/', $token)) {
            continue;
        }
        $mine->execute([hash('sha256', $token)]);
        $p = $mine->fetch();
        $mine->closeCursor();
        if (is_array($p)) {
            $json = qr_bill_payment_json($p);
            unset($json['id'], $json['tabId'], $json['seq'], $json['tillAt'], $json['tillVoidAt'], $json['tillCents'], $json['tillVoidCents'],
                $json['net'], $json['refundError'], $json['payerName']);
            $json['token'] = $token;
            $json['payUrl'] = $p['status'] === 'pending' && (int) $p['checkout_expires'] > $now ? (string) $p['checkout_url'] : '';
            $payments[] = $json;
        }
    }
    $pdo->exec('COMMIT');
} catch (Throwable $e) {
    $pdo->exec('ROLLBACK');
    throw $e;
}
qr_json(200, ['ok' => true, 'table' => $table, 'bill' => $bill, 'payments' => $payments, 'now' => $now]);
