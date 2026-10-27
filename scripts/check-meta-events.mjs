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

const ROOM_DOC = {
  _id: "room-double",
  slug: "double",
  name: { bg: "Двойна стая", en: "Double room", ro: "Cameră dublă" },
  price: 90,
  sleeps: 2,
  amenities: { bg: [], en: [], ro: [] },
};

const sanityAnswer = (url) => {
  const q = decodeURIComponent(url).replace(/\+/g, " ");
  if (q.includes("slug.current == $slug")) return EVENT_DOC;
  // One room, so /hotel shows a room card and its «Резервирай» button.
  if (q.includes('_type == "room"')) return [ROOM_DOC];
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
const weddingPosts = [];

const open = async (path, { failBackends = false, mobile = false, size = null } = {}) => {
  const page = await browser.newPage();
  if (size) {
    await page.setViewport({ ...size, isMobile: size.width < 768, hasTouch: size.width < 768 });
  } else if (mobile) {
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
    // — or, with failBackends, refuse, to prove a Lead needs a real success;
    // with failBackends "network", never answer at all.
    if (url.includes("formspree.io")) {
      formspreeBodies.push(req.postData() || "");
      if (failBackends === "network") return req.abort("failed");
      return req.respond(failBackends ? json({ errors: [{ message: "test refusal" }] }, 422) : json({}));
    }
    if (url.includes("/api/wedding-enquiry.php")) {
      if (req.method() === "POST") weddingPosts.push(req.postData() || "");
      if (failBackends === "network") return req.abort("failed");
      if (failBackends) return req.respond(json({ ok: false, errors: { email: "invalid" } }, 422));
      // As the real endpoint does: a filled honeypot gets a success-shaped
      // answer with the all-zero reference, and nothing is sent.
      let website = "";
      try { website = String(JSON.parse(req.postData() || "{}").website || "").trim(); } catch { /* not JSON */ }
      return req.respond(json({ ok: true, reference: website ? "RG-WD-00000000-0000" : "RG-WD-TEST" }));
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
  { where: "contact link: tel on /svatben-konfigurator", path: "/svatben-konfigurator?lang=bg", real: 'footer a[href^="tel:"]' },
  { where: "contact link: mailto on /svatben-konfigurator", path: "/svatben-konfigurator?lang=bg", href: "mailto:hotel@svetagora.bg" },
  { where: "contact link: viber on /svatben-konfigurator", path: "/svatben-konfigurator?lang=bg", href: "viber://chat?number=%2B359896100100" },
  { where: "contact link: wa.me on /svatben-konfigurator", path: "/svatben-konfigurator?lang=bg", href: "https://wa.me/359896100100" },
  { where: "contact link: tel on /svatben-konfigurator?for=corporate", path: "/svatben-konfigurator?for=corporate&lang=bg", href: "tel:+359896100100" },
  { where: "contact link: tel on /winery", path: "/winery?lang=bg", href: "tel:+359896100100" },
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

// ── Part A: «Резервирай» — BookingIntent ─────────────────────────────
// Every booking button is a link to /book, clicked here as it is on the
// site (React Router then moves to /book in the same tab). Desktop and
// phone widths, since the nav's button is a different link on each: on a
// phone it is inside the menu.
async function bookTap(where, path, { mobile = false, menu = false, scope = "main", text = null } = {}) {
  const page = await open(path, { mobile });
  if (menu) {
    await page.click('button[aria-controls="mobile-nav"]');
    await sleep(700);
  }
  await page.waitForSelector(`${scope} a[href="/book"]`, { timeout: 8000 });
  await page.evaluate(({ scope, text }) => {
    window.__fbqCalls.length = 0;
    const a = [...document.querySelectorAll(`${scope} a[href="/book"]`)].find(
      (x) => x.offsetParent !== null && (!text || x.textContent.trim().startsWith(text))
    );
    if (!a) throw new Error(`no visible /book link in ${scope}${text ? ` reading ${text}` : ""}`);
    a.click();
  }, { scope, text });
  await sleep(800);
  record(where, await page.evaluate(() => window.__fbqCalls));
  bookLanded[where] = await page.evaluate(() => location.pathname);
  await page.close();
}
const bookLanded = {};
await bookTap("book: nav button on / (desktop)", "/?lang=bg", { scope: "header" });
await bookTap("book: hero button on / (desktop)", "/?lang=bg", { text: "Резервирай престой" });
await bookTap("book: closing button on / (desktop)", "/?lang=bg", { text: "Резервирай онлайн" });
await bookTap("book: button on /hotel (desktop)", "/hotel?lang=bg");
await bookTap(`book: button on /event/${EVENT_SLUG} (desktop)`, `/event/${EVENT_SLUG}?lang=bg`);
await bookTap("book: menu button on / (phone)", "/?lang=bg", { mobile: true, menu: true, scope: "#mobile-nav" });
await bookTap("book: hero button on / (phone)", "/?lang=bg", { mobile: true, text: "Резервирай престой" });
await bookTap("book: button on /hotel (phone)", "/hotel?lang=bg", { mobile: true });
await bookTap(`book: button on /event/${EVENT_SLUG} (phone)`, `/event/${EVENT_SLUG}?lang=en`, { mobile: true });

// The /book form's button, which opens Clock's window (here Clock is
// blocked, so the page falls back to a new tab — window.open is stubbed).
async function bookSearch(where, { mobile = false } = {}) {
  const page = await open("/book?lang=bg", { mobile });
  await page.waitForSelector("main form button", { timeout: 8000 });
  await page.evaluate(() => {
    window.open = () => null;
    window.__fbqCalls.length = 0;
    document.querySelector("main form button").click();
  });
  await sleep(500);
  record(where, await page.evaluate(() => window.__fbqCalls));
  await page.close();
}
await bookSearch("book: /book form (desktop)");
await bookSearch("book: /book form (phone)", { mobile: true });

// A link straight to Clock's engine, as one added in Sanity would be: in
// the same tab the navigation waits 150 ms for the pixel, in a new tab it
// is left alone. The events are read in the same tick as the click — the
// held navigation then goes to Clock, which is blocked here.
async function clockLink(where, target) {
  const page = await open("/hotel?lang=bg");
  let navigated = false;
  page.on("request", (req) => {
    if (req.isNavigationRequest() && req.url().includes("clock-software.com")) navigated = true;
  });
  const got = await page.evaluate((target) => {
    window.__fbqCalls.length = 0;
    const a = document.createElement("a");
    a.href = "https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003";
    if (target) a.target = target;
    a.textContent = "Резервирай";
    document.querySelector("main").appendChild(a);
    let held = null;
    a.addEventListener("click", (e) => {
      held = e.defaultPrevented;
      e.preventDefault(); // no new tab from the test itself
    }, { once: true });
    a.click();
    return { held, calls: window.__fbqCalls.slice() };
  }, target);
  await sleep(600);
  record(where, got.calls);
  clockLinks[where] = { held: got.held, navigated };
  await page.close();
}
const clockLinks = {};
await clockLink("book: link to Clock, same tab, on /hotel", null);
await clockLink("book: link to Clock, new tab, on /hotel", "_blank");

// ── Part A: the wedding configurator on a phone ──────────────────────
// What the ads' visitors meet first, at 375×812 (and 1280×900 for the step
// changes): the first question on the first screen, a НАПРЕД that shows its
// errors, step changes that land on the step, the quick callback, and the
// call button. Each case fails with a reason rather than throwing.
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 900 };
const configuratorChecks = [];
const check = (name, ok, detail = "") => {
  configuratorChecks.push({ name, ok, detail });
  if (!ok) failures.push(`configurator: ${name}${detail ? ` — ${detail}` : ""}`);
};
// Where things are on screen: the header's bottom, the mobile bar's top.
const frame = (page) => page.evaluate(() => {
  const header = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
  const bar = [...document.querySelectorAll("div.fixed.bottom-0")].find((d) => d.offsetParent !== null || getComputedStyle(d).display !== "none");
  const barTop = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().top : innerHeight;
  return { header, barTop, innerHeight };
});
const tapNext = (page) => page.evaluate(() => {
  // The visible НАПРЕД: the mobile bar's on a phone, the page's on a desktop.
  const b = [...document.querySelectorAll("button")].filter((x) => /^Напред$/.test(x.textContent.trim()) && x.getClientRects().length);
  b[b.length - 1].click();
});
const tapBack = (page) => page.evaluate(() => {
  [...document.querySelectorAll("button")].find((x) => /^Назад$/.test(x.textContent.trim())).click();
});
const stepperTop = (page) => page.evaluate(() => document.querySelector('nav[aria-label] ol').getBoundingClientRect().top);

// 1. The first question and НАПРЕД without scrolling.
{
  const page = await open("/svatben-konfigurator?lang=bg", { size: PHONE });
  await page.waitForSelector('input[type="date"]', { timeout: 8000 });
  const f = await frame(page);
  const q = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((e) => /Кога планирате/.test(e.textContent));
    const d = document.querySelector('input[type="date"]').getBoundingClientRect();
    const next = [...document.querySelectorAll("button")].filter((x) => /^Напред$/.test(x.textContent.trim()) && x.getClientRects().length).pop().getBoundingClientRect();
    return { heading: h.getBoundingClientRect().top, dateBottom: d.bottom, nextTop: next.top, nextBottom: next.bottom, scrollY };
  });
  check("375×812: the first question and its date field are on the first screen",
    q.scrollY === 0 && q.heading >= f.header && q.dateBottom <= Math.min(f.barTop, 812),
    `heading at ${Math.round(q.heading)}, date field ends at ${Math.round(q.dateBottom)}, bar from ${Math.round(f.barTop)}`);
  check("375×812: НАПРЕД is on the first screen", q.nextBottom <= 812 && q.nextTop >= 0, `НАПРЕД at ${Math.round(q.nextTop)}–${Math.round(q.nextBottom)}`);
  await page.close();
}

// 2. НАПРЕД with nothing filled in: the first error in view, its field focused.
for (const size of [PHONE, DESKTOP]) {
  const page = await open("/svatben-konfigurator?lang=bg", { size });
  await page.waitForSelector('input[type="date"]', { timeout: 8000 });
  // Start lower down, as a guest who has read the page would be.
  await page.evaluate(() => scrollTo(0, 400));
  await sleep(300);
  await tapNext(page);
  await sleep(1300);
  const f = await frame(page);
  const e = await page.evaluate(() => {
    const alert = document.querySelector('[role="alert"]');
    const r = alert.getBoundingClientRect();
    const active = document.activeElement;
    return { top: r.top, bottom: r.bottom, text: alert.textContent.trim(), focusType: active?.type, focusInvalid: active?.getAttribute("aria-invalid"), live: document.querySelectorAll('[role="alert"]').length };
  });
  const tag = `${size.width}×${size.height}`;
  check(`${tag}: a bad НАПРЕД brings the first error into view`, e.top >= f.header && e.bottom <= f.barTop, `"${e.text}" at ${Math.round(e.top)}–${Math.round(e.bottom)}, visible ${Math.round(f.header)}–${Math.round(f.barTop)}`);
  check(`${tag}: …and puts the cursor in its field`, e.focusType === "date" && e.focusInvalid === "true", `focus on ${e.focusType}`);
  check(`${tag}: …with the messages still role="alert"`, e.live >= 2, `${e.live} alerts`);
  await page.close();
}

// 3. Each step change lands on the step's progress bar, not the page top —
// НАПРЕД 1→2→3→4, then НАЗАД 4→3.
for (const size of [PHONE, DESKTOP]) {
  const page = await open("/svatben-konfigurator?lang=bg", { size });
  await page.waitForSelector('input[type="date"]', { timeout: 8000 });
  await fill(page, "input[type=date]", "2027-06-12");
  await fill(page, "input[type=number]", "60", 0);
  await sleep(300);
  const tag = `${size.width}×${size.height}`;
  const landed = [];
  for (const [label, act] of [
    ["→ step 2", () => tapNext(page)],
    ["→ step 3", async () => { await clickText(page, /^Избери$/); await sleep(300); await tapNext(page); }],
    ["→ step 4", () => tapNext(page)],
    ["НАЗАД → step 3", () => tapBack(page)],
  ]) {
    // From further down the page, as after reading a step.
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight / 2));
    await sleep(200);
    await act();
    await sleep(1400);
    const f = await frame(page);
    const top = await stepperTop(page);
    const y = await page.evaluate(() => Math.round(scrollY));
    landed.push(`${label}: scrollY ${y}, steps bar at ${Math.round(top)}`);
    check(`${tag}: ${label} lands on the step, not the page top`, y > 0 && top >= f.header - 1 && top <= f.header + 40, `scrollY ${y}, steps bar at ${Math.round(top)}, header ends ${Math.round(f.header)}`);
  }
  console.log(`${tag} step changes: ${landed.join("; ")}`);
  await page.close();
}

// 4. The quick callback: EventEnquiry once, only on Formspree's confirmation,
// and not again when the same visit sends the full configurator.
async function callback(where, { failBackends = false, name = "Тест Тестов", phone = "+359888123456", thenFull = false } = {}) {
  const page = await open("/svatben-konfigurator?lang=bg", { size: PHONE, failBackends });
  await page.waitForSelector("[data-quick-callback] form", { timeout: 8000 });
  const sentBefore = formspreeBodies.length;
  await fill(page, '[data-quick-callback] input[autocomplete="name"]', name);
  await fill(page, '[data-quick-callback] input[type="tel"]', phone);
  await page.evaluate(() => (window.__fbqCalls.length = 0));
  await page.evaluate(() => document.querySelector('[data-quick-callback] button[type="submit"]').click());
  await sleep(1200);
  record(where, await page.evaluate(() => window.__fbqCalls));
  const sent = formspreeBodies.slice(sentBefore);
  callbackPosts[where] = sent;
  if (thenFull) {
    // The same visit goes on to send the whole configuration.
    await fill(page, "input[type=date]", "2027-06-12");
    await fill(page, "input[type=number]", "60", 0);
    await sleep(300);
    await tapNext(page); await sleep(700);
    await clickText(page, /^Избери$/); await sleep(300);
    await tapNext(page); await sleep(700);
    await tapNext(page); await sleep(700);
    await fill(page, "input[type=text]", "Тест Тестов", 0);
    await fill(page, "input[type=tel]", "+359888123456", 0);
    await fill(page, "input[type=email]", "test@example.com", 0);
    await page.evaluate(() => { const b = document.querySelectorAll("input[type=checkbox]"); b[b.length - 1].click(); });
    await sleep(200);
    await page.evaluate(() => (window.__fbqCalls.length = 0));
    await clickText(page, /Изпрати запитване/);
    await sleep(1800);
    record(`${where}, then the full configurator`, await page.evaluate(() => window.__fbqCalls));
  }
  await page.close();
}
const callbackPosts = {};
await callback("configurator callback sent");
await callback("configurator callback refused by Formspree", { failBackends: true });
await callback("configurator callback with the phone empty", { phone: "" });
await callback("configurator callback sent then the full form", { thenFull: true });
{
  const body = callbackPosts["configurator callback sent"][0] || "";
  check("the callback reaches Formspree once, marked as a quick callback",
    callbackPosts["configurator callback sent"].length === 1 && /name="kind"\r\n\r\nquick_callback/.test(body) && /name="phone"\r\n\r\n\+359888123456/.test(body),
    `${callbackPosts["configurator callback sent"].length} post(s)`);
  check("a callback with the phone empty sends nothing", callbackPosts["configurator callback with the phone empty"].length === 0);
}

// 5. The call button on a phone: PhoneClick once per tap.
{
  const page = await open("/svatben-konfigurator?lang=bg", { size: PHONE });
  await page.waitForSelector("[data-configurator-call]", { timeout: 8000 });
  const box = await page.evaluate(() => {
    const r = document.querySelector("[data-configurator-call]").getBoundingClientRect();
    return { height: r.height, top: r.top, href: document.querySelector("[data-configurator-call]").getAttribute("href"), text: document.querySelector("[data-configurator-call]").textContent.trim() };
  });
  check("the call button is at least 44px tall and on the first screen", box.height >= 44 && box.top < 812, `${Math.round(box.height)}px at ${Math.round(box.top)}`);
  check("the call button reads «Обади се: +359 896 100 100» and dials it", box.text === "Обади се: +359 896 100 100" && box.href === "tel:+359896100100", `"${box.text}" → ${box.href}`);
  for (const n of [1, 2]) {
    await page.evaluate(() => {
      window.__fbqCalls.length = 0;
      const a = document.querySelector("[data-configurator-call]");
      a.addEventListener("click", (e) => e.preventDefault(), { once: true });
      a.click();
    });
    await sleep(300);
    record(`configurator call button, tap ${n}`, await page.evaluate(() => window.__fbqCalls));
  }
  await page.close();
  const desktop = await open("/svatben-konfigurator?lang=bg", { size: DESKTOP });
  await desktop.waitForSelector('input[type="date"]', { timeout: 8000 });
  const shown = await desktop.evaluate(() => document.querySelector("[data-configurator-call]")?.getClientRects().length || 0);
  check("the call button is for phones only (hidden at 1280)", shown === 0);
  const photo = await desktop.evaluate(() => !!document.querySelector('img[src="/img/wedding-head-table.jpg"]')?.getClientRects().length);
  check("the desktop hero keeps its photo", photo);
  await desktop.close();
}

// ── Part A: EnquirySubmitted — real submissions, and nothing else ────
// Every enquiry form on the site, at a phone and a desktop width, through
// each way a send can end: confirmed, stopped by validation, the network
// gone, refused (4xx), a bot in the honeypot, a double tap on the button,
// and the same form sent again later in the same visit (the page reloaded,
// sessionStorage kept). Lead and EventEnquiry are counted beside it, to show
// they are as they were.
const SUBMIT_FORMS = {
  "contact form": {
    path: "/contact?lang=bg",
    async fill(page, { invalid, honeypot }) {
      await page.waitForSelector("main form", { timeout: 8000 });
      await page.evaluate(({ invalid, honeypot }) => {
        const set = (el, v) => {
          Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        };
        for (const el of document.querySelectorAll("main form input, main form textarea")) {
          if (el.type === "hidden" || el.name === "_gotcha") continue;
          // invalid: the name left empty — the browser's required stops it.
          if (invalid && el.required && el.type === "text") continue;
          set(el, el.type === "email" ? "test@example.com" : "Тест Тестов");
        }
        set(document.querySelector("main form select"), document.querySelector("main form select").options[1].value);
        if (honeypot) document.querySelector('main form input[name="_gotcha"]').value = "http://spam.example";
      }, { invalid, honeypot });
    },
    submit: 'main form button[type="submit"]',
  },
  "events form": {
    path: "/events?lang=bg",
    async fill(page, { invalid, honeypot }) {
      await page.waitForSelector("#enquiry form", { timeout: 8000 });
      if (!invalid) await fill(page, '#enquiry input[autocomplete="name"]', "Тест Тестов");
      await fill(page, '#enquiry input[type="tel"]', "+359888123456");
      await fill(page, "#enquiry select", "corporate", 0);
      await fill(page, "#enquiry select", "20-50", 1);
      await fill(page, "#enquiry select", "unknown", 2);
      await page.evaluate(() => document.querySelector('#enquiry input[type="checkbox"]').click());
      if (honeypot) await page.evaluate(() => (document.querySelector('#enquiry input[name="_gotcha"]').value = "http://spam.example"));
    },
    submit: '#enquiry button[type="submit"]',
  },
  "configurator form": {
    path: "/svatben-konfigurator?lang=bg",
    async fill(page, { invalid, honeypot }) {
      await page.waitForSelector('input[type="date"]', { timeout: 8000 });
      await fill(page, "input[type=date]", "2027-06-12");
      await fill(page, "input[type=number]", "60", 0);
      await sleep(300);
      await tapNext(page); await sleep(700);
      await clickText(page, /^Избери$/); await sleep(300);
      await tapNext(page); await sleep(700);
      await tapNext(page); await sleep(700);
      await fill(page, "input[type=text]", "Тест Тестов", 0);
      await fill(page, "input[type=tel]", "+359888123456", 0);
      await fill(page, "input[type=email]", "test@example.com", 0);
      if (honeypot) await fill(page, "#website-url", "http://spam.example");
      // invalid: consent left unticked — the form's own check stops it.
      if (!invalid) await page.evaluate(() => { const b = document.querySelectorAll("input[type=checkbox]"); b[b.length - 1].click(); });
      await sleep(200);
    },
    submitText: /Изпрати запитване/,
  },
  "configurator callback": {
    path: "/svatben-konfigurator?lang=bg",
    async fill(page, { invalid, honeypot }) {
      await page.waitForSelector('input[type="date"]', { timeout: 8000 });
      if (honeypot) {
        // The honeypot is on the last step: a bot that filled it there and
        // came back to step 1 for the callback.
        await fill(page, "input[type=date]", "2027-06-12");
        await fill(page, "input[type=number]", "60", 0);
        await sleep(300);
        await tapNext(page); await sleep(700);
        await clickText(page, /^Избери$/); await sleep(300);
        await tapNext(page); await sleep(700);
        await tapNext(page); await sleep(700);
        await fill(page, "#website-url", "http://spam.example");
        for (let i = 0; i < 3; i++) { await tapBack(page); await sleep(700); }
      }
      await page.waitForSelector("[data-quick-callback] form", { timeout: 8000 });
      await fill(page, '[data-quick-callback] input[autocomplete="name"]', "Тест Тестов");
      // invalid: the phone left empty.
      await fill(page, '[data-quick-callback] input[type="tel"]', invalid ? "" : "+359888123456");
    },
    submit: '[data-quick-callback] button[type="submit"]',
  },
};
const SUBMIT_CASES = ["sent", "invalid", "network failure", "refused 422", "honeypot", "double tap", "sent again in the same visit"];

async function pressSubmit(page, form, times = 1) {
  // The same button clicked `times` times in one go, as a double tap is:
  // before React has re-rendered it as disabled.
  const ok = await page.evaluate(({ sel, text, times }) => {
    const b = sel
      ? document.querySelector(sel)
      : [...document.querySelectorAll("button")].find((e) => new RegExp(text).test(e.textContent.trim()));
    if (!b) return false;
    for (let i = 0; i < times; i++) b.click();
    return true;
  }, { sel: form.submit || null, text: form.submitText?.source || null, times });
  if (!ok) throw new Error(`no submit button for ${form.submit || form.submitText}`);
}

const submittedCases = [];
for (const [sizeName, size] of [["phone", PHONE], ["desktop", DESKTOP]]) {
  for (const [name, form] of Object.entries(SUBMIT_FORMS)) {
    for (const c of SUBMIT_CASES) {
      const where = `submitted: ${name}, ${c} (${sizeName})`;
      const failBackends = c === "network failure" ? "network" : c === "refused 422";
      const page = await open(form.path, { size, failBackends });
      const postsBefore = formspreeBodies.length + weddingPosts.length;
      if (c === "sent again in the same visit") {
        // The first send, then a reload in the same tab and a second one.
        await form.fill(page, {});
        await pressSubmit(page, form);
        await sleep(1800);
        await page.reload({ waitUntil: "domcontentloaded" });
        await sleep(1400);
      }
      await form.fill(page, { invalid: c === "invalid", honeypot: c === "honeypot" });
      await page.evaluate(() => (window.__fbqCalls.length = 0));
      await pressSubmit(page, form, c === "double tap" ? 2 : 1);
      await sleep(1800);
      record(where, await page.evaluate(() => window.__fbqCalls));
      submittedCases.push({ where, form: name, case: c, size: sizeName, posts: formspreeBodies.length + weddingPosts.length - postsBefore });
      await page.close();
    }
  }
  // Two submissions in one visit: the callback, then the full configurator.
  {
    const where = `submitted: configurator callback, then the full form (${sizeName})`;
    const page = await open("/svatben-konfigurator?lang=bg", { size });
    await SUBMIT_FORMS["configurator callback"].fill(page, {});
    await page.evaluate(() => (window.__fbqCalls.length = 0));
    await pressSubmit(page, SUBMIT_FORMS["configurator callback"]);
    await sleep(1400);
    await SUBMIT_FORMS["configurator form"].fill(page, {});
    await pressSubmit(page, SUBMIT_FORMS["configurator form"]);
    await sleep(1800);
    record(where, await page.evaluate(() => window.__fbqCalls));
    submittedCases.push({ where, form: "both", case: "callback then full form", size: sizeName });
    await page.close();
  }
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
  ["Contact", "contact link: tel on /svatben-konfigurator", { method: "phone", content_category: "events" }],
  ["Contact", "contact link: mailto on /svatben-konfigurator", { method: "email", content_category: "events" }],
  ["Contact", "contact link: viber on /svatben-konfigurator", { method: "viber", content_category: "events" }],
  ["Contact", "contact link: wa.me on /svatben-konfigurator", { method: "whatsapp", content_category: "events" }],
  ["Contact", "contact link: tel on /winery", { method: "phone", content_category: undefined }],
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
  // The configurator: always "wedding", whatever the URL says.
  "contact link: tel on /svatben-konfigurator": { method: "phone", event_type: "wedding" },
  "contact link: mailto on /svatben-konfigurator": { method: "email", event_type: "wedding" },
  "contact link: viber on /svatben-konfigurator": { method: "viber", event_type: "wedding" },
  "contact link: wa.me on /svatben-konfigurator": { method: "whatsapp", event_type: "wedding" },
  "contact link: tel on /svatben-konfigurator?for=corporate": { method: "phone", event_type: "wedding" },
  // The configurator's quick callback, on Formspree's confirmation only —
  // and nothing more when the same visit then sends the full form.
  "configurator callback sent": { source: "configurator_callback" },
  "configurator callback sent then the full form": { source: "configurator_callback" },
  // Its call button is a tel: link: the same enquiry as any call from here.
  "configurator call button, tap 1": { method: "phone", event_type: "wedding" },
  "configurator call button, tap 2": { method: "phone", event_type: "wedding" },
};
// The EnquirySubmitted matrix counts EventEnquiry case by case, below.
const everyWhere = new Set([...rows.map((r) => r.where).filter((w) => !w.startsWith("submitted: ")), ...Object.keys(ENQUIRY_FIRES)]);
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
  "contact link: tel on /winery",
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

// EnquirySubmitted: exactly once per confirmed submission, with exactly
// these params — and nowhere else in the whole run: no page load, no tap on
// a phone, e-mail, Viber or WhatsApp link, no call button or mobile bar, no
// refused, failed, invalid or honeypot send, no repeat in the same visit.
const SUBMITTED = {
  "contact form": { source: "contact_form" },
  "events form": { source: "events_form", event_type: "corporate" },
  "configurator form": { source: "configurator_form", event_type: "wedding" },
  "configurator callback": { source: "configurator_callback", event_type: "wedding" },
};
const SUBMITTED_FIRES = {
  "/contact submit [topic: Резервация]": [SUBMITTED["contact form"]],
  "/contact submit [topic: Сватба или събитие]": [SUBMITTED["contact form"]],
  "/contact submit [topic: Ресторант]": [SUBMITTED["contact form"]],
  "/contact submit [topic: Езеро]": [SUBMITTED["contact form"]],
  "/svatben-konfigurator submit": [SUBMITTED["configurator form"]],
  "/events?for=corporate enquiry sent": [SUBMITTED["events form"]],
  "/events enquiry sent [Сватба]": [{ source: "events_form", event_type: "wedding" }],
  "configurator callback sent": [SUBMITTED["configurator callback"]],
  "configurator callback sent then the full form": [SUBMITTED["configurator callback"]],
  "configurator callback sent then the full form, then the full configurator": [SUBMITTED["configurator form"]],
};
for (const c of submittedCases) {
  if (c.form === "both") SUBMITTED_FIRES[c.where] = [SUBMITTED["configurator callback"], SUBMITTED["configurator form"]];
  else if (c.case === "sent" || c.case === "double tap") SUBMITTED_FIRES[c.where] = [SUBMITTED[c.form]];
}
{
  const wheres = new Set([...rows.map((r) => r.where), ...Object.keys(SUBMITTED_FIRES)]);
  let fired = 0;
  let silent = 0;
  let taps = 0;
  const tapWheres = new Set([
    ...CONTACT_CASES.filter((c) => c.href !== "/contact").map((c) => c.where),
    "configurator call button, tap 1", "configurator call button, tap 2",
    "/events enquiry call button", "/events mobile bar: call", `/event/${EVENT_SLUG} mobile bar: call`,
    "/events?for=corporate mobile bar: call", `/event/${OTHER_EVENT_SLUG} mobile bar: call`,
  ]);
  for (const where of wheres) {
    const got = rows.filter((r) => r.where === where && r.event === "EnquirySubmitted");
    const want = SUBMITTED_FIRES[where] || [];
    if (tapWheres.has(where) && got.length === 0) taps++;
    if (got.length !== want.length) {
      failures.push(`${where}: EnquirySubmitted fired ${got.length} time(s), expected ${want.length}`);
      continue;
    }
    if (!want.length) { silent++; continue; }
    const bad = got.find((g, i) => g.kind !== "trackCustom" || JSON.stringify(g.params) !== JSON.stringify(want[i]));
    if (bad) failures.push(`${where}: EnquirySubmitted ${bad.kind} ${JSON.stringify(got.map((g) => g.params))}, expected trackCustom ${JSON.stringify(want)}`);
    else fired++;
  }
  console.log(`\nEnquirySubmitted: right count and params at ${fired}/${Object.keys(SUBMITTED_FIRES).length} submissions; silent, correctly, at the other ${silent} actions — ${taps}/${tapWheres.size} of them taps on phone/e-mail/Viber/WhatsApp links`);
}

// Lead and EventEnquiry in the same matrix. A double tap is one send (one
// post, everything once); a filled honeypot is none (no post, nothing).
const LEAD_ON_SUCCESS = { "contact form": 1, "events form": 1, "configurator form": 1, "configurator callback": 0 };
const ENQUIRY_ON_SUCCESS = { "contact form": 0, "events form": 1, "configurator form": 1, "configurator callback": 1 };
// A repeat in the same visit: EventEnquiry is once per visit on the
// configurator (both forms share its flag), per send on /events.
const ENQUIRY_ON_REPEAT = { "contact form": 0, "events form": 1, "configurator form": 0, "configurator callback": 0 };
console.log(`\n${"=".repeat(96)}\n  ENQUIRY SUBMITTED — every form, phone (375×812) and desktop (1280×900)\n${"=".repeat(96)}`);
console.log(pad("CASE", 70) + pad("Submitted", 11) + pad("Lead", 6) + pad("EventEnq", 10) + "posts");
for (const c of submittedCases) {
  const n = (event) => rows.filter((r) => r.where === c.where && r.event === event).length;
  const sub = n("EnquirySubmitted");
  const lead = n("Lead");
  const enq = n("EventEnquiry");
  let ok = true;
  if (c.form !== "both") {
    const success = c.case === "sent" || c.case === "double tap" || c.case === "sent again in the same visit";
    const wantLead = success ? LEAD_ON_SUCCESS[c.form] : 0;
    const wantEnq = !success ? 0 : c.case === "sent again in the same visit" ? ENQUIRY_ON_REPEAT[c.form] : ENQUIRY_ON_SUCCESS[c.form];
    if (lead !== wantLead) { ok = false; failures.push(`${c.where}: Lead fired ${lead} time(s), expected ${wantLead}`); }
    if (enq !== wantEnq) { ok = false; failures.push(`${c.where}: EventEnquiry fired ${enq} time(s), expected ${wantEnq}`); }
    // Posts to Formspree or the wedding endpoint; the configurator's
    // honeypot does reach the endpoint, which answers ok and sends nothing.
    const wantPosts = c.case === "invalid" ? 0
      : c.case === "honeypot" ? (c.form === "configurator form" ? 1 : 0)
      : c.case === "sent again in the same visit" ? 2 : 1;
    if (c.posts !== wantPosts) { ok = false; failures.push(`${c.where}: ${c.posts} post(s), expected ${wantPosts}`); }
  }
  if (c.form === "both" && (lead !== 1 || enq !== 1)) {
    ok = false;
    failures.push(`${c.where}: Lead ${lead}, EventEnquiry ${enq} — expected 1 and 1, as before`);
  }
  const wantSub = (SUBMITTED_FIRES[c.where] || []).length;
  if (sub !== wantSub) ok = false;
  console.log(`${ok ? "PASS" : "FAIL"}  ${pad(c.where.replace("submitted: ", ""), 64)}${pad(sub, 11)}${pad(lead, 6)}${pad(enq, 10)}${c.posts ?? ""}`);
}

// BookingIntent: exactly once per «Резервирай» tap or /book search, with
// exactly these params — and nowhere else in the run.
const BOOKING_FIRES = {
  "book: nav button on / (desktop)": { page: "/", source: "button" },
  "book: hero button on / (desktop)": { page: "/", source: "button" },
  "book: closing button on / (desktop)": { page: "/", source: "button" },
  "book: button on /hotel (desktop)": { page: "/hotel", source: "button" },
  [`book: button on /event/${EVENT_SLUG} (desktop)`]: { page: `/event/${EVENT_SLUG}`, source: "button" },
  "book: menu button on / (phone)": { page: "/", source: "button" },
  "book: hero button on / (phone)": { page: "/", source: "button" },
  "book: button on /hotel (phone)": { page: "/hotel", source: "button" },
  [`book: button on /event/${EVENT_SLUG} (phone)`]: { page: `/event/${EVENT_SLUG}`, source: "button" },
  "book: /book form (desktop)": { page: "/book", source: "search" },
  "book: /book form (phone)": { page: "/book", source: "search" },
  "book: link to Clock, same tab, on /hotel": { page: "/hotel", source: "button" },
  "book: link to Clock, new tab, on /hotel": { page: "/hotel", source: "button" },
};
// PhoneClick: beside Contact, for every tel: link tapped — exactly once —
// and for nothing else.
const PHONE_FIRES = {};
for (const c of CONTACT_CASES) {
  if ((c.href || "").startsWith("tel:") || (c.real || "").includes('"tel:"')) {
    PHONE_FIRES[c.where] = { page: new URL(c.path, "http://x").pathname };
  }
}
for (const [where, path] of [
  ["configurator call button, tap 1", "/svatben-konfigurator"],
  ["configurator call button, tap 2", "/svatben-konfigurator"],
  ["/events enquiry call button", "/events"],
  ["/events mobile bar: call", "/events"],
  [`/event/${EVENT_SLUG} mobile bar: call`, `/event/${EVENT_SLUG}`],
  ["/events?for=corporate mobile bar: call", "/events"],
  [`/event/${OTHER_EVENT_SLUG} mobile bar: call`, `/event/${OTHER_EVENT_SLUG}`],
]) {
  PHONE_FIRES[where] = { page: path };
}
for (const [name, FIRES] of [["BookingIntent", BOOKING_FIRES], ["PhoneClick", PHONE_FIRES]]) {
  const wheres = new Set([...rows.map((r) => r.where), ...Object.keys(FIRES)]);
  let fired = 0;
  for (const where of wheres) {
    const got = rows.filter((r) => r.where === where && r.event === name);
    const want = FIRES[where];
    if (!want) {
      if (got.length) failures.push(`${where}: ${name} fired ${got.length} time(s) — it must not`);
      continue;
    }
    if (got.length !== 1) {
      failures.push(`${where}: ${name} fired ${got.length} time(s), expected exactly 1`);
      continue;
    }
    if (got[0].kind !== "trackCustom") failures.push(`${where}: ${name} sent with fbq('${got[0].kind}'), expected trackCustom`);
    if (JSON.stringify(got[0].params) !== JSON.stringify(want)) {
      failures.push(`${where}: ${name} params ${JSON.stringify(got[0].params)}, expected ${JSON.stringify(want)}`);
    } else fired++;
  }
  console.log(`${name}: exactly once with the right params at ${fired}/${Object.keys(FIRES).length} actions, and nowhere else`);
}
for (const [where, landed] of Object.entries(bookLanded)) {
  if (landed !== "/book") failures.push(`${where}: landed on ${landed}, expected /book`);
}
const sameTab = clockLinks["book: link to Clock, same tab, on /hotel"];
if (!sameTab?.held) failures.push("a same-tab link to Clock was not held for the pixel");
if (!sameTab?.navigated) failures.push("a same-tab link to Clock never went on to Clock");
if (clockLinks["book: link to Clock, new tab, on /hotel"]?.held) {
  failures.push("a new-tab link to Clock was held — it should be left alone");
}
console.log(`link to Clock: same tab held then followed ${sameTab?.held && sameTab?.navigated ? "yes" : "NO"}; new tab left alone ${clockLinks["book: link to Clock, new tab, on /hotel"]?.held === false ? "yes" : "NO"}`);

// The full configurator after a callback: its Lead as always, no second
// EventEnquiry (asserted above). The callback itself sends no Lead.
{
  const after = "configurator callback sent then the full form, then the full configurator";
  const leads = rows.filter((r) => r.where === after && r.event === "Lead").length;
  check("the full form after a callback still sends its Lead, once", leads === 1, `${leads} Lead(s)`);
  for (const where of ["configurator callback sent", "configurator callback refused by Formspree", "configurator callback with the phone empty"]) {
    const n = rows.filter((r) => r.where === where && r.event === "Lead").length;
    if (n) failures.push(`${where}: Lead fired ${n} time(s) — the callback sends EventEnquiry only`);
  }
}
console.log(`\n${"=".repeat(96)}\n  WEDDING CONFIGURATOR\n${"=".repeat(96)}`);
for (const c of configuratorChecks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);

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
