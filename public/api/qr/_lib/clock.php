<?php
// Phone payments into Clock PMS+, so Clock issues the fiscal receipt.
//
// Every payment Stripe confirms (an order paid on the phone, or a payment
// from a table's bill) becomes a sale in Clock: a folio of its own on the
// company configured for it, with
//
//   1. POST /companies/{company}/folios         the folio
//   2. POST /folios/{id}/charges/bulk           a charge per line, the tip apart
//   3. POST /folios/{id}/credit_items           the card payment, Stripe's pi_…
//   4. POST /folios/{id}/close                  closed: the fiscal receipt
//
// Step 4 only when 'clock_close' is on. Until then the folio waits, paid, for
// staff to close it in Clock (which prints the receipt as it does for any
// folio), and „За касата“ says which one.
//
// Money given back (a line taken off, an order cancelled, a refund in
// Stripe's Dashboard, a line of a bill someone else paid first) becomes a
// storno, as Clock advised (15.10.2026): the card money given back as a
// negative payment on the sale's folio, then a correction folio linked to it
// (client_folio_id) with the same charges at a negative quantity, closed.
//
// When. The row is queued in the same transaction that records the payment
// or the refund (qr_clock_sale, qr_clock_refunds), so it can never be lost
// or made twice. It is sent once that request's answer has gone
// (fastcgi_finish_request), and again from each staff-screen poll while
// anything is due: Stripe and the tablet never wait for Clock, and Clock
// being down never fails a webhook.
//
// Exactly once, without idempotency keys (Clock's API has none):
//   - a row is claimed ('sending') in a write transaction before it is sent,
//     so two requests never send the same one;
//   - each step is saved as soon as Clock answers, and a retry goes on from
//     the next step;
//   - before a step whose answer never came back (timeout, lost
//     connection) is sent again, Clock is asked whether it happened: the
//     charges carry "QR <code> #<doc>" in print_text, the payment carries
//     the pi_… reference, a closed folio has closed_at. Where Clock cannot be
//     asked (no right to read charges), the row stops at 'check' for a
//     person, instead of risking a second charge.
//   - A folio whose making was never confirmed is left empty in Clock; an
//     empty open folio is harmless.
//
// „За касата“ stays the fallback: a sale done in Clock ticks its order or
// payment as entered there; a storno done ticks it as voided. One ticked by
// hand before it was sent is never sent ('manual'). One that fails waits there
// with Clock's reason and *Опитай пак*.
//
// Configuration (raya-qr-config.php, above the web root; written by the
// deploy from GitHub secrets — see docs/qr-ordering/SETUP.md):
//   'clock_mode'              'off' (default), 'test' or 'live'. 'test' sends
//                             only payments made with Stripe's test keys,
//                             'live' only real ones: a test payment never
//                             reaches the real till.
//   'clock_base_url'          https://sky-eu1.clock-software.com/base_api/{subscription}/{account}
//   'clock_api_user', 'clock_api_key'   HTTP Digest
//   'clock_company_id'        the company the folios are made on ("Accept
//                             charge transfers" ticked in Clock)
//   'clock_close'             'on' to close the folios here (step 4)
//   'clock_document_type_id'  what closing makes (the fiscal receipt)
//   'clock_storno_document_type_id'  the same for a storno, if different
//   'clock_currency'          overrides clock-settings.php ('BGN' in the sandbox)
//   'clock_payment_type', 'clock_payment_sub_type'   what the card payment is
//                             booked as ('card', ''): one the fiscal printer
//                             is set up to fiscalise (GET /payment_sub_types)
// Which charge template each menu category goes under: clock-settings.php.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/ereceipt.php';

const QR_CLOCK_TRIES = 6;           // sends per row before it stops at 'failed'
const QR_CLOCK_BACKOFF = [60, 300, 900, 3600, 10800]; // seconds after the 1st, 2nd … failure
const QR_CLOCK_STALE_SEND = 120;    // a claim not finished by then counts as lost
const QR_CLOCK_GAP_US = 250000;     // Clock allows 5 requests a second
const QR_CLOCK_BULK = 100;          // charges per bulk call, Clock's limit

function qr_clock_settings(): array
{
    static $settings = null;
    if ($settings === null) {
        $loaded = require __DIR__ . '/clock-settings.php';
        $settings = is_array($loaded) ? $loaded : [];
    }
    return $settings;
}

/** Everything needed to reach Clock is set. */
function qr_clock_configured(): bool
{
    $config = qr_config();
    foreach (['clock_base_url', 'clock_api_user', 'clock_api_key'] as $key) {
        if (trim((string) ($config[$key] ?? '')) === '') {
            return false;
        }
    }
    return (int) ($config['clock_company_id'] ?? 0) > 0;
}

/**
 * Which payments go to Clock now: 'test' (made with Stripe's test keys),
 * 'live' (real ones), or '' — none. A mode that does not match the Stripe
 * keys sends nothing, so test payments never reach the real till.
 */
function qr_clock_mode(): string
{
    $mode = (string) (qr_config()['clock_mode'] ?? 'off');
    if (($mode !== 'test' && $mode !== 'live') || !qr_clock_configured()) {
        return '';
    }
    $test = qr_stripe_test_mode();
    return ($mode === 'test') === $test ? $mode : '';
}

/** Close the folios here (step 4), or leave them for staff to close in Clock. */
function qr_clock_closes(): bool
{
    $config = qr_config();
    return (string) ($config['clock_close'] ?? '') === 'on' && (int) ($config['clock_document_type_id'] ?? 0) > 0;
}

function qr_clock_currency(): string
{
    $config = qr_config();
    $currency = (string) ($config['clock_currency'] ?? '');
    if ($currency === '') {
        $currency = (string) (qr_clock_settings()['currency'] ?? 'EUR');
    }
    return strtoupper($currency);
}

// ── queueing (inside the payment's or refund's write transaction) ────

/**
 * The lines of a payment as Clock gets them: the e-receipt's lines (the same
 * ones, so the two never disagree), each with its category and station for
 * the charge template.
 */
function qr_clock_lines(PDO $pdo, string $source, array $row): array
{
    $items = [];
    if ($source === 'order') {
        $stmt = $pdo->prepare('SELECT line, item_id FROM order_items WHERE order_id = ?');
        $stmt->execute([(int) $row['id']]);
        foreach ($stmt->fetchAll() as $i) {
            $items['o' . $i['line']] = (string) $i['item_id'];
        }
    } else {
        $stmt = $pdo->prepare('SELECT b.order_id, b.line, i.item_id FROM bill_payment_items b
            JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line WHERE b.payment_id = ?');
        $stmt->execute([(int) $row['id']]);
        foreach ($stmt->fetchAll() as $i) {
            $items['b' . $i['order_id'] . '.' . $i['line']] = (string) $i['item_id'];
        }
    }
    $index = qr_menu_index();
    $lines = [];
    foreach (qr_ereceipt_paid_lines($pdo, $source, $row) as $line) {
        $item = $index[$items[$line['key']] ?? ''] ?? null;
        $lines[] = [
            'key' => $line['key'],
            'name' => $line['name'],
            'qty' => (int) $line['qty'],
            'unit' => (int) $line['unit'],
            'category' => $line['key'] === 'tip' ? 'tip' : (string) ($item['category'] ?? ''),
            'station' => $line['key'] === 'tip' ? 'tip' : (string) ($item['station'] ?? 'kitchen'),
        ];
    }
    return $lines;
}

/** The evening an order or bill payment belongs to, for Clock's service date. */
function qr_clock_evening(PDO $pdo, string $source, array $row, int $now): string
{
    if ($source === 'order' && (string) ($row['evening'] ?? '') !== '') {
        return (string) $row['evening'];
    }
    if ($source === 'bill') {
        $find = $pdo->prepare('SELECT evening FROM tabs WHERE id = ?');
        $find->execute([(int) $row['tab_id']]);
        $evening = $find->fetchColumn();
        $find->closeCursor();
        if (is_string($evening) && $evening !== '') {
            return $evening;
        }
    }
    $at = new DateTime('@' . $now);
    $at->setTimezone(new DateTimeZone('Europe/Sofia'));
    return $at->format('Y-m-d');
}

function qr_clock_find_sale(PDO $pdo, string $source, int $sourceId)
{
    $find = $pdo->prepare("SELECT * FROM clock_docs WHERE source = ? AND source_id = ? AND kind = 'sale'");
    $find->execute([$source, $sourceId]);
    $sale = $find->fetch();
    $find->closeCursor();
    return is_array($sale) ? $sale : null;
}

/**
 * Stripe has confirmed a payment: queue its sale for Clock, once. Inside the
 * webhook's transaction; $row is the order or bill payment as it was before
 * the webhook marked it paid (its id, code, tip and lines are what count).
 */
function qr_clock_sale(PDO $pdo, string $source, array $row, array $session, int $now)
{
    $mode = qr_clock_mode();
    if ($mode === '' || qr_clock_find_sale($pdo, $source, (int) $row['id']) !== null) {
        return;
    }
    $lines = qr_clock_lines($pdo, $source, $row);
    qr_clock_insert($pdo, [
        'test' => $mode === 'test' ? 1 : 0,
        'kind' => 'sale',
        'sale_id' => 0,
        'source' => $source,
        'source_id' => (int) $row['id'],
        'code' => (string) $row['code'],
        'payment_intent' => (string) ($session['payment_intent'] ?? ''),
        'evening' => qr_clock_evening($pdo, $source, $row, $now),
        'lines' => $lines,
        'total' => qr_ereceipt_lines_total($lines),
        'tip' => (int) $row['tip_cents'],
    ], $now);
}

function qr_clock_insert(PDO $pdo, array $doc, int $now): int
{
    $pdo->prepare('INSERT INTO clock_docs (test, kind, sale_id, source, source_id, code, payment_intent, evening,
        lines_json, total_cents, tip_cents, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $doc['test'], $doc['kind'], $doc['sale_id'], $doc['source'], $doc['source_id'], $doc['code'],
            $doc['payment_intent'], $doc['evening'], json_encode($doc['lines'], JSON_UNESCAPED_UNICODE),
            $doc['total'], $doc['tip'], $now, qr_bump_seq($pdo),
        ]);
    qr_clock_send_later($now);
    return (int) $pdo->lastInsertId();
}

/**
 * Money has gone back on this payment: a storno for whatever was refunded
 * and no earlier storno covers, for exactly the lines that went back (as the
 * e-receipt's storno). Inside the refund's write transaction. Nothing if the
 * sale never went to Clock (sent before this was switched on, or entered by
 * hand: then the refund is voided by hand too, from „За касата“).
 */
function qr_clock_refunds(PDO $pdo, string $source, int $sourceId, int $now)
{
    $sale = qr_clock_find_sale($pdo, $source, $sourceId);
    if ($sale === null || $sale['status'] === 'manual') {
        return;
    }
    $table = $source === 'order' ? 'orders' : 'bill_payments';
    $find = $pdo->prepare("SELECT * FROM $table WHERE id = ?");
    $find->execute([$sourceId]);
    $row = $find->fetch();
    $find->closeCursor();
    if (!is_array($row)) {
        return;
    }
    $refunded = (int) $row['refunded_cents'];
    if ($source === 'order' && $row['pay_status'] === 'refunded') {
        $refunded = max($refunded, (int) $row['total_cents'] + (int) $row['tip_cents']);
    }
    $before = $pdo->prepare("SELECT lines_json, total_cents FROM clock_docs WHERE sale_id = ? AND kind = 'storno'");
    $before->execute([(int) $sale['id']]);
    $covered = 0;
    $taken = [];
    foreach ($before->fetchAll() as $storno) {
        $covered += (int) $storno['total_cents'];
        foreach (json_decode((string) $storno['lines_json'], true) as $line) {
            $taken[$line['key']] = ($taken[$line['key']] ?? 0) + (int) $line['qty'];
        }
    }
    $amount = min($refunded, (int) $sale['total_cents']) - $covered;
    if ($amount <= 0) {
        return;
    }
    $saleLines = json_decode((string) $sale['lines_json'], true);
    $back = qr_ereceipt_returned($pdo, $source, $row, $saleLines);
    $lines = [];
    foreach ($saleLines as $line) {
        $qty = ($back[$line['key']] ?? 0) - ($taken[$line['key']] ?? 0);
        if ($qty > 0) {
            $lines[] = ['qty' => $qty] + $line;
        }
    }
    if (qr_ereceipt_lines_total($lines) !== $amount) {
        // Lines and money disagree (a partial refund made in Stripe's
        // Dashboard): the amount, under the first line's template.
        $first = $saleLines[0] ?? ['category' => '', 'station' => 'kitchen'];
        $lines = [['key' => 'refund', 'name' => 'Върната сума', 'qty' => 1, 'unit' => $amount,
            'category' => (string) $first['category'], 'station' => (string) $first['station']]];
    }
    $tip = 0;
    foreach ($lines as $line) {
        if ($line['key'] === 'tip') {
            $tip += $line['qty'] * $line['unit'];
        }
    }
    qr_clock_insert($pdo, [
        'test' => (int) $sale['test'],
        'kind' => 'storno',
        'sale_id' => (int) $sale['id'],
        'source' => $source,
        'source_id' => $sourceId,
        'code' => (string) $sale['code'],
        'payment_intent' => (string) $sale['payment_intent'],
        'evening' => qr_clock_evening($pdo, $source, $row, $now),
        'lines' => $lines,
        'total' => $amount,
        'tip' => $tip,
    ], $now);
}

// ── sending ──────────────────────────────────────────────────────────

/** Once this request's answer has gone, send what is due. Registered once. */
function qr_clock_send_later(int $now)
{
    static $registered = false;
    if (!$registered) {
        $registered = true;
        register_shutdown_function('qr_clock_after_response', $now);
    }
}

function qr_clock_after_response(int $now)
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ignore_user_abort(true);
    @set_time_limit(120);
    try {
        qr_clock_send_due($now);
    } catch (Throwable $e) {
        error_log('raya-qr clock: ' . $e->getMessage());
    }
}

// Due: new; failed and its wait is over; or claimed so long ago that the
// request sending it must have died. A storno waits for its sale.
const QR_CLOCK_DUE = "(status = 'pending' OR (status = 'failed' AND tries < ? AND next_at <= ?)
    OR (status = 'sending' AND claimed_at < ?))
    AND (kind = 'sale' OR sale_id IN (SELECT id FROM clock_docs WHERE status = 'done'))";

/** For the staff screen's poll: anything to send to Clock? */
function qr_clock_due(PDO $pdo, int $now): bool
{
    if (!qr_clock_configured()) {
        return false;
    }
    $stmt = $pdo->prepare('SELECT 1 FROM clock_docs WHERE ' . QR_CLOCK_DUE . ' LIMIT 1');
    $stmt->execute([QR_CLOCK_TRIES, $now, $now - QR_CLOCK_STALE_SEND]);
    $due = $stmt->fetchColumn() !== false;
    $stmt->closeCursor();
    return $due;
}

/**
 * Send what is due, oldest first. Each row is claimed in a write
 * transaction, and handed to staff instead when they have entered it by
 * hand meanwhile. Clock is called outside any transaction.
 */
function qr_clock_send_due(int $now)
{
    if (!qr_clock_configured()) {
        return;
    }
    for ($i = 0; $i < 10; $i++) {
        $doc = qr_write(function (PDO $pdo) use ($now) {
            $find = $pdo->prepare('SELECT * FROM clock_docs WHERE ' . QR_CLOCK_DUE . ' ORDER BY id LIMIT 1');
            $find->execute([QR_CLOCK_TRIES, $now, $now - QR_CLOCK_STALE_SEND]);
            $doc = $find->fetch();
            $find->closeCursor();
            if (!is_array($doc)) {
                return null;
            }
            if ((int) $doc['step'] === 0 && qr_clock_entered_by_hand($pdo, $doc)) {
                qr_clock_set_manual($pdo, $doc);
                return false;
            }
            $pdo->prepare("UPDATE clock_docs SET status = 'sending', tries = tries + 1, claimed_at = ?, seq = ? WHERE id = ?")
                ->execute([$now, qr_bump_seq($pdo), $doc['id']]);
            $doc['tries'] = (int) $doc['tries'] + 1;
            return $doc;
        });
        if ($doc === null) {
            return;
        }
        if ($doc === false) {
            continue;
        }
        try {
            $result = qr_clock_push($doc);
        } catch (Throwable $e) {
            $result = ['failed', 'internal error: ' . $e->getMessage()];
        }
        qr_clock_finish($doc, $result[0], $result[1], $now);
    }
}

/**
 * Staff entered the sale on „За касата“ before it went. (A tick by hand
 * marks the rows it covers at once — qr_clock_hand_tick; this catches a sale
 * ticked while nothing was queued yet. A storno is not judged by the void
 * tick: an earlier storno sets that too.)
 */
function qr_clock_entered_by_hand(PDO $pdo, array $doc): bool
{
    if ($doc['kind'] !== 'sale') {
        return false;
    }
    $table = $doc['source'] === 'order' ? 'orders' : 'bill_payments';
    $find = $pdo->prepare("SELECT till_at FROM $table WHERE id = ?");
    $find->execute([(int) $doc['source_id']]);
    $at = (int) $find->fetchColumn();
    $find->closeCursor();
    return $at > 0;
}

/** Entered by hand: never sent. A sale's stornos follow it, to be voided by hand too. */
function qr_clock_set_manual(PDO $pdo, array $doc)
{
    $seq = qr_bump_seq($pdo);
    $pdo->prepare("UPDATE clock_docs SET status = 'manual', error = '', seq = ? WHERE id = ?")->execute([$seq, $doc['id']]);
    if ($doc['kind'] === 'sale') {
        $pdo->prepare("UPDATE clock_docs SET status = 'manual', error = '', seq = ? WHERE sale_id = ? AND status <> 'done'")
            ->execute([$seq, $doc['id']]);
    }
}

/**
 * The outcome of a send: 'done', 'failed' (tried again later) or 'check' (a
 * person looks). A sale or storno done ticks „За касата“ for it.
 */
function qr_clock_finish(array $doc, string $status, string $error, int $now)
{
    qr_write(function (PDO $pdo) use ($doc, $status, $error, $now) {
        $seq = qr_bump_seq($pdo);
        $tries = (int) $doc['tries'];
        $wait = QR_CLOCK_BACKOFF[min($tries, count(QR_CLOCK_BACKOFF)) - 1] ?? 3600;
        // Only a row still ours: staff may have taken it over by hand meanwhile.
        $update = $pdo->prepare("UPDATE clock_docs SET status = ?, error = ?, next_at = ?, done_at = ?, seq = ? WHERE id = ? AND status = 'sending'");
        $update->execute([$status, mb_substr($error, 0, 300), $status === 'failed' ? $now + $wait : 0,
            $status === 'done' ? $now : 0, $seq, $doc['id']]);
        if ($update->rowCount() === 0) {
            error_log('raya-qr clock: row ' . $doc['id'] . ' was taken over by hand while sending (' . $status . ')');
            return;
        }
        if ($status === 'done') {
            qr_clock_tick($pdo, $doc, $seq, $now);
        }
    });
}

/** „За касата“: a sale in Clock is entered there; a storno in Clock voids what went back. */
function qr_clock_tick(PDO $pdo, array $doc, int $seq, int $now)
{
    $order = $doc['source'] === 'order';
    $table = $order ? 'orders' : 'bill_payments';
    $find = $pdo->prepare("SELECT * FROM $table WHERE id = ?");
    $find->execute([(int) $doc['source_id']]);
    $row = $find->fetch();
    $find->closeCursor();
    if (!is_array($row)) {
        return;
    }
    if ($doc['kind'] === 'sale') {
        if ((int) $row['till_at'] > 0) {
            return;
        }
        // What went into Clock: the lines, without the tip — as staff would
        // have entered it. A refund since then is voided by its storno.
        $entered = (int) $doc['total_cents'] - (int) $doc['tip_cents'];
        $pdo->prepare("UPDATE $table SET till_at = ?, till_cents = ?, till_void_at = 0, till_void_cents = 0, seq = ? WHERE id = ?")
            ->execute([$now, $entered, $seq, $doc['source_id']]);
    } else {
        if ((int) $row['till_at'] === 0) {
            return;
        }
        // What still stands of the sale (as qr_order_json / qr_bill_payment_json count it).
        $net = $order ? qr_order_json($row, false)['net']
            : (int) $row['amount_cents'] - min((int) $row['refund_due_cents'], (int) $row['amount_cents']);
        $void = max(0, (int) $row['till_cents'] - $net);
        $pdo->prepare("UPDATE $table SET till_void_at = ?, till_void_cents = ?, seq = ? WHERE id = ?")
            ->execute([$void > 0 ? $now : 0, $void, $seq, $doc['source_id']]);
    }
    if (!$order && (int) $row['tab_id'] > 0 && function_exists('qr_touch_tab')) {
        qr_touch_tab($pdo, (int) $row['tab_id'], $seq);
    }
}

/** Save how far a row got, as soon as Clock has answered. */
function qr_clock_progress(int $id, array $fields)
{
    qr_write(function (PDO $pdo) use ($id, $fields) {
        $sets = [];
        $values = [];
        foreach ($fields as $column => $value) {
            $sets[] = "$column = ?";
            $values[] = $value;
        }
        $sets[] = 'seq = ?';
        $values[] = qr_bump_seq($pdo);
        $values[] = $id;
        $pdo->prepare('UPDATE clock_docs SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($values);
    });
}

// ── Clock's API ──────────────────────────────────────────────────────

/**
 * One call to Clock's base_api. Returns [httpStatus, decodedBody]; status 0
 * when no answer came back (it may or may not have happened). HTTP Digest,
 * on one cURL handle per request: after the first challenge curl answers the
 * next ones up front, so each call is one round trip, spaced for Clock's 5 a
 * second. The key is never logged or returned.
 */
function qr_clock_call(string $method, string $path, $body = null): array
{
    static $ch = null;
    static $last = 0.0;
    $config = qr_config();
    $base = rtrim((string) ($config['clock_base_url'] ?? ''), '/');
    // Tests point this at a fake Clock; production never sets RAYA_QR_TEST.
    $override = getenv('RAYA_QR_CLOCK_API');
    if (getenv('RAYA_QR_TEST') === '1' && is_string($override) && $override !== '') {
        $base = rtrim($override, '/');
    }
    $wait = (int) (QR_CLOCK_GAP_US - (microtime(true) - $last) * 1000000);
    if ($last > 0 && $wait > 0) {
        usleep($wait);
    }
    $last = microtime(true);
    if ($ch === null) {
        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPAUTH => CURLAUTH_DIGEST,
            CURLOPT_USERPWD => (string) ($config['clock_api_user'] ?? '') . ':' . (string) ($config['clock_api_key'] ?? ''),
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 20,
            // A fresh connection each call: on a reused one that breaks, curl
            // silently sends the request again — a second charge or payment.
            // A lost answer must come back here as status 0, and be asked about.
            CURLOPT_FORBID_REUSE => true,
            CURLOPT_FRESH_CONNECT => true,
        ]);
    }
    $headers = ['Accept: application/json'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE));
    } else {
        curl_setopt($ch, CURLOPT_HTTPGET, true);
    }
    curl_setopt($ch, CURLOPT_URL, $base . $path);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    if ($raw === false || $status === 0) {
        // A broken connection: start the next call afresh.
        $ch = null;
        return [0, []];
    }
    $decoded = json_decode((string) $raw, true);
    return [$status, is_array($decoded) ? $decoded : []];
}

/** Clock's reason, for staff and the log: "HTTP 403: The User doesn't have …". */
function qr_clock_reason(int $status, array $body): string
{
    if ($status === 0) {
        return 'Clock did not answer';
    }
    $error = $body['error'] ?? ($body['errors'] ?? '');
    if (is_array($error)) {
        $error = json_encode($error, JSON_UNESCAPED_UNICODE);
    }
    return 'HTTP ' . $status . ($error !== '' ? ': ' . $error : '');
}

function qr_clock_ok(int $status): bool
{
    return $status >= 200 && $status < 300;
}

/** A price for Clock: cents as a decimal number. */
function qr_clock_money(int $cents): string
{
    return number_format($cents / 100, 2, '.', '');
}

/** The template a line is booked under: its category's, else its station's. 0: none. */
function qr_clock_template(array $line): int
{
    $templates = qr_clock_settings()['templates'] ?? [];
    $category = (string) ($line['category'] ?? '');
    if ($category !== '' && (int) ($templates[$category] ?? 0) > 0) {
        return (int) $templates[$category];
    }
    return (int) ($templates[(string) ($line['station'] ?? '')] ?? 0);
}

/** The marker on each charge of a row, to find them again after a lost answer. */
function qr_clock_marker(array $doc): string
{
    return 'QR ' . $doc['code'] . ' #' . $doc['id'];
}

/** The charges for a row: a storno's at a negative quantity (Clock's way to void). */
function qr_clock_charges(array $doc): array
{
    $sign = $doc['kind'] === 'storno' ? -1 : 1;
    $settings = qr_clock_settings();
    $currency = qr_clock_currency();
    $charges = [];
    foreach (json_decode((string) $doc['lines_json'], true) as $line) {
        $template = qr_clock_template($line);
        $charge = [
            'text' => mb_substr((string) $line['name'], 0, 120),
            'price' => qr_clock_money((int) $line['unit']),
            'qty' => $sign * (int) $line['qty'],
            'currency' => $currency,
            'service_date' => (string) $doc['evening'],
            'print_text' => qr_clock_marker($doc),
        ];
        if ($template > 0) {
            $charge['charge_template_id'] = $template;
        }
        if ($line['key'] === 'tip' && $template === 0) {
            $charge['revenue_group'] = 'surcharge';
            $charge['tax_rate'] = 0;
        } elseif (isset($settings['tax_rate']) && is_numeric($settings['tax_rate'])) {
            $charge['tax_rate'] = (float) $settings['tax_rate'];
        }
        $charges[] = $charge;
    }
    return $charges;
}

/** Lines no template covers: such a row is not sent. */
function qr_clock_unmapped(array $doc): array
{
    $missing = [];
    foreach (json_decode((string) $doc['lines_json'], true) as $line) {
        if ($line['key'] !== 'tip' && qr_clock_template($line) === 0) {
            $missing[(string) ($line['category'] !== '' ? $line['category'] : $line['station'])] = true;
        }
    }
    return array_keys($missing);
}

/**
 * Take a row through Clock, from the step it got to. Returns [status,
 * error]: 'done', 'failed' or 'check'.
 *
 *   a sale     1 its folio · 2 the charges · 3 the card payment · 4 closed
 *   a storno   1 the money given back: a negative card payment on the
 *                sale's folio — Clock wants it there, before the correction
 *                document (their answer, 15.10.2026)
 *              2 a correction folio, linked to the sale's (client_folio_id)
 *              3 the lines that went back, at negative quantities
 *              4 closed: the storno receipt
 *
 * Step 4 only when 'clock_close' is on. A step whose answer was lost
 * ('inflight') is looked up in Clock before it is sent again.
 */
function qr_clock_push(array $doc): array
{
    $missing = qr_clock_unmapped($doc);
    if ($missing) {
        return ['failed', 'no charge template for: ' . implode(', ', $missing) . ' (clock-settings.php)'];
    }
    $storno = $doc['kind'] === 'storno';
    $steps = $storno ? ['refund', 'folio', 'charges', 'close'] : ['folio', 'charges', 'payment', 'close'];
    $state = ['folio' => (int) $doc['folio_id'], 'number' => (string) $doc['folio_number'], 'sale_folio' => 0, 'sale_number' => ''];
    if ($storno) {
        $find = qr_db()->prepare('SELECT folio_id, folio_number FROM clock_docs WHERE id = ?');
        $find->execute([(int) $doc['sale_id']]);
        $sale = $find->fetch();
        $find->closeCursor();
        if (!is_array($sale) || (int) $sale['folio_id'] === 0) {
            return ['failed', 'its sale is not in Clock'];
        }
        $state['sale_folio'] = (int) $sale['folio_id'];
        $state['sale_number'] = (string) $sale['folio_number'];
    }
    for ($i = (int) $doc['step']; $i < 4; $i++) {
        $name = $steps[$i];
        if ($name === 'close' && !qr_clock_closes()) {
            break;
        }
        $lost = (int) $doc['inflight'] === $i + 1;
        $doc['inflight'] = 0; // only the step the row stopped at can have lost its answer
        list($status, $error) = qr_clock_step($name, $doc, $state, $i + 1, $lost);
        if ($status !== '') {
            return [$status, $error];
        }
        qr_clock_progress((int) $doc['id'], ['step' => $i + 1, 'inflight' => 0]);
    }
    return ['done', ''];
}

/**
 * One step of a row (see qr_clock_push). $state carries the folios between
 * steps. Returns ['', ''] when done, else [status, error].
 */
function qr_clock_step(string $name, array $doc, array &$state, int $number, bool $lost): array
{
    $id = (int) $doc['id'];
    $config = qr_config();
    $storno = $doc['kind'] === 'storno';
    // Send it, remembering it is on its way: no answer (status 0) leaves that
    // mark, so the next try looks in Clock first.
    $send = function (string $method, string $path, $body) use ($id, $number) {
        qr_clock_progress($id, ['inflight' => $number]);
        list($status, $answer) = qr_clock_call($method, $path, $body);
        if ($status !== 0) {
            qr_clock_progress($id, ['inflight' => 0]);
        }
        return [$status, $answer];
    };

    if ($name === 'folio') {
        // One whose making never answered is left behind in Clock, empty.
        $folio = ['currency' => qr_clock_currency()];
        if ($storno) {
            $folio['client_folio_id'] = $state['sale_folio'];
        }
        list($status, $body) = $send('POST', '/companies/' . (int) $config['clock_company_id'] . '/folios', ['company_folio' => $folio]);
        if (!qr_clock_ok($status) || empty($body['id'])) {
            qr_clock_progress($id, ['inflight' => 0]);
            return ['failed', qr_clock_reason($status, $body)];
        }
        $state['folio'] = (int) $body['id'];
        $state['number'] = (string) ($body['number'] ?? '');
        qr_clock_progress($id, ['folio_id' => $state['folio'], 'folio_number' => $state['number']]);
        return ['', ''];
    }

    if ($name === 'charges') {
        $charges = qr_clock_charges($doc);
        $already = 0;
        if ($lost) {
            list($status, $found) = qr_clock_call('GET', '/folios/' . $state['folio'] . '/charges');
            if (!qr_clock_ok($status)) {
                return ['check', 'charges may have reached folio ' . $state['number'] . ' — check it in Clock (' . qr_clock_reason($status, $found) . ')'];
            }
            foreach ($found as $charge) {
                if (is_array($charge) && (string) ($charge['print_text'] ?? '') === qr_clock_marker($doc) && empty($charge['voided_at'])) {
                    $already++;
                }
            }
        }
        foreach (array_chunk(array_slice($charges, $already), QR_CLOCK_BULK) as $chunk) {
            list($status, $body) = $send('POST', '/folios/' . $state['folio'] . '/charges/bulk', ['charges' => $chunk]);
            if (!qr_clock_ok($status)) {
                return ['failed', qr_clock_reason($status, $body)];
            }
        }
        return ['', ''];
    }

    if ($name === 'payment' || $name === 'refund') {
        // The card payment on the sale's own folio; money given back, on the
        // sale's folio too, negative.
        $folio = $name === 'refund' ? $state['sale_folio'] : $state['folio'];
        $number = $name === 'refund' ? $state['sale_number'] : $state['number'];
        $reference = (string) $doc['payment_intent'] . ($storno ? ' #' . $id : '');
        if ($lost) {
            list($status, $found) = qr_clock_call('GET', '/folios/' . $folio . '/credit_items');
            if (!qr_clock_ok($status)) {
                return ['check', 'the payment may have reached folio ' . $number . ' — check it in Clock (' . qr_clock_reason($status, $found) . ')'];
            }
            foreach ($found as $item) {
                if (is_array($item) && (string) ($item['reference'] ?? '') === $reference && empty($item['voided_at'])) {
                    return ['', ''];
                }
            }
        }
        list($status, $body) = $send('POST', '/folios/' . $folio . '/credit_items', ['credit_item' => [
            'currency' => qr_clock_currency(),
            'value' => ($storno ? '-' : '') . qr_clock_money((int) $doc['total_cents']),
            'text' => ($storno ? 'QR меню – върнато ' : 'QR меню – платено ') . $doc['code'],
            'payment_type' => (string) ($config['clock_payment_type'] ?? '') !== '' ? (string) $config['clock_payment_type'] : 'card',
            'payment_sub_type' => (string) ($config['clock_payment_sub_type'] ?? ''),
            'reference' => $reference,
        ]]);
        if (!qr_clock_ok($status)) {
            return ['failed', qr_clock_reason($status, $body)];
        }
        return ['', ''];
    }

    // close: the fiscal receipt (or the storno receipt).
    if ($lost) {
        list($status, $found) = qr_clock_call('GET', '/folios/' . $state['folio']);
        if (qr_clock_ok($status) && !empty($found['closed_at'])) {
            return ['', ''];
        }
    }
    $type = (int) ($storno && (int) ($config['clock_storno_document_type_id'] ?? 0) > 0
        ? $config['clock_storno_document_type_id'] : $config['clock_document_type_id']);
    list($status, $body) = $send('POST', '/folios/' . $state['folio'] . '/close', ['document_type_id' => $type]);
    if (!qr_clock_ok($status)) {
        return ['failed', qr_clock_reason($status, $body)];
    }
    return ['', ''];
}

// ── staff ticking by hand („За касата“) ──────────────────────────────

/**
 * Staff tick (or untick) a payment on „За касата“ by hand: $column 'till_at'
 * (entered in Clock) or 'till_void_at' (voided there). Inside till.php's write
 * transaction, before the tick is saved. Returns '' to go ahead, or why not:
 *   'clock_sending'  it is being sent right now: wait a moment;
 *   'clock_done'     Clock has it already: unticking would ask for it twice.
 * A tick wins over a send that has not started or has stopped: the row is
 * then never sent ('manual'), stornos of a sale included.
 */
function qr_clock_hand_tick(PDO $pdo, string $source, int $sourceId, string $column, bool $value, int $now): string
{
    $kind = $column === 'till_at' ? 'sale' : 'storno';
    $find = $pdo->prepare('SELECT * FROM clock_docs WHERE source = ? AND source_id = ? AND kind = ? ORDER BY id');
    $find->execute([$source, $sourceId, $kind]);
    $docs = $find->fetchAll();
    $find->closeCursor();
    foreach ($docs as $doc) {
        if ($doc['status'] === 'sending' && (int) $doc['claimed_at'] >= $now - QR_CLOCK_STALE_SEND) {
            return 'clock_sending';
        }
        if (!$value && $doc['status'] === 'done') {
            return 'clock_done';
        }
    }
    if ($value) {
        foreach ($docs as $doc) {
            if (in_array($doc['status'], ['pending', 'failed', 'check', 'sending'], true)) {
                qr_clock_set_manual($pdo, $doc);
            }
        }
    }
    return '';
}

// ── for the staff screen ─────────────────────────────────────────────

function qr_clock_doc_json(array $d): array
{
    return [
        'id' => (int) $d['id'],
        'kind' => (string) $d['kind'],
        'saleId' => (int) $d['sale_id'],
        'source' => (string) $d['source'],
        'sourceId' => (int) $d['source_id'],
        'code' => (string) $d['code'],
        'test' => (int) $d['test'] === 1,
        'status' => (string) $d['status'],
        'step' => (int) $d['step'],
        'closed' => (int) $d['step'] >= 4,
        'folio' => (string) $d['folio_number'],
        'total' => (int) $d['total_cents'],
        'tip' => (int) $d['tip_cents'],
        'tries' => (int) $d['tries'],
        'nextAt' => (int) $d['next_at'],
        'error' => (string) $d['error'],
        'createdAt' => (int) $d['created_at'],
        'doneAt' => (int) $d['done_at'],
        'seq' => (int) $d['seq'],
    ];
}

/** Rows for the staff screen: changed since $since, or (0) the last two days and anything not settled. */
function qr_clock_feed(PDO $pdo, int $since, int $now): array
{
    if ($since > 0) {
        $stmt = $pdo->prepare('SELECT * FROM clock_docs WHERE seq > ? ORDER BY id');
        $stmt->execute([$since]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM clock_docs WHERE created_at > ? OR status IN ('pending', 'sending', 'failed', 'check') ORDER BY id");
        $stmt->execute([$now - 172800]);
    }
    return array_map('qr_clock_doc_json', $stmt->fetchAll());
}
