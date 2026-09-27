<?php
// GET /api/qr/state.php — what the guest page needs besides the menu itself:
// is ordering open (and if not, why and until when), which tables exist, and
// what is sold out tonight. Polled by the page every half minute.
//
// ⚠ PHP 7.3 on the production host — see _lib/core.php.

declare(strict_types=1);

define('RAYA_QR', true);
require __DIR__ . '/_lib/core.php';

qr_require_method('GET');
$state = qr_state(qr_settings(), qr_now());
$state['soldOut'] = qr_sold_out();
$state['menuVersion'] = (string) (qr_menu()['version'] ?? '');
qr_json(200, ['ok' => true] + $state);
