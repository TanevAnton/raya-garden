<?php
// GET /api/qr/receipt.php?n=<id>&t=<token> — one e-receipt („Електронна
// бележка“, or its storno document) as a page, to read or print. The link
// is in the e-mail and on the guest's thank-you screen; the token is the
// server's signature of the id (qr_ereceipt_token), so a document cannot be
// found by counting. See _lib/ereceipt.php.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';
require __DIR__ . '/_lib/pay.php';
require __DIR__ . '/_lib/qrcode.php';

qr_require_method('GET');
$id = isset($_GET['n']) && ctype_digit((string) $_GET['n']) ? (int) $_GET['n'] : 0;
$token = isset($_GET['t']) ? (string) $_GET['t'] : '';
$doc = null;
if ($id > 0 && hash_equals(qr_ereceipt_token($id), $token)) {
    $find = qr_db()->prepare('SELECT * FROM ereceipts WHERE id = ?');
    $find->execute([$id]);
    $doc = $find->fetch();
    $find->closeCursor();
}

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
$page = function (string $title, string $body) {
    echo '<!doctype html><html lang="bg"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>' . qr_ereceipt_escape($title) . '</title>'
        . '<style>body{margin:0;padding:16px 8px;background:#f4f1ea}@media print{body{background:#fff;padding:0}}</style>'
        . '</head><body>' . $body . '</body></html>';
};
if (!is_array($doc)) {
    http_response_code(404);
    $page('Документът не е намерен — RAYA Garden', '<p style="max-width:600px;margin:40px auto;font:16px/1.5 Arial,Helvetica,sans-serif;color:#3b2f1e;text-align:center">'
        . 'Документът не е намерен. Проверете връзката от имейла.<br>Document not found — please check the link in the e-mail.</p>');
    exit;
}
$view = qr_ereceipt_view(qr_db(), $doc);
$logo = @file_get_contents(__DIR__ . '/_lib/ereceipt-logo.png');
$page(
    ($view['storno'] ? 'Сторно документ' : 'Електронна бележка') . ' № ' . $view['number'] . ' — RAYA Garden',
    qr_ereceipt_html(
        $view,
        'data:image/png;base64,' . base64_encode(qr_code_png($view['qr'], 5)),
        is_string($logo) ? 'data:image/png;base64,' . base64_encode($logo) : ''
    )
);
