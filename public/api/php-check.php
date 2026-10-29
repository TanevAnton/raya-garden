<?php
// Compatibility probe for the wedding-enquiry endpoint and the QR ordering
// API (/api/qr/).
//
// Written in PHP 5-era syntax on purpose: it has to run on a host where the
// endpoints themselves cannot even be parsed, so that it can report why.
// Reports capability only — no credentials, no configuration values, no
// paths, no enquiry or order data.
//
// Open /api/php-check.php in a browser. Safe to leave in place; safe to delete.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$here = dirname(__FILE__);

$out = array(
    'php' => PHP_VERSION,
    'sapi' => PHP_SAPI,
    'extensions' => array(
        'curl' => function_exists('curl_init'),
        'openssl' => extension_loaded('openssl'),
        'mbstring' => function_exists('mb_substr'),
        'json' => function_exists('json_encode'),
        // The e-receipt's QR code is a PNG; without zlib it is stored uncompressed.
        'zlib' => function_exists('gzcompress'),
    ),
    'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
    'offer_config_readable' => is_readable($here . '/wedding-offer.json'),
    'temp_writable' => is_writable(sys_get_temp_dir()),
);

// Does this PHP accept the endpoint's own syntax? TOKEN_PARSE raises on a
// syntax error — which is exactly what a 500 from the endpoint looks like
// from the outside.
$out['parses'] = array();
if (version_compare(PHP_VERSION, '7.0', '>=') && defined('TOKEN_PARSE')) {
    $files = array(
        'wedding-enquiry.php', '_lib/quote.php', '_lib/smtp.php',
        'qr/_lib/core.php', 'qr/_lib/order.php', 'qr/_lib/auth.php', 'qr/_lib/pay.php',
        'qr/_lib/bill.php', 'qr/_lib/history.php', 'qr/_lib/report.php', 'qr/_lib/mail.php',
        'qr/_lib/ereceipt.php', 'qr/_lib/qrcode.php', 'qr/_lib/ereceipt-settings.php',
        'qr/_lib/clock.php', 'qr/_lib/clock-settings.php', 'qr/admin/clock.php',
        'qr/_lib/fiscal.php', 'qr/_lib/fiscal-settings.php', 'qr/fiscal/claim.php', 'qr/fiscal/report.php', 'qr/admin/fiscal.php',
        'qr/_lib/staff.php', 'qr/_lib/nap.php', 'qr/_lib/integrity.php', 'qr/admin/staff.php', 'qr/admin/audit.php',
        'qr/admin/nap.php', 'qr/admin/system.php',
        'qr/order.php', 'qr/stripe-webhook.php', 'qr/receipt.php',
    );
    foreach ($files as $rel) {
        $path = $here . '/' . $rel;
        if (!is_readable($path)) {
            $out['parses'][$rel] = 'missing';
            continue;
        }
        try {
            token_get_all(file_get_contents($path), TOKEN_PARSE);
            $out['parses'][$rel] = 'ok';
        } catch (Error $e) {
            $out['parses'][$rel] = 'SYNTAX ERROR: ' . $e->getMessage();
        } catch (Exception $e) {
            $out['parses'][$rel] = 'SYNTAX ERROR: ' . $e->getMessage();
        }
    }
} else {
    $out['parses'] = 'PHP is older than 7.0 — the endpoint needs 7.0 or newer';
}

// QR ordering: can PHP keep the orders, and is the staff password in place?
// The same places qr/_lib/core.php looks: the folder that holds the web root.
$above = dirname(dirname($here));
if (!empty($_SERVER['DOCUMENT_ROOT'])) {
    $above = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/'));
}
$qrConfig = array();
if (is_readable($above . '/raya-qr-config.php')) {
    $loaded = include $above . '/raya-qr-config.php';
    $qrConfig = is_array($loaded) ? $loaded : array();
}
$dataDir = !empty($qrConfig['data_dir']) ? rtrim($qrConfig['data_dir'], '/') : $above . '/raya-qr-data';
$sqlite = 'no pdo_sqlite';
if (class_exists('PDO') && in_array('sqlite', PDO::getAvailableDrivers(), true)) {
    try {
        $db = new PDO('sqlite::memory:');
        $sqlite = 'yes (SQLite ' . $db->query('select sqlite_version()')->fetchColumn() . ')';
    } catch (Exception $e) {
        $sqlite = 'NO: ' . $e->getMessage();
    }
}
$out['qr'] = array(
    'pdo_sqlite' => $sqlite,
    'menu_readable' => is_readable($here . '/qr-menu.json'),
    'config_found' => is_readable($above . '/raya-qr-config.php'),
    'admin_password_set' => !empty($qrConfig['admin_password_hash']),
    // Created by the first order or staff sign-in if it does not exist yet.
    'data_folder' => is_dir($dataDir)
        ? (is_writable($dataDir) ? 'exists, writable' : 'exists, NOT writable')
        : (is_writable(dirname($dataDir)) ? 'not created yet, can be' : 'NOT creatable'),
    // Paying on the phone: which kind of key is set — never the key itself.
    'stripe_key' => empty($qrConfig['stripe_secret_key']) ? 'not set'
        : (preg_match('/^([rs]k)_(test|live)_/', $qrConfig['stripe_secret_key'], $m)
            ? ($m[2] === 'test' ? 'TEST ' : 'LIVE ') . ($m[1] === 'rk' ? 'restricted key' : 'full secret key — use a restricted one')
            : 'not a Stripe key'),
    'stripe_webhook_secret_set' => !empty($qrConfig['stripe_webhook_secret']),
    'curl_reaches_stripe' => 'not tested',
    // Payments sent to Clock PMS+ (qr/_lib/clock.php): whether it is on and
    // set up — never the user, key or ids themselves.
    'clock_mode' => isset($qrConfig['clock_mode']) && in_array($qrConfig['clock_mode'], array('test', 'live'), true)
        ? $qrConfig['clock_mode'] : 'off',
    'clock_configured' => !empty($qrConfig['clock_base_url']) && !empty($qrConfig['clock_api_user'])
        && !empty($qrConfig['clock_api_key']) && !empty($qrConfig['clock_company_id']),
    'clock_templates' => 'unknown',
    'curl_digest' => defined('CURLAUTH_DIGEST'),
    'curl_reaches_clock' => 'not tested',
    // Fiscal receipts printed by the bridge in the restaurant (qr/_lib/fiscal.php).
    'fiscal_mode' => isset($qrConfig['fiscal_mode']) && in_array($qrConfig['fiscal_mode'], array('test', 'live'), true)
        ? $qrConfig['fiscal_mode'] : 'off',
    'fiscal_bridge_key_set' => isset($qrConfig['fiscal_bridge_token']) && strlen($qrConfig['fiscal_bridge_token']) >= 32,
    // The monthly summary e-mail: SMTP when raya-mailer-config.php has a
    // host, else the host's own mail().
    'report_mail' => is_readable($above . '/raya-mailer-config.php') ? 'SMTP config found (raya-mailer-config.php)'
        : (function_exists('mail') && !in_array('mail', array_map('trim', explode(',', (string) ini_get('disable_functions'))), true)
            ? 'PHP mail() available' . (ini_get('sendmail_path') ? '' : ' (no sendmail_path)')
            : 'PHP mail() DISABLED'),
    // The guest's e-receipt (qr/_lib/ereceipt.php): 'test' issues them only
    // with Stripe's test keys, 'live' with live keys too, 'off' never.
    'ereceipt_mode' => 'unknown',
);
if (!defined('RAYA_QR')) {
    define('RAYA_QR', true); // the settings file is a library file
}
$ereceipt = is_readable($here . '/qr/_lib/ereceipt-settings.php') ? include $here . '/qr/_lib/ereceipt-settings.php' : null;
if (is_array($ereceipt)) {
    $out['qr']['ereceipt_mode'] = (isset($ereceipt['mode']) ? $ereceipt['mode'] : 'off')
        . (empty($ereceipt['eshop_number']) ? ', no NAP e-shop number yet' : ', NAP e-shop number set');
}
$clockSettings = is_readable($here . '/qr/_lib/clock-settings.php') ? include $here . '/qr/_lib/clock-settings.php' : null;
if (is_array($clockSettings) && isset($clockSettings['templates']) && is_array($clockSettings['templates'])) {
    $set = array();
    foreach ($clockSettings['templates'] as $name => $id) {
        if ((int) $id > 0) {
            $set[] = $name;
        }
    }
    $out['qr']['clock_templates'] = $set ? 'set for: ' . implode(', ', $set) : 'NONE set: payments are not sent (clock-settings.php)';
}
if (function_exists('curl_init') && !empty($qrConfig['clock_base_url'])
    && preg_match('#^https://[a-z0-9-]+\.clock-software\.com/#', $qrConfig['clock_base_url'], $m)) {
    // Connection only: no user or key is sent, so Clock answers 401.
    $ch = curl_init($m[0] . 'base_api/');
    curl_setopt($ch, CURLOPT_NOBODY, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
    $ok = curl_exec($ch);
    $out['qr']['curl_reaches_clock'] = ($ok === false)
        ? 'NO: ' . curl_error($ch)
        : 'yes (HTTP ' . (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) . ')';
    curl_close($ch);
}
if (function_exists('curl_init') && !empty($qrConfig['stripe_secret_key'])) {
    // Connection only: no key is sent, so Stripe answers 401.
    $ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
    curl_setopt($ch, CURLOPT_NOBODY, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
    $ok = curl_exec($ch);
    $out['qr']['curl_reaches_stripe'] = ($ok === false)
        ? 'NO: ' . curl_error($ch)
        : 'yes (HTTP ' . (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) . ')';
    curl_close($ch);
}

// Can this host reach Formspree at all? Connection only; nothing is submitted.
$out['formspree_reachable'] = 'not tested';
if (function_exists('curl_init')) {
    $ch = curl_init('https://formspree.io/');
    curl_setopt($ch, CURLOPT_NOBODY, true);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
    $ok = curl_exec($ch);
    $out['formspree_reachable'] = ($ok === false)
        ? 'NO: ' . curl_error($ch)
        : 'yes (HTTP ' . (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) . ')';
    curl_close($ch);
}

echo json_encode($out);
