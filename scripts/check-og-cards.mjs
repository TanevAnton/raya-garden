#!/usr/bin/env node
/**
 * Fetches live pages as Facebook's scraper and checks the share card is the
 * page's own, in the language that was asked for.
 *
 * This is the one thing the build cannot prove about itself. The bot
 * snapshots and the .htaccess rules that route to them are only meaningful
 * as Apache runtime behaviour: whether `facebookexternalhit` asking for
 * ?lang=ro actually receives the Romanian snapshot. Paid traffic points at
 * these URLs, and a card that silently falls back to the site default — or
 * to Bulgarian for a Romanian audience — is money spent on the wrong
 * creative.
 *
 * Run it from a machine that can reach the site. NOT from GitHub Actions:
 * measured 2026-09-21, the host drops TCP from Actions runners on both 443
 * and 80 before any HTTP exchange, so every language reports
 * UND_ERR_CONNECT_TIMEOUT regardless of what is deployed. That is the
 * source address being refused, not the User-Agent — Facebook's own
 * scrapers come from Facebook's ranges and reach the site normally.
 *
 * No credentials: an ordinary public GET with a spoofed User-Agent.
 *
 * SNAPSHOT_DIR runs the same checks against built files instead of the live
 * site — what the deploy is about to upload, from real Sanity data. It
 * cannot prove Apache serves the right file to the right crawler, but it
 * does prove the file itself is correct, which is the half CI can reach:
 *
 *   SNAPSHOT_DIR=dist/__snapshots__ node scripts/check-og-cards.mjs
 *
 *   SITE=https://rayagarden.bg CHECK_PATHS=/event/nova-godina-2027 \
 *     node scripts/check-og-cards.mjs
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LANGS,
  SITE as DEFAULT_SITE,
  STATIC_ROUTES,
  fetchDynamicRoutes,
} from "./lib/public-routes.mjs";

const SITE = process.env.SITE || DEFAULT_SITE;
const PATHS = (process.env.CHECK_PATHS || "/event/nova-godina-2027")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

// The real thing, verbatim — a check that lies about its User-Agent tests
// nothing.
const UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

const EXPECTED_LOCALE = { bg: "bg_BG", en: "en_US", ro: "ro_RO" };

const decode = (s) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return m ? decode(m[1]) : null;
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = html.match(
    new RegExp(`<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*>`, "i")
  );
  return m ? attr(m[0], "content") : null;
}

function canonical(html) {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*>/i);
  return m ? attr(m[0], "href") : null;
}

const SNAPSHOT_DIR = process.env.SNAPSHOT_DIR || "";

/** The page's HTML, from the live site or from the build output. */
async function load(route, lang) {
  if (SNAPSHOT_DIR) {
    const file = path.join(SNAPSHOT_DIR, `${route.file}.${lang}.html`);
    return { status: 200, html: await readFile(file, "utf8"), from: file };
  }
  const url = `${SITE}${route.path}?lang=${lang}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    redirect: "follow",
  });
  return { status: res.status, html: await res.text(), from: url };
}

async function checkPath(route) {
  const path_ = route.path;
  console.log(`\n######## ${SITE}${path_} ########`);
  const failures = [];
  const titles = [];

  for (const lang of LANGS) {
    console.log(`\n=================== ?lang=${lang} ===================`);

    let loaded;
    try {
      loaded = await load(route, lang);
    } catch (err) {
      // Node wraps every transport failure as a bare "fetch failed"; the
      // cause carries the part that says what actually went wrong.
      const cause = err.cause
        ? ` (${err.cause.code || err.cause.message || err.cause})`
        : "";
      failures.push(`${lang}: could not read — ${err.message}${cause}`);
      console.log(`  could not read: ${err.message}${cause}`);
      continue;
    }

    const { html, status: httpStatus } = loaded;
    const got = {
      status: httpStatus,
      "og:title": meta(html, "og:title"),
      "og:description": meta(html, "og:description"),
      "og:image": meta(html, "og:image"),
      "og:image:width": meta(html, "og:image:width"),
      "og:image:height": meta(html, "og:image:height"),
      "og:url": meta(html, "og:url"),
      "og:locale": meta(html, "og:locale"),
      canonical: canonical(html),
    };
    for (const [k, v] of Object.entries(got)) {
      console.log(`  ${k.padEnd(16)} ${v ?? "(absent)"}`);
    }

    if (httpStatus !== 200) failures.push(`${lang}: HTTP ${httpStatus}`);

    // The snapshot must answer in the language that was asked for.
    const wantLocale = EXPECTED_LOCALE[lang];
    if (got["og:locale"] !== wantLocale) {
      failures.push(
        `${lang}: og:locale is ${got["og:locale"] ?? "absent"}, expected ${wantLocale}`
      );
    }

    // Self-referential, not the homepage and not another language.
    const wantCanonical = `${SITE}${path_}?lang=${lang}`;
    if (got.canonical !== wantCanonical) {
      failures.push(
        `${lang}: canonical is ${got.canonical ?? "absent"}, expected ${wantCanonical}`
      );
    }

    // The SPA shell's defaults mean the crawler got the un-rendered page.
    if (!got["og:title"]) {
      failures.push(`${lang}: og:title absent`);
    } else if (got["og:title"] === "Park Hotel RAYA Garden") {
      failures.push(
        `${lang}: og:title is the site default — the crawler was served the SPA shell, not a snapshot`
      );
    } else {
      titles.push(got["og:title"]);
    }

    if (!got["og:description"]) failures.push(`${lang}: og:description absent`);
    if (!got["og:image"]) failures.push(`${lang}: og:image absent`);
  }

  // Three identical titles means the language rules are not matching and
  // every language is being served the same snapshot.
  if (titles.length === LANGS.length && new Set(titles).size === 1) {
    failures.push(
      `all ${LANGS.length} languages returned the same og:title — ` +
        `per-language snapshot routing is not working`
    );
  }

  return failures;
}

// In snapshot mode every built page is checked, since the files are already
// there; over the network only the paths asked for, to keep it quick.
async function dynamicOrNone() {
  try {
    return await fetchDynamicRoutes();
  } catch (err) {
    // The deploy already failed at the sitemap step if Sanity is down, so
    // this is belt and braces: check the static pages rather than nothing.
    console.warn(`(could not list dynamic routes: ${err.message})`);
    return [];
  }
}

const routes = SNAPSHOT_DIR
  ? [...STATIC_ROUTES, ...(await dynamicOrNone())]
  : PATHS.map((p) => ({
      path: p,
      file: p === "/" ? "home" : p.replace(/^\//, "").replace(/\//g, "-"),
    }));

const failures = [];
for (const route of routes) failures.push(...(await checkPath(route)));

console.log("\n=================== result ===================");
if (failures.length === 0) {
  console.log(
    `PASS — ${routes.length} page(s) × ${LANGS.length} language(s), each with its own card.`
  );
} else {
  console.log(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
