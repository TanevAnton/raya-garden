// A stand-in for Stripe's API, for tests: the three calls the ordering system
// makes (create a Checkout Session, expire one, refund), with Stripe's
// idempotency behaviour, plus a fake payment page that "pays" and then
// delivers a correctly signed webhook — the way Stripe does it.
//
// Real Stripe is checked separately (docs/qr-ordering/SETUP.md, sandbox).

import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

/** "a[b][0][c]=1" form fields → nested objects/arrays, as Stripe reads them. */
export function parseForm(text) {
  const out = {};
  for (const [key, value] of new URLSearchParams(text)) {
    const path = key.replace(/\]/g, "").split("[");
    let node = out;
    path.forEach((part, i) => {
      if (i === path.length - 1) node[part] = value;
      else node = node[part] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}

/** The Stripe-Signature header for a payload. */
export function sign(payload, secret, time = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${time}.${payload}`).digest("hex");
  return `t=${time},v1=${v1}`;
}

export async function startFakeStripe({ webhookSecret }) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const sessions = new Map();
  const refunds = new Map(); // payment_intent → [refund, …]
  const charged = new Map(); // payment_intent → amount paid
  const idem = new Map(); // key → { params, status, body }
  const requests = [];
  const failures = []; // queued [pathPrefix, status, body]
  const delays = []; // queued [pathPrefix, ms]
  let webhookUrl = "";
  let n = 0;

  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const event = (type, object) => ({
    id: `evt_test_${++n}`,
    object: "event",
    type,
    data: { object },
  });

  /** Deliver an event to the webhook, signed like Stripe. */
  async function deliver(evt, { secret = webhookSecret, time, tamper = false } = {}) {
    const payload = JSON.stringify(evt);
    const sent = tamper ? payload.replace(/"amount_total":\d+/, '"amount_total":1') : payload;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": sign(payload, secret, time) },
      body: sent,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Complete a session as a successful card payment, and tell the webhook. */
  async function pay(id, { paymentStatus = "paid", type = "checkout.session.completed", amount, name = "Test Guest" } = {}) {
    const s = sessions.get(id);
    s.status = "complete";
    s.payment_status = paymentStatus;
    s.payment_intent ??= `pi_test_${++n}`;
    // What Stripe's page collected: the cardholder's (or wallet's) name, and an email.
    s.customer_details = { name, email: "guest@example.com" };
    charged.set(s.payment_intent, s.amount_total);
    const object = { ...s, ...(amount !== undefined ? { amount_total: amount } : {}) };
    return deliver(event(type, object));
  }

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, base);

    // The fake payment page: one button that pays and returns to the menu.
    if (req.method === "GET" && url.pathname.startsWith("/pay/")) {
      const id = url.pathname.slice(5);
      const s = sessions.get(id);
      if (!s) return json(res, 404, {});
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><title>Fake Stripe</title><p>${(s.amount_total / 100).toFixed(2)} EUR</p>
        <form method="post" action="/pay/${id}"><button id="pay">Pay</button></form>
        <a id="back" href="${s.cancel_url}">Back</a>`);
    }
    if (req.method === "POST" && url.pathname.startsWith("/pay/")) {
      const id = url.pathname.slice(5);
      await pay(id);
      res.writeHead(303, { Location: sessions.get(id).success_url });
      return res.end();
    }

    const params = parseForm(raw);
    const key = req.headers["idempotency-key"] || "";
    requests.push({ method: req.method, path: url.pathname, params, headers: req.headers });
    if (!/^Bearer [sr]k_test_/.test(req.headers.authorization || "")) {
      return json(res, 401, { error: { type: "invalid_request_error", message: "bad key" } });
    }
    const delay = delays.findIndex(([prefix]) => url.pathname.startsWith(prefix));
    if (delay >= 0) await new Promise((r) => setTimeout(r, delays.splice(delay, 1)[0][1]));
    const failure = failures.findIndex(([prefix]) => url.pathname.startsWith(prefix));
    if (failure >= 0) {
      const [, status, body] = failures.splice(failure, 1)[0];
      return json(res, status, body || { error: { type: "api_error" } });
    }
    if (key && idem.has(key)) {
      const prior = idem.get(key);
      if (JSON.stringify(prior.params) !== JSON.stringify(params)) {
        return json(res, 400, { error: { type: "idempotency_error", code: "idempotency_key_in_use" } });
      }
      return json(res, prior.status, prior.body);
    }
    const remember = (status, body) => {
      if (key) idem.set(key, { params, status, body });
      return json(res, status, body);
    };

    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      const id = `cs_test_${++n}`;
      const amount = (params.line_items || []).reduce((sum, l) => sum + Number(l.price_data.unit_amount) * Number(l.quantity), 0);
      const session = {
        id,
        object: "checkout.session",
        url: `${base}/pay/${id}`,
        amount_total: amount,
        currency: "eur",
        client_reference_id: params.client_reference_id,
        metadata: params.metadata,
        success_url: params.success_url,
        cancel_url: params.cancel_url,
        expires_at: Number(params.expires_at),
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
      };
      sessions.set(id, session);
      return remember(200, session);
    }
    const expire = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (req.method === "POST" && expire) {
      const s = sessions.get(expire[1]);
      if (!s || s.status !== "open") return remember(400, { error: { code: "checkout_session_not_open" } });
      s.status = "expired";
      return remember(200, s);
    }
    if (req.method === "POST" && url.pathname === "/v1/refunds") {
      // Full by default; with "amount", partial — as long as the total
      // refunded stays within what was paid, like Stripe.
      const pi = params.payment_intent;
      const done = (refunds.get(pi) || []).reduce((sum, r) => sum + r.amount, 0);
      const paid = charged.get(pi) ?? Infinity;
      const amount = params.amount !== undefined ? Number(params.amount) : paid - done;
      if (done >= paid || amount > paid - done) {
        return remember(400, { error: { type: "invalid_request_error", code: "charge_already_refunded" } });
      }
      const refund = { id: `re_test_${++n}`, object: "refund", payment_intent: pi, amount, status: "succeeded" };
      refunds.set(pi, [...(refunds.get(pi) || []), refund]);
      return remember(200, refund);
    }
    return json(res, 404, { error: { type: "invalid_request_error", message: `no fake for ${url.pathname}` } });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));

  return {
    base,
    requests,
    sessions,
    refunds,
    refunded: (pi) => (refunds.get(pi) || []).reduce((sum, r) => sum + r.amount, 0),
    setWebhook: (url) => (webhookUrl = url),
    failNext: (prefix, status, body) => failures.push([prefix, status, body]),
    delayNext: (prefix, ms) => delays.push([prefix, ms]),
    event,
    deliver,
    pay,
    calls: (path) => requests.filter((r) => r.path === path),
    reset: () => {
      sessions.clear();
      refunds.clear();
      charged.clear();
      idem.clear();
      requests.length = 0;
      failures.length = 0;
      delays.length = 0;
    },
    stop: () => new Promise((r) => server.close(r)),
  };
}
