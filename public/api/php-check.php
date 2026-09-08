<?php
// Compatibility probe for the wedding-enquiry endpoint.
//
// Written in PHP 5-era syntax on purpose: it has to run on a host where the
// endpoint itself cannot even be parsed, so that it can report why. Reports
// capability only — no credentials, no configuration values, no enquiry data.
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
    $files = array('wedding-enquiry.php', '_lib/quote.php', '_lib/smtp.php');
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
