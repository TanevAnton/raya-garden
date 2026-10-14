<?php
// Which Clock PMS+ charge template each menu category is booked under, for
// payments sent to Clock (_lib/clock.php). Nothing here is secret: the API
// user, key and ids of the account live in raya-qr-config.php (see
// docs/qr-ordering/SETUP.md, "Clock PMS+").
//
// Clock wants a few templates (for its revenue reports and accounting
// codes), not one per dish: each charge carries the dish's own name. A
// category without a template of its own takes its station's default. A
// payment with a line that has no template at all is not sent, and waits on
// „За касата“ with the reason.
//
// The ids are Clock's charge_template ids (Settings → Charge Templates, or
// GET /charge_templates). 0 means none.
//
// ⚠ PHP 7.3 on the production host — see core.php.

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

return [
    'templates' => [
        // Defaults per station: everything made in the kitchen, at the bar.
        // ⚠ SANDBOX ONLY (14.10.2026): Clock's sandbox has demo spa services
        // alone, so "Massage" and "Sauna" stand in for food and drinks. Put
        // the live account's template ids here before QR_CLOCK_MODE = live.
        'kitchen' => 1508201,
        'bar' => 1508202,
        // Per category, overriding its station's default, e.g. 'wines' => 0.
        // The tip: 0 sends it as a plain surcharge with no VAT.
        'tip' => 0,
    ],
    // VAT sent with each line, e.g. 0.2; null leaves it to the template.
    'tax_rate' => null,
    // The currency of the Clock account (the sandbox runs in BGN only).
    'currency' => 'EUR',
];
