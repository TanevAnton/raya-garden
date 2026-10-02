<?php
// /api/qr/admin/report.php — the monthly summary by e-mail (_lib/report.php),
// from История on the staff screen.
//
//   GET                         where it goes, and the last attempts to send
//   POST {"email": "a@b.bg"}    send it there from now on ("" stops it)
//   POST {"send": "2026-09"}    send that month's summary now (a month not
//                               yet over: as far as it has got). 409 no_email
//                               without an address, 409 empty for a month
//                               without orders, 502 if the mail was refused.
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';
require dirname(__DIR__) . '/_lib/bill.php';
require dirname(__DIR__) . '/_lib/history.php';
require dirname(__DIR__) . '/_lib/report.php';

const QR_MAX_EMAIL = 120;

function qr_report_state(): array
{
    return ['ok' => true, 'email' => (string) (qr_settings()['report_email'] ?? ''), 'mails' => qr_report_log(qr_db())];
}

$method = $_SERVER['REQUEST_METHOD'] ?? '';
if ($method === 'GET') {
    qr_require_admin(false);
    qr_json(200, qr_report_state());
}
qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$now = qr_now();

if (array_key_exists('email', $body)) {
    $email = $body['email'];
    if (!is_string($email)) {
        qr_fail(400, 'invalid', ['field' => 'email']);
    }
    $email = trim($email);
    if ($email !== '' && (strlen($email) > QR_MAX_EMAIL || filter_var($email, FILTER_VALIDATE_EMAIL) === false)) {
        qr_fail(400, 'invalid', ['field' => 'email']);
    }
    qr_write(function (PDO $pdo) use ($email) {
        $pdo->prepare('UPDATE settings SET report_email = ? WHERE id = 1')->execute([$email]);
    });
    qr_json(200, qr_report_state());
}

$month = $body['send'] ?? null;
if (!is_string($month) || !qr_is_month($month)) {
    qr_fail(400, 'invalid', ['field' => 'send']);
}
$thisMonth = (new DateTime('@' . $now))->setTimezone(new DateTimeZone(QR_TZ))->format('Y-m');
if ($month > $thisMonth) {
    qr_fail(400, 'invalid', ['field' => 'send']);
}
$email = (string) (qr_settings()['report_email'] ?? '');
if ($email === '') {
    qr_fail(409, 'no_email');
}
list($status, $error) = qr_report_run($month, $email, true, $now);
if ($status === 'rate_limited') {
    qr_fail(429, 'rate_limited', ['retryAfter' => 3600]);
}
if ($status === 'empty') {
    qr_json(409, ['ok' => false, 'error' => 'empty'] + qr_report_state());
}
if ($status !== 'sent') {
    qr_json(502, ['ok' => false, 'error' => 'send_failed', 'detail' => $error] + qr_report_state());
}
qr_json(200, qr_report_state());
