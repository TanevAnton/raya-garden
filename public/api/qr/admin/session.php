<?php
// GET /api/qr/admin/session.php — is this device signed in? (The admin page asks
// on load, to show either the sign-in form or the orders.)
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('GET');
qr_json(200, ['ok' => true, 'signedIn' => qr_admin_signed_in(qr_now()), 'configured' => qr_admin_hash() !== '']);
