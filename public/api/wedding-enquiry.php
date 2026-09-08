<?php
// Wedding-enquiry endpoint for /svatben-konfigurator.
//
// Accepts the configuration as JSON, validates every field and option id
// against public/api/wedding-offer.json, recalculates the estimate here
// (browser amounts are ignored) and hands the finished summary to a mail
// transport. It answers "ok" only once that transport has accepted the
// message — a refused or unreachable one is reported as a failure so the
// page can keep the guest's selections and let them retry.
//
// Two transports, tried in this order:
//   1. Formspree, the service the site already uses for its contact form.
//      The submission is made from here, server-side, so the figures in the
//      email are the ones this file computed — not whatever a browser posted.
//   2. Authenticated SMTP, if RAYA_SMTP_* / raya-mailer-config.php is set up.
//      This one renders the branded HTML + plain-text mail itself.
//
// The recipient is fixed in this file. Nothing the browser sends can change
// where the enquiry is delivered.
//
// Credentials are never in the repository or the bundle: see
// raya_mailer_config() for the search order and README-wedding-enquiry.md
// for the setup.

declare(strict_types=1);

define('RAYA_ENQUIRY', true);

const RAYA_RECIPIENT = 'hotel@svetagora.bg';
// The wedding form in the site's Formspree account. Not a secret — Formspree
// endpoints are public by design — and the delivery address is set on the form
// itself, in the Formspree dashboard, not here.
const RAYA_FORMSPREE_ENDPOINT = 'https://formspree.io/f/xvkovrvg';
const RAYA_MAX_BODY_BYTES = 64 * 1024;
const RAYA_RATE_LIMIT_PER_HOUR = 5;
const RAYA_DUPLICATE_WINDOW = 600;      // seconds an identical resubmit is folded into the first
const RAYA_MIN_FILL_SECONDS = 3;        // faster than this is a bot, not a couple planning a wedding

require __DIR__ . '/_lib/quote.php';
require __DIR__ . '/_lib/smtp.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function raya_respond(int $status, array $payload)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Minimal, contact-free logging: enough to debug a failure, no personal data. */
function raya_log(string $reference, string $message): void
{
    error_log('[wedding-enquiry] ' . $reference . ' ' . $message);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'GET' && isset($_GET['selftest'])) {
    // Health check: can this host actually run the endpoint and reach the
    // mail transport? Capability only — nothing here reveals credentials,
    // configured values or any enquiry.
    $offerReadable = is_readable(__DIR__ . '/wedding-offer.json');
    $formspree = getenv('RAYA_FORMSPREE_ENDPOINT');
    if (!is_string($formspree) || $formspree === '') {
        $formspree = RAYA_FORMSPREE_ENDPOINT;
    }

    $reach = 'not tested';
    if ($formspree !== '' && function_exists('curl_init')) {
        $ch = curl_init($formspree);
        curl_setopt_array($ch, [
            CURLOPT_NOBODY => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 6,
        ]);
        $reach = curl_exec($ch) === false
            ? 'unreachable: ' . curl_error($ch)
            : 'reachable (HTTP ' . (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . ')';
        curl_close($ch);
    } elseif ($formspree !== '') {
        $reach = ini_get('allow_url_fopen') ? 'no curl; allow_url_fopen on' : 'no curl; allow_url_fopen off';
    }

    raya_respond(200, [
        'ok' => true,
        'selftest' => [
            'php' => PHP_VERSION,
            'curl' => function_exists('curl_init'),
            'allow_url_fopen' => (bool) ini_get('allow_url_fopen'),
            'offer_config_readable' => $offerReadable,
            'transport' => $formspree !== '' ? 'formspree' : 'smtp-or-none',
            'transport_reachable' => $reach,
            'writable_temp' => is_writable(sys_get_temp_dir()),
        ],
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    raya_respond(405, ['ok' => false, 'error' => 'method-not-allowed']);
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '' || strlen($raw) > RAYA_MAX_BODY_BYTES) {
    raya_respond(400, ['ok' => false, 'error' => 'bad-request']);
}
$input = json_decode($raw, true);
if (!is_array($input)) {
    raya_respond(400, ['ok' => false, 'error' => 'bad-json']);
}

// ── Spam guards ──────────────────────────────────────────────────────
// A filled honeypot or an instant submit is answered with the same shape a
// success has, so a bot learns nothing, but nothing is sent.
$honeypotRaw = $input['website'] ?? '';
$honeypot = is_string($honeypotRaw) ? trim($honeypotRaw) : 'bot';
$elapsed = is_numeric($input['elapsedSeconds'] ?? null) ? (float) $input['elapsedSeconds'] : null;
if ($honeypot !== '' || ($elapsed !== null && $elapsed < RAYA_MIN_FILL_SECONDS)) {
    raya_respond(200, ['ok' => true, 'reference' => 'RG-WD-00000000-0000']);
}

// ── Rate limiting and duplicate folding ──────────────────────────────
$stateDir = sys_get_temp_dir() . '/raya-enquiry';
@mkdir($stateDir, 0700, true);
$clientKey = substr(hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|raya'), 0, 32);
$rateFile = $stateDir . '/rate-' . $clientKey . '.json';

$now = time();
$hits = [];
$rateRaw = @file_get_contents($rateFile);
if (is_string($rateRaw)) {
    $decoded = json_decode($rateRaw, true);
    if (is_array($decoded)) {
        $hits = array_values(array_filter(
            $decoded,
            static fn($t) => is_int($t) && $t > $now - 3600
        ));
    }
}
if (count($hits) >= RAYA_RATE_LIMIT_PER_HOUR) {
    raya_respond(429, ['ok' => false, 'error' => 'rate-limited']);
}

try {
    $offer = raya_load_offer();
} catch (Throwable $e) {
    raya_log('-', 'offer config unreadable: ' . $e->getMessage());
    raya_respond(500, ['ok' => false, 'error' => 'server-error']);
}

[$data, $errors] = raya_validate($input, $offer);
if ($errors) {
    raya_respond(422, ['ok' => false, 'error' => 'validation', 'fields' => $errors]);
}

// A double-click (or a retry after a timeout that actually went through)
// must not deliver the enquiry twice: an identical body inside the window
// gets the first submission's reference back.
$fingerprint = hash('sha256', $data['email'] . '|' . $raw);
$dupFile = $stateDir . '/dup-' . substr($fingerprint, 0, 32) . '.json';
$dupRaw = @file_get_contents($dupFile);
if (is_string($dupRaw)) {
    $dup = json_decode($dupRaw, true);
    if (is_array($dup) && ($dup['at'] ?? 0) > $now - RAYA_DUPLICATE_WINDOW) {
        raya_respond(200, [
            'ok' => true,
            'reference' => (string) $dup['reference'],
            'duplicate' => true,
        ]);
    }
}

$quote = raya_build_quote($data, $offer);

$sofia = new DateTimeZone('Europe/Sofia');
$nowLocal = new DateTime('now', $sofia);
$reference = 'RG-WD-' . $nowLocal->format('Ymd') . '-' . strtoupper(bin2hex(random_bytes(2)));
$sentAt = $nowLocal->format('d.m.Y H:i');

$blocks = raya_summary_blocks($data, $offer, $quote, $reference, $sentAt);
$text = raya_render_text($blocks);
$html = raya_render_html($blocks);

// ── Mailer configuration ─────────────────────────────────────────────
/**
 * Looks for credentials outside the deployed folder, because the deploy
 * mirrors dist/ with --delete: anything kept inside the web root that isn't
 * in the build would be removed on the next deploy.
 */
function raya_mailer_config(): array
{
    $fromEnv = [
        'host' => getenv('RAYA_SMTP_HOST') ?: '',
        'port' => (int) (getenv('RAYA_SMTP_PORT') ?: 587),
        'secure' => getenv('RAYA_SMTP_SECURE') ?: 'tls',
        'username' => getenv('RAYA_SMTP_USER') ?: '',
        'password' => getenv('RAYA_SMTP_PASS') ?: '',
        'from_email' => getenv('RAYA_MAIL_FROM') ?: '',
        'from_name' => getenv('RAYA_MAIL_FROM_NAME') ?: 'RAYA Garden',
    ];
    if ($fromEnv['host'] !== '' && $fromEnv['from_email'] !== '') {
        return $fromEnv;
    }

    $candidates = [];
    $explicit = getenv('RAYA_MAILER_CONFIG');
    if (is_string($explicit) && $explicit !== '') {
        $candidates[] = $explicit;
    }
    $docRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
    if ($docRoot !== '') {
        $candidates[] = dirname($docRoot) . '/raya-mailer-config.php';
    }
    $candidates[] = dirname(__DIR__, 3) . '/raya-mailer-config.php';

    foreach ($candidates as $path) {
        if (is_string($path) && $path !== '' && is_readable($path)) {
            $cfg = require $path;
            if (is_array($cfg)) {
                return $cfg + $fromEnv;
            }
        }
    }
    return $fromEnv;
}

// ── Header helpers (used by the SMTP transport) ──────────────────────
/** RFC 2047 for a header that may hold Cyrillic. */
function raya_encode_header(string $value): string
{
    $value = str_replace(["\r", "\n"], ' ', $value);
    return preg_match('/[\x80-\xFF]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;
}

/** A display-name + address pair, with both parts injection-safe. */
function raya_address(string $email, string $name = ''): string
{
    $email = str_replace(["\r", "\n", '<', '>'], '', $email);
    if ($name === '') {
        return $email;
    }
    if (preg_match('/[\x80-\xFF]/', $name)) {
        // An encoded word carries its own delimiters and needs no quoting.
        return raya_encode_header($name) . ' <' . $email . '>';
    }
    // A plain-ASCII display name may hold ':' or '@' (a guest pasting an
    // address into the name field, or someone probing for header injection).
    // Quoting it keeps it one atom for every parser instead of something a
    // lenient reader might treat as structure.
    $quoted = '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $name) . '"';
    return str_replace(["\r", "\n"], ' ', $quoted) . ' <' . $email . '>';
}

/**
 * Posts the enquiry to Formspree from the server.
 *
 * The fields become the body of the email Formspree sends; `summary` carries
 * the complete itemised enquiry exactly as this file computed it. Returns
 * [ok, stage, error] so a failure can be logged with the reason.
 */
function raya_send_via_formspree(string $endpoint, array $fields): array
{
    $body = json_encode($fields, JSON_UNESCAPED_UNICODE);
    $headers = ['Content-Type: application/json', 'Accept: application/json'];

    if (function_exists('curl_init')) {
        $ch = curl_init($endpoint);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_CONNECTTIMEOUT => 10,
        ]);
        $response = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);
        if ($response === false) {
            return ['ok' => false, 'stage' => 'connect', 'error' => $curlError ?: 'request failed'];
        }
    } else {
        // No cURL on the host — the stream wrapper does the same job.
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => implode("\r\n", $headers),
            'content' => $body,
            'timeout' => 20,
            'ignore_errors' => true,
        ]]);
        $response = @file_get_contents($endpoint, false, $context);
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
            }
        }
        if ($response === false) {
            return ['ok' => false, 'stage' => 'connect', 'error' => 'request failed'];
        }
    }

    $decoded = json_decode((string) $response, true);
    // Formspree answers 200 {"ok":true}; anything else means it did not accept
    // the submission, and must never be reported to the guest as sent.
    if ($status === 200 && is_array($decoded) && !empty($decoded['ok'])) {
        return ['ok' => true, 'stage' => 'sent', 'error' => ''];
    }
    $reason = is_array($decoded)
        ? json_encode($decoded['errors'] ?? $decoded, JSON_UNESCAPED_UNICODE)
        : substr((string) $response, 0, 200);
    return ['ok' => false, 'stage' => 'rejected', 'error' => 'HTTP ' . $status . ' ' . $reason];
}

$subjectDate = $data['dateMode'] === 'date'
    ? $data['date']
    : ($data['period'] !== '' ? $data['period'] : 'без избрана дата');
$subject = 'Ново сватбено запитване | ' . $subjectDate . ' | ' . $data['name'];

$formspree = getenv('RAYA_FORMSPREE_ENDPOINT');
if (!is_string($formspree) || $formspree === '') {
    $formspree = RAYA_FORMSPREE_ENDPOINT;
}
$cfg = raya_mailer_config();

if ($formspree !== '') {
    $estimate = $quote['isRange']
        ? raya_money($quote['minTotalCents']) . ' – ' . raya_money($quote['maxTotalCents'])
        : raya_money($quote['maxTotalCents']);

    $result = raya_send_via_formspree($formspree, [
        '_subject' => $subject,
        // Formspree turns this into the Reply-To, so a reply reaches the guest.
        'email' => $data['email'],
        'reference' => $reference,
        'sent_at' => $sentAt . ' (Europe/Sofia)',
        'name' => $data['name'],
        'phone' => $data['phone'],
        'address' => $data['address'],
        'date' => $subjectDate . ($data['time'] !== '' ? ' · ' . $data['time'] : ''),
        'guests' => $data['standardGuests'] . ' стандартно меню + ' . $data['children'] . ' детски',
        'estimate' => $estimate,
        'offer_version' => $offer['version'],
        // The whole enquiry, computed server-side.
        'summary' => $text,
    ]);
    if (!$result['ok']) {
        raya_log($reference, 'formspree send failed at ' . $result['stage'] . ': ' . $result['error']);
        raya_respond(502, ['ok' => false, 'error' => 'send-failed']);
    }
} elseif (!empty($cfg['host']) && !empty($cfg['from_email'])) {
    $boundary = 'rg-' . bin2hex(random_bytes(12));
    $fromEmail = (string) $cfg['from_email'];
    $headers = [
        'Date: ' . $nowLocal->format(DateTime::RFC2822),
        'Message-ID: <' . $reference . '.' . bin2hex(random_bytes(6)) . '@rayagarden.bg>',
        'From: ' . raya_address($fromEmail, (string) ($cfg['from_name'] ?? 'RAYA Garden')),
        'To: ' . RAYA_RECIPIENT,
        // The guest's validated address is the reply target only — never the
        // From, which must stay an address the relay is authorised to send as.
        'Reply-To: ' . raya_address($data['email'], $data['name']),
        'Subject: ' . raya_encode_header($subject),
        'MIME-Version: 1.0',
        'X-Enquiry-Reference: ' . $reference,
        'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
    ];

    $body = "--{$boundary}\r\n"
        . "Content-Type: text/plain; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($text), 76, "\r\n")
        . "--{$boundary}\r\n"
        . "Content-Type: text/html; charset=UTF-8\r\n"
        . "Content-Transfer-Encoding: base64\r\n\r\n"
        . chunk_split(base64_encode($html), 76, "\r\n")
        . "--{$boundary}--\r\n";

    $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;

    $smtp = new Smtp($cfg + ['ehlo' => $_SERVER['SERVER_NAME'] ?? 'rayagarden.bg']);
    $sent = $smtp->send($fromEmail, [RAYA_RECIPIENT], $message);
    if (!$sent->ok) {
        raya_log($reference, 'smtp send failed at ' . $sent->stage . ': ' . $sent->error);
        raya_respond(502, ['ok' => false, 'error' => 'send-failed']);
    }
} else {
    // No transport at all: say so plainly instead of pretending it was sent.
    raya_log($reference, 'no mail transport configured — nothing sent');
    raya_respond(503, ['ok' => false, 'error' => 'mailer-not-configured']);
}

// Only now — the transport accepted the message.
$hits[] = $now;
@file_put_contents($rateFile, json_encode($hits), LOCK_EX);
@file_put_contents($dupFile, json_encode(['at' => $now, 'reference' => $reference]), LOCK_EX);
raya_log($reference, 'accepted by transport');

raya_respond(200, ['ok' => true, 'reference' => $reference]);
