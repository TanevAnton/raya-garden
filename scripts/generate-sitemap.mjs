#!/usr/bin/env node
/**
 * Post-build step: writes dist/sitemap.xml from the static routes plus every
 * Sanity document that renders a public URL (see scripts/lib/public-routes.mjs).
 *
 * Why a build step and not a route: this site is a Vite SPA served as static
 * files by Apache — there is no server to render /sitemap.xml on request. The
 * deploy workflow runs this after `vite build`, so the file that ships is
 * always generated from the live dataset rather than hand-maintained.
 *
 * public/sitemap.xml stays in the repo as the fallback: Vite copies it into
 * dist/ first, and this script overwrites it. If Sanity is unreachable the
 * step fails, the fallback survives, and the deploy continues with a sitemap
 * that is stale rather than absent.
 *
 * Usage: node scripts/generate-sitemap.mjs   (after `vite build`, from the
 * repo root — `npm run sitemap`)
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SITE,
  LANGS,
  DEFAULT_LANG,
  STATIC_ROUTES,
  fetchDynamicRoutes,
} from "./lib/public-routes.mjs";

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** The URL a given language is served at. BG is not special-cased: every
 *  language gets its own address, so each can carry its own canonical. */
const urlFor = (routePath, lang) => `${SITE}${routePath}?lang=${lang}`;

/** W3C datetime, seconds precision. Sanity's _updatedAt is already ISO 8601;
 *  static routes get the build date, the only honest "last modified" we have. */
const isoSeconds = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

function lastmodFor(route, buildDate) {
  if (!route.lastmod) return buildDate;
  const parsed = new Date(route.lastmod);
  return Number.isNaN(parsed.getTime()) ? buildDate : isoSeconds(parsed);
}

/**
 * Build the XML. Pure — takes routes, returns a string — so the output can be
 * asserted without a network or a build.
 *
 * Every page appears once per language, and each of those entries lists the
 * complete set of alternates including itself, which is what hreflang
 * requires. x-default points at the bare URL: the address with no ?lang=,
 * where App.jsx picks a language from the visitor's own country.
 */
export function buildSitemap(routes, { now = new Date() } = {}) {
  const buildDate = isoSeconds(now);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ];

  for (const route of routes) {
    const lastmod = lastmodFor(route, buildDate);
    const alternates = [
      ...LANGS.map(
        (code) =>
          `    <xhtml:link rel="alternate" hreflang="${code}" href="${xmlEscape(
            urlFor(route.path, code)
          )}"/>`
      ),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(
        `${SITE}${route.path}`
      )}"/>`,
    ];

    for (const lang of LANGS) {
      lines.push(
        "  <url>",
        `    <loc>${xmlEscape(urlFor(route.path, lang))}</loc>`,
        `    <lastmod>${lastmod}</lastmod>`,
        `    <changefreq>${route.changefreq}</changefreq>`,
        // A translation that may not be filled in yet shouldn't outrank the
        // language the hotel actually writes in.
        `    <priority>${(lang === DEFAULT_LANG
          ? route.priority
          : Math.max(0.1, route.priority - 0.1)
        ).toFixed(2)}</priority>`,
        ...alternates,
        "  </url>"
      );
    }
  }

  lines.push("</urlset>", "");
  return lines.join("\n");
}

async function main() {
  const dynamic = await fetchDynamicRoutes();
  const routes = [...STATIC_ROUTES, ...dynamic];
  const xml = buildSitemap(routes);
  const out = path.resolve("dist/sitemap.xml");
  await writeFile(out, xml, "utf8");

  const byType = dynamic.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {});
  console.log(
    `sitemap: ${routes.length} page(s) × ${LANGS.length} language(s) = ` +
      `${routes.length * LANGS.length} URLs -> dist/sitemap.xml`
  );
  console.log(
    `  static: ${STATIC_ROUTES.length}` +
      Object.entries(byType)
        .map(([type, n]) => ` · ${type}: ${n}`)
        .join("")
  );
  for (const route of dynamic) console.log(`  ${route.path}`);
}

// Only run when invoked directly, so the builders above stay importable.
if (process.argv[1] && process.argv[1].endsWith("generate-sitemap.mjs")) {
  main().catch((err) => {
    // Loud and non-zero: the deploy step is marked continue-on-error, so the
    // site still ships — with public/sitemap.xml, which lists the static
    // pages only. A stale sitemap beats an empty one.
    console.error("generate-sitemap failed — keeping the fallback:", err.message);
    process.exit(1);
  });
}
