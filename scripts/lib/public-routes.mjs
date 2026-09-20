/**
 * Every URL this site publishes, in one place.
 *
 * Two build steps need the same answer to "what pages exist?" — the sitemap
 * generator and the bot prerenderer — and they must not drift apart, or a
 * page ends up in one and not the other. Both import this module.
 *
 * Adding a Sanity type that renders its own route? Add it to DYNAMIC_TYPES
 * and both steps pick it up. Nothing here hard-codes a document: the slugs
 * are always queried from the dataset.
 */

export const SITE = "https://rayagarden.bg";

// The languages App.jsx accepts in ?lang= (VALID_LANGS). BG is the site's
// primary market and the language the bot snapshots are pinned to.
export const LANGS = ["bg", "en", "ro"];
export const DEFAULT_LANG = "bg";

const PROJECT_ID = process.env.VITE_SANITY_PROJECT_ID || "q2yxl7gs";
const DATASET = process.env.VITE_SANITY_DATASET || "production";
// Same API version the runtime client pins (src/lib/sanity.js).
const API_VERSION = "2024-10-01";

/** Hand-maintained pages — one React route each, no Sanity document behind the URL. */
export const STATIC_ROUTES = [
  { path: "/", file: "home", changefreq: "weekly", priority: 1.0 },
  { path: "/hotel", file: "hotel", changefreq: "monthly", priority: 0.9 },
  { path: "/restaurant", file: "restaurant", changefreq: "weekly", priority: 0.9 },
  { path: "/winery", file: "winery", changefreq: "monthly", priority: 0.8 },
  { path: "/park", file: "park", changefreq: "monthly", priority: 0.7 },
  { path: "/events", file: "events", changefreq: "monthly", priority: 0.8 },
  {
    path: "/svatben-konfigurator",
    file: "svatben-konfigurator",
    changefreq: "monthly",
    priority: 0.8,
  },
  { path: "/book", file: "book", changefreq: "monthly", priority: 0.7 },
  { path: "/contact", file: "contact", changefreq: "yearly", priority: 0.6 },
];

/**
 * Sanity types that render a public URL of their own.
 *
 * Only `eventPage` does today. The other five types render *inside* a static
 * page and have no URL to submit: `room` (cards on /hotel — it carries a
 * slug field, but nothing routes on it), `specialOffer` (cards on /),
 * `attraction` (list on /park), `pageContent` (the copy for the static pages
 * themselves, keyed by `page`), `siteSettings` (singleton).
 */
export const DYNAMIC_TYPES = [
  {
    type: "eventPage",
    /** /event/<slug> — App.jsx route "event/:slug", rendered by EventPage.jsx. */
    route: (doc) => `/event/${doc.slug}`,
    file: (doc) => `event-${doc.slug}`,
    changefreq: "weekly",
    // Above every static page but the home page. An event is the thing the
    // hotel is actively selling, and it has a shelf life the others don't.
    priority: 0.95,
    /**
     * `active` is the hotel's own "this event is on" switch: EventPage.jsx
     * 404s without it, so an inactive document has no page to submit. It is
     * also the only signal for "upcoming" — the eventPage schema carries no
     * start or end date at all (see studio/schemas/eventPage.js). If the
     * hotel wants the sitemap to drop an event the day after it happens,
     * that needs a date field on the document first.
     */
    filter: "active == true",
  },
];

/** GROQ that excludes drafts and anything that cannot produce a URL. */
export function groqFor({ type, filter }) {
  const clauses = [
    `_type == "${type}"`,
    filter,
    // Drafts live at drafts.<id>. An unauthenticated request never returns
    // them, but the filter states the intent rather than relying on that.
    `!(_id in path("drafts.**"))`,
    `defined(slug.current)`,
    `slug.current != ""`,
  ].filter(Boolean);
  return `*[${clauses.join(" && ")}]{ "slug": slug.current, _updatedAt }`;
}

async function runQuery(groq) {
  const url =
    `https://${PROJECT_ID}.api.sanity.io/v${API_VERSION}/data/query/${DATASET}` +
    `?query=${encodeURIComponent(groq)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Sanity responded ${res.status} for ${groq}`);
  }
  const { result } = await res.json();
  return Array.isArray(result) ? result : [];
}

/**
 * Every dynamic page that currently exists, as route objects shaped like the
 * static ones. Throws if the dataset can't be reached — the caller decides
 * whether that is fatal (the sitemap keeps its previous contents; the
 * prerenderer ships without event snapshots).
 */
export async function fetchDynamicRoutes() {
  const routes = [];
  for (const entry of DYNAMIC_TYPES) {
    const docs = await runQuery(groqFor(entry));
    for (const doc of docs) {
      if (!doc?.slug) continue; // defensive: the GROQ already filtered these
      routes.push({
        path: entry.route(doc),
        file: entry.file(doc),
        changefreq: entry.changefreq,
        priority: entry.priority,
        lastmod: doc._updatedAt || null,
        type: entry.type,
      });
    }
  }
  return routes;
}
