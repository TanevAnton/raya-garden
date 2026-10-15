// A fake Clock PMS+ base_api for the tests: HTTP Digest (as curl's
// CURLAUTH_DIGEST negotiates it), company folios, bulk charges, payments
// (credit items) and closing — with the behaviour seen on Clock's sandbox:
//   - a company that does not "Accept charge transfers" refuses charges:
//     500 {"error": "<name> does not accept charges!"};
//   - a right the API user lacks: 403 {"error": "The User doesn't have <right> right"};
//   - at most 100 charges a bulk call: {"error": "Charges exceeds the limit!"};
//   - a folio that does not balance is not closed without the right to;
//     a correction folio linked to its original (client_folio_id) counts as
//     balanced — what Clock described for a storno (15.10.2026);
//   - a negative payment on an open folio needs its own right; on a closed
//     one it is taken.
// And what a test needs: a failure on the next call to a path, or an answer
// lost after the work was done (the connection dropped), and a count of
// calls over Clock's 5 a second.
import http from "node:http";
import net from "node:net";
import { createHash, randomBytes } from "node:crypto";

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const md5 = (s) => createHash("md5").update(s).digest("hex");
const REALM = "Clock PMS+ API";

/** The fields of an Authorization: Digest header. */
function parseDigest(header) {
  const out = {};
  for (const m of header.replace(/^Digest\s+/i, "").matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

export async function startFakeClock({ user = "api_user_test", key = "api_key_test", companies = { 500: { name: "QR меню – онлайн", accepts: true } } } = {}) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}/base_api/1/2`;
  const nonces = new Set();
  const folios = new Map();
  const requests = []; // authorised calls only
  const failures = []; // [method, pathRegex, status, body]
  const losses = []; // [method, pathRegex]: do it, then drop the connection
  let denied = new Set();
  let nextFolio = 900000;
  let nextCharge = 1;
  let nextNumber = 1;
  const known = structuredClone(companies);

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const deny = (right) => (denied.has(right) ? { error: `The User doesn't have ${right} right` } : null);
  const take = (list, method, path) => {
    const i = list.findIndex(([m, re]) => m === method && re.test(path));
    return i >= 0 ? list.splice(i, 1)[0] : null;
  };
  const folioJson = (f) => ({
    id: f.id,
    number: f.number,
    payer_id: f.company,
    client_folio_id: f.clientFolio,
    currency: f.currency,
    closed_at: f.closedAt,
    document_type_id: f.documentType,
    value: { cents: f.charges.reduce((s, c) => s + c.price_cents * c.qty, 0), currency_iso: f.currency },
    balance: {
      cents: f.charges.reduce((s, c) => s + c.price_cents * c.qty, 0) - f.credits.reduce((s, c) => s + c.value_cents, 0),
      currency_iso: f.currency,
    },
  });

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    // HTTP Digest, qop=auth: a 401 with a nonce, then the hashed answer.
    const auth = req.headers.authorization || "";
    const d = /^Digest /i.test(auth) ? parseDigest(auth) : null;
    const ha1 = md5(`${user}:${REALM}:${key}`);
    const ok = d && d.username === user && nonces.has(d.nonce) && d.response === md5(`${ha1}:${d.nonce}:${d.nc}:${d.cnonce}:${d.qop}:${md5(`${req.method}:${d.uri}`)}`);
    if (!ok) {
      const nonce = randomBytes(16).toString("hex");
      nonces.add(nonce);
      res.writeHead(401, { "WWW-Authenticate": `Digest realm="${REALM}", qop="auth", nonce="${nonce}", opaque="${randomBytes(8).toString("hex")}"`, "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: d ? "HTTP Digest: Access denied." : "HTTP Digest: Access denied.\n" }));
    }

    const path = url.pathname.replace(/^\/base_api\/\d+\/\d+/, "");
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(res, 400, { error: "invalid JSON" });
    }
    requests.push({ method: req.method, path, body, at: Date.now() });

    const failure = take(failures, req.method, path);
    if (failure) return json(res, failure[2], failure[3] || { error: "Internal Server Error" });
    const lose = take(losses, req.method, path);
    const answer = (status, out) => {
      if (lose) return req.socket.destroy(); // done, but the answer never arrives
      return json(res, status, out);
    };

    let m;
    if (req.method === "POST" && (m = path.match(/^\/companies\/(\d+)\/folios$/))) {
      const company = known[m[1]];
      if (!company) return json(res, 404, { error: "Record not found" });
      const f = { id: ++nextFolio, number: `FL-${nextNumber++}`, company: Number(m[1]), currency: body.company_folio?.currency || "EUR", clientFolio: body.company_folio?.client_folio_id ?? null, charges: [], credits: [], closedAt: null, documentType: null };
      folios.set(f.id, f);
      return answer(200, folioJson(f));
    }
    if ((m = path.match(/^\/folios\/(\d+)(\/.*)?$/))) {
      const f = folios.get(Number(m[1]));
      if (!f) return json(res, 404, { error: "Record not found" });
      const rest = m[2] || "";
      if (req.method === "GET" && rest === "") return answer(200, folioJson(f));
      if (req.method === "POST" && rest === "/charges/bulk") {
        if (!known[f.company].accepts) return json(res, 500, { error: `${known[f.company].name} does not accept charges!` });
        const charges = body.charges || [];
        if (charges.length > 100) return json(res, 500, { error: "Charges exceeds the limit!" });
        const made = charges.map((c) => ({
          id: nextCharge++,
          folio_id: f.id,
          text: c.text,
          qty: Number(c.qty ?? 1),
          price_cents: Math.round(Number(c.price) * 100),
          currency: c.currency,
          charge_template_id: c.charge_template_id ?? null,
          revenue_group: c.revenue_group ?? (c.charge_template_id ? "extra" : null),
          tax_rate: c.tax_rate ?? null,
          service_date: c.service_date,
          print_text: c.print_text ?? "",
          voided_at: null,
        }));
        if (made.some((c) => !c.revenue_group)) return json(res, 500, { error: "revenue_group is missing" });
        f.charges.push(...made);
        return answer(200, made);
      }
      if (req.method === "GET" && rest === "/charges") return deny("base_api_charges_index") ? json(res, 403, deny("base_api_charges_index")) : answer(200, f.charges);
      if (req.method === "POST" && rest === "/credit_items") {
        const c = body.credit_item || {};
        const value = Math.round(Number(c.value) * 100);
        if (value < 0 && !f.closedAt && denied.has("Payments: Add negative payment to Open folio")) {
          return json(res, 500, { error: "The User doesn't have the following right granted:\nPayments: Add negative payment to Open folio" });
        }
        const item = { id: nextCharge++, folio_id: f.id, value_cents: value, currency: c.currency, text: c.text, payment_type: c.payment_type, reference: c.reference ?? null, voided_at: null };
        f.credits.push(item);
        return answer(200, item);
      }
      if (req.method === "GET" && rest === "/credit_items") return answer(200, f.credits);
      if (req.method === "POST" && rest === "/close") {
        const no = deny("base_api_folios_close");
        if (no) return json(res, 403, no);
        if (f.closedAt) return json(res, 422, { error: "Folio is already closed" });
        const balance = f.charges.reduce((s, c) => s + c.price_cents * c.qty, 0) - f.credits.reduce((s, c) => s + c.value_cents, 0);
        if (balance !== 0 && !f.clientFolio && denied.has("Folio: Close folio with outstanding balance")) {
          return json(res, 400, { error: "The User doesn't have right: 'Folio: Close folio with outstanding balance'" });
        }
        f.closedAt = new Date().toISOString();
        f.documentType = body.document_type_id ?? null;
        return answer(200, folioJson(f));
      }
    }
    return json(res, 404, { error: `no fake for ${req.method} ${path}` });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  return {
    base,
    user,
    key,
    folios,
    requests,
    calls: (method, re) => requests.filter((r) => r.method === method && re.test(r.path)),
    /** The next call to METHOD path~re answers status/body instead. */
    failNext: (method, re, status, body) => failures.push([method, re, status, body]),
    /** The next call to METHOD path~re is done, but its answer is lost. */
    loseNext: (method, re) => losses.push([method, re]),
    deny: (...rights) => rights.forEach((r) => denied.add(r)),
    company: (id, props) => (known[id] = { ...(known[id] || {}), ...props }),
    /** Calls closer together than Clock allows: more than 5 in any second. */
    overRate: () => requests.filter((r, i) => i >= 5 && r.at - requests[i - 5].at < 1000).length,
    reset: () => {
      nextFolio = 900000;
      nextCharge = 1;
      nextNumber = 1;
      folios.clear();
      requests.length = 0;
      failures.length = 0;
      losses.length = 0;
      denied = new Set();
      Object.keys(known).forEach((k) => delete known[k]);
      Object.assign(known, structuredClone(companies));
    },
    stop: () => new Promise((r) => server.close(r)),
  };
}
