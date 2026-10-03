<?php
// The history of past evenings: "История" on the staff screen
// (admin/history.php) and spreadsheet files (admin/export.php).
//
// Nothing is ever deleted. Every order, line and payment stays in the
// database under the evening (the service date) it was placed on, so the
// history is read straight from them — a report per evening, worked out
// when asked for, and always in step with refunds or lines taken off later.
//
// What counts:
// - An order counts once it reached staff: not one still waiting for (or
//   never given) a phone payment. A cancelled order is counted as
//   cancelled, not as a sale.
// - Sales: what the orders still standing come to, without the lines staff
//   took off ("Няма").
// - How it was paid, as far as the system knows:
//   · to staff — orders on a "pay staff" evening, and lines of a table's
//     bill settled on the spot (cash or the card terminal: the system
//     cannot tell which);
//   · by card on the phone — orders paid before they went out, and
//     payments from tables' bills, less what is owed back;
//   · still unpaid on a bill (nothing, once every bill is closed).
//   The three add up to the sales. Tips are apart; refunds are what was
//   returned to guests.
// - A table's waiter is the one on that evening's list as it stood at the
//   end (the list can change during the evening).
//
// The files leave out names (the guest's, the payer's). The database
// erases them after QR_NAME_DAYS; a downloaded file would keep them.
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_EXPORT_DAYS = 400; // one file covers at most this many days

/** A real calendar date, YYYY-MM-DD. */
function qr_is_date(string $value): bool
{
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m)) {
        return false;
    }
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]);
}

/** Every evening with orders, newest first: its date, orders and sales. */
function qr_history_evenings(PDO $pdo): array
{
    $rows = $pdo->query("SELECT evening,
            SUM(CASE WHEN status <> 'cancelled' THEN 1 ELSE 0 END) AS orders,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN status <> 'cancelled' THEN total_cents - void_cents ELSE 0 END) AS sales
        FROM orders
        WHERE status NOT IN ('pending_payment', 'expired') AND evening <> ''
        GROUP BY evening ORDER BY evening DESC")->fetchAll();
    return array_map(function ($r) {
        return ['evening' => (string) $r['evening'], 'orders' => (int) $r['orders'], 'cancelled' => (int) $r['cancelled'], 'sales' => (int) $r['sales']];
    }, $rows);
}

/** One evening, in full: the figures, and every order with its lines. */
function qr_history_report(PDO $pdo, string $evening): array
{
    return ['evening' => $evening] + qr_history_figures($pdo, $evening, $evening, true);
}

/** An evening's own line in a longer stretch (a month). */
function qr_history_day(string $evening): array
{
    return ['evening' => $evening, 'orders' => 0, 'cancelled' => 0, 'sales' => 0, 'staff' => 0, 'card' => 0, 'unpaid' => 0, 'tips' => 0];
}

/**
 * The figures for the evenings from $from to $to — one evening, or a month —
 * and each evening's own (days). With $withList, every order and its lines.
 */
function qr_history_figures(PDO $pdo, string $from, string $to, bool $withList = false): array
{
    $waiters = [];
    $stmt = $pdo->prepare('SELECT evening, table_no, name FROM waiters WHERE evening BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    foreach ($stmt->fetchAll() as $w) {
        $waiters[$w['evening']][(int) $w['table_no']] = (string) $w['name'];
    }
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE evening BETWEEN ? AND ? AND status NOT IN ('pending_payment', 'expired')
        ORDER BY evening, created_at, id");
    $stmt->execute([$from, $to]);
    $orders = $stmt->fetchAll();

    $sales = 0;
    $count = 0;
    $voided = 0;
    $cancelled = 0;
    $cancelledTotal = 0;
    $pay = ['staff' => 0, 'card' => 0, 'unpaid' => 0];
    $card = ['orders' => 0, 'bills' => 0];
    $refunded = 0;
    $refundOwed = 0;
    $tables = [];
    $byWaiter = [];
    $days = [];
    $tips = 0; // with orders paid on the phone, and with bill payments
    $first = 0;
    $last = 0;
    $list = [];
    foreach ($orders as $o) {
        $e = (string) $o['evening'];
        $days[$e] = $days[$e] ?? qr_history_day($e);
        $waiter = $waiters[$e][(int) $o['table_no']] ?? '';
        if ($withList) {
            $json = qr_order_json($o);
            $json['waiter'] = $waiter;
            $list[] = $json;
        }
        $refunded += (int) $o['refunded_cents'];
        $refundOwed += max(0, (int) $o['refund_due_cents'] - (int) $o['refunded_cents']);
        if ($o['status'] === 'cancelled') {
            $cancelled++;
            $cancelledTotal += (int) $o['total_cents'];
            $days[$e]['cancelled']++;
            continue;
        }
        $net = (int) $o['total_cents'] - (int) $o['void_cents'];
        $count++;
        $sales += $net;
        $voided += (int) $o['void_cents'];
        $tables[$e . '|' . $o['table_no']] = true;
        $first = $first ?: (int) $o['created_at'];
        $last = (int) $o['created_at'];
        $days[$e]['orders']++;
        $days[$e]['sales'] += $net;
        if (!isset($byWaiter[$waiter])) {
            $byWaiter[$waiter] = ['name' => $waiter, 'orders' => 0, 'tables' => [], 'evenings' => [], 'sales' => 0];
        }
        $byWaiter[$waiter]['orders']++;
        $byWaiter[$waiter]['tables'][(int) $o['table_no']] = true;
        $byWaiter[$waiter]['evenings'][$e] = true;
        $byWaiter[$waiter]['sales'] += $net;
        if ((int) $o['tab_id'] === 0) {
            // A table's bill is paid line by line, below; anything else
            // was paid on the phone before it went out, or to staff.
            if ($o['pay_status'] === 'paid') {
                $card['orders'] += $net;
                $days[$e]['card'] += $net;
                $tips += (int) $o['tip_cents'];
                $days[$e]['tips'] += (int) $o['tip_cents'];
            } else {
                $pay['staff'] += $net;
                $days[$e]['staff'] += $net;
            }
        }
    }

    // Lines of the orders still standing: stations, items, and how the
    // lines of tables' bills were paid.
    $stmt = $pdo->prepare("SELECT i.*, o.tab_id, o.evening FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.evening BETWEEN ? AND ? AND o.status NOT IN ('pending_payment', 'expired', 'cancelled') ORDER BY i.order_id, i.line");
    $stmt->execute([$from, $to]);
    $stations = [];
    foreach (QR_STATIONS as $station) {
        $stations[$station] = ['qty' => 0, 'sales' => 0];
    }
    $items = [];
    foreach ($stmt->fetchAll() as $i) {
        $qty = (int) $i['qty'] - (int) $i['void_qty'];
        $amount = $qty * (int) $i['unit_cents'];
        $station = (string) $i['station'] !== '' ? (string) $i['station'] : qr_item_station((string) $i['item_id']);
        $stations[$station]['qty'] += $qty;
        $stations[$station]['sales'] += $amount;
        $key = $i['item_id'] . '|' . $i['variant_id'] . '|' . $i['choice_id'];
        if (!isset($items[$key])) {
            $items[$key] = ['name' => (string) $i['name_bg'], 'detail' => (string) $i['detail_bg'], 'station' => $station, 'qty' => 0, 'voidQty' => 0, 'sales' => 0];
        }
        $items[$key]['qty'] += $qty;
        $items[$key]['voidQty'] += (int) $i['void_qty'];
        $items[$key]['sales'] += $amount;
        if ((int) $i['tab_id'] > 0) {
            if ($i['paid_via'] === 'staff') {
                $pay['staff'] += $amount;
                $days[$i['evening']]['staff'] += $amount;
            } elseif ($i['paid_via'] === '') {
                $pay['unpaid'] += $amount;
                $days[$i['evening']]['unpaid'] += $amount;
            }
            // 'online': in the bill payments below, at what was kept.
        }
    }
    $items = array_values($items);
    usort($items, function ($a, $b) {
        return [$b['sales'], $b['qty'], $a['name']] <=> [$a['sales'], $a['qty'], $b['name']];
    });

    // Payments from tables' bills: what was kept after anything owed back,
    // and the tips on top.
    $stmt = $pdo->prepare("SELECT p.*, t.evening FROM bill_payments p JOIN tabs t ON t.id = p.tab_id
        WHERE t.evening BETWEEN ? AND ? AND p.status = 'paid' ORDER BY p.paid_at");
    $stmt->execute([$from, $to]);
    $billPayments = 0;
    foreach ($stmt->fetchAll() as $p) {
        $json = qr_bill_payment_json($p);
        $e = (string) $p['evening'];
        $days[$e] = $days[$e] ?? qr_history_day($e);
        $card['bills'] += $json['net'];
        $tips += $json['tipNet'];
        $days[$e]['card'] += $json['net'];
        $days[$e]['tips'] += $json['tipNet'];
        $refunded += (int) $p['refunded_cents'];
        $refundOwed += max(0, (int) $p['refund_due_cents'] - (int) $p['refunded_cents']);
        $billPayments++;
    }
    $pay['card'] = $card['orders'] + $card['bills'];
    ksort($days);

    $waiterList = array_values(array_map(function ($w) {
        $w['tables'] = array_keys($w['tables']);
        sort($w['tables']);
        $w['evenings'] = count($w['evenings']);
        return $w;
    }, $byWaiter));
    usort($waiterList, function ($a, $b) {
        // Tables without a waiter last.
        return [$a['name'] === '', $b['sales']] <=> [$b['name'] === '', $a['sales']];
    });

    return [
        'from' => $from,
        'to' => $to,
        'orders' => $count,
        'sales' => $sales,
        'average' => $count ? intdiv($sales + intdiv($count, 2), $count) : 0,
        // Tables served: one table on two evenings counts twice.
        'tables' => count($tables),
        'voided' => $voided,
        'cancelled' => $cancelled,
        'cancelledTotal' => $cancelledTotal,
        'firstAt' => $first,
        'lastAt' => $last,
        'pay' => $pay,
        'card' => $card,
        'billPayments' => $billPayments,
        'tips' => $tips,
        'refunded' => $refunded,
        'refundOwed' => $refundOwed,
        'stations' => $stations,
        'waiters' => $waiterList,
        'items' => $items,
        'days' => array_values($days),
        'list' => $list,
    ];
}

// ── spreadsheet files ────────────────────────────────────────────────
//
// CSV the way Excel opens it in Bulgarian: UTF-8 with a byte-order mark,
// ";" between cells, a decimal comma. Google Sheets and LibreOffice read it
// as well.

/** A text cell. One that starts like a formula is kept as text. */
function qr_csv_text(string $value): string
{
    if ($value !== '' && strpos("=+-@\t\r", $value[0]) !== false) {
        $value = "'" . $value;
    }
    return strpbrk($value, ";\"\r\n") === false ? $value : '"' . str_replace('"', '""', $value) . '"';
}

/** 1250 → 12,50 */
function qr_csv_money(int $cents): string
{
    return ($cents < 0 ? '-' : '') . intdiv(abs($cents), 100) . ',' . str_pad((string) (abs($cents) % 100), 2, '0', STR_PAD_LEFT);
}

/** A unix time as "2026-10-03 20:45", Sofia time. */
function qr_csv_time(int $at): string
{
    if ($at <= 0) {
        return '';
    }
    return (new DateTime('@' . $at))->setTimezone(new DateTimeZone(QR_TZ))->format('Y-m-d H:i');
}

function qr_csv_row(array $cells): string
{
    return implode(';', $cells) . "\r\n";
}

const QR_STATUS_BG = ['new' => 'нова', 'accepted' => 'приета', 'served' => 'сервирана', 'cancelled' => 'отказана'];
const QR_STATION_BG = ['kitchen' => 'кухня', 'bar' => 'бар'];

/**
 * One row per order line, for every evening from $from to $to: what was
 * ordered, what of it stood, and how it was paid. Written out as it is read.
 */
function qr_export_lines(PDO $pdo, string $from, string $to, callable $out)
{
    $waiters = [];
    $stmt = $pdo->prepare('SELECT evening, table_no, name FROM waiters WHERE evening BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    foreach ($stmt->fetchAll() as $w) {
        $waiters[$w['evening']][(int) $w['table_no']] = (string) $w['name'];
    }
    $out(qr_csv_row(['Вечер', 'Поръчана', 'Код', 'Маса', 'Сервитьор', 'Статус', 'Плащане', 'Място', 'Артикул', 'Вид',
        'Брой', 'Отказани', 'Ед. цена', 'Сума', 'Причина за отказ', 'Бележка']));
    $stmt = $pdo->prepare("SELECT o.evening, o.code, o.created_at, o.table_no, o.status, o.cancel_reason, o.pay_status, o.tab_id,
            i.item_id, i.station, i.name_bg, i.detail_bg, i.unit_cents, i.qty, i.void_qty, i.void_reason, i.note, i.paid_via
        FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE o.evening BETWEEN ? AND ? AND o.status NOT IN ('pending_payment', 'expired')
        ORDER BY o.evening, o.created_at, o.id, i.line");
    $stmt->execute([$from, $to]);
    $tabPaid = ['online' => 'сметка, с карта', 'staff' => 'сметка, на място', '' => 'сметка, неплатено', 'refunded' => 'сметка, върнато'];
    $ordPaid = ['paid' => 'с карта онлайн', 'refunded' => 'върнато', '' => 'на персонала'];
    while ($r = $stmt->fetch()) {
        $cancelled = $r['status'] === 'cancelled';
        $qty = $cancelled ? 0 : (int) $r['qty'] - (int) $r['void_qty'];
        $off = $cancelled ? (int) $r['qty'] : (int) $r['void_qty'];
        $station = (string) $r['station'] !== '' ? (string) $r['station'] : qr_item_station((string) $r['item_id']);
        $paid = (int) $r['tab_id'] > 0 ? ($tabPaid[$r['paid_via']] ?? '') : ($ordPaid[$r['pay_status']] ?? '');
        $out(qr_csv_row([
            $r['evening'],
            qr_csv_time((int) $r['created_at']),
            qr_csv_text((string) $r['code']),
            (int) $r['table_no'],
            qr_csv_text($waiters[$r['evening']][(int) $r['table_no']] ?? ''),
            QR_STATUS_BG[$r['status']] ?? $r['status'],
            $cancelled ? '' : $paid,
            QR_STATION_BG[$station] ?? $station,
            qr_csv_text((string) $r['name_bg']),
            qr_csv_text((string) $r['detail_bg']),
            $qty,
            $off,
            qr_csv_money((int) $r['unit_cents']),
            qr_csv_money($qty * (int) $r['unit_cents']),
            qr_csv_text($cancelled ? (string) $r['cancel_reason'] : ($off ? (string) $r['void_reason'] : '')),
            qr_csv_text((string) $r['note']),
        ]));
    }
}

/**
 * One row per card payment on the phone — an order paid before it went out,
 * or a payment from a table's bill — for matching against Stripe and Clock.
 */
function qr_export_payments(PDO $pdo, string $from, string $to, callable $out)
{
    $out(qr_csv_row(['Вечер', 'Платено', 'Код', 'Маса', 'Вид', 'Сума', 'Бакшиш', 'Общо платено', 'Върнато',
        'Остава за връщане', 'Задържано', 'Въведено в Clock', 'Stripe плащане']));
    $stmt = $pdo->prepare("SELECT 'order' AS kind, evening, code, paid_at, table_no, total_cents AS amount, tip_cents AS tip,
            refund_due_cents AS due, refunded_cents AS refunded, till_at, payment_intent
        FROM orders WHERE evening BETWEEN ? AND ? AND paid_at > 0 AND pay_status IN ('paid', 'refunded')
        UNION ALL
        SELECT 'bill', t.evening, p.code, p.paid_at, p.table_no, p.amount_cents, p.tip_cents,
            p.refund_due_cents, p.refunded_cents, p.till_at, p.payment_intent
        FROM bill_payments p JOIN tabs t ON t.id = p.tab_id WHERE t.evening BETWEEN ? AND ? AND p.status = 'paid'
        ORDER BY 2, 4");
    $stmt->execute([$from, $to, $from, $to]);
    while ($r = $stmt->fetch()) {
        $paid = (int) $r['amount'] + (int) $r['tip'];
        $out(qr_csv_row([
            $r['evening'],
            qr_csv_time((int) $r['paid_at']),
            qr_csv_text((string) $r['code']),
            (int) $r['table_no'],
            $r['kind'] === 'bill' ? 'сметка' : 'поръчка',
            qr_csv_money((int) $r['amount']),
            qr_csv_money((int) $r['tip']),
            qr_csv_money($paid),
            qr_csv_money((int) $r['refunded']),
            qr_csv_money(max(0, (int) $r['due'] - (int) $r['refunded'])),
            qr_csv_money(max(0, $paid - (int) $r['due'])),
            (int) $r['till_at'] > 0 ? 'да' : 'не',
            qr_csv_text((string) $r['payment_intent']),
        ]));
    }
}
