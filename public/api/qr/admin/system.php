<?php
// GET /api/qr/admin/system.php — the software and its configuration, read
// only („Система“ on the staff screen; Наредба Н-18, Annex 29 т. 4 and 19):
// the version, the code's integrity against its manifest (?check=1: check
// now), how the evening is set, which features are on, and the fiscal
// settings. Never a secret: keys and passwords show only as set or not.
// For a manager or the auditor.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/pay.php';
require dirname(__DIR__) . '/_lib/integrity.php';

qr_require_method('GET');
qr_require_admin(false, 'manager');
$now = qr_now();
$integrity = qr_integrity_json(qr_integrity_tick($now, ($_GET['check'] ?? '') === '1'));
$config = qr_config();
$fiscal = qr_fiscal_settings();
qr_json(200, [
    'ok' => true,
    'software' => [
        'name' => 'RAYA Garden — QR меню и плащане в телефона',
        'version' => QR_VERSION,
        'schema' => QR_SCHEMA_VERSION,
        'php' => PHP_VERSION,
        'sqlite' => (string) qr_db()->query('SELECT sqlite_version()')->fetchColumn(),
    ],
    'integrity' => $integrity,
    'features' => [
        'registered' => qr_supto_on(),
        'staffOrders' => qr_staff_orders_on(),
        'tips' => qr_tips_on(),
        'stripe' => qr_stripe_configured() ? (qr_stripe_test_mode() ? 'test' : 'live') : 'off',
        'fiscal' => qr_fiscal_mode() !== '' ? qr_fiscal_mode() : 'off',
        'fiscalBridgeKeySet' => qr_fiscal_configured(),
        'clock' => qr_clock_mode() !== '' ? qr_clock_mode() : 'off',
        'sharedPasswordSet' => (string) ($config['admin_password_hash'] ?? '') !== '',
    ],
    'evening' => qr_state(qr_settings(), $now),
    'fiscalSettings' => $fiscal,
]);
