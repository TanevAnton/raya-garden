#!/usr/bin/env node
/**
 * Lighthouse on the four pages the Meta ads actually land on.
 *
 * Why this exists: paid traffic is judged by whether the page renders before
 * the visitor gives up, and the only honest way to know is to measure the
 * built site under the network those visitors are on. Guessing which change
 * helped is how a performance push turns into a redesign with no numbers.
 *
 * Profile: Lighthouse's default mobile preset — a mid-tier Android
 * (Moto G Power class) with simulated Slow 4G: 150 ms RTT, 1.6 Mbps down,
 * 4x CPU slowdown. That is the "Slow 4G / mid-tier Android" profile, not an
 * approximation of it.
 *
 * What is real and what is not:
 *   · The page, its bundle, its CSS and its images are the real built
 *     artefacts, served by scripts/serve-dist.mjs with production's gzip and
 *     cache headers.
 *   · Sanity, Google Fonts, the Clock widget, GTM/GA4 and the Meta pixel are
 *     fetched over the network for real, so their weight and their place in
 *     the dependency graph are counted.
 *   · The hop between a phone in Bulgaria and SuperHosting is NOT reproduced;
 *     the HTML comes from localhost. Lighthouse then applies its own
 *     simulated RTT to every request, so the result is the cost the page
 *     imposes on itself. Real-world numbers will be worse by roughly one
 *     round trip to the host — the same amount before and after a change.
 *
 * Lighthouse is noisy, so each URL runs several times and the median run is
 * reported (median by LCP, all metrics taken from that one run so they stay
 * mutually consistent). The spread is printed too: a change smaller than the
 * spread has not been demonstrated.
 *
 *   node scripts/serve-dist.mjs --port 5300 &
 *   node scripts/lighthouse-landing.mjs --runs 3 --label before
 *
 * Writes perf/<label>.json next to the repo so before/after can be diffed:
 *   node scripts/lighthouse-landing.mjs --compare perf/before.json perf/after.json
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const BASE = process.env.BASE || argOf("base", "http://127.0.0.1:5300");
const RUNS = Number(argOf("runs", 3));
const LABEL = argOf("label", "run");
const OUT_DIR = argOf("out", "perf");

/** The pages the ads point at. Nothing else is measured — this is not a site audit. */
export const LANDING_PAGES = [
  { id: "events-bg", path: "/events?lang=bg" },
  { id: "event-ny-bg", path: "/event/nova-godina-2027?lang=bg" },
  { id: "event-ny-ro", path: "/event/nova-godina-2027?lang=ro" },
  { id: "hotel-bg", path: "/hotel?lang=bg" },
  { id: "restaurant-bg", path: "/restaurant?lang=bg" },
];

const METRICS = [
  ["lcp", "largest-contentful-paint", "ms"],
  ["tti", "interactive", "ms"],
  ["tbt", "total-blocking-time", "ms"],
  ["cls", "cumulative-layout-shift", ""],
  ["fcp", "first-contentful-paint", "ms"],
  ["si", "speed-index", "ms"],
  ["bytes", "total-byte-weight", "B"],
];

const fmt = (key, v) => {
  if (v === null || v === undefined) return "—";
  if (key === "cls") return v.toFixed(3);
  if (key === "bytes") return `${(v / 1024).toFixed(0)} kB`;
  return `${(v / 1000).toFixed(2)} s`;
};

/** Chrome: prefer the one already on disk over downloading another. */
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/** First `node` snippet anywhere in a Lighthouse details blob. */
function findNodeSnippet(details, depth = 0) {
  if (!details || depth > 6) return null;
  if (Array.isArray(details)) {
    for (const entry of details) {
      const found = findNodeSnippet(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof details !== "object") return null;
  if (details.type === "node" && details.snippet) return details.snippet;
  if (details.node?.snippet) return details.node.snippet;
  for (const value of Object.values(details)) {
    const found = findNodeSnippet(value, depth + 1);
    if (found) return found;
  }
  return null;
}

async function runOnce(url, chromeLauncher, lighthouse) {
  const flags = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    // Deterministic viewport; Lighthouse emulates the phone on top of it.
    "--window-size=412,823",
  ];
  // This sandbox reaches the outside world only through the agent proxy, so
  // Chrome has to be told about it or every third-party request fails and the
  // measurement quietly becomes "the page with no Sanity". Localhost is
  // bypassed automatically. In CI there is no proxy and this is skipped.
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) flags.push(`--proxy-server=${proxy}`);

  const chrome = await chromeLauncher.launch({
    chromeFlags: flags,
    chromePath: chromePath(),
  });
  try {
    const result = await lighthouse(
      url,
      { port: chrome.port, output: "json", logLevel: "error" },
      // Default mobile config: Moto-G-class CPU, simulated Slow 4G.
      { extends: "lighthouse:default", settings: { onlyCategories: ["performance"] } }
    );
    const lhr = result.lhr;
    const out = { url, score: Math.round((lhr.categories.performance.score ?? 0) * 100) };
    for (const [key, audit] of METRICS) {
      out[key] = lhr.audits[audit]?.numericValue ?? null;
    }
    // Which element is the LCP tells you what to fix; the number alone does not.
    // Lighthouse has moved this node around between versions (table of nodes,
    // then a list of sub-tables), so walk for the first node rather than
    // hard-coding a path that silently yields null.
    out.lcpElement = findNodeSnippet(
      lhr.audits["largest-contentful-paint-element"]?.details
    );
    // Render-blocking resources, biggest first — the other half of the story.
    out.blocking = (
      lhr.audits["render-blocking-resources"]?.details?.items ?? []
    ).map((i) => ({ url: i.url, ms: Math.round(i.wastedMs), kb: Math.round((i.totalBytes ?? 0) / 1024) }));
    out.heaviest = (lhr.audits["resource-summary"]?.details?.items ?? []).map((i) => ({
      type: i.resourceType,
      kb: Math.round(i.transferSize / 1024),
      n: i.requestCount,
    }));
    return out;
  } finally {
    await chrome.kill();
  }
}

/**
 * The median run by LCP, not a per-metric median: mixing the LCP of one run
 * with the TBT of another describes a page that never existed.
 */
function medianRun(runs) {
  const usable = runs.filter((r) => r && r.lcp != null);
  if (usable.length === 0) return runs[0] ?? null;
  const sorted = [...usable].sort((a, b) => a.lcp - b.lcp);
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  return {
    ...median,
    spread: {
      lcpMin: sorted[0].lcp,
      lcpMax: sorted[sorted.length - 1].lcp,
      n: usable.length,
    },
  };
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log(
    `${"page".padEnd(16)}${"LCP".padStart(9)}${"TTI".padStart(9)}${"TBT".padStart(9)}` +
      `${"CLS".padStart(8)}${"FCP".padStart(9)}${"transfer".padStart(11)}${"score".padStart(7)}`
  );
  console.log("-".repeat(78));
  for (const r of rows) {
    console.log(
      r.id.padEnd(16) +
        fmt("lcp", r.lcp).padStart(9) +
        fmt("tti", r.tti).padStart(9) +
        fmt("tbt", r.tbt).padStart(9) +
        fmt("cls", r.cls).padStart(8) +
        fmt("fcp", r.fcp).padStart(9) +
        fmt("bytes", r.bytes).padStart(11) +
        String(r.score).padStart(7)
    );
  }
}

async function compare(beforePath, afterPath) {
  const before = JSON.parse(await readFile(beforePath, "utf8"));
  const after = JSON.parse(await readFile(afterPath, "utf8"));
  const byId = Object.fromEntries(before.pages.map((p) => [p.id, p]));

  console.log(`\n${path.basename(beforePath)} → ${path.basename(afterPath)}\n`);
  console.log(
    `${"page".padEnd(16)}${"LCP".padStart(20)}${"TTI".padStart(20)}${"transfer".padStart(22)}`
  );
  console.log("-".repeat(78));
  for (const a of after.pages) {
    const b = byId[a.id];
    if (!b) continue;
    const pair = (key) => {
      const delta = a[key] != null && b[key] != null ? a[key] - b[key] : null;
      const pct = delta != null && b[key] ? ` (${((delta / b[key]) * 100).toFixed(0)}%)` : "";
      return `${fmt(key, b[key])} → ${fmt(key, a[key])}${pct}`;
    };
    console.log(
      a.id.padEnd(16) + pair("lcp").padStart(20) + pair("tti").padStart(20) + pair("bytes").padStart(22)
    );
  }
  console.log("");
}

async function main() {
  if (has("compare")) {
    const i = args.indexOf("--compare");
    await compare(args[i + 1], args[i + 2]);
    return;
  }

  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");

  console.log(`base       ${BASE}`);
  console.log(`profile    Lighthouse mobile default — Slow 4G (150 ms RTT, 1.6 Mbps), 4x CPU`);
  console.log(`runs       ${RUNS} per page, median by LCP`);
  console.log(`chrome     ${chromePath() || "(chrome-launcher default)"}`);

  const pages = [];
  for (const page of LANDING_PAGES) {
    const url = `${BASE}${page.path}`;
    process.stdout.write(`\n${page.id}  `);
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      try {
        runs.push(await runOnce(url, chromeLauncher, lighthouse));
        process.stdout.write("·");
      } catch (err) {
        process.stdout.write("x");
        console.error(`\n  run ${i + 1} failed: ${err.message}`);
      }
    }
    const median = medianRun(runs);
    if (median) pages.push({ id: page.id, path: page.path, ...median });
  }
  console.log("");

  printTable(`=== ${LABEL} ===`, pages);

  console.log("\nLCP element per page");
  for (const p of pages) {
    console.log(`  ${p.id.padEnd(16)} ${(p.lcpElement || "—").slice(0, 96)}`);
  }

  console.log("\nRender-blocking resources (median run)");
  for (const p of pages) {
    if (!p.blocking?.length) {
      console.log(`  ${p.id.padEnd(16)} none`);
      continue;
    }
    console.log(`  ${p.id}`);
    for (const b of p.blocking) {
      console.log(`      ${String(b.ms).padStart(5)} ms  ${String(b.kb).padStart(4)} kB  ${b.url.slice(0, 84)}`);
    }
  }

  console.log("\nSpread across runs (LCP min → max)");
  for (const p of pages) {
    const s = p.spread;
    console.log(
      `  ${p.id.padEnd(16)} ${s ? `${fmt("lcp", s.lcpMin)} → ${fmt("lcp", s.lcpMax)} over ${s.n} run(s)` : "—"}`
    );
  }

  await mkdir(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${LABEL}.json`);
  await writeFile(file, JSON.stringify({ label: LABEL, base: BASE, runs: RUNS, at: new Date().toISOString(), pages }, null, 2));
  console.log(`\nwrote ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
