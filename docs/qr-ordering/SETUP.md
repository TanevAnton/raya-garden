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
  admin/  login, logout, session, feed, order, settings, sold-out, till, bill
  _lib/   core.php, order.php, auth.php, pay.php, bill.php (not reachable from the web)
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

## Server settings come from GitHub secrets

GitHub → the repository → Settings → Secrets and variables → Actions:

| Secret | What |
| --- | --- |
| `QR_ADMIN_PASSWORD` | the staff password, at least 8 characters (set) |
| `QR_STRIPE_SECRET_KEY` | a **restricted** Stripe key, `rk_test_…` or `rk_live_…` (see below) |
| `QR_STRIPE_WEBHOOK_SECRET` | the signing secret of the Stripe webhook, `whsec_…` |

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
   - The server also checks that the amount paid is the order's total.
4. **Cancelling a paid order refunds it in full, automatically.** If the refund
   fails, the order is **not** cancelled, and staff try again.
5. **An unpaid order never reaches staff.** The guest has an hour to pay, and
   after that Stripe closes the payment page.
6. **"За касата"** lists every paid order still to be entered in the till
   (Clock), and every refund to void there. This system cannot reach Clock, so
   one person enters them by hand and ticks each one off.

   ⚠ **Ask the accountant how the fiscal receipt works for payments taken this
   way**, before the first real evening.

Prices are fixed by the server when the order is placed, and Stripe charges
exactly that. The payment page shows each line.

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
4. Which payment methods appear is set in Stripe → Settings → Payment methods;
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
  them.
- **Refunds that fail** stay on the table's card in **Сметки**
  ("Дължим на госта …") with *Върни сега* until they succeed.
- **Staff, in Сметки:**
  - *Платено на място* marks what is left as paid in cash or at the
    terminal.
  - *Затвори сметката* (only when nothing is left) closes the bill; the
    table's next order starts a new one.
  - A new evening starts new bills too.
- **For the till:** each payment from a bill (code `P-…`) goes on
  **За касата** at its net amount. A refund made after it was entered shows
  up there to void.
- **Anyone who picks table 7 can see table 7's bill**: items and prices,
  never notes. That is the same trust as picking the table itself.

### Keys: rules that matter

- **Never put a key in the code, a chat or an email.** It goes in GitHub
  secrets only.
- **If a key leaks:** Stripe → API keys → *Roll* it at once, put the new one in
  the secret, and deploy.
- Use passkeys or an authenticator app for the Stripe login, not SMS.

## Printing the cards

`docs/qr-ordering/print/table-card-a6.pdf` is an A6 card (105 × 148 mm). Print
it at 100 % ("actual size").

- **Every card has the same code.** Staff write the table number in the box on
  the day.
- **Numbered cards:** run `npm run qr:print -- --tables 40`.
- **Bare code:** `raya-menu-qr.svg`, for any other design. Keep it at least
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

## Running the checks

```bash
npm run test:qr            # API: 60 tests, 30 of them paying against a fake Stripe (needs php with pdo_sqlite)
npm run build && npm run test:qr:e2e   # browser: guest and staff pages, 16 tests
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
