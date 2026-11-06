<?php
// Meta Conversions API: the server-side copy of a room booking's Purchase.
//
// The browser fires Purchase with the pixel when Clock reports a confirmed
// booking (index.html, rayaClockPurchase) and posts the same event here with
// the same event_id, clock-<booking numbers>. Meta keeps one of the two:
// that is what the matching event_id is for. This copy still arrives when an
// ad blocker or a browser's tracking protection stopped the pixel's.
//
// Only Purchase, only with a booking number in the event_id, and each
// event_id once (kept 30 days). The browser cannot see Clock's database, so
// what it posts is checked for shape, not for truth: a value is capped, the
// ids must look like Clock's, and one address may post a few per hour. See
// README-tracking.md, "Conversions API".
//
// The access token is never in the repository or the bundle: it is
// 'meta_capi_token' in raya-qr-config.php, one folder above the web root,
// written by the deploy from the META_CAPI_TOKEN secret
// (scripts/qr-server-config.mjs). Without it this answers ok:false and sends
// nothing.
//
// ⚠ The production host runs PHP 7.3 (FPM): no arrow functions, typed
//   properties, `?->` or str_contains(). /api/php-check.php re-parses this
//   file there.

declare(strict_types=1);

const RAYA_CAPI_PIXEL_ID = '2833505250333119';
const RAYA_CAPI_GRAPH_VERSION = 'v23.0';
const RAYA_CAPI_MAX_BODY = 8 * 1024;
const RAYA_CAPI_PER_HOUR = 10;
const RAYA_CAPI_KEEP_SECONDS = 30 * 86400;
const RAYA_CAPI_MAX_VALUE = 100000;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function raya_capi_respond(int $status, array $payload)
{
    http_response_code($status);
    echo json_encode($payload);
    exit;
}

/** raya-qr-config.php, looked for where the QR system looks (qr/_lib/core.php). */
function raya_capi_config(): array
{
    $candidates = [];
    $explicit = getenv('RAYA_QR_CONFIG');
    if (is_string($explicit) && $explicit !== '') {
        $candidates[] = $explicit;
    }
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : '';
    if ($docRoot !== '') {
        $candidates[] = dirname($docRoot) . '/raya-qr-config.php';
    }
    // This file is <web root>/api/meta-capi.php: two levels up is the
    // folder that holds the web root.
    $candidates[] = dirname(__DIR__, 2) . '/raya-qr-config.php';
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $loaded = include $path;
            return is_array($loaded) ? $loaded : [];
        }
    }
    return [];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    raya_capi_respond(405, ['ok' => false, 'error' => 'method']);
}

// Only from the site's own pages. A browser always sends Origin on a
// cross-site POST; a missing one is a same-origin request or not a browser.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && !preg_match('#^https://(www\.)?rayagarden\.bg$#', $origin)) {
    raya_capi_respond(403, ['ok' => false, 'error' => 'origin']);
}

$raw = (string) file_get_contents('php://input', false, null, 0, RAYA_CAPI_MAX_BODY + 1);
if (strlen($raw) > RAYA_CAPI_MAX_BODY) {
    raya_capi_respond(413, ['ok' => false, 'error' => 'too-large']);
}
$in = json_decode($raw, true);
if (!is_array($in)) {
    raya_capi_respond(400, ['ok' => false, 'error' => 'bad-json']);
}

// ── what the browser sent, checked ───────────────────────────────────
$eventId = is_string($in['event_id'] ?? null) ? $in['event_id'] : '';
$value = $in['value'] ?? null;
$currency = is_string($in['currency'] ?? null) ? $in['currency'] : 'EUR';
$ids = is_array($in['content_ids'] ?? null) ? array_values($in['content_ids']) : [];

if (($in['event_name'] ?? '') !== 'Purchase'
    || !preg_match('/^clock-[A-Za-z0-9_.-]{1,300}$/', $eventId)
    || strpos($eventId, 'clock-checkout-') === 0
    || !(is_int($value) || is_float($value)) || $value <= 0 || $value > RAYA_CAPI_MAX_VALUE
    || !preg_match('/^[A-Z]{3}$/', $currency)
    || count($ids) < 1 || count($ids) > 10
) {
    raya_capi_respond(422, ['ok' => false, 'error' => 'invalid']);
}
foreach ($ids as $id) {
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9_.-]{1,40}$/', $id)) {
        raya_capi_respond(422, ['ok' => false, 'error' => 'invalid']);
    }
}
// The event_id is clock-<the same booking numbers>, so the two cannot disagree.
if ($eventId !== 'clock-' . implode('-', $ids)) {
    raya_capi_respond(422, ['ok' => false, 'error' => 'invalid']);
}

$custom = [
    'value' => round((float) $value, 2),
    'currency' => $currency,
    'content_type' => 'hotel_room',
    'content_ids' => $ids,
    'order_id' => implode('-', $ids),
];
$numItems = $in['num_items'] ?? null;
if (is_int($numItems) && $numItems >= 1 && $numItems <= 50) {
    $custom['num_items'] = $numItems;
}
foreach (['checkin_date', 'checkout_date'] as $key) {
    $d = $in[$key] ?? null;
    if (is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) {
        $custom[$key] = $d;
    }
}
$sourceUrl = is_string($in['event_source_url'] ?? null) ? $in['event_source_url'] : '';
if (!preg_match('#^https://(www\.)?rayagarden\.bg(/[^\s]*)?$#', $sourceUrl) || strlen($sourceUrl) > 500) {
    $sourceUrl = 'https://rayagarden.bg/book';
}
$testCode = is_string($in['test_event_code'] ?? null) ? $in['test_event_code'] : '';
if (!preg_match('/^TEST[A-Za-z0-9]{1,20}$/', $testCode)) {
    $testCode = '';
}

$token = (string) (raya_capi_config()['meta_capi_token'] ?? '');
if ($token === '') {
    raya_capi_respond(200, ['ok' => false, 'error' => 'not-configured']);
}

// ── once per event_id, and a few per address per hour ────────────────
$stateDir = sys_get_temp_dir() . '/raya-capi';
@mkdir($stateDir, 0700, true);
$now = time();
$sentFile = $stateDir . '/sent-' . hash('sha256', $eventId) . '.txt';
$sentAt = @filemtime($sentFile);
if ($sentAt !== false && $sentAt > $now - RAYA_CAPI_KEEP_SECONDS && $testCode === '') {
    raya_capi_respond(200, ['ok' => true, 'duplicate' => true]);
}
$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$rateFile = $stateDir . '/rate-' . substr(hash('sha256', $ip . '|raya-capi'), 0, 32) . '.json';
$hits = json_decode((string) @file_get_contents($rateFile), true);
$recent = [];
foreach (is_array($hits) ? $hits : [] as $t) {
    if (is_int($t) && $t > $now - 3600) {
        $recent[] = $t;
    }
}
if (count($recent) >= RAYA_CAPI_PER_HOUR) {
    raya_capi_respond(429, ['ok' => false, 'error' => 'rate-limited']);
}
$recent[] = $now;
@file_put_contents($rateFile, json_encode($recent), LOCK_EX);

// ── to Meta ──────────────────────────────────────────────────────────
$user = ['client_ip_address' => $ip, 'client_user_agent' => (string) ($_SERVER['HTTP_USER_AGENT'] ?? '')];
// The pixel's own cookies, first-party on this domain, so they arrive here.
foreach (['_fbp' => 'fbp', '_fbc' => 'fbc'] as $cookie => $key) {
    $c = $_COOKIE[$cookie] ?? '';
    if (is_string($c) && preg_match('/^fb\.\d\.\d+\.[A-Za-z0-9_.-]{1,200}$/', $c)) {
        $user[$key] = $c;
    }
}
$body = [
    'data' => [[
        'event_name' => 'Purchase',
        'event_time' => $now,
        'event_id' => $eventId,
        'action_source' => 'website',
        'event_source_url' => $sourceUrl,
        'user_data' => $user,
        'custom_data' => $custom,
    ]],
    'access_token' => $token,
];
if ($testCode !== '') {
    $body['test_event_code'] = $testCode;
}

$endpoint = 'https://graph.facebook.com/' . RAYA_CAPI_GRAPH_VERSION . '/' . RAYA_CAPI_PIXEL_ID . '/events';
$json = json_encode($body);
$status = 0;
$response = false;
if (function_exists('curl_init')) {
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $json,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
} else {
    $context = stream_context_create(['http' => [
        'method' => 'POST',
        'header' => 'Content-Type: application/json',
        'content' => $json,
        'timeout' => 10,
        'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($endpoint, false, $context);
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
            $status = (int) $m[1];
        }
    }
}

$decoded = json_decode((string) $response, true);
if ($status === 200 && is_array($decoded) && (int) ($decoded['events_received'] ?? 0) === 1) {
    if ($testCode === '') {
        @touch($sentFile);
    }
    raya_capi_respond(200, ['ok' => true]);
}
// Meta's error message, never the token (it is not in a response).
$error = is_array($decoded) && isset($decoded['error']['message']) ? (string) $decoded['error']['message'] : 'no answer';
error_log('[meta-capi] ' . $status . ' ' . substr($error, 0, 200));
raya_capi_respond(502, ['ok' => false, 'error' => 'meta', 'status' => $status]);
