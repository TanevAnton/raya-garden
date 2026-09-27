// Test harness for the QR ordering API: a real PHP server (several workers,
// so requests truly run in parallel) over a throwaway copy of public/api, a
// throwaway SQLite database and a test config with a known admin password.
//
// RAYA_QR_TEST=1 lets a request set the server's clock with an X-Test-Now
// header — the only way to test a service window across midnight or a
// daylight-saving change. Production never sets it.

import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";

export const ADMIN_PASSWORD = "correct horse battery staple";

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

export async function startServer({ docroot = "public", withPassword = true } = {}) {
  const work = mkdtempSync(path.join(tmpdir(), "raya-qr-"));
  const root = path.join(work, "www");
  cpSync(path.join(docroot, "api"), path.join(root, "api"), { recursive: true });
  // A built site (dist) also has the page itself; copy it when present.
  for (const extra of ["index.html", "menu", "admin", "assets", "img"]) {
    if (existsSync(path.join(docroot, extra))) cpSync(path.join(docroot, extra), path.join(root, extra), { recursive: true });
  }
  const config = path.join(work, "raya-qr-config.php");
  const hash = withPassword
    ? execFileSync("php", ["-r", `echo password_hash(${JSON.stringify(ADMIN_PASSWORD)}, PASSWORD_DEFAULT);`]).toString()
    : "";
  writeFileSync(config, `<?php return ${withPassword ? `['admin_password_hash' => '${hash}']` : "[]"};\n`);
  const port = await freePort();
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", root], {
    env: {
      ...process.env,
      RAYA_QR_TEST: "1",
      RAYA_QR_CONFIG: config,
      RAYA_QR_DATA_DIR: path.join(work, "data"),
      PHP_CLI_SERVER_WORKERS: "10",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  proc.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`${base}/api/qr/state.php`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const menuPath = path.join(root, "api", "qr-menu.json");
  return {
    base,
    root,
    log: () => log,
    menu: () => JSON.parse(readFileSync(menuPath, "utf8")),
    writeMenu: (menu) => writeFileSync(menuPath, JSON.stringify(menu)),
    reset: () => rmSync(path.join(work, "data"), { recursive: true, force: true }),
    sqlite: (sql) => execFileSync("php", ["-r", `
      $db = new PDO('sqlite:' . ${JSON.stringify(path.join(work, "data", "orders.sqlite"))});
      echo json_encode($db->query(${JSON.stringify(sql)})->fetchAll(PDO::FETCH_ASSOC));`]).toString(),
    stop: () => {
      proc.kill();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** A small client: JSON in and out, a cookie jar for the admin, a clock. */
export function client(base, { now } = {}) {
  let cookie = "";
  const call = async (method, url, { body, headers = {}, at = now } = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(at ? { "X-Test-Now": String(at) } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: json, text };
  };
  return {
    get: (url, opts) => call("GET", url, opts),
    post: (url, body, opts = {}) => call("POST", url, { ...opts, body }),
    admin: (url, body, opts = {}) => call("POST", url, { ...opts, body, headers: { "X-Raya-Admin": "1", ...(opts.headers || {}) } }),
    login: (password = ADMIN_PASSWORD, opts) => call("POST", "/api/qr/admin/login.php", { ...opts, body: { password } }),
    get cookie() {
      return cookie;
    },
  };
}

/** Unix seconds for a Sofia wall-clock time, from an explicit UTC offset. */
export const sofia = (iso, offsetHours) => Math.floor(Date.parse(`${iso}:00Z`) / 1000) - offsetHours * 3600;

let keyCounter = 0;
export const newKey = () => `test-${process.pid}-${Date.now()}-${++keyCounter}-${Math.random().toString(36).slice(2, 10)}`;

/** An order body from [itemId, variantId, qty, choiceId?] tuples, priced from the menu. */
export function orderBody(menu, table, lines, extra = {}) {
  const items = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
  const out = lines.map(([itemId, variantId = "std", qty = 1, choiceId = "", note = ""]) => {
    const variant = items.get(itemId)?.variants.find((v) => v.id === variantId);
    return { itemId, variantId, choiceId, qty, note, price: variant ? variant.price : 100 };
  });
  return {
    table,
    lang: "bg",
    expectedTotal: out.reduce((s, l) => s + l.price * l.qty, 0),
    lines: out,
    website: "",
    ...extra,
  };
}
