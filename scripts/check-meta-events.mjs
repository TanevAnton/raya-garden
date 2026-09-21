#!/usr/bin/env node
/**
 * Drives the production build in a headless browser with window.fbq
 * captured, and prints every Meta Pixel event the site fires.
 *
 * Nothing about the pixel can be checked from the code alone: the events
 * fire from effects, from a delegated listener, and from a callback Clock
 * invokes, and the one that matters most — Purchase — carries a value that
 * is converted from cents. Sending 9900 instead of 99.00 inflates reported
 * revenue a hundredfold and looks entirely healthy in the code.
 *
 * The stub is installed before any page script runs. The pixel's own base
 * code begins `if (f.fbq) return;`, so it leaves the stub in place and
 * fbq('init', …) lands on it like everything else.
 *
 * Sanity, Formspree and the enquiry endpoint are all intercepted: this
 * sandbox cannot reach them, and stubbing them is also what makes the
 * success paths reachable on demand.
 *
 * Uses puppeteer, the driver prerender-bots.mjs already depends on.
 *
 *   npm run build && npx vite preview --port 5200
 *   BASE=http://127.0.0.1:5200 node scripts/check-meta-events.mjs
 *
 * Exits non-zero if an expectation fails.
 */
import puppeteer from "puppeteer";

const BASE = process.env.BASE || "http://127.0.0.1:5200";
const EVENT_SLUG = "nova-godina-2027";

// ── what Sanity would answer ─────────────────────────────────────────
const EVENT_DOC = {
  eyebrow: { bg: "31 декември", en: "31 December", ro: "31 decembrie" },
  title: {
    bg: "Нова година 2027 в RAYA Garden",
    en: "New Year 2027 at RAYA Garden",
    ro: "Revelion 2027 la RAYA Garden",
  },
  subtitle: { bg: "Три нощувки", en: "Three nights", ro: "Trei nopți" },
  heroImage: {
    _type: "image",
    asset: { _type: "reference", _ref: "image-abc1234567890abcdef1234567890abcdef123456-1600x900-jpg" },
  },
  highlights: { bg: [], en: [], ro: [] },
  gallery: [],
  offerPdfs: [],
};

const sanityAnswer = (url) => {
  const q = decodeURIComponent(url).replace(/\+/g, " ");
  if (q.includes("slug.current == $slug")) return EVENT_DOC;
  if (q.includes('_type == "eventPage"')) return [];
  if (q.includes("[0].phone")) return "+359 896 100 100";
  // A projection with [0] returns one document; everything else is a list,
  // and answering a list query with {} makes the page crash on .map —
  // which reads as "the pixel broke the site" when it was the stub.
  return q.includes("[0]") ? {} : [];
};

// ── the stub, installed before the page's own scripts ────────────────
const CAPTURE = () => {
  window.__fbqCalls = [];
  window.fbq = function () {
    window.__fbqCalls.push(Array.prototype.slice.call(arguments));
  };
  window.fbq.queue = [];
  window._fbq = window.fbq;
};

const fmt = (v) =>
  v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

const failures = [];
const rows = [];

function record(where, calls) {
  for (const call of calls) {
    if (call[0] !== "track") continue;
    rows.push({ where, event: call[1], params: call[2] || {}, opts: call[3] || {} });
  }
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

// Access-Control-Allow-Origin matters: Sanity and Formspree are
// cross-origin, and a stubbed response without it is rejected by the
// browser exactly like a network failure — which reads as "the event never
// fired" rather than "the test lied".
const json = (body) => ({
  status: 200,
  contentType: "application/json",
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  },
  body: JSON.stringify(body),
});

const open = async (path) => {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(CAPTURE);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(".sanity.io")) {
      return req.respond(json({ result: sanityAnswer(url) }));
    }
    // Both enquiry backends answer success, so the Lead paths are reachable.
    if (url.includes("formspree.io")) return req.respond(json({}));
    if (url.includes("/api/wedding-enquiry.php")) {
      return req.respond(json({ ok: true, reference: "RG-WD-TEST" }));
    }
    // Clock's real bundle would register its own callback; the page defines
    // ours regardless, and the funnel steps are invoked directly below.
    if (url.includes("clock-software.com")) return req.abort();
    if (url.includes("googletagmanager") || url.includes("facebook.net")) {
      return req.abort();
    }
    return req.continue();
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await sleep(1400);
  return page;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Set a React-controlled input without tripping its value tracker. */
async function fill(page, selector, value, index = 0) {
  await page.evaluate(
    ({ selector, value, index }) => {
      const el = document.querySelectorAll(selector)[index];
      if (!el) throw new Error(`no element for ${selector}[${index}]`);
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { selector, value, index }
  );
}

/** Click the first button/link whose text matches. */
async function clickText(page, re) {
  const clicked = await page.evaluate(
    ({ source, flags }) => {
      const rx = new RegExp(source, flags);
      const el = [...document.querySelectorAll("button, a")].find((e) =>
        rx.test((e.textContent || "").trim())
      );
      if (!el) return false;
      el.click();
      return true;
    },
    { source: re.source, flags: re.flags }
  );
  if (!clicked) throw new Error(`nothing clickable matching ${re}`);
}

// ── Part A: one page at a time ───────────────────────────────────────
for (const path of [
  "/?lang=bg",
  "/hotel?lang=bg",
  "/restaurant?lang=en",
  `/event/${EVENT_SLUG}?lang=ro`,
  "/events?lang=bg",
  "/park?lang=bg",
]) {
  const page = await open(path);
  record(path, await page.evaluate(() => window.__fbqCalls));
  await page.close();
}

// ── Part A: a tel: click ─────────────────────────────────────────────
{
  const page = await open("/contact?lang=bg");
  // The footer carries one on every page, but /contact is the page that
  // exists to show the number — and it renders without waiting on Sanity.
  await page.waitForSelector('a[href^="tel:"]', { timeout: 8000 });
  await page.evaluate(() => {
    window.__fbqCalls.length = 0;
    const a = document.querySelector('a[href^="tel:"]');
    if (!a) throw new Error("no tel: link found");
    // The production listener is on document in the capture phase, so it
    // has already run by the time this one cancels the navigation.
    a.addEventListener("click", (e) => e.preventDefault(), { once: true });
    a.click();
  });
  await sleep(300);
  record("tel: click", await page.evaluate(() => window.__fbqCalls));
  await page.close();
}

// ── Part A: the contact form, on a confirmed send ────────────────────
{
  const page = await open("/contact?lang=bg");
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await page.evaluate(() => {
    const proto = (el) => Object.getPrototypeOf(el);
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(proto(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    for (const el of document.querySelectorAll("form input, form textarea")) {
      if (el.type === "hidden" || el.name === "_gotcha") continue;
      set(el, el.type === "email" ? "test@example.com" : "Тест Тестов");
    }
  });
  await clickText(page, /Изпрати|Send/i);
  await sleep(1400);
  record("/contact submit", await page.evaluate(() => window.__fbqCalls));
  await page.close();
}

// ── Part A: the wedding configurator, on the endpoint's confirmation ──
{
  const page = await open("/svatben-konfigurator?lang=bg");
  const next = async () => {
    await clickText(page, /^Напред$/);
    await sleep(600);
  };
  await fill(page, "input[type=date]", "2027-06-12");
  await fill(page, "input[type=number]", "60", 0);
  await sleep(300);
  await next();
  await clickText(page, /^Избери$/);
  await sleep(400);
  await next();
  await next(); // extras: nothing is required to advance
  await fill(page, "input[type=text]", "Тест Тестов", 0);
  await fill(page, "input[type=tel]", "+359888123456", 0);
  await fill(page, "input[type=email]", "test@example.com", 0);
  await page.evaluate(() => {
    const boxes = document.querySelectorAll('input[type=checkbox]');
    const consent = boxes[boxes.length - 1];
    if (consent && !consent.checked) consent.click();
  });
  await sleep(200);
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await clickText(page, /Изпрати запитване/);
  await sleep(1800);
  record("/svatben-konfigurator submit", await page.evaluate(() => window.__fbqCalls));
  await page.close();
}

// ── Part A: StrictMode must not double-count ─────────────────────────
// The sharpest test of the guard there is. React StrictMode double-invokes
// every effect in development and not in a production build, so a dev
// server is where a missing guard shows up. Set DEV_BASE to a running
// `npm run dev` to include it; skipped otherwise.
if (process.env.DEV_BASE) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(CAPTURE);
  await page.goto(`${process.env.DEV_BASE}/hotel?lang=bg`, {
    waitUntil: "domcontentloaded",
  });
  await sleep(3000);
  const counts = await page.evaluate(() =>
    window.__fbqCalls
      .filter((c) => c[0] === "track")
      .reduce((acc, c) => ((acc[c[1]] = (acc[c[1]] || 0) + 1), acc), {})
  );
  console.log("\nStrictMode (dev build), /hotel:");
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(14)} x${v}`);
  if (counts.ViewContent !== 1) {
    failures.push(
      `ViewContent fired x${counts.ViewContent} under StrictMode, expected 1`
    );
  }
  if (counts.PageView !== 1) {
    failures.push(`PageView fired x${counts.PageView} under StrictMode, expected 1`);
  }
  await page.close();
} else {
  console.log("\n(StrictMode check skipped — set DEV_BASE to a `npm run dev` server)");
}

// ── An ad blocker removes fbq entirely ───────────────────────────────
// Roughly a third of European visitors block it. Every call site must be a
// no-op then, including the Clock callback, which must still report to GA4.
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message)));
  // No evaluateOnNewDocument here on purpose. Making fbq unassignable is
  // not what a blocker does — it would break the pixel's own inline
  // snippet, which assigns the queueing stub and then calls fbq('init').
  // The two real cases are covered below instead: the remote script
  // blocked (stub present, calls queue), and fbq gone entirely.
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes(".sanity.io")) return req.respond(json({ result: sanityAnswer(u) }));
    if (u.includes("connect.facebook.net")) return req.abort();
    if (u.includes("clock-software.com") || u.includes("googletagmanager")) {
      return req.abort();
    }
    return req.continue();
  });
  await page.goto(`${BASE}/hotel?lang=bg`, { waitUntil: "domcontentloaded" });
  await sleep(1500);

  const rendered = await page.evaluate(
    () => !!document.querySelector("h1") && document.body.innerText.length > 200
  );
  // Case two: fbq removed outright, as a scriptlet-blocking filter does.
  await page.evaluate(() => delete window.fbq);
  const clockOk = await page.evaluate(() => {
    const gtagCalls = [];
    const real = window.gtag;
    window.gtag = (...a) => gtagCalls.push(a);
    let threw = false;
    try {
      window.clockPmsWbePageViewCallback({
        pageName: "completed",
        totalPriceCents: 9900,
        totalPriceCurrency: "EUR",
        bookingNumbers: ["BK-9"],
        hotelName: "X",
      });
    } catch {
      threw = true;
    }
    window.gtag = real;
    return { threw, gtagFired: gtagCalls.length > 0 };
  });

  // With fbq gone, the site's own call sites must be no-ops too.
  const siteOk = await page.evaluate(() => {
    try {
      const a = document.querySelector('a[href^="tel:"]');
      if (a) {
        a.addEventListener("click", (e) => e.preventDefault(), { once: true });
        a.click();
      }
      return true;
    } catch {
      return false;
    }
  });
  if (!siteOk) failures.push("a tel: click threw with the pixel removed");

  console.log(
    `\nno pixel: page rendered ${rendered ? "yes" : "NO"}, ` +
      `page errors ${errors.length}, ` +
      `Clock callback ${clockOk.threw ? "THREW" : "fine"}, ` +
      `GA4 ${clockOk.gtagFired ? "still fired" : "DID NOT FIRE"}`
  );
  if (!rendered) failures.push("the page did not render with the pixel blocked");
  if (errors.length) failures.push(`page errors with the pixel blocked: ${errors[0]}`);
  if (clockOk.threw) failures.push("the Clock callback threw with the pixel blocked");
  if (!clockOk.gtagFired) failures.push("GA4 did not fire with the pixel blocked");
  await page.close();
}

// ── Part B: every Clock funnel step ──────────────────────────────────
const CLOCK_STEPS = [
  { pageName: "rooms", arrival: "2027-06-12", departure: "2027-06-14", stay: 2, hotelName: "RAYA Garden" },
  { pageName: "rates", arrival: "2027-06-12", departure: "2027-06-14", roomTypeName: "Double Deluxe", hotelName: "RAYA Garden" },
  { pageName: "extras", arrival: "2027-06-12", departure: "2027-06-14", roomTypeName: "Double Deluxe", hotelName: "RAYA Garden" },
  { pageName: "checkout", arrival: "2027-06-12", departure: "2027-06-14", roomCount: 2, totalPriceCents: 9900, totalPriceCurrency: "EUR", hotelName: "RAYA Garden" },
  { pageName: "completed", arrival: "2027-06-12", departure: "2027-06-14", roomCount: 2, totalPriceCents: 9900, totalPriceCurrency: "EUR", bookingNumbers: ["BK-1", "BK-2"], hotelName: "RAYA Garden" },
  { pageName: "offer", offerNumber: 55123, hotelName: "RAYA Garden" },
];

{
  const page = await open("/book?lang=bg");
  for (const step of CLOCK_STEPS) {
    await page.evaluate((s) => {
      window.__fbqCalls.length = 0;
      window.clockPmsWbePageViewCallback(s);
    }, step);
    record(`clock: ${step.pageName}`, await page.evaluate(() => window.__fbqCalls));
  }

  // The Google reporter must survive a Meta failure and vice versa.
  const isolation = await page.evaluate(() => {
    const gtagCalls = [];
    const realGtag = window.gtag;
    window.gtag = (...a) => gtagCalls.push(a);
    const realFbq = window.fbq;
    window.fbq = () => {
      throw new Error("pixel exploded");
    };
    let threw = false;
    try {
      window.clockPmsWbePageViewCallback({ pageName: "rooms", hotelName: "X" });
    } catch {
      threw = true;
    }
    window.gtag = realGtag;
    window.fbq = realFbq;
    return { threw, gtagFired: gtagCalls.length > 0 };
  });
  if (isolation.threw) failures.push("a throwing fbq propagated out of the Clock callback");
  if (!isolation.gtagFired) failures.push("a throwing fbq stopped the GA4 reporter");
  console.log(
    `\nisolation: fbq threw → callback ${isolation.threw ? "PROPAGATED (bad)" : "contained"}, ` +
      `GA4 ${isolation.gtagFired ? "still fired" : "was blocked (bad)"}`
  );
  await page.close();
}

await browser.close();

// ── report ───────────────────────────────────────────────────────────
console.log(`\n${"=".repeat(96)}\n  META PIXEL EVENTS\n${"=".repeat(96)}`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("EVENT", 18) + pad("WHERE", 32) + "PARAMS");
console.log("-".repeat(96));
for (const r of rows) {
  const params = Object.entries(r.params)
    .map(([k, v]) => `${k}=${fmt(v)}`)
    .join("  ");
  console.log(pad(r.event, 18) + pad(r.where, 32) + params);
  if (r.opts.eventID) console.log(pad("", 50) + `eventID=${r.opts.eventID}`);
}

// ── expectations ─────────────────────────────────────────────────────
const find = (event, where) => rows.find((r) => r.event === event && r.where.includes(where));

const expect = [
  ["ViewContent", "/hotel", { content_type: "hotel_room", content_ids: ["hotel"] }],
  ["ViewContent", "/restaurant", { content_type: "restaurant", content_ids: ["restaurant"] }],
  ["ViewContent", `/event/${EVENT_SLUG}`, { content_type: "event", content_ids: [EVENT_SLUG] }],
  ["Contact", "tel:", {}],
  ["Lead", "/contact submit", { content_name: "Contact form" }],
  ["Lead", "/svatben-konfigurator submit", { content_name: "Wedding configurator" }],
  ["Search", "clock: rooms", {}],
  ["ViewContent", "clock: rates", { content_name: "Double Deluxe" }],
  ["AddToCart", "clock: extras", { content_name: "Double Deluxe" }],
  ["InitiateCheckout", "clock: checkout", { value: 99, currency: "EUR", num_items: 2 }],
  ["Purchase", "clock: completed", { value: 99, currency: "EUR", num_items: 2 }],
  ["Lead", "clock: offer", { content_ids: ["55123"] }],
];

for (const [event, where, want] of expect) {
  const got = find(event, where);
  if (!got) {
    failures.push(`${event} never fired at ${where}`);
    continue;
  }
  for (const [k, v] of Object.entries(want)) {
    const actual = JSON.stringify(got.params[k]);
    if (actual !== JSON.stringify(v)) {
      failures.push(`${event} at ${where}: ${k} is ${actual}, expected ${JSON.stringify(v)}`);
    }
  }
}

// The one that silently ruins reported revenue.
const purchase = find("Purchase", "clock: completed");
if (purchase) {
  if (purchase.params.value === 9900) {
    failures.push("Purchase value is 9900 — cents were not converted");
  } else if (purchase.params.value !== 99) {
    failures.push(`Purchase value is ${purchase.params.value}, expected 99`);
  }
  if (purchase.opts.eventID !== "clock-BK-1-BK-2") {
    failures.push(`Purchase eventID is ${purchase.opts.eventID}, expected clock-BK-1-BK-2`);
  }
  console.log(
    `\ncents: totalPriceCents 9900 → value ${purchase.params.value}` +
      ` (${purchase.params.value === 99 ? "99.00, correct" : "WRONG"})`
  );
}

// Nulls must never reach Meta.
const search = find("Search", "clock: rooms");
if (search && ("content_name" in search.params || "content_ids" in search.params)) {
  failures.push("Search carried empty content params that should have been stripped");
}
const rates = find("ViewContent", "clock: rates");
if (rates && "value" in rates.params) {
  failures.push("rates ViewContent carried a null value that should have been stripped");
}

// Every site-side event needs a dedup id for the Conversions API later.
// The Clock funnel is exempt only for its deterministic Purchase id.
for (const r of rows.filter((x) => !x.where.startsWith("clock:"))) {
  if (!r.opts.eventID) failures.push(`${r.event} at ${r.where} has no eventID`);
}
const clockPurchase = rows.find((r) => r.where === "clock: completed");
if (clockPurchase && !clockPurchase.opts.eventID) {
  failures.push("the Clock Purchase has no eventID");
}

// PageView must not be duplicated by the funnel.
if (rows.some((r) => r.where.startsWith("clock:") && r.event === "PageView")) {
  failures.push("the Clock funnel fired PageView — the site pixel already does");
}

console.log(`\n${"=".repeat(96)}`);
if (failures.length === 0) {
  console.log(`PASS — ${rows.length} events, all expectations met.`);
} else {
  console.log(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
