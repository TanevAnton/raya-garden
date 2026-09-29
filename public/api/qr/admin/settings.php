<?php
// POST /api/qr/admin/settings.php — the evening's set-up. Any of:
//   {"date": "2026-10-03", "opens": "18:00", "closes": "01:00"}   window (Sofia
//        time; a closing time at or before the opening time is the next day)
//   {"tables": 24, "disabledTables": [7, 13]}
//   {"paused": true}                                             stop / resume
//   {"paymentMode": "on_site"|"online"|"tab"}   guests pay staff; on the phone
//        before the order goes out; or at the end, from the table's bill —
//        "online" and "tab" only once Stripe is configured, else 409
// Keys left out keep their value, so the pause button sends only "paused".
//
// ⚠ PHP 7.3 on the production host — see ../_lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require dirname(__DIR__) . '/_lib/core.php';
require dirname(__DIR__) . '/_lib/auth.php';

qr_require_method('POST');
qr_require_admin(true);
$body = qr_body();
$now = qr_now();
$current = qr_settings();
$update = [];

if (array_key_exists('date', $body) || array_key_exists('opens', $body) || array_key_exists('closes', $body)) {
    $date = $body['date'] ?? null;
    $opens = $body['opens'] ?? null;
    $closes = $body['closes'] ?? null;
    $window = is_string($date) && is_string($opens) && is_string($closes) ? qr_window($date, $opens, $closes) : [];
    if (!$window || $window[1] - $window[0] > 26 * 3600) {
        qr_fail(400, 'invalid', ['field' => 'window']);
    }
    $update += [
        'service_date' => $date,
        'opens_local' => $opens,
        'closes_local' => $closes,
        'opens_at' => $window[0],
        'closes_at' => $window[1],
    ];
}
$tables = array_key_exists('tables', $body) ? $body['tables'] : (int) $current['tables'];
if (array_key_exists('tables', $body)) {
    if (!is_int($tables) || $tables < 1 || $tables > QR_MAX_TABLES) {
        qr_fail(400, 'invalid', ['field' => 'tables']);
    }
    $update['tables'] = $tables;
}
if (array_key_exists('disabledTables', $body) || array_key_exists('tables', $body)) {
    $disabled = array_key_exists('disabledTables', $body)
        ? $body['disabledTables']
        : qr_int_list((string) $current['disabled_tables']);
    if (!is_array($disabled)) {
        qr_fail(400, 'invalid', ['field' => 'disabledTables']);
    }
    $clean = [];
    foreach ($disabled as $n) {
        if (!is_int($n)) {
            qr_fail(400, 'invalid', ['field' => 'disabledTables']);
        }
        if ($n >= 1 && $n <= $tables) {
            $clean[$n] = $n;
        }
    }
    ksort($clean);
    $update['disabled_tables'] = json_encode(array_values($clean));
}
if (array_key_exists('paused', $body)) {
    if (!is_bool($body['paused'])) {
        qr_fail(400, 'invalid', ['field' => 'paused']);
    }
    $update['paused'] = $body['paused'] ? 1 : 0;
}
if (array_key_exists('paymentMode', $body)) {
    if (!in_array($body['paymentMode'], ['on_site', 'online', 'tab'], true)) {
        qr_fail(400, 'invalid', ['field' => 'paymentMode']);
    }
    if ($body['paymentMode'] !== 'on_site' && !qr_stripe_configured()) {
        qr_fail(409, 'payments_not_configured');
    }
    $update['payment_mode'] = $body['paymentMode'];
}
if (!$update) {
    qr_fail(400, 'invalid', ['field' => 'body']);
}

$settings = qr_write(function (PDO $pdo) use ($update, $now) {
    $update['seq'] = qr_bump_seq($pdo);
    $update['updated_at'] = $now;
    $sets = [];
    foreach (array_keys($update) as $column) {
        $sets[] = $column . ' = ?';
    }
    $pdo->prepare('UPDATE settings SET ' . implode(', ', $sets) . ' WHERE id = 1')->execute(array_values($update));
    return $pdo->query('SELECT * FROM settings WHERE id = 1')->fetch();
});
qr_json(200, ['ok' => true, 'state' => qr_state($settings, $now), 'seq' => (int) $settings['seq']]);
