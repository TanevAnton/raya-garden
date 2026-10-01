// End to end, paying on the phone: the built /menu and /admin pages in a real
// browser, the PHP API, and a fake Stripe whose payment page "pays" and sends
// a signed webhook the way Stripe does. Needs a build first:
//   npm run build && npm run test:qr:e2e
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { startServer, client, ADMIN_PASSWORD } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const WEBHOOK_SECRET = "whsec_test_e2e";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());

let srv;
let stripe;
let browser;
let api;

before(async () => {
  assert.ok(existsSync("dist/menu/index.html") && existsSync("dist/admin/index.html"), "run npm run build first");
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({ docroot: "dist", stripe: { key: "rk_test_e2e", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "self" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  srv?.stop();
  await stripe?.stop();
});

/** Fresh database; ordering open all day, 12 tables, guests pay on the phone. */
async function openEvening() {
  srv.reset();
  stripe.reset();
  api = client(srv.base);
  assert.equal((await api.login()).status, 200);
  const res = await api.admin("/api/qr/admin/settings.php", { date: today(), opens: "00:00", closes: "23:59", tables: 12, disabledTables: [], paymentMode: "online" });
  assert.equal(res.status, 200, res.text);
}

async function phone() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  return page;
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

/** Table 6, one tiramisu, review, confirm — up to the pay button. */
async function orderTiramisu(page) {
  await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
  await clickText(page, "[role=dialog]", /^6$/);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll("main article")].find((a) => a.querySelector("h3")?.textContent.includes("Тирамису"));
    [...card.querySelectorAll("button")].find((b) => /Добави/.test(b.textContent)).click();
  });
  await clickText(page, "", /Преглед на поръчката/);
  await page.waitForSelector("[role=dialog] input[type=checkbox]");
  await page.click("[role=dialog] input[type=checkbox]");
}

const feed = async () => (await api.get("/api/qr/admin/feed.php?since=0")).body.orders;

describe("paying on the phone", () => {
  it("pay → Stripe's page → back: the order is confirmed paid, reaches staff, and waits on the till list", async () => {
    await openEvening();
    const page = await phone();
    await orderTiramisu(page);
    const text = await page.$eval("[role=dialog]", (d) => d.innerText);
    assert.match(text, /Плащате с карта в телефона/);
    const button = await page.$eval("[role=dialog] button[type=submit]", (b) => b.textContent);
    assert.match(button, /Плати 5,90\s€/);

    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати/)]);
    assert.ok(page.url().startsWith(`${stripe.base}/pay/`), "on Stripe's page");
    assert.equal((await feed()).length, 0, "staff see nothing before payment");

    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#pay")]);
    assert.match(page.url(), /\/menu\/\?lang=bg$/, "the ?paid= marker is taken out of the address");
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"), { timeout: 15000 });
    const shown = await page.$eval("[role=dialog]", (d) => d.innerText);
    assert.match(shown, /Платена/i);

    const [o] = await feed();
    assert.equal(o.payStatus, "paid");
    assert.equal(o.status, "new");

    const staff = await phone();
    await staff.setViewport({ width: 1280, height: 900 });
    await staff.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
    await staff.type("input[type=password]", ADMIN_PASSWORD);
    await staff.click("button[type=submit]");
    await staff.waitForSelector(`[data-order="${o.code}"]`);
    assert.match(await staff.$eval(`[data-order="${o.code}"]`, (e) => e.innerText), /Платена онлайн/);
    assert.match(await staff.$eval(`[data-order="${o.code}"]`, (e) => e.innerText), /платил: Test Guest/, "the name from Stripe's page");
    await clickText(staff, "nav", /За касата \(1\)/);
    await staff.waitForSelector(`[data-till="${o.code}"]`);
    await clickText(staff, `[data-till="${o.code}"]`, /Въведена в Clock/);
    await staff.waitForFunction(() => document.body.innerText.includes("Всичко е въведено"));
    assert.ok((await feed())[0].tillAt > 0);
    assert.deepEqual([...page.errors, ...staff.errors], []);
    await page.close();
    await staff.close();
  });

  it("backing out of Stripe's page: nothing is sent, and the guest can still pay", async () => {
    await openEvening();
    const page = await phone();
    await orderTiramisu(page);
    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати/)]);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#back")]);
    await page.waitForFunction(() => document.body.innerText.includes("Плащането не е завършено"), { timeout: 15000 });
    const text = await page.$eval("[role=dialog]", (d) => d.innerText);
    assert.match(text, /Очаква плащане/);
    assert.equal((await feed()).length, 0);

    // Pay from "Моите поръчки" after all.
    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати 5,90/)]);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#pay")]);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"), { timeout: 15000 });
    assert.equal((await feed()).length, 1);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it("staff cancel a paid order: refunded automatically, and the guest sees it", async () => {
    await openEvening();
    const page = await phone();
    await orderTiramisu(page);
    await Promise.all([page.waitForNavigation(), clickText(page, "[role=dialog]", /Плати/)]);
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("#pay")]);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"), { timeout: 15000 });
    const [o] = await feed();

    const staff = await phone();
    await staff.setViewport({ width: 1280, height: 900 });
    await staff.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
    await staff.type("input[type=password]", ADMIN_PASSWORD);
    await staff.click("button[type=submit]");
    await staff.waitForSelector(`[data-order="${o.code}"]`);
    await clickText(staff, `[data-order="${o.code}"]`, /^Откажи$/);
    await staff.waitForSelector("[role=dialog]");
    assert.match(await staff.$eval("[role=dialog]", (d) => d.innerText), /ще му бъде върната автоматично/);
    await clickText(staff, "[role=dialog]", /^Изчерпан продукт$/);
    await clickText(staff, "[role=dialog]", /^Откажи поръчката$/);
    await staff.waitForFunction(() => document.body.innerText.includes("са върнати на госта"), { timeout: 10000 });
    assert.equal(stripe.refunds.size, 1);

    // The guest's tab is in the background now: check on a timer, since a
    // background tab gets no animation frames to poll on.
    await page.waitForFunction(() => /Сумата е върната/i.test(document.body.innerText), { timeout: 20000, polling: 500 });
    assert.match(await page.$eval("[role=dialog]", (d) => d.innerText), /Отказана — Изчерпан продукт/);
    assert.deepEqual([...page.errors, ...staff.errors], []);
    await page.close();
    await staff.close();
  });
});
