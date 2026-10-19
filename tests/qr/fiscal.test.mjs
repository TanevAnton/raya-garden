// Fiscal receipts for phone payments (_lib/fiscal.php) and the bridge that
// prints them (tools/fiscal-bridge/bridge.mjs), end to end: a real PHP server,
// a fake Stripe, a fake ErpNet.FP (tests/qr/fake-erpnet.mjs) and the real
// bridge, driven one round at a time. What matters most: every payment comes
// out of the printer exactly once, whatever breaks on the way. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeErpNet, PRINTER } from "./fake-erpnet.mjs";
import { createBridge } from "../../tools/fiscal-bridge/bridge.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_fiscal";
const KEY = "test-bridge-key-0123456789abcdef0123456789";
const FISCAL = { fiscal_mode: "test", fiscal_bridge_token: KEY };

let srv;
let stripe;
let printer;
let menu;
let price;
let item;
let work;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  printer = await startFakeErpNet();
  srv = await startServer({ stripe: { key: "rk_test_fiscal", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  item = (id) => items.get(id);
  price = (id, variant = "std") => items.get(id).variants.find((v) => v.id === variant).price;
});
after(async () => {
  srv.stop();
  await stripe.stop();
  await printer.stop();
});
beforeEach(() => {
  stripe.reset();
  printer.reset();
  srv.config(FISCAL);
  work = mkdtempSync(path.join(tmpdir(), "raya-bridge-"));
});

async function setUp(paymentMode = "online") {
  srv.reset();
  const admin = client(srv.base, { now: AT_20H });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  return admin;
}
const guest = () => client(srv.base, { now: AT_20H });
async function paid(table, lines, extra = {}) {
  const res = await guest().post("/api/qr/order.php", orderBody(menu, table, lines, extra), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  await stripe.pay(new URL(res.body.checkoutUrl).pathname.slice(5));
  return res.body;
}
const docs = () => JSON.parse(srv.sqlite("SELECT * FROM fiscal_docs ORDER BY id"));
const row = (id) => JSON.parse(srv.sqlite(`SELECT * FROM orders WHERE id = ${id}`))[0];
const voidLine = (admin, id, line, qty, have) => admin.admin("/api/qr/admin/order.php", { id, action: "void", line, qty, have, reason: "Изчерпан продукт" });
const cancel = (admin, id) => admin.admin("/api/qr/admin/order.php", { id, action: "cancel", from: "new", reason: "Гостът си тръгна" });
const now = () => Math.floor(Date.now() / 1000);

/** A bridge, as in the restaurant; `later` moves the server's clock (leases run out). */
const bridge = ({ later = 0, fetch } = {}) =>
  createBridge(
    { server: srv.base, key: KEY, erpnet: printer.base, printerId: "", journal: path.join(work, "journal.json"), waitMs: 1500, headers: later ? { "X-Test-Now": String(now() + later) } : {} },
    { log: () => {}, ...(fetch ? { fetch } : {}) },
  );
/** Rounds until nothing is left to claim. */
async function drain(b = bridge(), rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const wait = await b.step();
    if (wait > 0) return;
  }
}

describe("fiscal receipts: printing", () => {
  it("a paid order comes out of the printer once: its lines under their tax groups, the tip, paid by card, with an УНП", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await paid(4, [["caesar", "chicken", 2], ["coca-cola-products", "std", 3, "sprite"]], { tip: 150 });
    assert.deepEqual(docs().map((d) => [d.kind, d.status, d.usn_seq]), [["sale", "pending", 1]]);

    await drain();
    assert.equal(printer.paper.length, 1);
    const [r] = printer.paper;
    assert.equal(r.kind, "receipt");
    assert.equal(r.body.uniqueSaleNumber, `${PRINTER.serialNumber}-0001-0000001`);
    assert.deepEqual(r.body.items.map((i) => [i.type ?? "sale", i.quantity, i.unitPrice, i.taxGroup]), [
      ["comment", undefined, undefined, undefined],
      ["sale", 2, C / 100, 2],
      ["sale", 3, S / 100, 2],
      ["sale", 1, 1.5, 2],
    ]);
    assert.equal(r.body.items[0].text, `QR меню ${placed.order.code}`);
    assert.ok(item("caesar").bg.startsWith(r.body.items[1].text.slice(0, 10)));
    assert.ok(r.body.items.every((i) => i.text.length <= (i.type === "comment" ? 40 : 22)), "cut to what the printer takes");
    assert.equal(r.body.items[3].text, "Бакшиш");
    const total = (2 * C + 3 * S + 150) / 100;
    assert.deepEqual(r.body.payments, [{ amount: total, paymentType: "card" }]);

    const [doc] = docs();
    assert.deepEqual([doc.status, doc.receipt_number, doc.fm_number, doc.usn, doc.error], ["printed", "0000001", PRINTER.fiscalMemorySerialNumber, r.body.uniqueSaleNumber, ""]);
    assert.ok(row(placed.order.id).till_at > 0, "„За касата“: done");
    const feed = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
    assert.deepEqual([feed.fiscalDocs[0].status, feed.fiscalDocs[0].receiptNumber], ["printed", "0000001"]);
    assert.deepEqual([feed.fiscal.mode, feed.fiscal.online, feed.fiscal.printerOk, feed.fiscal.printer], ["test", true, true, PRINTER.serialNumber]);
  });

  it("each sale its own УНП, one after another; Stripe repeating itself prints nothing more", async () => {
    await setUp();
    const a = await paid(4, [["tiramisu"]]);
    await paid(5, [["tiramisu"]]);
    await stripe.pay(stripe.sessions.get(new URL(a.checkoutUrl).pathname.slice(5)).id);
    await drain();
    assert.deepEqual(printer.paper.map((p) => p.body.uniqueSaleNumber), ["DT279013-0001-0000001", "DT279013-0001-0000002"]);
  });

  it("a table's bill: each payment its own receipt", async () => {
    await setUp("tab");
    const a = (await guest().post("/api/qr/order.php", orderBody(menu, 5, [["tiramisu"]]), { headers: { "Idempotency-Key": newKey() } })).body;
    const pay = await guest().post("/api/qr/bill-pay.php", { table: 5, lang: "bg", items: [{ code: a.order.code, line: 0 }], expectedAmount: price("tiramisu"), tip: 50 }, { headers: { "Idempotency-Key": newKey() } });
    assert.equal(pay.status, 201, pay.text);
    await stripe.pay(new URL(pay.body.checkoutUrl).pathname.slice(5));
    await drain();
    assert.equal(printer.paper.length, 1);
    assert.deepEqual(printer.paper[0].body.payments, [{ amount: (price("tiramisu") + 50) / 100, paymentType: "card" }]);
    assert.equal(docs()[0].source, "bill");
  });
});

describe("fiscal receipts: refunds", () => {
  it("one line taken off, then the whole order: a reversal receipt for each, with the sale's УНП and number, reason refund", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await paid(4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 3, "sprite"]], { tip: 100 });
    await drain();
    const [sale] = printer.paper;

    assert.equal((await voidLine(admin, placed.order.id, 1, 1, 3)).status, 200);
    await drain();
    assert.equal(printer.paper.length, 2);
    const storno = printer.paper[1];
    assert.equal(storno.kind, "reversalreceipt");
    assert.deepEqual(
      [storno.body.uniqueSaleNumber, storno.body.receiptNumber, storno.body.receiptDateTime, storno.body.fiscalMemorySerialNumber, storno.body.reason],
      [sale.body.uniqueSaleNumber, sale.receiptNumber, sale.receiptDateTime, sale.fiscalMemorySerialNumber, "refund"],
    );
    assert.deepEqual(storno.body.items.filter((i) => !i.type).map((i) => [i.quantity, i.unitPrice]), [[1, S / 100]], "positive, as ErpNet.FP wants");
    assert.deepEqual([row(placed.order.id).till_cents, row(placed.order.id).till_void_cents], [C + 3 * S, S]);

    assert.equal((await cancel(admin, placed.order.id)).status, 200);
    await drain();
    assert.equal(printer.paper.length, 3);
    assert.deepEqual(printer.paper[2].body.items.filter((i) => !i.type).map((i) => [i.quantity, i.unitPrice]), [[1, C / 100], [2, S / 100], [1, 1]]);
    const back = printer.paper.slice(1).reduce((s, p) => s + p.receiptAmount, 0);
    assert.equal(Math.round(back * 100), C + 3 * S + 100, "everything paid is reversed, once");
  });

  it("a refund waits for its sale's receipt", async () => {
    const admin = await setUp();
    printer.setStatusOk(false); // the printer's cover is open
    const placed = await paid(4, [["tiramisu"], ["caesar", "chicken", 1]]);
    await bridge().step();
    assert.equal(printer.paper.length, 0);
    assert.equal((await voidLine(admin, placed.order.id, 0, 1, 1)).status, 200);
    assert.deepEqual(docs().map((d) => [d.kind, d.status]), [["sale", "claimed"], ["storno", "pending"]]);
    printer.setStatusOk(true);
    await drain(bridge({ later: 130 }));
    assert.deepEqual(printer.paper.map((p) => p.kind), ["receipt", "reversalreceipt"]);
  });
});

describe("fiscal receipts: exactly once, whatever breaks", () => {
  it("the printer refuses it: nothing printed, tried again later under a new task id, printed once", async () => {
    await setUp();
    printer.failNext("E201", "The fiscal memory is full");
    await paid(4, [["tiramisu"]]);
    await drain();
    let [doc] = docs();
    assert.deepEqual([doc.status, doc.error], ["failed", "E201 The fiscal memory is full"]);
    assert.equal(printer.paper.length, 0);
    await drain(bridge({ later: 31 }));
    [doc] = docs();
    assert.equal(doc.status, "printed");
    assert.equal(printer.paper.length, 1);
    assert.equal(new Set(printer.posts.map((p) => p.taskId)).size, 2, "a fresh task id for the retry");
  });

  it("the bridge stops while the printer is still printing: the next round finds the answer, prints nothing more", async () => {
    await setUp();
    await paid(4, [["tiramisu"]]);
    printer.hold();
    await bridge().step(); // sent; no answer within its wait
    assert.equal(docs()[0].status, "submitted");
    printer.release();
    await drain(bridge({ later: 130 })); // a new bridge, the same journal
    assert.equal(docs()[0].status, "printed");
    assert.equal(printer.paper.length, 1);
    assert.equal(printer.posts.length, 1, "never sent twice");
  });

  it("the printer's answer was read but never reached the server: reported from the journal", async () => {
    await setUp();
    await paid(4, [["tiramisu"]]);
    let failed = false;
    // The server cannot be reached just when the bridge reports the receipt.
    const flaky = (url, opts) => {
      if (!failed && String(url).endsWith("/report.php") && String(opts?.body).includes('"printed"')) {
        failed = true;
        return Promise.reject(new TypeError("fetch failed"));
      }
      return fetch(url, opts);
    };
    await assert.rejects(bridge({ fetch: flaky }).step());
    assert.equal(docs()[0].status, "submitted");
    await drain(bridge({ later: 130 })); // ErpNet.FP has forgotten it by now; the journal has not
    assert.equal(docs()[0].status, "printed");
    assert.equal(printer.paper.length, 1);
  });

  it("ErpNet.FP restarted and the answer is lost: it stops for a person, and is never printed again by itself", async () => {
    const admin = await setUp();
    await paid(4, [["tiramisu"]]);
    printer.hold();
    await bridge().step();
    printer.release();
    printer.restart(); // printed, but ErpNet.FP no longer knows it
    await drain(bridge({ later: 130 }));
    let [doc] = docs();
    assert.equal(doc.status, "check");
    assert.match(doc.error, /check whether a receipt for R-/);
    await drain(bridge({ later: 400 }));
    assert.equal(printer.paper.length, 1, "not printed twice");
    // A person looked at the printer and found the receipt there: entered by hand.
    const tick = await admin.admin("/api/qr/admin/till.php", { id: doc.source_id, entered: true });
    assert.equal(tick.status, 200, tick.text);
    [doc] = docs();
    assert.equal(doc.status, "manual");
  });

  it("staff can send a failed receipt again at once", async () => {
    const admin = await setUp();
    printer.failNext();
    await paid(4, [["tiramisu"]]);
    await drain();
    const res = await admin.admin("/api/qr/admin/fiscal.php", { id: docs()[0].id, action: "retry" });
    assert.equal(res.status, 200, res.text);
    await drain();
    assert.equal(docs()[0].status, "printed");
    assert.equal((await admin.admin("/api/qr/admin/fiscal.php", { id: docs()[0].id, action: "retry" })).status, 409);
  });
});

describe("fiscal receipts: by hand, and switches", () => {
  it("ticked on „За касата“ before it printed: never printed; while printing, the tick is refused", async () => {
    const admin = await setUp();
    printer.setStatusOk(false);
    const a = await paid(4, [["tiramisu"]]);
    const b = await paid(5, [["tiramisu"]]);
    await bridge().step(); // claims a, waits for the printer
    const busy = await admin.admin("/api/qr/admin/till.php", { id: a.order.id, entered: true });
    assert.deepEqual([busy.status, busy.body.error], [409, "fiscal_printing"]);
    assert.equal((await admin.admin("/api/qr/admin/till.php", { id: b.order.id, entered: true })).status, 200);
    printer.setStatusOk(true);
    await drain(bridge({ later: 130 }));
    assert.deepEqual(docs().map((d) => d.status), ["printed", "manual"]);
    assert.equal(printer.paper.length, 1);
    const undo = await admin.admin("/api/qr/admin/till.php", { id: a.order.id, entered: false });
    assert.deepEqual([undo.status, undo.body.error], [409, "fiscal_done"]);
  });

  it("only the bridge, with its key", async () => {
    await setUp();
    const res = await fetch(`${srv.base}/api/qr/fiscal/claim.php`, { method: "POST", headers: { "Content-Type": "application/json", "X-Raya-Bridge-Key": "wrong-key-wrong-key-wrong-key-wrong" }, body: "{}" });
    assert.equal(res.status, 401);
    const none = await fetch(`${srv.base}/api/qr/fiscal/claim.php`, { method: "POST", body: "{}" });
    assert.equal(none.status, 401);
  });

  it("test payments never reach a live printer, and off is off", async () => {
    await setUp();
    srv.config({ fiscal_mode: "live" });
    await paid(4, [["tiramisu"]]);
    srv.config({ fiscal_mode: "off" });
    await paid(5, [["tiramisu"]]);
    assert.equal(docs().length, 0);
  });

  it("the staff screen sees the bridge go quiet", async () => {
    await setUp();
    await bridge().step();
    const later = client(srv.base, { now: now() + 200 });
    assert.equal((await later.login()).status, 200);
    const res = await later.get("/api/qr/admin/feed.php?since=0");
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.fiscal.online, false);
    const fresh = client(srv.base, { now: now() });
    assert.equal((await fresh.login()).status, 200);
    assert.equal((await fresh.get("/api/qr/admin/feed.php?since=0")).body.fiscal.online, true);
    rmSync(work, { recursive: true, force: true });
  });
});
