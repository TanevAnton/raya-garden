// НАП's tables (Annex 29 т. 18, _lib/nap.php) and the operations log on
// screen (т. 16, admin/audit.php): a real PHP server, fake Stripe, fake
// ErpNet.FP and the real bridge, as in fiscal.test.mjs. Run: npm run test:qr
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeErpNet, PRINTER } from "./fake-erpnet.mjs";
import { createBridge } from "../../tools/fiscal-bridge/bridge.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);
const WEBHOOK_SECRET = "whsec_test_nap";
const KEY = "test-bridge-key-0123456789abcdef0123456789";
// The evening, up to today: audit_log's times are the database's own clock
// (real time), while the server's clock here says 3 October.
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
const DAY = `from=2026-10-03&to=${TODAY}`;

let srv;
let stripe;
let printer;
let menu;
let price;
let work;
before(async () => {
  stripe = await startFakeStripe({ webhookSecret: WEBHOOK_SECRET });
  printer = await startFakeErpNet();
  srv = await startServer({ stripe: { key: "rk_test_nap", webhookSecret: WEBHOOK_SECRET, api: stripe.base, publicUrl: "https://rayagarden.bg" } });
  stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
  menu = srv.menu();
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
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
  srv.config({ fiscal_mode: "test", fiscal_bridge_token: KEY });
  work = mkdtempSync(path.join(tmpdir(), "raya-nap-"));
});

const bridge = () => createBridge({ server: srv.base, key: KEY, erpnet: printer.base, printerId: "", journal: path.join(work, "journal.json"), waitMs: 1500 }, { log: () => {} });
async function drain() {
  const b = bridge();
  for (let i = 0; i < 10; i++) if ((await b.step()) > 0) return;
}
const as = async (code, password) => {
  const c = client(srv.base, { now: AT_20H });
  assert.equal((await c.post("/api/qr/admin/login.php", { code, password })).status, 200);
  return c;
};
const money = (cents) => (cents / 100).toFixed(2);
const vat = (gross) => Math.round((gross * 20) / 120);

/** A manager (0001), a waiter (0002), an auditor (0003); the evening, paying on the phone; the printer ready. */
async function setUp() {
  srv.reset();
  const shared = client(srv.base, { now: AT_20H });
  await shared.login();
  const make = (firstName, password, role) => shared.admin("/api/qr/admin/staff.php", { action: "create", firstName, lastName: "Тестова", password, role });
  await make("Мария", "manager-pass-1", "manager");
  const boss = await as("0001", "manager-pass-1");
  await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
  await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Елена", lastName: "Проверяваща", password: "auditor-pass-1", role: "auditor" });
  const res = await boss.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode: "online" });
  assert.equal(res.status, 200, res.text);
  await bridge().check();
  return { boss, waiter: await as("0002", "waiter-pass-1"), auditor: await as("0003", "auditor-pass-1") };
}
async function paid(table, lines) {
  const res = await client(srv.base, { now: AT_20H }).post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });
  assert.equal(res.status, 201, res.text);
  await stripe.pay(new URL(res.body.checkoutUrl).pathname.slice(5));
  await drain();
  return res.body.order;
}
const nap = async (c, table, q = DAY) => (await c.get(`/api/qr/admin/nap.php?table=${table}&${q}`)).body;
const col = (t, name) => t.columns.indexOf(name);

describe("НАП's tables (Annex 29 т. 18)", () => {
  it("a sale, its payment, its lines, a line taken off (cancelled and reversed), each where НАП expects it", async () => {
    const { boss, waiter, auditor } = await setUp();
    const T = price("tiramisu");
    const C = price("illy-coffee");
    const order = await paid(4, [["tiramisu", "std", 2], ["illy-coffee"]]);
    assert.equal((await waiter.admin("/api/qr/admin/order.php", { id: order.id, action: "void", line: 1, qty: 1, have: 1, reason: "Изчерпан продукт" })).status, 200);
    await drain();
    assert.deepEqual(printer.paper.map((p) => p.kind), ["receipt", "reversalreceipt"]);

    const sales = await nap(auditor, "18.1");
    assert.equal(sales.total, 1);
    const [s] = sales.rows;
    assert.equal(s[col(sales, "Уникален номер на продажба (УНП)")], order.usn);
    assert.equal(s[col(sales, "Системен номер на продажбата")], order.code);
    assert.equal(s[col(sales, "Код на оператор")], "9001");
    assert.equal(s[col(sales, "Дата на откриване")], "2026-10-03");
    assert.equal(s[col(sales, "Дължима сума (EUR)")], money(2 * T), "the coffee taken off is not owed");
    assert.equal(s[col(sales, "ДДС (EUR)")], money(vat(2 * T)));
    assert.equal(s[col(sales, "Обща сума без ДДС (EUR)")], money(2 * T - vat(2 * T)));

    const pays = await nap(auditor, "18.2");
    assert.deepEqual(pays.rows.map((r) => [r[0], r[col(pays, "Платена сума (EUR)")], r[col(pays, "Индивидуален номер на ФУ")], r[col(pays, "Код на оператор, регистрирал плащането")]]),
      [[order.usn, money(2 * T + C), PRINTER.serialNumber, "9001"]]);

    const lines = await nap(auditor, "18.3");
    assert.deepEqual(lines.rows.map((r) => [r[2], r[4], r[col(lines, "ДДС ставка")], r[col(lines, "Обща сума (EUR)")]]), [["tiramisu", "2", "20%", money(2 * T)]]);

    const storno = await nap(auditor, "18.4");
    assert.equal(storno.total, 1);
    assert.deepEqual([storno.rows[0][2], storno.rows[0][col(storno, "Обща сума (EUR)")], storno.rows[0][col(storno, "Код на оператор, извършил сторнирането")],
      storno.rows[0][col(storno, "Индивидуален номер на ФУ (сторно)")]], ["illy-coffee", money(C), "0002", PRINTER.serialNumber]);

    const annulled = await nap(boss, "18.5");
    assert.deepEqual(annulled.rows.map((r) => [r[0], r[2], r[4], r[col(annulled, "Код на оператор, извършил анулирането")]]), [[order.usn, "illy-coffee", "1", "0002"]]);

    // Filters: another operator, another printer — nothing.
    assert.equal((await nap(auditor, "18.4", `${DAY}&operator=0001`)).total, 0);
    assert.equal((await nap(auditor, "18.1", `${DAY}&fu=AB000000`)).total, 0);
    assert.equal((await nap(auditor, "18.1", "from=2026-10-04&to=2026-10-04")).total, 0);
  });

  it("a whole order cancelled after payment: every line in 18.5, the money reversed in 18.4", async () => {
    const { waiter, auditor } = await setUp();
    const order = await paid(5, [["tiramisu"], ["illy-coffee", "std", 2]]);
    const res = await waiter.admin("/api/qr/admin/order.php", { id: order.id, action: "cancel", from: "new", reason: "Гостът се отказа" });
    assert.equal(res.status, 200, res.text);
    await drain();
    assert.deepEqual((await nap(auditor, "18.5")).rows.map((r) => [r[2], r[4]]), [["tiramisu", "1"], ["illy-coffee", "2"]]);
    assert.equal((await nap(auditor, "18.4")).total, 2);
    const s = await nap(auditor, "18.1");
    assert.equal(s.rows[0][col(s, "Дължима сума (EUR)")], money(0));
    assert.equal((await nap(auditor, "18.3")).total, 0);
  });

  it("the nomenclatures: operators with their roles, roles and rights, operations, payment types, site, workplace, items", async () => {
    const { auditor } = await setUp();
    const ops = await nap(auditor, "nom_operators");
    assert.deepEqual(ops.rows.map((r) => r[0]), ["0001", "0002", "0003", "9000", "9001", "9002"]);
    assert.match(ops.rows[1][col(ops, "Роли и период на активност")], /^Сервитьор 2026-10-03–$/);
    assert.equal(ops.rows[1][1], "Иван Георгиев");
    assert.ok((await nap(auditor, "nom_roles")).rows.some((r) => r[0] === "auditor"));
    assert.ok((await nap(auditor, "nom_rights")).rows.length > 5);
    assert.ok((await nap(auditor, "nom_operations")).rows.some((r) => r[0] === "line_void"));
    assert.equal((await nap(auditor, "nom_payments")).rows.length, 2);
    assert.equal((await nap(auditor, "nom_workplaces")).rows[0][3], PRINTER.serialNumber);
    assert.ok((await nap(auditor, "nom_items")).rows.some((r) => r[0] === "tiramisu"));
  });

  it("as a spreadsheet, with НАП's column names; only for a manager or the auditor", async () => {
    const { waiter, auditor } = await setUp();
    await paid(4, [["tiramisu"]]);
    const csv = await auditor.get(`/api/qr/admin/nap.php?table=18.1&${DAY}&format=csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.text, /^﻿?Уникален номер на продажба \(УНП\);Системен номер на продажбата;Код на търговски обект/);
    assert.equal(csv.text.trim().split("\r\n").length, 2);
    assert.equal((await waiter.get(`/api/qr/admin/nap.php?table=18.1&${DAY}`)).status, 403);
    assert.equal((await auditor.get(`/api/qr/admin/nap.php?table=18.7&${DAY}`)).status, 400, "no deliveries or stock: no such tables");
  });
});

describe("the operations log on screen (Annex 29 т. 16)", () => {
  it("filters by period, operator and kind; pages back; names each kind", async () => {
    const { waiter, auditor } = await setUp();
    const order = await paid(4, [["tiramisu", "std", 2]]);
    await waiter.admin("/api/qr/admin/order.php", { id: order.id, action: "void", line: 0, qty: 1, have: 2, reason: "Изчерпан продукт" });
    const log = async (q) => (await auditor.get(`/api/qr/admin/audit.php?${DAY}&${q}`)).body;

    const byWaiter = await log("operator=0002");
    assert.ok(byWaiter.rows.length > 0 && byWaiter.rows.every((r) => r.operator === "0002"));
    assert.ok(byWaiter.rows.some((r) => r.kind === "login"));
    const voids = await log("kind=line_void");
    assert.deepEqual(voids.rows.map((r) => [r.kindName, r.operator, r.operatorName, r.ref]), [["Анулиране на ред", "0002", "Иван Георгиев", order.code]]);
    assert.ok(voids.kinds.some((k) => k.code === "staff_new"));
    assert.ok(voids.operators.some((o) => o.code === "9001" && o.name === "QR гост"));

    const all = await log("");
    const older = await log(`before=${all.rows[1].id}`);
    assert.equal(older.rows[0].id, all.rows[2].id, "newest first, pages back");
    assert.equal((await log("from=2026-10-04&to=2026-10-04")).rows.length, 0);
    assert.equal((await waiter.get(`/api/qr/admin/audit.php?${DAY}`)).status, 403);
  });
});
