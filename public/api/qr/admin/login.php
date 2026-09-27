<?php
// POST /api/qr/admin/login.php {"password": "…"} — sign in. Ten wrong
// passwords from one address in 15 minutes and it stops listening for a while.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('POST');
$body = qr_body();
$password = isset($body['password']) && is_string($body['password']) ? $body['password'] : '';
if ($password === '' || strlen($password) > 200) {
    qr_fail(400, 'invalid', ['field' => 'password']);
}
list($status, $response) = qr_admin_login($password, qr_now());
qr_json($status, $response);
