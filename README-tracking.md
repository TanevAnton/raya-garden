# Meta Pixel — what fires, from where, and how to check it

Pixel `2833505250333119`, initialised inline in `index.html`. **Not in GTM** —
GTM and GA4 are separate installs in the same file and are not involved in any
of this. Events go through code.

## Where the calls live

```
src/lib/metaPixel.js        trackMeta() / useMetaEvent() — every site event
  ├── Layout.jsx            PageView (per route), Contact + PhoneClick (tel: links),
  │                         BookingIntent (any «Резервирай» link)
  ├── Reservations.jsx      BookingIntent (the /book form)
  ├── Hotel.jsx             ViewContent
  ├── Restaurant.jsx        ViewContent
  ├── EventPage.jsx         ViewContent
  ├── Contact.jsx           Lead, EnquirySubmitted
  ├── EventEnquiry.jsx      Lead, EnquirySubmitted (the /events enquiry block)
  ├── QuickCallback.jsx     EventEnquiry, EnquirySubmitted (the configurator's «Обадете ми се»)
  └── WeddingConfigurator   Lead, EnquirySubmitted

index.html (inline script)  the Clock PMS booking funnel, the Clock message
                            listener, BookingCheckoutAbandon
public/api/meta-capi.php    the Conversions API copy of a booking's Purchase
```

The booking funnel is the exception and has to be. Clock's integration script
is `defer`red and only registers a callback that **already exists** when it
runs; a classic inline script in `<body>` is defined during parsing, so it
wins. `/src/main.jsx` is `type="module"` and therefore also deferred, which
would race it. That is why the funnel is not in the React bundle.

## Site events

| Event | Where | Params |
| --- | --- | --- |
| `PageView` | every route change | — |
| `ViewContent` | `/hotel` | `content_type: hotel_room`, `content_ids: ['hotel']`, `content_name`, `lang` |
| `ViewContent` | `/restaurant` | `content_type: restaurant`, `content_ids: ['restaurant']` |
| `ViewContent` | `/event/<slug>` | `content_type: event`, `content_ids: [slug]` |
| `Lead` | contact form | `content_name: 'Contact form'`, `content_category` by topic, `lang` |
| `Lead` | wedding configurator | `content_name: 'Wedding configurator'`, `content_category: 'events'`, `lang` |
| `Lead` | /events enquiry block | `content_name: 'Events enquiry form'`, `content_category: 'events'`, `event_type` (`corporate` / `wedding` / `birthday` / `other`), `lang` |
| `Contact` | any `tel:`, `mailto:`, `viber:` or WhatsApp (`wa.me`, `api.whatsapp.com`, `whatsapp:`) link | `method`, `content_category` by page, `lang` |
| `EventEnquiry` (custom, `trackCustom`) | see below | `method`, `event_type` |
| `BookingIntent` (custom) | a tap on any link to `/book` or to Clock's engine; the `/book` form's button | `page` (the path), `source` (`button` / `search`) |
| `PhoneClick` (custom) | a tap on any `tel:` link — beside `Contact`, not instead | `page` |
| `EnquirySubmitted` (custom) | a form sent and confirmed — never a tap | `source`, `event_type` |

### `BookingIntent` and `PhoneClick`

Added 12.10.2026, so the room campaigns (New Year, autumn weekends) have a
booking signal that does not depend on Clock. Every «Резервирай» button on
the site is a link to `/book` (nav, mobile menu, home page ×2, each room on
`/hotel`, the event pages), and `/book` opens Clock's booking window on the
same page — so no navigation leaves the site and nothing is lost. One
delegated listener in `Layout.jsx` covers them all, and any `/book` link
added later. `source: search` is the `/book` form's «Виж свободни стаи»,
which actually opens Clock: the stronger of the two signals.

A direct link to Clock's engine (`*.clock-software.com/…/pms-wbe…`) counts
as well — there are none today, but one could be pasted into a Sanity page.
In the same tab its navigation is held 150 ms so the pixel's request goes
out first; in a new tab it is left alone.

`PhoneClick` is the phone half of `Contact` under its own name, for a custom
conversion that counts calls only.

### `EventEnquiry`

Every way of asking about an event under one name, so one custom conversion
in Events Manager counts them all. Sent alongside the standard event — never
instead of it — and exactly once per action:

| Action | Sent with | `method` | `event_type` |
| --- | --- | --- | --- |
| /events enquiry form, confirmed by Formspree | `Lead` | `form` | from the dropdown: `corporate` / `wedding` / `birthday` / `other` |
| wedding configurator, confirmed by the endpoint | `Lead` | `form` | `wedding` |
| a contact link tapped on `/events` or any `/event/<slug>` except `nova-godina*` — the mobile bar's «Обади се» included | `Contact` | `phone` / `email` / `viber` / `whatsapp` | `corporate` if the URL has `for=corporate`, otherwise absent |
| a contact link tapped on `/svatben-konfigurator` | `Contact` | `phone` / `email` / `viber` / `whatsapp` | `wedding`, always |

Never on a refused or invalid submit, never from `/contact` (even its
«Сватба или събитие» topic), the New Year pages, `/hotel`, `/restaurant` or
the home page, and not from the mobile bar's «Запитване», which only
scrolls. `isEventEnquiryPage()`, `eventTypeForTap()` and
`trackEventEnquiry()` in `src/lib/metaPixel.js` decide it.

### `EnquirySubmitted`

Added 27.10.2026: real enquiries only, so they can be reported apart from
taps, which `EventEnquiry` counts too. It changes nothing else — `Lead` and
`EventEnquiry` fire exactly as before, and the ad sets keep optimising on
`EventEnquiry`.

| Form | `source` | `event_type` |
| --- | --- | --- |
| wedding configurator, confirmed by `/api/wedding-enquiry.php` | `configurator_form` | `wedding` |
| the configurator's quick callback, confirmed by Formspree | `configurator_callback` | `wedding` |
| /events enquiry block, confirmed by Formspree | `events_form` | `corporate` / `wedding` / `private` (a birthday); absent for «Друго» |
| /contact, confirmed by Formspree | `contact_form` | absent |

Never for a tap, a refused, failed or invalid submit, or a filled honeypot
(on the configurator: the endpoint's all-zero reference). Once per form per
visit — a flag per `source` in sessionStorage — so a resend after a reload
counts once; the callback and the full configurator are two submissions and
count once each.

Since 27.10.2026 every form also holds a `busy` ref from the moment it sends
until it fails, so a double tap is one post and one of each event (before,
it sent the form twice and counted twice); and a filled honeypot fires
nothing at all — /contact used to send it to Formspree and fire `Lead`, the
configurator fired `Lead` and `EventEnquiry` on the endpoint's decoy ok.

### `content_category`

One of `events`, `hotel`, `restaurant`, `nye` — the four ad categories — so
results split the way the campaigns do. `contentCategoryForPath()` and
`contactMethodForHref()` in `src/lib/metaPixel.js` decide it.

| Where | Category |
| --- | --- |
| `/event/nova-godina*` | `nye` (by slug, so next year's page needs no change) |
| `/events`, `/svatben-konfigurator`, any other `/event/<slug>` | `events` |
| `/hotel`, `/book`, the Clock booking request | `hotel` |
| `/restaurant` | `restaurant` |
| contact form topic Резервация / Сватба или събитие / Ресторант | `hotel` / `events` / `restaurant` |
| `/`, `/contact`, `/park`, `/winery`, legal pages; topics Езеро, Друго | none — sent without a category rather than a wrong one |

`method` on `Contact` is `phone`, `email`, `viber` or `whatsapp`. The site has
no Viber or WhatsApp links today; the listener counts them when they appear.

### Nothing fires twice

The pixel is initialised once, in `index.html`. GTM container
`GTM-M5Z8T4VB` carries no Meta tag (no pixel id, no `fbq`, no `fbevents` —
checked 24.09.2026); its tags are GA4 only. Meta's own config for the pixel
has no Event Setup Tool rules. What it does have on is automatic button-click
detection, which sends `SubscribedButtonClick` alongside a `Contact` when a
phone button is tapped — a different event, not a duplicate, and switchable
off in Events Manager → Settings → Automatic events.

Every one carries a UUID `eventID`, so the same conversion sent later by the
Conversions API is deduplicated rather than counted twice.

**`Lead` fires on success, never on click.** The contact form has a mailto
fallback used when no Formspree endpoint is configured; it reports "sent"
after a timer without knowing whether anything was delivered, so it
deliberately fires nothing. `/book` fires no `Lead` either — it opens the
Clock overlay, and `InitiateCheckout` below already covers that.

**Rooms have no pages of their own.** `/hotel` counts as one content item.
The `room` type carries a `slug` that nothing routes on; real `/hotel/<slug>`
routes would give each room its own `ViewContent`, add them to the sitemap,
and retire the dead field. Scoped separately.

## Booking funnel

`window.clockPmsWbePageViewCallback` is called by Clock on each step — **if
Clock sends it.** Clock's integration script calls it only when the booking
window posts it a `track` message (its `postMessageClient.addHandler('track',
…)`); opening the window sends none (checked 12.10.2026: only
`windowLocationRead` / `windowLocationReplace`). Whether the later steps do
is set on Clock's side, and Clock refuses automated browsers (403), so it
can't be checked from here. If Events Manager shows no `Search` /
`InitiateCheckout` / `Purchase` from real bookings, ask Clock to enable the
page-view callback (`track` events) for the website integration of hotel
15003. The completed booking happens inside Clock's window on rayagarden.bg,
so once Clock sends the steps, `Purchase` is reported from our own page.

| `pageName` | Event | Notes |
| --- | --- | --- |
| `rooms` | `Search` | |
| `rates` | `ViewContent` | `content_name`/`content_ids` = `roomTypeName` |
| `extras` | `AddToCart` | same |
| `checkout` | `InitiateCheckout` | `value`, `currency`, `num_items` |
| `completed` | `Purchase` | `content_ids` = booking numbers, `eventID` = `clock-<numbers>` |
| `offer` | `Lead` | `content_ids` = `[offerNumber]` |

All carry `content_type: 'hotel_room'` plus `checkin_date` / `checkout_date`
when present. No `PageView` — `Layout.jsx` already fires one per route and the
overlay does not change the route.

> **`totalPriceCents` is CENTS.** 9900 is 99.00. Sending 9900 would inflate
> reported revenue a hundredfold while looking perfectly healthy in the code,
> which is why `check-meta-events.mjs` asserts the conversion explicitly.

`Purchase` uses a deterministic `eventID` built from the booking numbers
rather than a UUID, so the Conversions API can match the same booking.

### One `Purchase` per booking, three ways to see it

Added 06.11.2026. Clock's iframe talks to the page in postMessages
`{type, id, payload}` from `https://sky-eu1.clock-software.com`. The types it
sends are `track` (the callback's payload, one per step), `windowLocationRead`,
`windowLocationReplace` (the iframe's path, mirrored into `?clock-pms-wbe=`),
`localStorageRead` / `localStorageWrite`, `integrationClose` (its close
button) and `ready`. Read from Clock's own integration script.

A listener in `index.html` watches every message from a `*.clock-software.com`
origin. Clock's listener is untouched and still answers them. A confirmed
booking is reported by whichever of these sees it first:

1. **The callback**, `pageName: 'completed'`: the `Purchase` above, unchanged.
2. **A message**: Clock's `track` `completed`, or any message with booking
   numbers (`bookingNumbers`, `booking_id`, `reservationNumber`,
   `confirmationNumber`, …) and a confirmed status (`confirmed`, `success`,
   `completed`, `booked`, `paid`). The total comes from `…Cents` fields ÷ 100,
   or from `total` / `amount` / `totalPrice` as is.
3. **A confirmation URL**: a path with `completed`, `confirmation`,
   `confirmed`, `success`, `thank-you` or `thanks`, in the iframe's path or on
   this page's own URL when it loads. Booking numbers come from the URL's
   parameters or the segment after `completed/` or `confirmation/`. The price
   comes from the checkout before it.

`rayaClockPurchaseOnce()` sends it once per booking. It keeps the booking ids
sent in sessionStorage (`raya.clock.purchased`), so a repeated `completed`, a
message after the callback, or a reload in the same tab sends nothing more.
Paths 2 and 3 send the same event as 1, with the same `eventID`, plus
`order_id`. If they have no booking number, they key on the checkout in
progress (`raya.clock.checkout`) and send no `eventID`. With neither, they
send nothing. In the real order, the callback runs first: Clock's listener
calls it inside the same message, and the page's own `Purchase` waits a tick.

`content_type` stays `hotel_room`, as on the rest of the funnel. The brief
asked for `hotel`, but `hotel_room` is what is already reported. Changing it
for `Purchase` alone would split the funnel in Events Manager.

### Conversions API

Each `Purchase` with booking numbers and a value is also posted to
`/api/meta-capi.php`, which sends it to Meta server-side with the **same
`event_id`** (`clock-<numbers>`). Meta keeps one copy of the two. The server
copy still arrives when an ad blocker stops the pixel. It carries the guest's
IP, user agent and `_fbp` / `_fbc` cookies, and `custom_data` with
`value`, `currency`, `content_type: 'hotel_room'`, `content_ids`, `order_id`,
`num_items` and the dates.

- **Token:** GitHub secret `META_CAPI_TOKEN` (Events Manager → the pixel →
  Settings → Conversions API → Generate access token). The deploy writes it to
  `meta_capi_token` in `raya-qr-config.php`, above the web root
  (`scripts/qr-server-config.mjs`). Without it the endpoint answers
  `{ok:false, error:'not-configured'}` and sends nothing. The pixel's copy is
  unaffected.
- **Checked, not trusted:** the browser cannot prove a booking, so the endpoint
  only accepts what looks like one. It must be `Purchase`, with an `event_id`
  equal to `clock-` + the `content_ids`, and a value over 0 and at most
  100 000. It must come from rayagarden.bg's origin, each `event_id` is sent
  once within 30 days, and one address may post 10 an hour. Someone could
  still post a made-up booking number. Checking it against Clock's API would
  close that, but needs a Clock API user with read access to bookings.
- **Test Events:** open the site with `?meta_test=TEST12345` (the code from
  Events Manager → Test Events → Server). The server copy then goes to Test
  Events, and is not counted or remembered as sent.

### `BookingCheckoutAbandon`

A custom event (`trackCustom`). It fires when Clock's window closes
(`integrationClose`) after `InitiateCheckout` and before a `Purchase`, once
per checkout, with the checkout's `value`, `currency`, `num_items`, dates
and `eventID: clock-abandon-<checkout>`. It doesn't fire when the window
closes before the checkout step or after a booking. It also doesn't fire when
the guest closes the tab or leaves the page with the window open, because
only Clock's close button tells the page.

### `?debugclock=1`

It logs every message from Clock's iframe to the console as `[clock] <type>`
with its full payload, plus each callback, each `Purchase` sent or skipped,
and the Conversions API's answer. It stays on for the tab's visit, since the
SPA drops the query on navigation. `?debugclock=0` turns it off.

### The callback is shared

It reports to **three** systems: ChatGPT Ads `checkout_started`, GA4
`page_view` + `purchase`, and Meta. The Google half predates the Meta half and
is load-bearing — a naive `window.clockPmsWbePageViewCallback = …` would
silently delete GA4 ecommerce revenue reporting.

Each half runs in its own `try`/`catch`, so a throw in one cannot stop the
other. The Google half in particular calls `params.bookingNumbers.join()`
unguarded, which would throw if Clock ever omitted it.

## Checking it

```bash
npm run build && npx vite preview --port 5200 &
npm run check:meta                  # BASE defaults to :5200
DEV_BASE=http://127.0.0.1:5173 npm run check:meta   # adds the StrictMode check
```

`scripts/check-meta-events.mjs` stubs `window.fbq` before any page script
(the pixel's own snippet starts `if (f.fbq) return;`, so it leaves the stub
alone), walks every route, submits the three forms against stubbed backends,
taps the phone links and the mobile bar on /events and an event page, and
drives the Clock callback through all six steps. It prints
every event with its params and asserts:

- the exact event per route and per funnel step
- `Contact` with the right `method` and `content_category` for phone, email,
  Viber and WhatsApp links, exactly once, and nothing for an ordinary link
- `Lead` with the right `content_category` for each form and topic, exactly
  once — and no `Lead` when Formspree or the wedding endpoint refuses, when
  required fields are empty, or when consent is unticked
- `EventEnquiry` exactly once, with exactly the params in the table above,
  at each of the 18 actions that should send it — and at no other action in
  the run
- the /events enquiry: `event_type` from the dropdown (`corporate` preselected
  by `?for=corporate`), the email subject `Запитване за събитие – <Тип>`, and
  nothing sent at all when a field, the event type or consent is missing;
  the call buttons send `Contact` only, and the bar's «Запитване» sends
  nothing
- `BookingIntent` exactly once, with `page` and `source`, for each of the 13
  booking actions (every «Резервирай» button at desktop and phone width, the
  `/book` form, a link straight to Clock in this tab and in a new one) — and
  nowhere else; the same-tab Clock link held, then followed
- `PhoneClick` exactly once beside every `tel:` tap, and nowhere else
- a confirmed booking: one `Purchase` when the message and the callback both
  report it (the callback's, unchanged), and none more on a repeat or a
  reload. One `Purchase` with `order_id` from a message alone, from another
  confirmation shape, from the iframe's confirmation path (priced from the
  checkout) and from a page opened on one. None from another origin, a
  pending status, a thank-you URL with nothing to key on, or replies. One
  Conversions API post per booking with the pixel's `event_id`.
  `BookingCheckoutAbandon` once after a closed checkout, and never before
  checkout or after a booking. `?debugclock=1` logs and silence without it
- `EnquirySubmitted` for each of the four forms at 375×812 and 1280×900:
  once on a confirmed send, a double tap, and the callback-then-form visit
  (once each); nothing on an invalid form, a network failure, a 422, a
  filled honeypot or a resend in the same visit; nothing on any tap in the
  run — with `Lead` and `EventEnquiry` counted beside it, as before
- `9900` → `99`, never `9900`
- nulls and empty strings stripped rather than sent
- an `eventID` on every site event, and `clock-<numbers>` on `Purchase`
- no `PageView` from the funnel
- StrictMode fires each event once (dev build, with `DEV_BASE`)
- with the pixel blocked: page renders, no errors, GA4 still fires
- with `fbq` throwing: the Clock callback contains it and GA4 still fires

Then confirm delivery in **Events Manager → Test Events**, which is the only
thing that proves the events reach Meta.

## Consent — not built

There is no consent gate. Pixel, GTM, GA4 and the OpenAI pixel all fire on
first paint for every visitor, and the footer's "Бисквитки" link points at
`/contact` rather than a cookie policy.

BG and RO are EU/EEA, where ePrivacy wants prior consent for non-essential
tracking. What a CMP would take here:

1. A banner component in three languages, with accept / reject / per-category
   choice, and the choice stored and re-promptable.
2. The four trackers moved behind it. Meta supports `fbq('consent','revoke')`
   before `init` then `'grant'` on acceptance; GA4 and GTM support Google
   Consent Mode v2 defaults (`ad_storage`, `analytics_storage` denied) updated
   on acceptance. That is the clean route — the tags still load, they just
   hold back storage until granted.
3. A real cookie policy page, and the footer link pointed at it.
4. Testing that nothing fires before a choice, in all three languages.

Roughly a day. Expect reported conversions to drop by whatever share of
visitors decline — that is the point, not a regression.
