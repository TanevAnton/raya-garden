// End to end, "pay at the end": the built /menu and /admin pages in a real
// browser, several phones on one table's bill, a fake Stripe that pays and
// sends signed webhooks. Needs a build first:
//   npm run build && npm run test:qr:e2e
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { startServer, client, newKey, orderBody, ADMIN_PASSWORD } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const WEBHOOK_SECRET = "whsec_test_e2e_bill";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());

let srv;
let stripe;
let browser;
let api;
let menu;

before(async () => {
  assert.ok(existsSync("dist/menu/index.html") && existsSync("dist/admin/index.html"), "run npm run build first");
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({ docroot: "dist", stripe: { key: "rk_test_e2e", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "self" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  srv?.stop();
  await stripe?.stop();
});

async function openEvening() {
  srv.reset();
  stripe.reset();
  api = client(srv.base);
  assert.equal((await api.login()).status, 200);
  const res = await api.admin("/api/qr/admin/settings.php", { date: today(), opens: "00:00", closes: "23:59", tables: 12, disabledTables: [], paymentMode: "tab" });
  assert.equal(res.status, 200, res.text);
}

async function phone() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return page;
}

async function staffScreen() {
  const staff = await phone();
  await staff.setViewport({ width: 1280, height: 900 });
  await staff.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
  await staff.type("input[type=password]", ADMIN_PASSWORD);
  await staff.click("button[type=submit]");
  // "Сметки" appears once the first poll says bills are on tonight.
  await staff.waitForFunction(() => [...document.querySelectorAll("nav button")].some((b) => /^Сметки/.test(b.textContent)), { polling: 200 });
  return staff;
}

const clickText = (page, scope, pattern) =>
  page.evaluate(
    (scope, source) => {
      const re = new RegExp(source);
      const el = [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((b) => re.test(b.textContent.trim()));
      if (!el) throw new Error(`no button /${source}/ in ${scope}`);
      el.click();
    },
    scope,
    pattern.source
  );
const text = (page, sel = "[role=dialog]") => page.$eval(sel, (d) => d.innerText);

/** On the guest's phone: table 4, one tiramisu, sent. */
async function orderTiramisu(page) {
  await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
  await clickText(page, "[role=dialog]", /^4$/);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("main article")].find((a) => a.querySelector("h3")?.textContent.includes("Тирамису"));
    [...card.querySelectorAll("button")].find((b) => /Добави/.test(b.textContent)).click();
  });
  await clickText(page, "", /Преглед на поръчката/);
  await page.waitForSelector("[role=dialog] input[type=checkbox]");
  assert.match(await text(page), /влиза в сметката на маса №4/);
  await page.click("[role=dialog] input[type=checkbox]");
  await clickText(page, "[role=dialog]", /Изпрати поръчката/);
  await page.waitForFunction(() => document.body.innerText.includes("Добавена е към сметката"));
}

/** Another guest at the same table, from their own phone. */
async function friendOrders() {
  const friend = client(srv.base);
  const res = await friend.post("/api/qr/order.php", orderBody(menu, 4, [["illy-coffee", "std", 2]]), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  return res.body.order;
}

describe("pay at the end: the table's bill", () => {
  it("a birthday: two phones order for table 4, one pays everything; staff close the bill", async () => {
    await openEvening();
    const page = await phone();
    await orderTiramisu(page);
    const friend = await friendOrders();

    const staff = await staffScreen();
    await staff.waitForSelector(`[data-order="${friend.code}"]`);
    assert.match(await text(staff, `[data-order="${friend.code}"]`), /По сметка/, "straight to staff, not paid yet");

    // The birthday host opens the bill: both phones' orders are on it.
    await page.bringToFront(); // a guest's phone is always in front
    await clickText(page, "[role=dialog]", /^Сметка$/);
    // The staff screen opened after this phone: its tab is in the background,
    // so every wait here checks on a timer rather than on animation frames.
    await page.waitForFunction(() => document.querySelectorAll("[data-line]").length === 2, { polling: 300 });
    const bill = await text(page);
    assert.match(bill, /Сметка · маса №4/);
    assert.match(bill, /ваше/, "the host's own line is marked");
    assert.match(await page.$eval("[role=dialog] button.btn-gold", (b) => b.textContent), /Плати 5,90/, "own line picked by default");
    await clickText(page, "[role=dialog]", /^Избери всичко$/);
    assert.match(await page.$eval("[role=dialog] button.btn-gold", (b) => b.textContent), /Плати 10,90/);

    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати 10,90/)]);
    assert.ok(page.url().startsWith(`${stripe.base}/pay/`));
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#pay")]);
    await page.waitForFunction(() => document.body.innerText.includes("Сметката е платена"), { timeout: 15000, polling: 300 });
    assert.match(await text(page), /Платено/);

    await staff.bringToFront();
    await clickText(staff, "nav", /^Сметки/);
    await staff.waitForSelector('[data-tab="4"]');
    await staff.waitForFunction(() => /Затвори сметката/.test(document.querySelector('[data-tab="4"]').innerText), { polling: 300, timeout: 15000 });
    await clickText(staff, '[data-tab="4"]', /Затвори сметката/);
    await staff.waitForFunction(() => document.body.innerText.includes("Няма отворени сметки"), { polling: 300, timeout: 15000 });
    await clickText(staff, "nav", /За касата/);
    await staff.waitForFunction(() => /P-[A-Z0-9]{4}/.test(document.body.innerText) && /10,90/.test(document.body.innerText), { polling: 300 });

    assert.deepEqual([...page.errors, ...staff.errors], []);
    await page.close();
    await staff.close();
  });

  it("each pays their own part: the host pays only theirs, staff settle the rest on the spot", async () => {
    await openEvening();
    const page = await phone();
    await orderTiramisu(page);
    await friendOrders();

    await clickText(page, "[role=dialog]", /^Сметка$/);
    await page.waitForFunction(() => document.querySelectorAll("[data-line]").length === 2, { polling: 300 });
    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати 5,90/)]);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#pay")]);
    await page.waitForFunction(() => /платено/.test(document.querySelector("[role=dialog]")?.innerText || ""), { timeout: 15000, polling: 300 });
    const bill = await text(page);
    assert.match(bill, /Остава\s*5,00/, "the friend's coffees are left");

    const staff = await staffScreen();
    await clickText(staff, "nav", /^Сметки/);
    await staff.waitForSelector('[data-tab="4"]');
    await clickText(staff, '[data-tab="4"]', /Платено на място/);
    await staff.waitForSelector('[role=dialog][aria-label="Платено на място"]');
    assert.match(await text(staff, "[role=dialog]"), /5,00/);
    await clickText(staff, "[role=dialog]", /Да, платено/);
    await staff.waitForFunction(() => /Затвори сметката/.test(document.querySelector('[data-tab="4"]')?.innerText || ""), { polling: 300, timeout: 15000 });

    // The guest's bill says so too.
    await page.waitForFunction(() => document.body.innerText.includes("Сметката е платена"), { timeout: 15000, polling: 500 });
    assert.match(await text(page), /платено на място/);
    assert.deepEqual([...page.errors, ...staff.errors], []);
    await page.close();
    await staff.close();
  });
});
