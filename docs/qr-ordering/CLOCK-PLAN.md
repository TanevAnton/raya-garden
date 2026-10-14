# Phone payments into Clock PMS+ — the design, and the sandbox test

**Goal.** Every payment Stripe confirms on the QR menu is recorded in Clock as a
sale, so Clock issues the fiscal receipt. „За касата“ stays as the fallback. The
guest's e-receipt stays off.

Sandbox, 14.10.2026 — what has been proven:

- **Company „QR меню – онлайн“** (id 7200455), created in the UI with
  *Accept charge transfers* on. Demo companies refuse charges ("does not accept
  charges"), so the live account needs the same setting on its company.
- **Folio FL-56** (id 77863369): 3 items (2 × 8.90, 1 × 16.50, 3 × 6.00) plus a
  4.50 tip (`surcharge`, tax 0) in one `charges/bulk` → HTTP 200. Card payment
  56.80 with its `pi_…` reference → HTTP 200. Folio value 56.80, balance 0.00.
- **Refund charge**: the same item, positive price and `qty: -1`, → HTTP 200.
  Value 56.80 → 40.30, balance −16.50.
- **Folios come back with `tax_mode: "no_tax"`**: net 0.00 and VAT 0.00, even
  though the charges carry `tax_rate: 0.2`. To ask Clock (question 8).
- **Still refused for missing rights:** `close`, `charges` index,
  `fiscalization/generic` show, folio delete, and a negative card payment
  ("Payments: Add negative payment to Open folio"). So the fiscal step itself
  hasn't run.
- **Left behind:** FL-54 and FL-55 (company 7198861; a 56.80 payment each, no
  charges) and FL-56 (balance −16.50). Clock's UI shows no API-user rights to the
  account owner (AppConnector: "activated by ClockPMS+ Support"), so the rights
  have to come from Clock.

Status, 14.10.2026: **built** on `feat/qr-ordering`, as below, with the
close step behind `clock_close` until Clock grants the right. How to set it up:
SETUP.md, "Phone payments into Clock PMS+". Why it is built this way, and
what changed from this plan in testing: DECISIONS.md, same title. This file
keeps the original plan and the sandbox results.

## The flow, per payment

One Clock folio per Stripe payment (an order paid on the phone, `R-…`, or a
payment from a table's bill, `P-…`):

1. `POST /companies/{clock_company_id}/folios` `{"company_folio":{"currency":"EUR"}}`
2. `POST /folios/{id}/charges/bulk`: one charge per paid line, the tip as its own
   charge (`revenue_group: "surcharge"`, `tax_rate: 0`, or a tips template)
3. `POST /folios/{id}/credit_items`: `payment_type: "card"`, `value` = the
   amount paid, `reference` = Stripe's `pi_…`
4. `POST /folios/{id}/close` `{"document_type_id": …}`: the fiscal receipt

**Why one folio per payment, not Clock's "end of day" transfer.** The guest
needs a receipt for their own payment, at the time they pay. An end-of-day
folio is one document for the whole evening. Volume is small (tens of payments
an evening, 4–5 calls each), well inside 5 requests a second.

If Clock says the API close can't print a fiscal receipt (question 1), the same
code switches to end of day: one folio an evening, closed at night, with
„За касата“ still printing the guests' receipts by hand.

## Where it hooks in

| When | What happens |
| --- | --- |
| Stripe webhook marks an order or bill payment paid (`qr_stripe_event`, `qr_bill_event`) | In the **same transaction**, a `clock_docs` row is queued: kind `sale`, the lines frozen |
| A refund is recorded (whole order, one line, a bill overlap, a Dashboard refund) | In the same transaction, a `storno` row for exactly what went back |
| After the webhook's answer has gone (`register_shutdown_function` + `fastcgi_finish_request`, like the e-receipt) | Due rows are sent to Clock |
| Every staff-screen poll (`admin/feed.php`) | If anything is due, it's sent after that answer too. That's the retry loop: no cron needed |

Stripe never waits on Clock, and Clock being down never fails a webhook.

The lines come from code that already exists and is tested:
`qr_ereceipt_paid_lines()` for a sale and `qr_ereceipt_returned()` for what went
back. Both live in `_lib/ereceipt.php` today and don't depend on the e-mail.
They move to a shared `_lib/receipt-lines.php`, so the e-receipt and Clock use
the same lines and can never disagree.

## New table `clock_docs` (schema version 12)

```
id, kind ('sale'|'storno'), sale_id, source ('order'|'bill'), source_id,
code (R-…/P-…), payment_intent, lines_json, total_cents, tip_cents,
status   'pending' → 'sending' → 'done' | 'failed' | 'manual'
step     0 nothing · 1 folio made · 2 charges in · 3 payment in · 4 closed
clock_folio_id, clock_folio_number, tries, next_at, error, created_at, done_at
UNIQUE (source, source_id, kind, sale_seq)
```

## Exactly once: idempotent without idempotency keys

Clock's API has no `Idempotency-Key`, so a retry after a lost answer could make
a second folio or double the charges. Three rules stop that:

1. **One row per sale, unique in the database.** A webhook delivered twice is
   already stopped by `stripe_events`; the unique key is a second lock.
2. **A row is claimed before it's sent.** It's set to `'sending'` in a write
   transaction, as `qr_ereceipt_send_due()` does, so two requests never send the
   same row. A claim older than 2 minutes counts as abandoned.
3. **Each step is saved as soon as Clock answers, and a retry resumes from the
   last saved step.** When an answer was lost, the retry first reads the folio
   back before writing:
   - `GET /folios/{id}/charges`: are our charges there? Each carries
     `print_text: "QR R-7K3M"`.
   - `GET /folios/{id}/credit_items`: is a payment with our `pi_…` there?
   - `GET /folios/{id}`: is it closed already?
   A folio made but never saved locally (the answer to step 1 was lost) is left
   empty. Clock shows it as an empty open folio. It's named in the error, and is
   harmless; there's no delete right needed.

Retries: 1 min, 5 min, 15 min, 1 h, 3 h. After the 5th failure the row is
`'failed'`.

## „За касата“ stays the fallback

- **Sent and closed in Clock** → the order or payment ticks itself on
  „За касата“ (`till_at` set, marked „от Clock“), with the folio number.
- **Not yet sent / retrying** → shown as „Изпраща се към Clock…“. The tick is
  still allowed: a waiter ticking by hand marks the row `'manual'` and it is
  never sent. Whoever's first wins, inside one transaction, so no double entry.
- **Failed** → „Не влезе в Clock — въведи ръчно“ with Clock's error, and
  *Опитай пак*.
- **Refunds**: a storno sent to Clock ticks the „за сторниране“ line itself;
  otherwise it stays to void by hand, as today.
- **Kill switch:** `'clock_mode' => 'off'|'test'|'live'` in the config.
  Missing or `off` means everything is by hand, exactly as now. `test` runs only
  with Stripe test keys.

## Menu items → charge templates

The menu has 172 items in 25 categories. Clock wants a few templates (for
revenue reports and accounting codes), with the dish's name in `text`. Mapping
**by category** is enough. A new file, `_lib/clock-settings.php`, holds it; it's
not secret, so it lives in the code:

```php
'templates' => [
    'default_kitchen' => 0,   // e.g. „Ресторант – храна“
    'default_bar'     => 0,   // e.g. „Ресторант – напитки“
    'wines'           => 0,   // optional: per category, overrides the station default
    'tip'             => 0,   // 0 = a plain surcharge charge, tax 0
],
```

- **Price and VAT come from our order.** Each charge sends `price`, `qty` and
  `text` (Bulgarian name + size). `tax_rate` comes from the template, unless the
  accountant says otherwise.
- **Before going live**, a check refuses to switch on while any category has no
  template.
- **`php-check.php`** lists templates that are missing or archived in Clock.

## Refunds (storno)

The Clock guide says a void is the same charge with a **positive price and
negative `qty`**, and that this works even on a closed folio. For a *fiscal*
storno receipt, the proposal is **a new folio per refund**:

- negative-qty charges for exactly the lines that went back (the tip only when
  it went back);
- a negative card `credit_item` with the refund's reference;
- closed with the credit-document type.

Partial refunds (one line off) and bill overlaps work the same way, for their
own amounts. Question 4 confirms whether Clock wants this, or a correction on
the original folio.

## Credentials: never in the code

Same path as the Stripe keys. These go in GitHub secrets, and
`scripts/qr-server-config.mjs` writes them into `raya-qr-config.php` above the
web root:

| GitHub secret | config key |
| --- | --- |
| `QR_CLOCK_API_USER` | `clock_api_user` |
| `QR_CLOCK_API_KEY` | `clock_api_key` |
| `QR_CLOCK_BASE_URL` | `clock_base_url` (`https://sky-eu1.clock-software.com/base_api/{sub}/{account}`) |
| `QR_CLOCK_COMPANY_ID` | `clock_company_id` |
| `QR_CLOCK_DOCUMENT_TYPE_ID` | `clock_document_type_id` (and `…_STORNO_…` if it differs) |
| `QR_CLOCK_MODE` | `clock_mode` |

The values are validated as the Stripe ones are, `off` removes a value, and
nothing is ever printed. HTTP Digest is cURL's `CURLAUTH_DIGEST`, which PHP 7.3
has; no library is needed. The key is never logged, and Clock's errors are
stored without the request.

`php-check.php` gains `clock_mode`, `clock_configured`, and
`clock_reachable: yes (HTTP 401)`, the same idea as the Stripe check.

## Tests

- `tests/qr/fake-clock.mjs`, like `fake-stripe.mjs`: Digest auth, the
  5-requests-a-second limit, folios, charges, credit items and close. Failures
  can be injected at each step, including "the answer is lost after it was
  done".
- `tests/qr/clock.test.mjs`:
  - a sale lands once even when the webhook comes twice;
  - a lost answer at each of the 4 steps → no duplicate folio, charge or payment;
  - a tick by hand vs. sending, at the same moment → one entry;
  - Clock down → retries, then `failed` and back on „За касата“;
  - one line off → a storno for that line only; a full refund → the tip too;
  - bill overlap refunds; `clock_mode` `off` → nothing sent.
- The full suite (`test:qr`, `test:qr:e2e`) and `qr:php-check` stay green.

## Build order, once the questions are answered

1. Move the line logic to `_lib/receipt-lines.php`. No behaviour change, tests stay green.
2. `clock_docs` + `_lib/clock.php` (client, queue, retries) + the fake Clock and tests.
3. Hooks in `pay.php`, `bill.php`, `admin/order.php`, `admin/feed.php`.
4. „За касата“: Clock status, *Опитай пак*, ticks „от Clock“.
5. Deploy plumbing (secrets → config), `php-check.php`, SETUP.md and DECISIONS.md.
6. Rehearsal: Stripe test mode + Clock sandbox, then live with `clock_mode` `test` for one evening.

## Questions for Clock (these decide the design)

1. **Does closing a folio through the API print the fiscal receipt** on the
   restaurant's fiscal printer (Datecs / Daisy)? Or does printing need the
   station / POS device, with the API only receiving `fiscal_response_code`
   (`/fiscalization/generic`)? If it can't print, which flow do you recommend
   for payments taken online at the table?
2. **Which `document_type_id`** is the fiscal receipt („касова бележка“), and
   which is its storno?
3. **Charge templates** for food, drinks and tips, or should we create them?
   Which tax rate do they carry?
4. **Storno:** a new folio with negative-qty charges and a negative card
   payment, closed with the credit document type, or a correction on the
   original folio?
5. **A separate Clock POS account / outlet for the restaurant**, or the hotel's
   account 15003 (subscription 127767)? Which company should the folios be on?
6. **Rights for the live API user:** folios create, show and close (and with
   an outstanding balance), charges create **and index** (`base_api_charges_index`,
   needed to check after a lost answer), credit items, document types, charge
   templates, companies read, and `base_api_fiscalization_generic_show` to see
   whether a folio was fiscalised, and "Payments: Add negative payment to Open
   folio" for card refunds.
7. **Currency:** the sandbox is BGN only. The live account runs in EUR, right?
8. **VAT:** API-created company folios come back as `tax_mode: "no_tax"`
   (net and VAT 0.00). Is that a sandbox setting? On the receipt, VAT has to
   be split out by tax group.
