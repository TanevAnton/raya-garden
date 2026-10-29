<?php
// НАП's tables (Наредба Н-18, Annex 29 т. 18), for a period and, if asked,
// one fiscal printer (its serial number) and one operator (their code):
//
//   18.1  sales, one row each      18.4  reversed (storno) lines
//   18.2  payments                  18.5  cancelled (annulled) lines
//   18.3  sale lines                18.9  the nomenclatures (nom_*)
//
// 18.6–18.8 (deliveries and stock) don't apply: the system has neither.
//
// A sale here is what has a УНП (_lib/fiscal.php): an order paid on the
// phone, or a table's bill on a pay-at-the-end evening. Evenings paid to
// staff are Clock's sales, not ours. Prices include VAT; each line's VAT is
// split out by its tax group's rate (fiscal-settings.php). Amounts in euro
// (Bulgaria's currency since 1 January 2026; the Annex still says "лв.").
//
// Also the operations log's kinds, named, for the log screen (т. 16).
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_NAP_TABLES = ['18.1', '18.2', '18.3', '18.4', '18.5', 'nom_items', 'nom_operations', 'nom_payments', 'nom_sites',
    'nom_workplaces', 'nom_operators', 'nom_roles', 'nom_rights'];

// Every kind of row in audit_log: its name, and when it first existed (for
// the nomenclature of operations, т. 18.9).
const QR_AUDIT_KINDS = [
    'order' => ['Поръчка', '2026-10-20'],
    'order_change' => ['Промяна на поръчка (статус, плащане, връщане, каса)', '2026-10-20'],
    'line' => ['Ред от поръчка', '2026-10-20'],
    'line_void' => ['Анулиране на ред', '2026-10-20'],
    'tab_open' => ['Откриване на сметка', '2026-10-29'],
    'tab_close' => ['Затваряне на сметка', '2026-10-29'],
    'tab_reopen' => ['Повторно отваряне на сметка', '2026-10-29'],
    'bill_payment' => ['Плащане по сметка', '2026-10-20'],
    'bill_payment_change' => ['Промяна на плащане по сметка', '2026-10-20'],
    'receipt_queued' => ['Касова бележка / сторно — в опашката', '2026-10-20'],
    'receipt_claimed' => ['Касова бележка — при моста', '2026-10-20'],
    'receipt_submitted' => ['Касова бележка — пратена към ФУ', '2026-10-20'],
    'receipt_printed' => ['Касова бележка — отпечатана', '2026-10-20'],
    'receipt_failed' => ['Касова бележка — неуспешна', '2026-10-20'],
    'receipt_check' => ['Касова бележка — за проверка', '2026-10-20'],
    'receipt_manual' => ['Касова бележка — въведена ръчно', '2026-10-20'],
    'receipt_pending' => ['Касова бележка — отново в опашката', '2026-10-20'],
    'report_requested' => ['Отчет / дубликат — поискан', '2026-10-20'],
    'report_claimed' => ['Отчет / дубликат — при моста', '2026-10-20'],
    'report_submitted' => ['Отчет / дубликат — пратен към ФУ', '2026-10-20'],
    'report_done' => ['Отчет / дубликат — отпечатан', '2026-10-20'],
    'report_failed' => ['Отчет / дубликат — неуспешен', '2026-10-20'],
    'login' => ['Вход', '2026-10-29'],
    'login_failed' => ['Неуспешен вход', '2026-10-29'],
    'logout' => ['Изход', '2026-10-29'],
    'settings' => ['Промяна на настройките', '2026-10-29'],
    'sold_out' => ['Изчерпан артикул', '2026-10-29'],
    'back_in' => ['Отново наличен артикул', '2026-10-29'],
    'staff_new' => ['Нов оператор', '2026-10-29'],
    'staff_change' => ['Промяна на оператор', '2026-10-29'],
    'role_new' => ['Нова роля на оператор', '2026-10-29'],
    'role_change' => ['Промяна на роля на оператор', '2026-10-29'],
    'menu_loaded' => ['Първоначално зареждане на номенклатурата стоки', '2026-10-29'],
    'menu_item_new' => ['Нова стока / услуга', '2026-10-29'],
    'menu_item_change' => ['Промяна на стока / услуга (име, цена)', '2026-10-29'],
    'menu_item_removed' => ['Деактивирана стока / услуга', '2026-10-29'],
    'version_start' => ['Стартиране на версия на софтуера', '2026-10-29'],
    'integrity_failed' => ['Нарушена цялост на софтуера', '2026-10-29'],
    'integrity_ok' => ['Цялостта на софтуера е потвърдена', '2026-10-29'],
];

const QR_ROLE_NAMES = ['waiter' => 'Сервитьор', 'manager' => 'Управител', 'auditor' => 'Проверяващ'];
const QR_ROLE_RIGHTS = [
    'waiter' => ['orders', 'bills', 'till', 'pause', 'sold_out', 'waiters', 'history', 'reports'],
    'manager' => ['orders', 'bills', 'till', 'pause', 'sold_out', 'waiters', 'history', 'reports', 'evening', 'staff', 'log'],
    'auditor' => ['read_all', 'log'],
];
const QR_RIGHTS = [
    'orders' => ['Поръчки', 'Приема, сервира, отказва поръчки и редове от тях'],
    'bills' => ['Сметки', 'Отбелязва платеното на място, затваря сметки'],
    'till' => ['За касата', 'Отбелязва въведеното в касата, пуска отново касова бележка'],
    'pause' => ['Пауза', 'Спира и пуска приемането на поръчки'],
    'sold_out' => ['Изчерпани', 'Отбелязва изчерпани артикули'],
    'waiters' => ['Сервитьори', 'Разпределя масите'],
    'history' => ['История', 'Чете минали вечери, изтегля таблици'],
    'reports' => ['Отчети от ФУ', 'Z и X отчет, дубликат'],
    'evening' => ['Вечерта', 'Часове, маси, начин на плащане, имейл за отчета'],
    'staff' => ['Персонал', 'Създава и променя оператори и роли'],
    'log' => ['Журнал и справки за НАП', 'Журнал на действията, таблиците по т. 18'],
    'read_all' => ['Само четене', 'Вижда всичко, не променя нищо'],
];
const QR_PAYMENT_TYPES = [
    'card' => ['Карта (в телефона, Stripe)', '2026-10-20'],
    'staff' => ['При персонала (в брой или терминал, през касата на Clock)', '2026-10-20'],
];

/** A unix time as Sofia date and time: ['2026-10-03', '20:45:07'], or ['', '']. */
function qr_nap_when(int $at): array
{
    if ($at <= 0) {
        return ['', ''];
    }
    $d = (new DateTime('@' . $at))->setTimezone(new DateTimeZone(QR_TZ));
    return [$d->format('Y-m-d'), $d->format('H:i:s')];
}

/** 1250 → "12.50" (the tables are for spreadsheets and НАП's tools). */
function qr_nap_money(int $cents): string
{
    return ($cents < 0 ? '-' : '') . intdiv(abs($cents), 100) . '.' . str_pad((string) (abs($cents) % 100), 2, '0', STR_PAD_LEFT);
}

/** A line's VAT rate (%), from its menu category or station's tax group. */
function qr_nap_rate(string $itemId, string $station): int
{
    $settings = qr_fiscal_settings();
    $groups = $settings['tax_groups'] ?? [];
    $category = (string) (qr_menu_index()[$itemId]['category'] ?? '');
    $group = (int) ($groups[$category] ?? $groups[$station] ?? 2);
    return (int) (($settings['vat_rates'] ?? [])[$group] ?? 20);
}

/** The VAT inside a gross amount at $rate %. */
function qr_nap_vat(int $gross, int $rate): int
{
    return $rate > 0 ? (int) round($gross * $rate / (100 + $rate)) : 0;
}

/**
 * The sales opened from $start to $end (unix): orders paid on the phone and
 * bills, those with a УНП. Each: kind, id, usn, number (the system's own),
 * opened, closed, operator, and its lines (every line, with what was taken
 * off: void_qty, and whether its order was cancelled).
 */
function qr_nap_sales(PDO $pdo, int $start, int $end): array
{
    $sales = [];
    $stmt = $pdo->prepare("SELECT * FROM orders WHERE usn <> '' AND created_at >= ? AND created_at < ? ORDER BY id");
    $stmt->execute([$start, $end]);
    foreach ($stmt->fetchAll() as $o) {
        $sales[] = ['kind' => 'order', 'id' => (int) $o['id'], 'usn' => (string) $o['usn'], 'number' => (string) $o['code'],
            'opened' => (int) $o['created_at'], 'closed' => (int) $o['paid_at'], 'orders' => [$o]];
    }
    $stmt = $pdo->prepare("SELECT * FROM tabs WHERE usn <> '' AND opened_at >= ? AND opened_at < ? ORDER BY id");
    $stmt->execute([$start, $end]);
    $ofTab = $pdo->prepare('SELECT * FROM orders WHERE tab_id = ? ORDER BY id');
    foreach ($stmt->fetchAll() as $t) {
        $ofTab->execute([(int) $t['id']]);
        $sales[] = ['kind' => 'tab', 'id' => (int) $t['id'], 'usn' => (string) $t['usn'], 'number' => 'S-' . $t['id'],
            'opened' => (int) $t['opened_at'], 'closed' => (int) $t['closed_at'], 'orders' => $ofTab->fetchAll()];
    }
    $items = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
    foreach ($sales as &$sale) {
        $sale['operator'] = substr($sale['usn'], 9, 4);
        $sale['lines'] = [];
        foreach ($sale['orders'] as $o) {
            $items->execute([(int) $o['id']]);
            foreach ($items->fetchAll() as $i) {
                $i['order_code'] = (string) $o['code'];
                $i['order_status'] = (string) $o['status'];
                $sale['lines'][] = $i;
            }
        }
    }
    unset($sale);
    usort($sales, function ($a, $b) {
        return $a['opened'] <=> $b['opened'];
    });
    return $sales;
}

/** A line as НАП's columns want it: code, name, quantity, unit net, VAT rate, VAT, gross. */
function qr_nap_line(string $itemId, string $variantId, string $name, int $qty, int $unit, string $station): array
{
    $rate = qr_nap_rate($itemId, $station);
    $gross = $unit * $qty;
    $vat = qr_nap_vat($gross, $rate);
    return [
        'code' => $itemId . ($variantId !== '' && $variantId !== 'std' ? '/' . $variantId : ''),
        'name' => $name,
        'qty' => (string) $qty,
        'unit' => qr_nap_money($unit - qr_nap_vat($unit, $rate)),
        'discount' => qr_nap_money(0),
        'rate' => $rate . '%',
        'vat' => qr_nap_money($vat),
        'total' => qr_nap_money($gross),
    ];
}

function qr_nap_item_name(array $i): string
{
    return trim($i['name_bg'] . ($i['detail_bg'] !== '' ? ' · ' . $i['detail_bg'] : ''));
}

/** What the sale owes: its lines still standing, VAT split out. */
function qr_nap_sale_totals(array $sale): array
{
    $gross = 0;
    $vat = 0;
    foreach ($sale['lines'] as $i) {
        if ($i['order_status'] === 'cancelled' || $i['order_status'] === 'expired') {
            continue;
        }
        $amount = (int) $i['unit_cents'] * ((int) $i['qty'] - (int) $i['void_qty']);
        $gross += $amount;
        $vat += qr_nap_vat($amount, qr_nap_rate((string) $i['item_id'], (string) $i['station']));
    }
    return [$gross, $vat];
}

/** The operator of the audit_log row about a fiscal document being queued: who caused the storno. */
function qr_nap_doc_operator(PDO $pdo, int $docId): string
{
    $find = $pdo->prepare("SELECT operator FROM audit_log WHERE kind = 'receipt_queued' AND detail LIKE ? ORDER BY id LIMIT 1");
    $find->execute(['doc=' . $docId . ';%']);
    $code = (string) $find->fetchColumn();
    $find->closeCursor();
    return $code;
}

/**
 * One of НAП's tables: ['columns' => [...], 'rows' => [[...], ...]], for
 * Sofia dates $from–$to, filtered by printer serial ($fu) and operator code
 * where given. Read inside one read transaction.
 */
function qr_nap_table(PDO $pdo, string $table, string $from, string $to, string $fu, string $operator): array
{
    $start = (new DateTime($from . ' 00:00', new DateTimeZone(QR_TZ)))->getTimestamp();
    $end = (new DateTime($to . ' 00:00', new DateTimeZone(QR_TZ)))->modify('+1 day')->getTimestamp();
    $settings = qr_fiscal_settings();
    $site = [(string) ($settings['site_code'] ?? ''), (string) ($settings['site_name'] ?? '')];
    $workplace = (string) ($settings['workplace_code'] ?? '');
    $keepFu = function (string $usn) use ($fu) {
        return $fu === '' || strtoupper(substr($usn, 0, 8)) === strtoupper($fu);
    };
    $keepOp = function (string $code) use ($operator) {
        return $operator === '' || $code === $operator;
    };
    $rows = [];

    if ($table === '18.1') {
        $columns = ['Уникален номер на продажба (УНП)', 'Системен номер на продажбата', 'Код на търговски обект', 'Наименование на търговски обект',
            'Дата на откриване', 'Време на откриване', 'Код на работно място', 'Код на оператор', 'Обща сума без ДДС (EUR)', 'Отстъпка (EUR)',
            'ДДС (EUR)', 'Дължима сума (EUR)', 'Фактура – номер', 'Фактура – дата', 'Дата на приключване', 'Време на приключване',
            'Клиент – код', 'Клиент – име'];
        foreach (qr_nap_sales($pdo, $start, $end) as $s) {
            if (!$keepFu($s['usn']) || !$keepOp($s['operator'])) {
                continue;
            }
            list($gross, $vat) = qr_nap_sale_totals($s);
            $opened = qr_nap_when($s['opened']);
            $closed = qr_nap_when($s['closed']);
            $rows[] = [$s['usn'], $s['number'], $site[0], $site[1], $opened[0], $opened[1], $workplace, $s['operator'],
                qr_nap_money($gross - $vat), qr_nap_money(0), qr_nap_money($vat), qr_nap_money($gross), '', '', $closed[0], $closed[1], '', ''];
        }
        return ['columns' => $columns, 'rows' => $rows];
    }

    if ($table === '18.2') {
        $columns = ['Уникален номер на продажба (УНП)', 'Системен номер на продажбата', 'Дата на откриване', 'Дата на приключване',
            'Обща сума по продажбата (EUR)', 'Дата на плащане', 'Код на оператор, регистрирал плащането', 'Платена сума (EUR)',
            'Вид на плащането', 'Индивидуален номер на ФУ'];
        $docs = $pdo->prepare("SELECT * FROM fiscal_docs WHERE kind = 'sale' AND source = ? AND source_id = ? AND status IN ('printed', 'manual')");
        $paidStaff = $pdo->prepare("SELECT COALESCE(SUM(i.unit_cents * (i.qty - i.void_qty)), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
            WHERE o.tab_id = ? AND o.status IN ('new', 'accepted', 'served') AND i.paid_via = 'staff'");
        foreach (qr_nap_sales($pdo, $start, $end) as $s) {
            if (!$keepFu($s['usn'])) {
                continue;
            }
            list($gross) = qr_nap_sale_totals($s);
            $opened = qr_nap_when($s['opened'])[0];
            $closed = qr_nap_when($s['closed'])[0];
            $payments = [];
            if ($s['kind'] === 'order') {
                $docs->execute(['order', $s['id']]);
                $payments = $docs->fetchAll();
            } else {
                $bp = $pdo->prepare("SELECT id FROM bill_payments WHERE tab_id = ? ORDER BY id");
                $bp->execute([$s['id']]);
                foreach ($bp->fetchAll(PDO::FETCH_COLUMN) as $pid) {
                    $docs->execute(['bill', (int) $pid]);
                    $payments = array_merge($payments, $docs->fetchAll());
                }
            }
            foreach ($payments as $d) {
                if (!$keepOp(QR_OPERATOR_GUEST)) {
                    continue;
                }
                $rows[] = [$s['usn'], $s['number'], $opened, $closed, qr_nap_money($gross), qr_nap_when((int) $d['created_at'])[0],
                    QR_OPERATOR_GUEST, qr_nap_money((int) $d['total_cents']), QR_PAYMENT_TYPES['card'][0], substr((string) $d['usn'], 0, 8)];
            }
            if ($s['kind'] === 'tab' && $keepOp('')) {
                $paidStaff->execute([$s['id']]);
                $staff = (int) $paidStaff->fetchColumn();
                if ($staff > 0) {
                    $rows[] = [$s['usn'], $s['number'], $opened, $closed, qr_nap_money($gross), $closed, '',
                        qr_nap_money($staff), QR_PAYMENT_TYPES['staff'][0], ''];
                }
            }
        }
        return ['columns' => $columns, 'rows' => $rows];
    }

    $lineColumns = ['Уникален номер на продажба (УНП)', 'Системен номер на продажбата', 'Код на стоката/услугата', 'Наименование на стоката/услугата',
        'Количество', 'Единична цена без ДДС (EUR)', 'Отстъпка (EUR)', 'ДДС ставка', 'ДДС (EUR)', 'Обща сума (EUR)'];

    if ($table === '18.3') {
        $columns = array_merge($lineColumns, ['Начална дата на периода', 'Крайна дата на периода']);
        foreach (qr_nap_sales($pdo, $start, $end) as $s) {
            if (!$keepFu($s['usn']) || !$keepOp($s['operator'])) {
                continue;
            }
            foreach ($s['lines'] as $i) {
                $qty = (int) $i['qty'] - (int) $i['void_qty'];
                if ($qty <= 0 || $i['order_status'] === 'cancelled' || $i['order_status'] === 'expired') {
                    continue;
                }
                $l = qr_nap_line((string) $i['item_id'], (string) $i['variant_id'], qr_nap_item_name($i), $qty, (int) $i['unit_cents'], (string) $i['station']);
                $rows[] = array_merge([$s['usn'], $s['number']], array_values($l), ['', '']);
            }
        }
        return ['columns' => $columns, 'rows' => $rows];
    }

    if ($table === '18.4') {
        $columns = array_merge($lineColumns, ['Дата на приключване на продажбата', 'Време на приключване на продажбата',
            'Дата на сторниране', 'Време на сторниране', 'Индивидуален номер на ФУ (сторно)', 'Код на оператор, извършил сторнирането']);
        $stmt = $pdo->prepare("SELECT d.*, s.printed_at AS sale_printed_at, s.usn AS sale_usn FROM fiscal_docs d JOIN fiscal_docs s ON s.id = d.sale_id
            WHERE d.kind = 'storno' AND d.status IN ('printed', 'manual') AND d.created_at >= ? AND d.created_at < ? ORDER BY d.id");
        $stmt->execute([$start, $end]);
        $numbers = $pdo->prepare('SELECT code FROM orders WHERE id = ?');
        foreach ($stmt->fetchAll() as $d) {
            $usn = (string) $d['sale_usn'];
            $who = qr_nap_doc_operator($pdo, (int) $d['id']);
            if (!$keepFu($usn) || !$keepOp($who)) {
                continue;
            }
            $saleAt = qr_nap_when((int) $d['sale_printed_at']);
            $at = qr_nap_when((int) ($d['printed_at'] ?: $d['created_at']));
            $number = (string) $d['code'];
            foreach (json_decode((string) $d['lines_json'], true) as $line) {
                $l = qr_nap_line((string) (($line['item'] ?? '') !== '' ? $line['item'] : $line['key']), '', (string) $line['name'], (int) $line['qty'], (int) $line['unit'],
                    (string) ($line['station'] ?? 'kitchen'));
                $rows[] = array_merge([$usn, $number], array_values($l), [$saleAt[0], $saleAt[1], $at[0], $at[1], substr($usn, 0, 8), $who]);
            }
        }
        return ['columns' => $columns, 'rows' => $rows];
    }

    if ($table === '18.5') {
        $columns = array_merge($lineColumns, ['Дата на откриване на продажбата', 'Време на откриване на продажбата',
            'Дата на анулиране', 'Време на анулиране', 'Код на оператор, извършил анулирането']);
        $saleOfOrder = [];
        foreach (qr_nap_sales($pdo, $start - 2 * 86400, $end) as $s) {
            foreach ($s['orders'] as $o) {
                $saleOfOrder[(int) $o['id']] = $s;
            }
        }
        $stmt = $pdo->prepare("SELECT * FROM audit_log WHERE at >= ? AND at < ? AND (kind = 'line_void'
            OR (kind = 'order_change' AND (detail LIKE '%>cancelled;%' OR detail LIKE '%>expired;%'))) ORDER BY id");
        $stmt->execute([$start, $end]);
        $item = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? AND line = ?');
        $items = $pdo->prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY line');
        foreach ($stmt->fetchAll() as $a) {
            parse_str(str_replace(';', '&', (string) $a['detail']), $d);
            $orderId = (int) ($a['kind'] === 'line_void' ? ($d['order'] ?? 0) : ($d['id'] ?? 0));
            if ($a['kind'] === 'order_change') {
                $status = explode('>', (string) ($d['status'] ?? '')) + ['', ''];
                if ($status[0] === $status[1] || !in_array($status[1], ['cancelled', 'expired'], true)) {
                    continue; // a later change to an order already cancelled
                }
            }
            if (!isset($saleOfOrder[$orderId])) {
                continue;
            }
            $s = $saleOfOrder[$orderId];
            $who = (string) $a['operator'];
            if (!$keepFu($s['usn']) || !$keepOp($who)) {
                continue;
            }
            $lines = [];
            if ($a['kind'] === 'line_void') {
                $item->execute([$orderId, (int) ($d['line'] ?? -1)]);
                $i = $item->fetch();
                list($was, $now) = array_map('intval', explode('>', (string) ($d['void'] ?? '0>0')) + [0, 0]);
                if (is_array($i) && $now > $was) {
                    $lines[] = [$i, $now - $was];
                }
            } else {
                $items->execute([$orderId]);
                foreach ($items->fetchAll() as $i) {
                    if ((int) $i['qty'] - (int) $i['void_qty'] > 0) {
                        $lines[] = [$i, (int) $i['qty'] - (int) $i['void_qty']];
                    }
                }
            }
            $opened = qr_nap_when($s['opened']);
            $at = qr_nap_when((int) $a['at']);
            foreach ($lines as $pair) {
                list($i, $qty) = $pair;
                $l = qr_nap_line((string) $i['item_id'], (string) $i['variant_id'], qr_nap_item_name($i), $qty, (int) $i['unit_cents'], (string) $i['station']);
                $rows[] = array_merge([$s['usn'], $s['number']], array_values($l), [$opened[0], $opened[1], $at[0], $at[1], $who]);
            }
        }
        return ['columns' => $columns, 'rows' => $rows];
    }

    return qr_nap_nomenclature($pdo, $table);
}

/** The nomenclatures of т. 18.9, each a table of its own. */
function qr_nap_nomenclature(PDO $pdo, string $table): array
{
    $settings = qr_fiscal_settings();
    if ($table === 'nom_items') {
        // menu_items: every item the menu has had, with its dates (_lib/integrity.php).
        $rows = [];
        foreach ($pdo->query('SELECT * FROM menu_items ORDER BY first_at, code')->fetchAll() as $m) {
            $rows[] = [(string) $m['code'], (string) $m['name'], qr_nap_money((int) $m['price_cents']), (string) $m['category'],
                qr_nap_when((int) $m['first_at'])[0], qr_nap_when((int) $m['changed_at'])[0], qr_nap_when((int) $m['removed_at'])[0]];
        }
        return ['columns' => ['Код', 'Наименование', 'Цена с ДДС (EUR)', 'Категория', 'Дата на първоначално конфигуриране', 'Дата на последна промяна',
            'Дата на деактивиране'], 'rows' => $rows];
    }
    if ($table === 'nom_operations') {
        $rows = [];
        foreach (QR_AUDIT_KINDS as $code => $kind) {
            $rows[] = [$code, $kind[0], $kind[1], $kind[1], ''];
        }
        return ['columns' => ['Код', 'Наименование', 'Дата на първоначално конфигуриране', 'Дата на последна промяна', 'Дата на деактивиране'], 'rows' => $rows];
    }
    if ($table === 'nom_payments') {
        $rows = [];
        foreach (QR_PAYMENT_TYPES as $code => $type) {
            $rows[] = [$code, $type[0], $type[1], $type[1], ''];
        }
        return ['columns' => ['Код', 'Наименование', 'Дата на първоначално конфигуриране', 'Дата на последна промяна', 'Дата на деактивиране'], 'rows' => $rows];
    }
    if ($table === 'nom_sites') {
        return ['columns' => ['Код', 'Наименование', 'Местонахождение', 'Дата на първоначално конфигуриране', 'Дата на последна промяна', 'Дата на деактивиране'],
            'rows' => [[(string) ($settings['site_code'] ?? ''), (string) ($settings['site_name'] ?? ''), (string) ($settings['site_address'] ?? ''), '2026-10-20', '2026-10-29', '']]];
    }
    if ($table === 'nom_workplaces') {
        $serial = (string) $pdo->query('SELECT printer_serial FROM fiscal_bridge WHERE id = 1')->fetchColumn();
        return ['columns' => ['Код', 'Наименование', 'Търговски обект', 'Индивидуален номер на ФУ', 'Дата на първоначално конфигуриране',
            'Дата на последна промяна', 'Дата на деактивиране'],
            'rows' => [[(string) ($settings['workplace_code'] ?? ''), (string) ($settings['workplace_name'] ?? ''), (string) ($settings['site_code'] ?? ''), $serial,
                '2026-10-20', '2026-10-29', '']]];
    }
    if ($table === 'nom_operators') {
        $rows = [];
        $roles = $pdo->prepare('SELECT * FROM staff_roles WHERE staff_id = ? ORDER BY from_at, id');
        foreach ($pdo->query('SELECT * FROM staff ORDER BY code')->fetchAll() as $s) {
            $roles->execute([(int) $s['id']]);
            $held = [];
            foreach ($roles->fetchAll() as $r) {
                $held[] = (QR_ROLE_NAMES[$r['role']] ?? $r['role']) . ' ' . qr_nap_when((int) $r['from_at'])[0] . '–' . qr_nap_when((int) $r['to_at'])[0];
            }
            $off = '';
            if ((int) $s['active'] !== 1) {
                $find = $pdo->prepare("SELECT MAX(at) FROM audit_log WHERE kind = 'staff_change' AND ref = ? AND detail LIKE '%;active=1>0;%'");
                $find->execute([(string) $s['code']]);
                $off = qr_nap_when((int) $find->fetchColumn())[0];
            }
            $rows[] = [(string) $s['code'], trim(preg_replace('/\s+/u', ' ', $s['first_name'] . ' ' . $s['middle_name'] . ' ' . $s['last_name'])),
                qr_nap_when((int) $s['created_at'])[0], qr_nap_when((int) $s['updated_at'])[0], $off, implode('; ', $held)];
        }
        foreach ([[QR_OPERATOR_SYSTEM, 'Система (автоматични действия)'], [QR_OPERATOR_GUEST, 'QR гост (поръчка и плащане в телефона)'],
            [QR_OPERATOR_SHARED, 'Обща парола (само до първия управител)']] as $fixed) {
            $rows[] = [$fixed[0], $fixed[1], '2026-10-29', '2026-10-29', '', ''];
        }
        return ['columns' => ['Код', 'Имена по документ за самоличност', 'Дата на първоначално конфигуриране', 'Дата на последна промяна',
            'Дата на деактивиране', 'Роли и период на активност'], 'rows' => $rows];
    }
    if ($table === 'nom_roles') {
        $rows = [];
        foreach (QR_ROLE_NAMES as $code => $name) {
            $rows[] = [$code, $name, implode(', ', QR_ROLE_RIGHTS[$code]), '2026-10-29', ''];
        }
        return ['columns' => ['Код', 'Наименование', 'Права', 'Дата на конфигуриране', 'Дата на деактивиране'], 'rows' => $rows];
    }
    // nom_rights
    $rows = [];
    foreach (QR_RIGHTS as $code => $right) {
        $rows[] = [$code, $right[0], $right[1], '2026-10-29', ''];
    }
    return ['columns' => ['Код', 'Наименование', 'Описание', 'Дата на конфигуриране', 'Дата на деактивиране'], 'rows' => $rows];
}
