// Paying on the phone: the ordering API against a fake Stripe
// (tests/qr/fake-stripe.mjs) and signed webhooks. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_fake_secret";

let srv;
let stripe;
let menu;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({
    stripe: { key: "rk_test_fake", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" },
  });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
});
after(async () => {
  srv.stop();
  await stripe.stop();
});
beforeEach(() => stripe.reset());

/** Fresh database and the evening set up; guests pay on the phone unless told otherwise. */
async function setUp({ paymentMode = "online" } = {}) {
  srv.reset();
  const admin = client(srv.base, { now: AT_20H });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  return admin;
}

const guest = () => client(srv.base, { now: AT_20H });
const order = (c, table, lines, { key = newKey() } = {}) =>
  c.post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": key } });
const feed = async (admin, since = 0) => (await admin.get(`/api/qr/admin/feed.php?since=${since}`)).body;
const row = (id) => JSON.parse(srv.sqlite(`SELECT * FROM orders WHERE id = ${id}`))[0];
const status = async (c, token) => (await c.get(`/api/qr/order-status.php?t=${token}`)).body.orders[0];
const sessionOf = (res) => stripe.sessions.get(new URL(res.body.checkoutUrl).pathname.slice(5));

describe("paying on the phone: placing an order", () => {
  it("makes a Checkout Session for exactly the order, and keeps the order from staff until paid", async () => {
    const admin = await setUp();
    const state = (await guest().get("/api/qr/state.php")).body;
    assert.equal(state.payment, "online");
    assert.equal(state.paymentsTest, true);

    const res = await order(guest(), 7, [["caesar", "chicken", 2], ["tiramisu"]]);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.order.status, "pending_payment");
    assert.match(res.body.checkoutUrl, /\/pay\/cs_test_/);

    const [call] = stripe.calls("/v1/checkout/sessions");
    const p = call.params;
    assert.equal(p.mode, "payment");
    assert.equal(p.client_reference_id, String(res.body.order.id));
    assert.equal(p.metadata.order_code, res.body.order.code);
    assert.equal(p.success_url, `https://rayagarden.bg/menu/?lang=bg&paid=${res.body.order.code}`);
    assert.equal(p.cancel_url, `https://rayagarden.bg/menu/?lang=bg&unpaid=${res.body.order.code}`);
    assert.equal(p.payment_method_types, undefined, "payment methods come from the Dashboard");
    assert.match(p.integration_identifier, /^raya_qr_menu_[a-z]{8}$/);
    assert.equal(call.headers["stripe-version"], "2026-08-26.dahlia");
    assert.equal(call.headers["idempotency-key"], `raya-qr-checkout-${res.body.order.id}`);
    const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
    const caesar = items.get("caesar").variants.find((v) => v.id === "chicken").price;
    const tiramisu = items.get("tiramisu").variants[0].price;
    assert.deepEqual(p.line_items.map((l) => [l.quantity, l.price_data.currency, l.price_data.unit_amount]), [
      ["2", "eur", String(caesar)],
      ["1", "eur", String(tiramisu)],
    ]);
    assert.equal(sessionOf(res).amount_total, 2 * caesar + tiramisu);
    assert.equal(res.body.order.total, 2 * caesar + tiramisu);

    const f = await feed(admin);
    assert.equal(f.orders.length, 0, "staff never see an unpaid order");
    assert.equal((await status(guest(), res.body.token)).payUrl, res.body.checkoutUrl);
  });

  it("a retry of the same attempt reuses the order and the payment page", async () => {
    await setUp();
    const key = newKey();
    const first = await order(guest(), 3, [["tiramisu"]], { key });
    const again = await order(guest(), 3, [["tiramisu"]], { key });
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.checkoutUrl, first.body.checkoutUrl);
    assert.equal(stripe.calls("/v1/checkout/sessions").length, 1);
  });

  it("if Stripe cannot be reached: 502, and the retry finishes the same order", async () => {
    await setUp();
    stripe.failNext("/v1/checkout/sessions", 500);
    const key = newKey();
    const first = await order(guest(), 3, [["tiramisu"]], { key });
    assert.equal(first.status, 502);
    assert.equal(first.body.error, "payment_unavailable");
    assert.ok(first.body.token && first.body.order, "the phone keeps the order to retry");
    const again = await order(guest(), 3, [["tiramisu"]], { key });
    assert.equal(again.status, 200, again.text);
    assert.ok(again.body.checkoutUrl);
    assert.equal(again.body.order.id, first.body.order.id);
    const keys = stripe.calls("/v1/checkout/sessions").map((c) => c.headers["idempotency-key"]);
    assert.deepEqual(keys, [keys[0], keys[0]], "Stripe sees one idempotent request, retried");
  });

  it("a slow answer from Stripe holds up nobody else's order", async () => {
    await setUp();
    stripe.delayNext("/v1/checkout/sessions", 9000); // longer than SQLite's 8 s wait
    const slow = order(guest(), 1, [["tiramisu"]]);
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    const others = await Promise.all([2, 3, 4, 5, 6].map((t) => order(guest(), t, [["tiramisu"]])));
    assert.deepEqual(others.map((r) => r.status), [201, 201, 201, 201, 201]);
    assert.ok(Date.now() - started < 4000, "the other tables did not wait for Stripe");
    assert.equal((await slow).status, 201);
  });

  it("paying staff stays as before: no Stripe, straight to the tablet", async () => {
    const admin = await setUp({ paymentMode: "on_site" });
    assert.equal((await guest().get("/api/qr/state.php")).body.payment, "on_site");
    const res = await order(guest(), 2, [["tiramisu"]]);
    assert.equal(res.status, 201);
    assert.equal(res.body.order.status, "new");
    assert.equal(res.body.checkoutUrl, undefined);
    assert.equal(stripe.requests.length, 0);
    assert.equal((await feed(admin)).orders.length, 1);
  });
});

describe("paying on the phone: Stripe's webhook", () => {
  it("only a correctly signed, fresh delivery is accepted", async () => {
    await setUp();
    const res = await order(guest(), 5, [["tiramisu"]]);
    const id = sessionOf(res).id;
    const paid = stripe.event("checkout.session.completed", { ...sessionOf(res), status: "complete", payment_status: "paid", payment_intent: "pi_x" });
    assert.equal((await stripe.deliver(paid, { secret: "whsec_wrong" })).status, 400);
    assert.equal((await stripe.deliver(paid, { time: Math.floor(Date.now() / 1000) - 600 })).status, 400, "too old");
    assert.equal((await stripe.deliver(paid, { tamper: true })).status, 400, "body changed after signing");
    const bare = await fetch(`${srv.base}/api/qr/stripe-webhook.php`, { method: "POST", body: JSON.stringify(paid) });
    assert.equal(bare.status, 400, "no signature");
    assert.equal(row(res.body.order.id).status, "pending_payment");
    assert.equal(stripe.sessions.get(id).status, "open");
  });

  it("a paid session sends the order to staff, once, however often Stripe repeats it", async () => {
    const admin = await setUp();
    const before = (await feed(admin)).seq;
    const res = await order(guest(), 5, [["tiramisu"]]);
    const evt = stripe.event("checkout.session.completed", { ...sessionOf(res), status: "complete", payment_status: "paid", payment_intent: "pi_1" });
    assert.equal((await stripe.deliver(evt)).status, 200);
    const after = await feed(admin, before);
    assert.equal(after.orders.length, 1);
    assert.equal(after.orders[0].status, "new");
    assert.equal(after.orders[0].payStatus, "paid");
    assert.equal((await stripe.deliver(evt)).status, 200, "redelivery");
    assert.equal((await feed(admin, after.seq)).orders.length, 0, "…changes nothing");
    const mine = await status(guest(), res.body.token);
    assert.equal(mine.status, "new");
    assert.equal(mine.payStatus, "paid");
    assert.equal(mine.payUrl, "");
  });

  it("a payment still on its way waits; async success then sends it", async () => {
    await setUp();
    const res = await order(guest(), 5, [["tiramisu"]]);
    const id = res.body.order.id;
    await stripe.pay(sessionOf(res).id, { paymentStatus: "unpaid" });
    assert.equal(row(id).status, "pending_payment");
    await stripe.pay(sessionOf(res).id, { type: "checkout.session.async_payment_succeeded" });
    assert.equal(row(id).status, "new");
    assert.equal(row(id).pay_status, "paid");
  });

  it("a paid amount that is not the order's total is not accepted as payment", async () => {
    await setUp();
    const res = await order(guest(), 5, [["tiramisu"]]);
    await stripe.pay(sessionOf(res).id, { amount: 1 });
    assert.equal(row(res.body.order.id).status, "pending_payment");
  });

  it("an expired or failed payment never reaches staff", async () => {
    const admin = await setUp();
    const a = await order(guest(), 5, [["tiramisu"]]);
    const b = await order(guest(), 6, [["tiramisu"]]);
    await stripe.deliver(stripe.event("checkout.session.expired", { ...sessionOf(a), status: "expired" }));
    await stripe.deliver(stripe.event("checkout.session.async_payment_failed", { ...sessionOf(b), payment_status: "unpaid" }));
    assert.deepEqual([row(a.body.order.id).status, row(a.body.order.id).pay_status], ["expired", "expired"]);
    assert.deepEqual([row(b.body.order.id).status, row(b.body.order.id).pay_status], ["expired", "failed"]);
    assert.equal((await feed(admin)).orders.length, 0);
    assert.equal((await status(guest(), a.body.token)).status, "expired");
  });

  it("events that are not about our orders are acknowledged and ignored", async () => {
    await setUp();
    const res = await stripe.deliver(stripe.event("checkout.session.completed", { id: "cs_someone_else", payment_status: "paid", amount_total: 100, currency: "eur" }));
    assert.equal(res.status, 200);
    assert.equal((await stripe.deliver(stripe.event("customer.created", { id: "cus_1" }))).status, 200);
  });
});

describe("paying on the phone: cancelling, refunds and the till", () => {
  async function paidOrder(table = 4) {
    const res = await order(guest(), table, [["tiramisu"]]);
    await stripe.pay(sessionOf(res).id);
    return { ...res.body, order: { ...res.body.order, status: "new" } };
  }

  it("cancelling a paid order refunds it in full, once, even from two tablets at the same moment", async () => {
    const admin = await setUp();
    const other = client(srv.base, { now: AT_20H });
    await other.login();
    // A race that only sometimes goes wrong: run it several times.
    for (let round = 0; round < 6; round++) {
      const { order: o } = await paidOrder(round + 5);
      const cancel = (c) => c.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Изчерпан продукт" });
      const results = await Promise.all([cancel(admin), cancel(other)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], `round ${round}`);
    }
    assert.equal(stripe.refunds.size, 6, "one refund per order");
    stripe.reset();

    const { order: o, token } = await paidOrder();
    const cancel = (c) => c.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Изчерпан продукт" });
    const results = await Promise.all([cancel(admin), cancel(other)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(stripe.refunds.size, 1, "one refund");
    const refundCalls = stripe.calls("/v1/refunds");
    assert.ok(refundCalls.every((c) => c.headers["idempotency-key"] === `raya-qr-refund-${o.id}`));
    assert.equal(refundCalls[0].params.payment_intent, row(o.id).payment_intent);
    const r = row(o.id);
    assert.deepEqual([r.status, r.pay_status], ["cancelled", "refunded"]);
    assert.match(r.refund_id, /^re_test_/);
    const mine = await status(guest(), token);
    assert.deepEqual([mine.status, mine.payStatus, mine.cancelReason], ["cancelled", "refunded", "Изчерпан продукт"]);
  });

  it("if the refund fails, the order is not cancelled", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    stripe.failNext("/v1/refunds", 500);
    const res = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Грешна маса" });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, "refund_failed");
    assert.deepEqual([row(o.id).status, row(o.id).pay_status], ["new", "paid"]);
    const retry = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Грешна маса" });
    assert.equal(retry.status, 200);
    assert.equal(row(o.id).pay_status, "refunded");
  });

  it("a refund made in the Stripe Dashboard shows on the order", async () => {
    await setUp();
    const { order: o } = await paidOrder();
    const pi = row(o.id).payment_intent;
    await stripe.deliver(stripe.event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: pi, refunded: true }));
    assert.equal(row(o.id).pay_status, "refunded");
  });

  it("the till list: paid orders are ticked off as entered, refunded ones as voided", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    const start = (await feed(admin)).seq;
    const enter = await admin.admin("/api/qr/admin/till.php", { id: o.id, entered: true });
    assert.equal(enter.status, 200);
    assert.ok(enter.body.order.tillAt > 0);
    const synced = await feed(admin, start);
    assert.equal(synced.orders[0].tillAt, enter.body.order.tillAt, "other tablets see the tick");
    assert.equal((await admin.admin("/api/qr/admin/till.php", { id: o.id, voided: true })).status, 409, "only after a refund");
    await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Гостът се отказа" });
    const voided = await admin.admin("/api/qr/admin/till.php", { id: o.id, voided: true });
    assert.equal(voided.status, 200);
    assert.ok(voided.body.order.tillVoidAt > 0);

    const fresh = await setUp({ paymentMode: "on_site" });
    const onSite = await order(guest(), 2, [["tiramisu"]]);
    assert.equal((await fresh.admin("/api/qr/admin/till.php", { id: onSite.body.order.id, entered: true })).status, 404, "paid to staff: not on the list");
  });

  it("a paid order not yet in the till is always on the staff screen, however old", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    srv.sqlite(`UPDATE orders SET created_at = created_at - 5 * 86400, status = 'served' WHERE id = ${o.id}`);
    assert.deepEqual((await feed(admin)).orders.map((x) => x.id), [o.id]);
  });
});

describe("paying on the phone needs Stripe configured", () => {
  it("without keys the mode cannot be switched on", async () => {
    const plain = await startServer();
    try {
      const admin = client(plain.base, { now: AT_20H });
      await admin.login();
      const res = await admin.admin("/api/qr/admin/settings.php", { paymentMode: "online" });
      assert.equal(res.status, 409);
      assert.equal(res.body.error, "payments_not_configured");
      const state = (await admin.get("/api/qr/state.php")).body;
      assert.deepEqual([state.payment, state.paymentsConfigured], ["on_site", false]);
      const hook = await fetch(`${plain.base}/api/qr/stripe-webhook.php`, { method: "POST", body: "{}" });
      assert.equal(hook.status, 503);
    } finally {
      plain.stop();
    }
  });
});
