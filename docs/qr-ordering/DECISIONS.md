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

## Paying on the phone (Stripe), added 28.09.2026

**Why.** At big events there are too many guests for the waiters to reach
everyone. Ordering from the phone already saves the trip to take an order;
paying on the phone saves the trip to collect the money.

**Why it's per evening, and why paying staff is the default.** On normal
restaurant nights a waiter is at the table anyway, and a card fee on a coffee
is a poor trade. The staff screen switches it per evening. It can only be
switched on while Stripe is configured, and without keys everything falls back
to paying staff.

### Stripe, and how much of it

- **Why Stripe:** Checkout is Stripe's own hosted page, so no card data touches
  our shared host. Apple Pay and Google Pay come with it, test mode lets us
  rehearse with fake cards, and Stripe works in Bulgaria. The alternatives
  were myPOS (only worth it if its terminals were already in use) or a bank's
  online terminal through Borica (cheaper per payment, more paperwork and a
  clumsier integration).
- **No Connect.** Connect is for platforms passing money between businesses.
  RAYA Garden sells its own services, so one account is enough. If the hotel
  and the restaurant are separate companies, the simpler answer is one Stripe
  account per company, not Connect.
- **Hotel bookings stay in Clock** (its booking engine takes the payment).
  **Event deposits** need no code: an invoice or payment link from the Stripe
  Dashboard. Whether a Stripe invoice can serve as the Bulgarian фактура is
  the accountant's call.
- **No SDK.** The host runs PHP 7.3 without Composer, so `_lib/pay.php` calls
  the REST API with cURL. That is three calls, pinned to API version
  `2026-08-26.dahlia`.
- **A restricted key** (Checkout Sessions and Refunds, write), never the full
  secret key. It is stored like the staff password: a GitHub secret, written
  above the web root by the deploy, and never in the code.

### Rules the code keeps

- **Only Stripe's signed webhook marks an order paid**, never the guest
  returning to `?paid=`. A guest can pay and then lose signal before the page
  loads.
  - The signature (HMAC-SHA256) and its age (5 minutes) are checked.
  - The amount paid must equal the order's total.
  - Each event is applied once: its id is stored in the same transaction as
    its effect.
- **Staff never see an unpaid order.** It waits as `pending_payment`, so
  nobody cooks what nobody paid for. If the payment never comes (1 hour), it
  ends as `expired`.
- **One Checkout Session per order.** It uses a Stripe idempotency key per
  order and an expiry fixed from the order's own time. A retry after a lost
  answer therefore sends identical parameters and gets the same session, and
  pressing *Плати* twice charges once.
- **Prices come from the stored order**, not the phone, with line items so the
  guest sees what they are paying for. No `payment_method_types`: the methods
  are chosen in the Stripe Dashboard.
- **A refund comes before the cancellation, not after.** If the refund fails,
  the order stays uncancelled and staff retry; nobody is left believing a
  guest was refunded. One refund per order, even when two tablets press at
  once.
- **A slow Stripe must not stall other orders.** The Stripe call happens
  outside the database's write lock, and every read closes its cursor before
  anything slow.
  - Found in testing: an open read cursor made two tablets deadlock ("database
    is locked").
  - Left in, it would also have let a slow Stripe answer hold up every other
    table's order.
  - Both cases are tested, and the tests fail without the fix.
- **The till (Clock) can't be reached**, so "За касата" is a shared checklist.
  Paid orders are entered by hand; refunds of already-entered orders are
  flagged for voiding there.

### Not done, on purpose

- **A per-order choice** between paying on the phone and paying staff. The
  evening decides, which keeps the staff screen unambiguous.
- **Tips.** Splitting a bill came later, by line: see "Pay at the end".
- **Checking the payment path against real Stripe** was left to the owner's
  own test mode, not a throwaway sandbox. Creating one needs an email address
  to register it under, and none was right to use without asking. The fake
  Stripe in `tests/qr/fake-stripe.mjs` follows Stripe's documented behaviour,
  including idempotency, signatures and async payments.

## Pay at the end: the table's bill, added 29.09.2026

**Why.** Birthdays and parties: everyone orders from their own phone during
the evening, and at the end one person pays for everyone, or each pays their
own. Paying before each order (the "on the phone" mode) does not fit that.
Paying staff does, but costs the waiter the trip.

**How.** A third mode per evening, `tab`.

- **One bill per table and evening.** Orders go straight to staff and join
  their table's bill.
- **Guests pay from the bill.** "Сметка" in the menu lists the whole table's
  lines; the guest ticks some and pays them with Stripe Checkout.
- **Staff mark the rest.** Whatever is paid in cash or at the terminal, staff
  mark "Платено на място", then close the bill.

### Choices made

- **The bill is visible to anyone who picks the table.** The table itself is
  self-declared, so a stricter gate would only lock out the birthday host who
  didn't order on their own phone.
  - The bill shows items, quantities, prices and the name a guest chose to
    give when ordering; never notes, payers' names or internal ids.
  - Paying for someone else's line harms nobody.
- **A line is the unit.** "2 × beer" is paid by one person. Splitting a line
  would need quantities per payer and a much busier screen for a rare case.
- **"Yours" = ordered from this phone.** The phone knows its own order codes.
  Its own unpaid lines are ticked when the bill opens; "Избери всичко" is one
  tap.
- **No locks; the first confirmed payment wins.** Locking a line while
  someone is on Stripe's page would block others: for 30 minutes at least,
  Stripe's shortest session. Anyone could also lock a table's bill by starting
  a payment and walking away.
  - Instead, a line being paid shows "плаща се от друг телефон", and nothing
    stops a second person.
  - Whichever payment Stripe confirms first gets the line; the other payment's
    share is owed back and refunded at once (a partial refund).
  - A real double payment needs two people paying the same line within
    seconds, and even then costs nobody anything.
- **Money owed back is tracked, never assumed.** A bill payment keeps
  `refund_due` (lines paid twice, or cancelled after payment) and `refunded`
  (what Stripe returned). A refund that fails stays owed and visible on
  **Сметки** until *Върни сега* succeeds.
  - Each refund's idempotency key names the amount already refunded. A retry,
    or two tablets pressing at once, therefore makes one refund, and the
    stored total only moves if nobody moved it meanwhile.
- **Cancelling an order on a bill cancels at once, then refunds.** This
  differs from the "on the phone" mode, where the refund comes first. An
  order on a bill can be paid in parts by several people, so its refunds are
  owed and retried rather than all-or-nothing.
- **Paying works after ordering closes.** People pay at the end, sometimes
  after the kitchen has stopped taking orders. Bills belong to an evening
  (the service date), so tomorrow's table 7 starts clean.
- **Closing needs nothing left to pay.** "Платено на място" first, then
  "Затвори сметката". An unpaid remainder can't be closed away by accident.
- **The till gets payments, not lines.** Each bill payment (`P-…`) is entered
  in Clock at its net amount, after what was owed back. A refund after entry
  is listed to void, for the difference.

## Names on orders, added 01.10.2026

**Why.** At a busy event, "R-7K3M for table 4" doesn't tell the waiter which
of eight people it is for, or who paid.

**How.** Two names, both optional, both shown only where they help:

- **The guest's own name.** An optional field "Вашето име" when sending an
  order (40 characters; the phone remembers it for the tab). It goes on the
  order card on the staff screen and, on a "pay at the end" evening, next to
  each line of the table's bill, so everyone finds their own.
- **The payer's name from Stripe.** Stripe's payment page asks for the
  cardholder's name. The webhook copies `customer_details.name` onto the paid
  order or bill payment; staff see "платил: …" and the till list carries it.

### Choices made

- **Nothing is required.** A guest who gives no name orders exactly as
  before. A payment usually carries a name (the name on the card or in the
  wallet); when Stripe has none, the card simply shows none.
- **The payer's name stays with staff.** Guests' pages never return it
  (`order-status.php`, `bill.php` drop it), so another phone at the table
  can't learn who paid with which card.
- **Names are erased after 3 days** (`QR_NAME_DAYS`). The orders and amounts
  stay for the accounts. The erasing runs on the busy write paths (placing
  an order, starting a bill payment), so it needs no cron job.
- **The email Stripe collects is never stored.** Stripe keeps it for its
  receipt; the venue doesn't need it.
- **Names are cleaned, not trusted.** Control and formatting characters are
  removed and spaces collapsed; a name over 40 characters is refused rather
  than cut silently. React escapes it on every screen.
- **The name is not part of the order's fingerprint.** A resend under the
  same idempotency key returns the original order, name and all, instead of
  being refused as a different order.
- **The privacy policy says so.** It lists orders from the table, the two
  names, the 3 days and Stripe as a recipient; the cookie policy lists the
  menu's tab storage and the staff cookie.

## One line off, tips, 100 ml, added 01.10.2026

### Taking one line off an order

**Why.** One thing missing from a six-item order used to mean cancelling all
of it (a full refund) and ordering again.

**How.** "Няма" on a line of the order card: how many (for "3 × mojito"), a
reason the guest sees, then confirm. The line keeps its quantity;
`void_qty` says how much of it is off, and the order's `void_cents` what
that came to.

- **The money follows the payment mode.** Paid to staff: the total shown
  drops. Paid on the phone: that amount is owed back (`refund_due_cents`)
  and refunded at once. On a bill: off the bill if unpaid; owed back to
  whoever paid it if paid on a phone; "hand back X" to staff if paid on the
  spot.
- **Off first, refunded after, retried until done.** A whole cancelled order
  is refunded before it is cancelled (so it is never cancelled unrefunded).
  A single line works the other way, as bills already do: the line is off at
  once, and a refund that fails stays owed on the card with *Върни сега*. A
  kitchen that has run out shouldn't wait on Stripe. The refund's
  idempotency key names the amount refunded before, so a retry or two
  tablets make one refund.
- **"have" guards the race.** The request says how many the screen showed.
  If another tablet changed the line first, the answer is 409 and nothing
  happens.
- **The last thing left can't be taken off**: that is cancelling the order,
  with its own reason and its own full refund.
- **The till keeps a running total.** `till_cents` is what was entered,
  `till_void_cents` what was voided since. Anything the entry is above the
  net amount is to void, so a second line taken off after the first void
  shows up again, for its own amount. This now holds for bill payments too.

### Tips on the bill

- **Only on the bill**, where the guest pays at the end. Paying "on the
  phone" happens before the food arrives, which is the wrong moment to ask.
- **Off by default.** "Без" is preselected; 5, 10 and 15 % are rounded to 10
  cents, and an amount of one's own is allowed up to what is being paid
  (and 500 €), to catch a slip of the finger.
- **A separate line on Stripe's page** ("Бакшиш за екипа"), and kept apart
  (`tip_cents`) from the amount the bill payment covers. The till entry is
  the bill without the tip; the tip is shown beside it, and the day's card
  tips are totalled on **За касата**.
- **A tip for nothing goes back.** Refunds cover lines first; when nothing
  a payment paid for still stands (another phone paid first, or staff took
  it all off), the tip is refunded with it (`qr_bill_owe`).

### Menu

- **Every 50 ml spirit also comes as 100 ml**, at twice the price, as a
  second variant. `std` stays the 50 ml id, so carts and links from before
  still work.
- **Coca-Cola products** offer what the bar stocks: Coca-Cola, Zero,
  caffeine-free, Fanta, Sprite, tonic and pink tonic. Bitter Lemon and soda,
  from the printed menu, are gone from the phone.
- **Sizes say themselves once.** Bulgarian size labels use Cyrillic units,
  so the menu no longer shows "400 ml · 400 мл"; Stripe's page adds the size
  only when the label doesn't already say it.

## A thank-you screen, and no more black screens, added 01.10.2026

- **Back from Stripe's page, a screen of its own.** It says "Потвърждаваме
  плащането…" until the server has Stripe's signed confirmation (coming back
  proves nothing by itself), then "Благодарим!" with the code, the table and
  what was paid, and "Обратно към менюто". For a bill payment it also says
  whether the table's bill is now settled or how much is left. After two
  minutes without a confirmation it says where the payment will show up.
  Backing out of Stripe's page still opens the order or the bill as before.
- **A staff answer never takes fields away.** Ticking a bill payment in the
  till list blanked the staff screen: the answer carried the payment without
  its lines, the screen replaced what it held, and drawing the list threw.
  Every staff answer about a payment now carries its lines
  (`qr_bill_payment_staff_json`), and the screen lays an answer over what it
  holds rather than replacing it.
- **If a page still throws, it says so.** Both pages sit inside an error
  boundary: "Нещо се обърка" and a reload button, instead of a black page
  in the middle of service. Orders are on the server either way.

## Kitchen and bar, added 01.10.2026

**Why.** Food and drinks are made in two places by different people. One
card for "Цезар + 2 Sprite" made the bar wait for the kitchen's "Приеми" and
the kitchen read the drinks.

**How.** A station per menu category (`"station"` in qr-menu.json), copied
onto each line when ordered (`order_items.station`), and a status per
station on the order (`kitchen_status`, `bar_status`, '' when it has nothing
there).

- **Two cards, one order.** Each station accepts and serves its own part;
  the order's own status — what the guest sees, and what bills and the till
  go by — follows from them (`qr_overall_status`): new until a station takes
  it on, served when every station still making something has served.
- **A tablet chooses what it shows** (Кухня / Бар / Двете), stored on the
  device, and chimes only for that. "Двете" keeps them apart: kitchen
  column, bar column.
- **Cancel is per station too.** "Откажи" on the bar's card takes every bar
  line off (as "Няма" would, with its refunds) and leaves the kitchen's part.
  When the station is all that is left, it is the whole order's cancel, with
  its full refund first. A station whose lines all came off is 'cancelled'
  and stops counting.
- **Old screens keep working**: a move without "station" moves the whole
  order and every station with it.
- **Existing orders** got the station of each item as the menu has it, and
  their own status for each station (schema v6).
- Coffee and tea are the bar's; desserts the kitchen's.

## Waiters per table, and closing times per station, added 01.10.2026

- **Waiters belong to the evening.** `waiters (evening, table_no, name)`;
  the staff screen gets tonight's list with every poll and shows the
  table's waiter on each card and bill of tonight (`orders.evening`). A new
  evening starts empty; each evening's list is kept as it stood at the end,
  for the history (since 02.10.2026 — before that, saving deleted earlier
  evenings' lists). Changing
  a table's waiter shows at once on every card for it — the name is looked
  up, not copied onto orders.
- **Saved whole, at once.** Each tap on a table sends the full list, so the
  last save wins and nothing is half-applied; a poll already on its way
  while a save is pending is not allowed to put the old list back.
- **The tablet keeps the names it has seen**, as suggestions, in its own
  storage.
- **The kitchen and the bar close on their own.** `kitchen_closes_*` and
  `bar_closes_*` in settings; `closes_*` stays the later of the two, the
  end of the evening as a whole. Ordering is open while either station is;
  a line for a closed station is answered like a sold-out item ("changed",
  `stationClosed`), so the guest sees exactly what was taken out before
  anything is sent. "closes" alone still sets both.

## History of past evenings, added 02.10.2026

**Why.** Every order was already kept, but only tonight's could be seen.
"История" reads any evening back, and exports CSV for a spreadsheet.

- **Read from the orders, not saved as a separate report.** Nothing is
  deleted, so a report is worked out when asked for (`_lib/history.php`):
  one query per kind of row, under the `orders (evening, created_at)`
  index. No nightly job to miss, nothing to fall out of step — a refund or
  a line taken off later shows in that evening's figures. A frozen
  end-of-night total is the till's job (Clock), not this system's.
- **The evening is the unit**, as everywhere else: an order at 00:40 belongs
  to the evening before. Orders from before `orders.evening` existed (v7)
  got one in v8: the Sofia date six hours before they were placed.
- **How it was paid, from what the system knows.** To staff (orders on a
  "pay staff" evening, bill lines settled on the spot — cash or terminal,
  which it cannot tell apart), by card on the phone (after refunds owed),
  and still unpaid on a bill. The three add up to the sales; tips are
  apart. Tests check the sum on all three payment modes.
- **A waiter is the table's waiter at the end of the evening.** The name is
  looked up, as on the live screen; the list can change mid-evening, and
  copying it onto orders would only move the question.
- **CSV, not .xlsx.** Excel in Bulgarian opens it with the right columns
  and numbers (BOM, ";", decimal comma); no library on a PHP 7.3 host. A
  cell that begins like a formula (`=`, `+`, `-`, `@`) is written as text —
  a guest's note is guest input.
- **No names in the files.** The database erases names after 3 days; a
  downloaded file would keep them for good. Staff see names on screen
  within those 3 days, as they do on the live screen.
- **Staff only, the same password.** Everyone with the staff password sees
  the takings. Separate manager access would need accounts — left out, as
  below, until it is needed.
- **Backups stay with the host.** The SQLite file is outside the site, so
  deploys never touch it, and the host's account backups include it. Monthly CSV
  downloads are the copy kept elsewhere. Copying the database to GitHub or
  e-mailing it would send guests' data to more places; not done.

### The monthly summary by e-mail, added 02.10.2026

**Why.** The venue asked for a monthly summary rather than a daily one: the
month's figures and both files in the inbox, without opening the tablet.

- **Sent by the staff screen's own poll, after its answer.** No cron job to
  set up in SPanel: the first poll from 06:00 on the 1st (Sofia) sends last
  month's summary, once `fastcgi_finish_request` has handed the tablet its
  answer. A tablet opened on the 1st is all it needs; a day with none sends
  it the next time one is. 06:00, so the last evening of the month (and
  orders after midnight) are in it.
- **Once, and safe from two tablets at once.** The send is claimed inside
  the write lock (`report_mails`, status 'sending'); a second poll sees it
  and does nothing. A month already sent, or without orders ('empty'), is
  not looked at again; the check on every poll is one indexed read, and
  only while an address is set.
- **Failures are visible and retried.** A refused send is logged with the
  mail server's reason and tried again an hour later, up to 6 times. Staff
  see every attempt under the address.
- **"Send now" tests the address**, and sends any month — one not over yet
  says "до <date>" and does not count as that month's report, so the real
  one still goes on the 1st. At most 5 an hour, so the button cannot flood
  an inbox.
- **The host's own mail, or SMTP if set up.** rayagarden.bg's mail is on the
  same server and its SPF allows it, so PHP `mail()` needs no account or
  password. `raya-mailer-config.php`, if present, switches it to SMTP.
- **The same figures as История, and no names.** Built from
  `qr_history_figures` over the month; the attachments are the export's own
  CSV files. An HTML version and a plain-text one, for any mail program.
- **Staff set the address.** Everyone with the staff password sees the
  takings anyway (a choice made on 02.10.2026), so the address sits with the
  rest of История.

## Tips when paying an order, and the menu's section jump, added 03.10.2026

### A tip with an order paid on the phone

**Why.** Guests could tip when paying a table's bill, but not when paying
as they order.

- **The same rules as the bill's tip.** Optional, none to start with; 5, 10,
  15 % (rounded to 10 cents) or an amount of the guest's own, at most the
  order and 500 €. One picker for both (`src/qr/menu/Tip.jsx`).
- **Its own line on Stripe's page** ("Бакшиш за екипа"); the session's and
  the webhook's amount checks expect the order plus the tip
  (`orders.tip_cents`, schema v10).
- **Apart from the till.** The till amount stays the order's own (`net`);
  the tip shows beside it, on the card, and in the day's card tips.
- **Given back only with the whole order.** One line taken off refunds that
  line; cancelling the order refunds everything (Stripe's full refund), and
  the order's refund figures say so (`refund_due = refunded = total + tip`).
- **Part of what the guest asked for.** The tip is in the order's
  fingerprint: the same Idempotency-Key with another tip is refused as a
  different order, and the phone makes a new key when the tip changes.
- **Only where money is taken.** On a "pay staff" or "pay at the end"
  evening a tip sent with an order is ignored — the phone takes no money
  then, so nothing could be added to.
- **История and the files count it**: in the evening's and month's card
  tips, and in the payments file's tip column.

### The menu's section jump

**Why.** Tapping a tab far down the menu could leave the guest a few
sections short on their phone.

- **The cause.** A long smooth scroll on a phone can be cut off part-way —
  by a flick still running, or by another scroll starting. The tab bar
  started one itself: it re-centred the highlighted tab with
  `scrollIntoView`, which also scrolls the page.
- **The fix.** The tab bar scrolls only itself, sideways. The tapped tab
  stays highlighted while the page moves. When the page has stood still for
  a moment, the jump checks where the section is and finishes it if it fell
  short. The guest touching the page ends the jump at once.
- **Tested** by cutting the scroll off on purpose: the old menu stopped in
  the starters on the way to the beer; the new one lands on the beer.

## The guest's e-receipt, added 07.10.2026

**Why.** A guest who pays on the phone gets Stripe's receipt, which is not
a fiscal document, and nothing from a till. Another QR-ordering place sent
the owner an „Електронна бележка“ by e-mail: the document Наредба Н-18 lets
an e-shop issue for card payments made at a distance. Stripe can't make it
(no unbroken numbering, no QR code), so it is our own code, built test-only
until the accountant decides.

- **Issued where the payment is confirmed**: in the webhook's transaction,
  with the order going to staff, so there is exactly one document per
  payment however often Stripe repeats itself. Its lines are frozen
  (`ereceipts.lines_json`, schema v11): a later menu change doesn't alter
  an issued document.
- **One unbroken series**, numbered inside the write lock (`MAX + 1`, with
  a unique index). Test documents have their own series, so the first real
  one is 0000000001.
- **A storno for money that actually went back**, issued in the refund's
  own transaction: a failed refund issues nothing until the retry works.
  Its lines are the ones refunded where they add up to the amount (a line
  taken off, the rest on cancelling, a line paid twice on a bill), else one
  line "Върната сума". A full refund in Stripe's Dashboard is covered;
  a partial one made there is not (make it from the tablet instead).
- **VAT per tax group, on the group's total**: rounded once, so the net and
  VAT add up to what was paid. Unit prices without VAT are shown rounded.
- **The order number is `R-4K7Q-12`**: the code the guest and staff know,
  plus the order's id, because the short codes repeat after two days.
- **The QR code is drawn here** (`_lib/qrcode.php`): byte mode, level M,
  versions 1–10, after Nayuki's reference encoder. The host has PHP 7.3 and
  no Composer. Tests read it back with zbarimg.
- **E-mailed after the answer**, like the monthly summary
  (`fastcgi_finish_request`): Stripe's webhook and the tablet never wait
  for a mail server. The QR code and the logo are inline pictures
  (`multipart/related`), which mail programs show; `data:` images they
  don't.
- **The address**: from Stripe's page (`customer_details.email`), used for
  this only, erased after 3 days like names. The privacy policy says so.
- **Not built yet**: the monthly audit file for НАП (Appendix 38). It is
  needed before `'live'`, here or through a service such as Take a NAP.

**Switched off, 12.10.2026.** The e-shop rules cover sales made at a
distance; RAYA's guests order and pay at the table, so the restaurant isn't
an e-shop and this document can't stand in for the fiscal receipt.
(Randevue's „Електронна бележка“ was for its own service fee, which it does
sell at a distance.) `'mode' => 'off'`, and the privacy policy is back to
"the payment page's e-mail is not kept". The code and its tests stay, unused.
Instead, phone payments are to be sent to Clock through its API: a POS
bill with the lines, paid and closed, which Clock fiscalises on the
restaurant's printer. Clock later withdrew that (15.10.2026); what was
built instead is under "Phone payments into Clock PMS+" below.

## Phone payments into Clock PMS+, added 14.10.2026, reworked 16.10.2026

**Why.** Guests pay at the table, so their fiscal receipt has to come from
the till: Clock. Staff used to retype every phone payment into Clock from
„За касата“. Now the items go into Clock by themselves (`_lib/clock.php`),
and staff only add the card payment and close the folio, which prints the
receipt.

**How it got here.**
- **The first build (14.10)** sent the whole sale: the folio, the items, the
  card payment, and `close` with a fiscal document type, so Clock would
  fiscalise it unattended. The sandbox took all of it. Clock's first answer
  (15.10) said such a close sends the receipt to the fiscal printer.
- **Clock's second answer (15.10)** withdrew that, once they understood the
  money is taken by our Stripe and not by them:
  - bills paid on the spot are ours to collect and fiscalise;
  - only charges transferred to a room or a company are theirs, fiscalised
    when reception issues the document;
  - production access needs a certification first.
- **So (16.10)** this system only transfers the items onto a company folio,
  Clock's charge-transfer way. A person in the restaurant takes it from
  there: adds the card payment, closes the folio, and Clock prints the
  receipt as for any folio closed at the till. The API payment, `close`,
  the document types and the correction-folio storno were all removed;
  none of them was ever live. Whether this passes Clock's certification is
  asked and not yet answered.

### Choices made

- **One folio per payment.** Each guest's payment gets its own receipt. The
  folio's total (items + tip) is exactly what the guest paid by card, so the
  waiter enters one amount, and „За касата“ shows it.
- **The tip goes in the folio**, as a surcharge with no VAT (Clock's guide),
  so the card amount matches. Like everywhere else, it stays out of the
  amount ticked on „За касата“.
- **Queued with the payment, sent after the answer.** The `clock_docs` row
  (schema v12) is written in the same transaction that marks the payment
  paid, or records the refund. Sending happens after the webhook or tablet
  has its answer: Stripe never waits on Clock, and Clock being down never
  fails a webhook.
- **Retried by the staff screen's poll**, like the e-receipt and the monthly
  e-mail: no cron job. The waits are 1 min, 5 min, 15 min, 1 h, 3 h, then it
  stops at `failed` with Clock's reason, and *Опитай пак* starts it again.
- **Exactly once, without idempotency keys.** Clock's API has none, so:
  - a row is claimed before it is sent;
  - each step is saved as soon as Clock answers, and a retry continues from
    the next step;
  - items whose answer never came back are first looked up in Clock by their
    `print_text` ("QR R-7K3M #12");
  - if Clock can't be asked (no right to read charges), the row stops at
    `check` for a person rather than risk the items twice.
- **No reused connections** (`CURLOPT_FORBID_REUSE`). Found in testing: when
  a reused keep-alive connection broke after Clock did the work, curl sent
  the same POST again by itself. A fresh connection per call makes a lost
  answer come back as lost, and it gets looked up instead.
- **Refunds.** While the folio is open, the items that went back go onto it
  at a negative quantity (Clock's guide: "VOID / Refund of transferred
  charges"), so the waiter closes it at what was actually paid. Once it's
  closed (Clock's `closed_at`, or staff ticked "Затворих го"), the receipt
  is printed, so nothing is sent: the storno is done in Clock by hand, from
  "Сторнирай в Clock".
- **The same lines as the e-receipt.** `qr_ereceipt_paid_lines()` and
  `qr_ereceipt_returned()` give a sale's lines and what went back, so the
  two can never disagree.
- **Templates by category, not by dish.** 172 dishes in 25 categories, and
  Clock wants a few templates for its reports and accounting codes. Each
  charge carries the dish's own name. Clock advised putting every fixed
  attribute in the template and sending only what varies: price, quantity,
  name, print text. A payment with an unmapped line isn't sent, and says
  which category it's missing.
- **„За касата“ stays the fallback.** Items in Clock tick the payment as
  entered, and it moves to "Затвори в Clock" with the card amount. A tick by
  hand before a row was sent means it is never sent (`manual`). While a row
  is being sent, or once Clock has it, a tick or untick by hand is refused,
  so nothing is entered twice.
- **Test and live never mix.** `clock_mode` `test` sends only payments made
  with Stripe's test keys, `live` only real ones.
- **Credentials like Stripe's**: GitHub secrets (`QR_CLOCK_*`), written into
  `raya-qr-config.php` above the web root by the deploy, checked for their
  form, and never printed.

### Found in testing on this Mac (the harness, not the system)

- PHP 8.5 deprecates `curl_close()`, which 7.3 still needs. The PHP dev
  server printed the notice into the JSON answers. The test server now logs
  notices instead of showing them.
- The dev server's workers outlived it on macOS and kept the test files
  from ending. They now run in their own process group.
- OPcache served a settings file the tests had just rewritten, so it's off
  in tests.

### Still open

- **Clock's OK and the certification.** Clock gives access to the real
  account only after a certification meeting. The brief for it is
  `CLOCK-CERTIFICATION-BG.md`.
- The live account (hotel 15003): its API user, the company for these
  folios, and the real charge templates and their VAT. Folios made through
  the API come back `tax_mode: "no_tax"` in the sandbox.
- With the accountant: whether the tip belongs in the folio, and so on the
  receipt.

## Fiscal receipts on our own printer, added 19.10.2026

**Why.** Clock's last word (19.10.2026): bills paid on the spot are ours for
the payment, the fiscal receipt and the kitchen. Their POS isn't to receive
them, not even as items for staff to close. The only things Clock takes are
charges to a hotel room, and bills already paid and fiscalised, transferred
at the end of the day for its reports. So phone payments get their fiscal
receipt here, on a printer of their own.

### Choices made

- **A printer of its own**, not the one Clock drives: two programs on one
  fiscal printer would fight over it.
- **A bridge that pulls.** The site is on shared hosting and can't reach into
  the restaurant, so a small computer there asks for work every 3 seconds and
  needs only outgoing connections. Its key travels in `X-Raya-Bridge-Key`,
  because Apache under PHP-FPM often drops `Authorization` before PHP sees it.
- **ErpNet.FP**, not a printer protocol of our own. It's open source,
  supports the Bulgarian printers (Datecs, Daisy, Eltrade, Tremol…), and has
  idempotent asynchronous printing.
- **Exactly once on paper.** A second fiscal receipt can only be undone with
  a storno, so:
  - the server is told "submitted" before the receipt goes to the printer;
  - the bridge writes "maybe sent" in its journal before sending, and the
    printer's answer after;
  - ErpNet.FP prints by our task id, and a try after a failure gets a new id
    (the same id would hand back the old failure instead of printing);
  - the answer is reported from the journal, because ErpNet.FP forgets a
    task's result after a restart or once it's read;
  - when no one can tell, the receipt stops at `check` for a person, and is
    never printed again by itself.
- **The УНП** is `<printer serial>-<operator code>-<7-digit sequence>`. The
  server keeps the sequence, the bridge adds the serial it reads from the
  printer. A storno carries its sale's УНП, as ErpNet.FP requires.
- **The tip is a line on the receipt**, so the receipt's total is what the
  card paid. Its tax group, and whether that's right at all, wait for the
  accountant (`FISCAL-QUESTIONS-BG.md`).
- **The same lines and refunds as Clock and the e-receipt**: the storno
  calculation moved into one function (`qr_storno_due`), used by both
  `clock_docs` and `fiscal_docs`.
- **„За касата“ stays the fallback**, with the same rules as for Clock: a
  printed receipt ticks itself, a tick by hand stops one not yet printed, and
  no tick or untick is accepted while it's printing or once it's printed.

### Added 20.10.2026

- **Reports from the tablet.** Z, X and "duplicate of the last receipt" are
  requests the bridge picks up like receipts: claimed, sent under our task
  id, looked up rather than sent twice. A Z report closes the day, so it
  waits while any receipt is still pending, claimed or sent. One asked twice
  is one report.
- **The operations log** (`audit_log`) is written by SQLite triggers, not by
  PHP, so nothing escapes it, and triggers also refuse UPDATE and DELETE on
  it. Plain SQL only, because the host's SQLite (3.26) may lack JSON
  functions. No names, since they're erased after 3 days elsewhere.
- **„За касата“ for entering by hand**: items as they go into the till (qty ×
  name, unit price, line total), and a chime and blinking tab when a new
  phone payment arrives. Found in testing: with nothing on the list at load,
  the first new payment was counted as already seen. The baseline is now
  taken when the first poll returns.

### Still open

- **22–23.10.2026:** the accountant's answer. In a site that uses a "СУПТО",
  every fiscal device must be driven by a registered "СУПТО" (чл. 52з,
  ал. 3), so this printer can't be used while our program is unregistered.
  Two registered programs in one site appear to be allowed (Annex 29, т. 9;
  чл. 52з, ал. 9), so registering ours wouldn't mean dropping Clock. That
  reading waits on the accountant. The gap against all 23 points of Annex 29,
  the registration and the effort: `SUPTO-ANNEX29.md`.
- **29.10.2026: confirmed.** Two "СУПТО" may work in the restaurant, each
  with its own fiscal printer, provided our sales are also passed to Clock so
  the turnover is in one place. Plan: `SUPTO-ANNEX29.md`.
- **Whether this makes our system "СУПТО"** under Наредба Н-18 (Annex 29).
  If it does, there's more to build: the full УНП rules, a log of every
  operation with nothing deleted, the audit file for НАП, and the producer's
  registration. It's the accountant's call, and it comes before live receipts.
- The printer model, its registration, and a training mode to test in
  (questions for the service company).
- The end-of-day transfer to Clock, after their certification. It reuses the
  folio, charges, payment and close of the first Clock build.

## No tips through the system, 19.10.2026

The accountant: no tips of any kind through this system. So tips are off
by a setting (`'tips' => 'on'` in `raya-qr-config.php`, from the `QR_TIPS`
secret, brings them back), not removed:
- `state.php` tells the menu, which then shows no tip choice;
- `order.php` and `bill-pay.php` drop any tip a page still sends, so a guest
  can never be charged one, even from a page loaded before the change;
- with no tip, no fiscal receipt has a tip line.

The tip code and its tests stay (the test server switches tips on).

## Staff accounts and the УНП at entry, 29.10.2026 (СУПТО phase 1)

The accountant confirmed two СУПТО may share the restaurant (each its own
printer, our sales also passed to Clock), so the plan in `SUPTO-ANNEX29.md`
started. Phase 1:
- **Personal accounts** (Annex 29 т. 6–7, чл. 52л): code, names, password,
  roles waiter/manager/auditor with from/to dates (`staff`, `staff_roles`,
  schema v15). Never deleted (triggers refuse). The cookie is bound to the
  person's password hash, and their state and roles are checked on every
  request, so making someone inactive, ending a role or changing a password
  signs them out at once.
- **The shared password** stays only as a way in until the first manager
  exists. Simpler than seeding an account from a GitHub secret, and the
  live site keeps working on deploy day.
- **The operator on every log row** is set by the database, not the code:
  `qr_write()` writes the current operator into `audit_actor` first thing
  in the transaction, and the triggers copy it. A code path that forgets
  can't leave a row without one; the default is "Система".
- **Guests are operator 9001** (the УНП's middle part: guests enter the
  sales); 9000 the system, 9002 the shared password.
- **The УНП when the sale is entered**, not at payment: the order on a
  phone-payment evening, the bill on a pay-at-the-end evening. One counter
  per printer serial. A printer not seen for 2 hours → given at claim, so
  printing never waits on it. Phase 2 will block ordering instead.
- **Pausing stays with everyone**; the rest of „Вечерта“ is a manager's.

## Printer readiness and its clock, 29.10.2026 (СУПТО phase 2)

- **Ready** = the bridge heard within 90 s (its poll is every 3 s), the
  printer without errors, its clock within 5 minutes. Not the 2 hours
  Annex 29 allows for the УНП: that's how old the printer serial may be,
  not whether a receipt can print now.
- **On a bill evening only new bills and payments wait**; orders onto an
  open bill are part of a sale already opened, and stopping the kitchen
  over a printer would be worse for guests than the law asks.
- **The clock follows the bridge computer**, not the server: the computer
  is beside the printer and on NTP; the server's clock is compared and only
  warned about. The 30 s / 5 min thresholds are ours; a printer that refuses
  a new time before its Z report is reported, not forced.

## The log screen and НАП's tables, 29.10.2026 (СУПТО phase 3)

- **A sale is what has a УНП**: an order paid on the phone, or a bill.
  Pay-staff evenings are Clock's sales and don't appear.
- **Cancellations (18.5) come from the operations log**, not from the
  order rows: the log has the time and the operator of each, the rows
  only the result. Same for who caused a storno (18.4): the operator of
  the log row that queued it.
- **VAT is split per line** from the gross price by the tax group's rate,
  rounded per line; the sale's VAT is the sum of its lines'.
- **Amounts in euro**, though the Annex says "лв.": Bulgaria's currency
  since 1.1.2026.
- **18.2 includes what staff took on a bill** (paid via Clock's till), as a
  payment type of its own with no fiscal printer: our sale, Clock's receipt.
  This is open question 1 in `SUPTO-ANNEX29.md` and may change.
- **The nomenclatures are separate tables** (Annex 29 allows alternative
  nomenclature tables of the same scope).

## Card only, and the registered version, 29.10.2026 (СУПТО phase 4)

- **No QR orders paid to staff** (the user's decision): our СУПТО covers
  only card payments on the phone. On a pay-staff evening the QR code is the
  menu; the waiter takes the order in Clock. A setting (`staff_orders`),
  not removed code, so the tests of that flow stay; never with `supto`.
- **Clock takes our sales at end of day** without fiscalising them: phase
  5 can be built once they give the API access.
- **No test mode by a switch** (`supto`), not by stripping code at build
  time: one code base, tested; the registered server simply refuses test
  keys and test printing, and ignores the test hooks. To confirm with the
  accountant.
- **Integrity by manifest**, checked on the staff poll and the guest's
  state (no cron on the host). A failure warns and logs; it doesn't stop
  service: a hosting hiccup shouldn't close the kitchen, and the log keeps
  the proof either way.
- **"Сметка накрая" off with staff orders** (the user, 29.10): staff
  settling the rest of a bill is a payment to staff, so pay at the end
  goes with them; only "pay on the phone" and "Само меню" remain.
- **Menu changes logged by the same check**: the menu file changes only by
  deploy, so comparing it to `menu_items` on each new file catches every
  change with its time; the operator is "Система" (the deploy).

## Left out on purpose

- **Kitchen printer or kitchen display.** The staff page is the one place.
- **Per-seat ordering and splitting one line between people.**
