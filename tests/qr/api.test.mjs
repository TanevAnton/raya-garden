// The QR ordering API against a real PHP server and a real SQLite database.
// Run: npm run test:qr
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";

// Saturday 3 October 2026 is summer time in Sofia (UTC+3).
const EVENING = { date: "2026-10-03", opens: "18:00", closes: "01:00" };
const AT_20H = sofia("2026-10-03T20:00", 3);

let srv;
let menu;
before(async () => {
  srv = await startServer();
  menu = srv.menu();
});
after(() => srv.stop());

/** Fresh database, a signed-in admin, and the evening set up. */
async function setUp({ tables = 12, disabledTables = [], window = EVENING, now = AT_20H } = {}) {
  srv.reset();
  const admin = client(srv.base, { now });
  assert.equal((await admin.login()).status, 200);
  const res = await admin.admin("/api/qr/admin/settings.php", { ...window, tables, disabledTables, paused: false });
  assert.equal(res.status, 200, res.text);
  return admin;
}

const order = (c, table, lines, { key = newKey(), extra, at } = {}) =>
  c.post("/api/qr/order.php", orderBody(menu, table, lines, extra), { headers: { "Idempotency-Key": key }, at });

const countOrders = () => JSON.parse(srv.sqlite("SELECT COUNT(*) AS n FROM orders"))[0].n;

describe("ordering is closed until the evening is set up", () => {
  it("says so, and refuses orders", async () => {
    srv.reset();
    const guest = client(srv.base, { now: AT_20H });
    const state = await guest.get("/api/qr/state.php");
    assert.equal(state.body.open, false);
    assert.equal(state.body.reason, "not_configured");
    const res = await order(guest, 1, [["tiramisu"]]);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "closed");
    assert.equal(countOrders(), 0);
  });
});

describe("the ordering window", () => {
  it("18:00–01:00: 23:50 and 00:40 are the same evening, 17:59 and 01:05 are not", async () => {
    await setUp();
    const guest = client(srv.base);
    const at = (iso) => ({ at: sofia(iso, 3) });
    assert.equal((await order(guest, 1, [["tiramisu"]], at("2026-10-03T17:59"))).body.error, "closed");
    assert.equal((await order(guest, 1, [["tiramisu"]], at("2026-10-03T23:50"))).status, 201);
    assert.equal((await order(guest, 2, [["tiramisu"]], at("2026-10-04T00:40"))).status, 201);
    const late = await order(guest, 3, [["tiramisu"]], at("2026-10-04T01:05"));
    assert.equal(late.status, 409);
    assert.equal(late.body.state.reason, "closed");
    assert.equal(countOrders(), 2);
  });

  it("across the autumn clock change (25 Oct 2026, 04:00 → 03:00): 22:00–06:00 is nine real hours", async () => {
    const admin = await setUp({ window: { date: "2026-10-24", opens: "22:00", closes: "06:00" }, now: sofia("2026-10-24T21:00", 3) });
    const state = (await admin.get("/api/qr/state.php")).body;
    assert.equal(state.opensAt, sofia("2026-10-24T22:00", 3));
    assert.equal(state.closesAt, sofia("2026-10-25T06:00", 2));
    assert.equal(state.closesAt - state.opensAt, 9 * 3600);
    const guest = client(srv.base);
    assert.equal((await order(guest, 1, [["tiramisu"]], { at: sofia("2026-10-25T05:30", 2) })).status, 201);
    assert.equal((await order(guest, 2, [["tiramisu"]], { at: sofia("2026-10-25T06:05", 2) })).body.error, "closed");
  });

  it("across the spring clock change (29 Mar 2026, 03:00 → 04:00): 22:00–06:00 is seven real hours", async () => {
    const admin = await setUp({ window: { date: "2026-03-28", opens: "22:00", closes: "06:00" }, now: sofia("2026-03-28T21:00", 2) });
    const state = (await admin.get("/api/qr/state.php")).body;
    assert.equal(state.closesAt - state.opensAt, 7 * 3600);
    const guest = client(srv.base);
    assert.equal((await order(guest, 1, [["tiramisu"]], { at: sofia("2026-03-29T05:30", 3) })).status, 201);
    assert.equal((await order(guest, 2, [["tiramisu"]], { at: sofia("2026-03-29T06:05", 3) })).body.error, "closed");
  });

  it("rejects an impossible window", async () => {
    const admin = await setUp();
    for (const window of [
      { date: "2026-02-30", opens: "18:00", closes: "23:00" },
      { date: "2026-10-03", opens: "25:00", closes: "23:00" },
      { date: "03.10.2026", opens: "18:00", closes: "23:00" },
    ]) {
      const res = await admin.admin("/api/qr/admin/settings.php", window);
      assert.equal(res.status, 400, JSON.stringify(window));
      assert.equal(res.body.field, "window");
    }
  });
});

describe("tables", () => {
  it("accepts 1–N, refuses anything else, and disabled tables", async () => {
    await setUp({ tables: 12, disabledTables: [7] });
    const guest = client(srv.base, { now: AT_20H });
    assert.equal((await order(guest, 1, [["tiramisu"]])).status, 201);
    assert.equal((await order(guest, 12, [["tiramisu"]])).status, 201);
    for (const table of [13, 7, 0, -1]) {
      const res = await order(guest, table, [["tiramisu"]]);
      assert.equal(res.status, 409, `table ${table}`);
      assert.equal(res.body.error, "table_invalid");
    }
    for (const table of ["3", 2.5, null]) {
      const res = await order(guest, 1, [["tiramisu"]], { extra: { table } });
      assert.equal(res.status, 400, `table ${JSON.stringify(table)}`);
      assert.equal(res.body.field, "table");
    }
    assert.equal(countOrders(), 2);
  });
});

describe("the menu is the only source of truth", () => {
  it("an item sold out while it sat in the cart: 409 with the line, then a resubmit without it goes through", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    assert.equal((await admin.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: true })).status, 200);
    const res = await order(guest, 4, [["tiramisu", "std", 2], ["illy-coffee", "std", 2]]);
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "changed");
    assert.deepEqual(res.body.soldOut, [{ line: 0, itemId: "tiramisu" }]);
    assert.equal(countOrders(), 0);
    const again = await order(guest, 4, [["illy-coffee", "std", 2]]);
    assert.equal(again.status, 201);
    assert.equal(again.body.order.total, 500);
    const state = (await guest.get("/api/qr/state.php")).body;
    assert.deepEqual(state.soldOut, ["tiramisu"]);
  });

  it("a price the phone showed that is not the menu's: 409 with old and new, nothing stored", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const body = orderBody(menu, 2, [["caesar", "chicken", 1]]);
    body.lines[0].price = 890;
    body.expectedTotal = 890;
    const res = await guest.post("/api/qr/order.php", body, { headers: { "Idempotency-Key": newKey() } });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body.priceChanged, [{ line: 0, itemId: "caesar", variantId: "chicken", was: 890, now: 990 }]);
    assert.equal(res.body.total, 990);
    assert.equal(countOrders(), 0);
  });

  it("a total that does not add up is refused too", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const res = await order(guest, 2, [["tiramisu"]], { extra: { expectedTotal: 1 } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error, "changed");
    assert.equal(res.body.total, 590);
  });

  it("per-100 g items, unknown items and wrong choices are 'removed'", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const cases = [
      [["wagyu-striploin"]],
      [["no-such-dish"]],
      [["caesar", "no-such-size"]],
      [["coca-cola-products", "std", 1, ""]],
      [["coca-cola-products", "std", 1, "pepsi"]],
      [["tiramisu", "std", 1, "orange"]],
    ];
    for (const lines of cases) {
      const res = await order(guest, 1, lines);
      assert.equal(res.status, 409, JSON.stringify(lines));
      assert.equal(res.body.removed.length, 1, JSON.stringify(lines));
    }
    assert.equal((await order(guest, 1, [["coca-cola-products", "std", 2, "sprite"]])).status, 201);
    assert.equal(countOrders(), 1);
  });

  it("every 50 ml spirit also comes as 100 ml, at twice the price", async () => {
    await setUp();
    const spirits = ["rakia", "vodka", "gin", "aniseed", "whisky", "cognac", "digestive", "rum"];
    const items = menu.categories.filter((c) => spirits.includes(c.id)).flatMap((c) => c.items);
    const fifty = items.filter((i) => i.variants.some((v) => v.size === "50 ml"));
    assert.ok(fifty.length >= 40, `${fifty.length} spirits`);
    for (const item of fifty) {
      const [small, large] = item.variants;
      assert.deepEqual([small.size, large.size, large.price], ["50 ml", "100 ml", small.price * 2], item.id);
    }
    const guest = client(srv.base, { now: AT_20H });
    const res = await order(guest, 2, [["burgas-63", "100ml", 2], ["burgas-63", "std", 1]]);
    assert.equal(res.status, 201, res.text);
    const [large, small] = res.body.order.lines;
    assert.deepEqual([large.detailBg, large.size, large.price], ["100 мл", "100 ml", 620]);
    assert.deepEqual([small.detailBg, small.price], ["50 мл", 310]);
    assert.equal(res.body.order.total, 2 * 620 + 310);
  });

  it("Coca-Cola products: the guest picks the drink", async () => {
    await setUp();
    const cola = menu.categories.flatMap((c) => c.items).find((i) => i.id === "coca-cola-products");
    assert.deepEqual(cola.choices.options.map((o) => o.bg), ["Coca-Cola", "Coca-Cola Zero", "Coca-Cola без кофеин", "Fanta", "Sprite", "Тоник", "Розов тоник"]);
    const guest = client(srv.base, { now: AT_20H });
    const res = await order(guest, 2, [["coca-cola-products", "std", 1, "coca-cola-no-caffeine"], ["coca-cola-products", "std", 2, "pink-tonic"]]);
    assert.equal(res.status, 201, res.text);
    assert.deepEqual(res.body.order.lines.map((l) => l.detailBg), ["Coca-Cola без кофеин", "Розов тоник"]);
  });

  it("changing a price later never changes an order already placed", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const placed = await order(guest, 5, [["caesar", "chicken", 2]]);
    assert.equal(placed.status, 201);
    const edited = srv.menu();
    edited.categories.find((c) => c.id === "salads").items.find((i) => i.id === "caesar").variants[0].price = 1090;
    srv.writeMenu(edited);
    try {
      const feed = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
      const kept = feed.orders.find((o) => o.code === placed.body.order.code);
      assert.equal(kept.total, 1980);
      assert.equal(kept.lines[0].price, 990);
      const stale = await order(guest, 6, [["caesar", "chicken", 1]]);
      assert.equal(stale.status, 409);
      assert.equal(stale.body.priceChanged[0].now, 1090);
    } finally {
      srv.writeMenu(menu);
    }
  });
});

describe("request validation", () => {
  it("refuses malformed orders with 400 and stores nothing", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const lines50 = Array.from({ length: 51 }, () => ["tiramisu"]);
    assert.equal((await order(guest, 1, [["tiramisu", "std", 0]])).status, 400);
    assert.equal((await order(guest, 1, [["tiramisu", "std", 21]])).status, 400);
    assert.equal((await order(guest, 1, [["tiramisu", "std", 1.5]])).status, 400);
    assert.equal((await order(guest, 1, lines50)).status, 400);
    assert.equal((await order(guest, 1, [["tiramisu", "std", 1, "", "x".repeat(201)]])).body.field, "note");
    assert.equal((await order(guest, 1, [])).status, 400);
    assert.equal((await order(guest, 1, [["tiramisu"]], { extra: { website: "http://spam" } })).status, 400);
    assert.equal((await order(guest, 1, [["tiramisu"]], { key: "short" })).body.field, "idempotency_key");
    assert.equal((await guest.post("/api/qr/order.php", "{not json", { headers: { "Idempotency-Key": newKey() } })).status, 400);
    assert.equal((await guest.get("/api/qr/order.php")).status, 405);
    assert.equal(countOrders(), 0);
  });

  it("keeps a note's words but strips control and invisible characters", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const res = await order(guest, 1, [["tiramisu", "std", 1, "", "  без\u0000 захар​\n моля  "]]);
    assert.equal(res.status, 201);
    assert.equal(res.body.order.lines[0].note, "без захар моля");
  });
});

describe("idempotency", () => {
  it("the same attempt twice is one order, with the same code and token", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const key = newKey();
    const first = await order(guest, 3, [["tiramisu"]], { key });
    const second = await order(guest, 3, [["tiramisu"]], { key });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.order.code, first.body.order.code);
    assert.equal(second.body.token, first.body.token);
    assert.equal(countOrders(), 1);
  });

  it("the same key with a different cart is refused", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const key = newKey();
    assert.equal((await order(guest, 3, [["tiramisu"]], { key })).status, 201);
    const other = await order(guest, 3, [["tiramisu", "std", 2]], { key });
    assert.equal(other.status, 409);
    assert.equal(other.body.error, "idempotency_conflict");
    assert.equal(countOrders(), 1);
  });

  it("eight simultaneous retries of one attempt make exactly one order", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 8 }, () => order(guest, 9, [["tiramisu"], ["illy-coffee"]], { key })));
    const codes = new Set(results.map((r) => r.body.order.code));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
    assert.equal(codes.size, 1);
    assert.equal(countOrders(), 1);
  });

  it("a retry that arrives after ordering closed still gets its order back", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const key = newKey();
    const first = await order(guest, 3, [["tiramisu"]], { key });
    await admin.admin("/api/qr/admin/settings.php", { paused: true });
    const retry = await order(guest, 3, [["tiramisu"]], { key });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.order.code, first.body.order.code);
  });
});

describe("many guests at once", () => {
  it("12 tables ordering at the same moment: 12 orders, none lost or doubled, totals right", async () => {
    await setUp({ tables: 12 });
    const guest = client(srv.base, { now: AT_20H });
    const lines = (t) => [["caesar", t % 2 ? "chicken" : "shrimps", 1 + (t % 3)], ["homemade-lemonade", "1000ml", 1]];
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => order(guest, i + 1, lines(i + 1))));
    assert.deepEqual(results.map((r) => r.status), Array(12).fill(201));
    const rows = JSON.parse(srv.sqlite("SELECT table_no, total_cents, code, seq FROM orders ORDER BY table_no"));
    assert.equal(rows.length, 12);
    for (const row of rows) {
      const t = row.table_no;
      const expected = (t % 2 ? 990 : 1090) * (1 + (t % 3)) + 690;
      assert.equal(row.total_cents, expected, `table ${t}`);
    }
    assert.equal(new Set(rows.map((r) => r.code)).size, 12);
    assert.equal(new Set(rows.map((r) => r.seq)).size, 12);
    assert.ok(rows.every((r) => /^R-[A-HJ-KM-NP-Z2-9]{4}$/.test(r.code)), "codes look like R-XXXX");
  });
});

describe("rate limits", () => {
  it("five orders per table per five minutes", async () => {
    await setUp();
    const guest = client(srv.base);
    for (let i = 0; i < 5; i++) assert.equal((await order(guest, 3, [["tiramisu"]], { at: AT_20H + i })).status, 201);
    const sixth = await order(guest, 3, [["tiramisu"]], { at: AT_20H + 10 });
    assert.equal(sixth.status, 429);
    assert.equal(sixth.body.scope, "table");
    assert.equal((await order(guest, 4, [["tiramisu"]], { at: AT_20H + 10 })).status, 201, "another table is unaffected");
    assert.equal((await order(guest, 3, [["tiramisu"]], { at: AT_20H + 400 })).status, 201, "and later it is fine again");
  });

  it("60 orders per network address per five minutes — a whole restaurant can share one Wi-Fi", async () => {
    await setUp({ tables: 100 });
    const guest = client(srv.base);
    for (let t = 1; t <= 60; t++) assert.equal((await order(guest, t, [["tiramisu"]], { at: AT_20H + t })).status, 201, `order ${t}`);
    const res = await order(guest, 61, [["tiramisu"]], { at: AT_20H + 61 });
    assert.equal(res.status, 429);
    assert.equal(res.body.scope, "network");
  });

  it("forgets the network address once the window has passed", async () => {
    await setUp();
    const guest = client(srv.base);
    await order(guest, 1, [["tiramisu"]], { at: AT_20H });
    await order(guest, 2, [["tiramisu"]], { at: AT_20H + 200 });
    await order(guest, 3, [["tiramisu"]], { at: AT_20H + 301 });
    const kept = JSON.parse(srv.sqlite("SELECT table_no, ip_hash FROM orders ORDER BY table_no")).map((r) => [r.table_no, r.ip_hash !== ""]);
    assert.deepEqual(kept, [[1, false], [2, true], [3, true]]);
  });
});

describe("the guest's name on an order", () => {
  it("is optional, cleaned, and shown to staff", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const named = await order(guest, 3, [["tiramisu"]], { extra: { name: "  Мария​ \n П. " } });
    assert.equal(named.status, 201, named.text);
    assert.equal(named.body.order.guestName, "Мария П.", "invisible characters and extra spaces go");
    const plain = await order(guest, 4, [["tiramisu"]]);
    assert.equal(plain.body.order.guestName, "");
    const feed = (await admin.get("/api/qr/admin/feed.php?since=0")).body.orders;
    assert.deepEqual(feed.map((o) => o.guestName).sort(), ["", "Мария П."]);
    const mine = (await guest.get(`/api/qr/order-status.php?t=${named.body.token}`)).body.orders[0];
    assert.equal(mine.guestName, "Мария П.");
    assert.equal(mine.payerName, undefined, "guests are not sent the payer field");
  });

  it("is refused when too long or not text", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const long = await order(guest, 3, [["tiramisu"]], { extra: { name: "М".repeat(41) } });
    assert.deepEqual([long.status, long.body.field], [400, "name"]);
    const odd = await order(guest, 3, [["tiramisu"]], { extra: { name: 7 } });
    assert.deepEqual([odd.status, odd.body.field], [400, "name"]);
    assert.equal((await order(guest, 3, [["tiramisu"]], { extra: { name: "М".repeat(40) } })).status, 201);
  });

  it("is erased three days later", async () => {
    await setUp();
    const named = await order(client(srv.base, { now: AT_20H }), 3, [["tiramisu"]], { extra: { name: "Мария" } });
    const later = sofia("2026-10-07T20:00", 3);
    const admin = client(srv.base, { now: later });
    assert.equal((await admin.login()).status, 200);
    await admin.admin("/api/qr/admin/settings.php", { date: "2026-10-07", opens: "18:00", closes: "23:00", tables: 12, disabledTables: [] });
    assert.equal((await order(client(srv.base, { now: later }), 5, [["tiramisu"]], { extra: { name: "Иван" } })).status, 201);
    const rows = JSON.parse(srv.sqlite("SELECT id, guest_name FROM orders ORDER BY id"));
    assert.deepEqual(rows.map((r) => r.guest_name), ["", "Иван"]);
    assert.equal(rows[0].id, named.body.order.id);
  });
});

describe("a guest's order page", () => {
  it("shows an order only to its own token; codes and guesses show nothing", async () => {
    await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const a = (await order(guest, 1, [["tiramisu"]])).body;
    const b = (await order(guest, 2, [["illy-coffee"]])).body;
    const read = async (t) => (await guest.get(`/api/qr/order-status.php?t=${encodeURIComponent(t)}`)).body.orders;
    assert.deepEqual((await read(a.token)).map((o) => o.code), [a.order.code]);
    assert.deepEqual((await read(b.token)).map((o) => o.code), [b.order.code]);
    assert.equal((await read(`${a.token},${b.token}`)).length, 2);
    assert.deepEqual(await read(a.order.code), []);
    assert.deepEqual(await read("0".repeat(64)), []);
    assert.deepEqual(await read(a.token.replace(/.$/, (c) => (c === "0" ? "1" : "0"))), []);
    const stored = JSON.parse(srv.sqlite("SELECT token_hash FROM orders"));
    assert.ok(stored.every((r) => r.token_hash !== a.token && r.token_hash !== b.token), "tokens are not stored as they are");
  });
});

describe("the admin API", () => {
  it("needs a signed-in session for everything", async () => {
    await setUp();
    const stranger = client(srv.base, { now: AT_20H });
    assert.equal((await stranger.get("/api/qr/admin/feed.php?since=0")).status, 401);
    assert.equal((await stranger.admin("/api/qr/admin/settings.php", { paused: true })).status, 401);
    assert.equal((await stranger.admin("/api/qr/admin/order.php", { id: 1, action: "accept", from: "new" })).status, 401);
    assert.equal((await stranger.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: true })).status, 401);
    assert.equal((await stranger.get("/api/qr/admin/session.php")).body.signedIn, false);
    const forged = client(srv.base, { now: AT_20H });
    const res = await fetch(`${srv.base}/api/qr/admin/feed.php?since=0`, {
      headers: { Cookie: `raya_qr_admin=${AT_20H + 3600}.${"a".repeat(64)}`, "X-Test-Now": String(AT_20H) },
    });
    assert.equal(res.status, 401, "a made-up cookie is refused");
    assert.equal((await forged.login("wrong")).status, 401);
  });

  it("changes need the X-Raya-Admin header and this site as Origin", async () => {
    const admin = await setUp();
    const noHeader = await admin.post("/api/qr/admin/settings.php", { paused: true });
    assert.equal(noHeader.status, 403);
    const foreign = await admin.admin("/api/qr/admin/settings.php", { paused: true }, { headers: { Origin: "https://evil.example" } });
    assert.equal(foreign.status, 403);
    const own = await admin.admin("/api/qr/admin/settings.php", { paused: true }, { headers: { Origin: srv.base } });
    assert.equal(own.status, 200);
  });

  it("an expired session is signed out", async () => {
    const admin = await setUp();
    assert.equal((await admin.get("/api/qr/admin/feed.php?since=0")).status, 200);
    assert.equal((await admin.get("/api/qr/admin/feed.php?since=0", { at: AT_20H + 17 * 3600 })).status, 401);
  });

  it("moves orders on: new → accepted → served; cancel needs a reason; nothing jumps or goes back", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const { order: o } = (await order(guest, 2, [["tiramisu"]])).body;
    const move = (action, from, reason) => admin.admin("/api/qr/admin/order.php", { id: o.id, action, from, ...(reason ? { reason } : {}) });
    assert.equal((await move("serve", "new")).status, 409, "cannot skip accepted");
    assert.equal((await move("accept", "new")).body.order.status, "accepted");
    assert.equal((await move("accept", "new")).body.error, "stale", "another tablet already accepted it");
    assert.equal((await move("cancel", "accepted")).status, 400, "cancel needs a reason");
    assert.equal((await move("serve", "accepted")).body.order.status, "served");
    assert.equal((await move("cancel", "served", "гостът си тръгна")).status, 409, "served is final");
    const { order: p } = (await order(guest, 3, [["tiramisu"]])).body;
    const cancelled = await admin.admin("/api/qr/admin/order.php", { id: p.id, action: "cancel", from: "new", reason: "Грешна маса" });
    assert.equal(cancelled.body.order.status, "cancelled");
    assert.equal(cancelled.body.order.cancelReason, "Грешна маса");
    const events = JSON.parse(srv.sqlite("SELECT to_status FROM order_events ORDER BY id")).map((e) => e.to_status);
    assert.deepEqual(events, ["new", "accepted", "served", "new", "cancelled"]);
  });

  it("the feed recovers everything that happened while a tablet was offline", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const first = (await admin.get("/api/qr/admin/feed.php?since=0")).body;
    assert.equal(first.full, true);
    let seq = first.seq;
    // The tablet goes offline; three orders arrive and one is accepted elsewhere.
    const placed = [];
    for (const t of [1, 2, 3]) placed.push((await order(guest, t, [["tiramisu"]])).body.order);
    await admin.admin("/api/qr/admin/order.php", { id: placed[0].id, action: "accept", from: "new" });
    const back = (await admin.get(`/api/qr/admin/feed.php?since=${seq}`)).body;
    assert.deepEqual(back.orders.map((o) => o.code).sort(), placed.map((o) => o.code).sort());
    assert.equal(back.orders.find((o) => o.id === placed[0].id).status, "accepted");
    assert.ok(back.seq > seq);
    seq = back.seq;
    assert.deepEqual((await admin.get(`/api/qr/admin/feed.php?since=${seq}`)).body.orders, [], "nothing new twice");
    // Only a status change this time — it must reach the tablet as well.
    await admin.admin("/api/qr/admin/order.php", { id: placed[1].id, action: "accept", from: "new" });
    const moved = (await admin.get(`/api/qr/admin/feed.php?since=${seq}`)).body;
    assert.deepEqual(moved.orders.map((o) => [o.id, o.status]), [[placed[1].id, "accepted"]]);
    // And a sold-out change moves the counter on, so other tablets refresh it.
    await admin.admin("/api/qr/admin/sold-out.php", { itemId: "tiramisu", soldOut: true });
    const soldOut = (await admin.get(`/api/qr/admin/feed.php?since=${moved.seq}`)).body;
    assert.ok(soldOut.seq > moved.seq);
    assert.deepEqual(soldOut.soldOut, ["tiramisu"]);
  });

  it("pausing stops new orders at once but never the orders already in", async () => {
    const admin = await setUp();
    const guest = client(srv.base, { now: AT_20H });
    const { order: o } = (await order(guest, 2, [["tiramisu"]])).body;
    await admin.admin("/api/qr/admin/settings.php", { paused: true });
    const refused = await order(guest, 3, [["tiramisu"]]);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.state.reason, "paused");
    assert.equal((await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "accept", from: "new" })).status, 200);
    await admin.admin("/api/qr/admin/settings.php", { paused: false });
    assert.equal((await order(guest, 3, [["tiramisu"]])).status, 201);
  });

  it("stops listening after ten wrong passwords from one address", async () => {
    srv.reset();
    const someone = client(srv.base, { now: AT_20H });
    for (let i = 0; i < 10; i++) assert.equal((await someone.login(`guess-${i}`)).status, 401);
    assert.equal((await someone.login()).status, 429, "even the right password waits");
    assert.equal((await someone.login(undefined, { at: AT_20H + 901 })).status, 200, "and 15 minutes later it works");
  });
});

describe("kitchen and bar", () => {
  const priceOf = (id, variant = "std") => menu.categories.flatMap((c) => c.items).find((i) => i.id === id).variants.find((v) => v.id === variant).price;
  const move = (admin, o, action, station, from, extra = {}) => admin.admin("/api/qr/admin/order.php", { id: o.id, action, station, from, ...extra });
  const status = async (token) => (await client(srv.base, { now: AT_20H }).get(`/api/qr/order-status.php?t=${token}`)).body.orders[0];
  /** A Caesar salad and two Sprites at table 4: food and drinks. */
  async function mixed() {
    const res = await order(client(srv.base, { now: AT_20H }), 4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 2, "sprite"]]);
    assert.equal(res.status, 201, res.text);
    return res.body;
  }

  it("every category says where it is made: food to the kitchen, drinks to the bar", async () => {
    await setUp();
    const station = Object.fromEntries(menu.categories.map((c) => [c.id, c.station]));
    assert.deepEqual([station.salads, station.desserts, station["bbq-mains"]], ["kitchen", "kitchen", "kitchen"]);
    assert.deepEqual([station["hot-drinks"], station["soft-drinks"], station.wines, station.rakia, station.beer], ["bar", "bar", "bar", "bar", "bar"]);
    assert.ok(menu.categories.every((c) => c.station === "kitchen" || c.station === "bar"));
    const { order: o } = await mixed();
    assert.deepEqual(o.lines.map((l) => l.station), ["kitchen", "bar"]);
    assert.deepEqual(o.stations, { kitchen: "new", bar: "new" });
    const drinks = (await order(client(srv.base, { now: AT_20H }), 5, [["illy-coffee"]])).body.order;
    assert.deepEqual(drinks.stations, { kitchen: "", bar: "new" }, "nothing for the kitchen");
  });

  it("each station takes and serves its own part; the guest sees the order as a whole", async () => {
    const admin = await setUp();
    const { order: o, token } = await mixed();
    let res = await move(admin, o, "accept", "kitchen", "new");
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.order.stations, res.body.order.status], [{ kitchen: "accepted", bar: "new" }, "accepted"]);
    assert.equal((await status(token)).status, "accepted", "taken on, as far as the guest is concerned");
    assert.equal((await move(admin, o, "accept", "kitchen", "new")).status, 409, "another tablet was first");

    await move(admin, o, "accept", "bar", "new");
    res = await move(admin, o, "serve", "bar", "accepted");
    assert.deepEqual([res.body.order.stations, res.body.order.status], [{ kitchen: "accepted", bar: "served" }, "accepted"], "drinks out, food still coming");
    res = await move(admin, o, "serve", "kitchen", "accepted");
    assert.deepEqual([res.body.order.stations, res.body.order.status], [{ kitchen: "served", bar: "served" }, "served"]);
    assert.equal((await status(token)).status, "served");
    assert.equal((await move(admin, o, "accept", "pantry", "new")).status, 400);
  });

  it("cancelling at the bar takes off only the drinks; the kitchen carries on", async () => {
    const admin = await setUp();
    const { order: o, token } = await mixed();
    const res = await move(admin, o, "cancel", "bar", "new", { reason: "Няма Sprite" });
    assert.equal(res.status, 200, res.text);
    const after = res.body.order;
    assert.deepEqual([after.status, after.stations], ["new", { kitchen: "new", bar: "cancelled" }]);
    assert.equal(after.total, o.total - 2 * priceOf("coca-cola-products"));
    assert.deepEqual([after.lines[1].qty, after.lines[1].voidQty, after.lines[1].voidReason], [0, 2, "Няма Sprite"]);
    const mine = await status(token);
    assert.equal(mine.status, "new");
    assert.equal(mine.lines[1].voidReason, "Няма Sprite", "the guest sees why");

    // Now the kitchen is all there is: cancelling there is the whole order.
    const whole = await move(admin, o, "cancel", "kitchen", "new", { reason: "Кухнята затвори" });
    assert.equal(whole.status, 200, whole.text);
    assert.deepEqual([whole.body.order.status, whole.body.order.cancelReason, whole.body.order.stations.kitchen], ["cancelled", "Кухнята затвори", "cancelled"]);
  });

  it("a station whose lines all came off is done, and the order follows the other", async () => {
    const admin = await setUp();
    const { order: o } = await mixed();
    await move(admin, o, "accept", "kitchen", "new");
    await move(admin, o, "serve", "kitchen", "accepted");
    await move(admin, o, "accept", "bar", "new");
    const v = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "void", line: 1, qty: 2, have: 2, reason: "Изчерпан продукт" });
    assert.equal(v.status, 200, v.text);
    assert.deepEqual([v.body.order.stations, v.body.order.status], [{ kitchen: "served", bar: "cancelled" }, "served"], "nothing left to wait for");
  });

  it("a screen without stations still moves the whole order, every station with it", async () => {
    const admin = await setUp();
    const { order: o } = await mixed();
    const res = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "accept", from: "new" });
    assert.deepEqual([res.body.order.status, res.body.order.stations], ["accepted", { kitchen: "accepted", bar: "accepted" }]);
    const served = await admin.admin("/api/qr/admin/order.php", { id: o.id, action: "serve", from: "accepted" });
    assert.deepEqual(served.body.order.stations, { kitchen: "served", bar: "served" });
  });
});

describe("the kitchen and the bar close at different times", () => {
  const SPLIT = { date: "2026-10-03", opens: "18:00", kitchenCloses: "22:00", barCloses: "01:00" };
  const state = async (iso) => (await client(srv.base, { now: sofia(iso, 3) }).get("/api/qr/state.php")).body;
  const at = (iso) => ({ at: sofia(iso, 3) });

  it("after the kitchen closes, drinks can still be ordered and food cannot", async () => {
    await setUp({ window: SPLIT });
    const early = await state("2026-10-03T20:00");
    assert.deepEqual([early.open, early.stations.kitchen.open, early.stations.bar.open], [true, true, true]);
    assert.deepEqual([early.stations.kitchen.closes, early.stations.bar.closes, early.closes], ["22:00", "01:00", "01:00"], "the evening ends with the bar");

    const late = await state("2026-10-03T22:30");
    assert.deepEqual([late.open, late.stations.kitchen.open, late.stations.bar.open], [true, false, true]);
    const guest = client(srv.base);
    const mixed = await order(guest, 4, [["caesar", "chicken", 1], ["coca-cola-products", "std", 1, "sprite"]], at("2026-10-03T22:30"));
    assert.equal(mixed.status, 409);
    assert.equal(mixed.body.error, "changed");
    assert.deepEqual(mixed.body.stationClosed, [{ line: 0, itemId: "caesar", station: "kitchen" }], "the salad, not the drink");
    assert.equal(countOrders(), 0, "nothing placed: the guest sees what changed first");
    const drinks = await order(guest, 4, [["coca-cola-products", "std", 1, "sprite"]], at("2026-10-03T22:30"));
    assert.equal(drinks.status, 201, drinks.text);
    assert.equal(drinks.body.order.evening, "2026-10-03");

    assert.equal((await state("2026-10-04T01:05")).open, false, "after the bar, all closed");
  });

  it("the bar can close first too; one closing time alone is both", async () => {
    await setUp({ window: { date: "2026-10-03", opens: "18:00", kitchenCloses: "23:00", barCloses: "21:00" } });
    const s = await state("2026-10-03T22:00");
    assert.deepEqual([s.stations.kitchen.open, s.stations.bar.open, s.closes], [true, false, "23:00"]);
    const res = await order(client(srv.base), 4, [["tiramisu"], ["illy-coffee"]], at("2026-10-03T22:00"));
    assert.deepEqual(res.body.stationClosed.map((l) => l.station), ["bar"]);

    await setUp();
    const one = await state("2026-10-03T20:00");
    assert.deepEqual([one.stations.kitchen.closes, one.stations.bar.closes], ["01:00", "01:00"]);
  });

  it("a closing time that makes no sense is refused", async () => {
    const admin = await setUp();
    const res = await admin.admin("/api/qr/admin/settings.php", { date: "2026-10-03", opens: "18:00", kitchenCloses: "25:00", barCloses: "01:00" });
    assert.equal(res.status, 400);
    assert.deepEqual([res.body.field, res.body.station], ["window", "kitchen"]);
  });
});

describe("waiters", () => {
  const save = (admin, tables) => admin.admin("/api/qr/admin/waiters.php", { tables });
  const feed = async (admin) => (await admin.get("/api/qr/admin/feed.php?since=0")).body;

  it("each table can have a waiter for the evening, shown with its orders", async () => {
    const admin = await setUp();
    const res = await save(admin, { 3: "Иван", 4: "Иван", 7: "  Мария\u0000 " });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(res.body.waiters, { 3: "Иван", 4: "Иван", 7: "Мария" });
    assert.equal(res.body.evening, "2026-10-03");
    await order(client(srv.base, { now: AT_20H }), 3, [["tiramisu"]]);
    const f = await feed(admin);
    assert.deepEqual(f.waiters, { 3: "Иван", 4: "Иван", 7: "Мария" });
    assert.equal(f.orders[0].evening, f.state.serviceDate, "tonight's order: tonight's waiter applies");

    // The whole list each time: what is left out has no waiter.
    assert.deepEqual((await save(admin, { 3: "Мария" })).body.waiters, { 3: "Мария" });
    assert.deepEqual((await save(admin, {})).body.waiters, {});
  });

  it("names and tables are checked", async () => {
    const admin = await setUp();
    for (const tables of [{ 0: "Иван" }, { 301: "Иван" }, { 3: "" }, { 3: "x".repeat(31) }, { 3: 5 }, { abc: "Иван" }, "Иван"]) {
      assert.equal((await save(admin, tables)).status, 400, JSON.stringify(tables));
    }
    const guest = client(srv.base, { now: AT_20H });
    assert.equal((await guest.post("/api/qr/admin/waiters.php", { tables: { 3: "Иван" } })).status, 401, "staff only");
  });

  it("a new evening starts with no waiters", async () => {
    const admin = await setUp();
    await save(admin, { 3: "Иван" });
    const nextDay = sofia("2026-10-04T17:00", 3);
    const tomorrow = client(srv.base, { now: nextDay });
    assert.equal((await tomorrow.login()).status, 200);
    assert.equal((await tomorrow.admin("/api/qr/admin/settings.php", { date: "2026-10-04", opens: "18:00", closes: "23:00" })).status, 200);
    assert.deepEqual((await feed(tomorrow)).waiters, {});
  });
});

describe("without a configured password", () => {
  it("the admin cannot be signed into at all", async () => {
    const bare = await startServer({ withPassword: false });
    try {
      const c = client(bare.base);
      assert.equal((await c.login("anything")).status, 503);
      assert.equal((await c.get("/api/qr/admin/session.php")).body.configured, false);
    } finally {
      bare.stop();
    }
  });
});
