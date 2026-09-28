<?php
// The QR ordering system's shared core: configuration, storage, clock,
// menu and JSON responses. Every endpoint in /api/qr/ starts here.
//
// ⚠ The production host runs PHP 7.3 (FPM). Keep this code parseable there:
// no arrow functions, typed properties, match, nullsafe, str_contains or
// named arguments. `npm run qr:php-check` runs PHPCompatibility for 7.3.
//
// Where things live (see docs/qr-ordering/SETUP.md):
//   · the configuration, raya-qr-config.php, one folder ABOVE the web root —
//     next to raya-mailer-config.php — holding the admin password hash;
//   · the orders, a SQLite file in raya-qr-data/, also above the web root.
// Outside the web root on purpose: nothing there can be downloaded, and the
// deploy (scripts/deploy-ftp.mjs) only ever touches the web root, so a
// deploy can never delete an order.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_TZ = 'Europe/Sofia';
// pending_payment and expired exist only when guests pay on the phone: an
// order waiting for its payment, and one whose payment never came. Staff
// never see either — an order reaches them as 'new' once it is paid.
const QR_STATUSES = ['pending_payment', 'expired', 'new', 'accepted', 'served', 'cancelled'];
const QR_MAX_LINES = 50;
const QR_MAX_QTY = 20;
const QR_MAX_NOTE = 200;
const QR_MAX_TABLES = 300;
const QR_TABLE_LIMIT = 5;    // orders per table …
const QR_IP_LIMIT = 60;      // … and per network address (a whole restaurant can share one Wi-Fi address) …
const QR_LIMIT_WINDOW = 300; // … per 5 minutes

/** Send JSON and stop. */
function qr_json(int $status, array $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function qr_fail(int $status, string $error, array $extra = [])
{
    qr_json($status, array_merge(['ok' => false, 'error' => $error], $extra));
}

function qr_require_method(string $method)
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== $method) {
        header('Allow: ' . $method);
        qr_fail(405, 'method_not_allowed');
    }
}

/** The JSON request body as an array, or a 400. */
function qr_body(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 65536);
    if ($raw === false || $raw === '') {
        qr_fail(400, 'invalid', ['field' => 'body']);
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        qr_fail(400, 'invalid', ['field' => 'body']);
    }
    return $data;
}

/**
 * Unix time. Tests may move the clock with an X-Test-Now header, but only
 * when the server itself was started with RAYA_QR_TEST=1 — which production
 * never is.
 */
function qr_now(): int
{
    if (getenv('RAYA_QR_TEST') === '1' && isset($_SERVER['HTTP_X_TEST_NOW'])) {
        return (int) $_SERVER['HTTP_X_TEST_NOW'];
    }
    return time();
}

// ── configuration ────────────────────────────────────────────────────

function qr_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }
    $candidates = [];
    $explicit = getenv('RAYA_QR_CONFIG');
    if (is_string($explicit) && $explicit !== '') {
        $candidates[] = $explicit;
    }
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : '';
    if ($docRoot !== '') {
        $candidates[] = dirname($docRoot) . '/raya-qr-config.php';
    }
    // This file is <web root>/api/qr/_lib/core.php: four levels up is the
    // folder that holds the web root.
    $candidates[] = dirname(__DIR__, 4) . '/raya-qr-config.php';

    $config = [];
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $loaded = include $path;
            if (is_array($loaded)) {
                $config = $loaded;
                $config['_path'] = $path;
            }
            break;
        }
    }
    return $config;
}

function qr_data_dir(): string
{
    $config = qr_config();
    $env = getenv('RAYA_QR_DATA_DIR');
    if (is_string($env) && $env !== '') {
        return rtrim($env, '/');
    }
    if (!empty($config['data_dir'])) {
        return rtrim((string) $config['data_dir'], '/');
    }
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : '';
    $base = $docRoot !== '' ? dirname($docRoot) : dirname(__DIR__, 4);
    return $base . '/raya-qr-data';
}

// ── storage ──────────────────────────────────────────────────────────
//
// SQLite, one file. Writes run inside BEGIN IMMEDIATE, which takes the
// database's single write lock up front: two orders can never interleave,
// and a counter (settings.seq) bumped inside each write transaction is
// committed in exactly the order the changes happened. The admin screen
// asks for "everything after seq N", so it can never skip a change.

const QR_SCHEMA_VERSION = 2;

function qr_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    if (!in_array('sqlite', PDO::getAvailableDrivers(), true)) {
        qr_fail(503, 'storage_unavailable', ['detail' => 'pdo_sqlite is not enabled']);
    }
    $dir = qr_data_dir();
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        qr_fail(503, 'storage_unavailable', ['detail' => 'data folder cannot be created']);
    }
    $pdo = new PDO('sqlite:' . $dir . '/orders.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 8000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    qr_migrate($pdo);
    return $pdo;
}

function qr_migrate(PDO $pdo)
{
    $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version >= QR_SCHEMA_VERSION) {
        return;
    }
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $version = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
        if ($version < 1) {
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS settings (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    tables INTEGER NOT NULL DEFAULT 0,
                    disabled_tables TEXT NOT NULL DEFAULT '[]',
                    service_date TEXT NOT NULL DEFAULT '',
                    opens_local TEXT NOT NULL DEFAULT '',
                    closes_local TEXT NOT NULL DEFAULT '',
                    opens_at INTEGER NOT NULL DEFAULT 0,
                    closes_at INTEGER NOT NULL DEFAULT 0,
                    paused INTEGER NOT NULL DEFAULT 0,
                    secret TEXT NOT NULL,
                    seq INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS sold_out (
                    item_id TEXT PRIMARY KEY,
                    since INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    idem_key TEXT NOT NULL UNIQUE,
                    payload_hash TEXT NOT NULL,
                    table_no INTEGER NOT NULL,
                    status TEXT NOT NULL DEFAULT 'new',
                    cancel_reason TEXT NOT NULL DEFAULT '',
                    total_cents INTEGER NOT NULL,
                    lang TEXT NOT NULL DEFAULT 'bg',
                    ip_hash TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    seq INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS orders_seq ON orders (seq);
                CREATE INDEX IF NOT EXISTS orders_created ON orders (created_at);
                CREATE INDEX IF NOT EXISTS orders_table ON orders (table_no, created_at);
                CREATE INDEX IF NOT EXISTS orders_ip ON orders (ip_hash, created_at);
                CREATE TABLE IF NOT EXISTS order_items (
                    order_id INTEGER NOT NULL REFERENCES orders (id),
                    line INTEGER NOT NULL,
                    item_id TEXT NOT NULL,
                    variant_id TEXT NOT NULL,
                    choice_id TEXT NOT NULL DEFAULT '',
                    name_bg TEXT NOT NULL,
                    name_en TEXT NOT NULL,
                    detail_bg TEXT NOT NULL DEFAULT '',
                    detail_en TEXT NOT NULL DEFAULT '',
                    size TEXT NOT NULL DEFAULT '',
                    unit_cents INTEGER NOT NULL,
                    qty INTEGER NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY (order_id, line)
                );
                CREATE TABLE IF NOT EXISTS order_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER NOT NULL REFERENCES orders (id),
                    from_status TEXT NOT NULL,
                    to_status TEXT NOT NULL,
                    reason TEXT NOT NULL DEFAULT '',
                    at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS login_attempts (
                    ip_hash TEXT NOT NULL,
                    at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts (ip_hash, at);
            ");
            // The server's own secret: order tokens and admin sessions are
            // derived from it. Made here, once, and never leaves the server.
            $insert = $pdo->prepare('INSERT OR IGNORE INTO settings (id, secret) VALUES (1, ?)');
            $insert->execute([bin2hex(random_bytes(32))]);
        }
        if ($version < 2) {
            // Paying on the phone (Stripe Checkout). An order's pay_status is
            // '' when it is paid to staff, else pending → paid → refunded, or
            // pending → failed / expired. till_at: when staff entered a paid
            // order in the till (Clock); till_void_at: when they voided it
            // there after a refund.
            $pdo->exec("
                ALTER TABLE settings ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'on_site';
                ALTER TABLE orders ADD COLUMN pay_status TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN checkout_session TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN checkout_url TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN checkout_expires INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN payment_intent TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN paid_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN refund_id TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN till_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN till_void_at INTEGER NOT NULL DEFAULT 0;
                CREATE INDEX IF NOT EXISTS orders_checkout ON orders (checkout_session);
                CREATE INDEX IF NOT EXISTS orders_payment_intent ON orders (payment_intent);
                CREATE TABLE IF NOT EXISTS stripe_events (
                    id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    at INTEGER NOT NULL
                );
            ");
        }
        $pdo->exec('PRAGMA user_version = ' . QR_SCHEMA_VERSION);
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}

/**
 * Run $fn inside BEGIN IMMEDIATE; commit on return, roll back on anything thrown.
 *
 * ⚠ A statement read outside a transaction keeps SQLite's read lock until
 * its cursor is closed. Close it (closeCursor()) before calling this, or
 * before anything slow such as a call to Stripe: a connection that holds the
 * read lock while waiting for the write lock deadlocks with a writer waiting
 * to commit, and SQLite answers one of them "database is locked" at once,
 * without waiting.
 */
function qr_write(callable $fn)
{
    $pdo = qr_db();
    $pdo->exec('BEGIN IMMEDIATE');
    try {
        $result = $fn($pdo);
        $pdo->exec('COMMIT');
        return $result;
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
}

/** Next change number. Call inside qr_write() only. */
function qr_bump_seq(PDO $pdo): int
{
    $pdo->exec('UPDATE settings SET seq = seq + 1 WHERE id = 1');
    return (int) $pdo->query('SELECT seq FROM settings WHERE id = 1')->fetchColumn();
}

function qr_settings(): array
{
    $row = qr_db()->query('SELECT * FROM settings WHERE id = 1')->fetch();
    return is_array($row) ? $row : [];
}

function qr_secret(): string
{
    $settings = qr_settings();
    return (string) $settings['secret'];
}

/** A stable, non-reversible stand-in for the caller's network address. */
function qr_ip_hash(): string
{
    $ip = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    return substr(hash_hmac('sha256', 'ip|' . $ip, qr_secret()), 0, 20);
}

// ── ordering window ──────────────────────────────────────────────────

/**
 * The service window as unix times, from a Sofia date and two local times.
 * A closing time at or before the opening time is the next day
 * (18:00–01:00). DateTime does the Sofia arithmetic, so a window across a
 * daylight-saving change is still exactly its wall-clock hours.
 */
function qr_window(string $date, string $opens, string $closes): array
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) || !preg_match('/^\d{2}:\d{2}$/', $opens)
        || !preg_match('/^\d{2}:\d{2}$/', $closes)) {
        return [];
    }
    $start = qr_local_time($date, $opens);
    $end = qr_local_time($date, $closes);
    if ($start === null || $end === null) {
        return [];
    }
    if ($end <= $start) {
        $end->modify('+1 day');
    }
    return [$start->getTimestamp(), $end->getTimestamp()];
}

/** A Sofia wall-clock time, or null for an impossible one (30 February, 25:00). */
function qr_local_time(string $date, string $time)
{
    $dt = DateTime::createFromFormat('!Y-m-d H:i', $date . ' ' . $time, new DateTimeZone(QR_TZ));
    $errors = DateTime::getLastErrors();
    if (!$dt || (is_array($errors) && ($errors['warning_count'] || $errors['error_count']))) {
        return null;
    }
    return $dt;
}

/** Is ordering open right now, and if not, why. */
function qr_state(array $settings, int $now): array
{
    $tables = (int) $settings['tables'];
    $opensAt = (int) $settings['opens_at'];
    $closesAt = (int) $settings['closes_at'];
    $reason = null;
    if ($tables < 1 || $opensAt === 0) {
        $reason = 'not_configured';
    } elseif ((int) $settings['paused'] === 1) {
        $reason = 'paused';
    } elseif ($now < $opensAt) {
        $reason = 'not_yet_open';
    } elseif ($now >= $closesAt) {
        $reason = 'closed';
    }
    return [
        'open' => $reason === null,
        'reason' => $reason,
        'tables' => $tables,
        'disabledTables' => qr_int_list((string) $settings['disabled_tables']),
        'serviceDate' => (string) $settings['service_date'],
        'opens' => (string) $settings['opens_local'],
        'closes' => (string) $settings['closes_local'],
        'opensAt' => $opensAt,
        'closesAt' => $closesAt,
        'paused' => (int) $settings['paused'] === 1,
        // How guests pay tonight. 'online' only while Stripe is configured:
        // with the keys gone, ordering falls back to paying staff.
        'payment' => ($settings['payment_mode'] ?? '') === 'online' && qr_stripe_configured() ? 'online' : 'on_site',
        'paymentMode' => (string) ($settings['payment_mode'] ?? 'on_site'),
        'paymentsConfigured' => qr_stripe_configured(),
        'paymentsTest' => qr_stripe_test_mode(),
        'now' => $now,
    ];
}

// ── payments configured? (the calls themselves are in _lib/pay.php) ──

function qr_stripe_configured(): bool
{
    $config = qr_config();
    return !empty($config['stripe_secret_key']) && !empty($config['stripe_webhook_secret']);
}

/** A test-mode key (sk_test_ / rk_test_): no real money moves. */
function qr_stripe_test_mode(): bool
{
    $config = qr_config();
    return (bool) preg_match('/^[sr]k_test_/', (string) ($config['stripe_secret_key'] ?? ''));
}

function qr_int_list(string $json): array
{
    $list = json_decode($json, true);
    if (!is_array($list)) {
        return [];
    }
    $out = [];
    foreach ($list as $n) {
        if (is_int($n)) {
            $out[] = $n;
        }
    }
    return $out;
}

function qr_sold_out(): array
{
    $rows = qr_db()->query('SELECT item_id FROM sold_out ORDER BY item_id')->fetchAll(PDO::FETCH_COLUMN);
    return array_map('strval', $rows);
}

// ── menu ─────────────────────────────────────────────────────────────

/** The menu the guest page is built from: public/api/qr-menu.json. */
function qr_menu(): array
{
    static $menu = null;
    if ($menu !== null) {
        return $menu;
    }
    $raw = @file_get_contents(dirname(__DIR__, 2) . '/qr-menu.json');
    $menu = $raw === false ? null : json_decode($raw, true);
    if (!is_array($menu) || empty($menu['categories'])) {
        qr_fail(503, 'menu_unavailable');
    }
    return $menu;
}

/** item id → item (with its category id), built once. */
function qr_menu_index(): array
{
    static $index = null;
    if ($index !== null) {
        return $index;
    }
    $index = [];
    foreach (qr_menu()['categories'] as $category) {
        foreach ($category['items'] as $item) {
            $item['category'] = $category['id'];
            $index[$item['id']] = $item;
        }
    }
    return $index;
}

// ── orders as JSON ───────────────────────────────────────────────────

function qr_order_json(array $order, bool $withLines = true): array
{
    $out = [
        'id' => (int) $order['id'],
        'code' => (string) $order['code'],
        'table' => (int) $order['table_no'],
        'status' => (string) $order['status'],
        'cancelReason' => (string) $order['cancel_reason'],
        'total' => (int) $order['total_cents'],
        'lang' => (string) $order['lang'],
        'createdAt' => (int) $order['created_at'],
        'updatedAt' => (int) $order['updated_at'],
        'seq' => (int) $order['seq'],
        'payStatus' => (string) ($order['pay_status'] ?? ''),
        'paidAt' => (int) ($order['paid_at'] ?? 0),
        'tillAt' => (int) ($order['till_at'] ?? 0),
        'tillVoidAt' => (int) ($order['till_void_at'] ?? 0),
    ];
    if ($withLines) {
        $stmt = qr_db()->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
        $stmt->execute([(int) $order['id']]);
        $out['lines'] = [];
        foreach ($stmt->fetchAll() as $line) {
            $out['lines'][] = [
                'itemId' => (string) $line['item_id'],
                'variantId' => (string) $line['variant_id'],
                'choiceId' => (string) $line['choice_id'],
                'nameBg' => (string) $line['name_bg'],
                'nameEn' => (string) $line['name_en'],
                'detailBg' => (string) $line['detail_bg'],
                'detailEn' => (string) $line['detail_en'],
                'size' => (string) $line['size'],
                'price' => (int) $line['unit_cents'],
                'qty' => (int) $line['qty'],
                'note' => (string) $line['note'],
            ];
        }
    }
    return $out;
}
