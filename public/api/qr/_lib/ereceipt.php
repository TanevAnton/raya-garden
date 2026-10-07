<?php
// The e-receipt, „Електронна бележка“: the guest's document for a payment
// made on the phone, e-mailed to the address they gave on Stripe's page.
//
// Why: a payment on the phone goes through no till, so no fiscal receipt
// comes out of one. For card payments made at a distance, Наредба Н-18 lets
// an e-shop issue a document of its own instead, delivered electronically —
// numbered in one unbroken series, with Н-18's QR code — and send НАП a
// monthly audit file. Whether a restaurant's table ordering may use these
// rules is the accountant's call. Until it is settled this runs on Stripe's
// test keys only: every document says „ТЕСТ“ and is numbered apart from
// real ones (ereceipt-settings.php, 'mode').
//
// When:
//   · Stripe confirms a payment (the webhook: _lib/pay.php for an order,
//     _lib/bill.php for a payment from a table's bill) — in the same
//     transaction, one sale document for exactly what was paid: each line
//     with its quantity, unit price without VAT, tax group and total, and
//     the tip as a line of its own.
//   · Money goes back (staff cancel an order or a line, a bill payment is
//     owed something back, a full refund in Stripe's Dashboard) — a storno
//     document for what was refunded and no earlier storno covered.
// Each is e-mailed once the answer that issued it has gone back
// (fastcgi_finish_request), so neither Stripe nor staff wait for the mail;
// one that fails is tried again from the staff screen's poll. A link in the
// e-mail (and on the guest's thank-you screen) opens it as a page,
// receipt.php.
//
// The QR code is Н-18's (приложение № 18а), ASCII:
//   <e-shop number>*<order number>*<transaction reference>*<YYYY-MM-DD>*<HH:MM:SS>*<total>
// the order number "R-4K7Q-12" (the code staff and the guest know, and the
// order's id, so it is unique), the reference Stripe's payment id (pi_…).
//
// Personal data: the e-mail address only, erased after QR_NAME_DAYS like
// names (qr_forget_names). The document itself stays: it is a sales record.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_ERECEIPT_MAIL_TRIES = 4;      // sends per document, at most
const QR_ERECEIPT_RETRY_AFTER = 600;   // seconds between them
const QR_ERECEIPT_STALE_SEND = 900;    // a send not finished by then counts as failed

function qr_ereceipt_settings(): array
{
    static $settings = null;
    if ($settings === null) {
        $loaded = require __DIR__ . '/ereceipt-settings.php';
        $settings = is_array($loaded) ? $loaded : [];
    }
    return $settings;
}

/**
 * Which documents are issued now: 'test' (Stripe's test keys: marked ТЕСТ,
 * numbered apart), 'live', or '' — none.
 */
function qr_ereceipt_mode(): string
{
    $settings = qr_ereceipt_settings();
    $mode = (string) ($settings['mode'] ?? 'off');
    if ($mode !== 'test' && $mode !== 'live') {
        return '';
    }
    if (qr_stripe_test_mode()) {
        return 'test';
    }
    return $mode === 'live' && trim((string) ($settings['eshop_number'] ?? '')) !== '' ? 'live' : '';
}

/** The tax group of a line made at a station (kitchen or bar), or of the tip. */
function qr_ereceipt_group(string $kind): string
{
    $settings = qr_ereceipt_settings();
    $group = (string) ($settings['group_' . $kind] ?? '');
    return isset($settings['groups'][$group]) ? $group : 'Б';
}

/**
 * What a payment paid for, as the document lists it: [key, name, qty, unit
 * (cents, VAT included), group] per line, the tip last. An order is paid
 * before anything of it can be cancelled, so all its lines; a bill payment,
 * the lines it was made for.
 */
function qr_ereceipt_paid_lines(PDO $pdo, string $source, array $row): array
{
    $lines = [];
    if ($source === 'order') {
        $stmt = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
        $stmt->execute([(int) $row['id']]);
        foreach ($stmt->fetchAll() as $item) {
            $lines[] = [
                'key' => 'o' . $item['line'], 'name' => qr_stripe_line_name($item, 'bg'), 'qty' => (int) $item['qty'],
                'unit' => (int) $item['unit_cents'], 'group' => qr_ereceipt_group($item['station'] === 'bar' ? 'bar' : 'kitchen'),
            ];
        }
    } else {
        $stmt = $pdo->prepare('SELECT b.order_id, b.line, b.amount_cents, i.unit_cents, i.name_bg, i.detail_bg, i.size, i.station
            FROM bill_payment_items b JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line
            WHERE b.payment_id = ? ORDER BY b.order_id, b.line');
        $stmt->execute([(int) $row['id']]);
        foreach ($stmt->fetchAll() as $item) {
            $qty = (int) $item['unit_cents'] > 0 ? intdiv((int) $item['amount_cents'], (int) $item['unit_cents']) : 1;
            $lines[] = [
                'key' => 'b' . $item['order_id'] . '.' . $item['line'], 'name' => qr_stripe_line_name($item, 'bg'), 'qty' => $qty,
                'unit' => $qty > 0 ? intdiv((int) $item['amount_cents'], $qty) : 0,
                'group' => qr_ereceipt_group($item['station'] === 'bar' ? 'bar' : 'kitchen'),
            ];
        }
    }
    if ((int) $row['tip_cents'] > 0) {
        $lines[] = ['key' => 'tip', 'name' => 'Бакшиш за екипа', 'qty' => 1, 'unit' => (int) $row['tip_cents'], 'group' => qr_ereceipt_group('tip')];
    }
    return $lines;
}

function qr_ereceipt_lines_total(array $lines): int
{
    $total = 0;
    foreach ($lines as $line) {
        $total += $line['qty'] * $line['unit'];
    }
    return $total;
}

/**
 * Stripe has confirmed a payment: its sale document, once. Inside the
 * webhook's transaction. $source 'order' or 'bill'; $row the order or bill
 * payment (its code, id, tip, time); $session the paid Checkout Session.
 */
function qr_ereceipt_sale(PDO $pdo, string $source, array $row, array $session, int $now)
{
    $mode = qr_ereceipt_mode();
    if ($mode === '' || qr_ereceipt_find_sale($pdo, $source, (int) $row['id']) !== null) {
        return;
    }
    $lines = qr_ereceipt_paid_lines($pdo, $source, $row);
    $total = qr_ereceipt_lines_total($lines);
    if ($total !== (int) ($session['amount_total'] ?? -1)) {
        // Cannot happen: the webhook checked the amount against the same rows.
        error_log('raya-qr: e-receipt for ' . $source . ' ' . $row['id'] . ': lines ' . $total . ', paid ' . ($session['amount_total'] ?? '?'));
    }
    $email = $session['customer_details']['email'] ?? '';
    qr_ereceipt_insert($pdo, [
        'test' => $mode === 'test' ? 1 : 0,
        'kind' => 'sale',
        'sale_id' => 0,
        'source' => $source,
        'source_id' => (int) $row['id'],
        'order_no' => $row['code'] . '-' . $row['id'],
        'payment_intent' => (string) ($session['payment_intent'] ?? ''),
        'lines' => $lines,
        'total' => $total,
        'lang' => $row['lang'] === 'en' ? 'en' : 'bg',
        'ordered_at' => (int) $row['created_at'],
        'email' => is_string($email) && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : '',
    ], $now);
}

function qr_ereceipt_find_sale(PDO $pdo, string $source, int $sourceId)
{
    $find = $pdo->prepare("SELECT * FROM ereceipts WHERE source = ? AND source_id = ? AND kind = 'sale'");
    $find->execute([$source, $sourceId]);
    $sale = $find->fetch();
    $find->closeCursor();
    return is_array($sale) ? $sale : null;
}

/** The next number in the document's series, and the row. Inside a write transaction. */
function qr_ereceipt_insert(PDO $pdo, array $doc, int $now): int
{
    $next = $pdo->prepare('SELECT COALESCE(MAX(number), 0) + 1 FROM ereceipts WHERE test = ?');
    $next->execute([$doc['test']]);
    $number = (int) $next->fetchColumn();
    $next->closeCursor();
    $pdo->prepare('INSERT INTO ereceipts (test, number, kind, sale_id, source, source_id, order_no, payment_intent, lang,
        lines_json, total_cents, ordered_at, issued_at, email, mail_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $doc['test'], $number, $doc['kind'], $doc['sale_id'], $doc['source'], $doc['source_id'], $doc['order_no'],
            $doc['payment_intent'], $doc['lang'], json_encode($doc['lines'], JSON_UNESCAPED_UNICODE), $doc['total'],
            $doc['ordered_at'], $now, $doc['email'], $doc['email'] !== '' ? 'pending' : 'none',
        ]);
    if ($doc['email'] !== '') {
        qr_ereceipt_mail_later($now);
    }
    return (int) $pdo->lastInsertId();
}

/**
 * Money has gone back to the guest on this payment: a storno document for
 * whatever was refunded and no earlier storno covers. Inside the refund's
 * write transaction. Its lines are the ones the refund was for, where that
 * adds up to the amount; otherwise one line for the amount.
 */
function qr_ereceipt_refunds(PDO $pdo, string $source, int $sourceId, int $now)
{
    $sale = qr_ereceipt_find_sale($pdo, $source, $sourceId);
    if ($sale === null) {
        return; // no document for the payment (issued before, or while they were off)
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
        $refunded = max($refunded, (int) $row['total_cents'] + (int) $row['tip_cents']); // all of it, maybe in Stripe's Dashboard
    }
    $before = $pdo->prepare("SELECT lines_json, total_cents FROM ereceipts WHERE sale_id = ? AND kind = 'storno'");
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
        $lines = [['key' => 'refund', 'name' => 'Върната сума', 'qty' => 1, 'unit' => $amount, 'group' => $saleLines[0]['group'] ?? 'Б']];
    }
    qr_ereceipt_insert($pdo, [
        'test' => (int) $sale['test'],
        'kind' => 'storno',
        'sale_id' => (int) $sale['id'],
        'source' => $source,
        'source_id' => $sourceId,
        'order_no' => (string) $sale['order_no'],
        'payment_intent' => (string) $sale['payment_intent'],
        'lines' => $lines,
        'total' => $amount,
        'lang' => (string) $sale['lang'],
        'ordered_at' => (int) $sale['ordered_at'],
        'email' => (string) $sale['email'],
    ], $now);
}

/**
 * How much of each line of a sale has gone back to the guest by now (line
 * key => quantity). An order: everything once refunded in full, else the
 * lines staff cancelled. A bill payment: a line it paid for that is no longer
 * its own (paid by someone else first, settled by staff, its order
 * cancelled), or what staff cancelled of it; the tip once nothing is left.
 */
function qr_ereceipt_returned(PDO $pdo, string $source, array $row, array $saleLines): array
{
    $back = [];
    if ($source === 'order') {
        if ($row['pay_status'] === 'refunded') {
            foreach ($saleLines as $line) {
                $back[$line['key']] = (int) $line['qty'];
            }
            return $back;
        }
        $stmt = $pdo->prepare('SELECT line, void_qty FROM order_items WHERE order_id = ? AND void_qty > 0');
        $stmt->execute([(int) $row['id']]);
        foreach ($stmt->fetchAll() as $item) {
            $back['o' . $item['line']] = (int) $item['void_qty'];
        }
        return $back;
    }
    $stmt = $pdo->prepare('SELECT b.order_id, b.line, b.amount_cents, i.unit_cents, i.qty, i.void_qty, i.paid_via, i.bill_payment_id
        FROM bill_payment_items b JOIN order_items i ON i.order_id = b.order_id AND i.line = b.line WHERE b.payment_id = ?');
    $stmt->execute([(int) $row['id']]);
    foreach ($stmt->fetchAll() as $item) {
        $paid = (int) $item['unit_cents'] > 0 ? intdiv((int) $item['amount_cents'], (int) $item['unit_cents']) : 1;
        $ours = $item['paid_via'] === 'online' && (int) $item['bill_payment_id'] === (int) $row['id'];
        $standing = (int) $item['qty'] - (int) $item['void_qty'];
        $back['b' . $item['order_id'] . '.' . $item['line']] = $ours ? max(0, min($paid, $paid - $standing)) : $paid;
    }
    if ((int) $row['refund_due_cents'] > (int) $row['amount_cents']) {
        $back['tip'] = 1;
    }
    return $back;
}

// ── sending ──────────────────────────────────────────────────────────

/** Once this request's answer has gone, send the documents waiting for it. Registered once. */
function qr_ereceipt_mail_later(int $now)
{
    static $registered = false;
    if (!$registered) {
        $registered = true;
        register_shutdown_function('qr_ereceipt_after_response', $now);
    }
}

function qr_ereceipt_after_response(int $now)
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ignore_user_abort(true);
    @set_time_limit(120);
    try {
        qr_ereceipt_send_due($now);
    } catch (Throwable $e) {
        error_log('raya-qr e-receipt mail: ' . $e->getMessage());
    }
}

const QR_ERECEIPT_DUE = "email <> '' AND mail_tries < ? AND (mail_status = 'pending'
    OR (mail_status = 'failed' AND mail_at < ?) OR (mail_status = 'sending' AND mail_at < ?))";

/** For the staff screen's poll: a document still to e-mail (a send failed, or never finished)? */
function qr_ereceipt_mail_due(PDO $pdo, int $now): bool
{
    $stmt = $pdo->prepare('SELECT 1 FROM ereceipts WHERE ' . QR_ERECEIPT_DUE . ' LIMIT 1');
    $stmt->execute([QR_ERECEIPT_MAIL_TRIES, $now - QR_ERECEIPT_RETRY_AFTER, $now - QR_ERECEIPT_STALE_SEND]);
    $due = $stmt->fetchColumn() !== false;
    $stmt->closeCursor();
    return $due;
}

/**
 * E-mail the documents that are due, oldest first. Each is claimed in a
 * write transaction first ('sending'), so two requests never send the same
 * one; a send that never finishes is tried again after a while.
 */
function qr_ereceipt_send_due(int $now)
{
    for ($i = 0; $i < 10; $i++) {
        $doc = qr_write(function (PDO $pdo) use ($now) {
            $find = $pdo->prepare('SELECT * FROM ereceipts WHERE ' . QR_ERECEIPT_DUE . ' ORDER BY id LIMIT 1');
            $find->execute([QR_ERECEIPT_MAIL_TRIES, $now - QR_ERECEIPT_RETRY_AFTER, $now - QR_ERECEIPT_STALE_SEND]);
            $doc = $find->fetch();
            $find->closeCursor();
            if (!is_array($doc)) {
                return null;
            }
            $pdo->prepare("UPDATE ereceipts SET mail_status = 'sending', mail_tries = mail_tries + 1, mail_at = ? WHERE id = ?")
                ->execute([$now, $doc['id']]);
            return $doc;
        });
        if ($doc === null) {
            return;
        }
        try {
            list($ok, $error) = qr_ereceipt_mail($doc);
        } catch (Throwable $e) {
            list($ok, $error) = [false, 'internal error: ' . $e->getMessage()];
        }
        qr_write(function (PDO $pdo) use ($doc, $ok, $error) {
            $pdo->prepare('UPDATE ereceipts SET mail_status = ?, mail_error = ? WHERE id = ?')
                ->execute([$ok ? 'sent' : 'failed', mb_substr($error, 0, 300), $doc['id']]);
        });
    }
}

/** One document by e-mail: the document itself as the message, its QR code and the logo inline. Returns [ok, error]. */
function qr_ereceipt_mail(array $doc): array
{
    require_once __DIR__ . '/mail.php';
    require_once __DIR__ . '/qrcode.php';
    $v = qr_ereceipt_view(qr_db(), $doc);
    $title = ($v['storno'] ? 'Сторно документ' : 'Електронна бележка') . ' № ' . $v['number'];
    $subject = ($v['test'] ? 'ТЕСТ · ' : '') . $title . ' — RAYA Garden';
    $money = qr_ereceipt_money($v['total'], false);
    if ($v['storno']) {
        $lead = ['Върнахме Ви ' . $money . '. Това е сторно документът към електронна бележка № ' . ($v['sale']['number'] ?? '')
            . ' от ' . ($v['sale']['date'] ?? '') . ' г.'];
        $leadEn = 'We have refunded you ' . $money . '. This is the corrective document for your electronic receipt.';
    } else {
        $lead = ['Благодарим Ви за посещението! Това е електронната бележка за плащането Ви в RAYA Garden.'];
        $leadEn = 'Thank you for your visit! This is the electronic receipt for your payment at RAYA Garden, in Bulgarian as the law requires.';
    }
    if ($v['lang'] === 'en') {
        $lead[] = $leadEn;
    }
    $e = 'qr_ereceipt_escape';
    $html = '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . $e($title) . '</title></head><body style="margin:0;padding:16px 8px;background:#f4f1ea">'
        . '<div style="max-width:600px;margin:0 auto 14px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#3b2f1e;padding:0 4px">'
        . implode('<br>', array_map($e, $lead)) . '</div>'
        . qr_ereceipt_html($v, 'cid:qr@rayagarden.bg', 'cid:logo@rayagarden.bg')
        . '<div style="max-width:600px;margin:14px auto 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#6b5a3a;text-align:center;padding:0 4px">'
        . '<a href="' . $e($v['url']) . '" style="color:#8a661c">Отворете документа в браузъра</a>'
        . ($v['lang'] === 'en' ? ' · <a href="' . $e($v['url']) . '" style="color:#8a661c">Open it in your browser</a>' : '')
        . '</div></body></html>';
    $text = implode("\r\n", $lead) . "\r\n\r\n" . qr_ereceipt_text($v) . "\r\n\r\n" . $v['url'] . "\r\n";
    $inline = ['qr@rayagarden.bg' => ['image/png', qr_code_png($v['qr'], 5)]];
    $logo = @file_get_contents(__DIR__ . '/ereceipt-logo.png');
    if (is_string($logo)) {
        $inline['logo@rayagarden.bg'] = ['image/png', $logo];
    }
    return qr_mail((string) $doc['email'], $subject, $text, $html, [], $inline);
}

// ── the document ─────────────────────────────────────────────────────

/** The address of a document's page; the token is the server's own signature of its id. */
function qr_ereceipt_token(int $id): string
{
    return substr(hash_hmac('sha256', 'ereceipt|' . $id, qr_secret()), 0, 32);
}

function qr_ereceipt_url(int $id): string
{
    return qr_public_url() . '/api/qr/receipt.php?n=' . $id . '&t=' . qr_ereceipt_token($id);
}

/** For the guest's own screens: the page of the sale document for a payment, or ''. */
function qr_ereceipt_url_for(PDO $pdo, string $source, int $sourceId): string
{
    $sale = qr_ereceipt_find_sale($pdo, $source, $sourceId);
    return $sale === null ? '' : qr_ereceipt_url((int) $sale['id']);
}

/** Everything a document shows, worked out once for the e-mail, its text and the page. */
function qr_ereceipt_view(PDO $pdo, array $doc): array
{
    $settings = qr_ereceipt_settings();
    $tz = new DateTimeZone(QR_TZ);
    $issued = (new DateTime('@' . (int) $doc['issued_at']))->setTimezone($tz);
    $ordered = (new DateTime('@' . (int) $doc['ordered_at']))->setTimezone($tz);
    $rates = $settings['groups'] ?? ['Б' => 20];
    $lines = [];
    $gross = [];
    foreach (json_decode((string) $doc['lines_json'], true) as $line) {
        $rate = (int) ($rates[$line['group']] ?? 20);
        $total = (int) $line['qty'] * (int) $line['unit'];
        $lines[] = $line + ['rate' => $rate, 'netUnit' => (int) round($line['unit'] * 100 / (100 + $rate)), 'total' => $total];
        $gross[$line['group']] = ($gross[$line['group']] ?? 0) + $total;
    }
    // VAT per tax group, on the group's total: rounding once per group, not per line.
    $net = 0;
    $vat = [];
    ksort($gross);
    foreach ($gross as $group => $amount) {
        $rate = (int) ($rates[$group] ?? 20);
        $groupNet = (int) round($amount * 100 / (100 + $rate));
        $net += $groupNet;
        if ($rate > 0) {
            $vat[] = ['group' => (string) $group, 'rate' => $rate, 'amount' => $amount - $groupNet];
        }
    }
    $sale = null;
    if ($doc['kind'] === 'storno') {
        $find = $pdo->prepare('SELECT number, issued_at FROM ereceipts WHERE id = ?');
        $find->execute([(int) $doc['sale_id']]);
        $row = $find->fetch();
        $find->closeCursor();
        if (is_array($row)) {
            $sale = [
                'number' => str_pad((string) $row['number'], 10, '0', STR_PAD_LEFT),
                'date' => (new DateTime('@' . (int) $row['issued_at']))->setTimezone($tz)->format('d.m.Y'),
            ];
        }
    }
    $test = (int) $doc['test'] === 1;
    $total = (int) $doc['total_cents'];
    return [
        'id' => (int) $doc['id'],
        'test' => $test,
        'storno' => $doc['kind'] === 'storno',
        'number' => str_pad((string) $doc['number'], 10, '0', STR_PAD_LEFT),
        'date' => $issued->format('d.m.Y'),
        'time' => $issued->format('H:i:s'),
        'orderDate' => $ordered->format('d.m.Y'),
        'seller' => (array) ($settings['seller'] ?? []),
        'email' => (string) $doc['email'],
        'lines' => $lines,
        'net' => $net,
        'vat' => $vat,
        'total' => $total,
        'orderNo' => (string) $doc['order_no'],
        'reference' => (string) $doc['payment_intent'],
        'sale' => $sale,
        'lang' => (string) $doc['lang'],
        'qr' => implode('*', [
            $test ? 'TEST' : trim((string) ($settings['eshop_number'] ?? '')),
            (string) $doc['order_no'],
            (string) $doc['payment_intent'],
            $issued->format('Y-m-d'),
            $issued->format('H:i:s'),
            number_format($total / 100, 2, '.', ''),
        ]),
        'url' => qr_ereceipt_url((int) $doc['id']),
    ];
}

/** 2340 → "23,40 €"; a storno's amounts with a minus. */
function qr_ereceipt_money(int $cents, bool $negative): string
{
    return ($negative && $cents !== 0 ? '−' : '') . number_format($cents / 100, 2, ',', "\u{00A0}") . "\u{00A0}€";
}

function qr_ereceipt_escape(string $s): string
{
    return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
}

/**
 * The document in HTML, styled inline so mail programs show it as the page
 * does: tables for layout, nothing a mail program strips.
 */
function qr_ereceipt_html(array $v, string $qrSrc, string $logoSrc): string
{
    $e = 'qr_ereceipt_escape';
    $m = function (int $cents) use ($v) {
        return qr_ereceipt_money($cents, $v['storno']);
    };
    $seller = $v['seller'];
    $label = 'font:700 11px Arial,Helvetica,sans-serif;letter-spacing:1px;color:#6b6b6b;text-transform:uppercase';
    $box = 'background:#f4f4f2;border-radius:6px;padding:14px 16px;vertical-align:top;font:13px/1.6 Arial,Helvetica,sans-serif;color:#333';
    $boxHead = '<div style="' . $label . ';color:#333;padding-bottom:8px;margin-bottom:8px;border-bottom:1px solid #9a9a9a">';
    $th = 'padding:9px 6px;font:700 11px Arial,Helvetica,sans-serif;color:#333;text-transform:uppercase;letter-spacing:.5px;background:#e3e3e0;vertical-align:top';
    $small = '<br><span style="font-weight:400;text-transform:none;color:#777;font-size:10px">';
    $td = 'padding:10px 6px;border-bottom:1px solid #e3e3e0;font:13px Arial,Helvetica,sans-serif;color:#333;vertical-align:top';

    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-collapse:collapse">';
    $out .= '<tr><td style="padding:26px 24px 6px;text-align:center">'
        . ($logoSrc !== '' ? '<img src="' . $e($logoSrc) . '" width="56" height="56" alt="" style="display:inline-block;border:0">' : '')
        . '<div style="font:600 18px Georgia,\'Times New Roman\',serif;color:#3b2f1e;letter-spacing:1px;margin-top:4px">RAYA Garden</div></td></tr>';
    if ($v['test']) {
        $out .= '<tr><td style="padding:10px 24px 0"><div style="border:2px solid #b42318;border-radius:6px;padding:10px 12px;font:700 14px/1.4 Arial,Helvetica,sans-serif;color:#b42318;text-align:center">'
            . 'ТЕСТ — НЕ Е ДАНЪЧЕН ДОКУМЕНТ<br><span style="font-weight:400;font-size:12px">Издаден при тестово плащане със Stripe, без истински пари.</span></div></td></tr>';
    }
    $out .= '<tr><td style="padding:18px 24px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        . '<td style="vertical-align:middle;font-family:Arial,Helvetica,sans-serif">'
        . '<div style="font:700 21px Arial,Helvetica,sans-serif;color:#222;letter-spacing:.5px">' . ($v['storno'] ? 'СТОРНО ДОКУМЕНТ' : 'ЕЛЕКТРОННА БЕЛЕЖКА') . '</div>'
        . '<div style="font:15px Arial,Helvetica,sans-serif;color:#555;margin-top:6px">№ ' . $e($v['number']) . ' – ' . $e($v['date']) . ' г., ' . $e($v['time']) . '</div>'
        . ($v['storno'] && $v['sale'] ? '<div style="font:13px Arial,Helvetica,sans-serif;color:#555;margin-top:6px">към електронна бележка № ' . $e($v['sale']['number']) . ' от ' . $e($v['sale']['date']) . ' г.<br>Основание: връщане на сума</div>' : '')
        . '</td><td width="132" style="vertical-align:middle;text-align:right"><img src="' . $e($qrSrc) . '" width="124" height="124" alt="QR код на документа" style="display:inline-block;border:0"></td>'
        . '</tr></table></td></tr>';

    $sellerRows = [
        '<b>' . $e((string) ($seller['name'] ?? '')) . '</b>',
        'ЕИК: ' . $e((string) ($seller['eik'] ?? '')),
        'ДДС №: ' . $e((string) ($seller['vat'] ?? '')),
        'Адрес: ' . $e((string) ($seller['address'] ?? '')),
        'Обект: ' . $e((string) ($seller['shop'] ?? '')),
        'Телефон: ' . $e((string) ($seller['phone'] ?? '')),
        'Имейл: ' . $e((string) ($seller['email'] ?? '')),
    ];
    $out .= '<tr><td style="padding:14px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        . '<td width="49%" style="' . $box . '">' . $boxHead . 'Доставчик</div>' . implode('<br>', $sellerRows) . '</td>'
        . '<td width="2%" style="font-size:0;line-height:0">&nbsp;</td>'
        . '<td width="49%" style="' . $box . '">' . $boxHead . 'Клиент</div>Имейл: ' . ($v['email'] !== '' ? $e($v['email']) : '—') . '</td>'
        . '</tr></table></td></tr>';

    $out .= '<tr><td style="padding:16px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">'
        . '<tr><th style="' . $th . ';text-align:left;width:18px">№</th><th style="' . $th . ';text-align:left">Продукт</th>'
        . '<th style="' . $th . ';text-align:right">Кол.</th>'
        . '<th style="' . $th . ';text-align:right">Ед. цена' . $small . 'без ДДС</span></th>'
        . '<th style="' . $th . ';text-align:center">Данъчна група</th>'
        . '<th style="' . $th . ';text-align:right">Общо' . $small . 'с ДДС</span></th></tr>';
    foreach ($v['lines'] as $n => $line) {
        $out .= '<tr><td style="' . $td . ';color:#777">' . ($n + 1) . '</td><td style="' . $td . '">' . $e((string) $line['name']) . '</td>'
            . '<td style="' . $td . ';text-align:right">' . (int) $line['qty'] . '</td>'
            . '<td style="' . $td . ';text-align:right;white-space:nowrap">' . $e(qr_ereceipt_money($line['netUnit'], false)) . '</td>'
            . '<td style="' . $td . ';text-align:center;white-space:nowrap">' . $e($line['group'] . ' - ' . $line['rate'] . '%') . '</td>'
            . '<td style="' . $td . ';text-align:right;white-space:nowrap">' . $e($m($line['total'])) . '</td></tr>';
    }
    $out .= '</table></td></tr>';

    $sum = function (string $name, string $amount, bool $big) {
        $style = $big ? 'font:700 17px Arial,Helvetica,sans-serif;color:#222;padding:12px 0 0;border-top:1px solid #9a9a9a'
            : 'font:13px Arial,Helvetica,sans-serif;color:#555;padding:4px 0';
        return '<tr><td style="' . $style . '">' . $name . '</td><td style="' . $style . ';text-align:right;white-space:nowrap">' . $amount . '</td></tr>';
    };
    $totals = $sum('Общо (без ДДС)', $e($m($v['net'])), false);
    foreach ($v['vat'] as $vat) {
        $totals .= $sum('ДДС ' . (count($v['vat']) > 1 ? 'гр. ' . $e($vat['group']) . ' ' : '') . '(' . $vat['rate'] . '%)', $e($m($vat['amount'])), false);
    }
    $totals .= $sum($v['storno'] ? 'Общо за връщане' : 'Общо', $e($m($v['total'])), true);
    $out .= '<tr><td style="padding:14px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
        . '<td width="45%" style="font-size:0">&nbsp;</td><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' . $totals . '</table></td>'
        . '</tr></table></td></tr>';

    $cell = function (string $name, string $value) use ($label, $e) {
        return '<td width="50%" style="vertical-align:top;padding:6px 8px 8px 0"><div style="' . $label . ';font-size:10px">' . $name . '</div>'
            . '<div style="font:700 13px Arial,Helvetica,sans-serif;color:#222;margin-top:4px">' . $e($value) . '</div></td>';
    };
    $out .= '<tr><td style="padding:16px 24px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;border-radius:6px">'
        . '<tr><td style="padding:10px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        . '<tr>' . $cell('Номер на поръчка', $v['orderNo']) . $cell('Дата на поръчка', $v['orderDate'] . ' г.') . '</tr>'
        . '<tr>' . $cell('Начин на плащане', 'Доставчик на платежни услуги') . $cell('Платежен метод', 'Stripe') . '</tr>'
        . '<tr><td colspan="2" style="vertical-align:top;padding:6px 0 4px"><div style="' . $label . ';font-size:10px">Референтен номер на трансакцията</div>'
        . '<div style="font:700 13px Arial,Helvetica,sans-serif;color:#222;margin-top:4px;word-break:break-all">' . $e($v['reference']) . '</div></td></tr>'
        . '</table></td></tr></table></td></tr>';
    $out .= '<tr><td style="padding:18px 24px 24px;text-align:center;font:600 15px Georgia,\'Times New Roman\',serif;color:#8a661c">rayagarden.bg</td></tr>';
    return $out . '</table>';
}

/** The document as plain text, for mail programs that show no HTML. */
function qr_ereceipt_text(array $v): string
{
    $m = function (int $cents) use ($v) {
        return qr_ereceipt_money($cents, $v['storno']);
    };
    $s = $v['seller'];
    $out = [];
    if ($v['test']) {
        $out[] = '*** ТЕСТ — НЕ Е ДАНЪЧЕН ДОКУМЕНТ (тестово плащане, без истински пари) ***';
        $out[] = '';
    }
    $out[] = ($v['storno'] ? 'СТОРНО ДОКУМЕНТ' : 'ЕЛЕКТРОННА БЕЛЕЖКА') . ' № ' . $v['number'] . ' – ' . $v['date'] . ' г., ' . $v['time'];
    if ($v['storno'] && $v['sale']) {
        $out[] = 'към електронна бележка № ' . $v['sale']['number'] . ' от ' . $v['sale']['date'] . ' г. Основание: връщане на сума';
    }
    $out[] = '';
    $out[] = 'ДОСТАВЧИК: ' . ($s['name'] ?? '') . ', ЕИК ' . ($s['eik'] ?? '') . ', ДДС № ' . ($s['vat'] ?? '');
    $out[] = '  ' . ($s['address'] ?? '') . '; обект: ' . ($s['shop'] ?? '') . '; тел. ' . ($s['phone'] ?? '') . '; ' . ($s['email'] ?? '');
    $out[] = 'КЛИЕНТ: ' . ($v['email'] !== '' ? $v['email'] : '—');
    $out[] = '';
    foreach ($v['lines'] as $n => $line) {
        $out[] = ($n + 1) . '. ' . $line['name'] . ' — ' . $line['qty'] . ' × ' . qr_ereceipt_money($line['netUnit'], false) . ' без ДДС, гр. '
            . $line['group'] . ' - ' . $line['rate'] . '% = ' . $m($line['total']);
    }
    $out[] = '';
    $out[] = 'Общо (без ДДС): ' . $m($v['net']);
    foreach ($v['vat'] as $vat) {
        $out[] = 'ДДС ' . (count($v['vat']) > 1 ? 'гр. ' . $vat['group'] . ' ' : '') . '(' . $vat['rate'] . '%): ' . $m($vat['amount']);
    }
    $out[] = ($v['storno'] ? 'Общо за връщане: ' : 'Общо: ') . $m($v['total']);
    $out[] = '';
    $out[] = 'Номер на поръчка: ' . $v['orderNo'] . ' · Дата на поръчка: ' . $v['orderDate'] . ' г.';
    $out[] = 'Начин на плащане: Доставчик на платежни услуги · Платежен метод: Stripe';
    $out[] = 'Референтен номер на трансакцията: ' . $v['reference'];
    return implode("\r\n", $out);
}
