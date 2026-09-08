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

## Email delivery — what must be configured

Nothing in the repository holds credentials, so **until an SMTP account is
configured the endpoint answers `503 mailer-not-configured` and the page tells
the guest the enquiry could not be sent.** It never reports success for a
message that was not accepted by the relay.

Provide the settings in either of two ways.

**1. A config file outside the web root** (recommended on SuperHosting). The
deploy mirrors `dist/` with `--delete`, so anything inside the site folder that
isn't in the build is removed on the next deploy — the file must live one level
above it, e.g. `/home/<account>/raya-mailer-config.php`:

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

**2. Environment variables** (`SetEnv` in the host's panel, or the vhost):

| Variable | Meaning |
| --- | --- |
| `RAYA_SMTP_HOST` | SMTP server |
| `RAYA_SMTP_PORT` | 587 (STARTTLS) or 465 (implicit TLS); default 587 |
| `RAYA_SMTP_SECURE` | `tls`, `ssl` or `none`; default `tls` |
| `RAYA_SMTP_USER` | SMTP username |
| `RAYA_SMTP_PASS` | SMTP password |
| `RAYA_MAIL_FROM` | Sender address the relay is authorised to send as |
| `RAYA_MAIL_FROM_NAME` | Display name; default `RAYA Garden` |
| `RAYA_MAILER_CONFIG` | Optional explicit path to the config file above |

Use a mailbox on a domain the relay is allowed to send for. The guest's own
address is set as `Reply-To`, never as `From` — sending as the guest's domain
would fail SPF/DKIM and land the enquiry in spam.

The recipient is **not** configurable: `RAYA_RECIPIENT` is a constant in
`public/api/wedding-enquiry.php`. Nothing the browser sends can redirect the
mail.

## Requirements on the host

- PHP 8.0+ with `openssl` (for STARTTLS) — no Composer, no extensions beyond
  the defaults.
- Outbound access to the SMTP port from the web host.
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
