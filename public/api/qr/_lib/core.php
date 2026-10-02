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
// Where a line is made: each menu category says (qr-menu.json "station").
// An order with both food and drinks is two jobs, one per station, each
// accepted and served on its own (orders.kitchen_status / bar_status).
const QR_STATIONS = ['kitchen', 'bar'];
const QR_MAX_LINES = 50;
const QR_MAX_QTY = 20;
const QR_MAX_NOTE = 200;
const QR_MAX_TABLES = 300;
const QR_TABLE_LIMIT = 5;    // orders per table …
const QR_IP_LIMIT = 60;      // … and per network address (a whole restaurant can share one Wi-Fi address) …
const QR_LIMIT_WINDOW = 300; // … per 5 minutes
const QR_MAX_NAME = 40;      // the guest's own name on an order, optional
const QR_NAME_DAYS = 3;      // names (the guest's, the payer's) are erased after this

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

const QR_SCHEMA_VERSION = 8;

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
        if ($version < 3) {
            // The table's bill ("Сметка накрая", see bill.php): a tab per table
            // and evening collects the orders; guests pay chosen lines of it
            // on the phone (bill_payments), staff settle the rest on the spot.
            // A line's paid_via: '' unpaid, 'online' (bill_payment_id),
            // 'staff' (cash or terminal), 'refunded' (its order was cancelled
            // after it was paid online). A payment's refund_due_cents is what
            // we owe back — lines paid twice in a race, or cancelled after
            // payment — and refunded_cents what Stripe has returned so far.
            $pdo->exec("
                CREATE TABLE IF NOT EXISTS tabs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_no INTEGER NOT NULL,
                    evening TEXT NOT NULL,
                    opened_at INTEGER NOT NULL,
                    closed_at INTEGER NOT NULL DEFAULT 0,
                    seq INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS tabs_open ON tabs (table_no, evening, closed_at);
                CREATE INDEX IF NOT EXISTS tabs_seq ON tabs (seq);
                ALTER TABLE orders ADD COLUMN tab_id INTEGER NOT NULL DEFAULT 0;
                CREATE INDEX IF NOT EXISTS orders_tab ON orders (tab_id);
                ALTER TABLE order_items ADD COLUMN paid_via TEXT NOT NULL DEFAULT '';
                ALTER TABLE order_items ADD COLUMN bill_payment_id INTEGER NOT NULL DEFAULT 0;
                CREATE TABLE IF NOT EXISTS bill_payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL,
                    tab_id INTEGER NOT NULL,
                    table_no INTEGER NOT NULL,
                    token_hash TEXT NOT NULL UNIQUE,
                    idem_key TEXT NOT NULL UNIQUE,
                    payload_hash TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    amount_cents INTEGER NOT NULL,
                    overlap_cents INTEGER NOT NULL DEFAULT 0,
                    refund_due_cents INTEGER NOT NULL DEFAULT 0,
                    refunded_cents INTEGER NOT NULL DEFAULT 0,
                    refund_error INTEGER NOT NULL DEFAULT 0,
                    lang TEXT NOT NULL DEFAULT 'bg',
                    ip_hash TEXT NOT NULL DEFAULT '',
                    checkout_session TEXT NOT NULL DEFAULT '',
                    checkout_url TEXT NOT NULL DEFAULT '',
                    checkout_expires INTEGER NOT NULL DEFAULT 0,
                    payment_intent TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    paid_at INTEGER NOT NULL DEFAULT 0,
                    till_at INTEGER NOT NULL DEFAULT 0,
                    till_cents INTEGER NOT NULL DEFAULT 0,
                    till_void_at INTEGER NOT NULL DEFAULT 0,
                    seq INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS bill_payments_tab ON bill_payments (tab_id);
                CREATE INDEX IF NOT EXISTS bill_payments_checkout ON bill_payments (checkout_session);
                CREATE INDEX IF NOT EXISTS bill_payments_seq ON bill_payments (seq);
                CREATE TABLE IF NOT EXISTS bill_payment_items (
                    payment_id INTEGER NOT NULL,
                    order_id INTEGER NOT NULL,
                    line INTEGER NOT NULL,
                    amount_cents INTEGER NOT NULL,
                    PRIMARY KEY (payment_id, order_id, line)
                );
            ");
        }
        if ($version < 4) {
            // Names, for staff: guest_name is what the guest typed when
            // ordering (optional); payer_name is the name Stripe's payment page
            // took (the cardholder, or the Apple/Google Pay account). Both are
            // erased QR_NAME_DAYS after the order (qr_forget_names).
            $pdo->exec("
                ALTER TABLE orders ADD COLUMN guest_name TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN payer_name TEXT NOT NULL DEFAULT '';
                ALTER TABLE bill_payments ADD COLUMN payer_name TEXT NOT NULL DEFAULT '';
            ");
        }
        if ($version < 5) {
            // One line of an order cancelled, not the whole order: void_qty
            // of the line's qty are off (void_reason says why), and the
            // order's void_cents is what they came to. A paid order owes that
            // back: refund_due_cents grows, refunded_cents is what Stripe has
            // returned, as for bill payments. tip_cents: a tip added when
            // paying a table's bill, on top of amount_cents.
            //
            // The till: till_cents is what was entered in Clock, and
            // till_void_cents what has been voided there since. Whatever the
            // entry exceeds the order's (or payment's) net amount by is still
            // to void — however many refunds came after the entry.
            $pdo->exec("
                ALTER TABLE order_items ADD COLUMN void_qty INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE order_items ADD COLUMN void_reason TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN void_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN refund_due_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN refund_error INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN till_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE orders ADD COLUMN till_void_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE bill_payments ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE bill_payments ADD COLUMN till_void_cents INTEGER NOT NULL DEFAULT 0;
                UPDATE orders SET till_cents = total_cents WHERE till_at > 0;
                UPDATE orders SET till_void_cents = total_cents WHERE till_void_at > 0;
                UPDATE bill_payments SET till_void_cents = till_cents - (amount_cents - refund_due_cents)
                    WHERE till_void_at > 0 AND till_cents > amount_cents - refund_due_cents;
            ");
        }
        if ($version < 6) {
            // Kitchen and bar. A line's station is copied from its menu
            // category when ordered; an order has a status per station
            // ('' when it has nothing for that station), and its own status
            // follows from them (qr_overall_status). Existing orders get the
            // station of each item as the menu has it now, and their own
            // status for each station they have lines for.
            $pdo->exec("
                ALTER TABLE order_items ADD COLUMN station TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT '';
                ALTER TABLE orders ADD COLUMN bar_status TEXT NOT NULL DEFAULT '';
            ");
            $set = $pdo->prepare('UPDATE order_items SET station = ? WHERE item_id = ?');
            foreach ($pdo->query('SELECT DISTINCT item_id FROM order_items')->fetchAll(PDO::FETCH_COLUMN) as $itemId) {
                $set->execute([qr_item_station((string) $itemId), $itemId]);
            }
            foreach (QR_STATIONS as $station) {
                $pdo->exec("UPDATE orders SET {$station}_status =
                    CASE WHEN status IN ('new', 'accepted', 'served', 'cancelled') THEN status ELSE 'new' END
                    WHERE EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = orders.id AND i.station = '$station')");
            }
        }
        if ($version < 7) {
            // Each station closes on its own: the kitchen at 22:00, the bar at
            // 01:00. closes_local/closes_at stay the later of the two — the
            // end of the evening as a whole. Until set, both are that.
            //
            // Waiters: who serves which table tonight, for the staff screen.
            // Kept per evening, so a new evening starts with none; an order
            // says which evening it belongs to (orders.evening).
            $pdo->exec("
                ALTER TABLE settings ADD COLUMN kitchen_closes_local TEXT NOT NULL DEFAULT '';
                ALTER TABLE settings ADD COLUMN kitchen_closes_at INTEGER NOT NULL DEFAULT 0;
                ALTER TABLE settings ADD COLUMN bar_closes_local TEXT NOT NULL DEFAULT '';
                ALTER TABLE settings ADD COLUMN bar_closes_at INTEGER NOT NULL DEFAULT 0;
                UPDATE settings SET kitchen_closes_local = closes_local, kitchen_closes_at = closes_at,
                    bar_closes_local = closes_local, bar_closes_at = closes_at;
                ALTER TABLE orders ADD COLUMN evening TEXT NOT NULL DEFAULT '';
                UPDATE orders SET evening = (SELECT evening FROM tabs WHERE tabs.id = orders.tab_id) WHERE tab_id > 0;
                UPDATE orders SET evening = (SELECT service_date FROM settings WHERE id = 1)
                    WHERE evening = '' AND created_at >= (SELECT opens_at FROM settings WHERE id = 1)
                      AND created_at < (SELECT closes_at FROM settings WHERE id = 1);
                CREATE TABLE IF NOT EXISTS waiters (
                    evening TEXT NOT NULL,
                    table_no INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    PRIMARY KEY (evening, table_no)
                );
            ");
        }
        if ($version < 8) {
            // History ("История", _lib/history.php): nothing is deleted, and
            // past evenings are looked up by their date. Orders from before
            // v7 have none: they get the Sofia date six hours before they
            // were placed, so an order at 00:40 belongs to the evening before.
            // Waiters' lists are kept per evening from now on.
            $pdo->exec("
                CREATE INDEX IF NOT EXISTS orders_evening ON orders (evening, created_at);
                CREATE INDEX IF NOT EXISTS tabs_evening ON tabs (evening);
            ");
            $set = $pdo->prepare('UPDATE orders SET evening = ? WHERE id = ?');
            $tz = new DateTimeZone(QR_TZ);
            foreach ($pdo->query("SELECT id, created_at FROM orders WHERE evening = ''")->fetchAll() as $row) {
                $local = (new DateTime('@' . ((int) $row['created_at'] - 6 * 3600)))->setTimezone($tz);
                $set->execute([$local->format('Y-m-d'), (int) $row['id']]);
            }
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

/**
 * A person's name as we keep it: control and invisible formatting characters
 * out, whitespace collapsed, at most $max characters.
 */
function qr_clean_name(string $name, int $max): string
{
    $name = preg_replace('/[\p{Cc}\p{Cf}]+/u', ' ', $name);
    $name = trim((string) preg_replace('/\s+/u', ' ', (string) $name));
    return mb_substr($name, 0, $max);
}

/**
 * Names are only for the evening: erase them from orders and bill payments
 * older than QR_NAME_DAYS. Called from the busy write paths (placing an
 * order, paying a bill), inside their transaction.
 */
function qr_forget_names(PDO $pdo, int $now)
{
    $before = $now - QR_NAME_DAYS * 86400;
    $pdo->prepare("UPDATE orders SET guest_name = '', payer_name = '' WHERE created_at < ? AND (guest_name <> '' OR payer_name <> '')")
        ->execute([$before]);
    $pdo->prepare("UPDATE bill_payments SET payer_name = '' WHERE created_at < ? AND payer_name <> ''")->execute([$before]);
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

/**
 * Is ordering open right now, and if not, why. Open while either station
 * still takes orders; `stations` says which (the kitchen may close before
 * the bar, or the other way round).
 */
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
    $stations = [];
    foreach (QR_STATIONS as $station) {
        $at = (int) ($settings[$station . '_closes_at'] ?? 0);
        $local = (string) ($settings[$station . '_closes_local'] ?? '');
        if ($at === 0) {
            $at = $closesAt;
            $local = (string) $settings['closes_local'];
        }
        $stations[$station] = ['open' => $reason === null && $now < $at, 'closes' => $local, 'closesAt' => $at];
    }
    return [
        'open' => $reason === null,
        'stations' => $stations,
        'reason' => $reason,
        'tables' => $tables,
        'disabledTables' => qr_int_list((string) $settings['disabled_tables']),
        'serviceDate' => (string) $settings['service_date'],
        'opens' => (string) $settings['opens_local'],
        'closes' => (string) $settings['closes_local'],
        'opensAt' => $opensAt,
        'closesAt' => $closesAt,
        'paused' => (int) $settings['paused'] === 1,
        // How guests pay tonight: 'on_site' (staff), 'online' (on the phone,
        // before the order goes out) or 'tab' (orders collect on the table's
        // bill; anyone at the table pays chosen items on the phone at the
        // end). The last two only while Stripe is configured: with the keys
        // gone, ordering falls back to paying staff.
        'payment' => in_array($settings['payment_mode'] ?? '', ['online', 'tab'], true) && qr_stripe_configured()
            ? (string) $settings['payment_mode'] : 'on_site',
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
            $item['station'] = ($category['station'] ?? '') === 'bar' ? 'bar' : 'kitchen';
            $index[$item['id']] = $item;
        }
    }
    return $index;
}

/** The station a menu item is made at; the kitchen for anything unknown. */
function qr_item_station(string $itemId): string
{
    return (qr_menu_index()[$itemId]['station'] ?? '') === 'bar' ? 'bar' : 'kitchen';
}

/**
 * An order's own status, from its stations' — what the guest sees: new until
 * a station takes it on, accepted once one has, served when every station
 * still making something has served. A station whose lines were all
 * cancelled ('cancelled') no longer counts. An order that is not in the
 * kitchen's hands at all (waiting for payment, cancelled) keeps its status.
 */
function qr_overall_status(array $order): string
{
    $status = (string) $order['status'];
    if (!in_array($status, ['new', 'accepted', 'served'], true)) {
        return $status;
    }
    $live = [];
    foreach (QR_STATIONS as $station) {
        $s = (string) ($order[$station . '_status'] ?? '');
        if ($s !== '' && $s !== 'cancelled') {
            $live[] = $s;
        }
    }
    if (!$live) {
        return $status;
    }
    if (count(array_keys($live, 'served', true)) === count($live)) {
        return 'served';
    }
    return in_array('accepted', $live, true) || in_array('served', $live, true) ? 'accepted' : 'new';
}

/** Who serves which table on an evening: table number => name. */
function qr_waiters(PDO $pdo, string $evening): array
{
    $stmt = $pdo->prepare('SELECT table_no, name FROM waiters WHERE evening = ? ORDER BY table_no');
    $stmt->execute([$evening]);
    $out = [];
    foreach ($stmt->fetchAll() as $row) {
        $out[(int) $row['table_no']] = (string) $row['name'];
    }
    return $out;
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
        // What the order comes to now: lines staff cancelled one by one are
        // off. orderedTotal is what was ordered (and, on the phone, paid).
        'total' => (int) $order['total_cents'] - (int) ($order['void_cents'] ?? 0),
        'orderedTotal' => (int) $order['total_cents'],
        'voided' => (int) ($order['void_cents'] ?? 0),
        'lang' => (string) $order['lang'],
        'createdAt' => (int) $order['created_at'],
        'updatedAt' => (int) $order['updated_at'],
        'seq' => (int) $order['seq'],
        'payStatus' => (string) ($order['pay_status'] ?? ''),
        'paidAt' => (int) ($order['paid_at'] ?? 0),
        'tabId' => (int) ($order['tab_id'] ?? 0),
        'guestName' => (string) ($order['guest_name'] ?? ''),
        // The evening (service date) it was ordered on: tonight's waiters
        // are shown only with tonight's orders.
        'evening' => (string) ($order['evening'] ?? ''),
        // Each station's part: '' when the order has nothing for it.
        'stations' => ['kitchen' => (string) ($order['kitchen_status'] ?? ''), 'bar' => (string) ($order['bar_status'] ?? '')],
        'payerName' => (string) ($order['payer_name'] ?? ''),
        'tillAt' => (int) ($order['till_at'] ?? 0),
        'tillVoidAt' => (int) ($order['till_void_at'] ?? 0),
        'tillCents' => (int) ($order['till_cents'] ?? 0),
        'tillVoidCents' => (int) ($order['till_void_cents'] ?? 0),
        // Paid on the phone: what is still owed back to the guest, and what
        // Stripe has returned so far.
        'refundDue' => max(0, (int) ($order['refund_due_cents'] ?? 0) - (int) ($order['refunded_cents'] ?? 0)),
        'refunded' => (int) ($order['refunded_cents'] ?? 0),
        'refundError' => (int) ($order['refund_error'] ?? 0) === 1,
    ];
    // For the till: what a phone-paid order comes to after refunds.
    $out['net'] = $out['payStatus'] === 'paid' ? $out['total'] : 0;
    if ($withLines) {
        $stmt = qr_db()->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
        $stmt->execute([(int) $order['id']]);
        $out['lines'] = [];
        foreach ($stmt->fetchAll() as $line) {
            $out['lines'][] = [
                'line' => (int) $line['line'],
                'station' => (string) ($line['station'] ?? '') !== '' ? (string) $line['station'] : qr_item_station((string) $line['item_id']),
                'itemId' => (string) $line['item_id'],
                'variantId' => (string) $line['variant_id'],
                'choiceId' => (string) $line['choice_id'],
                'nameBg' => (string) $line['name_bg'],
                'nameEn' => (string) $line['name_en'],
                'detailBg' => (string) $line['detail_bg'],
                'detailEn' => (string) $line['detail_en'],
                'size' => (string) $line['size'],
                'price' => (int) $line['unit_cents'],
                // qty: what is still on the order; voidQty of what was
                // ordered were cancelled by staff, for voidReason.
                'qty' => (int) $line['qty'] - (int) ($line['void_qty'] ?? 0),
                'voidQty' => (int) ($line['void_qty'] ?? 0),
                'voidReason' => (string) ($line['void_reason'] ?? ''),
                'note' => (string) $line['note'],
                'paidVia' => (string) ($line['paid_via'] ?? ''),
            ];
        }
        if ($out['tabId'] > 0) {
            // On a table's bill: how much of this order is paid so far.
            $paid = 0;
            $standing = 0;
            $refunded = false;
            foreach ($out['lines'] as $line) {
                if ($line['qty'] === 0) {
                    continue; // cancelled by staff, all of it
                }
                $standing++;
                $paid += $line['paidVia'] === 'online' || $line['paidVia'] === 'staff' ? 1 : 0;
                $refunded = $refunded || $line['paidVia'] === 'refunded';
            }
            $out['payStatus'] = $refunded ? 'refunded'
                : ($paid === 0 ? 'tab' : ($paid === $standing ? 'tab_paid' : 'tab_partial'));
        }
    }
    return $out;
}
