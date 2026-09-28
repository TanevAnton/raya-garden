<?php
// Admin sign-in for /admin: one staff password, no accounts.
//
// The password's hash lives in raya-qr-config.php above the web root
// ('admin_password_hash', made with `npm run qr:password`). A correct
// password gets a cookie "<expiry>.<signature>": an HMAC, with the server's
// own secret, over the expiry and the current password hash. Nothing is
// stored per session, so there is nothing for the host's session clean-up
// to delete mid-service — and changing the password signs every device out.
//
// Every change also needs an X-Raya-Admin header. A form or link on another
// site cannot add one, and a script on another site cannot either without a
// CORS preflight this API never answers — with SameSite=Strict on the
// cookie, that closes cross-site request forgery.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_ADMIN_COOKIE = 'raya_qr_admin';
const QR_ADMIN_HOURS = 16;          // one long service, then sign in again
const QR_LOGIN_ATTEMPTS = 10;       // wrong passwords per address …
const QR_LOGIN_WINDOW = 900;        // … per 15 minutes

function qr_admin_hash(): string
{
    $config = qr_config();
    return isset($config['admin_password_hash']) ? (string) $config['admin_password_hash'] : '';
}

function qr_admin_signature(int $expires): string
{
    return hash_hmac('sha256', 'admin|' . $expires . '|' . qr_admin_hash(), qr_secret());
}

function qr_is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443');
}

function qr_admin_cookie(string $value, int $expires)
{
    setcookie(QR_ADMIN_COOKIE, $value, [
        'expires' => $expires,
        'path' => '/api/qr/admin',
        'secure' => qr_is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function qr_admin_signed_in(int $now): bool
{
    if (qr_admin_hash() === '') {
        return false;
    }
    $cookie = isset($_COOKIE[QR_ADMIN_COOKIE]) ? (string) $_COOKIE[QR_ADMIN_COOKIE] : '';
    if (!preg_match('/^(\d{1,12})\.([0-9a-f]{64})$/', $cookie, $m)) {
        return false;
    }
    $expires = (int) $m[1];
    return $expires > $now && hash_equals(qr_admin_signature($expires), $m[2]);
}

/**
 * Stop with 401 unless signed in. For anything that changes state, also
 * require the X-Raya-Admin header and, where the browser sends one, an
 * Origin that is this site.
 */
function qr_require_admin(bool $changes)
{
    if (!qr_admin_signed_in(qr_now())) {
        qr_fail(401, 'unauthorized');
    }
    if ($changes) {
        if (!isset($_SERVER['HTTP_X_RAYA_ADMIN']) || $_SERVER['HTTP_X_RAYA_ADMIN'] !== '1') {
            qr_fail(403, 'forbidden');
        }
        if (isset($_SERVER['HTTP_ORIGIN'])) {
            $host = isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : '';
            $origin = parse_url((string) $_SERVER['HTTP_ORIGIN'], PHP_URL_HOST);
            $port = parse_url((string) $_SERVER['HTTP_ORIGIN'], PHP_URL_PORT);
            if ($origin === null || $origin . ($port ? ':' . $port : '') !== $host) {
                qr_fail(403, 'forbidden');
            }
        }
    }
}

/** Sign in, or say why not. */
function qr_admin_login(string $password, int $now): array
{
    $hash = qr_admin_hash();
    if ($hash === '') {
        return [503, ['ok' => false, 'error' => 'not_configured']];
    }
    $ipHash = qr_ip_hash();
    $recent = qr_db()->prepare('SELECT COUNT(*) FROM login_attempts WHERE ip_hash = ? AND at > ?');
    $recent->execute([$ipHash, $now - QR_LOGIN_WINDOW]);
    $failures = (int) $recent->fetchColumn();
    $recent->closeCursor(); // before the write below — see qr_write()
    if ($failures >= QR_LOGIN_ATTEMPTS) {
        return [429, ['ok' => false, 'error' => 'rate_limited', 'retryAfter' => QR_LOGIN_WINDOW]];
    }
    if (!password_verify($password, $hash)) {
        qr_write(function (PDO $pdo) use ($ipHash, $now) {
            $pdo->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$now - QR_LOGIN_WINDOW]);
            $pdo->prepare('INSERT INTO login_attempts (ip_hash, at) VALUES (?, ?)')->execute([$ipHash, $now]);
        });
        return [401, ['ok' => false, 'error' => 'wrong_password']];
    }
    qr_write(function (PDO $pdo) use ($ipHash) {
        $pdo->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);
    });
    $expires = $now + QR_ADMIN_HOURS * 3600;
    qr_admin_cookie($expires . '.' . qr_admin_signature($expires), $expires);
    return [200, ['ok' => true, 'expiresAt' => $expires]];
}
