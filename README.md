# Park Hotel RAYA Garden — Website

Multi-page, cinematic, bilingual (BG/EN) website for Park Hotel RAYA Garden — Veliko Tarnovo, Bulgaria.

Built with **React + Vite + React Router + Tailwind CSS**. Luxury boutique-hotel feel: dark theme, gold accents, Cormorant Garamond serif display, smooth-scroll storytelling and subtle motion.

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production build → dist/
npm run preview   # preview the production build
```

The build output (`dist/`) is a static site — deploys to **Vercel**, **Netlify**, **Cloudflare Pages**, or any static host.

## Preview without building

Two options to see the design without `npm install`:

| File | What it shows |
| --- | --- |
| `preview.html` | The original single-page version (one long scrolling page) |
| `preview/index.html` | The full multi-page site — click through nav links to see every page |

Just double-click `preview/index.html` to start.

## Routes (in the React app)

| Path | What's on it |
| --- | --- |
| `/` | Cinematic home with hero slideshow, intro, stat band and section teasers |
| `/hotel` | Room types with prices, sizes, amenities — Standard, Deluxe, Junior Suite, Luxury Suite |
| `/restaurant` | Full menu — 7 categories, ~30 dishes with prices and descriptions |
| `/winery` | Yalovo Winery story and wine list (6 bottles, vintages, tasting notes) |
| `/lake` | Daily fishing rates, species pricing per kg, rules, what's included |
| `/park` | Park & town overview, 6 nearby attractions |
| `/events` | Wedding packages (3 tiers) + corporate / team-building packages (3 tiers) |
| `/contact` | Contact info, map, working inquiry form (Formspree-ready) |
| `*` (anything else) | Branded 404 with a link back home |

All "Book Now" buttons point to the live Clock-Software booking engine the hotel already uses.

## Project structure

```
RAYA Garden/
├── index.html              ← Vite entry HTML, full meta tags + JSON-LD Hotel schema
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .env.example            ← copy to .env.local and add Formspree endpoint
├── public/
│   ├── robots.txt
│   └── sitemap.xml
├── preview.html            ← standalone single-page preview
├── preview/                ← standalone multi-page preview (open preview/index.html)
├── src/
│   ├── main.jsx
│   ├── App.jsx             ← Routes + language persistence (localStorage)
│   ├── index.css           ← Tailwind layers + custom utilities, prefers-reduced-motion
│   ├── translations.js     ← Every BG/EN line
│   ├── data.js             ← Rooms, menu, lake pricing, event packages
│   ├── hooks/
│   │   └── useSeo.js       ← per-page title, description, canonical, OG, Twitter
│   ├── components/
│   │   ├── Layout.jsx      ← Page wrapper (Nav, Footer, scroll progress, skip link)
│   │   ├── Nav.jsx
│   │   ├── Footer.jsx
│   │   └── PageHero.jsx
│   └── pages/
│       ├── Home.jsx
│       ├── Hotel.jsx
│       ├── Restaurant.jsx
│       ├── Winery.jsx
│       ├── Lake.jsx
│       ├── Park.jsx
│       ├── Events.jsx
│       ├── Contact.jsx
│       └── NotFound.jsx
```

## Editing content

- **Copy / text:** all BG and EN strings live in `src/translations.js` — edit there.
- **Room types, menu, prices, packages:** all in `src/data.js`. Change a price or add a dish — it updates everywhere.
- **Images:** currently loaded from the existing `rayagarden.bg` CDN. To use your own photos, drop them in `public/images/` and update `IMG` in `src/data.js`.
- **Colours / typography:** open `tailwind.config.js` and adjust the `colors` block. The gold/ink/cream scales drive the whole look.

## Contact form

The `/contact` form posts JSON to a [Formspree](https://formspree.io) endpoint.

1. Sign up at formspree.io, create a new form.
2. Copy `.env.example` to `.env.local`.
3. Paste your endpoint as `VITE_FORMSPREE_ENDPOINT=https://formspree.io/f/...`.
4. Restart `npm run dev`.

If no endpoint is configured, the form falls back to a friendly "sent" message so guests aren't blocked — but emails won't actually be delivered. Includes a honeypot field for spam mitigation.

## SEO & performance

- Per-page meta tags via the `useSeo()` hook — title, description, canonical, Open Graph, Twitter cards.
- Hotel JSON-LD structured data in `index.html` for rich Google results.
- `robots.txt` + `sitemap.xml` in `public/`.
- Hero image preloaded with `fetchpriority="high"`; below-the-fold images use `loading="lazy" decoding="async"`.
- `prefers-reduced-motion` respected — animations disabled for users who request it.

## Accessibility

- Skip-to-content link, keyboard-visible focus rings, ARIA on the mobile menu and lang switcher.
- All interactive controls reachable by keyboard. Tested with VoiceOver on macOS.

## Design notes

- **Typography:** Cormorant Garamond (serif display) + Inter (sans body). Loaded from Google Fonts.
- **Palette:** deep ink black + warm gold + cream — premium without being cold.
- **Motion:** Hero crossfade slideshow, slow Ken-Burns zoom, intersection-observer reveal on scroll, hover lift on cards, top scroll-progress bar.
- **Bilingual:** BG/EN switcher in the top nav. Saves choice to `localStorage`, also adds `lang` attribute to `<html>` dynamically.
- **Booking integration:** all "Book Now" buttons go to the live Clock-Software engine — `https://sky-eu1.clock-software.com/60837/10183/wbe/products/new`

## Contact info

- Phone: +359 879 107 500
- Restaurant reservations: 0896 100 100
- Email: hotel@svetagora.bg
- Location: Sveta Gora Park, 5000 Veliko Tarnovo, Bulgaria
- Instagram: [@raya.garden](https://www.instagram.com/raya.garden/)
- Facebook: [hotel.sveta.gora](https://www.facebook.com/hotel.sveta.gora)
