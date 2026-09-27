<?php
// POST /api/qr/admin/logout.php — sign this device out.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('POST');
qr_admin_cookie('', 1);
qr_json(200, ['ok' => true]);
