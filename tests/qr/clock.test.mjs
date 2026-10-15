// Phone payments into Clock PMS+ (_lib/clock.php), against a real PHP server,
// a fake Stripe and a fake Clock (tests/qr/fake-clock.mjs): every payment
// Stripe confirms becomes a folio in Clock, once, whatever goes wrong on the
// way; refunds become storno folios; „За касата“ ticks itself, and stays the
// fallback. Run: npm run test:qr
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
const DOCUMENT_TYPE = 77;
const T = { kitchen: 1001, bar: 1002, desserts: 1003 };
const CLOCK = {
  clock_mode: "test",
  clock_base_url: "https://sky-eu1.clock-software.invalid/base_api/1/2",
  clock_api_user: "api_user_test",
  clock_api_key: "api_key_test",
  clock_company_id: COMPANY,
  clock_close: "on",
  clock_document_type_id: DOCUMENT_TYPE,
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

describe("Clock PMS+: a sale", () => {
  it("an order paid on the phone becomes a closed folio: each line under its template, the tip apart, the card payment with Stripe's reference", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const D = price("tiramisu");
    const placed = await paid(4, [["caesar", "chicken", 2], ["coca-cola-products", "std", 3, "sprite"], ["tiramisu"]], { tip: 150 });
    const { id, code } = placed.order;

    const [f] = folios();
    assert.equal(folios().length, 1);
    assert.deepEqual([f.company, f.currency, f.number, f.documentType], [COMPANY, "EUR", "FL-1", DOCUMENT_TYPE]);
    assert.ok(f.closedAt, "closed: the fiscal receipt");
    const [doc] = docs();
    assert.deepEqual(f.charges.map((c) => [c.qty, c.price_cents, c.charge_template_id, c.revenue_group, c.tax_rate, c.service_date, c.print_text]), [
      [2, C, T.kitchen, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [3, S, T.bar, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [1, D, T.desserts, "extra", null, "2026-10-03", `QR ${code} #${doc.id}`],
      [1, 150, null, "surcharge", 0, "2026-10-03", `QR ${code} #${doc.id}`],
    ]);
    assert.ok(f.charges[0].text.startsWith(item("caesar").bg), f.charges[0].text);
    assert.ok(f.charges[1].text.includes("Sprite") || f.charges[1].text.includes("Спрайт"), f.charges[1].text);
    const total = 2 * C + 3 * S + D + 150;
    assert.deepEqual(f.credits.map((c) => [c.value_cents, c.payment_type, c.reference]), [[total, "card", row(id).payment_intent]]);

    assert.deepEqual([doc.kind, doc.status, doc.step, doc.total_cents, doc.tip_cents, doc.folio_number, doc.error], ["sale", "done", 4, total, 150, "FL-1", ""]);
    // „За касата“: entered in Clock, for the lines without the tip — as staff would have.
    const o = row(id);
    assert.ok(o.till_at > 0);
    assert.equal(o.till_cents, total - 150);
    const f2 = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
    const shown = f2.clockDocs.find((d) => d.sourceId === id);
    assert.deepEqual([shown.status, shown.folio, shown.closed, shown.code], ["done", "FL-1", true, code]);
    assert.deepEqual(f2.clock, { mode: "test", closes: true });
    assert.equal(f2.orders.find((x) => x.id === id).tillAt > 0, true);
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
    assert.deepEqual(f1.charges.map((c) => [c.qty, c.price_cents]), [[1, price("tiramisu")], [1, 50]]);
    assert.deepEqual(f2.charges.map((c) => [c.qty, c.price_cents]), [[1, price("caesar", "chicken")]]);
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
    assert.deepEqual([doc.status, doc.tries, doc.step], ["done", 2, 4]);
    assert.equal(folios().length, 1);
    assert.ok(row(placed.order.id).till_at > 0);
  });

  it("an answer lost after the charges went in: Clock is asked, and nothing is charged twice", async () => {
    await setUp();
    clock.loseNext("POST", /\/charges\/bulk$/);
    await paid(4, [["caesar", "chicken", 1], ["tiramisu"]]);
    let [doc] = docs();
    assert.deepEqual([doc.status, doc.step, doc.inflight], ["failed", 1, 2]);
    await poll(61);
    [doc] = docs();
    assert.deepEqual([doc.status, doc.step, doc.inflight], ["done", 4, 0]);
    const [f] = folios();
    assert.equal(f.charges.length, 2, "the two lines, once");
    assert.equal(clock.calls("POST", /\/charges\/bulk$/).length, 1);
    assert.equal(clock.calls("GET", /\/charges$/).length, 1);
    assert.equal(f.credits.length, 1);
  });

  it("an answer lost after the payment: found by Stripe's reference, not paid twice", async () => {
    await setUp();
    clock.loseNext("POST", /\/credit_items$/);
    await paid(4, [["tiramisu"]]);
    assert.deepEqual([docs()[0].status, docs()[0].inflight], ["failed", 3]);
    await poll(61);
    assert.equal(docs()[0].status, "done");
    assert.equal(folios()[0].credits.length, 1);
    assert.equal(clock.calls("POST", /\/credit_items$/).length, 1);
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
    assert.deepEqual([doc.status, doc.step], ["done", 4]);
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
    // Clock has it: unticking would have it entered a second time.
    const undo = await tick(admin, id, false);
    assert.deepEqual([undo.status, undo.body.error], [409, "clock_done"]);
    // Being sent right now.
    srv.sqlite(`UPDATE clock_docs SET status = 'sending', claimed_at = ${AT_20H} WHERE source_id = ${id}`);
    srv.sqlite(`UPDATE orders SET till_at = 0 WHERE id = ${id}`);
    const now = await tick(admin, id, true);
    assert.deepEqual([now.status, now.body.error], [409, "clock_sending"]);
  });
});

describe("Clock PMS+: refunds", () => {
  it("one line taken off, then the whole order: the money back on the sale's folio, then a correction folio linked to it, at negative quantities", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await paid(4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 3, "sprite"]], { tip: 100 });
    const { id } = placed.order;
    const pi = row(id).payment_intent;

    assert.equal((await voidLine(admin, id, 1, 1, 3)).status, 200);
    await settle();
    let [sale, storno] = docs();
    assert.deepEqual([storno.kind, storno.sale_id, storno.status, storno.total_cents, storno.folio_number], ["storno", sale.id, "done", S, "FL-2"]);
    const [saleFolio] = folios();
    let f = folios()[1];
    assert.equal(f.clientFolio, saleFolio.id, "linked to the sale's folio");
    assert.deepEqual(f.charges.map((c) => [c.qty, c.price_cents, c.charge_template_id]), [[-1, S, T.bar]]);
    assert.deepEqual(f.credits, [], "the money goes back on the sale's folio, not here");
    assert.deepEqual(saleFolio.credits.map((c) => [c.value_cents, c.reference]), [[C + 3 * S + 100, pi], [-S, `${pi} #${storno.id}`]]);
    // Clock wants the money back in the original before the correction document.
    const order = clock.requests.map((r) => `${r.method} ${r.path}`).filter((x) => !x.startsWith("GET"));
    assert.ok(order.lastIndexOf(`POST /folios/${saleFolio.id}/credit_items`) < order.lastIndexOf("POST /companies/500/folios"), "refund first, then the correction folio");
    assert.ok(f.closedAt);
    assert.deepEqual([row(id).till_cents, row(id).till_void_cents], [C + 3 * S, S], "„За касата“: voided in Clock");

    assert.equal((await cancel(admin, id)).status, 200);
    await settle();
    const all = docs();
    assert.equal(all.length, 3, JSON.stringify(all.map((d) => [d.kind, d.status, d.total_cents, d.error, d.step])));
    f = folios()[2];
    assert.ok(f, JSON.stringify([all.map((d) => [d.kind, d.status, d.total_cents, d.error, d.step]), folios().length]));
    assert.deepEqual(f.charges.map((c) => [c.qty, c.price_cents]), [[-1, C], [-2, S], [-1, 100]], "what was left, tip included");
    assert.equal(f.clientFolio, saleFolio.id);
    assert.equal(saleFolio.credits.at(-1).value_cents, -(C + 2 * S + 100));
    assert.equal(saleFolio.credits.reduce((s, c) => s + c.value_cents, 0), 0, "all the card money given back, on the sale's folio");
    const net = folios().reduce((s, x) => s + x.charges.reduce((t, c) => t + c.qty * c.price_cents, 0), 0);
    assert.equal(net, 0, "everything paid is undone in Clock, once");
    assert.deepEqual([row(id).till_cents, row(id).till_void_cents], [C + 3 * S, C + 3 * S]);
    assert.equal(clock.overRate(), 0, "never more than 5 calls a second");
  });

  it("a storno waits for its sale: a refund before the sale reached Clock goes after it", async () => {
    const admin = await setUp();
    clock.failNext("POST", /^\/companies\/\d+\/folios$/, 503);
    const placed = await paid(4, [["tiramisu"], ["caesar", "chicken", 1]]);
    assert.equal((await voidLine(admin, placed.order.id, 0, 1, 1)).status, 200);
    await settle();
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "failed"], ["storno", "pending"]]);
    assert.equal(folios().length, 0);
    await poll(61);
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "done"], ["storno", "done"]]);
    assert.deepEqual(folios().map((f) => f.charges.map((c) => c.qty)), [[1, 1], [-1]]);
  });
});

describe("Clock PMS+: switches", () => {
  it("without closing here (clock_close off): the folio waits in Clock, paid, for staff to close", async () => {
    const admin = await setUp();
    srv.config({ clock_close: null });
    await paid(4, [["tiramisu"]]);
    const [f] = folios();
    assert.equal(f.closedAt, null);
    assert.equal(f.credits.length, 1);
    const [doc] = docs();
    assert.deepEqual([doc.status, doc.step], ["done", 3]);
    const shown = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
    assert.deepEqual([shown.clockDocs[0].closed, shown.clockDocs[0].folio, shown.clock.closes], [false, "FL-1", false]);
    assert.equal(clock.calls("POST", /\/close$/).length, 0);
  });

  it("the card payment is booked as the payment type the fiscal printer is set up for", async () => {
    await setUp();
    srv.config({ clock_payment_type: "card", clock_payment_sub_type: "Stripe онлайн" });
    await paid(4, [["tiramisu"]]);
    const [call] = clock.calls("POST", /\/credit_items$/);
    assert.deepEqual([call.body.credit_item.payment_type, call.body.credit_item.payment_sub_type], ["card", "Stripe онлайн"]);
    srv.config({ clock_payment_type: null, clock_payment_sub_type: null });
  });

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
