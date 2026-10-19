#!/usr/bin/env node
// The fiscal bridge: runs on a small computer in the restaurant, next to the
// fiscal printer kept for phone payments, in front of ErpNet.FP (the open
// fiscal-printer server, https://github.com/erpnet/ErpNet.FP).
//
// Every few seconds it asks rayagarden.bg for the next receipt
// (/api/qr/fiscal/claim.php), prints it through ErpNet.FP, and says what
// happened (/api/qr/fiscal/report.php). Nothing has to be open on the
// restaurant's side: only outgoing connections.
//
// Exactly once on paper — a second fiscal receipt can only be undone by a
// storno:
//   1. before printing, it tells the server the receipt is being sent, with
//      its task id and УНП;
//   2. it prints through ErpNet.FP's idempotent, asynchronous printing (our
//      task id), and writes down in its own journal (journal.json) that it
//      did — before and after;
//   3. it waits for the printer's answer, keeps it in the journal, and only
//      then reports it. ErpNet.FP forgets a task's answer after a restart or
//      once it has been read, so the journal is what survives;
//   4. a receipt that comes back already sent is first looked up — in the
//      journal, then in ErpNet.FP — and never simply printed again. If no one
//      can tell whether it printed, it is reported as 'check', for a person
//      to look at the printer.
//
// Settings, in the environment or in config.json next to this file:
//   RAYA_SERVER      https://rayagarden.bg
//   RAYA_BRIDGE_KEY  the key, the same as QR_FISCAL_BRIDGE_TOKEN on the server
//   ERPNET_URL       http://localhost:8001 (ErpNet.FP)
//   PRINTER_ID       ErpNet.FP's printer id; the first printer found if empty
//   JOURNAL          the journal's path (default: journal.json next to this file)
//
//   node bridge.mjs          run
//   node bridge.mjs --once   one round, for a check by hand
//
// Node 18 or newer; nothing to install.

import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const VERSION = "1.0.0";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The settings: environment first, then config.json. */
export function loadConfig(env = process.env) {
  const file = path.join(HERE, "config.json");
  const json = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const pick = (k) => (env[k] ?? json[k] ?? "").toString().trim();
  return {
    server: pick("RAYA_SERVER").replace(/\/+$/, "") || "https://rayagarden.bg",
    key: pick("RAYA_BRIDGE_KEY"),
    erpnet: pick("ERPNET_URL").replace(/\/+$/, "") || "http://localhost:8001",
    printerId: pick("PRINTER_ID"),
    journal: pick("JOURNAL") || path.join(HERE, "journal.json"),
  };
}

/** The journal: what was sent to the printer, and what it answered. Written whole, then renamed over the old one. */
class Journal {
  constructor(file) {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  }
  get(taskId) {
    return this.data[taskId];
  }
  set(taskId, entry) {
    this.data[taskId] = { ...this.data[taskId], ...entry, at: Date.now() };
    // Keep a fortnight.
    for (const [k, v] of Object.entries(this.data)) if (v.at < Date.now() - 14 * 864e5) delete this.data[k];
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 1));
    renameSync(`${this.file}.tmp`, this.file);
  }
}

/**
 * A bridge: step() does one round. config as loadConfig gives it, plus for
 * tests: waitMs (how long to wait for the printer), headers (extra request
 * headers to the server); options.fetch replaces fetch.
 */
export function createBridge(config, { log = console.log, fetch = globalThis.fetch } = {}) {
  const journal = new Journal(config.journal);
  const waitMs = config.waitMs ?? 90000;
  let printer = null; // ErpNet.FP's device info

  async function server(pathname, body) {
    const res = await fetch(`${config.server}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Raya-Bridge-Key": config.key, ...(config.headers || {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("the server refused the bridge's key (RAYA_BRIDGE_KEY)");
    return { status: res.status, body: json };
  }

  async function erpnet(pathname, { method = "GET", body, timeout = 15000 } = {}) {
    const res = await fetch(`${config.erpnet}${pathname}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) throw new Error(`ErpNet.FP ${method} ${pathname}: HTTP ${res.status}`);
    return res.json();
  }

  /** The printer, and whether it is ready: sent to the server with every request for work. */
  async function printerState() {
    try {
      if (!printer) {
        let id = config.printerId;
        if (!id) id = Object.keys(await erpnet("/printers"))[0];
        if (!id) return { ok: false, message: "ErpNet.FP sees no fiscal printer" };
        printer = { id, ...(await erpnet(`/printers/${id}`)) };
      }
      const status = await erpnet(`/printers/${printer.id}/status`);
      const problems = (status.messages || []).filter((m) => m.type === "error").map((m) => `${m.code || ""} ${m.text}`.trim());
      return { id: printer.id, serialNumber: printer.serialNumber, ok: truthy(status.ok) && !problems.length, message: problems.join("; ") };
    } catch (e) {
      printer = null;
      return { ok: false, message: `ErpNet.FP: ${e.message}` };
    }
  }

  const truthy = (v) => v === true || v === "true";
  const errorsOf = (result) =>
    (result.messages || []).filter((m) => m.type === "error").map((m) => `${m.code || ""} ${m.text}`.trim()).join("; ") || "the printer refused the receipt";

  /** The printer's answer to a task, from ErpNet.FP: a result, 'pending', or 'unknown'. Waits while it prints. */
  async function waitForTask(taskId, maxMs = waitMs) {
    const until = Date.now() + maxMs;
    for (;;) {
      const info = await erpnet(`/printers/taskinfo?id=${encodeURIComponent(taskId)}`);
      if (info.taskStatus === "finished") return info.result || {};
      if (info.taskStatus === "unknown") return "unknown";
      if (Date.now() > until) return "pending";
      await sleep(500);
    }
  }

  /** Tell the server what the printer answered, from the journal. */
  async function reportResult(job, result) {
    if (truthy(result.ok) && result.receiptNumber) {
      const res = await server("/api/qr/fiscal/report.php", {
        id: job.id,
        event: "printed",
        receiptNumber: String(result.receiptNumber),
        receiptDateTime: String(result.receiptDateTime || ""),
        fiscalMemorySerialNumber: String(result.fiscalMemorySerialNumber || ""),
        receiptAmount: result.receiptAmount,
      });
      if (res.status !== 200) throw new Error(`the server did not take receipt ${result.receiptNumber}: HTTP ${res.status}`);
      log(`${job.code}: receipt ${result.receiptNumber}`);
      return;
    }
    // Refused by the printer: nothing was printed (ErpNet.FP voids it), so it can go again.
    await server("/api/qr/fiscal/report.php", { id: job.id, event: "failed", error: errorsOf(result) });
    log(`${job.code}: refused — ${errorsOf(result)}`);
  }

  /** One receipt, from claim to report. */
  async function handle(job) {
    const entry = journal.get(job.taskId);
    // 1. Already answered: report it (again), print nothing.
    if (entry?.result) return reportResult(job, entry.result);
    // 2. Sent before: find out what happened to it.
    if (job.submitted || entry?.sent) {
      let result;
      try {
        result = await waitForTask(job.taskId);
      } catch (e) {
        // ErpNet.FP not reachable now: the job comes back after its lease.
        log(`${job.code}: ErpNet.FP did not answer about ${job.taskId}: ${e.message}`);
        return;
      }
      if (result === "pending") return; // still printing: next time
      if (result !== "unknown") {
        journal.set(job.taskId, { result });
        return reportResult(job, result);
      }
      if (entry?.sent) {
        await server("/api/qr/fiscal/report.php", {
          id: job.id,
          event: "check",
          error: `sent to the printer as ${job.taskId}, but ErpNet.FP no longer knows the answer: check whether a receipt for ${job.code} printed`,
        });
        log(`${job.code}: unknown whether it printed — left for a person to check`);
        return;
      }
      // The server knew it as sent, but it never reached ErpNet.FP from here: send it.
    }
    // 3. Send it.
    if (!printer?.serialNumber) throw new Error("no printer serial number yet");
    const usn = job.usn || `${printer.serialNumber}-${job.operatorCode}-${String(job.usnSequence).padStart(7, "0")}`;
    const said = await server("/api/qr/fiscal/report.php", { id: job.id, event: "submitted", taskId: job.taskId, usn });
    if (said.status !== 200) throw new Error(`the server did not take ${job.code} as sent: HTTP ${said.status} ${said.body?.error || ""}`);
    const max = printer.itemTextMaxLength || 22;
    const maxComment = printer.commentTextMaxLength || 40;
    const receipt = {
      ...job.receipt,
      uniqueSaleNumber: usn,
      items: job.receipt.items.map((it) =>
        it.type === "comment" ? { ...it, text: it.text.slice(0, maxComment) } : { ...it, text: it.text.slice(0, max) },
      ),
    };
    const kind = job.kind === "storno" ? "reversalreceipt" : "receipt";
    // Written down as (maybe) sent before it goes: if this program dies while
    // sending, the next round asks instead of printing it again.
    journal.set(job.taskId, { id: job.id, code: job.code, sent: true });
    try {
      await erpnet(`/printers/${printer.id}/${kind}?asyncTimeout=0&taskId=${encodeURIComponent(job.taskId)}`, { method: "POST", body: receipt });
    } catch (e) {
      // Refused before it reached ErpNet.FP: nothing printed, it can go again.
      if (e.cause?.code === "ECONNREFUSED") {
        journal.set(job.taskId, { sent: false });
        await server("/api/qr/fiscal/report.php", { id: job.id, event: "failed", error: `ErpNet.FP is not running (${config.erpnet})` });
        return;
      }
      // Anything else: it may have reached ErpNet.FP. Asked about next time.
      throw e;
    }
    const result = await waitForTask(job.taskId);
    if (result === "pending" || result === "unknown") return; // looked up next time it comes round
    journal.set(job.taskId, { result });
    return reportResult(job, result);
  }

  /** One round: the printer's state, the next receipt, and when to ask again. */
  async function step() {
    const state = await printerState();
    const claim = await server("/api/qr/fiscal/claim.php", { version: VERSION, printer: state });
    if (claim.status !== 200) throw new Error(`claim: HTTP ${claim.status} ${claim.body?.error || ""}`);
    const job = claim.body.job;
    if (job) {
      if (!state.ok && !job.submitted) {
        // The printer is not ready: leave it; it comes back after its lease.
        log(`${job.code}: waiting — ${state.message || "the printer is not ready"}`);
        return 5000;
      }
      await handle(job);
    }
    return claim.body.pollMs ?? 3000;
  }

  return { step, journal };
}

// ── run ──────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const config = loadConfig();
  if (config.key.length < 32) {
    console.error("RAYA_BRIDGE_KEY is missing or too short (see README.md).");
    process.exit(1);
  }
  const bridge = createBridge(config);
  console.log(`fiscal bridge ${VERSION}: ${config.server} ⇄ ${config.erpnet}`);
  for (;;) {
    let wait = 3000;
    try {
      wait = await bridge.step();
    } catch (e) {
      console.error(new Date().toISOString(), e.message);
      wait = 10000;
    }
    if (process.argv.includes("--once")) break;
    await sleep(wait);
  }
}
