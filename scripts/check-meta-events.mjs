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
// Any other event page. The Sanity stub answers every slug with the same
// document; the pixel classifies pages by slug, so that is all it takes.
const OTHER_EVENT_SLUG = "firmeno-parti-2026";

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
    if (call[0] !== "track" && call[0] !== "trackCustom") continue;
    rows.push({ where, kind: call[0], event: call[1], params: call[2] || {}, opts: call[3] || {} });
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
const json = (body, status = 200) => ({
  status,
  contentType: "application/json",
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  },
  body: JSON.stringify(body),
});

const formspreeBodies = [];

const open = async (path, { failBackends = false, mobile = false } = {}) => {
  const page = await browser.newPage();
  if (mobile) {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  }
  await page.evaluateOnNewDocument(CAPTURE);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes(".sanity.io")) {
      return req.respond(json({ result: sanityAnswer(url) }));
    }
    // Both enquiry backends answer success, so the Lead paths are reachable
    // — or, with failBackends, refuse, to prove a Lead needs a real success.
    if (url.includes("formspree.io")) {
      formspreeBodies.push(req.postData() || "");
      return req.respond(failBackends ? json({ errors: [{ message: "test refusal" }] }, 422) : json({}));
    }
    if (url.includes("/api/wedding-enquiry.php")) {
      return req.respond(
        failBackends ? json({ ok: false, errors: { email: "invalid" } }, 422)
                     : json({ ok: true, reference: "RG-WD-TEST" })
      );
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

// ── Part A: contact links — every method, every category ────────────
// Real links where the site has them (/contact's phone and email). Viber
// and WhatsApp links do not exist on the site yet, so those are injected —
// which exercises the same delegated listener a future real link would hit.
// Each click is cancelled after the capture-phase listener has run, so no
// dialler or mail client opens. `count` pins "fires once".
const CONTACT_CASES = [
  { where: "contact link: tel on /contact", path: "/contact?lang=bg", real: 'a[href^="tel:"]' },
  { where: "contact link: mailto on /contact", path: "/contact?lang=bg", real: 'main a[href^="mailto:"]' },
  { where: "contact link: tel on /hotel", path: "/hotel?lang=bg", href: "tel:+359896100100" },
  { where: "contact link: tel on /events", path: "/events?lang=bg", href: "tel:+359896100100" },
  { where: "contact link: viber on /restaurant", path: "/restaurant?lang=en", href: "viber://chat?number=%2B359896100100" },
  { where: `contact link: wa.me on /event/${EVENT_SLUG}`, path: `/event/${EVENT_SLUG}?lang=ro`, href: "https://wa.me/359896100100" },
  { where: "contact link: api.whatsapp on /events", path: "/events?lang=bg", href: "https://api.whatsapp.com/send?phone=359896100100" },
  { where: "contact link: tel on /events?for=corporate", path: "/events?for=corporate&lang=bg", href: "tel:+359896100100" },
  { where: "contact link: mailto on /events", path: "/events?lang=bg", href: "mailto:hotel@svetagora.bg" },
  { where: "contact link: viber on /events", path: "/events?lang=bg", href: "viber://chat?number=%2B359896100100" },
  { where: `contact link: tel on /event/${OTHER_EVENT_SLUG}`, path: `/event/${OTHER_EVENT_SLUG}?lang=bg`, href: "tel:+359896100100" },
  { where: "contact link: tel on / (home)", path: "/?lang=bg", href: "tel:+359896100100" },
  { where: "contact link: ordinary link on /hotel", path: "/hotel?lang=bg", href: "/contact" },
];
for (const c of CONTACT_CASES) {
  const page = await open(c.path);
  if (c.real) await page.waitForSelector(c.real, { timeout: 8000 });
  await page.evaluate(({ real, href }) => {
    window.__fbqCalls.length = 0;
    let a = real ? document.querySelector(real) : null;
    if (!a) {
      a = document.createElement("a");
      a.href = href;
      a.textContent = "test link";
      document.querySelector("main").appendChild(a);
    }
    // The production listener is on document in the capture phase, so it
    // has already run by the time this one cancels the navigation.
    a.addEventListener("click", (e) => e.preventDefault(), { once: true });
    a.click();
  }, c);
  await sleep(300);
  record(c.where, await page.evaluate(() => window.__fbqCalls));
  await page.close();
}

// ── Part A: the contact form — Lead on a confirmed send, and only then ──
// topic: index into the dropdown (same order in every language).
// empty: leave the required fields blank, so the browser refuses to submit.
async function submitContact(where, { topic = 0, failBackends = false, empty = false } = {}) {
  const page = await open("/contact?lang=bg", { failBackends });
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await page.evaluate(({ topic, empty }) => {
    const proto = (el) => Object.getPrototypeOf(el);
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(proto(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (!empty) {
      for (const el of document.querySelectorAll("form input, form textarea")) {
        if (el.type === "hidden" || el.name === "_gotcha") continue;
        set(el, el.type === "email" ? "test@example.com" : "Тест Тестов");
      }
    }
    const select = document.querySelector("form select");
    if (select) set(select, select.options[topic].value);
  }, { topic, empty });
  await clickText(page, /Изпрати|Send/i);
  await sleep(1400);
  record(where, await page.evaluate(() => window.__fbqCalls));
  await page.close();
}
await submitContact("/contact submit [topic: Резервация]", { topic: 0 });
await submitContact("/contact submit [topic: Сватба или събитие]", { topic: 1 });
await submitContact("/contact submit [topic: Ресторант]", { topic: 2 });
await submitContact("/contact submit [topic: Езеро]", { topic: 3 });
await submitContact("/contact submit refused by Formspree", { failBackends: true });
await submitContact("/contact submit with required fields empty", { empty: true });

// ── Part A: the wedding configurator — Lead on the endpoint's confirmation ─
async function submitConfigurator(where, { failBackends = false, consent = true } = {}) {
  const page = await open("/svatben-konfigurator?lang=bg", { failBackends });
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
  if (consent) {
    await page.evaluate(() => {
      const boxes = document.querySelectorAll('input[type=checkbox]');
      const box = boxes[boxes.length - 1];
      if (box && !box.checked) box.click();
    });
  }
  await sleep(200);
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await clickText(page, /Изпрати запитване/);
  await sleep(1800);
  record(where, await page.evaluate(() => window.__fbqCalls));
  await page.close();
}
await submitConfigurator("/svatben-konfigurator submit");
await submitConfigurator("/svatben-konfigurator submit refused by the endpoint", { failBackends: true });
await submitConfigurator("/svatben-konfigurator submit without consent", { consent: false });

// ── Part A: the /events enquiry form (and the mobile bar) ───────────
// fields: which of name/phone/type/guests/month/consent to fill; anything
// left out stays empty, so the browser's own validation must stop the
// submit before any code — or any Lead — runs.
const subjectOf = (body) => (/name="_subject"\r\n\r\n([^\r]*)/.exec(body) || [])[1] || null;
async function submitEventsEnquiry(where, {
  path = "/events?lang=bg",
  failBackends = false,
  fields = { name: true, phone: true, type: "wedding", guests: "20-50", month: "unknown", consent: true },
} = {}) {
  const page = await open(path, { failBackends, mobile: true });
  await page.waitForSelector("#enquiry form", { timeout: 8000 });
  const sentBefore = formspreeBodies.length;
  if (fields.name) await fill(page, '#enquiry input[autocomplete="name"]', "Тест Тестов");
  if (fields.phone) await fill(page, '#enquiry input[type="tel"]', "+359888123456");
  if (fields.type) await fill(page, "#enquiry select", fields.type, 0);
  if (fields.guests) await fill(page, "#enquiry select", fields.guests, 1);
  if (fields.month) await fill(page, "#enquiry select", fields.month, 2);
  if (fields.consent) await page.evaluate(() => document.querySelector('#enquiry input[type="checkbox"]').click());
  await sleep(200);
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await page.evaluate(() => document.querySelector('#enquiry button[type="submit"]').click());
  await sleep(1400);
  record(where, await page.evaluate(() => window.__fbqCalls));
  const sent = formspreeBodies.slice(sentBefore);
  enquiryPosts[where] = { count: sent.length, subject: sent.length ? subjectOf(sent[0]) : null };
  await page.close();
}
const enquiryPosts = {};
await submitEventsEnquiry("/events?for=corporate enquiry sent", {
  path: "/events?for=corporate&lang=bg",
  fields: { name: true, phone: true, type: null, guests: "50-100", month: "unknown", consent: true },
});
await submitEventsEnquiry("/events enquiry sent [Сватба]");
await submitEventsEnquiry("/events enquiry refused by Formspree", { failBackends: true });
await submitEventsEnquiry("/events enquiry without consent", {
  fields: { name: true, phone: true, type: "wedding", guests: "20-50", month: "unknown", consent: false },
});
await submitEventsEnquiry("/events enquiry with name empty", {
  fields: { name: false, phone: true, type: "wedding", guests: "20-50", month: "unknown", consent: true },
});
await submitEventsEnquiry("/events enquiry with type not chosen", {
  fields: { name: true, phone: true, type: null, guests: "20-50", month: "unknown", consent: true },
});

// The call button in the block, and the mobile bar on /events and an event page.
async function tap(where, path, selector) {
  const page = await open(path, { mobile: true });
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.evaluate((sel) => {
    window.__fbqCalls.length = 0;
    const a = document.querySelector(sel);
    // Cancel the dialler; the capture-phase listener has already run.
    if (a.tagName === "A") a.addEventListener("click", (e) => e.preventDefault(), { once: true });
    a.click();
  }, selector);
  await sleep(700);
  record(where, await page.evaluate(() => window.__fbqCalls));
  const url = await page.evaluate(() => location.pathname + location.hash);
  await page.close();
  return url;
}
await tap("/events enquiry call button", "/events?lang=bg", '#enquiry a[href^="tel:"]');
await tap("/events mobile bar: call", "/events?lang=bg", 'div.fixed.bottom-0 a[href^="tel:"]');
await tap("/events mobile bar: Запитване", "/events?lang=bg", "div.fixed.bottom-0 button");
await tap(`/event/${EVENT_SLUG} mobile bar: call`, `/event/${EVENT_SLUG}?lang=bg`, 'div.fixed.bottom-0 a[href^="tel:"]');
await tap("/events?for=corporate mobile bar: call", "/events?for=corporate&lang=bg", 'div.fixed.bottom-0 a[href^="tel:"]');
await tap(`/event/${OTHER_EVENT_SLUG} mobile bar: call`, `/event/${OTHER_EVENT_SLUG}?lang=bg`, 'div.fixed.bottom-0 a[href^="tel:"]');
const barLanding = await tap(`/event/${EVENT_SLUG} mobile bar: Запитване`, `/event/${EVENT_SLUG}?lang=bg`, "div.fixed.bottom-0 button");

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
const find = (event, where) =>
  rows.find((r) => r.event === event && (r.where === where || (r.where.includes(where) && !r.where.includes(" refused") && !r.where.includes(" without") && !r.where.includes(" empty") && !r.where.includes(" not chosen"))));

const expect = [
  ["ViewContent", "/hotel", { content_type: "hotel_room", content_ids: ["hotel"] }],
  ["ViewContent", "/restaurant", { content_type: "restaurant", content_ids: ["restaurant"] }],
  ["ViewContent", `/event/${EVENT_SLUG}`, { content_type: "event", content_ids: [EVENT_SLUG] }],
  // Contact: method always; content_category only on the four ad sections.
  ["Contact", "contact link: tel on /contact", { method: "phone", content_category: undefined }],
  ["Contact", "contact link: mailto on /contact", { method: "email", content_category: undefined }],
  ["Contact", "contact link: tel on /hotel", { method: "phone", content_category: "hotel" }],
  ["Contact", "contact link: tel on /events", { method: "phone", content_category: "events" }],
  ["Contact", "contact link: viber on /restaurant", { method: "viber", content_category: "restaurant" }],
  ["Contact", `contact link: wa.me on /event/${EVENT_SLUG}`, { method: "whatsapp", content_category: "nye" }],
  ["Contact", "contact link: api.whatsapp on /events", { method: "whatsapp", content_category: "events" }],
  ["Contact", "contact link: tel on /events?for=corporate", { method: "phone", content_category: "events" }],
  ["Contact", "contact link: mailto on /events", { method: "email", content_category: "events" }],
  ["Contact", "contact link: viber on /events", { method: "viber", content_category: "events" }],
  ["Contact", `contact link: tel on /event/${OTHER_EVENT_SLUG}`, { method: "phone", content_category: "events" }],
  ["Contact", "contact link: tel on / (home)", { method: "phone", content_category: undefined }],
  // Lead: content_category from the form or the topic chosen.
  ["Lead", "/contact submit [topic: Резервация]", { content_name: "Contact form", content_category: "hotel" }],
  ["Lead", "/contact submit [topic: Сватба или събитие]", { content_category: "events" }],
  ["Lead", "/contact submit [topic: Ресторант]", { content_category: "restaurant" }],
  ["Lead", "/contact submit [topic: Езеро]", { content_category: undefined }],
  ["Lead", "/svatben-konfigurator submit", { content_name: "Wedding configurator", content_category: "events" }],
  ["Lead", "/events?for=corporate enquiry sent", { content_name: "Events enquiry form", content_category: "events", event_type: "corporate" }],
  ["Lead", "/events enquiry sent [Сватба]", { content_category: "events", event_type: "wedding" }],
  ["Contact", "/events enquiry call button", { method: "phone", content_category: "events" }],
  ["Contact", "/events mobile bar: call", { method: "phone", content_category: "events" }],
  ["Contact", `/event/${EVENT_SLUG} mobile bar: call`, { method: "phone", content_category: "nye" }],
  ["Search", "clock: rooms", {}],
  ["ViewContent", "clock: rates", { content_name: "Double Deluxe" }],
  ["AddToCart", "clock: extras", { content_name: "Double Deluxe" }],
  ["InitiateCheckout", "clock: checkout", { value: 99, currency: "EUR", num_items: 2 }],
  ["Purchase", "clock: completed", { value: 99, currency: "EUR", num_items: 2 }],
  ["Lead", "clock: offer", { content_ids: ["55123"], content_category: "hotel" }],
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

// Exactly one event per action — a second would double-count in Ads Manager.
for (const c of CONTACT_CASES) {
  const n = rows.filter((r) => r.where === c.where && r.event === "Contact").length;
  const want = c.href === "/contact" ? 0 : 1;
  if (n !== want) failures.push(`${c.where}: Contact fired ${n} time(s), expected ${want}`);
}
for (const where of [
  "/contact submit [topic: Резервация]",
  "/contact submit [topic: Сватба или събитие]",
  "/contact submit [topic: Ресторант]",
  "/contact submit [topic: Езеро]",
  "/svatben-konfigurator submit",
  "/events?for=corporate enquiry sent",
  "/events enquiry sent [Сватба]",
]) {
  const n = rows.filter((r) => r.where === where && r.event === "Lead").length;
  if (n !== 1) failures.push(`${where}: Lead fired ${n} time(s), expected exactly 1`);
}
// Taps are Contact at most, never Lead; the bar's "Запитване" is neither.
for (const where of [
  "/events enquiry call button",
  "/events mobile bar: call",
  `/event/${EVENT_SLUG} mobile bar: call`,
  "/events?for=corporate mobile bar: call",
  `/event/${OTHER_EVENT_SLUG} mobile bar: call`,
]) {
  const n = rows.filter((r) => r.where === where && r.event === "Contact").length;
  if (n !== 1) failures.push(`${where}: Contact fired ${n} time(s), expected exactly 1`);
}
// What reaches Formspree — and so hotel@svetagora.bg.
for (const [where, subject] of [
  ["/events?for=corporate enquiry sent", "Запитване за събитие – Фирмено"],
  ["/events enquiry sent [Сватба]", "Запитване за събитие – Сватба"],
]) {
  const got = enquiryPosts[where];
  if (!got || got.count !== 1) failures.push(`${where}: ${got?.count ?? 0} Formspree post(s), expected 1`);
  else if (got.subject !== subject) failures.push(`${where}: subject "${got.subject}", expected "${subject}"`);
  else console.log(`email subject, correctly: "${got.subject}"`);
}
for (const where of [
  "/events enquiry without consent",
  "/events enquiry with name empty",
  "/events enquiry with type not chosen",
]) {
  const got = enquiryPosts[where];
  if (got?.count) failures.push(`${where}: reached Formspree — the browser should have stopped it`);
}
if (barLanding !== "/events#enquiry") {
  failures.push(`event page bar "Запитване" landed on ${barLanding}, expected /events#enquiry`);
} else {
  console.log(`event page bar "Запитване", correctly → ${barLanding}`);
}
// Never on a click, a refusal or a validation error.
for (const where of [
  "/contact submit refused by Formspree",
  "/contact submit with required fields empty",
  "/svatben-konfigurator submit refused by the endpoint",
  "/svatben-konfigurator submit without consent",
  "/events enquiry refused by Formspree",
  "/events enquiry without consent",
  "/events enquiry with name empty",
  "/events enquiry with type not chosen",
  "/events enquiry call button",
  "/events mobile bar: call",
  "/events mobile bar: Запитване",
  `/event/${EVENT_SLUG} mobile bar: Запитване`,
]) {
  const n = rows.filter((r) => r.where === where && r.event === "Lead").length;
  if (n !== 0) failures.push(`${where}: Lead fired ${n} time(s) — it must not`);
  else console.log(`no Lead, correctly: ${where}`);
}

// EventEnquiry: the custom event that sits beside Lead (a form) or Contact
// (a tap) on the event pages. Exactly once, with exactly these params, where
// listed — and nowhere else in this whole run: not on page loads, not from
// /contact or the hotel, restaurant, home or New Year pages, not from the
// bar's "Запитване", not on a refused or invalid submit, not in the Clock
// funnel. `undefined` means the key must be absent.
const ENQUIRY_FIRES = {
  "/events?for=corporate enquiry sent": { method: "form", event_type: "corporate" },
  "/events enquiry sent [Сватба]": { method: "form", event_type: "wedding" },
  "/svatben-konfigurator submit": { method: "form", event_type: "wedding" },
  "contact link: tel on /events": { method: "phone" },
  "contact link: tel on /events?for=corporate": { method: "phone", event_type: "corporate" },
  "contact link: mailto on /events": { method: "email" },
  "contact link: viber on /events": { method: "viber" },
  "contact link: api.whatsapp on /events": { method: "whatsapp" },
  [`contact link: tel on /event/${OTHER_EVENT_SLUG}`]: { method: "phone" },
  "/events enquiry call button": { method: "phone" },
  "/events mobile bar: call": { method: "phone" },
  "/events?for=corporate mobile bar: call": { method: "phone", event_type: "corporate" },
  [`/event/${OTHER_EVENT_SLUG} mobile bar: call`]: { method: "phone" },
};
const everyWhere = new Set([...rows.map((r) => r.where), ...Object.keys(ENQUIRY_FIRES)]);
let enquiryFires = 0;
let enquirySilent = 0;
for (const where of everyWhere) {
  const got = rows.filter((r) => r.where === where && r.event === "EventEnquiry");
  const want = ENQUIRY_FIRES[where];
  if (!want) {
    if (got.length) failures.push(`${where}: EventEnquiry fired ${got.length} time(s) — it must not`);
    else enquirySilent++;
    continue;
  }
  if (got.length !== 1) {
    failures.push(`${where}: EventEnquiry fired ${got.length} time(s), expected exactly 1`);
    continue;
  }
  if (got[0].kind !== "trackCustom") failures.push(`${where}: EventEnquiry sent with fbq('${got[0].kind}'), expected trackCustom`);
  if (JSON.stringify(got[0].params) !== JSON.stringify(want)) {
    failures.push(`${where}: EventEnquiry params ${JSON.stringify(got[0].params)}, expected ${JSON.stringify(want)}`);
  } else enquiryFires++;
}
console.log(`\nEventEnquiry: exactly once with the right params at ${enquiryFires}/${Object.keys(ENQUIRY_FIRES).length} actions; silent, correctly, at the other ${enquirySilent}`);
for (const where of [
  "contact link: tel on /hotel",
  "contact link: viber on /restaurant",
  "contact link: tel on / (home)",
  "contact link: tel on /contact",
  `contact link: wa.me on /event/${EVENT_SLUG}`,
  `/event/${EVENT_SLUG} mobile bar: call`,
  "/events mobile bar: Запитване",
  `/event/${EVENT_SLUG} mobile bar: Запитване`,
  "/contact submit [topic: Сватба или събитие]",
  "/events enquiry refused by Formspree",
  "/events enquiry without consent",
  "/events enquiry with name empty",
  "/events enquiry with type not chosen",
  "/svatben-konfigurator submit refused by the endpoint",
  "/svatben-konfigurator submit without consent",
]) {
  if (!rows.some((r) => r.where === where && r.event === "EventEnquiry")) console.log(`no EventEnquiry, correctly: ${where}`);
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
