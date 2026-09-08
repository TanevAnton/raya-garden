# Wedding configurator — setup and maintenance

The configurator lives at **/svatben-konfigurator** and is linked from the
wedding card on **/events**. It collects a wedding configuration, shows an
indicative estimate and emails the whole enquiry to **hotel@svetagora.bg**.

It is an *enquiry* tool: it takes no payment, reserves nothing and says so on
every screen.

## Where things are

| What | File |
| --- | --- |
| Menus, prices, extras, inclusions, conditions, validity date | `public/api/wedding-offer.json` |
| Price rules (browser) | `src/lib/weddingPricing.js` |
| Price rules (server, authoritative) | `public/api/_lib/quote.php` |
| Endpoint (validation, email, sending) | `public/api/wedding-enquiry.php` |
| SMTP client | `public/api/_lib/smtp.php` |
| Interface text (bg / en / ro) | `src/i18n/weddingConfigurator.js` |
| Page and steps | `src/pages/WeddingConfigurator.jsx`, `src/components/wedding/` |
| Entry point on /events | `src/pages/Events.jsx` (`configuratorCta` in `src/translations.js`) |

**To change a price, a menu or a term, edit `public/api/wedding-offer.json`
only.** The page imports that file and the endpoint reads the same file at
runtime, so the estimate on screen and the estimate in the email cannot drift
apart. Bump `version` when you change it — the email records which version an
enquiry was priced with.

## Email delivery

The enquiry is sent **from the server**, so the figures in the email are the
ones the endpoint computed — not whatever a browser posted. Two transports are
tried in order.

### 1. Formspree (what the site uses today)

`RAYA_FORMSPREE_ENDPOINT` in `public/api/wedding-enquiry.php` holds the wedding
form's endpoint (`https://formspree.io/f/xvkovrvg`), the same service the
contact form uses. Nothing else to configure; an env var of the same name
overrides it.

**The delivery address lives on that form in the Formspree dashboard, not in
this code.** The endpoint cannot set or verify it — Formspree removed
browser-supplied recipients years ago, for good reasons. So "only
hotel@svetagora.bg" has to be true *on the form*: check that it is the sole
recipient there, and that no notification forwards are configured.

Formspree composes the email from the fields it is sent: `reference`, `name`,
`phone`, `email`, `address`, `date`, `guests`, `estimate`, `offer_version`, and
`summary` — the complete itemised enquiry, including any threshold or venue-fee
caveats. The `email` field becomes the Reply-To, so replying reaches the guest.
Mind the plan's monthly submission limit.

### 2. Authenticated SMTP (optional, unused while Formspree is set)

Clear `RAYA_FORMSPREE_ENDPOINT` (set it to an empty env var) and configure SMTP
instead. This transport renders the branded HTML + plain-text mail itself and
delivers to `RAYA_RECIPIENT`, which is a constant in the endpoint — with SMTP
the recipient really is enforced in code.

Provide the settings either in a config file outside the web root — the deploy
mirrors `dist/` with `--delete`, so anything inside the site folder that isn't
in the build is removed on the next deploy, e.g.
`/home/<account>/raya-mailer-config.php`:

```php
<?php
return [
    'host'       => 'smtp.example.com',
    'port'       => 587,          // 465 with 'secure' => 'ssl'
    'secure'     => 'tls',        // tls (STARTTLS) | ssl | none
    'username'   => 'no-reply@rayagarden.bg',
    'password'   => '…',
    'from_email' => 'no-reply@rayagarden.bg',  // must be authorised by the relay
    'from_name'  => 'RAYA Garden',
];
```

…or as environment variables: `RAYA_SMTP_HOST`, `RAYA_SMTP_PORT`,
`RAYA_SMTP_SECURE`, `RAYA_SMTP_USER`, `RAYA_SMTP_PASS`, `RAYA_MAIL_FROM`,
`RAYA_MAIL_FROM_NAME`, or `RAYA_MAILER_CONFIG` to point at the file.

The guest's own address is only ever the `Reply-To`, never the `From` — sending
as the guest's domain would fail SPF/DKIM and land the enquiry in spam.

With neither transport configured the endpoint answers `503
mailer-not-configured`. **It never reports success for a message a transport
did not accept.**

## Requirements on the host

- **The production host runs PHP 7.3.33 (FPM).** Keep the endpoint parseable
  there: no typed properties, no arrow functions, no `never`/`mixed` types, no
  `?->`, no `str_contains()`. A 7.4+ construct is a parse error, and it reaches
  the guest as a bare 500 with the generic "could not be sent" apology — it
  cost three deploys to find the first time. `/api/php-check.php` re-parses the
  endpoint's files on the host's own PHP and names the error if there is one.
- No Composer required. `mbstring` is used when present and stood in for when
  it isn't; `curl` or `allow_url_fopen` is needed to reach Formspree; `openssl`
  only for the SMTP transport.
- If a request does fatal, PHP writes `api/error_log` on the host — readable in
  cPanel's File Manager. The deploy no longer deletes it.
- **Outbound HTTPS from PHP** (cURL, or `allow_url_fopen`) so the server can
  reach Formspree. If the host blocks it the endpoint answers `502
  send-failed` and logs `formspree send failed at connect: …`; that is the
  signal to switch to the SMTP transport instead.
- `openssl` for the SMTP transport's STARTTLS, and outbound access to the SMTP
  port, if you use that route.
- `public/api/_lib/.htaccess` denies direct access to the library files; the
  files also refuse to run unless included by the endpoint.

## Behaviour worth knowing

- **Everything is recalculated server-side** from the offer JSON. Amounts sent
  by the browser are ignored, so a tampered total in the request changes
  nothing.
- **Rate limiting**: 5 accepted submissions per IP per hour; state lives in the
  system temp directory, so a deploy never wipes or preserves it wrongly.
- **Duplicate folding**: an identical submission within 10 minutes returns the
  first reference instead of emailing twice (double-clicks, retries).
- **Spam guards**: a hidden honeypot field and a minimum fill time of 3
  seconds. Both answer with a success-shaped response and send nothing.
- **Logging** records only the enquiry reference and the failure reason —
  never names, phones, emails or addresses.

## Unresolved business rules

These are marked in the JSON and carried into every email; they need the
hotel's confirmation:

1. **Does a child on the children's menu count toward the 60-person minimum?**
   `package.thresholdBasis.confirmed` is `false`. While it stays false, a party
   whose standard-menu guests are under 60 but whose combined count reaches 60
   is shown a range (105.00 € and 115.00 € per person) rather than one invented
   answer. Once the hotel decides, set `confirmed: true` and `value` to either
   `standard_menu_guests` or `combined_guests`; the range disappears
   everywhere.
2. **Do the ceremony spaces combine?** The €12/person outdoor-ceremony
   arrangement and the separately priced lawn (€400) and terrace (€250) are
   selected independently and summed as listed. When more than one is chosen
   the page and the email both say the combination needs confirmation.
3. **Mixed menus across guests** are offered as a request, not a policy — the
   offer does not describe them.

## Testing locally

```bash
php -S 127.0.0.1:8088 -t public          # the API (set the RAYA_SMTP_* vars)
npm run dev                               # the site; /api is proxied to :8088
```

## Self-test — is the host able to run this at all?

Two probes. Start with the second if the first returns a 500.

```
https://rayagarden.bg/api/wedding-enquiry.php?selftest=1   # the endpoint reporting on itself
https://rayagarden.bg/api/php-check.php                    # a PHP 5-era probe that runs even
                                                           # when the endpoint cannot be parsed
```

`php-check.php` reports the PHP version, which extensions are present, whether
the host can reach Formspree, and — the useful part — whether this PHP can
*parse* each of the endpoint's files, naming the syntax error if not. Safe to
leave in place, safe to delete.

What you see tells you where a failure is:

| What comes back | Meaning |
| --- | --- |
| `{"ok":true,"selftest":{…}}` | PHP runs the endpoint. Read the fields: `transport_reachable` says whether the host can reach Formspree, `offer_config_readable` whether the prices are being found. |
| PHP source code, or a download prompt | PHP is not executing in that folder. Ask the host to enable it (or check the PHP version selector in cPanel). |
| The RAYA Garden website | A rewrite is swallowing `/api/`. Check `.htaccess` reached the server. |
| `500` | Usually the PHP version. The code needs 7.4+; older parses it as an error. |
| `403` / `404` | The file did not upload, or the host blocks it. |

It reports capability only — no credentials, no configuration values, no
enquiry data.

## Smoke test after configuring the mailer

Run this from any machine once the SMTP settings are in place and the site is
deployed. It sends a clearly labelled test enquiry through the real endpoint —
the same path the configurator uses — so a `200` with a reference means the
relay accepted the message, not that a form validated.

```bash
curl -sS -X POST https://rayagarden.bg/api/wedding-enquiry.php \
  -H 'Content-Type: application/json' \
  -d '{
    "offerVersion": "2026-09-08.1",
    "lang": "bg",
    "elapsedSeconds": 120,
    "website": "",
    "date": { "mode": "date", "date": "2027-06-12", "time": "16:00" },
    "guests": { "standard": 60, "children": 0 },
    "menus": { "primary": "menu-1", "mixed": false, "allocation": {} },
    "childMenus": {},
    "extras": { "tent": { "selected": true, "hours": 2 } },
    "requests": {},
    "otherWishes": "ТЕСТ — проверка на доставката, моля игнорирайте.",
    "contact": {
      "name": "ТЕСТ Запитване",
      "phone": "+359 896 100 100",
      "email": "<your own address, so the Reply-To is yours>",
      "address": "Парк „Света гора“, 5000 Велико Търново",
      "message": "ТЕСТ — изпратено при настройката на конфигуратора."
    },
    "consent": true
  }'
```

Expected answers:

| Response | Meaning |
| --- | --- |
| `{"ok":true,"reference":"RG-WD-…"}` | The relay **accepted** the message. Check hotel@svetagora.bg for arrival — acceptance is not the same as inbox delivery (spam filters, forwarding rules). |
| `{"ok":false,"error":"mailer-not-configured"}` (503) | No transport is set. Check `RAYA_FORMSPREE_ENDPOINT`, or the SMTP settings. |
| `{"ok":false,"error":"send-failed"}` (502) | The transport refused or was unreachable. The log line `[wedding-enquiry] RG-WD-… formspree send failed at <stage>: <reason>` names it — `connect` means the host cannot reach Formspree, `rejected` means Formspree refused (wrong form id, plan limit). For SMTP the stages are connect, auth, mail-from, rcpt-to, body. |
| `{"ok":false,"error":"validation",…}` | The payload was rejected; the `fields` object names what. |

Repeating the identical command within 10 minutes returns the first reference
with `"duplicate":true` and sends nothing — change the message text to send a
second one. Five accepted sends per IP per hour.
