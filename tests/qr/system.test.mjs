// Phase 4 of registering the QR system as СУПТО: the QR code as a menu only on
// pay-staff evenings, the registered version without test mode (Annex 29
// т. 20), the code checked against its manifest (т. 4), menu changes logged
// (т. 15, 18.9), and „Система“ for the manager and the auditor (т. 19).
// Run: npm run test:qr
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);

let srv;
let menu;
before(async () => {
  // The live settings: no orders paid to staff.
  srv = await startServer({ staffOrders: false, stripe: { key: "rk_test_system", webhookSecret: "whsec_test_system", api: "http://127.0.0.1:9", publicUrl: "https://rayagarden.bg" } });
  menu = srv.menu();
});
after(() => srv.stop());

const qr = () => path.join(srv.root, "api", "qr");
const manifest = () => execFileSync("node", ["scripts/qr-manifest.mjs", qr()], { encoding: "utf8" });
const log = (where) => JSON.parse(srv.sqlite(`SELECT kind, ref, detail, operator FROM audit_log WHERE ${where} ORDER BY id`));

/** A manager (0001) and an auditor (0002), the evening set up. */
async function setUp(paymentMode = "on_site") {
  srv.reset();
  const shared = client(srv.base, { now: AT_20H });
  await shared.login();
  await shared.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Мария", lastName: "Петрова", password: "manager-pass-1", role: "manager" });
  const boss = client(srv.base, { now: AT_20H });
  assert.equal((await boss.post("/api/qr/admin/login.php", { code: "0001", password: "manager-pass-1" })).status, 200);
  await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Елена", lastName: "Димитрова", password: "auditor-pass-1", role: "auditor" });
  const res = await boss.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false, paymentMode });
  assert.equal(res.status, 200, res.text);
  const auditor = client(srv.base, { now: AT_20H });
  await auditor.post("/api/qr/admin/login.php", { code: "0002", password: "auditor-pass-1" });
  return { boss, auditor };
}

describe("orders paid to staff are off: the QR code is the menu only", () => {
  it("on a pay-staff evening the menu says to order with the waiter, and refuses orders", async () => {
    await setUp("on_site");
    const state = (await client(srv.base, { now: AT_20H }).get("/api/qr/state.php")).body;
    assert.deepEqual([state.open, state.reason, state.staffOrders], [false, "menu_only", false]);
    const res = await client(srv.base, { now: AT_20H }).post("/api/qr/order.php", orderBody(menu, 3, [["tiramisu"]]), { headers: { "Idempotency-Key": newKey() } });
    assert.deepEqual([res.status, res.body.error], [409, "closed"]);
  });

  it("paying on the phone, ordering is open", async () => {
    await setUp("online");
    assert.equal((await client(srv.base, { now: AT_20H }).get("/api/qr/state.php")).body.open, true);
  });
});

describe("the registered version has no test mode (Annex 29 т. 20)", () => {
  it("Stripe's test keys don't count, test printing is off, and the test clock is ignored", async () => {
    await setUp("online");
    srv.config({ supto: "on", fiscal_mode: "test", fiscal_bridge_token: "k".repeat(40) });
    try {
      const state = (await client(srv.base, { now: AT_20H }).get("/api/qr/state.php")).body;
      assert.equal(state.paymentsConfigured, false, "test keys refused");
      assert.equal(state.payment, "on_site");
      assert.equal(state.supto, true);
      assert.ok(Math.abs(state.now - Date.now() / 1000) < 60, "X-Test-Now is ignored: the real time");
      const boss = client(srv.base);
      await boss.post("/api/qr/admin/login.php", { code: "0001", password: "manager-pass-1" });
      const sys = (await boss.get("/api/qr/admin/system.php")).body;
      assert.deepEqual([sys.features.registered, sys.features.stripe, sys.features.fiscal], [true, "off", "off"]);
    } finally {
      srv.config({ supto: null, fiscal_mode: null, fiscal_bridge_token: null });
    }
  });
});

describe("the code against its manifest (Annex 29 т. 4)", () => {
  it("a version starts and is logged; a file changed or added is found, logged and shown; put right, it says so", async () => {
    const { boss, auditor } = await setUp("online");
    const sys = async () => (await auditor.get("/api/qr/admin/system.php?check=1")).body;
    assert.equal((await sys()).integrity.status, "no_manifest", "a development copy has none");

    manifest();
    let s = await sys();
    assert.deepEqual([s.integrity.status, s.integrity.version, s.software.version], ["ok", s.software.version, s.software.version]);
    assert.equal(log("kind = 'version_start'").length, 1);

    const file = path.join(qr(), "state.php");
    const original = readFileSync(file);
    try {
      appendFileSync(file, "\n");
      writeFileSync(path.join(qr(), "extra.php"), "<?php\n");
      s = await sys();
      assert.equal(s.integrity.status, "changed");
      assert.match(s.integrity.detail, /changed state\.php/);
      assert.match(s.integrity.detail, /added extra\.php/);
      assert.equal(log("kind = 'integrity_failed'")[0].operator, "9000");
      const feed = (await boss.get("/api/qr/admin/feed.php?since=0")).body;
      assert.equal(feed.integrity.status, "changed", "the staff screen shows it");
    } finally {
      writeFileSync(file, original);
      rmSync(path.join(qr(), "extra.php"), { force: true });
    }
    assert.equal((await sys()).integrity.status, "ok");
    assert.equal(log("kind = 'integrity_ok'").length, 2, "confirmed when the manifest first came, and again once put right");
    rmSync(path.join(qr(), "_manifest.json"));
  });

  it("„Система“ is for the manager and the auditor, never shows a secret", async () => {
    const { auditor } = await setUp();
    const res = await auditor.get("/api/qr/admin/system.php");
    assert.equal(res.status, 200);
    assert.ok(!/rk_test_system|whsec_test_system|\$2y\$/.test(res.text), "no keys, no password hash");
    assert.equal(res.body.fiscalSettings.vat_rates[2], 20);
  });
});

describe("menu changes are logged, item by item (Annex 29 т. 15, 18.9)", () => {
  it("loaded once; then a new item, a price change and a removed item, each with its date", async () => {
    const { auditor } = await setUp();
    await auditor.get("/api/qr/admin/system.php?check=1");
    assert.equal(log("kind = 'menu_loaded'").length, 1);
    const original = srv.menu();
    const edited = structuredClone(original);
    const cat = edited.categories[0];
    const changed = cat.items[0];
    changed.variants[0].price += 50;
    const removed = cat.items.splice(1, 1)[0];
    cat.items.push({ ...structuredClone(changed), id: "test-new-item", bg: "Ново ястие", en: "New dish" });
    try {
      srv.writeMenu(edited);
      await auditor.get("/api/qr/admin/system.php?check=1");
      const changes = log("kind LIKE 'menu_item_%'").map((r) => [r.kind, r.ref.split("/")[0]]);
      assert.ok(changes.some(([k, id]) => k === "menu_item_change" && id === changed.id));
      assert.ok(changes.some(([k, id]) => k === "menu_item_removed" && id === removed.id));
      assert.ok(changes.some(([k, id]) => k === "menu_item_new" && id === "test-new-item"));
      const items = (await auditor.get(`/api/qr/admin/nap.php?table=nom_items&from=2026-10-01&to=2026-10-31`)).body;
      const row = items.rows.find((r) => r[0].split("/")[0] === removed.id);
      assert.notEqual(row[6], "", "the removed item has its date of deactivation");
    } finally {
      srv.writeMenu(original);
    }
  });
});
