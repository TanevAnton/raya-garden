<?php
// /api/qr/admin/staff.php — the staff accounts („Персонал“, _lib/staff.php).
//
//   GET          the accounts and their roles (a manager or the auditor)
//   POST {action: "create" | "rename" | "password" | "active" | "addRole" | "endRole", …}
//                one change, by a manager; answers with the new list
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/staff.php';

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'GET') {
    qr_require_admin(false, 'manager');
    qr_json(200, ['ok' => true, 'staff' => qr_staff_list(qr_db())]);
}
qr_require_method('POST');
qr_require_admin(true, 'manager');
$body = qr_body();
$now = qr_now();
try {
    $done = qr_write(function (PDO $pdo) use ($body, $now) {
        return qr_staff_change($pdo, $body, $now);
    });
} catch (QrStaffError $e) {
    qr_fail($e->status, $e->error, $e->field !== '' ? ['field' => $e->field] : []);
}
qr_json(200, ['ok' => true, 'done' => $done, 'staff' => qr_staff_list(qr_db())]);
