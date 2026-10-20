<?php
// Fiscal receipts for phone payments, printed on the restaurant's own fiscal
// printer.
//
// Clock (15–19.10.2026): bills paid on the spot are the restaurant's to
// collect and to fiscalise, without passing them through Clock's POS. So a
// payment Stripe confirms is printed here, on a fiscal printer kept for
// phone payments (not the one Clock drives):
//
//   this server  ── a queue of receipts (fiscal_docs), filled in the same
//                   transaction that records the payment or the refund
//        ▲   │
//        │   ▼   the bridge asks for the next one every few seconds
//   the bridge   ── a small computer in the restaurant (tools/fiscal-bridge),
//                   in front of ErpNet.FP, the open fiscal-printer server
//        │
//   the printer  ── prints; the bridge reports the receipt's number, time and
//                   fiscal memory back here
//
// This server cannot reach into the restaurant, so the bridge pulls: it
// needs nothing open on the restaurant's side but an outgoing connection.
//
// A refund prints a reversal receipt (storno): the same УНП, the original
// receipt's number, time and fiscal memory, reason "refund", for exactly the
// lines that went back. It waits until its sale has printed.
//
// Exactly once, on paper:
//   - a job is claimed by the bridge for a while (QR_FISCAL_LEASE);
//   - the bridge sends it to ErpNet.FP with a task id of ours
//     (idempotent printing) and reports 'submitted' before it waits for the
//     printer, so a job that comes back is known to have been sent;
//   - the bridge keeps its own journal of what the printer answered, and
//     reports from it, because ErpNet.FP forgets a task's result after a
//     restart or once it was read;
//   - if, after all that, nobody knows whether it printed, the job stops at
//     'check': a person looks at the printer. Printing it twice would be a
//     second fiscal receipt, which only a storno can undo.
//
// „За касата“ follows: a printed sale is ticked as entered, with its receipt
// number; a printed storno as voided. One that fails waits there with the
// printer's reason and *Опитай пак*; staff can still enter it by hand, which
// stops it ('manual').
//
// Configuration (raya-qr-config.php, above the web root; written by the
// deploy from GitHub secrets — see docs/qr-ordering/SETUP.md):
//   'fiscal_mode'          'off' (default), 'test' or 'live'. 'test' prints
//                          only payments made with Stripe's test keys, 'live'
//                          only real ones.
//   'fiscal_bridge_token'  the bridge's key: a long random string, also set on
//                          the bridge.
// Tax groups, the УНП's operator code, the tip line: fiscal-settings.php.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/clock.php';

const QR_FISCAL_TRIES = 6;          // tries per receipt before it stops at 'failed'
const QR_FISCAL_LEASE = 120;        // a claim not reported by then goes back to the queue
const QR_FISCAL_BRIDGE_LOST = 90;   // the bridge counts as offline after this long unheard
const QR_FISCAL_BACKOFF = [30, 120, 600, 1800, 3600];

function qr_fiscal_settings(): array
{
    static $settings = null;
    if ($settings === null) {
        $loaded = require __DIR__ . '/fiscal-settings.php';
        $settings = is_array($loaded) ? $loaded : [];
    }
    return $settings;
}

/** The bridge has a key: receipts can be printed. */
function qr_fiscal_configured(): bool
{
    return strlen((string) (qr_config()['fiscal_bridge_token'] ?? '')) >= 32;
}

/**
 * Which payments are printed now: 'test' (made with Stripe's test keys),
 * 'live' (real ones), or '' — none. A mode that does not match the Stripe
 * keys prints nothing.
 */
function qr_fiscal_mode(): string
{
    $mode = (string) (qr_config()['fiscal_mode'] ?? 'off');
    if (($mode !== 'test' && $mode !== 'live') || !qr_fiscal_configured()) {
        return '';
    }
    return ($mode === 'test') === qr_stripe_test_mode() ? $mode : '';
}

// ── queueing (inside the payment's or refund's write transaction) ────

function qr_fiscal_find_sale(PDO $pdo, string $source, int $sourceId)
{
    $find = $pdo->prepare("SELECT * FROM fiscal_docs WHERE source = ? AND source_id = ? AND kind = 'sale'");
    $find->execute([$source, $sourceId]);
    $sale = $find->fetch();
    $find->closeCursor();
    return is_array($sale) ? $sale : null;
}

/** Stripe has confirmed a payment: its receipt, queued once. */
function qr_fiscal_sale(PDO $pdo, string $source, array $row, array $session, int $now)
{
    $mode = qr_fiscal_mode();
    if ($mode === '' || qr_fiscal_find_sale($pdo, $source, (int) $row['id']) !== null) {
        return;
    }
    $test = $mode === 'test' ? 1 : 0;
    $next = $pdo->prepare("SELECT COALESCE(MAX(usn_seq), 0) + 1 FROM fiscal_docs WHERE kind = 'sale' AND test = ?");
    $next->execute([$test]);
    $usnSeq = (int) $next->fetchColumn();
    $next->closeCursor();
    $lines = qr_clock_lines($pdo, $source, $row);
    qr_fiscal_insert($pdo, [
        'test' => $test,
        'kind' => 'sale',
        'sale_id' => 0,
        'source' => $source,
        'source_id' => (int) $row['id'],
        'code' => (string) $row['code'],
        'payment_intent' => (string) ($session['payment_intent'] ?? ''),
        'usn_seq' => $usnSeq,
        'lines' => $lines,
        'total' => qr_ereceipt_lines_total($lines),
        'tip' => (int) $row['tip_cents'],
    ], $now);
}

/** Money has gone back on this payment: a reversal receipt for it, once its sale is printed. */
function qr_fiscal_refunds(PDO $pdo, string $source, int $sourceId, int $now)
{
    $sale = qr_fiscal_find_sale($pdo, $source, $sourceId);
    if ($sale === null || $sale['status'] === 'manual') {
        return;
    }
    $due = qr_storno_due($pdo, 'fiscal_docs', $sale, $source, $sourceId);
    if ($due === null) {
        return;
    }
    qr_fiscal_insert($pdo, [
        'test' => (int) $sale['test'],
        'kind' => 'storno',
        'sale_id' => (int) $sale['id'],
        'source' => $source,
        'source_id' => $sourceId,
        'code' => (string) $sale['code'],
        'payment_intent' => (string) $sale['payment_intent'],
        'usn_seq' => (int) $sale['usn_seq'],
        'lines' => $due['lines'],
        'total' => $due['amount'],
        'tip' => $due['tip'],
    ], $now);
}

function qr_fiscal_insert(PDO $pdo, array $doc, int $now): int
{
    $pdo->prepare('INSERT INTO fiscal_docs (test, kind, sale_id, source, source_id, code, payment_intent, usn_seq,
        lines_json, total_cents, tip_cents, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            $doc['test'], $doc['kind'], $doc['sale_id'], $doc['source'], $doc['source_id'], $doc['code'],
            $doc['payment_intent'], $doc['usn_seq'], json_encode($doc['lines'], JSON_UNESCAPED_UNICODE),
            $doc['total'], $doc['tip'], $now, qr_bump_seq($pdo),
        ]);
    return (int) $pdo->lastInsertId();
}

// ── the bridge ───────────────────────────────────────────────────────

/**
 * Only the bridge, with its key: X-Raya-Bridge-Key: … (Apache under PHP-FPM
 * often drops the Authorization header before PHP sees it), or
 * Authorization: Bearer ….
 */
function qr_fiscal_require_bridge()
{
    $token = (string) (qr_config()['fiscal_bridge_token'] ?? '');
    $own = isset($_SERVER['HTTP_X_RAYA_BRIDGE_KEY']) ? (string) $_SERVER['HTTP_X_RAYA_BRIDGE_KEY'] : '';
    if ($own !== '') {
        if (strlen($token) < 32 || !hash_equals($token, $own)) {
            qr_fail(401, 'unauthorized');
        }
        return;
    }
    $header = isset($_SERVER['HTTP_AUTHORIZATION']) ? (string) $_SERVER['HTTP_AUTHORIZATION'] : '';
    if ($header === '' && function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower((string) $name) === 'authorization') {
                $header = (string) $value;
            }
        }
    }
    $given = preg_match('/^Bearer\s+(\S+)$/', $header, $m) ? $m[1] : '';
    if (strlen($token) < 32 || !hash_equals($token, $given)) {
        qr_fail(401, 'unauthorized');
    }
}

// Due: new; failed and its wait is over; or claimed so long ago that the
// bridge must have lost it. A storno waits for its sale's receipt.
const QR_FISCAL_DUE = "(status = 'pending' OR (status = 'failed' AND tries < ? AND next_at <= ?)
    OR (status IN ('claimed', 'submitted') AND claimed_at < ?))
    AND (kind = 'sale' OR sale_id IN (SELECT id FROM fiscal_docs WHERE status = 'printed'))";

/**
 * The bridge asks for work: its state is recorded, and the next receipt due
 * is claimed for it, or null. A receipt already submitted to the printer
 * comes back marked so: the bridge must find out what happened to it before
 * anything else (its journal, then ErpNet.FP's task info).
 */
function qr_fiscal_claim(array $bridge, int $now)
{
    return qr_write(function (PDO $pdo) use ($bridge, $now) {
        $printer = is_array($bridge['printer'] ?? null) ? $bridge['printer'] : [];
        $pdo->prepare('UPDATE fiscal_bridge SET last_seen = ?, version = ?, printer_id = ?, printer_serial = ?, printer_ok = ?, message = ?, seq = ? WHERE id = 1')
            ->execute([
                $now, mb_substr((string) ($bridge['version'] ?? ''), 0, 40),
                mb_substr((string) ($printer['id'] ?? ''), 0, 40), mb_substr((string) ($printer['serialNumber'] ?? ''), 0, 20),
                !empty($printer['ok']) ? 1 : 0, mb_substr((string) ($printer['message'] ?? ''), 0, 300),
                qr_fiscal_bridge_seq($pdo, $now, !empty($printer['ok'])),
            ]);
        if (!empty($bridge['check'])) {
            return null; // the bridge checking its connection: its state is recorded, nothing is claimed
        }
        for ($i = 0; $i < 20; $i++) {
            $find = $pdo->prepare('SELECT * FROM fiscal_docs WHERE ' . QR_FISCAL_DUE . ' ORDER BY id LIMIT 1');
            $find->execute([QR_FISCAL_TRIES, $now, $now - QR_FISCAL_LEASE]);
            $doc = $find->fetch();
            $find->closeCursor();
            if (!is_array($doc)) {
                // No receipt waiting: a report or duplicate staff asked for.
                return qr_fiscal_claim_command($pdo, $now);
            }
            if ($doc['kind'] === 'sale' && $doc['task_id'] === '' && qr_fiscal_entered_by_hand($pdo, $doc)) {
                qr_fiscal_set_manual($pdo, $doc);
                continue;
            }
            $submitted = $doc['task_id'] !== '';
            $pdo->prepare('UPDATE fiscal_docs SET status = ?, tries = tries + 1, claimed_at = ?, seq = ? WHERE id = ?')
                ->execute([$submitted ? 'submitted' : 'claimed', $now, qr_bump_seq($pdo), $doc['id']]);
            $doc['tries'] = (int) $doc['tries'] + 1;
            return qr_fiscal_job($pdo, $doc, $submitted);
        }
        return null;
    });
}

/** The bridge's row changes (and the screens refetch it) only when it comes back or its printer's state changes. */
function qr_fiscal_bridge_seq(PDO $pdo, int $now, bool $ok): int
{
    $find = $pdo->query('SELECT last_seen, printer_ok, seq FROM fiscal_bridge WHERE id = 1');
    $row = $find->fetch();
    $find->closeCursor();
    if (is_array($row) && (int) $row['printer_ok'] === ($ok ? 1 : 0) && (int) $row['last_seen'] >= $now - QR_FISCAL_BRIDGE_LOST) {
        return (int) $row['seq'];
    }
    return qr_bump_seq($pdo);
}

/** Staff entered the sale by hand on „За касата“ before it was printed. */
function qr_fiscal_entered_by_hand(PDO $pdo, array $doc): bool
{
    $table = $doc['source'] === 'order' ? 'orders' : 'bill_payments';
    $find = $pdo->prepare("SELECT till_at FROM $table WHERE id = ?");
    $find->execute([(int) $doc['source_id']]);
    $at = (int) $find->fetchColumn();
    $find->closeCursor();
    return $at > 0;
}

function qr_fiscal_set_manual(PDO $pdo, array $doc)
{
    $seq = qr_bump_seq($pdo);
    $pdo->prepare("UPDATE fiscal_docs SET status = 'manual', error = '', seq = ? WHERE id = ?")->execute([$seq, $doc['id']]);
    if ($doc['kind'] === 'sale') {
        $pdo->prepare("UPDATE fiscal_docs SET status = 'manual', error = '', seq = ? WHERE sale_id = ? AND status <> 'printed'")
            ->execute([$seq, $doc['id']]);
    }
}

/** Task ids of a receipt start with this: raya-<t|l>-<id>-, then the try. */
function qr_fiscal_task_prefix(array $doc): string
{
    return 'raya-' . ((int) $doc['test'] === 1 ? 't' : 'l') . '-' . $doc['id'] . '-';
}

/** A receipt as the bridge prints it: ErpNet.FP's receipt (or reversal receipt) body, and how to name the task. */
function qr_fiscal_job(PDO $pdo, array $doc, bool $submitted): array
{
    $settings = qr_fiscal_settings();
    $groups = $settings['tax_groups'] ?? [];
    $items = [];
    $comment = trim((string) ($settings['header_comment'] ?? ''));
    if ($comment !== '') {
        $items[] = ['type' => 'comment', 'text' => $comment . ' ' . $doc['code']];
    }
    foreach (json_decode((string) $doc['lines_json'], true) as $line) {
        $isTip = $line['key'] === 'tip';
        $group = (int) ($groups[(string) ($line['category'] ?? '')] ?? $groups[$isTip ? 'tip' : (string) ($line['station'] ?? 'kitchen')] ?? 2);
        $items[] = [
            'text' => $isTip ? (string) ($settings['tip_text'] ?? 'Бакшиш') : (string) $line['name'],
            'quantity' => (int) $line['qty'],
            'unitPrice' => round((int) $line['unit'] / 100, 2),
            'taxGroup' => $group >= 1 && $group <= 8 ? $group : 2,
        ];
    }
    $job = [
        'id' => (int) $doc['id'],
        'kind' => (string) $doc['kind'],
        'test' => (int) $doc['test'] === 1,
        'code' => (string) $doc['code'],
        // ErpNet.FP's idempotency key. Once sent, the same until the printer
        // has answered; a fresh one for a try after a failure, so ErpNet.FP
        // prints it rather than hand back the old failure.
        'taskId' => $submitted ? (string) $doc['task_id'] : qr_fiscal_task_prefix($doc) . (int) $doc['tries'],
        'submitted' => $submitted,
        'usn' => (string) $doc['usn'],
        'usnSequence' => (int) $doc['usn_seq'],
        'operatorCode' => (string) ($settings['operator_code'] ?? '0001'),
        'amount' => round((int) $doc['total_cents'] / 100, 2),
        'receipt' => [
            'items' => $items,
            'payments' => [['amount' => round((int) $doc['total_cents'] / 100, 2), 'paymentType' => 'card']],
        ],
    ];
    if ($doc['kind'] === 'storno') {
        $find = $pdo->prepare('SELECT usn, receipt_number, receipt_at, fm_number FROM fiscal_docs WHERE id = ?');
        $find->execute([(int) $doc['sale_id']]);
        $sale = $find->fetch();
        $find->closeCursor();
        $job['usn'] = (string) $sale['usn']; // a storno MUST carry its sale's УНП
        $job['receipt']['receiptNumber'] = (string) $sale['receipt_number'];
        $job['receipt']['receiptDateTime'] = (string) $sale['receipt_at'];
        $job['receipt']['fiscalMemorySerialNumber'] = (string) $sale['fm_number'];
        $job['receipt']['reason'] = 'refund';
    }
    return $job;
}

/**
 * What the bridge has to say about a receipt it claimed:
 *   submitted {usn}        sent to the printer (task id as in the job)
 *   printed   {receiptNumber, receiptDateTime, fiscalMemorySerialNumber, receiptAmount}
 *   failed    {error}      the printer refused it, or could not be reached: tried again later
 *   check     {error}      nobody knows whether it printed: a person looks
 * Returns [httpStatus, body].
 */
function qr_fiscal_report(int $id, string $event, array $data, int $now): array
{
    return qr_write(function (PDO $pdo) use ($id, $event, $data, $now) {
        $find = $pdo->prepare('SELECT * FROM fiscal_docs WHERE id = ?');
        $find->execute([$id]);
        $doc = $find->fetch();
        $find->closeCursor();
        if (!is_array($doc)) {
            return [404, ['ok' => false, 'error' => 'not_found']];
        }
        if ($doc['status'] === 'printed' && $event === 'printed') {
            return [200, ['ok' => true, 'already' => true]]; // a repeat of the same news
        }
        if (!in_array($doc['status'], ['claimed', 'submitted'], true)) {
            return [409, ['ok' => false, 'error' => 'not_claimed', 'status' => $doc['status']]];
        }
        $seq = qr_bump_seq($pdo);
        $error = mb_substr((string) ($data['error'] ?? ''), 0, 300);
        if ($event === 'submitted') {
            $usn = (string) ($data['usn'] ?? '');
            $taskId = (string) ($data['taskId'] ?? '');
            if (!preg_match('/^[A-Za-z0-9]{8}-[A-Za-z0-9]{4}-\d{7}$/', $usn)) {
                return [400, ['ok' => false, 'error' => 'bad_usn']];
            }
            if (strpos($taskId, qr_fiscal_task_prefix($doc)) !== 0 || strlen($taskId) > 40) {
                return [400, ['ok' => false, 'error' => 'bad_task']];
            }
            $pdo->prepare("UPDATE fiscal_docs SET status = 'submitted', task_id = ?, usn = ?, claimed_at = ?, seq = ? WHERE id = ?")
                ->execute([$taskId, $usn, $now, $seq, $id]);
            return [200, ['ok' => true]];
        }
        if ($event === 'printed') {
            $number = (string) ($data['receiptNumber'] ?? '');
            if ($number === '') {
                return [400, ['ok' => false, 'error' => 'no_receipt_number']];
            }
            $amount = isset($data['receiptAmount']) ? (int) round((float) $data['receiptAmount'] * 100) : (int) $doc['total_cents'];
            $note = $amount !== (int) $doc['total_cents'] ? 'the printer recorded ' . $amount . ' instead of ' . $doc['total_cents'] : '';
            $pdo->prepare("UPDATE fiscal_docs SET status = 'printed', receipt_number = ?, receipt_at = ?, fm_number = ?, printed_at = ?, error = ?, seq = ? WHERE id = ?")
                ->execute([mb_substr($number, 0, 20), mb_substr((string) ($data['receiptDateTime'] ?? ''), 0, 30),
                    mb_substr((string) ($data['fiscalMemorySerialNumber'] ?? ''), 0, 20), $now, $note, $seq, $id]);
            if ($note !== '') {
                error_log('raya-qr fiscal: receipt ' . $id . ': ' . $note);
            }
            qr_clock_tick($pdo, $doc, $seq, $now);
            return [200, ['ok' => true]];
        }
        if ($event === 'failed') {
            $tries = (int) $doc['tries'];
            $wait = QR_FISCAL_BACKOFF[min(max($tries, 1), count(QR_FISCAL_BACKOFF)) - 1] ?? 3600;
            // Never printed: it may go again under the same task id.
            $pdo->prepare("UPDATE fiscal_docs SET status = 'failed', task_id = '', error = ?, next_at = ?, seq = ? WHERE id = ?")
                ->execute([$error, $now + $wait, $seq, $id]);
            return [200, ['ok' => true]];
        }
        if ($event === 'check') {
            $pdo->prepare("UPDATE fiscal_docs SET status = 'check', error = ?, seq = ? WHERE id = ?")->execute([$error, $seq, $id]);
            return [200, ['ok' => true]];
        }
        return [400, ['ok' => false, 'error' => 'bad_event']];
    });
}

// ── reports and duplicates ───────────────────────────────────────────
//
// Staff ask for them on „За касата“; the bridge prints them once no receipt
// is waiting (a Z report closes the day, so the day's receipts go first).
// Like a receipt: claimed, sent under a task id of ours, looked up — never
// sent twice — when its answer was lost.

const QR_FISCAL_COMMANDS = ['zreport', 'xreport', 'duplicate'];

/** Staff ask for a report (or a duplicate of the last receipt). One already waiting is that one. Returns [httpStatus, body]. */
function qr_fiscal_command_request(string $kind, int $now): array
{
    if (!in_array($kind, QR_FISCAL_COMMANDS, true)) {
        return [400, ['ok' => false, 'error' => 'invalid']];
    }
    $mode = qr_fiscal_mode();
    if ($mode === '') {
        return [409, ['ok' => false, 'error' => 'fiscal_off']];
    }
    return qr_write(function (PDO $pdo) use ($kind, $mode, $now) {
        $find = $pdo->prepare("SELECT * FROM fiscal_commands WHERE kind = ? AND status IN ('pending', 'claimed', 'submitted') ORDER BY id LIMIT 1");
        $find->execute([$kind]);
        $command = $find->fetch();
        $find->closeCursor();
        if (!is_array($command)) {
            $pdo->prepare('INSERT INTO fiscal_commands (test, kind, requested_at, seq) VALUES (?, ?, ?, ?)')
                ->execute([$mode === 'test' ? 1 : 0, $kind, $now, qr_bump_seq($pdo)]);
            $find->execute([$kind]);
            $command = $find->fetch();
            $find->closeCursor();
        }
        return [200, ['ok' => true, 'command' => qr_fiscal_command_json($command)]];
    });
}

/** Inside qr_fiscal_claim: the next report due, as a job for the bridge, or null. */
function qr_fiscal_claim_command(PDO $pdo, int $now)
{
    // A Z report closes the day: never while a receipt is still on its way
    // (claimed by the bridge, or sent to the printer). X reports and
    // duplicates close nothing, and need not wait.
    $busy = $pdo->query("SELECT 1 FROM fiscal_docs WHERE status IN ('pending', 'claimed', 'submitted') LIMIT 1");
    $receiptsOnTheirWay = $busy->fetchColumn() !== false;
    $busy->closeCursor();
    $find = $pdo->prepare("SELECT * FROM fiscal_commands WHERE (status = 'pending'
        OR (status IN ('claimed', 'submitted') AND claimed_at < ?))" . ($receiptsOnTheirWay ? " AND kind <> 'zreport'" : '') . ' ORDER BY id LIMIT 1');
    $find->execute([$now - QR_FISCAL_LEASE]);
    $command = $find->fetch();
    $find->closeCursor();
    if (!is_array($command)) {
        return null;
    }
    $submitted = $command['task_id'] !== '';
    $tries = (int) $command['tries'] + 1;
    $pdo->prepare('UPDATE fiscal_commands SET status = ?, tries = ?, claimed_at = ?, seq = ? WHERE id = ?')
        ->execute([$submitted ? 'submitted' : 'claimed', $tries, $now, qr_bump_seq($pdo), $command['id']]);
    return [
        'id' => (int) $command['id'],
        'kind' => 'command',
        'command' => (string) $command['kind'],
        'code' => (string) $command['kind'],
        'test' => (int) $command['test'] === 1,
        'taskId' => $submitted ? (string) $command['task_id'] : qr_fiscal_command_prefix($command) . $tries,
        'submitted' => $submitted,
    ];
}

function qr_fiscal_command_prefix(array $command): string
{
    return 'raya-cmd-' . ((int) $command['test'] === 1 ? 't' : 'l') . '-' . $command['id'] . '-';
}

/** What the bridge says about a report: submitted {taskId} · done · failed {error} · check {error}. */
function qr_fiscal_command_report(int $id, string $event, array $data, int $now): array
{
    return qr_write(function (PDO $pdo) use ($id, $event, $data, $now) {
        $find = $pdo->prepare('SELECT * FROM fiscal_commands WHERE id = ?');
        $find->execute([$id]);
        $command = $find->fetch();
        $find->closeCursor();
        if (!is_array($command)) {
            return [404, ['ok' => false, 'error' => 'not_found']];
        }
        if ($command['status'] === 'done' && $event === 'done') {
            return [200, ['ok' => true, 'already' => true]];
        }
        if (!in_array($command['status'], ['claimed', 'submitted'], true)) {
            return [409, ['ok' => false, 'error' => 'not_claimed', 'status' => $command['status']]];
        }
        $seq = qr_bump_seq($pdo);
        $error = mb_substr((string) ($data['error'] ?? ''), 0, 300);
        if ($event === 'submitted') {
            $taskId = (string) ($data['taskId'] ?? '');
            if (strpos($taskId, qr_fiscal_command_prefix($command)) !== 0 || strlen($taskId) > 40) {
                return [400, ['ok' => false, 'error' => 'bad_task']];
            }
            $pdo->prepare("UPDATE fiscal_commands SET status = 'submitted', task_id = ?, claimed_at = ?, seq = ? WHERE id = ?")
                ->execute([$taskId, $now, $seq, $id]);
        } elseif ($event === 'done') {
            $pdo->prepare("UPDATE fiscal_commands SET status = 'done', done_at = ?, error = '', seq = ? WHERE id = ?")->execute([$now, $seq, $id]);
        } elseif ($event === 'failed' || $event === 'check') {
            // Not retried by itself: staff ask again (a report twice is worse than once missed).
            $pdo->prepare('UPDATE fiscal_commands SET status = ?, error = ?, seq = ? WHERE id = ?')->execute([$event, $error, $seq, $id]);
        } else {
            return [400, ['ok' => false, 'error' => 'bad_event']];
        }
        return [200, ['ok' => true]];
    });
}

function qr_fiscal_command_json(array $c): array
{
    return [
        'id' => (int) $c['id'],
        'kind' => (string) $c['kind'],
        'status' => (string) $c['status'],
        'requestedAt' => (int) $c['requested_at'],
        'doneAt' => (int) $c['done_at'],
        'error' => (string) $c['error'],
        'seq' => (int) $c['seq'],
    ];
}

/** The last few reports, for the staff screen. */
function qr_fiscal_commands_feed(PDO $pdo): array
{
    $rows = $pdo->query('SELECT * FROM fiscal_commands ORDER BY id DESC LIMIT 6')->fetchAll();
    return array_map('qr_fiscal_command_json', $rows);
}

// ── staff („За касата“) ──────────────────────────────────────────────

/**
 * Staff tick (or untick) a payment on „За касата“ by hand, as for Clock
 * (qr_clock_hand_tick): '' to go ahead, 'fiscal_printing' while the bridge
 * has it, 'fiscal_done' to untick what was printed. A tick before it
 * printed stops it ('manual').
 */
function qr_fiscal_hand_tick(PDO $pdo, string $source, int $sourceId, string $column, bool $value, int $now): string
{
    $kind = $column === 'till_at' ? 'sale' : 'storno';
    $find = $pdo->prepare('SELECT * FROM fiscal_docs WHERE source = ? AND source_id = ? AND kind = ? ORDER BY id');
    $find->execute([$source, $sourceId, $kind]);
    $docs = $find->fetchAll();
    $find->closeCursor();
    foreach ($docs as $doc) {
        if (in_array($doc['status'], ['claimed', 'submitted'], true) && (int) $doc['claimed_at'] >= $now - QR_FISCAL_LEASE) {
            return 'fiscal_printing';
        }
        if (!$value && $doc['status'] === 'printed') {
            return 'fiscal_done';
        }
    }
    if ($value) {
        foreach ($docs as $doc) {
            if (in_array($doc['status'], ['pending', 'failed', 'check', 'claimed', 'submitted'], true)) {
                qr_fiscal_set_manual($pdo, $doc);
            }
        }
    }
    return '';
}

/** Staff send a stopped receipt again: one that failed, or — once they have looked at the printer — one to check. */
function qr_fiscal_retry(int $id): array
{
    return qr_write(function (PDO $pdo) use ($id) {
        $find = $pdo->prepare('SELECT * FROM fiscal_docs WHERE id = ?');
        $find->execute([$id]);
        $doc = $find->fetch();
        $find->closeCursor();
        if (!is_array($doc)) {
            return [404, ['ok' => false, 'error' => 'not_found']];
        }
        if (!in_array($doc['status'], ['failed', 'check'], true)) {
            return [409, ['ok' => false, 'error' => 'not_retryable', 'doc' => qr_fiscal_doc_json($doc)]];
        }
        // From 'check': a person looked and found it not printed. The tries
        // are kept: the next one is a new task id, never an old one's answer.
        $pdo->prepare("UPDATE fiscal_docs SET status = 'pending', next_at = 0, task_id = '', error = '', seq = ? WHERE id = ?")
            ->execute([qr_bump_seq($pdo), $id]);
        $find->execute([$id]);
        $doc = $find->fetch();
        $find->closeCursor();
        return [200, ['ok' => true, 'doc' => qr_fiscal_doc_json($doc)]];
    });
}

function qr_fiscal_doc_json(array $d): array
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
        'usn' => (string) $d['usn'],
        'receiptNumber' => (string) $d['receipt_number'],
        'receiptAt' => (string) $d['receipt_at'],
        'total' => (int) $d['total_cents'],
        'tip' => (int) $d['tip_cents'],
        'tries' => (int) $d['tries'],
        'error' => (string) $d['error'],
        'createdAt' => (int) $d['created_at'],
        'printedAt' => (int) $d['printed_at'],
        'seq' => (int) $d['seq'],
    ];
}

/** Receipts for the staff screen: changed since $since, or (0) the last two days and anything not settled. */
function qr_fiscal_feed(PDO $pdo, int $since, int $now): array
{
    if ($since > 0) {
        $stmt = $pdo->prepare('SELECT * FROM fiscal_docs WHERE seq > ? ORDER BY id');
        $stmt->execute([$since]);
    } else {
        $stmt = $pdo->prepare("SELECT * FROM fiscal_docs WHERE created_at > ? OR status NOT IN ('printed', 'manual') ORDER BY id");
        $stmt->execute([$now - 172800]);
    }
    return array_map('qr_fiscal_doc_json', $stmt->fetchAll());
}

/** The bridge, for the staff screen: when it was last heard from, and its printer. */
function qr_fiscal_bridge_json(PDO $pdo, int $now): array
{
    $row = $pdo->query('SELECT * FROM fiscal_bridge WHERE id = 1')->fetch();
    $lastSeen = is_array($row) ? (int) $row['last_seen'] : 0;
    return [
        'online' => $lastSeen >= $now - QR_FISCAL_BRIDGE_LOST,
        'lastSeen' => $lastSeen,
        'printerOk' => is_array($row) && (int) $row['printer_ok'] === 1,
        'printer' => is_array($row) ? (string) $row['printer_serial'] : '',
        'message' => is_array($row) ? (string) $row['message'] : '',
    ];
}
