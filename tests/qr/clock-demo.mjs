// The Clock certification demo: real code, real Clock sandbox (POS DEMO), simulated
// payments and printer, and a simulated clock so "the next morning" comes on request.
//
//   npm run qr:clock-demo            pauses for Enter between steps
//   npm run qr:clock-demo -- --go    runs straight through
//
// Credentials come from ~/.raya-clock-sandbox.env, outside the repository, and go to
// curl on stdin, so they are never printed. Each run leaves new closed folios in the
// sandbox. Everything else lives in a throwaway local server.
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, client, sofia, newKey, orderBody } from "./server.mjs";
import { startFakeStripe } from "./fake-stripe.mjs";
import { startFakeErpNet } from "./fake-erpnet.mjs";
import { createBridge } from "../../tools/fiscal-bridge/bridge.mjs";

const env = Object.fromEntries(readFileSync(`${process.env.HOME}/.raya-clock-sandbox.env`, "utf8").split("\n").filter((l) => /=/.test(l)).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i).replace(/^export\s+/, ""), l.slice(i + 1).replace(/^["']|["']$/g, "")];
}));
const base = env.CLOCK_BASE.replace(/\/\d+$/, "/16516");
const KEY = "demo-bridge-key-0123456789abcdef0123456789";
const AT = sofia("2026-11-03T20:00", 2);
const MORNING = sofia("2026-11-04T04:00", 2);
const LATER = sofia("2026-11-04T11:00", 2);
const NEXT = sofia("2026-11-05T04:00", 2);

const prompt = process.argv.includes("--go") ? null : createInterface({ input: process.stdin, output: process.stdout });
const step = async (text) => {
  console.log(`\n=== ${text}`);
  if (prompt) await prompt.question("    [Enter]");
};
const money = (cents) => (cents / 100).toFixed(2);
const clockGet = (p) => {
  const res = spawnSync("curl", ["-s", "-K", "-", "--digest", "-H", "Accept: application/json", `${base}/${p}`], { input: `user = "${env.CLOCK_USER}:${env.CLOCK_KEY}"\n`, encoding: "utf8" });
  return JSON.parse(res.stdout);
};
const showFolio = (id) => {
  const folio = clockGet(`folios/${id}`);
  console.log(`\n  Фолио ${folio.number} (id ${id}): ${money(folio.value.cents)} ${folio.value.currency}, нетно ${money(folio.net_value.cents)}, баланс ${money(folio.balance.cents)}, затворено: ${folio.closed_at ? "да" : "НЕ"}, вид документ: ${folio.document_type_id ?? "няма"}`);
  for (const c of clockGet(`folios/${id}/charges`)) console.log(`    ${String(c.qty).padStart(2)} × ${c.text}: ${money(c.value_cents)}, ДДС ${money(c.tax_value_cents)} (${c.tax_rate * 100}%), ревеню дата ${c.revenue_date}\n         ${c.print_text}`);
  for (const p of clockGet(`folios/${id}/credit_items`)) console.log(`    Плащане ${p.payment_type}: ${money(p.value_cents)}, „${p.text}“`);
};

const stripe = await startFakeStripe({ webhookSecret: "whsec_demo" });
const printer = await startFakeErpNet();
const srv = await startServer({ stripe: { key: "rk_test_demo", webhookSecret: "whsec_demo", api: stripe.base, publicUrl: "https://rayagarden.bg" }, clock: { api: base, clock_mode: "test", clock_base_url: base, clock_api_user: env.CLOCK_USER, clock_api_key: env.CLOCK_KEY, clock_company_id: 7200455, clock_currency: "BGN", fiscal_mode: "test", fiscal_bridge_token: KEY } });
stripe.setWebhook(`${srv.base}/api/qr/stripe-webhook.php`);
stripe.setNow(AT);
const work = mkdtempSync(path.join(tmpdir(), "raya-demo-"));
const bridge = (at) => createBridge({ server: srv.base, key: KEY, erpnet: printer.base, printerId: "", journal: path.join(work, "j.json"), waitMs: 1500, headers: { "X-Test-Now": String(at) } }, { log: () => {} });
const print = async (at) => { const b = bridge(at); for (let i = 0; i < 10; i++) if ((await b.step()) > 0) return; };
const docs = () => JSON.parse(srv.sqlite("SELECT id, kind, code, status, folio_id, total_cents, error FROM clock_docs ORDER BY id"));
const transfer = async (at) => {
  const staff = client(srv.base, { now: at });
  await staff.login();
  await staff.get("/api/qr/admin/feed.php?since=0");
  for (let i = 0; i < 300 && docs().some((d) => d.status === "sending"); i++) await new Promise((r) => setTimeout(r, 100));
  const bad = docs().filter((d) => d.error);
  if (bad.length) throw new Error(`Clock refused: ${JSON.stringify(bad)}`);
};
const menu = srv.menu();
const sell = async (table, lines) => {
  const res = await client(srv.base, { now: AT }).post("/api/qr/order.php", orderBody(menu, table, lines), { headers: { "Idempotency-Key": newKey() } });
  if (res.status !== 201) throw new Error(res.text);
  await stripe.pay(new URL(res.body.checkoutUrl).pathname.slice(5));
  await print(AT);
  return res.body.order;
};
const refund = async (at, id) => {
  const staff = client(srv.base, { now: at });
  await staff.login();
  const res = await staff.admin("/api/qr/admin/order.php", { id, action: "void", line: 1, qty: 1, have: 1, reason: "Изчерпан продукт" });
  if (res.status !== 200) throw new Error(res.text);
  await print(at);
};
const folioOf = (kind, code) => docs().find((d) => d.kind === kind && d.code === code).folio_id;

let failed = false;
try {
  srv.reset();
  const admin = client(srv.base, { now: AT });
  await admin.login();
  await admin.admin("/api/qr/admin/settings.php", { date: "2026-11-03", opens: "18:00", closes: "01:00", tables: 12, disabledTables: [], paused: false, paymentMode: "online" });
  await bridge(AT).check();

  await step("Вечерта: две платени сметки с бон от нашия принтер. Към Clock още не тръгва нищо.");
  const a = await sell(4, [["caesar", "chicken", 1], ["tiramisu"]]);
  const b = await sell(5, [["caesar", "chicken", 1], ["tiramisu"]]);
  console.log(`  Сметки ${a.code} и ${b.code}, по 15.80. Изпратени в Clock: ${docs().filter((d) => d.folio_id).length}`);

  await step(`Същата вечер: връщане на десерта от сметка ${b.code}.`);
  await refund(AT, b.id);
  console.log("  Сторно бон от нашия принтер. Към Clock пак не тръгва нищо.");

  await step("04:00 на следващата сутрин: трансферът. Всяка сметка е отделно фолио, с крайния резултат.");
  await transfer(MORNING);
  showFolio(folioOf("sale", a.code));
  showFolio(folioOf("sale", b.code));

  await step(`Същия ден, след трансфера: връщане на десерта от сметка ${a.code}.`);
  await refund(LATER, a.id);
  console.log("  Сторно бон от нашия принтер. Затвореното фолио не се пипа.");

  await step("04:00 на следващата сутрин: връщането отива като отделно фолио с отрицателна сума.");
  await transfer(NEXT);
  showFolio(folioOf("storno", a.code));
  console.log("\nГотово. Датите в Clock са реалните днешни: той определя ревеню датата при получаване.");
} catch (err) {
  failed = true;
  console.error(`\nГРЕШКА: ${err.message}`);
} finally {
  prompt?.close();
  srv.stop();
  await stripe.stop();
  await printer.stop();
}
process.exit(failed ? 1 : 0);
