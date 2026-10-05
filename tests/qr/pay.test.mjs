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

  it("names each line on Stripe's page with its size, once, in the guest's language", async () => {
    await setUp();
    const lines = [["caesar", "chicken", 1], ["burgas-63", "100ml", 1], ["tiramisu"]];
    const res = await order(guest(), 7, lines);
    assert.equal(res.status, 201, res.text);
    const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
    const tiramisu = items.get("tiramisu").variants[0].size; // "… g" in the menu file
    assert.match(tiramisu, / g$/);
    const [call] = stripe.calls("/v1/checkout/sessions");
    assert.deepEqual(call.params.line_items.map((l) => l.price_data.product_data.name), [
      `${items.get("caesar").bg} · с пиле 400 г`,
      `${items.get("burgas-63").bg} · 100 мл`,
      `${items.get("tiramisu").bg} · ${tiramisu.replace(/ g$/, " г")}`,
    ]);
    // An English guest gets English units.
    const en = await guest().post("/api/qr/order.php", { ...orderBody(menu, 8, lines), lang: "en" }, { headers: { "Idempotency-Key": newKey() } });
    assert.equal(en.status, 201, en.text);
    const enCall = stripe.calls("/v1/checkout/sessions").at(-1);
    assert.deepEqual(enCall.params.line_items.map((l) => l.price_data.product_data.name), [
      `${items.get("caesar").en} · with chicken 400 g`,
      `${items.get("burgas-63").en} · 100 ml`,
      `${items.get("tiramisu").en} · ${tiramisu}`,
    ]);
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

  it("staff see the name given on Stripe's payment page; the guest's own name too", async () => {
    const admin = await setUp();
    const res = await guest().post("/api/qr/order.php", orderBody(menu, 5, [["tiramisu"]], { name: "Мими" }), { headers: { "Idempotency-Key": newKey() } });
    await stripe.pay(sessionOf(res).id, { name: "Мария Петрова\u0007" });
    const [o] = (await feed(admin)).orders;
    assert.deepEqual([o.guestName, o.payerName], ["Мими", "Мария Петрова"]);
    assert.equal((await status(guest(), res.body.token)).payerName, undefined);
    assert.ok(!srv.sqlite("SELECT * FROM orders").includes("guest@example.com"), "the email Stripe collected is not kept");
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

describe("paying on the phone: cancelling one line, not the whole order", () => {
  const priceOf = (id, variant = "std") => menu.categories.flatMap((c) => c.items).find((i) => i.id === id).variants.find((v) => v.id === variant).price;
  const COLA = () => priceOf("coca-cola-products");
  /** Paid: a Caesar salad and three Sprites, at table 4. */
  async function paidOrder() {
    const res = await order(guest(), 4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 3, "sprite"]]);
    await stripe.pay(sessionOf(res).id);
    return res.body;
  }
  const voidLine = (admin, id, line, qty, have, reason = "Изчерпан продукт") =>
    admin.admin("/api/qr/admin/order.php", { id, action: "void", line, qty, have, reason });

  it("staff take one of three off: only that is refunded, the rest stands, and the guest sees why", async () => {
    const admin = await setUp();
    const { order: o, token } = await paidOrder();
    const pi = row(o.id).payment_intent;
    const res = await voidLine(admin, o.id, 1, 1, 3);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.amount, COLA());
    assert.equal(stripe.refunded(pi), COLA(), "one Sprite back, nothing else");
    assert.match(stripe.calls("/v1/refunds")[0].headers["idempotency-key"], new RegExp(`^raya-qr-order-refund-${o.id}-0-${COLA()}$`));
    const after = res.body.order;
    assert.deepEqual([after.status, after.payStatus], ["new", "paid"], "the order goes on");
    assert.equal(after.total, o.total - COLA());
    assert.equal(after.orderedTotal, o.total);
    assert.deepEqual([after.lines[1].qty, after.lines[1].voidQty, after.lines[1].voidReason], [2, 1, "Изчерпан продукт"]);
    assert.deepEqual([after.refunded, after.refundDue], [COLA(), 0]);

    const mine = await status(guest(), token);
    assert.deepEqual([mine.lines[1].qty, mine.lines[1].voidQty, mine.lines[1].voidReason, mine.refunded], [2, 1, "Изчерпан продукт", COLA()]);
    assert.equal(mine.tillCents, undefined, "the till is staff business");

    assert.equal((await voidLine(admin, o.id, 1, 1, 3)).status, 409, "the screen showed 3: stale");
    assert.equal((await voidLine(admin, o.id, 1, 3, 2)).status, 400, "more than is left");
    assert.equal((await voidLine(admin, o.id, 1, 2, 2)).status, 200, "the other two");
    assert.equal(stripe.refunded(pi), 3 * COLA());
    const last = await voidLine(admin, o.id, 0, 1, 1);
    assert.equal(last.status, 409);
    assert.equal(last.body.error, "last_line", "the last thing left is cancelling the order");
    assert.equal((await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "void", line: 0, qty: 1, have: 1 })).status, 400, "a reason is required");

    // Cancelling the whole order now refunds what is left.
    const cancel = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", from: "new", reason: "Гостът си тръгна" });
    assert.equal(cancel.status, 200);
    assert.equal(stripe.refunded(pi), o.total, "all of it back, once");
    assert.deepEqual([row(o.id).refunded_cents, row(o.id).refund_due_cents], [o.total, o.total]);
  });

  it("two tablets taking the same line off at once: one refund", async () => {
    const admin = await setUp();
    const other = client(srv.base, { now: AT_20H });
    await other.login();
    const { order: o } = await paidOrder();
    const results = await Promise.all([voidLine(admin, o.id, 1, 1, 3), voidLine(other, o.id, 1, 1, 3)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(stripe.refunded(row(o.id).payment_intent), COLA());
    assert.equal(row(o.id).void_cents, COLA());
  });

  it("a refund that fails stays owed, on the order, until Върни сега works", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    stripe.failNext("/v1/refunds", 500);
    const res = await voidLine(admin, o.id, 1, 1, 3);
    assert.equal(res.status, 200, "the line is off either way");
    assert.equal(res.body.refundPending, true);
    assert.deepEqual([res.body.order.refundDue, res.body.order.refundError], [COLA(), true]);
    srv.sqlite(`UPDATE orders SET created_at = created_at - 5 * 86400, status = 'served' WHERE id = ${o.id}`);
    assert.ok((await feed(admin)).orders.some((x) => x.id === o.id), "on the staff screen until it is paid back");
    const retry = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "refund" });
    assert.equal(retry.status, 200, retry.text);
    assert.deepEqual([retry.body.order.refundDue, retry.body.order.refunded, retry.body.order.refundError], [0, COLA(), false]);
    assert.equal(stripe.refunded(row(o.id).payment_intent), COLA());
  });

  it("the till: a line taken off after the order was entered is voided for its amount, and the next one for its own", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    const entered = await admin.admin("/api/qr/admin/till.php", { id: o.id, entered: true });
    assert.equal(entered.body.order.tillCents, o.total);
    assert.equal((await admin.admin("/api/qr/admin/till.php", { id: o.id, voided: true })).status, 409, "nothing to void yet");
    await voidLine(admin, o.id, 1, 1, 3);
    let mine = (await feed(admin)).orders.find((x) => x.id === o.id);
    assert.equal(mine.tillCents - mine.tillVoidCents - mine.net, COLA(), "one Sprite to void in Clock");
    const voided = await admin.admin("/api/qr/admin/till.php", { id: o.id, voided: true });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.order.tillVoidCents, COLA());
    await voidLine(admin, o.id, 1, 1, 2);
    mine = (await feed(admin)).orders.find((x) => x.id === o.id);
    assert.equal(mine.tillCents - mine.tillVoidCents - mine.net, COLA(), "the second Sprite, on its own");
    assert.equal((await admin.admin("/api/qr/admin/till.php", { id: o.id, voided: true })).body.order.tillVoidCents, 2 * COLA());

    // Taken off before it was entered: entered at what is left.
    const { order: o2 } = await paidOrder();
    await voidLine(admin, o2.id, 1, 2, 3);
    const later = await admin.admin("/api/qr/admin/till.php", { id: o2.id, entered: true });
    assert.equal(later.body.order.tillCents, o2.total - 2 * COLA());
  });

  it("cancelling the bar's part of a paid order refunds just the drinks", async () => {
    const admin = await setUp();
    const { order: o } = await paidOrder();
    const res = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "cancel", station: "bar", from: "new", reason: "Няма Sprite" });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.order.status, res.body.order.payStatus, res.body.order.stations], ["new", "paid", { kitchen: "new", bar: "cancelled" }]);
    assert.equal(stripe.refunded(row(o.id).payment_intent), 3 * COLA(), "the three Sprites, not the salad");
  });

  it("paying staff: taking a line off just lowers what the table pays", async () => {
    const admin = await setUp({ paymentMode: "on_site" });
    const res = await order(guest(), 3, [["tiramisu"], ["illy-coffee", "std", 2]]);
    const o = res.body.order;
    const v = await voidLine(admin, o.id, 1, 1, 2, "Гостът се отказа");
    assert.equal(v.status, 200);
    assert.equal(v.body.order.total, o.total - priceOf("illy-coffee"));
    assert.equal(stripe.calls("/v1/refunds").length, 0, "no money moved");
    assert.equal(v.body.order.refundDue, 0);
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

describe("paying on the phone: a tip with the order", () => {
  const items = () => new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  const price = (id, variant = "std") => items().get(id).variants.find((v) => v.id === variant).price;
  const tipped = (c, table, lines, tip, { key = newKey() } = {}) =>
    c.post("/api/qr/order.php", { ...orderBody(menu, table, lines), tip }, { headers: { "Idempotency-Key": key } });
  const cancel = (admin, id, from = "new") => admin.admin("/api/qr/admin/order.php", { id, action: "cancel", from, reason: "Гостът се отказа" });

  it("is its own line on Stripe's page, and stays apart from the till amount", async () => {
    const admin = await setUp();
    const total = price("caesar", "chicken") + 2 * price("illy-coffee");
    const res = await tipped(guest(), 6, [["caesar", "chicken"], ["illy-coffee", "std", 2]], 150);
    assert.equal(res.status, 201, res.text);
    assert.deepEqual([res.body.order.total, res.body.order.tip], [total, 150]);
    const [call] = stripe.calls("/v1/checkout/sessions");
    const last = call.params.line_items.at(-1);
    assert.deepEqual([last.quantity, last.price_data.unit_amount, last.price_data.product_data.name], ["1", "150", "Бакшиш за екипа"]);
    assert.equal(sessionOf(res).amount_total, total + 150);

    await stripe.pay(sessionOf(res).id);
    const o = (await feed(admin)).orders[0];
    assert.deepEqual([o.payStatus, o.total, o.tip, o.tipNet, o.net], ["paid", total, 150, 150, total], "the till enters the order without the tip");
    const status1 = await status(guest(), res.body.token);
    assert.equal(status1.tip, 150, "the guest sees their tip");
  });

  it("taking a line off refunds just the line; cancelling the order gives the tip back too", async () => {
    const admin = await setUp();
    const res = await tipped(guest(), 6, [["caesar", "chicken"], ["illy-coffee", "std", 2]], 200);
    await stripe.pay(sessionOf(res).id);
    const { id } = res.body.order;
    const pi = row(id).payment_intent;
    const v = await admin.admin("/api/qr/admin/order.php", { id, action: "void", line: 1, qty: 1, have: 2, reason: "Изчерпан продукт" });
    assert.equal(v.status, 200, v.text);
    assert.equal(stripe.refunded(pi), price("illy-coffee"), "the coffee only");
    assert.equal(v.body.order.tipNet, 200, "the tip stands with the order");

    const c = await cancel(admin, id);
    assert.equal(c.status, 200, c.text);
    const total = price("caesar", "chicken") + 2 * price("illy-coffee");
    assert.equal(stripe.refunded(pi), total + 200, "everything back, tip included");
    assert.deepEqual([c.body.order.payStatus, c.body.order.refunded, c.body.order.tipNet], ["refunded", total + 200, 0]);
    assert.deepEqual([row(id).refund_due_cents, row(id).refunded_cents], [total + 200, total + 200]);
  });

  it("is checked, counts in the history, and is left out when guests do not pay on the phone", async () => {
    const admin = await setUp();
    const coffee = price("illy-coffee");
    for (const tip of [-1, "1,50", 1.5, coffee + 1, 50001]) {
      assert.equal((await tipped(guest(), 6, [["illy-coffee"]], tip)).status, 400, String(tip));
    }
    const key = newKey();
    assert.equal((await tipped(guest(), 6, [["illy-coffee"]], 50, { key })).status, 201);
    assert.equal((await tipped(guest(), 6, [["illy-coffee"]], 60, { key })).status, 409, "a different tip is a different order");
    await stripe.pay(sessionOf(await tipped(guest(), 6, [["illy-coffee"]], 50, { key })).id);

    const report = (await admin.get("/api/qr/admin/history.php?evening=2026-10-03")).body.report;
    assert.deepEqual([report.sales, report.pay.card, report.tips], [coffee, coffee, 50]);
    const csv = (await admin.get("/api/qr/admin/export.php?kind=payments&evening=2026-10-03")).text.trimEnd().split("\r\n");
    assert.deepEqual(csv[1].split(";").slice(4, 8), ["поръчка", "2,50", "0,50", "3,00"]);

    // Paying staff tonight: no money is taken by the phone, so no tip either.
    assert.equal((await admin.admin("/api/qr/admin/settings.php", { paymentMode: "on_site" })).status, 200);
    const plain = await tipped(guest(), 7, [["illy-coffee"]], 50);
    assert.equal(plain.status, 201, plain.text);
    assert.deepEqual([plain.body.order.status, plain.body.order.tip], ["new", 0]);
  });
});
