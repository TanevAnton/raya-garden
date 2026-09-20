#!/usr/bin/env node
/**
 * Post-build step: renders a static HTML snapshot of each page and writes
 * it into dist/__snapshots__/. public/.htaccess serves these to known bot
 * user agents (GPTBot, ChatGPT-User, OAI-SearchBot, Googlebot, ...) instead
 * of the live SPA shell.
 *
 * Why: this app renders entirely client-side — the built index.html is just
 * <div id="root"></div> until React fetches from Sanity and paints. Crawlers
 * that don't execute JavaScript (OpenAI's ChatGPT-Ads preview fetcher is
 * one) see an empty page and report they "couldn't access" the site, even
 * though nothing is actually blocked. A pre-rendered snapshot gives them
 * the same visible text a browser would show — this is standard "dynamic
 * rendering" (bots get a static copy of the same content, not different
 * content), not cloaking.
 *
 * Human visitors are never served a snapshot — only requests carrying a
 * known bot User-Agent, per the .htaccess rules. Regenerated on every
 * production deploy, so it can go briefly stale between deploys; that's
 * fine for SEO/ad-preview purposes.
 *
 * Usage: node scripts/prerender-bots.mjs   (run after `vite build`, from
 * repo root — CI wires this in via `npm run prerender:bots`)
 */
import { preview } from "vite";
import puppeteer from "puppeteer";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  LANGS,
  DEFAULT_LANG,
  STATIC_ROUTES,
  fetchDynamicRoutes,
} from "./lib/public-routes.mjs";

async function main() {
  let dynamicRoutes = [];
  try {
    dynamicRoutes = await fetchDynamicRoutes();
  } catch (err) {
    // Sanity unreachable at build time — ship without event snapshots
    // rather than failing the whole deploy.
    console.warn(`  could not list dynamic routes: ${err.message}`);
  }
  const routes = [...STATIC_ROUTES, ...dynamicRoutes];

  // Port 5173 (Vite's dev-server default) is already in the Sanity
  // project's CORS allowlist alongside the real dev server — reusing it
  // here lets the preview server's client-side Sanity fetches succeed
  // without editing CORS origins. Safe: this only runs in an isolated CI
  // build, never alongside an actual `vite dev` instance.
  const server = await preview({ preview: { port: 5173, strictPort: true } });
  const port = server.config.preview.port;
  const base = `http://localhost:${port}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const outDir = path.resolve("dist/__snapshots__");
  await mkdir(outDir, { recursive: true });

  try {
    const page = await browser.newPage();

    // Every route below is a real page load, so GA4/GTM/Meta/OpenAI-ads
    // beacons would fire from the CI runner on each deploy and land in the
    // reports as fake traffic — and worse, as fake ad-attribution data.
    // None of them affect what gets rendered, so drop them at the network
    // layer. Sanity and the app's own assets must still go through.
    const TRACKER_HOSTS = [
      "googletagmanager.com",
      "google-analytics.com",
      "analytics.google.com",
      "doubleclick.net",
      "connect.facebook.net",
      "facebook.com",
      "bzrcdn.openai.com",
    ];
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (TRACKER_HOSTS.some((h) => url.includes(h))) req.abort();
      else req.continue();
    });

    // One snapshot per language. The .htaccess bot rules pick by the
    // ?lang= on the request, so a crawler asking for the English URL gets
    // English HTML — with the English canonical and the hreflang set that
    // go with it. Serving one language for every ?lang= would make the
    // alternates in the sitemap contradict the pages they point at.
    const jobs = routes.flatMap((route) =>
      LANGS.map((lang) => ({ ...route, lang }))
    );

    for (const route of jobs) {
      // ?lang= pins the snapshot's language deterministically — without it
      // the app's geo-IP lookup would pick a language per the build
      // runner's own network location, not a real visitor's.
      const url = `${base}${route.path}?lang=${route.lang}`;
      try {
        await page.goto(url, { waitUntil: "networkidle0", timeout: 30000 });
        // Sanity's response finishing (network-idle) and React committing
        // the resulting state update aren't the same tick — pages gate
        // their body behind a `transition-opacity ... opacity-0` wrapper
        // (see feedback_image_loading_pattern memory) until loading flags
        // flip, which lags network-idle by a beat. Wait for that class to
        // clear; if a page never gates (or something's stuck) don't hang
        // the whole build over one route — snapshot whatever's there.
        await page
          .waitForFunction(
            () => !document.querySelector(".transition-opacity.opacity-0"),
            { timeout: 5000 }
          )
          .catch(() => {});
        const html = await page.content();
        await writeFile(path.join(outDir, `${route.file}.${route.lang}.html`), html);
        // The unsuffixed file stays the default for a bot that asks without
        // a ?lang= at all, and keeps the pre-existing .htaccess rules working.
        if (route.lang === DEFAULT_LANG) {
          await writeFile(path.join(outDir, `${route.file}.html`), html);
        }
        console.log(
          `  snapshot: ${route.path} [${route.lang}] -> __snapshots__/${route.file}.${route.lang}.html`
        );
      } catch (err) {
        console.warn(`  skipped ${route.path} [${route.lang}]: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
  }

  console.log(
    `Prerendered ${routes.length} route(s) × ${LANGS.length} language(s) for bot crawlers.`
  );
}

main().catch((err) => {
  // Never fail the deploy over a prerender problem — the site works fine
  // without snapshots, bots just fall back to today's behaviour.
  console.error("prerender-bots failed (non-fatal):", err);
});
