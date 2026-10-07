// The e-receipt („Електронна бележка“, _lib/ereceipt.php) against a real PHP
// server and a fake Stripe: issued when Stripe confirms a payment, e-mailed
// to the address from Stripe's page, its QR code read back with a real
// scanner (zbarimg, when installed), and storno documents for refunds.
// Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_ereceipt";
const SELLER = "„Света гора-Велико Търново“ ООД";

let srv;
let stripe;
let menu;
let price;
let settings;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({ stripe: { key: "rk_test_ereceipt", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  price = (id, variant = "std") => items.get(id).variants.find((v) => v.id === variant).price;
  settings = readFileSync(settingsFile(), "utf8");
});
after(async () => {
  srv.stop();
  await stripe.stop();
});
beforeEach(() => {
  stripe.reset();
  writeFileSync(settingsFile(), settings);
});

/** The server's copy of ereceipt-settings.php: a test may switch the mode in it. */
const settingsFile = () => path.join(srv.root, "api", "qr", "_lib", "ereceipt-settings.php");
const setMode = (mode) => writeFileSync(settingsFile(), settings.replace("'mode' => 'test'", `'mode' => '${mode}'`));

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
const row = (id) => JSON.parse(srv.sqlite(`SELECT * FROM orders WHERE id = ${id}`))[0];
const docs = () => JSON.parse(srv.sqlite("SELECT * FROM ereceipts ORDER BY id"));
const receipts = () => srv.mails().filter((m) => m.to === "guest@example.com");
const status = async (token) => (await guest().get(`/api/qr/order-status.php?t=${token}`)).body.orders[0];
const voidLine = (admin, id, line, qty, have) => admin.admin("/api/qr/admin/order.php", { id, action: "void", line, qty, have, reason: "Изчерпан продукт" });
const cancel = (admin, id) => admin.admin("/api/qr/admin/order.php", { id, action: "cancel", from: "new", reason: "Гостът си тръгна" });

const eur = (cents) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")} €`;
const net = (gross) => Math.round((gross * 100) / 120);
/** A unix time in Sofia: [YYYY-MM-DD, HH:MM:SS, DD.MM.YYYY]. */
function sofiaParts(unix) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(unix * 1000))
      .map((x) => [x.type, x.value]),
  );
  return [`${p.year}-${p.month}-${p.day}`, `${p.hour}:${p.minute}:${p.second}`, `${p.day}.${p.month}.${p.year}`];
}

/** The text of a QR code (a PNG), read by zbarimg; null where it is not installed. */
function scan(png) {
  try {
    execFileSync("zbarimg", ["--version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const dir = mkdtempSync(path.join(tmpdir(), "raya-qr-scan-"));
  try {
    writeFileSync(path.join(dir, "code.png"), png);
    return execFileSync("zbarimg", ["-q", "--raw", path.join(dir, "code.png")], { stdio: ["ignore", "pipe", "ignore"] }).toString().trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Н-18's code: e-shop number, order number, transaction reference, date, time, total. */
function assertCode(png, doc, amount) {
  const [date, time] = sofiaParts(doc.issued_at);
  const text = scan(png);
  if (text === null) {
    console.log("# zbarimg is not installed: the QR code is not read back");
    return;
  }
  assert.equal(text, `TEST*${doc.order_no}*${doc.payment_intent}*${date}*${time}*${(amount / 100).toFixed(2)}`);
}

describe("the e-receipt for a phone payment", () => {
  it("an order paid on the phone: the document by e-mail, with Н-18's QR code", async () => {
    await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await order(7, [["caesar", "chicken", 2], ["coca-cola-products", "std", 1, "sprite"]], { tip: 150 });
    assert.equal(docs().length, 0, "nothing before Stripe confirms");
    await stripe.pay(sessionOf(placed).id);

    const o = placed.order;
    const gross = 2 * C + S + 150;
    const [doc] = docs();
    const pi = row(o.id).payment_intent;
    assert.deepEqual(
      [doc.kind, doc.test, doc.number, doc.source, doc.order_no, doc.payment_intent, doc.total_cents, doc.email, doc.mail_status, doc.mail_tries],
      ["sale", 1, 1, "order", `${o.code}-${o.id}`, pi, gross, "guest@example.com", "sent", 1],
    );
    assert.deepEqual(JSON.parse(doc.lines_json).map((l) => [l.key, l.qty, l.unit, l.group]), [
      ["o0", 2, C, "Б"],
      ["o1", 1, S, "Б"],
      ["tip", 1, 150, "Б"],
    ]);

    const mails = receipts();
    assert.equal(mails.length, 1);
    const [mail] = mails;
    assert.equal(mail.subject, "ТЕСТ · Електронна бележка № 0000000001 — RAYA Garden");
    assert.equal(mail.from, "RAYA Garden <no-reply@rayagarden.bg>");
    const [, time, day] = sofiaParts(doc.issued_at);
    const { html, text } = mail;
    for (const part of [
      "ТЕСТ — НЕ Е ДАНЪЧЕН ДОКУМЕНТ",
      "ЕЛЕКТРОННА БЕЛЕЖКА",
      `№ 0000000001 – ${day} г., ${time}`,
      SELLER,
      "ЕИК: 203389338",
      "ДДС №: BG203389338",
      "Имейл: guest@example.com",
      o.lines[0].nameBg,
      "Бакшиш за екипа",
      eur(net(C)),
      "Б - 20%",
      eur(2 * C),
      `Общо (без ДДС)</td><td style="font:13px Arial,Helvetica,sans-serif;color:#555;padding:4px 0;text-align:right;white-space:nowrap">${eur(net(gross))}`,
      `ДДС (20%)</td><td style="font:13px Arial,Helvetica,sans-serif;color:#555;padding:4px 0;text-align:right;white-space:nowrap">${eur(gross - net(gross))}`,
      eur(gross),
      `${o.code}-${o.id}`,
      "Доставчик на платежни услуги",
      "Stripe",
      pi,
      'src="cid:qr@rayagarden.bg"',
      'src="cid:logo@rayagarden.bg"',
    ]) {
      assert.ok(html.includes(part), `the e-mail shows ${part}`);
    }
    assert.match(text, /ЕЛЕКТРОННА БЕЛЕЖКА № 0000000001/);
    assert.match(text, new RegExp(`Общо: ${eur(gross)}`));
    assert.equal(mail.inline["qr@rayagarden.bg"].type, "image/png");
    assert.equal(mail.inline["logo@rayagarden.bg"].type, "image/png");
    assertCode(mail.inline["qr@rayagarden.bg"].data, doc, gross);

    // The guest's own screen links to it; the link opens the same document.
    const mine = await status(placed.token);
    assert.match(mine.receiptUrl, /^https:\/\/rayagarden\.bg\/api\/qr\/receipt\.php\?n=1&t=[0-9a-f]{32}$/);
    assert.ok(html.includes(mine.receiptUrl.replace(/&/g, "&amp;")), "and so does the e-mail");
    const page = await fetch(mine.receiptUrl.replace("https://rayagarden.bg", srv.base));
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(page.headers.get("x-robots-tag"), "noindex");
    const body = await page.text();
    assert.ok(body.includes(`№ 0000000001 – ${day} г., ${time}`) && body.includes(SELLER));
    const png = Buffer.from(body.match(/<img src="data:image\/png;base64,([^"]+)" width="124"/)[1], "base64");
    assertCode(png, doc, gross);
    for (const wrong of [mine.receiptUrl.replace(/t=.{4}/, "t=0000"), mine.receiptUrl.replace("n=1", "n=2"), `${srv.base}/api/qr/receipt.php`]) {
      const res = await fetch(wrong.replace("https://rayagarden.bg", srv.base));
      assert.equal(res.status, 404, wrong);
    }
  });

  it("numbered one after another, once per payment however often Stripe repeats itself; English guests get a line in English", async () => {
    await setUp();
    const first = await order(3, [["tiramisu"]]);
    await stripe.pay(sessionOf(first).id);
    await stripe.pay(sessionOf(first).id); // the same payment told twice
    const second = await order(4, [["illy-coffee"]], { lang: "en" });
    await stripe.pay(sessionOf(second).id);
    assert.deepEqual(docs().map((d) => [d.number, d.source_id, d.lang]), [
      [1, first.order.id, "bg"],
      [2, second.order.id, "en"],
    ]);
    const mails = receipts();
    assert.deepEqual(mails.map((m) => m.subject), [
      "ТЕСТ · Електронна бележка № 0000000001 — RAYA Garden",
      "ТЕСТ · Електронна бележка № 0000000002 — RAYA Garden",
    ]);
    assert.ok(!mails[0].html.includes("Thank you"));
    assert.match(mails[1].html, /Thank you for your visit! This is the electronic receipt/);
    assert.match(mails[1].html, /ЕЛЕКТРОННА БЕЛЕЖКА/, "the document itself is in Bulgarian");
  });

  it("no address from Stripe: the document is issued, and nothing is sent", async () => {
    await setUp();
    const placed = await order(3, [["tiramisu"]]);
    await stripe.pay(sessionOf(placed).id, { email: null });
    assert.deepEqual(docs().map((d) => [d.number, d.email, d.mail_status]), [[1, "", "none"]]);
    assert.equal(srv.mails().length, 0);
    assert.match((await status(placed.token)).receiptUrl, /receipt\.php\?n=1&/);
  });
});

describe("the e-receipt: refunds get storno documents", () => {
  it("one line taken off, then the whole order: a storno for each, for exactly what went back", async () => {
    const admin = await setUp();
    const C = price("caesar", "chicken");
    const S = price("coca-cola-products");
    const placed = await order(4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 3, "sprite"]], { tip: 100 });
    await stripe.pay(sessionOf(placed).id);
    const { id } = placed.order;
    const paid = C + 3 * S + 100;

    assert.equal((await voidLine(admin, id, 1, 1, 3)).status, 200);
    let [sale, storno] = docs();
    assert.deepEqual([storno.kind, storno.number, storno.sale_id, storno.total_cents, storno.order_no, storno.payment_intent], [
      "storno", 2, sale.id, S, sale.order_no, sale.payment_intent,
    ]);
    assert.deepEqual(JSON.parse(storno.lines_json).map((l) => [l.key, l.qty, l.unit]), [["o1", 1, S]]);
    let mail = receipts().at(-1);
    assert.equal(mail.subject, "ТЕСТ · Сторно документ № 0000000002 — RAYA Garden");
    const [, , saleDay] = sofiaParts(sale.issued_at);
    for (const part of ["СТОРНО ДОКУМЕНТ", `към електронна бележка № 0000000001 от ${saleDay} г.`, "Основание: връщане на сума", `Общо за връщане`, `−${eur(S)}`]) {
      assert.ok(mail.html.includes(part), part);
    }
    assert.match(mail.html, new RegExp(`Върнахме Ви ${eur(S)}`));
    assertCode(mail.inline["qr@rayagarden.bg"].data, storno, S);

    assert.equal((await cancel(admin, id)).status, 200);
    const all = docs();
    assert.equal(all.length, 3);
    const last = all[2];
    assert.deepEqual([last.kind, last.number, last.total_cents], ["storno", 3, paid - S]);
    assert.deepEqual(JSON.parse(last.lines_json).map((l) => [l.key, l.qty]), [["o0", 1], ["o1", 2], ["tip", 1]], "what was left, tip included");
    assert.equal(all.filter((d) => d.kind === "storno").reduce((sum, d) => sum + d.total_cents, 0), paid, "everything paid is undone, once");
    assert.equal(receipts().length, 3);
  });

  it("a refund made in Stripe's Dashboard: a storno for all of it", async () => {
    await setUp();
    const placed = await order(4, [["tiramisu"], ["illy-coffee", "std", 2]]);
    await stripe.pay(sessionOf(placed).id);
    const pi = row(placed.order.id).payment_intent;
    await stripe.deliver(stripe.event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: pi, refunded: true }));
    const [, storno] = docs();
    assert.deepEqual([storno.kind, storno.total_cents], ["storno", placed.order.total]);
    assert.deepEqual(JSON.parse(storno.lines_json).map((l) => [l.key, l.qty]), [["o0", 1], ["o1", 2]]);
  });

  it("only money that actually went back: a refund that fails waits for the retry", async () => {
    const admin = await setUp();
    const placed = await order(4, [["tiramisu"], ["illy-coffee", "std", 2]]);
    await stripe.pay(sessionOf(placed).id);
    stripe.failNext("/v1/refunds", 500);
    const res = await voidLine(admin, placed.order.id, 1, 1, 2);
    assert.equal(res.body.refundPending, true);
    assert.equal(docs().length, 1, "no storno for a refund that did not happen");
    assert.equal((await admin.admin("/api/qr/admin/order.php", { id: placed.order.id, action: "refund" })).status, 200);
    const [, storno] = docs();
    assert.deepEqual([storno.total_cents, JSON.parse(storno.lines_json).map((l) => [l.key, l.qty])], [price("illy-coffee"), [["o1", 1]]]);
  });
});

describe("the e-receipt: a table's bill", () => {
  const pay = (table, lines, amount, tip) =>
    guest().post("/api/qr/bill-pay.php", { table, lang: "bg", items: lines.map(([code, line]) => ({ code, line })), expectedAmount: amount, ...(tip ? { tip } : {}) }, {
      headers: { "Idempotency-Key": newKey() },
    });

  it("each payment gets a document for the lines it paid; a line paid twice comes back with a storno", async () => {
    await setUp("tab");
    const T = price("tiramisu");
    const K = price("illy-coffee");
    const ana = await order(5, [["tiramisu"], ["illy-coffee"]]);
    assert.equal(docs().length, 0, "ordering on a bill issues nothing: nothing is paid yet");
    const a = await pay(5, [[ana.order.code, 0]], T, 100);
    const b = await pay(5, [[ana.order.code, 0], [ana.order.code, 1]], T + K);
    await stripe.pay(sessionOf(a.body).id);
    await stripe.pay(sessionOf(b.body).id);

    const [saleA, saleB, storno] = docs();
    const paymentA = JSON.parse(srv.sqlite(`SELECT id, code FROM bill_payments WHERE code = '${a.body.payment.code}'`))[0];
    assert.deepEqual([saleA.source, saleA.source_id, saleA.order_no, saleA.total_cents], ["bill", paymentA.id, `${paymentA.code}-${paymentA.id}`, T + 100]);
    assert.deepEqual(JSON.parse(saleA.lines_json).map((l) => [l.qty, l.unit]), [[1, T], [1, 100]]);
    assert.deepEqual([saleB.total_cents, JSON.parse(saleB.lines_json).length], [T + K, 2]);
    assert.deepEqual([storno.kind, storno.sale_id, storno.total_cents], ["storno", saleB.id, T], "B paid for the tiramisu A had paid for");
    assert.deepEqual(JSON.parse(storno.lines_json).map((l) => [l.qty, l.unit]), [[1, T]]);
    assert.deepEqual(receipts().map((m) => m.subject.replace("ТЕСТ · ", "")), [
      "Електронна бележка № 0000000001 — RAYA Garden",
      "Електронна бележка № 0000000002 — RAYA Garden",
      "Сторно документ № 0000000003 — RAYA Garden",
    ]);
    const mine = (await guest().get(`/api/qr/bill.php?table=5&t=${a.body.token}`)).body.payments[0];
    assert.match(mine.receiptUrl, /receipt\.php\?n=1&t=/);
  });
});

describe("the e-receipt: sending", () => {
  it("a refused e-mail is tried again from the staff screen's poll, ten minutes on", async () => {
    await setUp();
    srv.mailFails(true);
    const placed = await order(4, [["tiramisu"]]);
    await stripe.pay(sessionOf(placed).id);
    let [doc] = docs();
    assert.deepEqual([doc.mail_status, doc.mail_tries, doc.mail_error], ["failed", 1, "test: the mail server refused"]);
    srv.mailFails(false);
    // The webhook ran on the real clock: the staff screen polls from there.
    const now = Math.floor(Date.now() / 1000);
    const staff = client(srv.base, { now });
    assert.equal((await staff.login()).status, 200);
    await staff.get("/api/qr/admin/feed.php?since=0", { at: now + 120 });
    assert.equal(docs()[0].mail_status, "failed", "not within ten minutes");
    await staff.get("/api/qr/admin/feed.php?since=0", { at: now + 660 });
    [doc] = docs();
    assert.deepEqual([doc.mail_status, doc.mail_tries, doc.mail_error], ["sent", 2, ""]);
    assert.equal(receipts().length, 1);
    await staff.get("/api/qr/admin/feed.php?since=0", { at: now + 1300 });
    assert.equal(receipts().length, 1, "once sent, never again");
  });

  it("the address is erased after three days; the document stays", async () => {
    await setUp();
    const placed = await order(4, [["tiramisu"]]);
    await stripe.pay(sessionOf(placed).id);
    srv.sqlite(`UPDATE ereceipts SET issued_at = ${AT_20H - 4 * 86400}`);
    await order(5, [["tiramisu"]]); // placing an order tidies up
    const [doc] = docs();
    assert.deepEqual([doc.number, doc.email], [1, ""]);
    const page = await (await fetch((await status(placed.token)).receiptUrl.replace("https://rayagarden.bg", srv.base))).text();
    assert.ok(page.includes("Имейл: —") && !page.includes("guest@example.com"));
  });

  it("switched off: no documents, no links", async () => {
    setMode("off");
    await setUp();
    const placed = await order(4, [["tiramisu"]]);
    await stripe.pay(sessionOf(placed).id);
    assert.equal(row(placed.order.id).pay_status, "paid");
    assert.equal(docs().length, 0);
    assert.equal(srv.mails().length, 0);
    assert.equal((await status(placed.token)).receiptUrl, "");
  });
});
