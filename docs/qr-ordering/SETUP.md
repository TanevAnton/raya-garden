# QR menu and table ordering — setup

Guests scan one QR code, pick their table, and order from the menu on their
phone. Staff see the orders on **rayagarden.bg/admin**, behind one shared
password.

Payment is chosen per evening:

- **Pay staff** (the default): orders arrive at once and are paid on the spot.
- **Pay on the phone**: the guest pays with Stripe before the order reaches
  staff. It needs the Stripe setup below.
- **Pay at the end** ("Сметка накрая"): orders arrive at once and collect on
  their table's bill, from every phone at the table. At the end anyone pays
  the whole bill, or just their part, on the phone. Staff settle what is left.
  It needs the same Stripe setup; see "Pay at the end" below.

| Page | Who | What |
| --- | --- | --- |
| `rayagarden.bg/menu/` | guests | the menu (BG/EN), table picker, cart, paying, order status |
| `rayagarden.bg/admin/` | staff | live orders, the evening's set-up, sold-out items, the till list |
| `rayagarden.bg/api/php-check.php` | you | checks the server can run all of it |

Both pages are `noindex` and carry no tracking.

## Where things live

```
public/api/qr-menu.json          the menu: names, sizes, prices (euro cents), allergens
public/api/qr/                   the PHP API (runs on the host's PHP 7.3)
  state.php, order.php, order-status.php, stripe-webhook.php
  bill.php, bill-pay.php, bill-abandon.php   the table's bill ("pay at the end")
  admin/  login, logout, session, feed, order, settings, sold-out, till, bill, waiters,
          history (past evenings), export (CSV for Excel), report (monthly e-mail)
  _lib/   core.php, order.php, auth.php, pay.php, bill.php, history.php, report.php,
          clock.php (payments into Clock PMS+), clock-settings.php (its charge templates),
          fiscal.php (fiscal receipts), fiscal-settings.php (tax groups, УНП)
  fiscal/ claim, report: for the fiscal bridge in the restaurant
tools/fiscal-bridge/             the bridge: prints the receipts through ErpNet.FP
          (not reachable from the web)
src/qr/menu/, menu/index.html    the guest page
src/qr/admin/, admin/index.html  the staff page
scripts/qr-server-config.mjs     puts the password and Stripe keys on the server (run by the deploy)
scripts/qr-print.mjs             makes the QR code and the A6 table card
docs/qr-ordering/print/          the QR code and the card, ready to print
tests/qr/                        API tests, browser tests, a fake Stripe
```

On the server, **above** the web root (the folder that holds `rayagarden.bg/`):

```
raya-qr-config.php          the staff password's bcrypt hash and the Stripe keys (written by the deploy)
raya-qr-data/orders.sqlite  every order, the evening's settings, the sold-out list
```

Nothing above the web root can be downloaded. The deploy only mirrors the web
root, so a deploy can never delete an order, the password or the keys.

## History and keeping it safe

Nothing deletes an order: every evening's orders, lines and payments stay in
`orders.sqlite`, filed under the evening (service date) they were placed on.
Only guests' and payers' names are erased, after 3 days. "История" on the
staff screen reads any evening back, and downloads an evening or a month as
two CSV files that open in Excel (UTF-8, ";" between cells, decimal comma):

- **поръчки** — one row per order line: evening, time, code, table,
  waiter, status, how it was paid, kitchen or bar, item, quantity, what was
  taken off and why, amount, the guest's note;
- **плащания с карта** — one row per payment on the phone: amount, tip,
  refunded, kept, whether it was entered in Clock, and Stripe's payment id
  (`pi_…`) to find it in the Stripe Dashboard.

A file's figures are the database's at the moment of download, so a refund
made later shows up when the file is downloaded again.

### The monthly summary by e-mail

Staff set an address at the bottom of "История". On the 1st, from 06:00
Sofia time, the first poll of a staff tablet sends last month's summary
there: the figures (sales, payments, each evening, waiters, best sellers)
and both CSV files attached. The tablet gets its answer first; the e-mail
goes after it (PHP-FPM's `fastcgi_finish_request`), so nothing waits on it.
There is no cron job — if no tablet is opened on the 1st, it goes the next
time one is. A refused send is tried again an hour later, up to 6 times;
every attempt is listed under the address, with the mail server's reason
when it failed. "Изпрати … сега" sends the chosen month at once (at most 5
an hour) — use it to test a new address.

It is sent with the host's own mail (PHP `mail()`), from
`no-reply@rayagarden.bg`: rayagarden.bg's mail is on the same server, and
its SPF record (`+a +mx`) allows it. If that ever stops working, put SMTP
settings in `raya-mailer-config.php` above the web root (the same file as
wedding enquiries would use: host, port, secure, username, password,
from_email) and the report uses SMTP instead. `/api/php-check.php` shows
which one is in use (`report_mail`). A different sender address can be set
with `'report_from'` in `raya-qr-config.php`.

### Keeping it safe

The database file is the only full copy. It lives on SuperHosting, outside
the site, so a deploy never touches it, and the host's backups of the
account include it (check in SPanel how often they run and how long they
are kept). A monthly download of both files from "История" is a copy kept
elsewhere — for the accountant, and in case the account is ever lost.

## Server settings come from GitHub secrets

GitHub → the repository → Settings → Secrets and variables → Actions:

| Secret | What |
| --- | --- |
| `QR_ADMIN_PASSWORD` | the staff password, at least 8 characters (set) |
| `QR_STRIPE_SECRET_KEY` | a **restricted** Stripe key, `rk_test_…` or `rk_live_…` (see below) |
| `QR_STRIPE_WEBHOOK_SECRET` | the signing secret of the Stripe webhook, `whsec_…` |
| `QR_CLOCK_*` | Clock PMS+: mode, API user and key, ids (see "Phone payments into Clock PMS+") |
| `QR_FISCAL_*` | the fiscal printer for phone payments: mode and the bridge's key (see "Fiscal receipts on the restaurant's own printer") |

After the site is live, every deploy runs the step *QR ordering settings (staff
password, Stripe keys)*. It rewrites `raya-qr-config.php` only when a secret
changed, and never prints a secret. A secret that isn't set leaves its line
alone. Setting a Stripe secret to `off` removes that key.

To change a secret, change it, then run the deploy (Actions → *Build & deploy
to SuperHosting* → *Run workflow*). A new staff password signs every device
out.

**Without GitHub**, on any computer with Node and PHP, run
`npm run qr:password`. It prints a config file with the staff password. Save
it as `raya-qr-config.php` in the folder above the web root, for example with
SPanel's File Manager.

## Checking the server

Open `https://rayagarden.bg/api/php-check.php`. Under `"qr"` you want:

- `pdo_sqlite`: `yes (SQLite 3.x)` (live: 3.26.0)
- `menu_readable`: `true`
- `config_found`: `true`
- `admin_password_set`: `true`
- `data_folder`: `exists, writable`

For paying on the phone, you also want:

- `stripe_key`: `TEST restricted key`, or `LIVE restricted key` once live
- `stripe_webhook_secret_set`: `true`
- `curl_reaches_stripe`: `yes (HTTP 401)`. The 401 is expected: the check sends
  no key.

`parses` should say `ok` for every file.

The database needs no setup. It creates itself on first use and upgrades itself
in place. The schema version is kept in SQLite's `user_version`, and each step
runs once, inside a transaction.

**A deploy that stops at "1/4 assets/".** Nothing is switched: the site keeps
running the previous build, whole. A file the server will not take whole is
retried file by file, each resumed where it stopped, as long as anything
still grows. If it still stops, the log quotes **the server's own answer**
for one of the files. Read it:

- "Quota exceeded" / "552": the **FTP account's quota** is full (SPanel → FTP
  accounts: raise it or set it to unlimited). It is separate from the disk,
  and files deleted in the file manager may not lower it.
- "Disk full" / "Insufficient storage" / "452": the account's disk is full.
  Free space in SPanel (mailboxes, backups, logs). A full disk can also stop
  the QR database from saving orders, so check that first.
- "451-Error during read from data connection" with 0 bytes stored: the
  upload connection broke at once. Deploys #91–#94 hit this; uploads over
  TLS 1.3 were dropped, so the deploy now uses TLS 1.2 (still encrypted).
- Timeouts or closed connections with no reply: the connection itself fails.

Then re-run the deploy in GitHub → Actions.

**A deploy that sits on one step with no new lines.** Deploy #95 sent every
file of step 2 and then waited 53 minutes: the upload program (lftp) had
finished its work but never exited while closing the connection. Each lftp
session now runs under a watchdog. lftp prints a mark once its last command
has run and is stopped a few seconds later if it is still there. A session
that runs past its time limit (a few minutes, more for big files) is stopped
too, and what it did not finish is resumed file by file as above. The log
then says "lftp finished but did not exit — stopped it" or "lftp still busy
after …s". Both are harmless: every file is still checked on the server
before index.html switches.

## Paying on the phone (Stripe)

### How it works

1. On an evening set to *С карта в телефона*, the guest's *Плати 15,80 €* button
   saves the order as waiting for payment. Staff don't see it yet.
2. The guest goes to Stripe's own payment page and pays by card, Apple Pay or
   Google Pay. No card data ever touches our server.
3. Stripe tells `https://rayagarden.bg/api/qr/stripe-webhook.php`, with a signed
   message. That, and only that, marks the order paid and sends it to the staff
   screen with *Платена онлайн*.
   - The guest's phone coming back to the menu proves nothing: a guest can pay
     and then lose signal.
   - The server also checks that the amount paid is the order's total (plus
     the tip, if the guest added one).
4. **Cancelling a paid order refunds it in full, automatically.** If the refund
   fails, the order is **not** cancelled, and staff try again.
   **Taking one line off** ("Няма") refunds just that line (or the part of it
   taken off); the rest of the order goes on. If that refund fails, the line
   is off anyway and the order card shows "Дължим на госта …" with
   *Върни сега*.
5. **An unpaid order never reaches staff.** The guest has an hour to pay, and
   after that Stripe closes the payment page.
   **Back from paying**, the guest gets a thank-you screen ("Благодарим!",
   with the code, table and amount) and a button back to the menu. It first
   shows "Потвърждаваме плащането…" until the server has Stripe's
   confirmation; the same holds for paying a table's bill.
6. **"За касата"** lists every paid order still to be entered in the till
   (Clock), and every refund to void there. With Clock connected (see "Phone
   payments into Clock PMS+") the items go there by themselves, and staff
   only add the card payment and close the folio, which prints the receipt.
   Without it, one person enters them by hand and ticks each one off.

   ⚠ **Ask the accountant how the fiscal receipt works for payments taken this
   way**, before the first real evening.

Prices are fixed by the server when the order is placed, and Stripe charges
exactly that. The payment page shows each line.

**Tips.** Before paying, the guest may add a tip for the team: 5, 10 or 15 %,
or an amount of their own, at most the order. It is a line of its own on
Stripe's page, shown to staff as "+ бакшиш" on the order and in "За касата",
and left out of the amount entered in Clock. Taking one line off refunds that
line only; cancelling the whole order refunds the tip too. История and the
monthly e-mail count card tips apart from the sales.

**Names.** Staff see the name entered on Stripe's payment page (*платил: …*)
on the order, the bill and the till list, plus the name a guest may type when
ordering (*Вашето име*, optional). Both are erased automatically 3 days later;
the email from the payment page is never stored. The privacy policy says so —
keep it in step if this changes (`src/content/legal/privacy.jsx`).

### Setting it up: test first

1. **Stripe account.** The company's account at dashboard.stripe.com: the
   company number (ЕИК), IBAN and the manager's ID. Use **test mode** (or a
   sandbox) until the rehearsal below has passed.
2. **Restricted key.** Developers → API keys → *Create restricted key*.
   - Name: `rayagarden.bg QR ordering`.
   - Permissions: **Checkout Sessions: Write** and **Refunds: Write**.
     Everything else stays *None*.
   - Copy the `rk_test_…` key.
   - Don't use the full secret key (`sk_…`). The deploy accepts it with a
     warning, but a leak of a restricted key can do far less.
3. **Webhook.** Developers → Webhooks → *Add endpoint*.
   - URL, exactly: `https://rayagarden.bg/api/qr/stripe-webhook.php`. Use https
     and no `www.`: a redirect makes every delivery fail.
   - If asked for an API version, choose `2026-08-26.dahlia`, the version the
     server calls.
   - Events:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `checkout.session.expired`
     - `charge.refunded`
   - Copy its *Signing secret*, `whsec_…`.
4. **GitHub secrets.** Set `QR_STRIPE_SECRET_KEY` = the `rk_test_…` key and
   `QR_STRIPE_WEBHOOK_SECRET` = the `whsec_…` secret. Run the deploy. The step
   prints `stripe_secret_key set … the Stripe key is a TEST key`.
5. **Check.** `php-check.php` shows `TEST restricted key`.
6. **Switch an evening to it.** In `/admin` → **Вечерта** → *Плащане: С карта в
   телефона* → *Запази и активирай*. The staff screen says **ТЕСТОВ РЕЖИМ**.
7. **Rehearse** with Stripe's test card: `4242 4242 4242 4242`, any future
   date, any CVC.
   - Pay one order. It arrives *Платена онлайн* and is on **За касата**.
   - Cancel one paid order. The refund appears in Stripe's test dashboard, and
     the guest sees *Сумата е върната*.
   - Back out of the payment page once. Nothing reaches staff, and the guest
     can still pay from *Поръчки*.

   If the guest sees *Плащането не може да започне*, or a refund fails, look
   at Stripe → Developers → Logs, and at `api/error_log` in SPanel's File
   Manager. A `403` there names a permission the restricted key is missing:
   add it to the key. Nothing else needs changing.

### Going live

1. Activate the Stripe account for live payments.
2. In live mode, repeat steps 2–3 above. This gives a **live** restricted key
   and a **live** webhook, with its own signing secret.
3. Replace both GitHub secrets with the live values, and run the deploy.
   `php-check.php` shows `LIVE restricted key`.
4. **Branding and receipts** (Settings → Business; they apply to test and live
   alike):
   - *Branding*: icon `docs/qr-ordering/stripe-branding/raya-stripe-icon-256.png`,
     logo `raya-stripe-logo.png` (light lettering — it needs the dark accent),
     brand colour `#a87f28`, accent colour `#100e0c`.
   - *Customer emails*: turn on **Successful payments** and **Refunds**, so
     guests get Stripe's receipt (and a refund receipt) by email. Stripe sends
     them for live payments only; a test receipt is sent by hand from the
     payment's *Receipt history*.
   - *Public details*: the statement descriptor (e.g. `RAYA GARDEN`) and the
     contact shown at the foot of receipts.
   Stripe's receipt confirms the payment; it is not the fiscal receipt, which
   comes from Clock when staff close the folio (see "Phone payments into
   Clock PMS+"), or from „За касата“ entered by hand.
6. The guest's e-receipt is off (see *The guest's e-receipt*). Fiscal
   receipts for phone payments come from Clock, printed by staff (see
   "Phone payments into Clock PMS+").
5. Which payment methods appear is set in Stripe → Settings → Payment methods;
   cards, Apple Pay and Google Pay are on by default. The code doesn't restrict
   it, and Stripe's own page needs no domain verification for Apple Pay.

### Turning it off

- **For one evening:** `/admin` → *При сервитьора*.
- **For good:** set both Stripe secrets to `off` and deploy. Without keys, every
  evening falls back to paying staff, whatever was chosen.

### Pay at the end ("Сметка накрая")

It uses the same keys, webhook and events; nothing more needs setting up.
Choose *Сметка накрая* in `/admin` → **Вечерта**.

- **Orders go straight to staff** and onto their table's bill (one per table
  and evening), from every phone that orders for that table.
- **Guests pay from "Сметка"** in the menu's header. It lists every line
  ordered for the table; each phone's own lines are marked and ticked
  first. "Избери всичко" covers the birthday case of one person paying for
  everyone.
  - One line is the unit: "2 × beer" can't be split between two people.
  - Paying works after ordering has closed.
- **Nothing is locked while someone pays.** The first payment Stripe
  confirms gets a line. Anyone who paid for the same line at the same moment
  gets that share back automatically, as a partial refund.
- **Cancelling an order** refunds its already-paid lines to whoever paid
  them. **Taking one line off** ("Няма" on the order card) does the same
  for just that line, or part of it.
- **Tips.** When paying, a guest can add a tip: none (the default), 5, 10 or
  15 %, or an amount of their own, at most what they are paying for. It is
  its own line on Stripe's page and stays apart from the bill everywhere:
  on the table's card in **Сметки**, next to the payment in **За касата**,
  and as a total for the day at the top of **За касата**. If everything a
  payment covered is refunded, its tip is refunded too.

  ⚠ **Ask the accountant how card tips go through the till and payroll**
  before the first real evening with tips.
- **Refunds that fail** stay on the table's card in **Сметки**
  ("Дължим на госта …") with *Върни сега* until they succeed.
- **Staff, in Сметки:**
  - *Платено на място* marks what is left as paid in cash or at the
    terminal.
  - *Затвори сметката* (only when nothing is left) closes the bill; the
    table's next order starts a new one.
  - A new evening starts new bills too.
- **For the till:** each payment from a bill (code `P-…`) goes on
  **За касата** at its net amount, without the tip. A refund made after it
  was entered shows up there to void, for its own amount.
- **Anyone who picks table 7 can see table 7's bill**: items and prices,
  never notes. That is the same trust as picking the table itself.

### Keys: rules that matter

- **Never put a key in the code, a chat or an email.** It goes in GitHub
  secrets only.
- **If a key leaks:** Stripe → API keys → *Roll* it at once, put the new one in
  the secret, and deploy.
- Use passkeys or an authenticator app for the Stripe login, not SMS.

### The guest's e-receipt („Електронна бележка“)

After every phone payment the guest gets an e-mail like the one Randevue
sends: „ЕЛЕКТРОННА БЕЛЕЖКА“ with a 10-digit number, the seller's details,
each line with its unit price without VAT, tax group and total, the VAT,
the order number, Stripe's transaction reference and Наредба Н-18's QR code.
A refund gets a „СТОРНО ДОКУМЕНТ“ for exactly what went back. The thank-you
screen and "Моите поръчки" link to the same document as a page
(`/api/qr/receipt.php`). Stripe can't send this document itself: its receipts
have no unbroken numbering and no QR code. The code is
`public/api/qr/_lib/ereceipt.php`; the QR code is drawn by
`_lib/qrcode.php`, with no library.

**It is switched off** (`'mode' => 'off'` in
`public/api/qr/_lib/ereceipt-settings.php`, since 12.10.2026). The e-shop
rules are for sales made at a distance; guests here order and pay at the
table, so their fiscal receipt has to come from the till — Clock. The code
stays for now, unused, and its tests still run (in test mode). The privacy
policy says the payment page's e-mail is not kept; switching this on again
means changing that too.

`'test'` would issue documents only while Stripe runs on test keys, each
marked „ТЕСТ — НЕ Е ДАНЪЧЕН ДОКУМЕНТ“ and numbered apart from real ones.

**What `'live'` would need, if it ever applied:**
1. The accountant confirms that phone payments may be documented this way
   (Н-18's rules for e-shops: card payments at a distance, delivered
   electronically) instead of a fiscal receipt from Clock, and how tips are
   treated.
2. The shop is registered with НАП as an e-shop. Its number goes in
   `'eshop_number'`, the first field of the QR code.
3. The seller's details in the settings file are checked: name, ЕИК, VAT
   number (assumed `BG203389338`), address, and the tax groups (food and
   drinks `Б`, 20 %).
4. **The monthly audit file to НАП (by the 15th) is not built yet.** It is
   needed before going live, from this system or from a service such as
   Take a NAP.

Each document is e-mailed after the answer that issued it has gone back,
so neither Stripe nor the tablet waits for the mail. A send that fails is
tried again from the staff screen's poll, ten minutes apart, up to 4 times.
The guest's address is erased 3 days later, like names; the document stays.
`/api/php-check.php` shows the mode (`ereceipt_mode`).

## Fiscal receipts on the restaurant's own printer

Clock ruled (15–19.10.2026) that bills paid on the spot are the restaurant's
to collect **and to fiscalise**, without passing them through Clock's POS. So
every phone payment is printed as a fiscal receipt on a **fiscal printer kept
for phone payments**, by a small program in the restaurant: the bridge.

```
rayagarden.bg  ⇄  the bridge (a computer in the restaurant)  →  ErpNet.FP  →  the fiscal printer
```

- **The server** queues a receipt in the same transaction that records the
  payment (`public/api/qr/_lib/fiscal.php`, table `fiscal_docs`). A refund
  queues a reversal receipt with the sale's УНП and number, reason "refund",
  for exactly what went back.
- **The bridge** (`tools/fiscal-bridge/`, Node.js, no dependencies) asks
  `/api/qr/fiscal/claim.php` every 3 seconds, prints through
  [ErpNet.FP](https://github.com/erpnet/ErpNet.FP), and reports back to
  `/api/qr/fiscal/report.php`. It only makes outgoing connections. Its setup is
  in `tools/fiscal-bridge/README.md` (Bulgarian, for whoever installs it).
- **Exactly once on paper:**
  - ErpNet.FP's idempotent printing, with our task id;
  - the bridge's own journal;
  - when nobody knows whether a receipt printed, it stops at "Провери на
    касата", never printed again by itself.
- **„За касата“** shows each payment's receipt:
  - "Чака касата…" / "Печата се…" on its way;
  - "бон № …" once printed;
  - "Не се отпечата: …" with *Опитай пак*.
  A warning appears at the top when the bridge has gone quiet or the printer
  isn't ready. Anything can still be entered by hand ("Въведена ръчно ✓"),
  which stops it from printing.

⚠ **Open before going live:** the accountant's answers in
`FISCAL-QUESTIONS-BG.md`, above all whether this makes our system "СУПТО"
under Наредба Н-18 (Annex 29: УНП, audit log, НАП export, registration).
The tax groups and the tip line are in `public/api/qr/_lib/fiscal-settings.php`
and wait for them too. Don't run this and Clock's item transfer
(`QR_CLOCK_MODE`) together: Clock has ruled that one out.

### Settings

| Secret | What |
| --- | --- |
| `QR_FISCAL_MODE` | `test` (only Stripe test payments are printed), `live` (only real ones), or `off` |
| `QR_FISCAL_BRIDGE_TOKEN` | the bridge's key, 32+ characters (`openssl rand -hex 32`); the same value as `RAYA_BRIDGE_KEY` on the bridge |

`php-check.php` shows `fiscal_mode` and `fiscal_bridge_key_set`.

### Test first

1. Ask the service company for the printer's training mode, if it has one.
   ErpNet.FP and the bridge go on the computer in the restaurant
   (`tools/fiscal-bridge/README.md`).
2. Secrets: `QR_FISCAL_MODE` = `test`, `QR_FISCAL_BRIDGE_TOKEN` = a new key.
   Deploy.
3. Pay a test order (Stripe's `4242 4242 4242 4242`): the receipt prints within
   a few seconds, and „За касата“ shows "бон № …".
4. Take a line off with "Няма": a reversal receipt prints for it.

## Phone payments into Clock PMS+

Every payment Stripe confirms goes into Clock as a folio of its own, on one
company, with its items (each under the charge template of its category)
and the tip. This system sends nothing more: no payment, no closing.

The waiter does the rest in Clock, as for any folio:
1. open the folio;
2. add the payment "карта" for its total (exactly what the guest paid);
3. close it, and Clock prints the fiscal receipt.

„За касата“ lists these folios under "Затвори в Clock", with the amount, and
staff tick each one ("Затворих го ✓"). Collecting the money and the fiscal
receipt stay with the restaurant, as Clock asked.

- **A refund before the folio is closed** puts the items that went back onto
  it at a negative quantity, so it closes at what was actually paid.
- **A refund after it was closed** is not sent: it waits under "Сторнирай в
  Clock", to storno by hand.
- **A payment that could not get through** shows Clock's reason, with
  *Опитай пак* and the tick to enter it by hand.

The code is `public/api/qr/_lib/clock.php`; the reasons are in DECISIONS.md.

**Production access.** Clock gives access to the real account only after a
certification meeting (see `CLOCK-CERTIFICATION-BG.md`). Until then it runs
against Clock's sandbox only.

### What Clock has to set up

- **The restaurant's account, not the hotel's.** The folios belong in the
  restaurant's Clock account, so the waiter closes them from the POS and the
  receipt prints on the restaurant's printer. Companies are shared between
  the hotel and the restaurant, folios are not. In the sandbox the restaurant
  is POS DEMO (16516), and our API user has no access to it yet ("Access
  denied to 'POS DEMO'"), so test folios still go to HOTEL DEMO (16515).
  With access, only `QR_CLOCK_BASE_URL` changes (to `…/base_api/178954/16516`)
  and the restaurant's own templates go into `clock-settings.php`.

- **An API user** for the account, with these rights:
  - companies: index;
  - company folios: create;
  - folios: show (to see whether staff closed one before a refund);
  - charges: create and index (the index is how a lost answer is checked);
  - charge templates: index.
  Clock's support activates it (AppConnector); the account's own users can't
  change its rights.
- **A company for these folios** with *Accept charge transfers* ticked. You
  can do this yourself: Companies → New Company, e.g. „QR меню – онлайн“;
  the toggle is on the company's page after saving. Its id is the number at
  the end of the page's address.
- **Charge templates** for food and drinks (and, if wanted, the tip), with
  every fixed attribute in them. Put their ids in
  `public/api/qr/_lib/clock-settings.php`: `kitchen` and `bar` for
  everything, and any category that needs its own. They're not secret, so
  they live in the code; deploy after changing them. ⚠ The file holds the
  sandbox's demo templates (Massage, Sauna) for now.

### Settings: GitHub secrets

| Secret | What |
| --- | --- |
| `QR_CLOCK_MODE` | `test` (only Stripe test payments are sent), `live` (only real ones), or `off` |
| `QR_CLOCK_BASE_URL` | `https://sky-eu1.clock-software.com/base_api/<subscription>/<account>` |
| `QR_CLOCK_API_USER` | the API user |
| `QR_CLOCK_API_KEY` | its key |
| `QR_CLOCK_COMPANY_ID` | the company with *Accept charge transfers* |
| `QR_CLOCK_CURRENCY` | only if the account is not in EUR (Clock's sandbox is BGN only) |

As for Stripe, a secret set to `off` removes its line, and nothing is ever
printed. `php-check.php` shows:
- `clock_mode` and `clock_configured`;
- `clock_templates`, which templates are set;
- `curl_reaches_clock`: `yes (HTTP 404)` (or 401). Any answer means the
  server reaches Clock: the check sends no key and asks for no real page.

### Test against Clock's sandbox

1. Set the secrets to the sandbox: mode `test`, its base URL, user and key,
   the company, and `QR_CLOCK_CURRENCY` = `BGN`. Deploy.
2. Pay a test order (Stripe's `4242 4242 4242 4242`). In Clock it is a new
   folio on that company, with the items and the tip. On „За касата“ it is
   under "Затвори в Clock", with the amount.
3. In Clock: add the payment "карта" for that amount and close the folio.
   Tick "Затворих го ✓".
4. Take one line off with "Няма" before closing: it appears in the folio at
   a negative quantity. After closing: it waits under "Сторнирай в Clock".

### Going live

After the certification: set the live account's base URL, user, key and
company, put the live template ids in `clock-settings.php`, remove
`QR_CLOCK_CURRENCY`, and set `QR_CLOCK_MODE` = `live` together with the live
Stripe keys. Test payments never reach a live till, and live payments never
reach the sandbox.

**To turn it off:** `QR_CLOCK_MODE` = `off`, and deploy. Payments wait on
„За касата“ to be entered by hand again; nothing is lost.

## Printing the cards

`docs/qr-ordering/print/table-card-a6.pdf` is an A6 card (105 × 148 mm). Print
it at 100 % ("actual size").

- **Every card has the same code.** Staff write the table number in the box on
  the day.
- **Numbered cards:** run `npm run qr:print -- --tables 40`.
- **Bare code:** `raya-menu-qr.pdf` (the code alone on a 100 × 100 mm page,
  vector) or `raya-menu-qr.svg`, for any other design. Keep it at least
  2.5 cm wide, dark on light, with the white margin around it.

## Changing the menu

Edit `public/api/qr-menu.json`, raise its `version`, and deploy. The pages and
the API use the same file, and the API takes every price from it, never from
the phone.

- **If a guest's open page is out of date** when they order, they see exactly
  what changed and nothing is sent until they check it again.
- **Old orders** keep the names and prices they were placed with.
- **On the night,** staff mark items sold out in **Изчерпани**, with no deploy
  needed.
- **Kitchen or bar.** Every category has `"station": "kitchen"` or `"bar"`:
  where its items are made, and so which staff screen they go to. A new
  category needs one (anything else counts as kitchen).
- **Sizes and choices.** An item with several `variants` (50 ml / 100 ml)
  shows a button for each; `bg` is the label in Bulgarian, with Cyrillic
  units (`"100 мл"`). The spirits' 100 ml is twice the 50 ml price; change
  any one of them in the file. `choices` (the Coca-Cola drinks, the fresh
  juice's fruit) are picked after tapping Добави and cost the same.

## Running the checks

```bash
npm run test:qr            # API: 126 tests, most of them paying against a fake Stripe and a fake Clock (needs php with pdo_sqlite;
                           # zbarimg, from zbar-tools, reads the e-receipt's QR code back where it is installed)
npm run build && npm run test:qr:e2e   # browser: guest and staff pages, 25 tests
composer install && npm run qr:php-check   # the PHP still parses on 7.3
```

| Setting | Where | Default |
| --- | --- | --- |
| `admin_password_hash` | `raya-qr-config.php` | none: sign-in shows "Паролата не е настроена" |
| `stripe_secret_key` | `raya-qr-config.php` | none: paying on the phone can't be switched on |
| `stripe_webhook_secret` | `raya-qr-config.php` | none: the same |
| `public_url` | `raya-qr-config.php` | `https://rayagarden.bg`, where Stripe sends the guest back |
| `data_dir` | `raya-qr-config.php` | `<above web root>/raya-qr-data` |
| `RAYA_QR_CONFIG` | environment | the path to the config file, if it isn't above the web root |
| `RAYA_QR_DATA_DIR` | environment | overrides `data_dir` |
| `RAYA_QR_TEST` | environment | **never on the live site.** Lets tests set the clock and use a fake Stripe (`RAYA_QR_STRIPE_API`). |

## Limits worth knowing

- **Orders per table:** 5 per 5 minutes. **Orders per network address:** 60
  per 5 minutes; a whole terrace on the venue Wi-Fi counts as one address.
  Both reset by themselves.
- **Staff sign-in:** after 10 wrong passwords from one address within
  15 minutes, that address has to wait. A sign-in lasts 16 hours on that
  device.
- **The staff page asks for news every 4 seconds.** After a lost connection
  it catches up on everything it missed, including changes made on another
  tablet.
- **Four "per 100 g" Wagyu items** are shown but not orderable online. They
  are ordered from the waiter.
- **Stripe's fees** are about 1.5 % + €0.25 per EU card, and more for non-EU
  cards. On a €3 coffee that is about 10 %, so one order per round is cheaper.
  Check Stripe's current prices for Bulgaria.
