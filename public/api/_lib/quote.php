<?php
// Server-side validation and pricing for the wedding enquiry.
//
// Everything here works from public/api/wedding-offer.json — the same file
// the React configurator reads — so the two cannot drift on prices, menus or
// terms. Amounts submitted by the browser are ignored entirely: the estimate
// in the email is recomputed here from the guest counts and the option ids.

if (!defined('RAYA_ENQUIRY')) {
    http_response_code(404);
    exit;
}

const RAYA_MAX_GUESTS = 2000;   // abuse guard, not a venue capacity
const RAYA_MAX_HOURS = 24;

function raya_load_offer(): array
{
    $path = __DIR__ . '/../wedding-offer.json';
    $raw = @file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException('offer configuration missing');
    }
    $offer = json_decode($raw, true);
    if (!is_array($offer)) {
        throw new RuntimeException('offer configuration is not valid JSON');
    }
    return $offer;
}

function raya_str($value, int $max): string
{
    if (!is_string($value)) {
        return '';
    }
    // Normalise newlines, drop control characters, then cap the length.
    $value = str_replace(["\r\n", "\r"], "\n", $value);
    $value = preg_replace('/[^\P{C}\n]+/u', '', $value) ?? '';
    $value = trim($value);
    return mb_substr($value, 0, $max, 'UTF-8');
}

/** Strictly a whole number in range, or null when it isn't one. */
function raya_int($value, int $min, int $max): ?int
{
    if (is_int($value)) {
        $n = $value;
    } elseif (is_string($value) && preg_match('/^\d{1,7}$/', trim($value))) {
        $n = (int) trim($value);
    } elseif (is_float($value) && floor($value) === $value) {
        $n = (int) $value;
    } else {
        return null;
    }
    return ($n >= $min && $n <= $max) ? $n : null;
}

function raya_ids(array $items): array
{
    return array_column($items, 'id');
}

/**
 * Validate the submitted configuration against the offer.
 * Returns [$data, $errors]; $errors is field => code and is never empty on
 * rejection, so the browser can highlight exactly what to fix.
 */
function raya_validate(array $in, array $offer): array
{
    $errors = [];
    $d = [];

    $d['lang'] = in_array(($in['lang'] ?? 'bg'), ['bg', 'en', 'ro'], true) ? $in['lang'] : 'bg';
    $d['offerVersionClient'] = raya_str($in['offerVersion'] ?? '', 40);

    // ── Date / period ────────────────────────────────────────────────
    $mode = ($in['date']['mode'] ?? 'date') === 'period' ? 'period' : 'date';
    $d['dateMode'] = $mode;
    $d['date'] = '';
    $d['period'] = raya_str($in['date']['period'] ?? '', 120);
    $d['time'] = '';

    if ($mode === 'date') {
        $raw = raya_str($in['date']['date'] ?? '', 10);
        $dt = DateTime::createFromFormat('!Y-m-d', $raw, new DateTimeZone('Europe/Sofia'));
        $valid = $dt && $dt->format('Y-m-d') === $raw;
        if (!$valid) {
            $errors['date'] = 'invalid';
        } else {
            $year = (int) $dt->format('Y');
            if ($year < 2020 || $year > 2100) {
                $errors['date'] = 'range';
            } else {
                $d['date'] = $raw;
            }
        }
    }

    $time = raya_str($in['date']['time'] ?? '', 5);
    if ($time !== '') {
        if (preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $time)) {
            $d['time'] = $time;
        } else {
            $errors['time'] = 'invalid';
        }
    }

    // ── Guests ───────────────────────────────────────────────────────
    $standard = raya_int($in['guests']['standard'] ?? null, 1, RAYA_MAX_GUESTS);
    if ($standard === null) {
        $errors['standardGuests'] = 'invalid';
        $standard = 0;
    }
    $children = raya_int($in['guests']['children'] ?? 0, 0, RAYA_MAX_GUESTS);
    if ($children === null) {
        $errors['children'] = 'invalid';
        $children = 0;
    }
    $d['standardGuests'] = $standard;
    $d['children'] = $children;

    // ── Standard menus ───────────────────────────────────────────────
    $menuIds = raya_ids($offer['menus']);
    $primary = raya_str($in['menus']['primary'] ?? '', 40);
    $mixed = !empty($in['menus']['mixed']);
    $d['mixedMenus'] = $mixed;
    $d['menuAllocation'] = [];
    $d['primaryMenu'] = '';

    if ($mixed) {
        $sum = 0;
        $allocation = is_array($in['menus']['allocation'] ?? null) ? $in['menus']['allocation'] : [];
        foreach ($allocation as $id => $qty) {
            $id = raya_str((string) $id, 40);
            if (!in_array($id, $menuIds, true)) {
                $errors['menuAllocation'] = 'unknown-option';
                continue;
            }
            $n = raya_int($qty, 0, RAYA_MAX_GUESTS);
            if ($n === null) {
                $errors['menuAllocation'] = 'invalid';
                continue;
            }
            if ($n > 0) {
                $d['menuAllocation'][$id] = $n;
                $sum += $n;
            }
        }
        if (!isset($errors['menuAllocation']) && $sum !== $standard) {
            $errors['menuAllocation'] = 'sum-mismatch';
        }
    } else {
        if (!in_array($primary, $menuIds, true)) {
            $errors['primaryMenu'] = 'required';
        } else {
            $d['primaryMenu'] = $primary;
        }
    }

    // ── Children's menus ─────────────────────────────────────────────
    $childIds = raya_ids($offer['childMenus']);
    $d['childAllocation'] = [];
    if ($children > 0) {
        $sum = 0;
        $allocation = is_array($in['childMenus'] ?? null) ? $in['childMenus'] : [];
        foreach ($allocation as $id => $qty) {
            $id = raya_str((string) $id, 40);
            if (!in_array($id, $childIds, true)) {
                $errors['childMenus'] = 'unknown-option';
                continue;
            }
            $n = raya_int($qty, 0, RAYA_MAX_GUESTS);
            if ($n === null) {
                $errors['childMenus'] = 'invalid';
                continue;
            }
            if ($n > 0) {
                $d['childAllocation'][$id] = $n;
                $sum += $n;
            }
        }
        if (!isset($errors['childMenus']) && $sum !== $children) {
            $errors['childMenus'] = 'sum-mismatch';
        }
    }

    $d['dietary'] = raya_str($in['dietary'] ?? '', 1000);

    // ── Priced extras ────────────────────────────────────────────────
    $d['extras'] = [];
    $submitted = is_array($in['extras'] ?? null) ? $in['extras'] : [];
    foreach ($submitted as $id => $sel) {
        $id = raya_str((string) $id, 40);
        $extra = null;
        foreach ($offer['extras'] as $e) {
            if ($e['id'] === $id) {
                $extra = $e;
                break;
            }
        }
        if ($extra === null) {
            $errors['extras'] = 'unknown-option';
            continue;
        }
        if (!is_array($sel) || empty($sel['selected'])) {
            continue;
        }

        $entry = ['id' => $id, 'notes' => raya_str($sel['notes'] ?? '', 500)];

        if ($extra['unit'] === 'per_person') {
            $covers = raya_int($sel['covers'] ?? null, 1, RAYA_MAX_GUESTS);
            if ($covers === null) {
                $errors['extra.' . $id . '.covers'] = 'invalid';
                continue;
            }
            $entry['quantity'] = $covers;
        } elseif ($extra['unit'] === 'per_hour') {
            $hours = raya_int($sel['hours'] ?? null, 1, RAYA_MAX_HOURS);
            if ($hours === null) {
                $errors['extra.' . $id . '.hours'] = 'invalid';
                continue;
            }
            $entry['quantity'] = $hours;
        } else {
            $entry['quantity'] = 1;
        }

        // Canapé selection: exactly the number the offer specifies, no repeats.
        if (!empty($extra['cateringChoices'])) {
            $wanted = (int) $extra['cateringChoices'];
            $choiceIds = raya_ids($extra['catering']);
            $picked = is_array($sel['catering'] ?? null) ? $sel['catering'] : [];
            $clean = [];
            foreach ($picked as $choice) {
                $choice = raya_str((string) $choice, 40);
                if (!in_array($choice, $choiceIds, true)) {
                    $errors['extra.' . $id . '.catering'] = 'unknown-option';
                    continue 2;
                }
                if (!in_array($choice, $clean, true)) {
                    $clean[] = $choice;
                }
            }
            if (count($clean) !== $wanted) {
                $errors['extra.' . $id . '.catering'] = 'count';
                continue;
            }
            $entry['catering'] = $clean;
        }

        $d['extras'][$id] = $entry;
    }

    // ── Requests without a published price ───────────────────────────
    $d['requests'] = [];
    $submitted = is_array($in['requests'] ?? null) ? $in['requests'] : [];
    foreach ($submitted as $id => $sel) {
        $id = raya_str((string) $id, 40);
        $request = null;
        foreach ($offer['quotationRequests'] as $r) {
            if ($r['id'] === $id) {
                $request = $r;
                break;
            }
        }
        if ($request === null) {
            $errors['requests'] = 'unknown-option';
            continue;
        }
        if (!is_array($sel) || empty($sel['selected'])) {
            continue;
        }
        $entry = ['id' => $id, 'notes' => raya_str($sel['notes'] ?? '', 500)];
        if (!empty($request['collectRooms'])) {
            foreach (['rooms', 'guests', 'nights'] as $field) {
                $n = raya_int($sel[$field] ?? 0, 0, 999);
                $entry[$field] = $n ?? 0;
            }
        }
        $d['requests'][$id] = $entry;
    }

    $d['otherWishes'] = raya_str($in['otherWishes'] ?? '', 2000);

    // ── Contact ──────────────────────────────────────────────────────
    $name = raya_str($in['contact']['name'] ?? '', 120);
    // mb_strlen, not strlen: a Cyrillic name is 2 bytes per letter.
    if (mb_strlen($name, 'UTF-8') < 2) {
        $errors['name'] = 'required';
    }
    $d['name'] = $name;

    $phone = raya_str($in['contact']['phone'] ?? '', 40);
    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if (!preg_match('/^[+()\/\d\s.\-]{6,40}$/u', $phone) || strlen($digits) < 6 || strlen($digits) > 15) {
        $errors['phone'] = 'invalid';
    }
    $d['phone'] = $phone;

    $email = raya_str($in['contact']['email'] ?? '', 190);
    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $email)) {
        $errors['email'] = 'invalid';
    }
    $d['email'] = $email;

    $address = raya_str($in['contact']['address'] ?? '', 300);
    if (mb_strlen($address, 'UTF-8') < 5) {
        $errors['address'] = 'required';
    }
    $d['address'] = $address;

    $d['message'] = raya_str($in['contact']['message'] ?? '', 2000);

    if (empty($in['consent'])) {
        $errors['consent'] = 'required';
    }
    $d['consent'] = !empty($in['consent']);

    return [$d, $errors];
}

// ─────────────────────────── pricing ───────────────────────────
// Mirror of src/lib/weddingPricing.js. Integer cents throughout.

function raya_resolve_rate(array $offer, int $standard, int $children): array
{
    $p = $offer['package'];
    $threshold = (int) $p['thresholdGuests'];
    $combined = $standard + $children;

    if ($standard >= $threshold) {
        return ['kind' => 'single', 'rateCents' => (int) $p['atOrAboveThresholdCents']];
    }
    if ($combined < $threshold) {
        return ['kind' => 'single', 'rateCents' => (int) $p['belowThresholdCents']];
    }
    // Standard-menu guests under the threshold, combined count at or above it:
    // the one split where the offer's silence about children actually changes
    // the price. Resolved only once the hotel confirms the basis.
    if (!empty($p['thresholdBasis']['confirmed'])) {
        $rate = ($p['thresholdBasis']['value'] ?? '') === 'combined_guests'
            ? (int) $p['atOrAboveThresholdCents']
            : (int) $p['belowThresholdCents'];
        return ['kind' => 'single', 'rateCents' => $rate];
    }
    return [
        'kind' => 'range',
        'minRateCents' => (int) $p['atOrAboveThresholdCents'],
        'maxRateCents' => (int) $p['belowThresholdCents'],
    ];
}

function raya_build_quote(array $d, array $offer): array
{
    $standard = $d['standardGuests'];
    $children = $d['children'];
    $rate = raya_resolve_rate($offer, $standard, $children);
    $lines = [];

    $line = ['id' => 'standard-menus', 'quantity' => $standard, 'unit' => 'per_person'];
    if ($rate['kind'] === 'single') {
        $line['unitPriceCents'] = $rate['rateCents'];
        $line['totalCents'] = $standard * $rate['rateCents'];
    } else {
        $line['minUnitPriceCents'] = $rate['minRateCents'];
        $line['maxUnitPriceCents'] = $rate['maxRateCents'];
        $line['minTotalCents'] = $standard * $rate['minRateCents'];
        $line['maxTotalCents'] = $standard * $rate['maxRateCents'];
    }
    if ($standard > 0) {
        $lines[] = $line;
    }

    if ($children > 0) {
        $unit = (int) $offer['package']['childMenuCents'];
        $lines[] = [
            'id' => 'child-menus',
            'quantity' => $children,
            'unit' => 'per_child',
            'unitPriceCents' => $unit,
            'totalCents' => $children * $unit,
        ];
    }

    foreach ($offer['extras'] as $extra) {
        if (!isset($d['extras'][$extra['id']])) {
            continue;
        }
        $qty = (int) $d['extras'][$extra['id']]['quantity'];
        if ($qty <= 0) {
            continue;
        }
        $lines[] = [
            'id' => $extra['id'],
            'label' => $extra['label'],
            'quantity' => $qty,
            'unit' => $extra['unit'],
            'unitPriceCents' => (int) $extra['priceCents'],
            'totalCents' => $qty * (int) $extra['priceCents'],
        ];
    }

    $min = 0;
    $max = 0;
    foreach ($lines as $l) {
        $min += $l['minTotalCents'] ?? $l['totalCents'] ?? 0;
        $max += $l['maxTotalCents'] ?? $l['totalCents'] ?? 0;
    }

    // Several ceremony spaces at once: the offer never says whether they
    // combine into one arrangement, so the estimate adds them separately and
    // says so rather than inventing a bundle.
    $overlap = array_values(array_intersect($offer['venueOverlapIds'], array_keys($d['extras'])));

    return [
        'lines' => $lines,
        'rate' => $rate,
        'isRange' => $min !== $max,
        'minTotalCents' => $min,
        'maxTotalCents' => $max,
        'venueOverlap' => count($overlap) > 1 ? $overlap : [],
    ];
}

function raya_money(int $cents): string
{
    return number_format($cents / 100, 2, '.', ' ') . ' €';
}

function raya_unit_label(string $unit): string
{
    return [
        'per_person' => 'на човек',
        'per_child' => 'на дете',
        'per_hour' => 'на час',
        'fixed' => 'еднократно',
    ][$unit] ?? $unit;
}

/** Human label for an option id, taken from the offer itself. */
function raya_label(array $offer, string $group, string $id): string
{
    foreach ($offer[$group] as $item) {
        if ($item['id'] === $id) {
            return $item['name'] ?? $item['label'] ?? $id;
        }
    }
    return $id;
}

// ─────────────────────── email rendering ───────────────────────

/** The whole enquiry as an ordered list of [heading, [[label, value], …]]. */
function raya_summary_blocks(array $d, array $offer, array $quote, string $reference, string $sentAt): array
{
    $blocks = [];

    $blocks[] = ['Запитване', [
        ['Номер', $reference],
        ['Изпратено', $sentAt . ' (Europe/Sofia)'],
        ['Език на сайта', $d['lang']],
        ['Версия на офертата', $offer['version']],
    ]];

    $dateRow = $d['dateMode'] === 'date'
        ? ['Предпочитана дата', $d['date']]
        : ['Предпочитан период', $d['period'] !== '' ? $d['period'] : 'Все още без избрана дата'];
    $rows = [$dateRow];
    if ($d['dateMode'] === 'date' && $d['period'] !== '') {
        $rows[] = ['Бележка за периода', $d['period']];
    }
    if ($d['time'] !== '') {
        $rows[] = ['Приблизителен начален час', $d['time']];
    }
    $rows[] = ['Гости със стандартно меню', (string) $d['standardGuests']];
    $rows[] = ['Детски менюта (до 12 г.)', (string) $d['children']];
    $rows[] = ['Общо гости', (string) ($d['standardGuests'] + $d['children'])];
    $blocks[] = ['Дата и гости', $rows];

    $rows = [];
    if ($d['mixedMenus']) {
        $rows[] = ['Заявка', 'Различни варианти за различни гости (подлежи на потвърждение)'];
        foreach ($d['menuAllocation'] as $id => $qty) {
            $rows[] = [raya_label($offer, 'menus', $id), $qty . ' бр.'];
        }
    } elseif ($d['primaryMenu'] !== '') {
        $rows[] = ['Избрано меню', raya_label($offer, 'menus', $d['primaryMenu'])];
    }
    foreach ($d['childAllocation'] as $id => $qty) {
        $rows[] = [raya_label($offer, 'childMenus', $id), $qty . ' бр.'];
    }
    if ($d['dietary'] !== '') {
        $rows[] = ['Хранителни изисквания', $d['dietary']];
    }
    if ($rows) {
        $blocks[] = ['Меню', $rows];
    }

    $rows = [];
    foreach ($quote['lines'] as $line) {
        if ($line['id'] === 'standard-menus') {
            $label = 'Стандартни менюта';
        } elseif ($line['id'] === 'child-menus') {
            $label = 'Детски менюта';
        } else {
            $label = $line['label'] ?? $line['id'];
        }
        if (isset($line['minTotalCents'])) {
            $value = $line['quantity'] . ' × ' . raya_money($line['minUnitPriceCents'])
                . ' или ' . raya_money($line['maxUnitPriceCents'])
                . ' = ' . raya_money($line['minTotalCents']) . ' – ' . raya_money($line['maxTotalCents']);
        } else {
            $value = $line['quantity'] . ' × ' . raya_money($line['unitPriceCents'])
                . ' (' . raya_unit_label($line['unit']) . ') = ' . raya_money($line['totalCents']);
        }
        $rows[] = [$label, $value];
    }
    foreach ($d['extras'] as $id => $entry) {
        if (!empty($entry['catering'])) {
            $names = array_map(static function ($choice) use ($offer, $id) {
                foreach ($offer['extras'] as $extra) {
                    if ($extra['id'] !== $id) {
                        continue;
                    }
                    foreach ($extra['catering'] as $item) {
                        if ($item['id'] === $choice) {
                            return $item['name'];
                        }
                    }
                }
                return $choice;
            }, $entry['catering']);
            $rows[] = ['Избрани хапки', implode('; ', $names)];
        }
        if ($entry['notes'] !== '') {
            $rows[] = ['Бележка — ' . raya_label($offer, 'extras', $id), $entry['notes']];
        }
    }
    $rows[] = [
        'ОРИЕНТИРОВЪЧНА СТОЙНОСТ',
        $quote['isRange']
            ? raya_money($quote['minTotalCents']) . ' – ' . raya_money($quote['maxTotalCents'])
            : raya_money($quote['maxTotalCents']),
    ];
    $blocks[] = ['Позиции и стойност', $rows];

    if ($d['requests']) {
        $rows = [];
        foreach ($d['requests'] as $id => $entry) {
            $value = 'заявено';
            if (isset($entry['rooms'])) {
                $value .= sprintf(
                    ' — стаи: %d, гости: %d, нощувки: %d',
                    $entry['rooms'],
                    $entry['guests'],
                    $entry['nights']
                );
            }
            if ($entry['notes'] !== '') {
                $value .= ' — ' . $entry['notes'];
            }
            $rows[] = [raya_label($offer, 'quotationRequests', $id), $value];
        }
        $blocks[] = ['По индивидуална оферта (извън изчислената стойност)', $rows];
    }

    $rows = [];
    if ($quote['rate']['kind'] === 'range') {
        $rows[] = [
            'Праг от 60 души',
            'Гостите със стандартно меню са под 60, но общо с децата достигат 60. '
                . 'Офертата не уточнява дали децата се броят към прага, затова стойността е диапазон.',
        ];
    }
    if ($quote['venueOverlap']) {
        $labels = array_map(
            static fn($id) => raya_label($offer, 'extras', $id),
            $quote['venueOverlap']
        );
        $rows[] = [
            'Припокриващи се пространства',
            'Избрани са: ' . implode('; ', $labels)
                . '. Позициите са сумирани поотделно — комбинацията подлежи на потвърждение.',
        ];
    }
    if ($d['offerVersionClient'] !== '' && $d['offerVersionClient'] !== $offer['version']) {
        $rows[] = [
            'Версия на офертата',
            'Браузърът е конфигурирал по версия ' . $d['offerVersionClient']
                . ', сървърът е изчислил по ' . $offer['version'] . '.',
        ];
    }
    $rows[] = ['Валидност', 'Цените важат за резервации, направени до '
        . date('d.m.Y', strtotime($offer['reservationDeadline'])) . ' г.'];
    $rows[] = ['Статус', 'Запитване — не е потвърдена резервация.'];
    $blocks[] = ['За уточняване', $rows];

    $rows = [
        ['Име', $d['name']],
        ['Телефон', $d['phone']],
        ['Имейл', $d['email']],
        ['Адрес', $d['address']],
    ];
    if ($d['message'] !== '') {
        $rows[] = ['Съобщение', $d['message']];
    }
    if ($d['otherWishes'] !== '') {
        $rows[] = ['Други желания', $d['otherWishes']];
    }
    $blocks[] = ['Контакт', $rows];

    return $blocks;
}

function raya_render_text(array $blocks): string
{
    $out = [];
    foreach ($blocks as [$heading, $rows]) {
        $out[] = mb_strtoupper($heading, 'UTF-8');
        $out[] = str_repeat('-', 60);
        foreach ($rows as [$label, $value]) {
            $out[] = $label . ': ' . str_replace("\n", "\n    ", $value);
        }
        $out[] = '';
    }
    return implode("\n", $out);
}

function raya_render_html(array $blocks): string
{
    $esc = static fn($s) => htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $html = '<!doctype html><html lang="bg"><head><meta charset="utf-8">'
        . '<title>Ново сватбено запитване</title></head>'
        . '<body style="margin:0;padding:24px;background:#f5f3ee;'
        . 'font-family:Helvetica,Arial,sans-serif;color:#241f1a;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        . 'style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6d8b8;">'
        . '<tr><td style="padding:20px 24px;background:#100e0c;color:#f3ecdb;">'
        . '<div style="font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#d7b85f;">'
        . 'RAYA Garden</div>'
        . '<div style="font-size:20px;margin-top:6px;">Ново сватбено запитване</div>'
        . '</td></tr>';

    foreach ($blocks as [$heading, $rows]) {
        $html .= '<tr><td style="padding:18px 24px 6px;">'
            . '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;'
            . 'color:#8a661c;border-bottom:1px solid #e6d8b8;padding-bottom:6px;">'
            . $esc($heading) . '</div>'
            . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
            . 'style="font-size:14px;line-height:1.5;">';
        foreach ($rows as [$label, $value]) {
            $html .= '<tr>'
                . '<td style="padding:6px 12px 6px 0;color:#6b6055;vertical-align:top;width:38%;">'
                . $esc($label) . '</td>'
                . '<td style="padding:6px 0;vertical-align:top;">'
                . nl2br($esc($value)) . '</td>'
                . '</tr>';
        }
        $html .= '</table></td></tr>';
    }

    $html .= '<tr><td style="padding:18px 24px 24px;font-size:12px;color:#6b6055;">'
        . 'Изпратено от конфигуратора на rayagarden.bg. Отговорът се изпраща директно '
        . 'на подателя (Reply-To).'
        . '</td></tr></table></body></html>';

    return $html;
}
