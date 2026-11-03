// The end-of-day transfer to Clock PMS+ (_lib/clock.php), against a real PHP
// server, a fake Stripe, a fake printer with the real bridge, and a fake Clock
// (tests/qr/fake-clock.mjs): each sale, once its receipt has printed, goes to
// Clock the morning after as a closed folio, once, whatever goes wrong on the
// way, less what was refunded before. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeClock } from "./fake-clock.mjs";
import { startFakeErpNet, PRINTER } from "./fake-erpnet.mjs";
import { createBridge } from "../../tools/fiscal-bridge/bridge.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const BEFORE_MORNING = sofia("2026-10-04T05:59", 3);
const MORNING = sofia("2026-10-04T06:00", 3);
const WEBHOOK_SECRET = "whsec_test_clock";
const KEY = "test-bridge-key-0123456789abcdef0123456789";
const COMPANY = 500;
const T = { kitchen: 1001, bar: 1002, desserts: 1003 };
const CONFIG = {
  clock_mode: "test",
  clock_base_url: "https://sky-eu1.clock-software.invalid/base_api/1/2",
  clock_api_user: "api_user_test",
  clock_api_key: "api_key_test",
  clock_company_id: COMPANY,
  fiscal_mode: "test",
  fiscal_bridge_token: KEY,
};

let srv;
let stripe;
let clock;
let printer;
let work;
let menu;
let price;
let settings;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  clock = await startFakeClock({ user: CONFIG.clock_api_user, key: CONFIG.clock_api_key });
  printer = await startFakeErpNet();
  srv = await startServer({
    stripe: { key: "rk_test_clock", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" },
    clock: { api: clock.base, ...CONFIG },
  });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  price = (id, variant = "std") => items.get(id).variants.find((v) => v.id === variant).price;
  // Whatever ids the file holds, these tests give the stations and desserts their own.
  settings = readFileSync(settingsFile(), "utf8")
    .replace(/'kitchen' => \d+/, `'kitchen' => ${T.kitchen}`)
    .replace(/'bar' => \d+/, `'bar' => ${T.bar}`)
    .replace("'tip' => 0,", `'tip' => 0,\n        'desserts' => ${T.desserts},`);
});
after(async () => {
  srv.stop();
  await stripe.stop();
  await clock.stop();
  await printer.stop();
});
beforeEach(() => {
  stripe.reset();
  clock.reset();
  printer.reset();
  srv.config(CONFIG);
  writeFileSync(settingsFile(), settings);
  work = mkdtempSync(path.join(tmpdir(), "raya-bridge-"));
});

const settingsFile = () => path.join(srv.root, "api", "qr", "_lib", "clock-settings.php");
/** The bridge, its polls at `at`: the evening itself, unless a test moves on. */
const bridge = (at = AT_20H) =>
  createBridge(
    { server: srv.base, key: KEY, erpnet: printer.base, printerId: "", journal: path.join(work, "journal.json"), waitMs: 1500, headers: { "X-Test-Now": String(at) } },
    { log: () => {} },
  );
async function print(at = AT_20H) {
  const b = bridge(at);
  for (let i = 0; i < 10; i++) if ((await b.step()) > 0) return;
}

async function setUp(paymentMode = "online") {
  srv.reset();
  const admin = client(srv.base, { now: AT_20H });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  await bridge().check();
  return admin;
}
const guest = () => client(srv.base, { now: AT_20H });
const order = async (table, lines) => {
  const res = await guest().post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  return res.body;
};
const sessionOf = (body) => stripe.sessions.get(new URL(body.checkoutUrl).pathname.slice(5));
const docs = () => JSON.parse(srv.sqlite("SELECT * FROM clock_docs ORDER BY id"));
const folios = () => [...clock.folios.values()];
const voidLine = (admin, id, line, qty, have) => admin.admin("/api/qr/admin/order.php", { id, action: "void", line, qty, have, reason: "Изчерпан продукт" });
const cancel = (admin, id) => admin.admin("/api/qr/admin/order.php", { id, action: "cancel", from: "new", reason: "Гостът си тръгна" });
const charges = (f) => f.charges.map((c) => [c.qty, c.price_cents]);
const credits = (f) => f.credits.map((c) => c.value_cents);
async function paid(table, lines) {
  const placed = await order(table, lines);
  await stripe.pay(sessionOf(placed).id);
  return placed;
}
/** Paid and printed. */
async function sold(table, lines) {
  const placed = await paid(table, lines);
  await print();
  return placed;
}
/** A staff screen polling at `at`; the send runs before its request ends here. */
async function poll(at = MORNING) {
  const staff = client(srv.base, { now: at });
  assert.equal((await staff.login()).status, 200);
  const feed = (await staff.get("/api/qr/admin/feed.php?since=0")).body;
  for (let i = 0; i < 100 && docs().some((d) => d.status === "sending"); i++) await new Promise((r) => setTimeout(r, 50));
  return feed;
}

describe("Clock PMS+: the transfer", () => {
  it("nothing goes during the evening; at 6 in the morning each bill is a closed folio, paid, with no document", async () => {
    await setUp();
    const { order: a } = await sold(4, [["caesar", "chicken", 1], ["tiramisu"]]);
    const { order: b } = await sold(5, [["tiramisu", "std", 2]]);
    await poll(AT_20H);
    await poll(BEFORE_MORNING);
    assert.equal(clock.requests.length, 0, "nothing before the morning");

    await poll(MORNING);
    assert.deepEqual(docs().map((d) => [d.code, d.status, d.step]), [[a.code, "done", 4], [b.code, "done", 4]]);
    const [f1, f2] = folios();
    assert.equal(f1.company, COMPANY);
    assert.deepEqual(charges(f1), [[1, price("caesar", "chicken")], [1, price("tiramisu")]]);
    assert.deepEqual(charges(f2), [[2, price("tiramisu")]]);
    assert.deepEqual(credits(f1), [price("caesar", "chicken") + price("tiramisu")]);
    assert.ok(folios().every((f) => f.closedAt && f.documentType === null), "closed, with no document type: no fiscal event");
    assert.deepEqual(f1.charges.map((c) => c.charge_template_id), [T.kitchen, T.desserts]);
    assert.ok(f1.charges.every((c) => c.service_date === EVENING.date), "dated the evening");
    assert.equal(clock.overRate(), 0);

    // The bill and the УНП on each charge; the printer on the payment.
    const usn = JSON.parse(srv.sqlite(`SELECT usn FROM orders WHERE id = ${a.id}`))[0].usn;
    assert.match(usn, new RegExp(`^${PRINTER.serialNumber}-9001-`));
    assert.ok(f1.charges.every((c) => c.print_text.includes(a.code) && c.print_text.includes(usn)));
    assert.equal(f1.credits[0].text, `Продажба чрез ФУ с ИН ${PRINTER.serialNumber}`);
    assert.equal(f1.credits[0].payment_type, "card");

    const logged = JSON.parse(srv.sqlite("SELECT ref, detail, operator FROM audit_log WHERE kind = 'clock_transfer' ORDER BY id"));
    assert.equal(logged.length, 2);
    assert.deepEqual([logged[0].ref, logged[0].operator], [a.code, "9000"]);
    assert.match(logged[0].detail, /фолио FL-1/);

    await poll(MORNING + 4000);
    assert.equal(folios().length, 2, "once");
  });

  it("the bridge's poll starts it too: nobody has to be at a screen", async () => {
    await setUp();
    await sold(4, [["tiramisu"]]);
    await bridge(MORNING).step();
    for (let i = 0; i < 100 && docs()[0].status !== "done"; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(docs()[0].status, "done");
    assert.equal(folios().length, 1);
  });

  it("only what has printed: a receipt not out yet holds its sale back", async () => {
    await setUp();
    await paid(4, [["tiramisu"]]);
    await poll(MORNING);
    assert.equal(clock.requests.length, 0);
    await print();
    await poll(MORNING);
    assert.equal(docs()[0].status, "done");
  });

  it("a table's bill: each payment its own folio, for the lines it paid", async () => {
    await setUp("tab");
    const a = await order(5, [["tiramisu"]]);
    const b = await order(5, [["caesar", "chicken", 1]]);
    const pay = (code, amount) => guest().post("/api/qr/bill-pay.php", { table: 5, lang: "bg", items: [{ code, line: 0 }], expectedAmount: amount, tip: 0 }, { headers: { "Idempotency-Key": newKey() } });
    const first = await pay(a.order.code, price("tiramisu"));
    assert.equal(first.status, 201, first.text);
    await stripe.pay(sessionOf(first.body).id);
    const second = await pay(b.order.code, price("caesar", "chicken"));
    await stripe.pay(sessionOf(second.body).id);
    await print();
    await poll(MORNING);
    assert.deepEqual(folios().map(charges), [[[1, price("tiramisu")]], [[1, price("caesar", "chicken")]]]);
    assert.deepEqual(docs().map((d) => [d.source, d.status]), [["bill", "done"], ["bill", "done"]]);
  });
});

describe("Clock PMS+: refunds", () => {
  it("a line back before the transfer: Clock gets the final result, the details stay here", async () => {
    const admin = await setUp();
    const { order: o } = await sold(4, [["caesar", "chicken", 1], ["tiramisu"]]);
    assert.equal((await voidLine(admin, o.id, 1, 1, 1)).status, 200);
    await print();
    await poll(MORNING);
    const [f] = folios();
    assert.deepEqual(charges(f), [[1, price("caesar", "chicken")]]);
    assert.deepEqual(credits(f), [price("caesar", "chicken")]);
    assert.ok(f.closedAt);
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "done"], ["storno", "netted"]]);
    assert.equal(docs()[1].total_cents, price("tiramisu"), "kept here");
  });

  it("refunded in full before the transfer: nothing goes to Clock", async () => {
    const admin = await setUp();
    const { order: o } = await sold(4, [["tiramisu"]]);
    assert.equal((await cancel(admin, o.id)).status, 200);
    await print();
    await poll(MORNING);
    assert.equal(clock.requests.length, 0);
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "netted"], ["storno", "netted"]]);
  });

  it("a refund after the transfer: a folio of its own next morning, at a negative quantity and payment, on the refund's day", async () => {
    await setUp();
    const { order: o } = await sold(4, [["caesar", "chicken", 1], ["tiramisu"]]);
    await poll(MORNING);
    const LATER = sofia("2026-10-04T11:00", 3);
    const admin = client(srv.base, { now: LATER });
    assert.equal((await admin.login()).status, 200);
    assert.equal((await voidLine(admin, o.id, 1, 1, 1)).status, 200);
    await print(LATER);
    await poll(LATER);
    assert.equal(folios().length, 1, "waits for the next transfer");

    await poll(sofia("2026-10-05T06:00", 3));
    const [sale, back] = folios();
    assert.deepEqual(charges(sale), [[1, price("caesar", "chicken")], [1, price("tiramisu")]], "the closed folio is left alone");
    assert.deepEqual(charges(back), [[-1, price("tiramisu")]]);
    assert.deepEqual(credits(back), [-price("tiramisu")]);
    assert.ok(back.closedAt);
    assert.equal(back.charges[0].service_date, "2026-10-04");
    assert.match(back.credits[0].text, /^Сторно: Продажба чрез ФУ/);
  });
});

describe("Clock PMS+: when something goes wrong", () => {
  const STEPS = [
    ["the items", /\/charges\/bulk$/, /\/charges$/],
    ["the payment", /\/credit_items$/, /\/credit_items$/],
    ["closing", /\/close$/, /\/folios\/\d+$/],
  ];

  it("Clock down: it says why, and a later poll goes on from where it stopped", async () => {
    await setUp();
    await sold(4, [["tiramisu"]]);
    clock.failNext("POST", /\/credit_items$/, 503, { error: "Service Unavailable" });
    await poll(MORNING);
    let [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["failed", 2]);
    assert.match(doc.error, /HTTP 503: Service Unavailable/);
    await poll(MORNING + 10);
    assert.equal(docs()[0].status, "failed", "waits its turn");
    await poll(MORNING + 61);
    [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["done", 4]);
    assert.equal(folios().length, 1);
    assert.equal(folios()[0].charges.length, 1);
    assert.equal(folios()[0].credits.length, 1);
  });

  for (const [what, send, ask] of STEPS) {
    it(`an answer lost on ${what}: Clock is asked, and nothing happens twice`, async () => {
      await setUp();
      await sold(4, [["caesar", "chicken", 1], ["tiramisu"]]);
      clock.loseNext("POST", send);
      await poll(MORNING);
      assert.equal(docs()[0].status, "failed");
      assert.ok(docs()[0].inflight > 0);
      await poll(MORNING + 61);
      const [doc] = docs();
      assert.deepEqual([doc.status, doc.step, doc.inflight], ["done", 4, 0]);
      const [f] = folios();
      assert.equal(f.charges.length, 2);
      assert.equal(f.credits.length, 1);
      assert.ok(f.closedAt);
      assert.equal(clock.calls("POST", send).length, 1);
      assert.equal(clock.calls("GET", ask).length, 1);
    });
  }

  it("an answer lost, and Clock cannot be asked: it stops for a person, with the folio to check", async () => {
    const admin = await setUp();
    await sold(4, [["tiramisu"]]);
    clock.deny("base_api_charges_index");
    clock.loseNext("POST", /\/charges\/bulk$/);
    await poll(MORNING);
    await poll(MORNING + 61);
    let [doc] = docs();
    assert.equal(doc.status, "check");
    assert.match(doc.error, /FL-1 — check it in Clock/);
    await poll(MORNING + 4000);
    assert.equal(clock.calls("POST", /\/charges\/bulk$/).length, 1, "never sent again by itself");
    // A person looked, found nothing in FL-1, and retries.
    const res = await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "retry" });
    assert.equal(res.status, 200, res.text);
    await poll(MORNING + 4001);
    [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["done", 4]);
    assert.equal((await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "retry" })).status, 409, "only a stopped one");
    assert.equal((await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "closed" })).status, 400, "staff don't close anything any more");
  });

  it("a line with no charge template is not sent, and says which", async () => {
    await setUp();
    writeFileSync(settingsFile(), settings.replace(`'kitchen' => ${T.kitchen}`, "'kitchen' => 0"));
    await sold(4, [["caesar", "chicken", 1]]);
    await poll(MORNING);
    const [doc] = docs();
    assert.equal(doc.status, "failed");
    assert.match(doc.error, /no charge template for: /);
    assert.equal(clock.requests.length, 0);
  });

  it("the right to make folios missing: Clock's reason, on the staff screen", async () => {
    await setUp();
    await sold(4, [["tiramisu"]]);
    clock.failNext("POST", /^\/companies\/\d+\/folios$/, 403, { error: "The User doesn't have base_api_company_folios_create right" });
    const feed = await poll(MORNING);
    assert.equal(docs()[0].status, "failed");
    assert.match(docs()[0].error, /base_api_company_folios_create/);
    assert.equal(feed.clock.hour, 6);
  });
});

describe("Clock PMS+: entered by hand", () => {
  it("a receipt that never printed, entered in Clock by hand: never sent, its refund neither", async () => {
    const admin = await setUp();
    const { order: o } = await paid(4, [["tiramisu"]]);
    assert.equal((await admin.admin("/api/qr/admin/till.php", { id: o.id, entered: true })).status, 200);
    await poll(MORNING);
    assert.equal(docs()[0].status, "manual");
    assert.equal(clock.requests.length, 0);
  });

  it("a printed receipt also ticks „За касата“, and that doesn't count as by hand", async () => {
    await setUp();
    const { order: o } = await sold(4, [["tiramisu"]]);
    assert.ok(JSON.parse(srv.sqlite(`SELECT till_at FROM orders WHERE id = ${o.id}`))[0].till_at > 0);
    await poll(MORNING);
    assert.equal(docs()[0].status, "done");
  });
});

describe("Clock PMS+: switches", () => {
  it("test payments never reach a live account, off is off, and without receipts nothing goes", async () => {
    await setUp();
    srv.config({ clock_mode: "live" });
    await paid(4, [["tiramisu"]]);
    srv.config({ clock_mode: "off" });
    await paid(5, [["tiramisu"]]);
    srv.config({ clock_mode: "test", fiscal_mode: null });
    await paid(6, [["tiramisu"]]);
    assert.equal(docs().length, 0);
    assert.equal(clock.requests.length, 0);
  });
});
