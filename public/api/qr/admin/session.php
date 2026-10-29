<?php
// GET /api/qr/admin/session.php — is this device signed in, and as whom?
// (The admin page asks on load, to show either the sign-in form or the
// orders.) bootstrap: no manager account yet, so the sign-in form also
// takes the shared password alone.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('GET');
$now = qr_now();
$operator = qr_admin_operator($now);
$bootstrap = qr_staff_bootstrap($now);
qr_json(200, [
    'ok' => true,
    'signedIn' => $operator !== null,
    'configured' => qr_admin_hash() !== '' || !$bootstrap,
    'bootstrap' => $bootstrap,
    'operator' => $operator !== null ? qr_operator_json($operator) : null,
]);
