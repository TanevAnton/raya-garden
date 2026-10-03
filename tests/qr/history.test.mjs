// "История": past evenings' reports and the spreadsheet files, against a real
// PHP server, a real SQLite database and a fake Stripe. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";

const WEBHOOK_SECRET = "whsec_test_history";
// Three evenings in October 2026 (summer time in Sofia, UTC+3).
const SAT = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const SUN = { date: "2026-10-04", opens: "18:00", closes: "01:00" };
const MON = { date: "2026-10-05", opens: "18:00", closes: "01:00" };
const at = (iso) => sofia(iso, 3);

let srv;
let stripe;
let menu;
let price;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  srv = await startServer({ stripe: { key: "rk_test_history", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" } });
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

/** Staff set up an evening at its opening time; returns the signed-in staff client. */
async function evening(window, paymentMode, { fresh = false } = {}) {
  if (fresh) srv.reset();
  const admin = client(srv.base, { now: at(`${window.date}T18:00`) });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...window, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  return admin;
}
const phone = (when) => client(srv.base, { now: when });
const order = async (when, table, lines, extra) => {
  const res = await phone(when).post("/api/qr/order.php", orderBody(menu, table, lines, extra), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  return res;
};
const sessionOf = (res) => stripe.sessions.get(new URL(res.body.checkoutUrl).pathname.slice(5));
const report = async (admin, date) => {
  const res = await admin.get(`/api/qr/admin/history.php?evening=${date}`);
  assert.equal(res.status, 200, res.text);
  return res.body.report;
};
/** A CSV file as rows of cells (no cell in these tests holds a ";"). */
const rows = (text) => text.replace(/^\uFEFF/, "").trimEnd().split("\r\n").map((r) => r.split(";"));

/**
 * Saturday: guests pay staff. Sunday: the table's bill. Monday: paid on the
 * phone before the order goes out. Returns the figures each should show.
 */
async function threeEvenings() {
  const sat = await evening(SAT, "on_site", { fresh: true });
  assert.equal((await sat.admin("/api/qr/admin/waiters.php", { tables: { 3: "Иван", 4: "Иван", 7: "Мария" } })).status, 200);
  const a = (await order(at("2026-10-03T19:10"), 3, [["tiramisu", "std", 2], ["illy-coffee"]], { name: "Ана Петрова" })).body.order;
  const b = (await order(at("2026-10-03T20:30"), 7, [["caesar", "chicken"]])).body.order;
  const c = (await order(at("2026-10-03T21:00"), 4, [["tiramisu"]])).body.order;
  // After midnight: still Saturday's evening.
  const d = (await order(at("2026-10-04T00:40"), 7, [["illy-coffee", "std", 1, "", "=1+1"]])).body.order;
  assert.equal((await sat.admin("/api/qr/admin/order.php", { id: a.id, action: "void", line: 0, qty: 1, have: 2, reason: "Изчерпан продукт" })).status, 200);
  assert.equal((await sat.admin("/api/qr/admin/order.php", { id: c.id, action: "cancel", from: "new", reason: "Грешна маса" })).status, 200);

  // Sunday: one payment for part of table 5's bill, with a tip; staff settle the rest.
  const sun = await evening(SUN, "tab");
  assert.equal((await sun.admin("/api/qr/admin/waiters.php", { tables: { 5: "Петър" } })).status, 200);
  const e = (await order(at("2026-10-04T19:00"), 5, [["caesar", "chicken"], ["illy-coffee", "std", 2]])).body.order;
  const pay = await phone(at("2026-10-04T21:00")).post(
    "/api/qr/bill-pay.php",
    { table: 5, lang: "bg", items: [{ code: e.code, line: 0 }], expectedAmount: price("caesar", "chicken"), tip: 150 },
    { headers: { "Idempotency-Key": newKey() } },
  );
  assert.equal(pay.status, 201, pay.text);
  await stripe.pay(sessionOf(pay).id, { name: "Иван Иванов" });
  const tabId = (await sun.get("/api/qr/admin/feed.php?since=0")).body.tabs[0].id;
  assert.equal((await sun.admin("/api/qr/admin/bill.php", { action: "settle", tabId })).status, 200);

  // Monday: paid on the phone; one of two coffees taken off and refunded.
  const mon = await evening(MON, "online");
  const f = await order(at("2026-10-05T19:30"), 9, [["tiramisu"], ["illy-coffee", "std", 2]]);
  await stripe.pay(sessionOf(f).id);
  const fo = f.body.order;
  assert.equal((await mon.admin("/api/qr/admin/order.php", { id: fo.id, action: "void", line: 1, qty: 1, have: 2, reason: "Изчерпан продукт" })).status, 200);
  // Never paid: not an order staff saw, so not in the history.
  await order(at("2026-10-05T20:00"), 10, [["tiramisu"]]);
  return { mon, a, b, c, d, e, fo };
}

describe("history of past evenings", () => {
  it("reports each evening: sales, how they were paid, stations, waiters, items, every order", async () => {
    const { mon, a, b, c, d } = await threeEvenings();
    const T = price("tiramisu");
    const K = price("illy-coffee");
    const C = price("caesar", "chicken");

    const list = (await mon.get("/api/qr/admin/history.php")).body.evenings;
    assert.deepEqual(list.map((x) => [x.evening, x.orders, x.cancelled, x.sales]), [
      ["2026-10-05", 1, 0, T + K],
      ["2026-10-04", 1, 0, C + 2 * K],
      ["2026-10-03", 3, 1, T + K + C + K],
    ]);

    // Saturday, paid to staff.
    const sat = await report(mon, "2026-10-03");
    assert.equal(sat.orders, 3);
    assert.equal(sat.sales, T + K + C + K);
    assert.equal(sat.voided, T, "one tiramisu taken off");
    assert.deepEqual([sat.cancelled, sat.cancelledTotal], [1, T]);
    assert.equal(sat.tables, 2);
    assert.deepEqual(sat.pay, { staff: sat.sales, card: 0, unpaid: 0 });
    assert.equal(sat.lastAt, at("2026-10-04T00:40"), "an order after midnight belongs to the evening");
    assert.deepEqual(sat.stations, { kitchen: { qty: 2, sales: T + C }, bar: { qty: 2, sales: 2 * K } });
    assert.deepEqual(sat.waiters, [
      { name: "Мария", orders: 2, tables: [7], evenings: 1, sales: C + K },
      { name: "Иван", orders: 1, tables: [3], evenings: 1, sales: T + K },
    ], "Saturday's waiters, though Sunday has its own list");
    const tiramisu = sat.items.find((i) => i.name === "Тирамису");
    assert.deepEqual([tiramisu.qty, tiramisu.voidQty, tiramisu.station], [1, 1, "kitchen"]);
    assert.equal(sat.items.reduce((s, i) => s + i.sales, 0), sat.sales);
    assert.deepEqual(sat.list.map((o) => [o.code, o.status, o.waiter]), [
      [a.code, "new", "Иван"],
      [b.code, "new", "Мария"],
      [c.code, "cancelled", "Иван"],
      [d.code, "new", "Мария"],
    ]);
    assert.equal(sat.list[0].lines[0].voidQty, 1);

    // Sunday, the table's bill: part by card with a tip, the rest on the spot.
    const sun = await report(mon, "2026-10-04");
    assert.equal(sun.sales, C + 2 * K);
    assert.deepEqual(sun.pay, { staff: 2 * K, card: C, unpaid: 0 });
    assert.deepEqual(sun.card, { orders: 0, bills: C });
    assert.deepEqual([sun.tips, sun.billPayments], [150, 1]);
    assert.deepEqual(sun.waiters.map((w) => [w.name, w.sales]), [["Петър", C + 2 * K]]);

    // Monday, paid on the phone, one coffee refunded.
    const monday = await report(mon, "2026-10-05");
    assert.equal(monday.orders, 1, "the order never paid is not there");
    assert.equal(monday.sales, T + K);
    assert.deepEqual(monday.pay, { staff: 0, card: T + K, unpaid: 0 });
    assert.deepEqual([monday.refunded, monday.refundOwed], [K, 0]);
    assert.deepEqual(monday.waiters, [{ name: "", orders: 1, tables: [9], evenings: 1, sales: T + K }]);

    // An evening with nothing.
    const empty = await report(mon, "2026-09-01");
    assert.deepEqual([empty.orders, empty.sales, empty.list.length], [0, 0, 0]);
  });

  it("spreadsheet files: every line, and every card payment, for an evening or a month", async () => {
    const { mon, a, c, d, e, fo } = await threeEvenings();
    const T = price("tiramisu");
    const K = price("illy-coffee");
    const C = price("caesar", "chicken");
    const eur = (cents) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;

    const month = await mon.get("/api/qr/admin/export.php?kind=lines&month=2026-10");
    assert.equal(month.status, 200);
    const lines = rows(month.text);
    assert.equal(lines[0][0], "Вечер");
    assert.equal(lines.length, 1 + 5 + 2 + 2, "header, Saturday's 5 lines, Sunday's 2, Monday's 2");
    const [, first] = lines;
    assert.deepEqual(first, ["2026-10-03", "2026-10-03 19:10", a.code, "3", "Иван", "нова", "на персонала", "кухня", "Тирамису", "", "1", "1", eur(T), eur(T), "Изчерпан продукт", ""]);
    const cancelled = lines.find((r) => r[2] === c.code);
    assert.deepEqual([cancelled[5], cancelled[6], cancelled[10], cancelled[11], cancelled[13], cancelled[14]], ["отказана", "", "0", "1", "0,00", "Грешна маса"]);
    const formula = lines.find((r) => r[2] === d.code);
    assert.equal(formula[1], "2026-10-04 00:40");
    assert.equal(formula[15], "'=1+1", "a note that looks like a formula stays text");
    const bill = lines.filter((r) => r[2] === e.code).map((r) => r[6]);
    assert.deepEqual(bill, ["сметка, с карта", "сметка, на място"]);
    assert.ok(!month.text.includes("Ана Петрова") && !month.text.includes("Иван Иванов"), "no guest or payer names in a file");
    const raw = await fetch(`${srv.base}/api/qr/admin/export.php?kind=lines&month=2026-10`, { headers: { Cookie: mon.cookie } });
    assert.equal(raw.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(raw.headers.get("content-disposition"), 'attachment; filename="raya-poruchki-2026-10-01_2026-10-31.csv"');
    assert.deepEqual([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf], "a byte-order mark, for Excel");

    const sat = rows((await mon.get("/api/qr/admin/export.php?kind=lines&evening=2026-10-03")).text);
    assert.equal(sat.length, 1 + 5, "header and Saturday's 5 lines");

    const pays = rows((await mon.get("/api/qr/admin/export.php?kind=payments&from=2026-10-01&to=2026-10-31")).text);
    assert.equal(pays.length, 1 + 2);
    const [, billPay, orderPay] = pays;
    assert.deepEqual(billPay.slice(0, 1).concat(billPay.slice(3, 12)), ["2026-10-04", "5", "сметка", eur(C), "1,50", eur(C + 150), "0,00", "0,00", eur(C + 150), "не"]);
    assert.match(billPay[2], /^P-/);
    assert.deepEqual(orderPay.slice(2, 12), [fo.code, "9", "поръчка", eur(T + 2 * K), "0,00", eur(T + 2 * K), eur(K), "0,00", eur(T + K), "не"]);
    assert.match(orderPay[12], /^pi_/);
  });

  it("staff only, and only sensible dates", async () => {
    srv.reset();
    const guest = client(srv.base, { now: at("2026-10-03T19:00") });
    assert.equal((await guest.get("/api/qr/admin/history.php")).status, 401);
    assert.equal((await guest.get("/api/qr/admin/history.php?evening=2026-10-03")).status, 401);
    assert.equal((await guest.get("/api/qr/admin/export.php?kind=lines&month=2026-10")).status, 401);
    const admin = await evening(SAT, "on_site", { fresh: true });
    assert.equal((await admin.get("/api/qr/admin/history.php")).body.evenings.length, 0);
    for (const q of ["evening=2026-02-30", "evening=yesterday", "evening="]) {
      assert.equal((await admin.get(`/api/qr/admin/history.php?${q}`)).status, 400, q);
    }
    for (const q of ["kind=all&month=2026-10", "kind=lines&month=2026-13", "kind=lines", "kind=lines&from=2026-10-05&to=2026-10-01", "kind=lines&from=2025-01-01&to=2026-10-01"]) {
      assert.equal((await admin.get(`/api/qr/admin/export.php?${q}`)).status, 400, q);
    }
    assert.equal((await admin.admin("/api/qr/admin/history.php", {})).status, 405);
  });

  it("orders from before evenings were recorded get one: six hours before they were placed, in Sofia", async () => {
    await evening(SAT, "on_site", { fresh: true });
    const early = (await order(at("2026-10-03T19:00"), 3, [["tiramisu"]])).body.order;
    const late = (await order(at("2026-10-04T00:40"), 3, [["tiramisu"]])).body.order;
    srv.sqlite("UPDATE orders SET evening = ''");
    // Back to how a v7 database looks: without what v8, v9 and v10 add.
    srv.sqlite("DROP INDEX orders_evening");
    srv.sqlite("ALTER TABLE orders DROP COLUMN tip_cents");
    srv.sqlite("DROP TABLE report_mails");
    srv.sqlite("ALTER TABLE settings DROP COLUMN report_email");
    srv.sqlite("PRAGMA user_version = 7");
    const res = await client(srv.base).get("/api/qr/state.php"); // any request brings the database up to date
    assert.equal(res.status, 200, res.text);
    const got = JSON.parse(srv.sqlite(`SELECT id, evening FROM orders ORDER BY id`));
    assert.deepEqual(got.map((r) => [r.id, r.evening]), [[early.id, "2026-10-03"], [late.id, "2026-10-03"]]);
    assert.equal(JSON.parse(srv.sqlite("PRAGMA user_version"))[0].user_version, 10);
  });
});

describe("the monthly summary by e-mail", () => {
  const winter = (iso) => sofia(iso, 2); // Sofia is on UTC+2 from 25 October
  const staff = async (when) => {
    const c = client(srv.base, { now: when });
    assert.equal((await c.login()).status, 200);
    return c;
  };
  const poll = async (c, when) => assert.equal((await c.get("/api/qr/admin/feed.php?since=0", { at: when })).status, 200);
  const setEmail = (c, email) => c.admin("/api/qr/admin/report.php", { email });
  const sendNow = (c, month, when) => c.admin("/api/qr/admin/report.php", { send: month }, { at: when });
  const text = (buffer) => buffer.toString("utf8").replace(/^﻿/, "");
  const eur = (cents) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")} €`;

  it("goes out once, on the 1st from 06:00, with the month's figures and both files", async () => {
    await threeEvenings();
    const T = price("tiramisu");
    const K = price("illy-coffee");
    const C = price("caesar", "chicken");
    const sales = T + K + C + K + (C + 2 * K) + (T + K);
    const nov1 = await staff(winter("2026-11-01T05:00"));
    await poll(nov1, winter("2026-11-01T07:00"));
    assert.equal(srv.mails().length, 0, "no address, no e-mail");

    assert.equal((await setEmail(nov1, "  manager@example.com ")).body.email, "manager@example.com");
    await poll(nov1, winter("2026-11-01T05:30"));
    assert.equal(srv.mails().length, 0, "not before 06:00: the last evening may still be on (it is still September's turn — no orders, nothing sent)");
    await poll(nov1, winter("2026-11-01T07:00"));
    const mails = srv.mails();
    assert.equal(mails.length, 1);
    const [mail] = mails;
    assert.equal(mail.to, "manager@example.com");
    assert.equal(mail.from, "RAYA Garden <no-reply@rayagarden.bg>");
    assert.equal(mail.subject, "RAYA Garden · Поръчки от масата — октомври 2026");
    assert.match(mail.text, new RegExp(`Продажби  \\|  ${eur(sales)}`));
    assert.match(mail.text, /Поръчки {2}\| {2}5 за 3 вечери/);
    assert.match(mail.text, new RegExp(`Бакшиши с карта \\(не са в продажбите\\)  \\|  ${eur(150)}`));
    assert.match(mail.text, /сб 3\.10 {2}\| {2}3 {2}\|/, "one line per evening");
    assert.match(mail.text, /Мария {2}\| {2}1 {2}\| {2}2 {2}\|/, "waiters: evenings, orders");
    assert.match(mail.html, new RegExp(eur(sales)));
    assert.deepEqual(Object.keys(mail.files), ["raya-poruchki-2026-10.csv", "raya-plashtania-2026-10.csv"]);
    assert.equal(rows(text(mail.files["raya-poruchki-2026-10.csv"])).length, 1 + 9);
    assert.equal(rows(text(mail.files["raya-plashtania-2026-10.csv"])).length, 1 + 2);
    for (const part of [mail.text, mail.html, ...Object.values(mail.files).map(text)]) {
      assert.ok(!part.includes("Ана Петрова") && !part.includes("Иван Иванов"), "no guest or payer names");
    }

    await poll(nov1, winter("2026-11-01T07:01"));
    await poll(nov1, winter("2026-11-01T09:00"));
    assert.equal(srv.mails().length, 1, "once");
    const log = (await nov1.get("/api/qr/admin/report.php")).body.mails;
    assert.deepEqual(log.map((m) => [m.month, m.status, m.complete, m.manual, m.recipient]), [
      ["2026-10", "sent", true, false, "manager@example.com"],
      ["2026-09", "empty", true, false, "manager@example.com"],
    ]);
  });

  it("a refused e-mail is tried again an hour later; staff can send any month at once", async () => {
    await threeEvenings();
    const nov1 = await staff(winter("2026-11-01T06:30"));
    await setEmail(nov1, "manager@example.com");
    srv.mailFails(true);
    await poll(nov1, winter("2026-11-01T07:00"));
    let log = (await nov1.get("/api/qr/admin/report.php")).body.mails;
    assert.deepEqual(log.map((m) => [m.status, m.error]), [["failed", "test: the mail server refused"]]);
    srv.mailFails(false);
    await poll(nov1, winter("2026-11-01T07:30"));
    assert.equal(srv.mails().length, 0, "not again within the hour");
    await poll(nov1, winter("2026-11-01T08:01"));
    assert.equal(srv.mails().length, 1);

    const at = winter("2026-11-01T08:10");
    assert.equal((await sendNow(nov1, "2026-10", at)).status, 200);
    assert.equal(srv.mails().length, 2, "sent again on request");
    const empty = await sendNow(nov1, "2026-11", at);
    assert.deepEqual([empty.status, empty.body.error], [409, "empty"], "November has no orders yet");
    for (const month of ["2026-12", "2026-13", "October", ""]) {
      assert.equal((await sendNow(nov1, month, at)).status, 400, month);
    }
    srv.mailFails(true);
    const refused = await sendNow(nov1, "2026-10", at);
    assert.deepEqual([refused.status, refused.body.error, refused.body.detail], [502, "send_failed", "test: the mail server refused"]);
    srv.mailFails(false);
    assert.equal((await sendNow(nov1, "2026-10", at)).status, 200);
    assert.equal((await sendNow(nov1, "2026-10", at)).status, 200);
    assert.equal((await sendNow(nov1, "2026-10", at)).status, 429, "at most five an hour by hand");
    log = (await nov1.get("/api/qr/admin/report.php")).body.mails;
    assert.equal(log.length, 7);
  });

  it("a month sent by hand before it is over does not stop the real one", async () => {
    await threeEvenings();
    const oct20 = await staff(at("2026-10-20T12:00"));
    await setEmail(oct20, "manager@example.com");
    assert.equal((await sendNow(oct20, "2026-10", at("2026-10-20T12:00"))).status, 200);
    assert.equal(srv.mails()[0].subject, "RAYA Garden · Поръчки от масата — октомври 2026 (до 20 октомври)");
    const nov1 = await staff(winter("2026-11-01T07:00"));
    await poll(nov1, winter("2026-11-01T07:00"));
    assert.deepEqual(srv.mails().map((m) => m.subject), [
      "RAYA Garden · Поръчки от масата — октомври 2026 (до 20 октомври)",
      "RAYA Garden · Поръчки от масата — октомври 2026",
    ]);
  });

  it("the address is checked, and only staff set it", async () => {
    srv.reset();
    const admin = await evening(SAT, "on_site", { fresh: true });
    for (const email of ["not an address", "a@b", "x".repeat(115) + "@b.bg", 5, "a@b.bg\r\nBcc: c@d.bg"]) {
      assert.equal((await setEmail(admin, email)).status, 400, String(email));
    }
    assert.equal((await sendNow(admin, "2026-09", at("2026-10-03T19:00"))).body.error, "no_email");
    assert.equal((await setEmail(admin, "manager@example.com")).status, 200);
    assert.equal((await setEmail(admin, "")).body.email, "", "an empty address stops the e-mails");
    const guest = client(srv.base);
    assert.equal((await guest.get("/api/qr/admin/report.php")).status, 401);
    assert.equal((await guest.post("/api/qr/admin/report.php", { email: "x@y.bg" })).status, 401);
    assert.equal((await admin.post("/api/qr/admin/report.php", { email: "x@y.bg" })).status, 403, "changes need the staff header");
  });
});
