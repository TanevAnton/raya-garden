<?php
// POST /api/qr/admin/login.php {"code": "0007", "password": "…"} — sign in
// with a personal account. Without a code, the shared password — only until
// the first manager account exists (see ../_lib/auth.php). Ten wrong
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
$code = isset($body['code']) && is_string($body['code']) ? trim($body['code']) : '';
if (strlen($code) > 10) {
    qr_fail(400, 'invalid', ['field' => 'code']);
}
list($status, $response) = qr_admin_login($code, $password, qr_now());
qr_json($status, $response);
