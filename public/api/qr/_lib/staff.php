<?php
// Staff accounts (Наредба Н-18, Annex 29 т. 6–7, чл. 52л): made and changed
// by a manager from „Персонал“ on the staff screen. Each person: a code of
// 4 digits (0001–8999; 9000 and up are the system, the QR guest and the
// shared password), at least two names as on their ID, a password of their
// own, and roles with the period each is held. Nothing is deleted: someone
// who leaves is made inactive, a role that ends gets its end date. Every
// change goes in audit_log (core.php's triggers), with the manager who made
// it.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_STAFF_NAME_MAX = 40;
const QR_STAFF_PASSWORD_MIN = 8;
const QR_STAFF_CODE_MAX = 8999;

function qr_staff_list(PDO $pdo): array
{
    $roles = [];
    foreach ($pdo->query('SELECT * FROM staff_roles ORDER BY from_at, id')->fetchAll() as $r) {
        $roles[(int) $r['staff_id']][] = [
            'id' => (int) $r['id'],
            'role' => (string) $r['role'],
            'from' => (int) $r['from_at'],
            'to' => (int) $r['to_at'],
        ];
    }
    $out = [];
    foreach ($pdo->query('SELECT * FROM staff ORDER BY active DESC, code')->fetchAll() as $s) {
        $out[] = [
            'id' => (int) $s['id'],
            'code' => (string) $s['code'],
            'firstName' => (string) $s['first_name'],
            'middleName' => (string) $s['middle_name'],
            'lastName' => (string) $s['last_name'],
            'active' => (int) $s['active'] === 1,
            'createdAt' => (int) $s['created_at'],
            'passwordChangedAt' => (int) $s['pass_changed_at'],
            'roles' => $roles[(int) $s['id']] ?? [],
        ];
    }
    return $out;
}

/** A name as given: cleaned, 1–40 characters; '' if missing and not $required. */
function qr_staff_clean_name($value, string $field, bool $required): string
{
    if ($value === null && !$required) {
        return '';
    }
    $name = is_string($value) ? qr_clean_name($value, QR_STAFF_NAME_MAX + 1) : '';
    if (($required && $name === '') || mb_strlen($name) > QR_STAFF_NAME_MAX) {
        throw new QrStaffError(400, 'invalid', $field);
    }
    return $name;
}

function qr_staff_hash_password($value): string
{
    if (!is_string($value) || mb_strlen($value) < QR_STAFF_PASSWORD_MIN || strlen($value) > 200) {
        throw new QrStaffError(400, 'weak_password', 'password');
    }
    return password_hash($value, PASSWORD_DEFAULT);
}

/** A unix time from the body (seconds), or $default. */
function qr_staff_time($value, int $default, string $field): int
{
    if ($value === null) {
        return $default;
    }
    if (!is_int($value) || $value < 0) {
        throw new QrStaffError(400, 'invalid', $field);
    }
    return $value;
}

class QrStaffError extends Exception
{
    public $status;
    public $error;
    public $field;

    public function __construct(int $status, string $error, string $field = '')
    {
        parent::__construct($error);
        $this->status = $status;
        $this->error = $error;
        $this->field = $field;
    }
}

/** Managers holding the role at $now, without the one being changed. */
function qr_staff_other_managers(PDO $pdo, int $now, int $exceptStaff, int $exceptRole): int
{
    $find = $pdo->prepare("SELECT COUNT(*) FROM staff_roles r JOIN staff s ON s.id = r.staff_id
        WHERE s.active = 1 AND r.role = 'manager' AND r.from_at <= ? AND (r.to_at = 0 OR r.to_at > ?) AND s.id <> ? AND r.id <> ?");
    $find->execute([$now, $now, $exceptStaff, $exceptRole]);
    $n = (int) $find->fetchColumn();
    $find->closeCursor();
    return $n;
}

function qr_staff_row(PDO $pdo, $id): array
{
    if (!is_int($id)) {
        throw new QrStaffError(400, 'invalid', 'id');
    }
    $find = $pdo->prepare('SELECT * FROM staff WHERE id = ?');
    $find->execute([$id]);
    $row = $find->fetch();
    $find->closeCursor();
    if (!is_array($row)) {
        throw new QrStaffError(404, 'not_found', 'id');
    }
    return $row;
}

/**
 * One change from „Персонал“; returns the new list. Inside qr_write().
 *   create    {firstName, middleName?, lastName, code?, password, role, from?}
 *   rename    {id, firstName, middleName?, lastName}
 *   password  {id, password}
 *   active    {id, active}
 *   addRole   {id, role, from?, to?}
 *   endRole   {roleId, at?}
 * The last manager can't be made inactive or lose the role: someone must
 * always be able to manage the accounts.
 */
function qr_staff_change(PDO $pdo, array $body, int $now): array
{
    $action = $body['action'] ?? '';
    if ($action === 'create') {
        $first = qr_staff_clean_name($body['firstName'] ?? null, 'firstName', true);
        $middle = qr_staff_clean_name($body['middleName'] ?? null, 'middleName', false);
        $last = qr_staff_clean_name($body['lastName'] ?? null, 'lastName', true);
        $hash = qr_staff_hash_password($body['password'] ?? null);
        $role = $body['role'] ?? '';
        if (!in_array($role, QR_ROLES, true)) {
            throw new QrStaffError(400, 'invalid', 'role');
        }
        $code = $body['code'] ?? '';
        if ($code === '' || $code === null) {
            $next = (int) $pdo->query("SELECT COALESCE(MAX(CAST(code AS INTEGER)), 0) + 1 FROM staff WHERE CAST(code AS INTEGER) <= " . QR_STAFF_CODE_MAX)->fetchColumn();
            if ($next > QR_STAFF_CODE_MAX) {
                throw new QrStaffError(409, 'no_codes_left', 'code');
            }
            $code = sprintf('%04d', $next);
        } elseif (!is_string($code) || !preg_match('/^\d{4}$/', $code) || (int) $code < 1 || (int) $code > QR_STAFF_CODE_MAX) {
            throw new QrStaffError(400, 'invalid', 'code');
        }
        $taken = $pdo->prepare('SELECT COUNT(*) FROM staff WHERE code = ?');
        $taken->execute([$code]);
        if ((int) $taken->fetchColumn() > 0) {
            throw new QrStaffError(409, 'code_taken', 'code');
        }
        $taken->closeCursor();
        $from = qr_staff_time($body['from'] ?? null, $now, 'from');
        $pdo->prepare('INSERT INTO staff (code, first_name, middle_name, last_name, pass_hash, pass_changed_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)')->execute([$code, $first, $middle, $last, $hash, $now, $now, $now]);
        $id = (int) $pdo->lastInsertId();
        $pdo->prepare('INSERT INTO staff_roles (staff_id, role, from_at, created_at) VALUES (?, ?, ?, ?)')->execute([$id, $role, $from, $now]);
        return ['id' => $id, 'code' => $code];
    }
    if ($action === 'rename') {
        $staff = qr_staff_row($pdo, $body['id'] ?? null);
        $first = qr_staff_clean_name($body['firstName'] ?? null, 'firstName', true);
        $middle = qr_staff_clean_name($body['middleName'] ?? null, 'middleName', false);
        $last = qr_staff_clean_name($body['lastName'] ?? null, 'lastName', true);
        $pdo->prepare('UPDATE staff SET first_name = ?, middle_name = ?, last_name = ?, updated_at = ? WHERE id = ?')
            ->execute([$first, $middle, $last, $now, $staff['id']]);
        return ['id' => (int) $staff['id']];
    }
    if ($action === 'password') {
        $staff = qr_staff_row($pdo, $body['id'] ?? null);
        $pdo->prepare('UPDATE staff SET pass_hash = ?, pass_changed_at = ?, updated_at = ? WHERE id = ?')
            ->execute([qr_staff_hash_password($body['password'] ?? null), $now, $now, $staff['id']]);
        return ['id' => (int) $staff['id']];
    }
    if ($action === 'active') {
        $staff = qr_staff_row($pdo, $body['id'] ?? null);
        if (!is_bool($body['active'] ?? null)) {
            throw new QrStaffError(400, 'invalid', 'active');
        }
        if (!$body['active'] && in_array('manager', qr_staff_roles((int) $staff['id'], $now), true)
            && qr_staff_other_managers($pdo, $now, (int) $staff['id'], 0) === 0) {
            throw new QrStaffError(409, 'last_manager');
        }
        $pdo->prepare('UPDATE staff SET active = ?, updated_at = ? WHERE id = ?')->execute([$body['active'] ? 1 : 0, $now, $staff['id']]);
        return ['id' => (int) $staff['id']];
    }
    if ($action === 'addRole') {
        $staff = qr_staff_row($pdo, $body['id'] ?? null);
        $role = $body['role'] ?? '';
        if (!in_array($role, QR_ROLES, true)) {
            throw new QrStaffError(400, 'invalid', 'role');
        }
        $from = qr_staff_time($body['from'] ?? null, $now, 'from');
        $to = qr_staff_time($body['to'] ?? null, 0, 'to');
        if ($to !== 0 && $to <= $from) {
            throw new QrStaffError(400, 'invalid', 'to');
        }
        $pdo->prepare('INSERT INTO staff_roles (staff_id, role, from_at, to_at, created_at) VALUES (?, ?, ?, ?, ?)')
            ->execute([$staff['id'], $role, $from, $to, $now]);
        return ['id' => (int) $staff['id']];
    }
    if ($action === 'endRole') {
        $roleId = $body['roleId'] ?? null;
        if (!is_int($roleId)) {
            throw new QrStaffError(400, 'invalid', 'roleId');
        }
        $find = $pdo->prepare('SELECT * FROM staff_roles WHERE id = ?');
        $find->execute([$roleId]);
        $role = $find->fetch();
        $find->closeCursor();
        if (!is_array($role)) {
            throw new QrStaffError(404, 'not_found', 'roleId');
        }
        $at = qr_staff_time($body['at'] ?? null, $now, 'at');
        if ($at < (int) $role['from_at'] || ((int) $role['to_at'] !== 0 && (int) $role['to_at'] <= $at)) {
            throw new QrStaffError(400, 'invalid', 'at');
        }
        $held = (int) $role['from_at'] <= $now && ((int) $role['to_at'] === 0 || (int) $role['to_at'] > $now);
        if ($role['role'] === 'manager' && $held && $at <= $now && qr_staff_other_managers($pdo, $now, 0, (int) $role['id']) === 0) {
            throw new QrStaffError(409, 'last_manager');
        }
        $pdo->prepare('UPDATE staff_roles SET to_at = ? WHERE id = ?')->execute([$at, $role['id']]);
        return ['id' => (int) $role['staff_id']];
    }
    throw new QrStaffError(400, 'invalid', 'action');
}
