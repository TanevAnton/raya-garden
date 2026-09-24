# Meta Pixel — what fires, from where, and how to check it

Pixel `2833505250333119`, initialised inline in `index.html`. **Not in GTM** —
GTM and GA4 are separate installs in the same file and are not involved in any
of this. Events go through code.

## Where the calls live

```
src/lib/metaPixel.js        trackMeta() / useMetaEvent() — every site event
  ├── Layout.jsx            PageView (per route), Contact (any tel: link)
  ├── Hotel.jsx             ViewContent
  ├── Restaurant.jsx        ViewContent
  ├── EventPage.jsx         ViewContent
  ├── Contact.jsx           Lead
  └── WeddingConfigurator   Lead

index.html (inline script)  the Clock PMS booking funnel
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
| `Contact` | any `tel:`, `mailto:`, `viber:` or WhatsApp (`wa.me`, `api.whatsapp.com`, `whatsapp:`) link | `method`, `content_category` by page, `lang` |

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

`window.clockPmsWbePageViewCallback` is called by Clock on each step.

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
alone), walks every route, submits both forms against stubbed backends, clicks
a `tel:` link, and drives the Clock callback through all six steps. It prints
every event with its params and asserts:

- the exact event per route and per funnel step
- `Contact` with the right `method` and `content_category` for phone, email,
  Viber and WhatsApp links, exactly once, and nothing for an ordinary link
- `Lead` with the right `content_category` for each form and topic, exactly
  once — and no `Lead` when Formspree or the wedding endpoint refuses, when
  required fields are empty, or when consent is unticked
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
