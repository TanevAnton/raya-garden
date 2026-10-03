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
    await page.type('[role=dialog] input[autocomplete="given-name"]', "Мария");
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
    assert.equal(o.guestName, "Мария", "the optional name reaches staff");
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

  it("once the kitchen has closed, food can no longer be ordered but drinks can", async () => {
    await openEvening();
    // The kitchen stopped a minute after midnight; the bar goes on all day.
    const res = await api.admin("/api/qr/admin/settings.php", { date: today(), opens: "00:00", kitchenCloses: "00:01", barCloses: "23:59" });
    assert.equal(res.status, 200, res.text);
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(page, "[role=dialog]", /^3$/);
    assert.match(await page.$eval("[data-station-hours]", (e) => e.innerText), /Кухнята вече не приема поръчки\. Напитки — до 23:59/);
    const food = await page.evaluate(() => [...document.querySelectorAll("main article")].find((a) => a.querySelector("h3")?.textContent.includes("Тирамису")).innerText);
    assert.doesNotMatch(food, /Добави/i, "no food");
    assert.ok(await page.$('[data-category="desserts"] [data-station-closed]'), "the dessert section says why");
    await addToCart(page, "Минерална вода Девин");
    await checkout(page);
    await clickText(page, "[role=dialog]", /Изпрати поръчката/);
    await page.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    assert.deepEqual((await feed())[0].stations, { kitchen: "", bar: "new" });
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  it("a tab far down the menu lands on its section, even when the phone cuts the scroll short", async () => {
    await openEvening();
    const page = await phone();
    await page.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].find((b) => b.textContent.trim() === "3")?.click());
    const tabs = await page.$$eval("nav a[data-tab]", (as) => as.map((a) => a.dataset.tab));
    for (const [target, cut] of [[tabs.at(-1), false], [tabs.at(-3), true], [tabs[12], true]]) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      await page.click(`nav a[data-tab="${target}"]`);
      if (cut) {
        // What a phone may do to a long smooth scroll: something else scrolls, and it stops where it is.
        await sleep(250);
        await page.evaluate(() => window.scrollTo({ top: window.scrollY, behavior: "instant" }));
      }
      await page.waitForFunction(
        (t) => {
          const top = document.getElementById(`c-${t}`).getBoundingClientRect().top;
          const tabs = document.querySelector("nav[aria-label] a.text-gold-100")?.dataset.tab;
          return top > 60 && top < 140 && tabs === t;
        },
        { timeout: 6000, polling: 100 },
        target
      );
    }
    assert.deepEqual(page.errors, []);
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
  /** A signed-in staff tablet; a second one needs its own browser session (cookies). */
  async function tablet(session = browser) {
    const page = await session.newPage();
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

  it("one line taken off: the rest of the order stays, and the guest's phone says what and why", async () => {
    await openEvening();
    const staff = await tablet();
    const guest = await phone();
    await guest.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
    await clickText(guest, "[role=dialog]", /^6$/);
    await addToCart(guest, "Бургас 63", "100 мл");
    await plus(guest, "Бургас 63", "100 мл");
    await addToCart(guest, "Тирамису");
    await checkout(guest);
    await clickText(guest, "[role=dialog]", /Изпрати поръчката/);
    await guest.waitForFunction(() => document.body.innerText.includes("Поръчката е изпратена"));
    const code = await guest.$eval("[role=dialog]", (d) => d.innerText.match(/R-[A-Z0-9]{4}/)[0]);
    const [placed] = await feed();
    assert.deepEqual(placed.lines.map((l) => [l.qty, l.detailBg, l.price]), [[2, "100 мл", 620], [1, "", placed.lines[1].price]]);

    await staff.bringToFront();
    const bar = `[data-order="${code}"][data-station="bar"]`;
    await staff.waitForSelector(bar, { timeout: 10000 });
    await staff.click(`${bar} [data-line="0"] button`);
    await staff.waitForSelector('[role=dialog][aria-label="Откажи ред"]');
    assert.match(await staff.$eval("[role=dialog]", (d) => d.innerText), /Няма: Бургас 63[\s\S]*от 2[\s\S]*Сумата за плащане става/);
    await clickText(staff, "[role=dialog]", /^Откажи 1 × 6,20/);
    await staff.waitForFunction((sel) => /1 отказан: Изчерпан продукт/.test(document.querySelector(sel)?.innerText || ""), { polling: 300 }, bar);
    const card = await staff.$eval(bar, (e) => e.innerText);
    assert.match(card, /Бар: 6,20/, "the bar's part, one rakia less");

    await guest.bringToFront();
    await guest.waitForFunction(() => /1 отказани — Изчерпан продукт/.test(document.querySelector("[role=dialog]")?.innerText || ""), { timeout: 15000, polling: 300 });
    const [after] = await feed();
    assert.equal(after.total, placed.total - 620);
    assert.deepEqual([after.status, after.lines[0].qty, after.lines[0].voidQty], ["new", 1, 1], "the order goes on");
    await staff.close();
    await guest.close();
  });

  it("kitchen and bar: an order with food and drinks splits, each tablet sees its part, the guest sees the whole", async () => {
    await openEvening();
    const placed = (await placeOrder(3, [["caesar", "chicken", 1], ["coca-cola-products", "std", 2, "sprite"]])).body;
    const code = placed.order.code;
    const status = async () => (await api.get(`/api/qr/order-status.php?t=${placed.token}`)).body.orders[0];
    const kitchen = await tablet();
    await clickText(kitchen, "", /^Кухня/);
    await kitchen.reload({ waitUntil: "networkidle0" });
    await kitchen.waitForSelector(`[data-order="${code}"]`, { timeout: 10000 });
    assert.equal(await kitchen.$eval('[aria-pressed="true"]', (b) => b.textContent.trim()), "Кухня (1)", "the tablet remembers it is the kitchen's");
    assert.equal(await kitchen.$(`[data-order="${code}"][data-station="bar"]`), null, "no drinks in the kitchen");
    const food = await kitchen.$eval(`[data-order="${code}"][data-station="kitchen"]`, (e) => e.innerText);
    assert.match(food, /Цезар/);
    assert.doesNotMatch(food, /Sprite/);
    assert.match(food, /\+ бар: 2 бр\. · нова/, "it knows drinks are coming too");

    const barSession = await browser.createBrowserContext();
    const barTablet = await tablet(barSession);
    await clickText(barTablet, "", /^Бар/);
    await barTablet.waitForSelector(`[data-order="${code}"][data-station="bar"]`, { timeout: 10000 });
    assert.equal(await barTablet.$(`[data-order="${code}"][data-station="kitchen"]`), null, "no food at the bar");
    assert.match(await barTablet.$eval(`[data-order="${code}"]`, (e) => e.innerText), /2 ×\s*Продукти на Кока-Кола · Sprite/);

    // The kitchen takes it on: for the guest the order is accepted; the bar's part is still new.
    await kitchen.bringToFront();
    await clickText(kitchen, `[data-order="${code}"][data-station="kitchen"]`, /^Приеми$/);
    await kitchen.waitForFunction((c) => /сервирано/i.test(document.querySelector(`[data-order="${c}"]`)?.innerText || ""), { polling: 300 }, code);
    assert.equal((await status()).status, "accepted", "taken on, as far as the guest is concerned");
    await barTablet.bringToFront();
    await barTablet.waitForFunction((c) => /Нова/.test(document.querySelector(`[data-order="${c}"][data-station="bar"]`)?.innerText || ""), { polling: 300 }, code);
    await clickText(barTablet, `[data-order="${code}"][data-station="bar"]`, /^Приеми$/);
    await barTablet.waitForFunction((c) => /сервирано/i.test(document.querySelector(`[data-order="${c}"][data-station="bar"]`)?.innerText || ""), { polling: 300 }, code);
    await clickText(barTablet, `[data-order="${code}"][data-station="bar"]`, /^Сервирано$/);
    await barTablet.waitForFunction((c) => !document.querySelector(`[data-order="${c}"][data-station="bar"]`), { polling: 300 }, code);
    assert.equal((await status()).status, "accepted", "drinks out, food still coming");

    // Both on one page, still apart.
    await clickText(barTablet, "", /^Двете$/);
    await barTablet.waitForSelector('[data-station-list="kitchen"] [data-order]');
    assert.ok(await barTablet.$('[data-station-list="bar"]'), "a bar column too");

    await kitchen.bringToFront();
    await clickText(kitchen, `[data-order="${code}"][data-station="kitchen"]`, /^Сервирано$/);
    await kitchen.waitForFunction((c) => !document.querySelector(`[data-order="${c}"]`), { polling: 300 }, code);
    assert.equal((await status()).status, "served");

    // Out of Sprite: the bar cancels its part; the kitchen carries on.
    const res2 = await placeOrder(7, [["tiramisu"], ["coca-cola-products", "std", 1, "sprite"]]);
    assert.equal(res2.status, 201, res2.text);
    const second = res2.body;
    await barTablet.bringToFront();
    await clickText(barTablet, "", /^Бар/);
    await barTablet.waitForSelector(`[data-order="${second.order.code}"]`, { timeout: 10000 });
    await clickText(barTablet, `[data-order="${second.order.code}"]`, /^Откажи$/);
    await barTablet.waitForSelector("[role=dialog]");
    assert.match(await barTablet.$eval("[role=dialog]", (d) => d.innerText), /Откажи частта за бара[\s\S]*Кухнята продължава/);
    await clickText(barTablet, "[role=dialog]", /^Изчерпан продукт$/);
    await clickText(barTablet, "[role=dialog]", /^Откажи напитките$/);
    await barTablet.waitForFunction((c) => !document.querySelector(`[data-order="${c}"]`), { polling: 300 }, second.order.code);
    const after = (await api.get(`/api/qr/order-status.php?t=${second.token}`)).body.orders[0];
    assert.deepEqual([after.status, after.lines[1].qty, after.lines[1].voidReason], ["new", 0, "Изчерпан продукт"]);
    await kitchen.bringToFront();
    await kitchen.waitForSelector(`[data-order="${second.order.code}"][data-station="kitchen"]`, { timeout: 10000 });
    await kitchen.close();
    await barSession.close();
  });

  it("waiters: tables assigned on one screen, the waiter on every card for the table", async () => {
    await openEvening();
    const staff = await tablet();
    await clickText(staff, "nav", /^Сервитьори$/);
    await staff.waitForSelector('input[aria-label="Име на сервитьор"]');
    await staff.type('input[aria-label="Име на сервитьор"]', "Иван");
    await clickText(staff, "main", /^Добави$/);
    await staff.click('[data-table="3"]');
    await staff.click('[data-table="4"]');
    await staff.waitForFunction(() => document.querySelector('[data-table="4"]').innerText.includes("Иван"), { polling: 200 });
    await staff.click('[data-table="4"]'); // a second tap takes it back
    await staff.waitForFunction(() => !document.querySelector('[data-table="4"]').innerText.includes("Иван"), { polling: 200 });
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual((await api.get("/api/qr/admin/feed.php?since=0")).body.waiters, { 3: "Иван" });

    const placed = (await placeOrder(3, [["tiramisu"], ["illy-coffee"]])).body;
    await clickText(staff, "nav", /^Поръчки/);
    await clickText(staff, "main", /^Двете$/); // this browser remembers an earlier test's choice
    await staff.waitForSelector(`[data-order="${placed.order.code}"][data-station="bar"]`, { timeout: 10000 });
    const cards = await staff.$$eval(`[data-order="${placed.order.code}"] [data-waiter]`, (els) => els.map((e) => e.innerText));
    assert.deepEqual(cards, ["Сервитьор: Иван", "Сервитьор: Иван"], "on the kitchen's card and the bar's");
    assert.deepEqual(staff.errors || [], []);
    await staff.close();
  });

  it("history: past evenings' figures and orders, and the spreadsheet downloads", async () => {
    // Yesterday: one order. Today: two, one of them for Иван's table.
    await openEvening();
    const then = Math.floor(Date.now() / 1000) - 86400;
    const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(then * 1000));
    const past = client(srv.base, { now: then });
    assert.equal((await past.login()).status, 200);
    assert.equal((await past.admin("/api/qr/admin/settings.php", { date: yesterday, opens: "00:00", closes: "23:59", tables: 12, disabledTables: [] })).status, 200);
    const old = (await past.post("/api/qr/order.php", orderBody(menu, 2, [["caesar", "chicken"]]), { headers: { "Idempotency-Key": newKey() } })).body.order;
    assert.equal((await api.admin("/api/qr/admin/settings.php", { date: today(), opens: "00:00", closes: "23:59" })).status, 200);
    assert.equal((await api.admin("/api/qr/admin/waiters.php", { tables: { 3: "Иван" } })).status, 200);
    const a = (await placeOrder(3, [["tiramisu", "std", 2], ["illy-coffee"]])).body.order;
    const b = (await placeOrder(4, [["illy-coffee"]])).body.order;

    const staff = await tablet();
    const errors = [];
    staff.on("pageerror", (e) => errors.push(e.message));
    await clickText(staff, "nav", /^История$/);
    await staff.waitForSelector("[data-history] [data-sales]");
    const evenings = await staff.$$eval("[data-history-evening] option", (os) => os.map((o) => o.value));
    assert.deepEqual(evenings, [today(), yesterday], "newest first");
    assert.equal(Number(await staff.$eval("[data-sales]", (e) => e.dataset.sales)), a.total + b.total);
    assert.equal(Number(await staff.$eval("[data-pay-staff]", (e) => e.dataset.payStaff)), a.total + b.total);
    assert.deepEqual(await staff.$$eval("[data-waiter-sales]", (els) => els.map((e) => e.dataset.waiterSales)), ["Иван", ""]);
    assert.deepEqual(await staff.$$eval("[data-history-order]", (els) => els.map((e) => e.dataset.historyOrder)), [a.code, b.code]);
    await staff.click(`[data-history-order="${a.code}"] summary`);
    assert.match(await staff.$eval(`[data-history-order="${a.code}"]`, (e) => e.innerText), /2 × Тирамису/);

    // The older evening, one tap back.
    await staff.click('button[aria-label="По-ранна вечер"]');
    await staff.waitForSelector(`[data-history-order="${old.code}"]`);
    assert.equal(Number(await staff.$eval("[data-sales]", (e) => e.dataset.sales)), old.total);
    const sameMonth = yesterday.slice(0, 7) === today().slice(0, 7); // not on the 1st
    assert.match(await staff.$eval("[data-history-month]", (e) => e.innerText), sameMonth ? /2 вечери · 3 поръчки/ : /1 вечер · 1 поръчки/);

    // The downloads are links the signed-in browser can follow.
    const href = await staff.$eval('a[href*="kind=lines&evening="]', (a) => a.getAttribute("href"));
    assert.equal(href, `/api/qr/admin/export.php?kind=lines&evening=${yesterday}`);
    const csv = await staff.evaluate(async (url) => {
      const res = await fetch(url);
      return [res.status, res.headers.get("content-disposition"), await res.text()];
    }, href);
    assert.equal(csv[0], 200);
    assert.match(csv[1], /attachment; filename="raya-poruchki-/);
    assert.match(csv[2], new RegExp(`${old.code};2;;нова;на персонала;кухня;Салата „Цезар“;с пиле;1;0;`));
    assert.deepEqual(errors, []);
    await staff.close();
  });

  it("monthly summary: the address is saved, and a month can be sent at once", async () => {
    await openEvening();
    await placeOrder(3, [["tiramisu"]]);
    const staff = await tablet();
    const errors = [];
    staff.on("pageerror", (e) => errors.push(e.message));
    await clickText(staff, "nav", /^История$/);
    await staff.waitForSelector("[data-monthly-email] input[type=email]");
    assert.match(await staff.$eval("[data-monthly-email]", (e) => e.innerText), /Не се изпраща — няма адрес/);
    await staff.type("[data-monthly-email] input[type=email]", "manager@example.com");
    await clickText(staff, "[data-monthly-email]", /^Запази$/);
    await staff.waitForFunction(() => /Изпраща се до manager@example\.com/.test(document.querySelector("[data-monthly-email]").innerText));
    await clickText(staff, "[data-monthly-email]", /^Изпрати отчета за/);
    await staff.waitForFunction(() => /Изпратен до manager@example\.com/.test(document.querySelector("[data-report-note]")?.innerText || ""), { timeout: 15000 });
    const mails = srv.mails();
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, "manager@example.com");
    assert.match(mails[0].subject, /^RAYA Garden · Поръчки от масата — .+ \(до \d+ .+\)$/, "this month, so far");
    assert.match(await staff.$eval("[data-report-log]", (e) => e.innerText), /до момента.*изпратен/s);
    assert.deepEqual(errors, []);
    await staff.close();
  });

  it("pause and resume from the screen", async () => {
    await openEvening();
    const staff = await tablet();
    await clickText(staff, "nav", /^Вечерта$/);
    await staff.waitForFunction(() => [...document.querySelectorAll("main button")].some((b) => b.textContent.trim() === "Пауза"));
    await clickText(staff, "main", /^Пауза$/);
    // The Пауза button itself reads "ПАУЗА" (capitals by CSS): wait for its replacement instead.
    await staff.waitForFunction(() => [...document.querySelectorAll("main button")].some((b) => /Поднови/.test(b.textContent)), { polling: 200 });
    assert.equal((await api.get("/api/qr/state.php")).body.reason, "paused");
    await clickText(staff, "main", /Поднови/);
    await sleep(500);
    assert.equal((await api.get("/api/qr/state.php")).body.open, true);
    await staff.close();
  });
});
