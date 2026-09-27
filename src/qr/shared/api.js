// Talking to /api/qr/. Every call has a timeout, so a phone that loses the
// restaurant Wi-Fi gets a clear "no connection" instead of a spinner that
// never ends.

export class NetworkError extends Error {}

export async function api(path, { method = "GET", body, headers = {}, timeout = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(`/api/qr/${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new NetworkError("network");
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* an HTML error page from the host — treated as a failure below */
  }
  if (!data || typeof data !== "object") throw new NetworkError(`http ${res.status}`);
  return { status: res.status, ...data };
}

/** A random id for one checkout attempt (crypto.randomUUID needs HTTPS; this does not). */
export function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** sessionStorage that never throws (private mode, blocked storage). */
export const session = {
  get(key, fallback) {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* the page still works; it just forgets on reload */
    }
  },
};
