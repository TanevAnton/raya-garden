# QR menu and table ordering — setup

Guests scan one QR code, pick their table, and order from the menu on their
phone. Staff see the orders appear on **rayagarden.bg/admin**, behind one
shared password. Payment stays with the staff, as now.

| Page | Who | What |
| --- | --- | --- |
| `rayagarden.bg/menu/` | guests | the menu (BG/EN), table picker, cart, order status |
| `rayagarden.bg/admin/` | staff | live orders, the evening's tables and hours, pause, sold-out items |
| `rayagarden.bg/api/php-check.php` | you | checks the server can run all of it |

Both pages are `noindex` and carry no tracking.

## Where things live

```
public/api/qr-menu.json          the menu: names, sizes, prices (euro cents), allergens
public/api/qr/                   the PHP API (runs on the host's PHP 7.3)
  state.php, order.php, order-status.php
  admin/  login, logout, session, feed, order, settings, sold-out
  _lib/   core.php, order.php, auth.php (not reachable from the web)
src/qr/menu/, menu/index.html    the guest page
src/qr/admin/, admin/index.html  the staff page
scripts/qr-admin-password.mjs    puts the staff password on the server (run by the deploy)
scripts/qr-print.mjs             makes the QR code and the A6 table card
docs/qr-ordering/print/          the QR code and the card, ready to print
tests/qr/                        API tests and browser tests
```

On the server, **above** the web root (the folder that holds
`rayagarden.bg/`, next to where `raya-mailer-config.php` would go):

```
raya-qr-config.php        the staff password's bcrypt hash (written by the deploy)
raya-qr-data/orders.sqlite  every order, the evening's settings, the sold-out list
```

Nothing above the web root can be downloaded. The deploy only mirrors the web
root, so a deploy can never delete an order or the password.

## Deploying it

The work is on the branch `feat/qr-ordering` and has **not** been deployed.

1. **Set the staff password.** GitHub → the repository → Settings → Secrets
   and variables → Actions → *New repository secret*:
   `QR_ADMIN_PASSWORD`, at least 8 characters. Do this before merging.
2. **Merge `feat/qr-ordering` into `main`.** The usual deploy runs. After the
   site is live, the step *Staff password for /admin* puts the password's
   hash on the server. It prints one of these:
   - `written and checked`: the first time, or after the password changed;
   - `already in place — unchanged`: every deploy after that.
3. **Check the server.** Open `https://rayagarden.bg/api/php-check.php`. Under
   `"qr"` you want:
   - `pdo_sqlite`: `yes (SQLite 3.x)`. If it says `no pdo_sqlite`, turn on the
     `pdo_sqlite` extension in SPanel → PHP settings. It is on in most setups,
     but this host has not been checked yet.
   - `menu_readable`: `true`
   - `config_found`: `true` and `admin_password_set`: `true`
   - `data_folder`: `not created yet, can be` or `exists, writable`

   `parses` should say `ok` for every file.
4. **The database needs no setup.** The first staff sign-in or order creates
   `raya-qr-data/` (permissions 0700) and `orders.sqlite`, and builds the
   tables. Later schema changes upgrade the file in place: the version is kept
   in SQLite's `user_version`, and each step runs once inside a transaction.
5. **Rehearse once.**
   - Open `/admin/` on the staff tablet and sign in. In **Вечерта**, set today,
     the hours and the number of tables, then press *Запази и активирай*.
     Press *🔔 Включи звук*.
   - On a phone, scan the card, pick a table and send an order.
   - It appears on the tablet with a chime. Press *Приеми*, then *Сервирано*,
     and watch the phone follow along.
   - Cancel one order with a reason, and try *Пауза*.
6. **Print the cards.** `docs/qr-ordering/print/table-card-a6.pdf` is an A6
   card (105 × 148 mm). Print it at 100 % ("actual size"). Every card has the
   same code; staff write the table number in the box on the day. For
   numbered cards, run `npm run qr:print -- --tables 40`.
   `raya-menu-qr.svg` is the bare code for any other design. Keep it at least
   2.5 cm wide, dark on light, with the white margin around it.

### Changing the password

Change the `QR_ADMIN_PASSWORD` secret, then run the deploy again (Actions →
*Build & deploy to SuperHosting* → *Run workflow*). Every staff device is
signed out and signs in with the new password.

**Without GitHub**, on any computer with Node and PHP, run
`npm run qr:password`. It asks for the password and prints the file. Save the
output as `raya-qr-config.php` in the folder above the web root, for example
through SPanel's File Manager. If the secret is also set, the next deploy
replaces a hash that doesn't match it.

### Settings (all optional)

| Where | Name | Default |
| --- | --- | --- |
| `raya-qr-config.php` | `admin_password_hash` | *(none: sign-in shows "Паролата не е настроена")* |
| `raya-qr-config.php` | `data_dir` | `<above web root>/raya-qr-data` |
| environment | `RAYA_QR_CONFIG` | path to the config file, if not above the web root |
| environment | `RAYA_QR_DATA_DIR` | overrides `data_dir` |
| environment | `RAYA_QR_TEST` | **never on the live site.** Lets tests set the clock. |

## Changing the menu

Edit `public/api/qr-menu.json`, raise its `version`, and deploy. The pages and
the API use the same file, and the API takes every price from it, never from
the phone. If a guest's open page is out of date when they order, they see
exactly what changed (item removed, sold out, or new price) and nothing is
sent until they check it again. Old orders keep the names and prices they
were placed with.

On the night, staff mark items sold out in **Изчерпани**, with no deploy
needed.

## Running the checks

```bash
npm run test:qr            # API: 30 tests (needs php with pdo_sqlite)
npm run build && npm run test:qr:e2e   # browser: guest and staff pages, 11 tests
composer install && npm run qr:php-check   # the PHP still parses on 7.3
```

## Limits worth knowing

- **Orders per table:** 5 per 5 minutes. **Orders per network address:** 60
  per 5 minutes; a whole terrace on the venue Wi-Fi counts as one address.
  Both reset by themselves.
- **Staff sign-in:** after 10 wrong passwords from one address within
  15 minutes, that address has to wait until the oldest one is 15 minutes
  old. A sign-in lasts 16 hours on that device.
- **The staff page asks for news every 4 seconds.** After a lost connection
  it catches up on everything it missed, including changes made on another
  tablet.
- **Four "per 100 g" Wagyu items** are shown but not orderable online. They
  are ordered from the waiter.
