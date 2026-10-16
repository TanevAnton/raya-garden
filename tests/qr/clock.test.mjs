// Phone payments into Clock PMS+ (_lib/clock.php), against a real PHP server,
// a fake Stripe and a fake Clock (tests/qr/fake-clock.mjs): every payment
// Stripe confirms becomes a folio in Clock, once, whatever goes wrong on the
// way, with its items and the tip — and nothing else: staff add the card
// payment and close it in Clock. Refunds go onto the folio while it is open.
// „За касата“ ticks itself, and stays the fallback. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeClock } from "./fake-clock.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_clock";
const COMPANY = 500;
const T = { kitchen: 1001, bar: 1002, desserts: 1003 };
const CLOCK = {
  clock_mode: "test",
  clock_base_url: "https://sky-eu1.clock-software.invalid/base_api/1/2",
  clock_api_user: "api_user_test",
  clock_api_key: "api_key_test",
  clock_company_id: COMPANY,
};

let srv;
let stripe;
let clock;
let menu;
let price;
let item;
let settings;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  clock = await startFakeClock({ user: CLOCK.clock_api_user, key: CLOCK.clock_api_key });
  srv = await startServer({
    stripe: { key: "rk_test_clock", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" },
    clock: { api: clock.base, ...CLOCK },
  });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, { ...i, category: c.id }])));
  item = (id) => items.get(id);
  price = (id, variant = "std") => items.get(id).variants.find((v) => v.id === variant).price;
  // Whatever ids the file holds, these tests give the stations and desserts their own.
  settings = readFileSync(settingsFile(), "utf8")
    .replace(/'kitchen' => \d+/, `'kitchen' => ${T.kitchen}`)
    .replace(/'bar' => \d+/, `'bar' => ${T.bar}`)
    .replace("'tip' => 0,", `'tip' => 0,\n        '${"desserts"}' => ${T.desserts},`);
});
after(async () => {
  srv.stop();
  await stripe.stop();
  await clock.stop();
});
beforeEach(() => {
  stripe.reset();
  clock.reset();
  srv.config(CLOCK);
  writeFileSync(settingsFile(), settings);
});

const settingsFile = () => path.join(srv.root, "api", "qr", "_lib", "clock-settings.php");

async function setUp(paymentMode = "online") {
  srv.reset();
  const admin = client(srv.base, { now: AT_20H });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  return admin;
}
const guest = () => client(srv.base, { now: AT_20H });
const order = async (table, lines, extra = {}) => {
  const res = await guest().post("/api/qr/order.php", orderBody(menu, table, lines, extra), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  return res.body;
};
const sessionOf = (body) => stripe.sessions.get(new URL(body.checkoutUrl).pathname.slice(5));
const docs = () => JSON.parse(srv.sqlite("SELECT * FROM clock_docs ORDER BY id"));
const row = (id) => JSON.parse(srv.sqlite(`SELECT * FROM orders WHERE id = ${id}`))[0];
const folios = () => [...clock.folios.values()];
const voidLine = (admin, id, line, qty, have) => admin.admin("/api/qr/admin/order.php", { id, action: "void", line, qty, have, reason: "Изчерпан продукт" });
const cancel = (admin, id) => admin.admin("/api/qr/admin/order.php", { id, action: "cancel", from: "new", reason: "Гостът си тръгна" });
const tick = (admin, id, entered) => admin.admin("/api/qr/admin/till.php", { id, entered });
/** A staff screen on the real clock (the webhook ran on it), polling `later` seconds on. */
async function poll(later) {
  const now = Math.floor(Date.now() / 1000);
  const staff = client(srv.base, { now: now + later });
  assert.equal((await staff.login()).status, 200);
  return (await staff.get("/api/qr/admin/feed.php?since=0")).body;
}
/** Wait until nothing is on its way (the send runs after the webhook's answer). */
async function settle() {
  for (let i = 0; i < 100; i++) {
    if (!docs().some((d) => d.status === "sending")) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail("still sending");
}
async function paid(table, lines, extra = {}) {
  const placed = await order(table, lines, extra);
  await stripe.pay(sessionOf(placed).id);
  await settle();
  return placed;
}

const charges = (f) => f.charges.map((c) => [c.qty, c.price_cents]);
/** Staff added the card payment and closed the folio in Clock. */
const closeInClock = (f) => (f.closedAt = new Date().toISOString());

describe("Clock PMS+: a sale", () => {
  it("an order paid on the phone becomes a folio with its items under their templates and the tip — no payment, not closed", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const D = price("tiramisu");
    const placed = await paid(4, [["caesar", "chicken", 2], ["coca-cola-products", "std", 3, "sprite"], ["tiramisu"]], { tip: 150 });
    const { id, code } = placed.order;

    assert.equal(folios().length, 1);
    const [f] = folios();
    assert.deepEqual([f.company, f.currency, f.number, f.closedAt], [COMPANY, "EUR", "FL-1", null]);
    const [doc] = docs();
    assert.deepEqual(f.charges.map((c) => [c.qty, c.price_cents, c.charge_template_id, c.revenue_group, c.tax_rate, c.service_date, c.print_text]), [
      [2, C, T.kitchen, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [3, S, T.bar, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [1, D, T.desserts, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [1, 150, null, "surcharge", 0, "2026-10-03", `QR ${code} #${doc.id}`],
    ]);
    assert.ok(f.charges[0].text.startsWith(item("caesar").bg), f.charges[0].text);
    assert.deepEqual(f.credits, [], "the card payment is the waiter's, in Clock");
    assert.equal(clock.calls("POST", /\/(credit_items|close)$/).length, 0, "nothing paid or closed through the API");

    const total = 2 * C + 3 * S + D + 150;
    assert.deepEqual([doc.kind, doc.status, doc.step, doc.total_cents, doc.tip_cents, doc.folio_number, doc.error], ["sale", "done", 2, total, 150, "FL-1", ""]);
    const o = row(id);
    assert.ok(o.till_at > 0, "„За касата“: entered");
    assert.equal(o.till_cents, total - 150);
    const shown = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
    const d = shown.clockDocs.find((x) => x.sourceId === id);
    assert.deepEqual([d.status, d.folio, d.closed, d.total, d.tip], ["done", "FL-1", false, total, 150]);
    assert.deepEqual(shown.clock, { mode: "test" });
  });

  it("staff tick the folio closed once they have paid and closed it in Clock", async () => {
    const admin = await setUp();
    await paid(4, [["tiramisu"]]);
    const [doc] = docs();
    const res = await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "closed" });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.doc.closed, docs()[0].step], [true, 3]);
    assert.equal((await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "closed" })).status, 409, "once");
  });

  it("Stripe repeating itself still makes one folio", async () => {
    await setUp();
    const placed = await order(4, [["tiramisu"]]);
    const s = sessionOf(placed);
    await stripe.pay(s.id);
    await settle();
    await stripe.pay(s.id);
    await stripe.pay(s.id, { type: "checkout.session.async_payment_succeeded" });
    await settle();
    assert.equal(folios().length, 1);
    assert.equal(docs().length, 1);
    assert.equal(clock.calls("POST", /\/charges\/bulk$/).length, 1);
  });

  it("a table's bill: each payment its own folio, for the lines it paid", async () => {
    const admin = await setUp("tab");
    const a = await order(5, [["tiramisu"]]);
    const b = await order(5, [["caesar", "chicken", 1]]);
    const pay = (lines, tip) =>
      guest().post("/api/qr/bill-pay.php", { table: 5, lang: "bg", items: lines.map(([c, l]) => ({ code: c, line: l })), expectedAmount: lines.reduce((s, [c]) => s + (c === a.order.code ? price("tiramisu") : price("caesar", "chicken")), 0), tip },
        { headers: { "Idempotency-Key": newKey() } });
    const first = await pay([[a.order.code, 0]], 50);
    assert.equal(first.status, 201, first.text);
    await stripe.pay(sessionOf(first.body).id);
    await settle();
    const second = await pay([[b.order.code, 0]], 0);
    await stripe.pay(sessionOf(second.body).id);
    await settle();

    assert.equal(folios().length, 2);
    const [f1, f2] = folios();
    assert.deepEqual(charges(f1), [[1, price("tiramisu")], [1, 50]]);
    assert.deepEqual(charges(f2), [[1, price("caesar", "chicken")]]);
    assert.deepEqual(docs().map((d) => [d.source, d.status, d.code]), [["bill", "done", first.body.payment.code], ["bill", "done", second.body.payment.code]]);
    const payments = (await admin.get("/api/qr/admin/feed.php?since=0")).body.billPayments;
    assert.ok(payments.every((p) => p.tillAt > 0), "both ticked on „За касата“");
    assert.equal(payments.find((p) => p.code === first.body.payment.code).tillCents, price("tiramisu"), "without the tip");
  });
});

describe("Clock PMS+: when something goes wrong", () => {
  it("Clock down: „За касата“ waits, and the staff screen's poll tries again a minute on", async () => {
    await setUp();
    clock.failNext("POST", /^\/companies\/\d+\/folios$/, 503, { error: "Service Unavailable" });
    const placed = await paid(4, [["tiramisu"]]);
    let [doc] = docs();
    assert.deepEqual([doc.status, doc.tries, doc.step, doc.error], ["failed", 1, 0, "HTTP 503: Service Unavailable"]);
    assert.equal(row(placed.order.id).till_at, 0, "still to enter by hand meanwhile");
    assert.equal((await poll(0)).clockDocs[0].status, "failed");
    await poll(30);
    assert.equal(docs()[0].status, "failed", "not within the minute");
    await poll(61);
    [doc] = docs();
    assert.deepEqual([doc.status, doc.tries, doc.step], ["done", 2, 2]);
    assert.equal(folios().length, 1);
    assert.ok(row(placed.order.id).till_at > 0);
  });

  it("an answer lost after the items went in: Clock is asked, and nothing goes in twice", async () => {
    await setUp();
    clock.loseNext("POST", /\/charges\/bulk$/);
    await paid(4, [["caesar", "chicken", 1], ["tiramisu"]]);
    let [doc] = docs();
    assert.deepEqual([doc.status, doc.step, doc.inflight], ["failed", 1, 2]);
    await poll(61);
    [doc] = docs();
    assert.deepEqual([doc.status, doc.step, doc.inflight], ["done", 2, 0]);
    assert.equal(folios()[0].charges.length, 2, "the two lines, once");
    assert.equal(clock.calls("POST", /\/charges\/bulk$/).length, 1);
    assert.equal(clock.calls("GET", /\/charges$/).length, 1);
  });

  it("an answer lost, and Clock cannot be asked: it stops for a person, with the folio to check", async () => {
    const admin = await setUp();
    clock.deny("base_api_charges_index");
    clock.loseNext("POST", /\/charges\/bulk$/);
    await paid(4, [["tiramisu"]]);
    await poll(61);
    let [doc] = docs();
    assert.equal(doc.status, "check");
    assert.match(doc.error, /FL-1 — check it in Clock/);
    await poll(4000);
    assert.equal(clock.calls("POST", /\/charges\/bulk$/).length, 1, "never sent again by itself");
    // A person looked, found nothing in FL-1, and retries.
    const res = await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "retry" });
    assert.equal(res.status, 200, res.text);
    await settle();
    [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["done", 2]);
    assert.equal((await admin.admin("/api/qr/admin/clock.php", { id: doc.id, action: "retry" })).status, 409, "only a stopped one");
  });

  it("a line with no charge template is not sent, and says which", async () => {
    await setUp();
    writeFileSync(settingsFile(), settings.replace(`'bar' => ${T.bar}`, "'bar' => 0"));
    await paid(4, [["tiramisu"], ["coca-cola-products", "std", 1, "sprite"]]);
    const [doc] = docs();
    assert.equal(doc.status, "failed");
    assert.equal(doc.error, `no charge template for: ${item("coca-cola-products").category} (clock-settings.php)`);
    assert.equal(clock.requests.length, 0, "nothing reached Clock");
  });

  it("a company that does not accept charges: Clock's reason, for „За касата“", async () => {
    await setUp();
    clock.company(COMPANY, { accepts: false });
    await paid(4, [["tiramisu"]]);
    const [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["failed", 1]);
    assert.equal(doc.error, "HTTP 500: QR меню – онлайн does not accept charges!");
  });
});

describe("Clock PMS+: entered by hand", () => {
  it("ticked on „За касата“ before it went: never sent", async () => {
    const admin = await setUp();
    clock.failNext("POST", /^\/companies\/\d+\/folios$/, 503);
    const placed = await paid(4, [["tiramisu"]]);
    assert.equal((await tick(admin, placed.order.id, true)).status, 200);
    assert.equal(docs()[0].status, "manual");
    await poll(61);
    assert.equal(folios().length, 0);
    assert.equal(docs()[0].status, "manual");
  });

  it("while it is being sent, or once Clock has it, a tick by hand is refused", async () => {
    const admin = await setUp();
    const placed = await paid(4, [["tiramisu"]]);
    const { id } = placed.order;
    const undo = await tick(admin, id, false);
    assert.deepEqual([undo.status, undo.body.error], [409, "clock_done"]);
    srv.sqlite(`UPDATE clock_docs SET status = 'sending', claimed_at = ${AT_20H} WHERE source_id = ${id}`);
    srv.sqlite(`UPDATE orders SET till_at = 0 WHERE id = ${id}`);
    const now = await tick(admin, id, true);
    assert.deepEqual([now.status, now.body.error], [409, "clock_sending"]);
  });
});

describe("Clock PMS+: refunds", () => {
  it("while the folio is open: the items that went back go onto it at a negative quantity, so it closes at what was paid", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await paid(4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 3, "sprite"]], { tip: 100 });
    const { id } = placed.order;

    assert.equal((await voidLine(admin, id, 1, 1, 3)).status, 200);
    await settle();
    let [sale, storno] = docs();
    assert.deepEqual([storno.kind, storno.sale_id, storno.status, storno.total_cents, storno.folio_number], ["storno", sale.id, "done", S, "FL-1"]);
    assert.equal(folios().length, 1, "no folio of its own");
    const [f] = folios();
    assert.deepEqual(f.charges.slice(4 - 1).map((c) => [c.qty, c.price_cents, c.charge_template_id, c.print_text]), [[-1, S, T.bar, `QR ${sale.code} #${storno.id}`]]);
    assert.deepEqual([row(id).till_cents, row(id).till_void_cents], [C + 3 * S, S], "„За касата“: voided in Clock");
    // The waiter's amount: what the guest paid, less what went back.
    const shown = (await admin.get("/api/qr/admin/feed.php?since=0")).body.clockDocs;
    assert.deepEqual(shown.map((d) => [d.kind, d.total]), [["sale", C + 3 * S + 100], ["storno", S]]);

    assert.equal((await cancel(admin, id)).status, 200);
    await settle();
    assert.equal(docs().length, 3);
    assert.deepEqual(charges(f).slice(4), [[-1, C], [-2, S], [-1, 100]], "what was left, tip included");
    assert.equal(f.charges.reduce((s, c) => s + c.qty * c.price_cents, 0), 0, "the folio comes to nothing: nothing to close at");
    assert.deepEqual([row(id).till_cents, row(id).till_void_cents], [C + 3 * S, C + 3 * S]);
    assert.equal(clock.overRate(), 0, "never more than 5 calls a second");
  });

  it("once the folio is closed in Clock (the receipt printed): nothing is sent, the storno is staff's", async () => {
    const admin = await setUp();
    const S = price("coca-cola-products");
    const placed = await paid(4, [["tiramisu"], ["coca-cola-products", "std", 2, "sprite"]]);
    closeInClock(folios()[0]); // closed in Clock, not ticked here
    assert.equal((await voidLine(admin, placed.order.id, 1, 1, 2)).status, 200);
    await settle();
    const [sale, storno] = docs();
    assert.deepEqual([storno.status, storno.error], ["manual", "folio FL-1 is closed: storno it in Clock"]);
    assert.equal(sale.step, 3, "the sale is known closed now");
    assert.equal(folios()[0].charges.length, 2, "nothing added to the closed folio");
    const till = (await admin.get("/api/qr/admin/feed.php?since=0")).body.orders.find((o) => o.id === placed.order.id);
    assert.equal(till.tillCents - till.tillVoidCents - till.net, S, "on „Сторнирай в Clock“, for the waiter");

    // Ticked closed here first: Clock is not even asked.
    const next = await paid(5, [["tiramisu"], ["coca-cola-products", "std", 1, "sprite"]]);
    const [, , sale2] = docs();
    assert.equal((await admin.admin("/api/qr/admin/clock.php", { id: sale2.id, action: "closed" })).status, 200);
    const asked = clock.calls("GET", /^\/folios\/\d+$/).length;
    assert.equal((await voidLine(admin, next.order.id, 1, 1, 1)).status, 200);
    await settle();
    assert.equal(docs()[3].status, "manual");
    assert.equal(clock.calls("GET", /^\/folios\/\d+$/).length, asked);
  });

  it("a refund waits for its sale: one made before the sale reached Clock goes after it", async () => {
    const admin = await setUp();
    clock.failNext("POST", /^\/companies\/\d+\/folios$/, 503);
    const placed = await paid(4, [["tiramisu"], ["caesar", "chicken", 1]]);
    assert.equal((await voidLine(admin, placed.order.id, 0, 1, 1)).status, 200);
    await settle();
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "failed"], ["storno", "pending"]]);
    assert.equal(folios().length, 0);
    await poll(61);
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "done"], ["storno", "done"]]);
    assert.deepEqual(folios().map((f) => f.charges.map((c) => c.qty)), [[1, 1, -1]]);
  });
});

describe("Clock PMS+: switches", () => {
  it("test payments never reach a live till, and off is off", async () => {
    await setUp();
    srv.config({ clock_mode: "live" });
    await paid(4, [["tiramisu"]]);
    srv.config({ clock_mode: "off" });
    await paid(5, [["tiramisu"]]);
    assert.equal(docs().length, 0);
    assert.equal(clock.requests.length, 0);
  });
});
