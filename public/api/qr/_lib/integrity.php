<?php
// The code against its manifest, and the menu against what it was
// (Наредба Н-18, Annex 29 т. 4 and 15).
//
// The build writes api/qr/_manifest.json: the version and a SHA-256 of every
// file under api/qr (scripts/qr-manifest.mjs). Every few minutes, and
// whenever the manifest or the menu file changes, the files are checked
// against it: one changed, missing, or added outside a deploy is an
// 'integrity_failed' row in the operations log and a red line on the staff
// screen, until it's put right. Each version that starts is logged
// ('version_start'), so the log shows which version made every sale.
//
// The menu (api/qr-menu.json) changes by deploy. Each change is logged
// item by item — added, changed (name or price), removed — and menu_items
// keeps when each item first appeared, last changed and was removed: the
// nomenclature НАП asks for (т. 18.9).
//
// Called from the staff screen's poll and the guest's state (cheap unless
// something changed: two file stats).
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

const QR_INTEGRITY_EVERY = 300; // seconds between full checks when nothing has changed

function qr_integrity_dir(): string
{
    return dirname(__DIR__);
}

function qr_menu_path(): string
{
    return dirname(__DIR__, 2) . '/qr-menu.json';
}

/** A file's modification time and size, '' if missing: enough to notice a deploy. */
function qr_file_stamp(string $path): string
{
    clearstatcache(true, $path);
    return is_file($path) ? filemtime($path) . '.' . filesize($path) : '';
}

/** The files against the manifest: [status, detail, version, commit]. status: ok | changed | no_manifest. */
function qr_integrity_check(): array
{
    $dir = qr_integrity_dir();
    $raw = @file_get_contents($dir . '/_manifest.json');
    $manifest = $raw === false ? null : json_decode($raw, true);
    if (!is_array($manifest) || !is_array($manifest['files'] ?? null)) {
        return ['no_manifest', '', QR_VERSION, ''];
    }
    $problems = [];
    if ((string) ($manifest['version'] ?? '') !== QR_VERSION) {
        $problems[] = 'version ' . ($manifest['version'] ?? '?') . '<>' . QR_VERSION;
    }
    foreach ($manifest['files'] as $rel => $hash) {
        $path = $dir . '/' . $rel;
        if (!is_file($path)) {
            $problems[] = 'missing ' . $rel;
        } elseif (!hash_equals((string) $hash, hash_file('sha256', $path))) {
            $problems[] = 'changed ' . $rel;
        }
    }
    $walk = function (string $rel) use (&$walk, $dir, $manifest, &$problems) {
        foreach (scandir($dir . ($rel === '' ? '' : '/' . $rel)) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            $r = $rel === '' ? $name : $rel . '/' . $name;
            if (is_dir($dir . '/' . $r)) {
                $walk($r);
            } elseif ($r !== '_manifest.json' && !isset($manifest['files'][$r])) {
                $problems[] = 'added ' . $r;
            }
        }
    };
    $walk('');
    return [$problems ? 'changed' : 'ok', implode('; ', array_slice($problems, 0, 30)), QR_VERSION, (string) ($manifest['commit'] ?? '')];
}

/** Every item and variant of the menu as НАП's nomenclature sees it: code → [name, price, category]. */
function qr_menu_codes(): array
{
    $out = [];
    foreach (qr_menu_index() as $item) {
        foreach ($item['variants'] ?? [] as $v) {
            $code = (string) $item['id'] . (($v['id'] ?? 'std') !== 'std' ? '/' . $v['id'] : '');
            $out[$code] = [
                trim((string) $item['bg'] . (isset($v['bg']) && $v['bg'] !== '' ? ' · ' . $v['bg'] : '')),
                (int) ($v['price'] ?? 0),
                (string) $item['category'],
            ];
        }
    }
    return $out;
}

/** The menu against menu_items; changes written and logged. Inside qr_write(). */
function qr_menu_sync(PDO $pdo, int $now)
{
    $known = [];
    foreach ($pdo->query('SELECT * FROM menu_items')->fetchAll() as $r) {
        $known[(string) $r['code']] = $r;
    }
    $first = !$known;
    $insert = $pdo->prepare('INSERT INTO menu_items (code, name, price_cents, category, first_at, changed_at) VALUES (?, ?, ?, ?, ?, ?)');
    $update = $pdo->prepare('UPDATE menu_items SET name = ?, price_cents = ?, category = ?, changed_at = ?, removed_at = 0 WHERE code = ?');
    $menu = qr_menu_codes();
    foreach ($menu as $code => $m) {
        list($name, $price, $category) = $m;
        $row = $known[$code] ?? null;
        if ($row === null) {
            $insert->execute([$code, $name, $price, $category, $now, $now]);
            if (!$first) {
                qr_audit($pdo, 'menu_item_new', $code, 'name=' . $name . ';price=' . $price . ';category=' . $category);
            }
        } elseif ($row['name'] !== $name || (int) $row['price_cents'] !== $price || $row['category'] !== $category || (int) $row['removed_at'] > 0) {
            $update->execute([$name, $price, $category, $now, $code]);
            qr_audit($pdo, (int) $row['removed_at'] > 0 ? 'menu_item_new' : 'menu_item_change', $code,
                'name=' . $row['name'] . '>' . $name . ';price=' . $row['price_cents'] . '>' . $price . ';category=' . $row['category'] . '>' . $category);
        }
    }
    $remove = $pdo->prepare('UPDATE menu_items SET removed_at = ? WHERE code = ?');
    foreach ($known as $code => $row) {
        if (!isset($menu[$code]) && (int) $row['removed_at'] === 0) {
            $remove->execute([$now, $code]);
            qr_audit($pdo, 'menu_item_removed', $code, 'name=' . $row['name'] . ';price=' . $row['price_cents']);
        }
    }
    if ($first) {
        qr_audit($pdo, 'menu_loaded', '', 'items=' . count($menu));
    }
}

/**
 * Check the code and the menu if it's time, or they changed; returns the
 * integrity row. $force: check now.
 */
function qr_integrity_tick(int $now, bool $force = false): array
{
    $pdo = qr_db();
    $find = $pdo->query('SELECT * FROM integrity WHERE id = 1');
    $row = $find->fetch();
    $find->closeCursor(); // before the write below — see qr_write()
    $manifestStamp = qr_file_stamp(qr_integrity_dir() . '/_manifest.json');
    $menuStamp = qr_file_stamp(qr_menu_path());
    if (!$force && is_array($row) && (int) $row['checked_at'] > $now - QR_INTEGRITY_EVERY
        && $row['manifest_stamp'] === $manifestStamp && $row['menu_stamp'] === $menuStamp) {
        return $row;
    }
    list($status, $detail, $version, $commit) = qr_integrity_check();
    return qr_write(function (PDO $pdo) use ($now, $status, $detail, $version, $commit, $manifestStamp, $menuStamp) {
        $find = $pdo->query('SELECT * FROM integrity WHERE id = 1');
        $was = $find->fetch();
        $find->closeCursor();
        $actor = qr_actor();
        qr_actor(['id' => 0, 'code' => QR_OPERATOR_SYSTEM, 'name' => 'Система', 'roles' => []]);
        $pdo->prepare("UPDATE audit_actor SET code = ?, name = 'Система' WHERE id = 1")->execute([QR_OPERATOR_SYSTEM]);
        if ($status !== 'no_manifest' && ($was['version'] !== $version || $was['commit_id'] !== $commit)) {
            qr_audit($pdo, 'version_start', $version, 'version=' . $was['version'] . '>' . $version . ';commit=' . $was['commit_id'] . '>' . $commit);
        }
        if ($status === 'changed' && ($was['status'] !== 'changed' || $detail !== $was['detail'])) {
            qr_audit($pdo, 'integrity_failed', $version, $detail);
        } elseif ($status === 'ok' && $was['status'] !== 'ok') {
            qr_audit($pdo, 'integrity_ok', $version, '');
        }
        if ($was['menu_stamp'] !== $menuStamp) {
            qr_menu_sync($pdo, $now);
        }
        $pdo->prepare('UPDATE integrity SET checked_at = ?, status = ?, detail = ?, version = ?, commit_id = ?, manifest_stamp = ?, menu_stamp = ? WHERE id = 1')
            ->execute([$now, $status, $detail, $version, $commit, $manifestStamp, $menuStamp]);
        qr_actor($actor);
        $pdo->prepare('UPDATE audit_actor SET code = ?, name = ? WHERE id = 1')->execute([$actor['code'], $actor['name']]);
        $find = $pdo->query('SELECT * FROM integrity WHERE id = 1');
        $row = $find->fetch();
        $find->closeCursor();
        return $row;
    });
}

/** For the screens. */
function qr_integrity_json(array $row): array
{
    return [
        'status' => (string) $row['status'],
        'detail' => (string) $row['detail'],
        'version' => (string) $row['version'] !== '' ? (string) $row['version'] : QR_VERSION,
        'commit' => (string) $row['commit_id'],
        'checkedAt' => (int) $row['checked_at'],
    ];
}
