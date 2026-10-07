<?php
// Who issues the e-receipt („Електронна бележка“, _lib/ereceipt.php) and
// how. Everything here is printed on every document, so it must be exactly
// right before 'mode' becomes 'live' — the accountant checks it.
//
// ⚠ PHP 7.3 on the production host — see core.php.

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

return [
    // 'test'  documents only while Stripe runs on test keys: each says
    //         „ТЕСТ“ and is numbered on its own, apart from real ones. With
    //         live keys, none at all.
    // 'live'  real documents with live keys as well. Only once the
    //         accountant has confirmed that these payments may be
    //         documented this way (the e-shop rules of Наредба Н-18), and
    //         the shop is registered with НАП: its number goes below.
    // 'off'   none.
    'mode' => 'test',

    // The e-shop's unique number, given by НАП when it is registered — the
    // first field of the document's QR code. Test documents use "TEST".
    'eshop_number' => '',

    // The seller, as registered (the same entity as the privacy policy's,
    // src/content/legal/controller.js). ⚠ The VAT number is assumed to be
    // BG + ЕИК, the usual form: to be confirmed.
    'seller' => [
        'name' => '„Света гора-Велико Търново“ ООД',
        'eik' => '203389338',
        'vat' => 'BG203389338',
        'address' => 'гр. Горна Оряховица 5100, ул. „Росица“ № 6, ап. 4',
        'shop' => 'Ресторант RAYA Garden, парк „Света гора“, 5000 Велико Търново',
        'phone' => '+359 896 100 100',
        'email' => 'hotel@svetagora.bg',
    ],

    // Tax groups (Наредба Н-18): letter => VAT rate, %.
    'groups' => ['А' => 0, 'Б' => 20, 'В' => 20, 'Г' => 9],
    // The group of each kind of line: food (the kitchen's categories),
    // drinks (the bar's), and a tip. ⚠ The tip's treatment is the
    // accountant's call.
    'group_kitchen' => 'Б',
    'group_bar' => 'Б',
    'group_tip' => 'Б',
];
