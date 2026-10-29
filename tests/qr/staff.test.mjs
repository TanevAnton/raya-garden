// Staff accounts (_lib/staff.php, _lib/auth.php): a personal code and
// password for each person, roles with their periods, the shared password
// only until the first manager exists, and every action in the operations
// log with its operator. Run: npm run test:qr
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";

const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);

let srv;
let menu;
before(async () => {
  srv = await startServer();
  menu = srv.menu();
});
after(() => srv.stop());

const as = (code, password, now = AT_20H) => {
  const c = client(srv.base, { now });
  c.signIn = () => c.post("/api/qr/admin/login.php", { code, password });
  return c;
};
const log = (where = "1") => JSON.parse(srv.sqlite(`SELECT kind, ref, detail, operator, operator_name FROM audit_log WHERE ${where} ORDER BY id`));

/** Fresh database; the shared password makes the first manager, who signs in. */
async function setUp() {
  srv.reset();
  const shared = client(srv.base, { now: AT_20H });
  assert.equal((await shared.login()).status, 200);
  const made = await shared.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Мария", middleName: "Иванова", lastName: "Петрова", password: "manager-pass-1", role: "manager" });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.body.done.code, "0001");
  const boss = as("0001", "manager-pass-1");
  assert.equal((await boss.signIn()).status, 200);
  return { shared, boss };
}

describe("staff accounts", () => {
  it("the shared password only works until the first manager exists, and its sessions end then", async () => {
    srv.reset();
    const fresh = await client(srv.base, { now: AT_20H }).get("/api/qr/admin/session.php");
    assert.equal(fresh.body.bootstrap, true);
    const { shared, boss } = await setUp();
    assert.equal((await shared.get("/api/qr/admin/feed.php?since=0")).status, 401, "the shared session is over");
    const again = await client(srv.base, { now: AT_20H }).login();
    assert.equal(again.status, 403);
    assert.equal(again.body.error, "personal_required");
    const session = (await boss.get("/api/qr/admin/session.php")).body;
    assert.deepEqual([session.signedIn, session.bootstrap, session.operator.code, session.operator.name, session.operator.roles],
      [true, false, "0001", "Мария Иванова Петрова", ["manager"]]);
  });

  it("each person signs in with their own code and password; wrong ones are refused and logged", async () => {
    const { boss } = await setUp();
    const made = await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
    assert.equal(made.body.done.code, "0002");
    assert.equal((await as("0002", "wrong-password").signIn()).status, 401);
    assert.equal((await as("0009", "waiter-pass-1").signIn()).status, 401);
    const ivan = as("0002", "waiter-pass-1");
    const res = await ivan.signIn();
    assert.equal(res.status, 200);
    assert.equal(res.body.operator.name, "Иван Георгиев");
    assert.deepEqual(log("kind LIKE 'login%'").map((l) => [l.kind, l.ref, l.operator]), [
      ["login", "9002", "9002"],
      ["login", "0001", "0001"],
      ["login_failed", "0002", "9000"],
      ["login_failed", "0009", "9000"],
      ["login", "0002", "0002"],
    ]);
    await ivan.admin("/api/qr/admin/logout.php", {});
    assert.deepEqual(log("kind = 'logout'").map((l) => [l.operator, l.operator_name]), [["0002", "Иван Георгиев"]]);
  });

  it("needs two names, a password of 8 characters, a free code; codes from 9000 up are not for people", async () => {
    const { boss } = await setUp();
    const create = (extra) => boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter", ...extra });
    assert.equal((await create({ lastName: "" })).body.field, "lastName");
    assert.equal((await create({ password: "short" })).body.error, "weak_password");
    assert.equal((await create({ code: "9001" })).body.field, "code");
    assert.equal((await create({ role: "owner" })).body.field, "role");
    assert.equal((await create({ code: "0001" })).body.error, "code_taken");
    assert.equal((await create({ code: "0042" })).body.done.code, "0042");
  });

  it("roles: a waiter serves but can't set up the evening or manage people; the auditor only reads", async () => {
    const { boss } = await setUp();
    await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
    await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Елена", lastName: "Димитрова", password: "auditor-pass-1", role: "auditor" });
    assert.equal((await boss.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false })).status, 200);

    const ivan = as("0002", "waiter-pass-1");
    await ivan.signIn();
    assert.equal((await ivan.admin("/api/qr/admin/settings.php", { tables: 20 })).body.error, "manager_only");
    assert.equal((await ivan.admin("/api/qr/admin/settings.php", { paused: true })).status, 200, "pausing is for anyone on the service");
    assert.equal((await ivan.get("/api/qr/admin/staff.php")).status, 403);
    assert.equal((await ivan.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: true })).status, 200);

    const elena = as("0003", "auditor-pass-1");
    await elena.signIn();
    assert.equal((await elena.get("/api/qr/admin/feed.php?since=0")).status, 200);
    assert.equal((await elena.get("/api/qr/admin/staff.php")).body.staff.length, 3);
    assert.equal((await elena.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: false })).body.error, "read_only");
    assert.equal((await elena.admin("/api/qr/admin/staff.php", { action: "active", id: 2, active: false })).body.error, "manager_only");

    assert.deepEqual(log("kind IN ('settings', 'sold_out')").map((l) => [l.kind, l.operator]), [
      ["settings", "0001"],
      ["settings", "0002"],
      ["sold_out", "0002"],
    ]);
  });

  it("a role ends, a person is made inactive, a password changes: each signs them out, and nothing is deleted", async () => {
    const { boss } = await setUp();
    await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
    const ivan = as("0002", "waiter-pass-1");
    await ivan.signIn();

    await boss.admin("/api/qr/admin/staff.php", { action: "password", id: 2, password: "waiter-pass-2" });
    assert.equal((await ivan.get("/api/qr/admin/feed.php?since=0")).status, 401);
    const ivan2 = as("0002", "waiter-pass-2");
    assert.equal((await ivan2.signIn()).status, 200);

    const list = (await boss.get("/api/qr/admin/staff.php")).body.staff;
    const roleId = list.find((p) => p.code === "0002").roles[0].id;
    await boss.admin("/api/qr/admin/staff.php", { action: "endRole", roleId });
    assert.equal((await ivan2.get("/api/qr/admin/feed.php?since=0")).status, 401);
    assert.equal((await ivan2.signIn()).body.error, "inactive");

    await boss.admin("/api/qr/admin/staff.php", { action: "addRole", id: 2, role: "waiter" });
    assert.equal((await ivan2.signIn()).status, 200);
    await boss.admin("/api/qr/admin/staff.php", { action: "active", id: 2, active: false });
    assert.equal((await ivan2.get("/api/qr/admin/feed.php?since=0")).status, 401);

    const roles = JSON.parse(srv.sqlite("SELECT role, to_at FROM staff_roles WHERE staff_id = 2 ORDER BY id"));
    assert.deepEqual(roles.map((r) => [r.role, r.to_at > 0]), [["waiter", true], ["waiter", false]], "the ended role is kept, with its end");
    assert.throws(() => srv.sqlite("DELETE FROM staff"), /never deleted/);
    assert.deepEqual(log("kind IN ('staff_new', 'staff_change', 'role_new', 'role_change') AND ref = '0002'").map((l) => [l.kind, l.operator]), [
      ["staff_new", "0001"],
      ["role_new", "0001"],
      ["staff_change", "0001"],
      ["role_change", "0001"],
      ["role_new", "0001"],
      ["staff_change", "0001"],
    ]);
  });

  it("the last manager can't be made inactive or lose the role", async () => {
    const { boss } = await setUp();
    const list = (await boss.get("/api/qr/admin/staff.php")).body.staff;
    assert.equal((await boss.admin("/api/qr/admin/staff.php", { action: "active", id: 1, active: false })).body.error, "last_manager");
    assert.equal((await boss.admin("/api/qr/admin/staff.php", { action: "endRole", roleId: list[0].roles[0].id })).body.error, "last_manager");
  });

  it("every action carries its operator: the guest's order, the waiter's cancellation", async () => {
    const { boss } = await setUp();
    await boss.admin("/api/qr/admin/settings.php", { ...EVENING, tables: 12, disabledTables: [], paused: false });
    await boss.admin("/api/qr/admin/staff.php", { action: "create", firstName: "Иван", lastName: "Георгиев", password: "waiter-pass-1", role: "waiter" });
    const ivan = as("0002", "waiter-pass-1");
    await ivan.signIn();
    const placed = await client(srv.base, { now: AT_20H }).post("/api/qr/order.php", orderBody(menu, 3, [["tiramisu"]]), { headers: { "Idempotency-Key": newKey() } });
    assert.equal(placed.status, 201, placed.text);
    const res = await ivan.admin("/api/qr/admin/order.php", { id: placed.body.order.id, action: "cancel", from: "new", reason: "Грешна маса" });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(log("kind IN ('order', 'line', 'order_change')").map((l) => [l.kind, l.operator, l.operator_name]), [
      ["order", "9001", "QR гост"],
      ["line", "9001", "QR гост"],
      ["order_change", "0002", "Иван Георгиев"],
    ]);
  });
});
