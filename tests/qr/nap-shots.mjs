// The screenshots for the НАП manual (docs/qr-ordering/nap/rakovodstvo-bg.md),
// from a test database: the built /menu and /admin pages in a real browser,
// the PHP API, a fake Stripe and a fake printer behind the real bridge. One
// command, so the set for the declared version is made the same way:
//
//   npm run build && node tests/qr/nap-shots.mjs [folder]
//
// The folder (default docs/qr-ordering/nap/shots, not in git) gets one PNG per
// [Снимка: …] in the manual, numbered in its order. Receipts come from the
// real printer, photographed: they are not here.
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import puppeteer from "puppeteer";
import { startServer, client, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeErpNet } from "./fake-erpnet.mjs";
import { createBridge } from "../../tools/fiscal-bridge/bridge.mjs";

const OUT = process.argv[2] || "docs/qr-ordering/nap/shots";
const KEY = "nap-shots-bridge-key-0123456789abcdef0123";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
if (!existsSync("dist/menu/index.html")) throw new Error("run npm run build first");
mkdirSync(OUT, { recursive: true });

const stripe = await startFakeStripe({ webhookSecret: "whsec_shots" });
const printer = await startFakeErpNet();
// As it will be declared: no tips, no orders paid to staff (DECISIONS.md, 19 and 29.10.2026).
const srv = await startServer({ docroot: "dist", tips: false, staffOrders: false, stripe: { key: "rk_test_shots", webhookSecret: "whsec_shots", api: stripe.base, publicUrl: "self" } });
srv.config({ fiscal_mode: "test", fiscal_bridge_token: KEY });
stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
const work = mkdtempSync(path.join(tmpdir(), "raya-shots-"));
const bridge = () => createBridge({ server: srv.base, key: KEY, erpnet: printer.base, printerId: "", journal: path.join(work, "j.json"), waitMs: 3000 }, { log: () => {} });
const drain = async () => { const b = bridge(); for (let i = 0; i < 12; i++) if ((await b.step()) > 0) return; };
const browser = await puppeteer.launch({ args: ["--no-sandbox"], protocolTimeout: 300000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const made = [];

async function shot(page, name) {
  await sleep(700);
  const file = path.join(OUT, `${String(++n).padStart(2, "0")}-${name}.png`);
  // The whole page, but not endless: the menu runs to many screens.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: file, fullPage: height < 6000, captureBeyondViewport: height < 6000 });
  made.push(file);
  console.log(file);
}
const clickText = (page, pattern, scope = "") =>
  page.evaluate((scope, source) => {
    const re = new RegExp(source);
    const el = [...document.querySelectorAll(`${scope} button, ${scope} a`)].find((b) => re.test(b.textContent.trim()));
    if (!el) throw new Error(`no button /${source}/`);
    el.click();
  }, scope, pattern.source);

async function staffPage(code, password) {
  // A browser profile of its own: each operator signs in for themselves.
  const context = browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${srv.base}/admin/`, { waitUntil: "networkidle0" });
  return Object.assign(page, {
    signIn: async () => {
      await page.type("input[autocomplete=username]", code);
      await page.type("input[type=password]", password);
      await page.keyboard.press("Enter");
      await page.waitForSelector("nav button", { timeout: 15000 });
      await sleep(1500);
    },
    tab: async (label) => {
      await clickText(page, new RegExp(`^${label}`), "nav");
      await sleep(1500);
    },
  });
}

try {
  // The data: three operators, an evening, three paid orders, a line taken off.
  srv.reset();
  const shared = client(srv.base);
  await shared.login();
  const person = (firstName, middleName, lastName, password, role) =>
    shared.admin("/api/qr/admin/staff.php", { action: "create", firstName, middleName, lastName, password, role });
  await person("Мария", "Иванова", "Петрова", "manager-pass-1", "manager");
  const boss = client(srv.base);
  await boss.post("/api/qr/admin/login.php", { code: "0001", password: "manager-pass-1" });
  await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", middleName: "Петров", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
  await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Елена", middleName: "Стоянова", lastName: "Димитрова", password: "auditor-pass-1", role: "auditor" });
  await boss.admin("/api/qr/admin/settings.php", { date: today, opens: "00:00", closes: "23:59", tables: 12, disabledTables: [], paused: false, paymentMode: "online" });
  await bridge().check();
  const menu = srv.menu();
  const sell = async (table, lines) => {
    const res = await client(srv.base).post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });
    await stripe.pay(new URL(res.body.checkoutUrl).pathname.slice(5));
    return res.body.order;
  };
  const first = await sell(4, [["caesar", "chicken", 1], ["tiramisu"]]);
  await sell(7, [["tiramisu"], ["caesar", "chicken", 2]]);
  await drain();
  await boss.admin("/api/qr/admin/order.php", { id: first.id, action: "void", line: 1, qty: 1, have: 1, reason: "Изчерпан продукт" });
  await drain();

  // The guest's phone: the menu, and the payment.
  const phone = await browser.newPage();
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
  await clickText(phone, /^5$/, "[role=dialog]").catch(() => {});
  await shot(phone, "menu-na-telefona");
  // The payment page is Stripe's own: photographed from a phone with a test card, not here.

  // Staff: the sign-in, the orders with their УНП, „За касата“.
  const mgr = await staffPage("0001", "manager-pass-1");
  await shot(mgr, "vhod");
  await mgr.signIn();
  await shot(mgr, "porachkite-s-unp");
  await mgr.tab("За касата");
  await shot(mgr, "za-kasata");
  await mgr.tab("Персонал");
  await shot(mgr, "personal");
  await mgr.tab("Журнал");
  await shot(mgr, "zhurnal");
  await mgr.tab("Справки НАП");
  await shot(mgr, "spravki-nap");
  const tables = await mgr.$$eval("select option", (os) => os.map((o) => [o.parentElement.name || "", o.value, o.textContent.trim()]));
  for (const [, value, label] of tables.filter(([, v, l]) => /^18\.|nom_/.test(v) || /^18\./.test(l))) {
    await mgr.evaluate((value) => {
      const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === value));
      sel.value = value;
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await sleep(1200);
    await shot(mgr, `spravka-${value.replace(/[^\w.]/g, "_")}-${label.slice(0, 20).replace(/[^\wа-яА-Я.]+/g, "_")}`);
  }
  await mgr.tab("Система");
  await shot(mgr, "sistema");
  await mgr.tab("История");
  await shot(mgr, "istoriya");

  // The printer not ready: the menu won't take orders, staff see the red band.
  printer.setStatusOk(false);
  await bridge().step().catch(() => {});
  await phone.goto(`${srv.base}/menu/?lang=bg`, { waitUntil: "networkidle0" });
  await shot(phone, "menu-kasata-ne-e-gotova");
  await mgr.reload({ waitUntil: "networkidle0" });
  await sleep(2000);
  await shot(mgr, "lentata-kasata-ne-e-gotova");
  printer.setStatusOk(true);

  // The printer's clock 10 minutes off.
  printer.refuseClock(true);
  printer.setClock(600);
  await bridge().step().catch(() => {});
  await mgr.reload({ waitUntil: "networkidle0" });
  await sleep(2000);
  await mgr.tab("За касата");
  await shot(mgr, "chasovnikat-na-kasata");
  printer.refuseClock(false);
  printer.setClock(0);
  await bridge().step().catch(() => {}); // the printer right again: the red band goes

  // The auditor: reads everything, changes nothing.
  const aud = await staffPage("0003", "auditor-pass-1");
  await aud.signIn();
  await shot(aud, "proveryavasht");
  // A change the auditor tries is refused.
  await clickText(aud, /^Приеми/).catch(() => {});
  await sleep(1500);
  await shot(aud, "proveryavasht-otkaz");
  await aud.tab("Журнал").catch(() => {});
  await shot(aud, "proveryavasht-zhurnal");
  console.log(`${made.length} screenshots in ${OUT}`);
} finally {
  await browser.close();
  srv.stop();
  await stripe.stop();
  await printer.stop();
}
