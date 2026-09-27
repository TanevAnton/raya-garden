# QR ordering — decisions

What was decided, why, and what was left out on purpose. Newest questions
are at the bottom.

## Scope: as small as the job allows

The original brief asked for accounts, a database server and a full admin
system. The owner asked: *"do we really need php and a database and login
for this"*. The job is: guests order from their phones and staff see the
orders on one page behind a password. Tables are arranged and numbered **on
the day of each event**, and staff set the number of tables and the ordering
hours.

So:

- **One shared staff password, no accounts.** Orders are handled by whoever
  holds the tablet. Per-person accounts would add setup and forgotten
  passwords without changing what anyone can do.
- **A little PHP, because a static page cannot share orders.** Orders from
  many phones have to reach one staff screen, so something on the server must
  hold them. The host is shared Apache with PHP 7.3 and already runs the
  wedding-enquiry endpoint the same way. Nothing new has to be bought or set
  up.
- **SQLite, not MySQL.** It is one file, needs no database to create, no
  user or credentials, and has real transactions. The file sits **above the
  web root**, so it cannot be downloaded, and the deploy (which mirrors the
  web root and deletes what is not in the build) can never touch it.

## One QR code for every table

Tables change with every event, so a code per table would mean reprinting
for every layout. There is **one code**, `https://rayagarden.bg/menu/`, on
every card. The guest picks their table number, which staff write on the
card on the day, and ticks *"I confirm I am at table N"* before sending.

- **Risk:** a guest can pick the wrong table.
- **Mitigations:** the confirmation tick, the table number printed in large
  type on the staff card, and a one-tap cancel reason *"Грешна маса"* that
  the guest sees.
- Staff can also switch individual table numbers off for the evening.

## The evening, in Sofia time

Staff enter a date and *from / to* times. The server turns them into two
exact moments using PHP's `DateTime` in `Europe/Sofia`:

- A *to* at or before *from* means the next day (18:00–01:00).
- A window across a daylight-saving change is the right length.

Tests cover the 2026 changes in both directions. Both moments are stored, and
"is ordering open" is a comparison of timestamps, with no clock arithmetic at
order time.

## Money and the menu

- **Prices are integer euro cents** everywhere: `1250` is shown as `12,50 €`
  in Bulgarian and `€12.50` in English. No floating point touches a price.
- **The menu file is the only source of prices.**
  `public/api/qr-menu.json` is built into the pages and read by the API. An
  order carries item and option ids and quantities; the server looks up every
  price itself.
- **Orders keep their own copy.** Names, sizes and prices are copied into
  the order when it is placed, so editing the menu later never changes a
  past order.
- **If the menu changed under the guest** (an item removed, sold out, or
  repriced while it sat in the cart), the order is refused with a `409`.
  The refusal lists each affected line with the old and new price. The phone
  applies the changes, shows them, and clears the confirmation tick. Nothing
  is sent until the guest has seen it.

**The menu data** was taken from the text layer of *Menu Raya 2026*
(15.05.2026), not retyped. A script checked every euro price, size and
allergen group against the PDF. What differs from the print:

- **Two items have euro and lev prices that disagree.** The **euro** price
  was used:

  | Item | € (used) | лв as printed | € the лв price implies |
  | --- | --- | --- | --- |
  | Котлет от шаран / амур | 10,90 € | 20,53 лв | 10,50 € |
  | Еклер с бял шоколад | 5,20 € | 11,54 лв | 5,90 € |

  **Please confirm both.**
- **English names** are in sentence case instead of the print's capitals,
  with obvious slips corrected: "LUTENITSA" became "lyutenitsa",
  "KEBABCHETA" became "kebapcheta", "MUSKAT" became "Muscat", and "SAUTE"
  became "sauté". Bulgarian names are as printed.
- **"Бистра телешка супа"** is printed in English as "Beef stew" and is kept
  that way. A clear beef soup is not a stew, so the print may want fixing.
- **Not orderable online:** the four "per 100 g" Wagyu items. They are sold
  by weight and priced after weighing, so they are shown as *"ordered from
  your waiter"*.
- **No photos.** The PDF has none per dish, and none were invented.

## Sending an order exactly once

- **The phone makes one `Idempotency-Key` per cart.** The key changes only
  if the cart changes. A double tap, a retry after a lost connection, or a
  reload therefore sends the same key.
- **The server checks the key and stores the order in one transaction.** A
  repeat with the same content gets the original order back (`replayed`). A
  repeat with different content is refused. The key is unique in the
  database, so it holds even under simultaneous requests. A test fires 8 at
  once and gets one order.
- **SQLite `BEGIN IMMEDIATE` puts writers in line.** It uses an 8-second
  busy timeout, far more than a busy evening needs. A test has 12 tables
  ordering at the same moment.

## Staff screen: polling, not a live socket

The staff page asks *"anything after change number N?"* every 4 seconds.
Every write bumps one counter inside its own transaction, and the answer
comes from one consistent read.

- **Why not a socket:** shared PHP hosting cannot hold long-lived
  connections (WebSockets or server-sent events) reliably.
- **Recovery is built in:** a tablet that was offline asks from the last
  number it saw and gets everything it missed. That includes changes made on
  another tablet and sold-out changes.
- **Guests' phones** ask every 10 seconds, only while one of their orders is
  still open.

## Privacy and security

- **Guests see only their own orders.** They are identified by a random
  256-bit token kept on the phone. The server stores only its SHA-256. The
  short code (`R-7K3M`) is only for showing to staff, and it opens nothing.
- **Staff sign-in:**
  - The password is stored only as a bcrypt hash, in the config file above
    the web root.
  - The cookie is signed and expires after 16 hours. It is `HttpOnly`,
    `SameSite=Strict`, and limited to the staff API.
  - Every change also needs a custom header and a same-site `Origin`.
  - After 10 wrong passwords in 15 minutes, that address has to wait.
  - The cookie's signature covers the password hash, so **changing the
    password signs every device out**.
- **The password comes from a GitHub secret.** The deploy writes only its
  hash to the server, and only when it no longer matches, so staff are not
  signed out by every deploy. There is a manual route too
  (`npm run qr:password`).
- **Abuse limits:**
  - 5 orders per table and 60 per network address per 5 minutes. The venue
    Wi-Fi is one address for everyone.
  - A hidden form field that people never fill in.
  - The network address is stored only as a keyed hash, and only for those
    5 minutes.
- **No tracking** on `/menu/` or `/admin/`: no Meta pixel and no analytics.
  Both are `noindex`.

## The pages

- **Separate Vite entries** (`menu/index.html`, `admin/index.html`), so the
  guest page never downloads the website's code. It loads about 90 KB
  gzipped in total, the whole menu included, and nothing from Sanity.
- **The guest page is Bulgarian and English.** The site's Romanian visitors
  get English. The staff page is Bulgarian only.
- **Table numbers and codes use the sans-serif face.** In Cormorant, "11"
  reads as "II".
- **A test clock** (`X-Test-Now`) works only when the server runs with
  `RAYA_QR_TEST=1`, which the live site never sets.

## Left out on purpose

- **Online payment.** Payment stays with staff, as today.
- **Kitchen printer or kitchen display.** The staff page is the one place.
- **Per-person accounts, reports and exports.** Orders are kept in the
  SQLite file, which can be downloaded over FTP if a report is ever needed.
- **Per-seat ordering, splitting bills and tips.**
