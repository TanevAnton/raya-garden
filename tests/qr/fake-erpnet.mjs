// A fake ErpNet.FP (https://github.com/erpnet/ErpNet.FP, PROTOCOL.md) with one
// Datecs printer, for the fiscal bridge's tests: printers, status, receipts
// and reversal receipts, asynchronous and idempotent by task id (asyncTimeout=0
// &taskId=…), and task info that is forgotten once read or on a restart — as
// the real one does. The "paper" is every receipt actually printed.
import http from "node:http";
import net from "node:net";
import { sofiaLocal, parseSofia } from "../../tools/fiscal-bridge/bridge.mjs";

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export const PRINTER = {
  id: "dt279013",
  serialNumber: "DT279013",
  fiscalMemorySerialNumber: "02279013",
  manufacturer: "Datecs",
  model: "FP-700X",
  itemTextMaxLength: 22,
  commentTextMaxLength: 40,
  supportedPaymentTypes: ["cash", "card"],
};

export async function startFakeErpNet() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const paper = []; // what came out of the printer: { kind, body, receiptNumber, … }
  const tasks = new Map(); // taskId → { status, result }
  const posts = []; // every print request, with its task id
  const reports = []; // Z and X reports, duplicates: { kind, taskId }
  let number = 0;
  let failNext = null; // { code, text }
  let hold = false; // tasks stay queued until release()
  const held = [];
  let statusOk = true;
  let clockOffset = 0; // ms the printer's clock is ahead
  let clockRefuses = false; // setting the time is refused (as some printers do before the Z report)
  const clockSets = []; // every time the bridge set the clock

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  function run(taskId, kind, body) {
    const task = tasks.get(taskId);
    if (failNext) {
      const { code, text } = failNext;
      failNext = null;
      task.status = "finished";
      task.result = { ok: "false", messages: [{ type: "error", code, text }] };
      return;
    }
    const amount = Math.round(body.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const printed = {
      taskId,
      kind,
      body,
      receiptNumber: String(++number).padStart(7, "0"),
      receiptDateTime: new Date().toISOString().slice(0, 19),
      receiptAmount: amount,
      fiscalMemorySerialNumber: PRINTER.fiscalMemorySerialNumber,
    };
    paper.push(printed);
    task.status = "finished";
    task.result = { ok: "true", messages: [], ...Object.fromEntries(Object.entries(printed).filter(([k]) => !["taskId", "kind", "body"].includes(k))) };
  }

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, base);
    if (req.method === "GET" && url.pathname === "/printers") return json(res, 200, { [PRINTER.id]: PRINTER });
    if (req.method === "GET" && url.pathname === "/printers/taskinfo") {
      const id = url.searchParams.get("id");
      const task = tasks.get(id);
      if (!task) return json(res, 200, { taskStatus: "unknown" });
      if (task.status === "finished") {
        tasks.delete(id); // read once, then forgotten
        return json(res, 200, { taskStatus: "finished", result: task.result });
      }
      return json(res, 200, { taskStatus: task.status });
    }
    if (req.method === "GET" && url.pathname === `/printers/${PRINTER.id}`) return json(res, 200, PRINTER);
    if (req.method === "GET" && url.pathname === `/printers/${PRINTER.id}/status`) {
      return json(res, 200, statusOk
        ? { ok: "true", deviceDateTime: sofiaLocal(Date.now() + clockOffset), messages: [] }
        : { ok: "false", messages: [{ type: "error", code: "E302", text: "The paper cover is open" }] });
    }
    if (req.method === "POST" && url.pathname === `/printers/${PRINTER.id}/datetime`) {
      const { deviceDateTime } = JSON.parse(raw);
      if (clockRefuses) return json(res, 200, { ok: "false", messages: [{ type: "error", code: "E405", text: "Date and time can be set only after a Z report" }] });
      clockSets.push(deviceDateTime);
      clockOffset = parseSofia(deviceDateTime) - Date.now();
      return json(res, 200, { ok: "true", messages: [] });
    }
    const report = url.pathname.match(new RegExp(`^/printers/${PRINTER.id}/(zreport|xreport|duplicate)$`));
    if (req.method === "POST" && report) {
      const taskId = url.searchParams.get("taskId");
      posts.push({ kind: report[1], taskId, body: raw ? JSON.parse(raw) : {} });
      if (!tasks.has(taskId) && !reports.some((r) => r.taskId === taskId)) {
        reports.push({ kind: report[1], taskId });
        tasks.set(taskId, { status: "finished", result: { ok: "true", messages: [] } });
      }
      return json(res, 200, { taskId });
    }
    const print = url.pathname.match(new RegExp(`^/printers/${PRINTER.id}/(receipt|reversalreceipt)$`));
    if (req.method === "POST" && print) {
      const taskId = url.searchParams.get("taskId");
      const body = JSON.parse(raw);
      posts.push({ kind: print[1], taskId, body });
      if (!taskId || url.searchParams.get("asyncTimeout") !== "0") return json(res, 400, { error: "the bridge always prints async, with a task id" });
      // Idempotent: a task id seen before is not printed again.
      if (!tasks.has(taskId) && !paper.some((p) => p.taskId === taskId)) {
        tasks.set(taskId, { status: "enqueued" });
        if (hold) held.push([taskId, print[1], body]);
        else run(taskId, print[1], body);
      }
      return json(res, 200, { taskId });
    }
    return json(res, 404, { error: `no fake for ${req.method} ${url.pathname}` });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  return {
    base,
    paper,
    posts,
    reports,
    /** The next receipt is refused by the printer (nothing printed). */
    failNext: (code = "E201", text = "The fiscal memory is full") => (failNext = { code, text }),
    /** Tasks wait in the queue until release(). */
    hold: () => (hold = true),
    release: () => {
      hold = false;
      for (const [taskId, kind, body] of held.splice(0)) run(taskId, kind, body);
    },
    /** ErpNet.FP restarted: every task's information is gone (what printed stays printed). */
    restart: () => tasks.clear(),
    setStatusOk: (ok) => (statusOk = ok),
    clockSets,
    /** The printer's clock runs this many seconds ahead (negative: behind). */
    setClock: (seconds) => (clockOffset = seconds * 1000),
    refuseClock: (refuse) => (clockRefuses = refuse),
    reset: () => {
      paper.length = 0;
      posts.length = 0;
      reports.length = 0;
      tasks.clear();
      held.length = 0;
      number = 0;
      failNext = null;
      hold = false;
      statusOk = true;
      clockOffset = 0;
      clockRefuses = false;
      clockSets.length = 0;
    },
    stop: () => new Promise((r) => server.close(r)),
  };
}
