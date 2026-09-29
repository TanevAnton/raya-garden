// "Pay at the end": the table's bill against a fake Stripe. Several phones
// order for one table; anyone pays chosen lines, or all. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_bill";

let srv;
let stripe;
let menu;
let price;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({ stripe: { key: "rk_test_bill", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  price = (id, variant = "std") => items.get(id).variants.find((v) => v.id === variant).price;
});
after(async () => {
  srv.stop();
  await stripe.stop();
});
beforeEach(() => stripe.reset());

async function setUp({ paymentMode = "tab", window = EVENING } = {}) {
  srv.reset();
  const admin = client(srv.base, { now: AT_20H });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...window, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  return admin;
}
const phone = (at = AT_20H) => client(srv.base, { now: at });
const order = async (c, table, lines) => {
  const res = await c.post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  return res.body;
};
const bill = async (c, table, tokens = []) => (await c.get(`/api/qr/bill.php?table=${table}${tokens.length ? `&t=${tokens.join(",")}` : ""}`)).body;
/** Start paying: lines as [code, line] pairs. */
const pay = (c, table, lines, { key = newKey(), amount } = {}) =>
  c.post("/api/qr/bill-pay.php", { table, lang: "bg", items: lines.map(([code, line]) => ({ code, line })), expectedAmount: amount }, { headers: { "Idempotency-Key": key } });
const sessionOf = (res) => stripe.sessions.get(new URL(res.body.checkoutUrl).pathname.slice(5));
const feed = async (admin, since = 0) => (await admin.get(`/api/qr/admin/feed.php?since=${since}`)).body;
const lines = (b) => b.bill.lines.map((l) => [l.code, l.line, l.state]);

describe("a table's bill", () => {
  it("collects every phone's orders for the table, which go straight to staff", async () => {
    const admin = await setUp();
    assert.equal((await phone().get("/api/qr/state.php")).body.payment, "tab");
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const ben = await order(phone(), 5, [["caesar", "chicken", 2], ["illy-coffee"]]);
    await order(phone(), 6, [["tiramisu"]]);
    assert.equal(ana.order.status, "new", "no payment first");
    assert.equal(ana.order.payStatus, "tab");

    const b = await bill(phone(), 5);
    assert.deepEqual(lines(b), [
      [ana.order.code, 0, "unpaid"],
      [ben.order.code, 0, "unpaid"],
      [ben.order.code, 1, "unpaid"],
    ]);
    assert.equal(b.bill.totals.unpaid, price("tiramisu") + 2 * price("caesar", "chicken") + price("illy-coffee"));
    assert.equal(b.bill.lines[0].orderId, undefined, "guests see codes, not ids");
    assert.equal((await bill(phone(), 6)).bill.lines.length, 1, "another table's bill is its own");
    assert.equal((await bill(phone(), 7)).bill, null, "no orders, no bill");

    const f = await feed(admin);
    assert.equal(f.orders.length, 3);
    const tab5 = f.tabs.find((t) => t.table === 5);
    assert.equal(tab5.lines.length, 3);
    assert.equal(tab5.totals.unpaid, b.bill.totals.unpaid);
  });

  it("one person pays their own line; another pays all the rest — the birthday case", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const ben = await order(phone(), 5, [["caesar", "chicken", 2], ["illy-coffee"]]);

    const own = await pay(phone(), 5, [[ana.order.code, 0]], { amount: price("tiramisu") });
    assert.equal(own.status, 201, own.text);
    const [call] = stripe.calls("/v1/checkout/sessions");
    assert.deepEqual(call.params.line_items.map((l) => [l.quantity, l.price_data.unit_amount]), [["1", String(price("tiramisu"))]]);
    assert.match(call.params.success_url, /\/menu\/\?lang=bg&billpaid=P-[A-Z0-9]{4}$/);
    assert.equal(call.params.payment_method_types, undefined);
    assert.equal(call.headers["idempotency-key"], `raya-qr-bill-${call.params.metadata.bill_payment_id}`);
    assert.deepEqual(lines(await bill(phone(), 5))[0], [ana.order.code, 0, "pending"], "the others see it being paid");

    await stripe.pay(sessionOf(own).id);
    const rest = (await bill(phone(), 5)).bill.lines.filter((l) => l.state === "unpaid");
    assert.equal(rest.length, 2);
    const all = await pay(phone(), 5, rest.map((l) => [l.code, l.line]), { amount: rest.reduce((s, l) => s + l.amount, 0) });
    assert.equal(all.status, 201, all.text);
    await stripe.pay(sessionOf(all).id);

    const b = await bill(phone(), 5, [own.body.token, all.body.token]);
    assert.ok(b.bill.lines.every((l) => l.state === "online"));
    assert.equal(b.bill.totals.unpaid, 0);
    assert.deepEqual(b.payments.map((p) => p.status), ["paid", "paid"]);
    const orders = (await feed(admin)).orders;
    assert.deepEqual(orders.map((o) => o.payStatus).sort(), ["tab_paid", "tab_paid"]);
  });

  it("the same attempt twice is one payment and one payment page", async () => {
    await setUp();
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const key = newKey();
    const first = await pay(phone(), 5, [[ana.order.code, 0]], { key, amount: price("tiramisu") });
    const again = await pay(phone(), 5, [[ana.order.code, 0]], { key, amount: price("tiramisu") });
    assert.equal(again.status, 200);
    assert.equal(again.body.checkoutUrl, first.body.checkoutUrl);
    assert.equal(stripe.calls("/v1/checkout/sessions").length, 1);
  });

  it("a line already paid cannot be chosen again: the phone gets the bill as it is now", async () => {
    await setUp();
    const ana = await order(phone(), 5, [["tiramisu"], ["illy-coffee"]]);
    const first = await pay(phone(), 5, [[ana.order.code, 0]], { amount: price("tiramisu") });
    await stripe.pay(sessionOf(first).id);
    const late = await pay(phone(), 5, [[ana.order.code, 0], [ana.order.code, 1]], { amount: price("tiramisu") + price("illy-coffee") });
    assert.equal(late.status, 409);
    assert.equal(late.body.error, "changed");
    assert.deepEqual(late.body.gone, [{ code: ana.order.code, line: 0 }]);
    assert.equal(late.body.bill.totals.unpaid, price("illy-coffee"));
    const wrongSum = await pay(phone(), 5, [[ana.order.code, 1]], { amount: 1 });
    assert.equal(wrongSum.status, 409, "the amount shown must be the amount charged");
  });

  it("two people pay the same line at the same time: the second one gets that share back", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["tiramisu"], ["illy-coffee"]]);
    const t = price("tiramisu");
    const c = price("illy-coffee");
    const a = await pay(phone(), 5, [[ana.order.code, 0]], { amount: t });
    const b = await pay(phone(), 5, [[ana.order.code, 0], [ana.order.code, 1]], { amount: t + c });
    assert.equal(b.status, 201, "nothing is locked while someone is paying");
    await stripe.pay(sessionOf(a).id);
    await stripe.pay(sessionOf(b).id);

    const piB = sessionOf(b).payment_intent;
    assert.equal(stripe.refunded(piB), t, "exactly the doubled line, automatically");
    assert.equal(stripe.refunded(sessionOf(a).payment_intent), 0);
    const mine = await bill(phone(), 5, [b.body.token]);
    assert.deepEqual([mine.payments[0].overlap, mine.payments[0].refunded, mine.payments[0].refundDue], [t, t, 0]);
    assert.ok(mine.bill.lines.every((l) => l.state === "online"));
    const tab = (await feed(admin)).tabs[0];
    assert.equal(tab.totals.paidOnline, t + c);
  });

  it("paying works after ordering has closed — people pay at the end", async () => {
    await setUp();
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const afterClose = phone(sofia("2026-10-04T01:30", 3));
    const res = await pay(afterClose, 5, [[ana.order.code, 0]], { amount: price("tiramisu") });
    assert.equal(res.status, 201, res.text);
  });

  it("backing out of Stripe's page closes it, and the line is no longer 'being paid'", async () => {
    await setUp();
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const res = await pay(phone(), 5, [[ana.order.code, 0]], { amount: price("tiramisu") });
    const back = await phone().post("/api/qr/bill-abandon.php", { token: res.body.token });
    assert.equal(back.status, 200);
    assert.equal(back.body.payment.status, "expired");
    assert.equal(sessionOf(res).status, "expired", "closed at Stripe too");
    assert.deepEqual(lines(await bill(phone(), 5))[0][2], "unpaid");
  });
});

describe("a table's bill: staff", () => {
  it("cancelling an order refunds just its paid lines, to whoever paid them", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["tiramisu"]]);
    const ben = await order(phone(), 5, [["illy-coffee"]]);
    const all = await pay(phone(), 5, [[ana.order.code, 0], [ben.order.code, 0]], { amount: price("tiramisu") + price("illy-coffee") });
    await stripe.pay(sessionOf(all).id);

    const res = await admin.admin("/api/qr/admin/order.php", { id: ben.order.id, action: "cancel", from: "new", reason: "Изчерпан продукт" });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.refundPending, undefined);
    assert.equal(res.body.order.payStatus, "refunded");
    assert.equal(stripe.refunded(sessionOf(all).payment_intent), price("illy-coffee"), "only the coffee");
    const b = await bill(phone(), 5, [all.body.token]);
    assert.deepEqual(lines(b), [[ana.order.code, 0, "online"]], "the cancelled order leaves the bill");
    assert.equal(b.payments[0].refunded, price("illy-coffee"));
  });

  it("a refund that fails is kept and shown, and a retry pays it", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["illy-coffee"]]);
    const p = await pay(phone(), 5, [[ana.order.code, 0]], { amount: price("illy-coffee") });
    await stripe.pay(sessionOf(p).id);
    stripe.failNext("/v1/refunds", 500);
    const res = await admin.admin("/api/qr/admin/order.php", { id: ana.order.id, action: "cancel", from: "new", reason: "Гостът се отказа" });
    assert.equal(res.status, 200);
    assert.equal(res.body.refundPending, true);
    const [payment] = (await feed(admin)).billPayments;
    assert.deepEqual([payment.refundDue, payment.refundError], [price("illy-coffee"), true]);
    const retry = await admin.admin("/api/qr/admin/bill.php", { action: "refund", paymentId: payment.id });
    assert.equal(retry.status, 200, retry.text);
    assert.deepEqual([retry.body.payment.refundDue, retry.body.payment.refundError], [0, false]);
    assert.equal(stripe.refunded(sessionOf(p).payment_intent), price("illy-coffee"));
  });

  it("settle what is left on the spot, close the bill; the table's next order starts a new one", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["tiramisu"], ["illy-coffee"]]);
    const p = await pay(phone(), 5, [[ana.order.code, 0]], { amount: price("tiramisu") });
    await stripe.pay(sessionOf(p).id);
    const tabId = (await feed(admin)).tabs[0].id;

    const early = await admin.admin("/api/qr/admin/bill.php", { action: "close", tabId });
    assert.equal(early.status, 409);
    assert.deepEqual([early.body.error, early.body.unpaid], ["unpaid", price("illy-coffee")]);
    const settled = await admin.admin("/api/qr/admin/bill.php", { action: "settle", tabId });
    assert.equal(settled.status, 200);
    assert.deepEqual(settled.body.tab.lines.map((l) => l.state), ["online", "staff"]);
    assert.deepEqual([settled.body.tab.totals.paidStaff, settled.body.tab.totals.unpaid], [price("illy-coffee"), 0]);
    const closed = await admin.admin("/api/qr/admin/bill.php", { action: "close", tabId });
    assert.equal(closed.status, 200);
    assert.ok(closed.body.tab.closedAt > 0);

    assert.equal((await bill(phone(), 5)).bill, null, "a closed bill is gone for guests");
    const next = await order(phone(), 5, [["tiramisu"]]);
    const b = await bill(phone(), 5);
    assert.deepEqual(lines(b), [[next.order.code, 0, "unpaid"]], "a fresh bill");
  });

  it("a new evening starts new bills for the same tables", async () => {
    await setUp();
    await order(phone(), 5, [["tiramisu"]]);
    const nextDay = sofia("2026-10-04T20:00", 3);
    const tomorrow = client(srv.base, { now: nextDay }); // yesterday's sign-in has expired
    assert.equal((await tomorrow.login()).status, 200);
    const set = await tomorrow.admin("/api/qr/admin/settings.php", { date: "2026-10-04", opens: "18:00", closes: "23:00" });
    assert.equal(set.status, 200, set.text);
    const fresh = await order(phone(nextDay), 5, [["illy-coffee"]]);
    const b = await bill(phone(nextDay), 5);
    assert.deepEqual(lines(b), [[fresh.order.code, 0, "unpaid"]]);
  });

  it("the till list: a bill payment is entered at its net amount; a refund after that is voided", async () => {
    const admin = await setUp();
    const ana = await order(phone(), 5, [["tiramisu"], ["illy-coffee"]]);
    const p = await pay(phone(), 5, [[ana.order.code, 0], [ana.order.code, 1]], { amount: price("tiramisu") + price("illy-coffee") });
    await stripe.pay(sessionOf(p).id);
    const [payment] = (await feed(admin)).billPayments;
    assert.equal(payment.net, price("tiramisu") + price("illy-coffee"));
    assert.equal(payment.lines.length, 2);
    const entered = await admin.admin("/api/qr/admin/till.php", { paymentId: payment.id, entered: true });
    assert.equal(entered.status, 200);
    assert.equal(entered.body.payment.tillCents, payment.net);
    assert.equal((await admin.admin("/api/qr/admin/till.php", { paymentId: payment.id, voided: true })).status, 409, "nothing to void yet");

    await admin.admin("/api/qr/admin/order.php", { id: ana.order.id, action: "cancel", from: "new", reason: "Грешна маса" });
    const after = (await feed(admin)).billPayments[0];
    assert.equal(after.net, 0);
    const voided = await admin.admin("/api/qr/admin/till.php", { paymentId: payment.id, voided: true });
    assert.equal(voided.status, 200);
  });
});

describe("a table's bill needs Stripe", () => {
  it("without keys the mode cannot be switched on", async () => {
    const plain = await startServer();
    try {
      const admin = client(plain.base, { now: AT_20H });
      await admin.login();
      const res = await admin.admin("/api/qr/admin/settings.php", { paymentMode: "tab" });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "payments_not_configured");
    } finally {
      plain.stop();
    }
  });
});
