<?php
// Staff sign-in for /admin: a personal account for each person.
//
// Each person signs in with their code (4 digits) and their own password
// (Наредба Н-18, Annex 29 т. 6–7). What they may do comes from their roles,
// each held for a period (staff_roles):
//   waiter   the service: orders, bills, „За касата“, sold-out, waiters,
//            history, the fiscal printer's reports
//   manager  also the evening's set-up (Вечерта) and the staff accounts
//   auditor  reads everything, changes nothing (for НАП's inspectors)
//
// The shared password ('admin_password_hash' in raya-qr-config.php, made
// with `npm run qr:password`) only lets someone in until the first manager
// account exists, to make it; after that it is refused, and so are the
// sessions it gave.
//
// A correct sign-in gets a cookie "<staff id>.<expiry>.<signature>": an
// HMAC, with the server's own secret, over the id, the expiry and the
// person's password hash (staff id 0: the shared password's). Nothing is
// stored per session, so there is nothing for the host's session clean-up
// to delete mid-service — and changing a password signs that person out
// everywhere. Whether the person is still active and still holds a role is
// checked on every request.
//
// Every change also needs an X-Raya-Admin header. A form or link on another
// site cannot add one, and a script on another site cannot either without a
// CORS preflight this API never answers — with SameSite=Strict on the
// cookie, that closes cross-site request forgery.
//
// Signing in, failing to, and signing out go in audit_log, with the person.
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
const QR_ROLES = ['waiter', 'manager', 'auditor'];

function qr_admin_hash(): string
{
    $config = qr_config();
    return isset($config['admin_password_hash']) ? (string) $config['admin_password_hash'] : '';
}

function qr_admin_signature(int $staffId, int $expires, string $passHash): string
{
    return hash_hmac('sha256', 'staff|' . $staffId . '|' . $expires . '|' . $passHash, qr_secret());
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

/** Anyone holding the manager role now: until then, the shared password works. */
function qr_staff_bootstrap(int $now): bool
{
    $find = qr_db()->prepare("SELECT COUNT(*) FROM staff_roles r JOIN staff s ON s.id = r.staff_id
        WHERE s.active = 1 AND r.role = 'manager' AND r.from_at <= ? AND (r.to_at = 0 OR r.to_at > ?)");
    $find->execute([$now, $now]);
    $managers = (int) $find->fetchColumn();
    $find->closeCursor();
    return $managers === 0;
}

/** The roles a person holds at $now. */
function qr_staff_roles(int $staffId, int $now): array
{
    $find = qr_db()->prepare('SELECT DISTINCT role FROM staff_roles WHERE staff_id = ? AND from_at <= ? AND (to_at = 0 OR to_at > ?) ORDER BY role');
    $find->execute([$staffId, $now, $now]);
    $roles = $find->fetchAll(PDO::FETCH_COLUMN);
    $find->closeCursor();
    return array_values(array_intersect(QR_ROLES, $roles));
}

function qr_staff_find(string $column, $value)
{
    $find = qr_db()->prepare("SELECT * FROM staff WHERE $column = ?");
    $find->execute([$value]);
    $row = $find->fetch();
    $find->closeCursor();
    return is_array($row) ? $row : null;
}

function qr_staff_name(array $staff): string
{
    return trim(preg_replace('/\s+/u', ' ', $staff['first_name'] . ' ' . $staff['middle_name'] . ' ' . $staff['last_name']));
}

/** The shared password's stand-in operator: a manager, until a real one exists. */
function qr_shared_operator(): array
{
    return ['id' => 0, 'code' => QR_OPERATOR_SHARED, 'name' => 'Обща парола', 'roles' => ['manager']];
}

/** Who this cookie belongs to, if it is valid and they may still sign in; else null. */
function qr_admin_operator(int $now)
{
    $cookie = isset($_COOKIE[QR_ADMIN_COOKIE]) ? (string) $_COOKIE[QR_ADMIN_COOKIE] : '';
    if (!preg_match('/^(\d{1,9})\.(\d{1,12})\.([0-9a-f]{64})$/', $cookie, $m)) {
        return null;
    }
    $staffId = (int) $m[1];
    $expires = (int) $m[2];
    if ($expires <= $now) {
        return null;
    }
    if ($staffId === 0) {
        $hash = qr_admin_hash();
        if ($hash === '' || !hash_equals(qr_admin_signature(0, $expires, $hash), $m[3]) || !qr_staff_bootstrap($now)) {
            return null;
        }
        return qr_shared_operator();
    }
    $staff = qr_staff_find('id', $staffId);
    if ($staff === null || !hash_equals(qr_admin_signature($staffId, $expires, (string) $staff['pass_hash']), $m[3])
        || (int) $staff['active'] !== 1) {
        return null;
    }
    $roles = qr_staff_roles($staffId, $now);
    if (!$roles) {
        return null;
    }
    return ['id' => $staffId, 'code' => (string) $staff['code'], 'name' => qr_staff_name($staff), 'roles' => $roles];
}

function qr_admin_signed_in(int $now): bool
{
    return qr_admin_operator($now) !== null;
}

/**
 * Stop with 401 unless signed in; return the person, who is from now on the
 * operator of this request's writes. For anything that changes state, also
 * require the X-Raya-Admin header and, where the browser sends one, an
 * Origin that is this site — and a role that may change things: never the
 * auditor's alone, and the manager's where $role says so.
 */
function qr_require_admin(bool $changes, string $role = 'waiter'): array
{
    $operator = qr_admin_operator(qr_now());
    if ($operator === null) {
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
        $may = $role === 'manager' ? ['manager'] : ['waiter', 'manager'];
        if (!array_intersect($may, $operator['roles'])) {
            qr_fail(403, in_array('auditor', $operator['roles'], true) && $role !== 'manager' ? 'read_only' : 'manager_only');
        }
    } elseif ($role === 'manager' && !array_intersect(['manager', 'auditor'], $operator['roles'])) {
        qr_fail(403, 'manager_only');
    }
    qr_actor($operator);
    return $operator;
}

/** The person as the staff screen shows them. */
function qr_operator_json(array $operator): array
{
    return ['id' => (int) $operator['id'], 'code' => (string) $operator['code'], 'name' => (string) $operator['name'], 'roles' => $operator['roles']];
}

/**
 * Sign in, or say why not. With a code: that person's account. Without
 * one: the shared password, only until a manager account exists.
 */
function qr_admin_login(string $code, string $password, int $now): array
{
    $shared = qr_admin_hash();
    $bootstrap = qr_staff_bootstrap($now);
    if ($code === '' && $shared === '' && $bootstrap) {
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

    $operator = null;
    $passHash = '';
    $error = 'wrong_password';
    if ($code === '') {
        if (!$bootstrap) {
            $error = 'personal_required';
        } elseif (password_verify($password, $shared)) {
            $operator = qr_shared_operator();
            $passHash = $shared;
        }
    } elseif (preg_match('/^\d{4}$/', $code)) {
        $staff = qr_staff_find('code', $code);
        if ($staff !== null && password_verify($password, (string) $staff['pass_hash'])) {
            $roles = qr_staff_roles((int) $staff['id'], $now);
            if ((int) $staff['active'] !== 1 || !$roles) {
                $error = 'inactive';
            } else {
                $operator = ['id' => (int) $staff['id'], 'code' => $code, 'name' => qr_staff_name($staff), 'roles' => $roles];
                $passHash = (string) $staff['pass_hash'];
            }
        }
    }

    if ($operator === null) {
        if ($error !== 'personal_required') {
            qr_write(function (PDO $pdo) use ($ipHash, $now, $code, $error) {
                $pdo->prepare('DELETE FROM login_attempts WHERE at < ?')->execute([$now - QR_LOGIN_WINDOW]);
                $pdo->prepare('INSERT INTO login_attempts (ip_hash, at) VALUES (?, ?)')->execute([$ipHash, $now]);
                qr_audit($pdo, 'login_failed', $code, 'reason=' . $error);
            });
        }
        return [$error === 'personal_required' ? 403 : 401, ['ok' => false, 'error' => $error]];
    }
    qr_actor($operator);
    qr_write(function (PDO $pdo) use ($ipHash) {
        $pdo->prepare('DELETE FROM login_attempts WHERE ip_hash = ?')->execute([$ipHash]);
        qr_audit($pdo, 'login', qr_actor()['code'], 'roles=' . implode(',', qr_actor()['roles']));
    });
    $expires = $now + QR_ADMIN_HOURS * 3600;
    qr_admin_cookie($operator['id'] . '.' . $expires . '.' . qr_admin_signature((int) $operator['id'], $expires, $passHash), $expires);
    return [200, ['ok' => true, 'expiresAt' => $expires, 'operator' => qr_operator_json($operator)]];
}

/** Sign out: the cookie goes, and the log says who left. */
function qr_admin_logout(int $now)
{
    $operator = qr_admin_operator($now);
    if ($operator !== null) {
        qr_actor($operator);
        qr_write(function (PDO $pdo) {
            qr_audit($pdo, 'logout', qr_actor()['code'], '');
        });
    }
    qr_admin_cookie('', 1);
}
