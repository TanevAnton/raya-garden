# Park Hotel RAYA Garden — Website

Trilingual (BG / EN / RO) website for **Park Hotel RAYA Garden**, a boutique hotel on Sveta Gora park, Veliko Tarnovo, Bulgaria.

Built with **React 19 · Vite · React Router · Tailwind CSS**, with content managed in **Sanity CMS**. Luxury boutique-hotel feel — dark theme, gold accents, Cormorant Garamond serif display, cinematic imagery and subtle scroll motion.

- **Live:** https://raya-garden.vercel.app
- **CMS (staff login):** https://raya-garden.sanity.studio

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:5173
```

> **Node 18+ required** (Vite 5). If `npm run dev` fails with `crypto.getRandomValues is not a function`, your shell is on an old Node — switch with `nvm use 20` (or newer).

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR → http://localhost:5173 |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run studio:dev` | Run Sanity Studio locally → http://localhost:3333 |
| `npm run studio:deploy` | Deploy Studio to `raya-garden.sanity.studio` |

## Environment variables

Copy `.env.example` → `.env.local` and fill in:

| Variable | Required for | Notes |
| --- | --- | --- |
| `VITE_SANITY_PROJECT_ID` | site + Studio | from sanity.io/manage → API |
| `VITE_SANITY_DATASET` | site + Studio | usually `production` |
| `VITE_FORMSPREE_ENDPOINT` | contact form | falls back to a `mailto:` draft if unset |
| `SANITY_WRITE_TOKEN` | migration/seed scripts only | **server-side only — never prefix with `VITE_`** |

The Google Analytics 4 ID and the Clock booking URL are non-secret and live in `index.html` / `src/lib/clockWbe.js` respectively (the booking URL is also editable in Studio via `siteSettings.bookingUrl`).

## Routes

| Path | Page |
| --- | --- |
| `/` | Home — hero slideshow, welcome, "Why us", rooms & events teasers, section cards, CTA |
| `/hotel` | Rooms & suites — photos, prices (EUR + лв), amenities, "Included with every stay" |
| `/restaurant` | Intro, photo gallery, menu PDF + wine list PDF downloads |
| `/winery` | Yalovo Winery story + photo gallery, link to the external winery site |
| `/park` | Park & town, nearby attractions |
| `/events` | Weddings & corporate galleries, brochures, free-consultation CTA |
| `/book` | On-site booking — date search that opens the Clock booking engine |
| `/contact` | Contact info, map, inquiry form |
| `*` | Branded 404 |

## Content management (Sanity CMS)

**Sanity is the source of truth for all content.** Staff edit text, swap photos, manage offers and PDFs in Studio; the site reads it live. `src/translations.js` (UI labels + page copy) and `src/data.js` (room fallbacks) are only used as a fallback when Sanity is unreachable.

Every translatable field is a trilingual object (`{ bg, en, ro }`) via the reusable `localeString` / `localeText` / `localeArray` types — **Bulgarian is required; EN/RO are optional** and fall back BG → EN → RO via `pickLocale()`.

**Document types** (`studio/schemas/`):

| Schema | Purpose |
| --- | --- |
| `siteSettings` | Singleton — logo, phones, email, address, hours, socials, booking URL, menu & wine-list PDFs, brochures |
| `pageContent` | One doc per page (home, hotel, restaurant, winery, park, events, contact) — hero copy, intros, galleries, section cards, experience cards, free-form blocks |
| `room` | Rooms & suites — name, photos, price (EUR), size, capacity, amenities |
| `specialOffer` | Toggleable offers shown on the Home page, with valid-from/to dates |
| `attraction` | Nearby attractions listed on `/park` |

A custom input shows the **лв (BGN) equivalent live under EUR price fields** (fixed peg 1 € = 1.95583 лв). Studio's sidebar has a **Quick edits** group for prices, offers and PDFs.

### Seeding / migration (one-off)

Add `SANITY_WRITE_TOKEN` to `.env.local` (Editor permissions), then run the relevant script from `scripts/` (e.g. `npm run migrate`). Scripts are idempotent — re-running refreshes documents rather than duplicating.

## Booking integration

All **"Резервирай"** buttons lead to `/book`, where guests pick dates and open the official **Clock PMS+ web booking engine** (loaded in `index.html`, wrapped in `src/lib/clockWbe.js`). It opens as an on-domain overlay and reports the booking funnel to the GA4 property configured in Clock.

> The booking engine only renders on whitelisted domains (Clock dashboard → Website integration → Hotel domain). Production domains are allowlisted; add `http://localhost:5173` there if you need to test bookings locally.

## Contact form

`/contact` posts to a [Formspree](https://formspree.io) endpoint delivering to **hotel@svetagora.bg**. Set `VITE_FORMSPREE_ENDPOINT` in `.env.local`. If unset, the form opens the guest's mail client with a pre-filled draft instead of failing, and a persistent "email us directly" link always sits under the submit button. Includes a honeypot field for spam mitigation.

## Deployment

**Frontend → SuperHosting** (static hosting, cPanel / LiteSpeed). The site is a static SPA — build locally and upload:

1. `npm run build` → `dist/`. The Sanity project, Formspree endpoint, GA ID etc. are **baked in at build time** from `.env.local`, so set those before building.
2. Upload the **contents of `dist/`** (including the hidden `.htaccess`) into `public_html/` — via cPanel File Manager (zip `dist/`, upload, extract) or FTP. Replace the previous files.
3. `dist/.htaccess` handles HTTPS, `www → non-www`, the old-URL **301 redirects**, the **SPA fallback** (deep links / refresh → `index.html`) and asset caching. It must sit in the web root beside `index.html`.

> Edit the `.htaccess` **source at `public/.htaccess`** — Vite copies it into `dist/` on every build. SSL must be active on the host before the HTTPS redirect works (Let's Encrypt via cPanel).

**Studio → Sanity.** After any change under `studio/schemas/`, run `npm run studio:deploy`.

**CORS:** in Sanity → API → CORS origins, allow `http://localhost:5173` and `https://rayagarden.bg`, or the site can't read content.

> `vercel.json` is kept only for the optional Vercel **preview** deploy used during development; SuperHosting ignores it.

## Project structure

```
├── index.html              ← Vite entry: meta tags, JSON-LD Hotel schema, GA4, Clock assets
├── public/.htaccess        ← SuperHosting: HTTPS, 301 redirects, SPA fallback, caching
├── vercel.json             ← optional Vercel preview only (SuperHosting ignores it)
├── src/
│   ├── App.jsx             ← routes, language detection (geo-IP + localStorage), Clock init
│   ├── translations.js     ← UI labels + fallback page copy (BG/EN/RO)
│   ├── data.js             ← room fallbacks + image CDN base
│   ├── lib/{sanity,clockWbe}.js
│   ├── hooks/{useSanity,useSeo}.js
│   ├── components/         ← Layout, Nav, Footer, PageHero, MediaGallery
│   └── pages/              ← Home, Hotel, Restaurant, Winery, Park, Events, Reservations, Contact, NotFound
├── studio/                 ← Sanity Studio (schemas, structure, custom inputs)
├── scripts/                ← one-off migration / seed scripts
└── public/                 ← robots.txt, sitemap.xml
```

## Notable details

- **Trilingual** with geo-IP detection on first visit (BG → Bulgaria, RO → Romania, EN otherwise); manual switch persists to `localStorage`.
- **SEO:** per-page title / description / canonical / Open Graph / Twitter via `useSeo()`; Hotel JSON-LD in `index.html`; `robots.txt` + `sitemap.xml`.
- **Images** are Sanity-managed (via `@sanity/image-url`) and gated on load so the bundled fallbacks never flash before content arrives.
- **Accessibility:** skip-to-content link, keyboard-visible focus, ARIA on the mobile menu and language switcher, `prefers-reduced-motion` respected.

## Contact

- Phone: +359 879 107 500 · Restaurant: 0896 100 100
- Email: hotel@svetagora.bg
- Sveta Gora Park, 5000 Veliko Tarnovo, Bulgaria
- Instagram: [@parkhotel_raya_garden](https://www.instagram.com/parkhotel_raya_garden/) · Facebook: [hotel.sveta.gora](https://www.facebook.com/hotel.sveta.gora)

---

© Park Hotel RAYA Garden. Proprietary — all rights reserved.
