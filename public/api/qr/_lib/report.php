<?php
// The monthly summary by e-mail: last month's figures from "История", with
// the month's two spreadsheet files attached, to the address staff set in
// История (settings.report_email).
//
// When: on the 1st, after the first poll of the staff screen from 06:00
// (Sofia) — once the last evening of the month is surely over. The tablet
// gets its answer first (fastcgi_finish_request); the e-mail goes after.
// No cron job. A report that could not be sent is tried again an hour
// later, up to QR_REPORT_TRIES times. Every attempt is logged
// (report_mails) and shown in История, where staff can also send any month
// at once — which is how a new address is tested.
//
// How: SMTP when raya-mailer-config.php or RAYA_SMTP_* are set up (as for
// wedding enquiries), else the host's own mail (PHP mail()). rayagarden.bg's
// mail is on the same server, and its SPF record allows it to send.
//
// No guest names: the figures have none, and neither do the files.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/mail.php';

const QR_REPORT_TRIES = 6;         // automatic attempts per month
const QR_REPORT_MANUAL_LIMIT = 5;  // "Изпрати сега" per hour
const QR_MONTHS_BG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const QR_WEEKDAYS_BG = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

/** "2026-09" → "септември 2026" */
function qr_month_name(string $month): string
{
    return QR_MONTHS_BG[(int) substr($month, 5, 2) - 1] . ' ' . substr($month, 0, 4);
}

/** A real month, YYYY-MM. */
function qr_is_month(string $value): bool
{
    return (bool) preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $value);
}

/** The first and last date of a month. */
function qr_month_range(string $month): array
{
    return [$month . '-01', (new DateTime($month . '-01'))->format('Y-m-t')];
}

/**
 * The last month that has ended: the one before the month of six hours ago
 * in Sofia, so the 1st's small hours still belong to the evening before.
 */
function qr_report_last_month(int $now): string
{
    $local = (new DateTime('@' . ($now - 6 * 3600)))->setTimezone(new DateTimeZone(QR_TZ));
    return $local->modify('first day of this month')->modify('-1 month')->format('Y-m');
}

/** Has this month ended (and its last evening with it)? */
function qr_report_complete(string $month, int $now): bool
{
    return $month <= qr_report_last_month($now);
}

/**
 * The month whose summary should go out by itself now, or null. Cheap: one
 * indexed read, made only while an address is set.
 */
function qr_report_auto_due(PDO $pdo, string $email, int $now)
{
    if ($email === '') {
        return null;
    }
    $month = qr_report_last_month($now);
    $stmt = $pdo->prepare('SELECT status, manual, complete, at FROM report_mails WHERE month = ? ORDER BY id DESC');
    $stmt->execute([$month]);
    $rows = $stmt->fetchAll();
    $stmt->closeCursor();
    $failed = 0;
    foreach ($rows as $r) {
        if ((int) $r['complete'] === 1 && in_array($r['status'], ['sent', 'empty'], true)) {
            return null; // done
        }
        if ($r['status'] === 'sending' && (int) $r['at'] > $now - 900) {
            return null; // under way on another request
        }
        if ((int) $r['manual'] === 0 && $r['status'] !== 'sent') {
            $failed++;
            if ((int) $r['at'] > $now - 3600) {
                return null; // tried within the hour
            }
        }
    }
    return $failed >= QR_REPORT_TRIES ? null : $month;
}

/**
 * Send a month's summary now and log it. Automatic sends make sure, inside
 * the write lock, that no other request has just started the same one.
 * Returns [status, error]: 'sent', 'failed', 'empty' (no orders, nothing
 * sent), 'skipped' (not due after all) or 'rate_limited'.
 */
function qr_report_run(string $month, string $email, bool $manual, int $now): array
{
    $id = qr_write(function (PDO $pdo) use ($month, $email, $manual, $now) {
        if (!$manual && qr_report_auto_due($pdo, $email, $now) !== $month) {
            return 0;
        }
        if ($manual) {
            $recent = $pdo->prepare('SELECT COUNT(*) FROM report_mails WHERE manual = 1 AND at > ?');
            $recent->execute([$now - 3600]);
            $count = (int) $recent->fetchColumn();
            $recent->closeCursor();
            if ($count >= QR_REPORT_MANUAL_LIMIT) {
                return -1;
            }
        }
        $pdo->prepare("INSERT INTO report_mails (month, recipient, manual, complete, status, at) VALUES (?, ?, ?, ?, 'sending', ?)")
            ->execute([$month, $email, $manual ? 1 : 0, qr_report_complete($month, $now) ? 1 : 0, $now]);
        return (int) $pdo->lastInsertId();
    });
    if ($id === 0) {
        return ['skipped', ''];
    }
    if ($id === -1) {
        return ['rate_limited', ''];
    }
    try {
        list($status, $error) = qr_report_send($month, $email, $now);
    } catch (Throwable $e) {
        list($status, $error) = ['failed', 'internal error: ' . $e->getMessage()];
    }
    qr_write(function (PDO $pdo) use ($id, $status, $error) {
        $pdo->prepare('UPDATE report_mails SET status = ?, error = ? WHERE id = ?')->execute([$status, mb_substr($error, 0, 300), $id]);
    });
    return [$status, $error];
}

/**
 * For the staff screen's poll: once its answer has gone back to the tablet,
 * send last month's summary if it is due. Never lets anything escape — the
 * screen's answer is already on its way.
 */
function qr_report_after_response(int $now)
{
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    }
    ignore_user_abort(true);
    @set_time_limit(90);
    try {
        $email = (string) (qr_settings()['report_email'] ?? '');
        $month = qr_report_auto_due(qr_db(), $email, $now);
        if ($month !== null) {
            qr_report_run($month, $email, false, $now);
        }
    } catch (Throwable $e) {
        error_log('raya qr monthly report: ' . $e->getMessage());
    }
}

/** The last attempts to send, newest first, for История. */
function qr_report_log(PDO $pdo, int $limit = 12): array
{
    $stmt = $pdo->prepare('SELECT * FROM report_mails ORDER BY id DESC LIMIT ?');
    $stmt->bindValue(1, $limit, PDO::PARAM_INT);
    $stmt->execute();
    return array_map(function ($r) {
        return [
            'month' => (string) $r['month'], 'recipient' => (string) $r['recipient'], 'manual' => (int) $r['manual'] === 1,
            'complete' => (int) $r['complete'] === 1, 'status' => (string) $r['status'], 'error' => (string) $r['error'], 'at' => (int) $r['at'],
        ];
    }, $stmt->fetchAll());
}

// ── the e-mail ───────────────────────────────────────────────────────

/** Build a month's summary and send it. Returns [status, error]. */
function qr_report_send(string $month, string $email, int $now): array
{
    list($from, $to) = qr_month_range($month);
    $pdo = qr_db();
    $pdo->exec('BEGIN');
    try {
        $figures = qr_history_figures($pdo, $from, $to);
        $files = [];
        if ($figures['orders'] > 0 || $figures['cancelled'] > 0) {
            foreach (['lines' => 'poruchki', 'payments' => 'plashtania'] as $kind => $name) {
                $csv = "\xEF\xBB\xBF";
                $append = function (string $row) use (&$csv) {
                    $csv .= $row;
                };
                $kind === 'lines' ? qr_export_lines($pdo, $from, $to, $append) : qr_export_payments($pdo, $from, $to, $append);
                $files["raya-$name-$month.csv"] = $csv;
            }
        }
        $pdo->exec('COMMIT');
    } catch (Throwable $e) {
        $pdo->exec('ROLLBACK');
        throw $e;
    }
    if (!$files) {
        return ['empty', ''];
    }
    list($subject, $text, $html) = qr_report_message($month, $figures, $files, $now);
    list($ok, $error) = qr_mail($email, $subject, $text, $html, $files);
    return $ok ? ['sent', ''] : ['failed', $error];
}

/** 123456 → "1 234,56 €" */
function qr_report_money(int $cents): string
{
    return ($cents < 0 ? '-' : '') . number_format(abs($cents) / 100, 2, ',', "\u{00A0}") . "\u{00A0}€";
}

/** [subject, plain text, HTML] of a month's summary. */
function qr_report_message(string $month, array $f, array $files, int $now): array
{
    $name = qr_month_name($month);
    $complete = qr_report_complete($month, $now);
    $today = (new DateTime('@' . $now))->setTimezone(new DateTimeZone(QR_TZ));
    $title = 'Поръчки от масата — ' . $name . ($complete ? '' : ' (до ' . (int) $today->format('j') . ' ' . QR_MONTHS_BG[(int) $today->format('n') - 1] . ')');
    $subject = 'RAYA Garden · ' . $title;
    $m = 'qr_report_money';

    $summary = [
        ['Продажби', $m($f['sales'])],
        ['Поръчки', $f['orders'] . ' за ' . count($f['days']) . (count($f['days']) === 1 ? ' вечер' : ' вечери')],
        ['Средно на поръчка', $m($f['average'])],
        ['Отказани поръчки', $f['cancelled'] . ($f['cancelled'] ? ' (' . $m($f['cancelledTotal']) . ')' : '')],
        ['„Няма“ на отделни редове', $m($f['voided'])],
    ];
    $pay = [
        ['На персонала (в брой или терминал)', $m($f['pay']['staff'])],
        ['С карта онлайн', $m($f['pay']['card'])],
    ];
    if ($f['pay']['unpaid'] > 0) {
        $pay[] = ['Неплатено по сметки', $m($f['pay']['unpaid'])];
    }
    $pay[] = ['Бакшиши с карта (не са в продажбите)', $m($f['tips'])];
    $pay[] = ['Върнати на гости', $m($f['refunded'])];
    if ($f['refundOwed'] > 0) {
        $pay[] = ['Чакат връщане', $m($f['refundOwed'])];
    }
    $stations = [
        ['Кухня', $f['stations']['kitchen']['qty'] . ' бр.', $m($f['stations']['kitchen']['sales'])],
        ['Бар', $f['stations']['bar']['qty'] . ' бр.', $m($f['stations']['bar']['sales'])],
    ];
    $days = array_map(function ($d) use ($m) {
        $date = new DateTime($d['evening']);
        return [QR_WEEKDAYS_BG[(int) $date->format('w')] . ' ' . $date->format('j.m'), (string) $d['orders'], $m($d['sales']), $m($d['staff']), $m($d['card']), $m($d['tips'])];
    }, $f['days']);
    $waiters = array_map(function ($w) use ($m) {
        return [$w['name'] !== '' ? $w['name'] : 'Без сервитьор', (string) $w['evenings'], (string) $w['orders'], $m($w['sales'])];
    }, $f['waiters']);
    $items = array_map(function ($i) use ($m) {
        return [(string) $i['qty'], $i['name'] . ($i['detail'] !== '' ? ' · ' . $i['detail'] : ''), $m($i['sales'])];
    }, array_slice(array_values(array_filter($f['items'], function ($i) {
        return $i['qty'] > 0;
    })), 0, 20));
    $names = array_keys($files);
    $footer = [
        'Приложени файлове за Excel: ' . $names[0] . ' (ред за всеки поръчан артикул) и ' . $names[1] . ' (плащанията с карта, за сверяване със Stripe и Clock). Имената на гостите не се включват.',
        'Цялата история: rayagarden.bg/admin → История. Отчетът идва автоматично на 1-во число; адресът се сменя там.',
    ];

    // Plain text.
    $text = $title . "\r\n" . str_repeat('=', mb_strlen($title)) . "\r\n\r\n";
    $section = function (string $heading, array $rows) {
        $out = $heading . "\r\n";
        foreach ($rows as $row) {
            $out .= '  ' . implode('  |  ', $row) . "\r\n";
        }
        return $out . "\r\n";
    };
    $text .= $section('Обобщение', $summary) . $section('Плащане', $pay) . $section('Кухня и бар', $stations)
        . $section('По вечери (дата | поръчки | продажби | на персонала | с карта | бакшиши)', $days)
        . ($waiters ? $section('Сервитьори (име | вечери | поръчки | продажби)', $waiters) : '')
        . ($items ? $section('Най-продавани (брой | артикул | сума)', $items) : '')
        . implode("\r\n", $footer) . "\r\n";

    // HTML, styled inline for mail programs.
    $e = function (string $s) {
        return htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    };
    $table = function (string $heading, array $head, array $rows, array $right) use ($e) {
        $out = '<h2 style="font:600 17px Georgia,serif;color:#3b2f1e;margin:26px 0 8px">' . $e($heading) . '</h2>'
            . '<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font:14px Arial,sans-serif;color:#222">';
        if ($head) {
            $out .= '<tr>';
            foreach ($head as $n => $h) {
                $out .= '<th style="text-align:' . (in_array($n, $right, true) ? 'right' : 'left') . ';padding:6px 8px;border-bottom:2px solid #c9b48a;font-weight:600;color:#6b5a3a">' . $e($h) . '</th>';
            }
            $out .= '</tr>';
        }
        foreach ($rows as $row) {
            $out .= '<tr>';
            foreach ($row as $n => $cell) {
                $out .= '<td style="padding:6px 8px;border-bottom:1px solid #eee5d3;text-align:' . (in_array($n, $right, true) ? 'right' : 'left') . (in_array($n, $right, true) ? ';white-space:nowrap' : '') . '">' . $e($cell) . '</td>';
            }
            $out .= '</tr>';
        }
        return $out . '</table>';
    };
    $html = '<!doctype html><html lang="bg"><body style="margin:0;padding:24px;background:#faf6ee">'
        . '<div style="max-width:680px;margin:0 auto;background:#fff;padding:24px 28px;border:1px solid #eee5d3">'
        . '<div style="font:12px Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#a08450">RAYA Garden</div>'
        . '<h1 style="font:600 24px Georgia,serif;color:#3b2f1e;margin:6px 0 4px">' . $e($title) . '</h1>'
        . '<div style="font:32px Georgia,serif;color:#222;margin:12px 0 0">' . $e($m($f['sales'])) . '</div>'
        . '<div style="font:13px Arial,sans-serif;color:#6b5a3a">продажби от поръчките от масата</div>'
        . $table('Обобщение', [], $summary, [1])
        . $table('Плащане', [], $pay, [1])
        . $table('Кухня и бар', [], $stations, [1, 2])
        . $table('По вечери', ['Вечер', 'Поръчки', 'Продажби', 'На персонала', 'С карта', 'Бакшиши'], $days, [1, 2, 3, 4, 5])
        . ($waiters ? $table('Сервитьори', ['Сервитьор', 'Вечери', 'Поръчки', 'Продажби'], $waiters, [1, 2, 3]) : '')
        . ($items ? $table('Най-продавани', ['Брой', 'Артикул', 'Сума'], $items, [0, 2]) : '')
        . '<p style="font:13px Arial,sans-serif;color:#555;margin:26px 0 0;line-height:1.5">' . implode('<br>', array_map($e, $footer)) . '</p>'
        . '</div></body></html>';
    return [$subject, $text, $html];
}
