<?php
// E-mail from the QR system: the monthly summary (_lib/report.php) and the
// guest's e-receipt (_lib/ereceipt.php).
//
// How: SMTP when raya-mailer-config.php or RAYA_SMTP_* are set up (as for
// wedding enquiries), else the host's own mail (PHP mail()). rayagarden.bg's
// mail is on the same server, and its SPF record allows it to send.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_REPORT_FROM = 'no-reply@rayagarden.bg';

/**
 * Send one e-mail: plain text and HTML, with files attached and images the
 * HTML shows inline ($inline: content id => [MIME type, bytes]; the HTML
 * refers to one as src="cid:<content id>"). Returns [ok, error]. Tests
 * (RAYA_QR_TEST=1 with RAYA_QR_MAIL_DIR) get a file instead; a file named
 * FAIL in that folder makes the send fail.
 */
function qr_mail(string $to, string $subject, string $text, string $html, array $files, array $inline = []): array
{
    $smtp = qr_mailer_config();
    $from = $smtp['host'] !== '' && $smtp['from_email'] !== '' ? $smtp['from_email'] : (string) (qr_config()['report_from'] ?? QR_REPORT_FROM);
    $mixed = 'raya-mixed-' . bin2hex(random_bytes(8));
    $alt = 'raya-alt-' . bin2hex(random_bytes(8));
    $related = 'raya-related-' . bin2hex(random_bytes(8));
    $b64 = function (string $s) {
        return rtrim(chunk_split(base64_encode($s), 76, "\r\n"));
    };
    $htmlPart = "Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($html) . "\r\n";
    if ($inline) {
        // The HTML and its pictures travel together (multipart/related).
        $htmlPart = "Content-Type: multipart/related; boundary=\"$related\"\r\n\r\n--$related\r\n" . $htmlPart;
        foreach ($inline as $cid => $image) {
            $htmlPart .= "--$related\r\nContent-Type: {$image[0]}\r\nContent-Transfer-Encoding: base64\r\n"
                . "Content-ID: <$cid>\r\nContent-Disposition: inline\r\n\r\n" . $b64($image[1]) . "\r\n";
        }
        $htmlPart .= "--$related--\r\n";
    }
    $body = "--$mixed\r\nContent-Type: multipart/alternative; boundary=\"$alt\"\r\n\r\n"
        . "--$alt\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($text) . "\r\n"
        . "--$alt\r\n" . $htmlPart
        . "--$alt--\r\n";
    foreach ($files as $name => $content) {
        $body .= "--$mixed\r\nContent-Type: text/csv; charset=UTF-8; name=\"$name\"\r\n"
            . "Content-Disposition: attachment; filename=\"$name\"\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($content) . "\r\n";
    }
    $body .= "--$mixed--\r\n";
    $encodedSubject = mb_encode_mimeheader($subject, 'UTF-8', 'B', "\r\n");
    $headers = implode("\r\n", [
        'From: RAYA Garden <' . $from . '>',
        'Date: ' . (new DateTime('now', new DateTimeZone(QR_TZ)))->format(DATE_RFC2822),
        'Message-ID: <raya-' . bin2hex(random_bytes(8)) . '@rayagarden.bg>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' . $mixed . '"',
    ]);

    $dir = getenv('RAYA_QR_MAIL_DIR');
    if (getenv('RAYA_QR_TEST') === '1' && is_string($dir) && $dir !== '') {
        @mkdir($dir, 0700, true);
        if (file_exists($dir . '/FAIL')) {
            return [false, 'test: the mail server refused'];
        }
        $file = $dir . '/' . sprintf('%.6f', microtime(true)) . '-' . bin2hex(random_bytes(3)) . '.eml';
        file_put_contents($file, "To: $to\r\nSubject: $encodedSubject\r\n$headers\r\n\r\n$body");
        return [true, ''];
    }
    if ($smtp['host'] !== '') {
        if (!defined('RAYA_ENQUIRY')) {
            define('RAYA_ENQUIRY', true); // the SMTP client is shared with wedding enquiries
        }
        require_once dirname(__DIR__, 2) . '/_lib/smtp.php';
        $client = new Smtp($smtp + ['ehlo' => 'rayagarden.bg']);
        $sent = $client->send($from, [$to], "To: $to\r\nSubject: $encodedSubject\r\n$headers\r\n\r\n$body");
        return $sent->ok ? [true, ''] : [false, 'SMTP, ' . $sent->stage . ': ' . $sent->error];
    }
    if (!function_exists('mail')) {
        return [false, 'PHP mail() is disabled on this host'];
    }
    // The bounce address is set with -f where the host allows it; some
    // refuse the option, so it is tried once without.
    $ok = @mail($to, $encodedSubject, $body, $headers, '-f' . $from) || @mail($to, $encodedSubject, $body, $headers);
    if (!$ok) {
        $last = error_get_last();
        return [false, 'mail() refused' . ($last ? ': ' . $last['message'] : '')];
    }
    return [true, ''];
}

/**
 * SMTP settings, from the same places as wedding enquiries
 * (public/api/wedding-enquiry.php): RAYA_SMTP_* or raya-mailer-config.php
 * above the web root. host '' when there are none.
 */
function qr_mailer_config(): array
{
    $cfg = [
        'host' => (string) (getenv('RAYA_SMTP_HOST') ?: ''),
        'port' => (int) (getenv('RAYA_SMTP_PORT') ?: 587),
        'secure' => (string) (getenv('RAYA_SMTP_SECURE') ?: 'tls'),
        'username' => (string) (getenv('RAYA_SMTP_USER') ?: ''),
        'password' => (string) (getenv('RAYA_SMTP_PASS') ?: ''),
        'from_email' => (string) (getenv('RAYA_MAIL_FROM') ?: ''),
    ];
    if ($cfg['host'] !== '') {
        return $cfg;
    }
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : '';
    $path = ($docRoot !== '' ? dirname($docRoot) : dirname(__DIR__, 4)) . '/raya-mailer-config.php';
    if (getenv('RAYA_QR_TEST') !== '1' && is_readable($path)) {
        $loaded = require $path;
        if (is_array($loaded)) {
            foreach ($cfg as $key => $value) {
                $cfg[$key] = isset($loaded[$key]) ? (is_int($value) ? (int) $loaded[$key] : (string) $loaded[$key]) : $value;
            }
        }
    }
    return $cfg;
}
