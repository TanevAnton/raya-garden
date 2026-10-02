// Test harness for the QR ordering API: a real PHP server (several workers,
// so requests truly run in parallel) over a throwaway copy of public/api, a
// throwaway SQLite database and a test config with a known admin password.
//
// RAYA_QR_TEST=1 lets a request set the server's clock with an X-Test-Now
// header — the only way to test a service window across midnight or a
// daylight-saving change. Production never sets it.

import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
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

/**
 * stripe: { key, webhookSecret, api, publicUrl } adds payments to the config
 * and points the API at a fake Stripe (tests/qr/fake-stripe.mjs). publicUrl
 * "self" sends the guest back to this test server after paying.
 */
export async function startServer({ docroot = "public", withPassword = true, stripe = null } = {}) {
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
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const publicUrl = stripe?.publicUrl === "self" ? base : stripe?.publicUrl || "";
  const settings = {
    ...(withPassword ? { admin_password_hash: hash } : {}),
    ...(stripe ? { stripe_secret_key: stripe.key, stripe_webhook_secret: stripe.webhookSecret, public_url: publicUrl } : {}),
  };
  const php = Object.entries(settings).map(([k, v]) => `'${k}' => ${JSON.stringify(v).replace(/\$/g, "\\$")}`);
  writeFileSync(config, `<?php return [${php.join(", ")}];\n`);
  const proc = spawn("php", ["-S", `127.0.0.1:${port}`, "-t", root], {
    env: {
      ...process.env,
      RAYA_QR_TEST: "1",
      RAYA_QR_CONFIG: config,
      RAYA_QR_DATA_DIR: path.join(work, "data"),
      // E-mail is written here instead of sent (_lib/report.php, test mode only).
      RAYA_QR_MAIL_DIR: path.join(work, "data", "mail"),
      PHP_CLI_SERVER_WORKERS: "10",
      ...(stripe ? { RAYA_QR_STRIPE_API: stripe.api } : {}),
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  proc.stderr.on("data", (d) => (log += d));
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
    /** E-mails the server "sent", oldest first, decoded (parseMail). */
    mails: () => {
      const dir = path.join(work, "data", "mail");
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) => f.endsWith(".eml")).sort().map((f) => parseMail(readFileSync(path.join(dir, f), "latin1")));
    },
    /** Make the next sends fail (true) or work again (false). */
    mailFails: (fail) => {
      const dir = path.join(work, "data", "mail");
      mkdirSync(dir, { recursive: true });
      if (fail) writeFileSync(path.join(dir, "FAIL"), "");
      else rmSync(path.join(dir, "FAIL"), { force: true });
    },
    sqlite: (sql) => execFileSync("php", ["-r", `
      $db = new PDO('sqlite:' . ${JSON.stringify(path.join(work, "data", "orders.sqlite"))});
      echo json_encode($db->query(${JSON.stringify(sql)})->fetchAll(PDO::FETCH_ASSOC));`]).toString(),
    stop: () => {
      proc.kill();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/**
 * Just enough MIME for the server's own mail: headers, the base64 text and
 * HTML parts, and the attachments by file name.
 */
export function parseMail(raw) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const headers = {};
  for (const line of head.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const at = line.indexOf(":");
    headers[line.slice(0, at).toLowerCase()] = line.slice(at + 1).trim();
  }
  const words = (v) => v.replace(/=\?UTF-8\?B\?([^?]*)\?=\s*/gi, (_, b) => Buffer.from(b, "base64").toString("latin1"));
  const utf8 = (latin1) => Buffer.from(latin1, "latin1").toString("utf8");
  const body = rest.join("\r\n\r\n");
  const parts = [];
  const walk = (text, boundary) => {
    for (const chunk of text.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith("--")) break;
      const [h, ...b] = chunk.replace(/^\r\n/, "").split("\r\n\r\n");
      const inner = h.match(/boundary="([^"]+)"/);
      if (inner) walk(b.join("\r\n\r\n"), inner[1]);
      else parts.push({ type: (h.match(/Content-Type: ([^;\r]+)/i) || [])[1], name: (h.match(/filename="([^"]+)"/) || [])[1], data: Buffer.from(b.join("").replace(/\s+/g, ""), "base64") });
    }
  };
  walk(body, headers["content-type"].match(/boundary="([^"]+)"/)[1]);
  return {
    to: headers.to,
    from: headers.from,
    subject: utf8(words(headers.subject)),
    text: parts.find((p) => p.type === "text/plain" && !p.name)?.data.toString("utf8"),
    html: parts.find((p) => p.type === "text/html")?.data.toString("utf8"),
    files: Object.fromEntries(parts.filter((p) => p.name).map((p) => [p.name, p.data])),
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
