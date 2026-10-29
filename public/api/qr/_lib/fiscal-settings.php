<?php
// How phone payments are printed on the restaurant's own fiscal printer
// (_lib/fiscal.php). Nothing here is secret: the bridge's token and the mode
// live in raya-qr-config.php (see docs/qr-ordering/SETUP.md, "Fiscal receipts").
//
// The accountant (19.10.2026): food and drinks are group Б; no e-shop
// registration — these are ordinary receipts from a fiscal printer in the
// restaurant. No tips of any kind through this system (core.php,
// qr_tips_on), so no receipt has a tip line. ⚠ Still to confirm: whether
// this makes the system СУПТО (docs/qr-ordering/FISCAL-QUESTIONS-BG.md).
//
// ⚠ PHP 7.3 on the production host — see core.php.

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

return [
    // НАП tax group per station, 1–8 = А–З: 2 is "Б" (20 %). A category can
    // have its own, e.g. 'wines' => 2.
    'tax_groups' => [
        'kitchen' => 2,
        'bar' => 2,
        'tip' => 2,
    ],
    // Only if tips are ever switched back on: the tip is then a line of its
    // own, so the receipt's total is what the card paid.
    'tip_text' => 'Бакшиш',
    // (The УНП's operator code is the QR guest's, 9001: core.php. Staff
    // codes are 0001–8999, from „Персонал“.)
    // A comment line printed at the top of every receipt (empty: none).
    'header_comment' => 'QR меню',
];
