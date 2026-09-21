# sitemap.xml — how it's built, and how it stays fresh

`https://rayagarden.bg/sitemap.xml` is **generated at deploy time**. There is
no checked-in copy: `public/sitemap.xml` was deleted, so the generator is the
only source. `robots.txt` points at it.

```
scripts/lib/public-routes.mjs   ← the one list of what URLs exist
  ├── scripts/generate-sitemap.mjs   → dist/sitemap.xml
  └── scripts/prerender-bots.mjs     → dist/__snapshots__/*.html
```

Both build steps read the same module, so a page can't land in one and be
missing from the other.

## What goes in

| Source | Routes |
| --- | --- |
| `STATIC_ROUTES` | the 9 hand-written pages (`/`, `/hotel`, … `/contact`) |
| `DYNAMIC_TYPES` | one URL per published Sanity document that owns a route |

Today exactly one Sanity type owns a route:

| Type | Route | Included when |
| --- | --- | --- |
| `eventPage` | `/event/<slug>` | `active == true`, not a draft, slug present |

The other five types render *inside* a static page and have no URL to submit:
`room` (cards on `/hotel` — it has a `slug` field, but nothing routes on it),
`specialOffer` (cards on `/`), `attraction` (list on `/park`), `pageContent`
(the copy for the static pages, keyed by `page`), `siteSettings` (singleton).

**Adding a type that gets its own route:** add an entry to `DYNAMIC_TYPES` in
`scripts/lib/public-routes.mjs`. Never add a document by hand — the slugs are
always queried.

The GROQ per type:

```groq
*[_type == "eventPage" && active == true
  && !(_id in path("drafts.**"))
  && defined(slug.current) && slug.current != ""
]{ "slug": slug.current, _updatedAt }
```

`_updatedAt` becomes `<lastmod>`. Active events get `priority` 0.95 — above
every static page except the home page.

> **"Upcoming" is `active`, not a date.** `studio/schemas/eventPage.js` has no
> start or end date, so there is nothing to compare against today. `active` is
> the hotel's own "this event is on" switch and the same flag `/event/<slug>`
> 404s without, so it is the honest proxy. For the sitemap to drop an event
> the morning after it happens, the schema needs a `startDate`/`endDate` first.

## Languages

Each page is listed once per language (`?lang=bg|en|ro`), and every entry
carries the full `hreflang` set including itself, plus `x-default` → the bare
URL. `src/hooks/useSeo.js` emits the matching on-page tags: a **self-referential
canonical per language** and the same alternates.

Before this, all three languages canonicalised to the bare URL, which told
Google the language versions were duplicates of one address — so only whichever
language its crawler happened to be served could be indexed.

The bot snapshots are language-aware for the same reason: `.htaccess` picks
`__snapshots__/<page>.<lang>.html` from the `?lang=` on the request. Without
that, `/hotel?lang=en` would hand Googlebot the Bulgarian snapshot and the
alternates would contradict the pages they point at.

## Keeping it fresh after a content edit

There is no server here — the site is static files on SuperHosting — so there
is no on-request revalidation. Publishing an event has to rebuild.

**Set up the webhook once and it's automatic (~4 min, no human):**

1. GitHub → repo → Settings → *Developer settings* → fine-grained token with
   **Contents: read-write** on `TanevAnton/raya-garden`.
2. Sanity → [manage.sanity.io](https://manage.sanity.io) → project → **API →
   Webhooks → Create webhook**:
   - URL `https://api.github.com/repos/TanevAnton/raya-garden/dispatches`
   - Trigger on **Create, Update, Delete**
   - Filter `_type == "eventPage"`
   - Method `POST`, headers
     `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`
   - Body `{"event_type":"sanity-content-published"}`
3. The workflow already listens (`repository_dispatch: types:
   [sanity-content-published]`).

Publish an event → webhook → deploy → new `sitemap.xml` and snapshots live.

**If instant matters more than simple**, the alternative is a PHP endpoint
(`/api/sitemap.php`, the host runs PHP 7.3) that queries Sanity per request
with a file cache, plus an `.htaccess` rewrite of `/sitemap.xml`. That removes
the rebuild entirely, at the cost of a second copy of the URL logic and a
runtime dependency on Sanity being reachable from the shared host. Not built.

## If Sanity is down at build time

`npm run sitemap` exits non-zero and **the deploy fails there on purpose** —
it is the one step in the workflow without `continue-on-error`.

That is deliberate: the deploy mirrors with `lftp mirror -R --delete`, so a
`dist/` with no `sitemap.xml` would delete the live one and start serving 404s
to crawlers. Failing before the mirror runs leaves the previously deployed
sitemap in place until the next green build.

The bot snapshots still degrade softly — a missing snapshot just falls back to
the live SPA, which costs nothing.

## Verifying the share cards

`scripts/check-og-cards.mjs` fetches each language as `facebookexternalhit`
and fails on a wrong `og:locale`, a canonical that isn't self-referential, a
missing description or image, an `og:title` equal to the site default (the
crawler got the SPA shell, not a snapshot), or all three languages returning
the same title (the `?lang=` routing isn't matching).

```bash
SITE=https://rayagarden.bg CHECK_PATHS=/event/nova-godina-2027 \
  node scripts/check-og-cards.mjs
```

**Run it from a normal machine, not CI.** Measured 2026-09-21: the host drops
TCP from GitHub Actions runners on both 443 and 80, before any HTTP exchange
— DNS resolves, the User-Agent is never sent. SuperHosting refuses datacenter
ranges. `.github/workflows/og-check.yml` is therefore dispatch-only.

For what Facebook *actually* sees, the authority is Facebook's own
[Sharing Debugger](https://developers.facebook.com/tools/debug/): it scrapes
from Facebook's side, shows the card, and *Scrape Again* clears the cache —
which a URL needs anyway after its markup changes. Check each language URL
separately; they are different addresses.

## Running it locally

```bash
npm run build            # no sitemap in dist/ yet — nothing is checked in
npm run sitemap          # writes dist/sitemap.xml
npx vite preview --port 5199
curl -s localhost:5199/sitemap.xml
```
