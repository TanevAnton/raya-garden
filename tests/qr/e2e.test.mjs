// End to end: the built /menu and /admin pages in a real browser, against a
// real PHP server and database. Needs a build first:
//   npm run build && npm run test:qr:e2e
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer";
import { startServer, client, newKey, orderBody, ADMIN_PASSWORD } from "./server.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());

let srv;
let browser;
let api;
let menu;

before(async () => {
  assert.ok(existsSync("dist/menu/index.html") && existsSync("dist/admin/index.html"), "run npm run build first");
  srv = await startServer({ docroot: "dist" });
  menu = srv.menu();
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
});
after(async () => {
  await browser?.close();
  srv?.stop();
});

/** Fresh database, ordering open all day today, 12 tables with 5 switched off. */
async function openEvening() {
  srv.reset();
  api = client(srv.base);
  assert.equal((await api.login()).status, 200);
  const res = await api.admin("/api/qr/admin/settings.php", { date: today(), opens: "00:00", closes: "23:59", tables: 12, disabledTables: [5] });
  assert.equal(res.status, 200, res.text);
}

async function phone() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.errors = errors;
  return page;
}

const clickText = (page, scope, pattern) =>
  page.evaluate(
    (scope, source) => {
      const re = new RegExp(source);
      const el = [...document.querySelectorAll(`${scope} button`)].find((b) => re.test(b.textContent.trim()));
      if (!el) throw new Error(`no button /${source}/ in ${scope}`);
      el.click();
    },
    scope,
    pattern.source
  );

const addToCart = (page, name, variant) =>
  page.evaluate(
    (name, variant) => {
      const card = [...document.querySelectorAll("main article")].find((a) => a.querySelector("h3")?.textContent.includes(name));
      const buttons = [...card.querySelectorAll("button")].filter((b) => /Добави|Add/.test(b.textContent));
      (variant ? buttons.find((b) => b.parentElement.textContent.includes(variant)) : buttons[0]).click();
    },
    name,
    variant
  );

/** The + of a dish already in the cart. */
const plus = (page, name, variant) =>
  page.evaluate(
    (name, variant) => {
      const card = [...document.querySelectorAll("main article")].find((a) => a.querySelector("h3")?.textContent.includes(name));
      const rows = [...card.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === "+");
      (variant ? rows.find((b) => b.closest("div.flex.items-center.justify-between").textContent.includes(variant)) : rows[0]).click();
    },
    name,
    variant
  );

async function checkout(page) {
  await clickText(page, "", /Преглед на поръчката/);
  await page.waitForSelector("[role=dialog] input[type=checkbox]");
  await page.click("[role=dialog] input[type=checkbox]");
}

const feed = async () => (await api.get("/api/qr/admin/feed.php?since=0")).body.orders;

describe("a guest orders from a phone", () => {
  it("table → dishes with a size, a choice and a note → review → confirm → one order, as the server priced it", async () => {
    await openEvening();
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    const offered = await page.$$eval("[role=dialog] .grid button", (bs) => bs.map((b) => b.textContent.trim()));
    assert.deepEqual(offered, ["1", "2", "3", "4", "6", "7", "8", "9", "10", "11", "12"], "table 5 is switched off");
    await clickText(page, "[role=dialog]", /^8$/);
    await addToCart(page, "Цезар", "със скариди");
    await plus(page, "Цезар", "със скариди");
    await addToCart(page, "Продукти на Кока-Кола");
    await clickText(page, "[role=dialog]", /^Sprite$/);
    await checkout(page);
    await page.type("[role=dialog] input[placeholder]", "без крутони");
    const sending = page.waitForResponse((r) => r.url().includes("/api/qr/order.php"));
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    assert.equal((await sending).status(), 201);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    const code = await page.$eval("[role=dialog]", (d) => d.innerText.match(/R-[A-Z0-9]{4}/)[0]);
    const orders = await feed();
    assert.equal(orders.length, 1);
    const [o] = orders;
    assert.equal(o.code, code);
    assert.equal(o.table, 8);
    assert.equal(o.total, 2 * 1090 + 250);
    assert.deepEqual(o.lines.map((l) => [l.itemId, l.variantId, l.choiceId, l.qty, l.note]), [
      ["caesar", "shrimps", "", 2, "без крутони"],
      ["coca-cola-products", "std", "sprite", 1, ""],
    ]);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it("a double tap on send is still one order", async () => {
    await openEvening();
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(page, "[role=dialog]", /^3$/);
    await addToCart(page, "Тирамису");
    await checkout(page);
    await page.evaluate(() => {
      const b = document.querySelector("[role=dialog] button[type=submit]");
      b.click();
      b.click();
    });
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    await sleep(500);
    assert.equal((await feed()).length, 1);
    await page.close();
  });

  it("after a dropped connection, the retry carries the same Idempotency-Key", async () => {
    await openEvening();
    const page = await phone();
    const keys = [];
    let dropFirst = true;
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.url().includes("/api/qr/order.php")) {
        keys.push(req.headers()["idempotency-key"]);
        if (dropFirst) {
          dropFirst = false;
          return req.abort("internetdisconnected");
        }
      }
      req.continue();
    });
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(page, "[role=dialog]", /^2$/);
    await addToCart(page, "Тирамису");
    await checkout(page);
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    await page.waitForFunction(() => document.body.innerText.includes("Няма връзка"));
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal((await feed()).length, 1);
    await page.close();
  });

  it("a dish sold out while in the cart: the guest sees exactly what changed, and the resend goes through without it", async () => {
    await openEvening();
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(page, "[role=dialog]", /^4$/);
    await addToCart(page, "Тирамису");
    await addToCart(page, "Кафе Illy");
    await api.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: true });
    await checkout(page);
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    await page.waitForFunction(() => document.body.innerText.includes("Менюто се промени"));
    const notice = await page.$eval("[role=alert]", (a) => a.innerText);
    assert.match(notice, /Тирамису — изчерпано, премахнато/);
    assert.equal(await page.$eval("[role=dialog] input[type=checkbox]", (c) => c.checked), false, "must confirm again");
    assert.equal((await feed()).length, 0);
    await page.click("[role=dialog] input[type=checkbox]");
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    const [o] = await feed();
    assert.deepEqual(o.lines.map((l) => l.itemId), ["illy-coffee"]);
    await page.close();
  });

  it("paused: the guest can browse, but not order", async () => {
    await openEvening();
    await api.admin("/api/qr/admin/settings.php", { paused: true });
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    const text = await page.evaluate(() => document.body.innerText);
    assert.match(text, /временно спряно/);
    assert.match(text, /Цезар/);
    assert.equal(await page.$$eval("main button", (bs) => bs.filter((b) => /Добави/.test(b.textContent)).length), 0);
    await page.close();
  });

  it("switches to English and keeps the choice", async () => {
    await openEvening();
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(page, "[role=dialog]", /^1$/);
    await clickText(page, "header", /^en$/i);
    await page.waitForFunction(() => document.body.innerText.includes("Caesar salad"));
    assert.match(await page.evaluate(() => document.body.innerText), /€9\.90/);
    await page.reload({ waitUntil: "networkidle0" });
    assert.match(await page.evaluate(() => document.body.innerText), /Caesar salad/);
    await page.close();
  });
});

describe("the staff screen", () => {
  async function tablet() {
    const page = await browser.newPage();
    await page.setViewport({ width: 1180, height: 820 });
    await page.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
    await page.type('input[type="password"]', ADMIN_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes("Активни"));
    return page;
  }
  const placeOrder = (table, lines) => api.post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });

  it("a wrong password is refused", async () => {
    await openEvening();
    const page = await browser.newPage();
    await page.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
    await page.type('input[type="password"]', "not it");
    await page.click('button[type="submit"]');
    await page.waitForFunction(() => document.body.innerText.includes("Грешна парола"));
    await page.close();
  });

  it("new orders appear by themselves; accept → served reaches the guest's phone", async () => {
    await openEvening();
    const staff = await tablet();
    const guest = await phone();
    await guest.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(guest, "[role=dialog]", /^6$/);
    await addToCart(guest, "Гръцка салата");
    await checkout(guest);
    await clickText(guest, "[role=dialog]", /Изпрати поръчката/);
    await guest.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    const code = await guest.$eval("[role=dialog]", (d) => d.innerText.match(/R-[A-Z0-9]{4}/)[0]);

    await staff.waitForSelector(`[data-order="${code}"]`, { timeout: 10000 });
    await staff.evaluate((code) => [...document.querySelector(`[data-order="${code}"]`).querySelectorAll("button")].find((b) => /Приеми/.test(b.textContent)).click(), code);
    await guest.waitForFunction(() => document.body.innerText.includes("Приета"), { timeout: 15000 });
    await staff.waitForFunction((code) => /сервирано/i.test(document.querySelector(`[data-order="${code}"]`)?.innerText || ""), {}, code);
    await staff.evaluate((code) => [...document.querySelector(`[data-order="${code}"]`).querySelectorAll("button")].find((b) => /Сервирано/.test(b.textContent)).click(), code);
    await guest.waitForFunction(() => document.body.innerText.includes("Сервирана"), { timeout: 15000 });
    assert.equal((await feed())[0].status, "served");
    await staff.close();
    await guest.close();
  });

  it("a tablet that loses its connection shows it, and catches up on everything when it is back", async () => {
    await openEvening();
    const staff = await tablet();
    let offline = false;
    await staff.setRequestInterception(true);
    staff.on("request", (req) => (offline && req.url().includes("/api/qr/admin/feed.php") ? req.abort("internetdisconnected") : req.continue()));
    await placeOrder(1, [["tiramisu"]]);
    await staff.waitForFunction(() => document.querySelectorAll("[data-order]").length === 1, { timeout: 10000 });
    offline = true;
    await staff.waitForFunction(() => document.body.innerText.includes("Няма връзка със сървъра"), { timeout: 20000 });
    const missed = [];
    for (const t of [2, 3, 4]) missed.push((await placeOrder(t, [["illy-coffee"]])).body.order.code);
    offline = false;
    await staff.waitForFunction((codes) => codes.every((c) => document.querySelector(`[data-order="${c}"]`)), { timeout: 30000 }, missed);
    assert.equal(await staff.evaluate(() => document.body.innerText.includes("Няма връзка със сървъра")), false, "banner gone");
    assert.equal(await staff.$$eval("[data-order]", (els) => els.length), 4);
    await staff.close();
  });

  it("cancelling needs a reason, and the guest sees it", async () => {
    await openEvening();
    const staff = await tablet();
    const placed = (await placeOrder(9, [["tiramisu"]])).body;
    await staff.waitForSelector(`[data-order="${placed.order.code}"]`, { timeout: 10000 });
    await staff.evaluate((code) => [...document.querySelector(`[data-order="${code}"]`).querySelectorAll("button")].find((b) => /Откажи/.test(b.textContent)).click(), placed.order.code);
    const confirmDisabled = () => staff.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((b) => /Откажи поръчката/.test(b.textContent)).disabled);
    assert.equal(await confirmDisabled(), true, "no reason, no cancel");
    await clickText(staff, "[role=dialog]", /^Грешна маса$/);
    await clickText(staff, "[role=dialog]", /Откажи поръчката/);
    await sleep(800);
    const status = (await api.get(`/api/qr/order-status.php?t=${placed.token}`)).body.orders[0];
    assert.equal(status.status, "cancelled");
    assert.equal(status.cancelReason, "Грешна маса");
    await staff.close();
  });

  it("pause and resume from the screen", async () => {
    await openEvening();
    const staff = await tablet();
    await clickText(staff, "nav", /^Вечерта$/);
    await staff.waitForFunction(() => [...document.querySelectorAll("main button")].some((b) => b.textContent.trim() === "Пауза"));
    await clickText(staff, "main", /^Пауза$/);
    await staff.waitForFunction(() => document.body.innerText.includes("ПАУЗА") || document.body.innerText.includes("Поднови"));
    assert.equal((await api.get("/api/qr/state.php")).body.reason, "paused");
    await clickText(staff, "main", /Поднови/);
    await sleep(500);
    assert.equal((await api.get("/api/qr/state.php")).body.open, true);
    await staff.close();
  });
});
