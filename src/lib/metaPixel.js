import { useEffect, useRef } from "react";

// Meta Pixel conversion events.
//
// The pixel is initialised in index.html (fbq('init', …)) without an
// automatic PageView — Layout.jsx fires that once per route change. This
// module is the only place the React app calls fbq for anything else, so
// there is one answer to "what do we send Meta and when".
//
// The Clock booking funnel does NOT go through here: its callback has to be
// a classic script defined before Clock's deferred bundle loads, so it lives
// in index.html. See README-tracking.md.
//
// Two rules hold everywhere below:
//   · Nothing throws. An ad blocker removes fbq entirely, and a tracking
//     failure must never take a page down with it.
//   · Empty params are dropped rather than sent. Meta shows `null` and `""`
//     as real values in Events Manager, which makes a healthy event look
//     broken.

/**
 * Deduplication id, so the same conversion sent later by the Conversions API
 * can be matched to this browser event instead of counted twice.
 * randomUUID needs a secure context; the fallback is not cryptographic, it
 * only needs to be unique per event.
 */
export function newEventId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `raya-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Drop null, undefined and "" — see the note above about Events Manager. */
function clean(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Send one event. Returns the eventID used, or null when nothing was sent
 * (no pixel, or it threw) — callers ignore it; it exists for tests.
 */
export function trackMeta(event, params = {}, eventID = undefined) {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") {
      return null;
    }
    const id = eventID || newEventId();
    window.fbq("track", event, clean(params), { eventID: id });
    return id;
  } catch (err) {
    // Never let a pixel problem surface to a guest.
    if (typeof console !== "undefined") console.error("[meta-pixel]", err);
    return null;
  }
}

/**
 * Fire one event per distinct `key`, once.
 *
 * `key` carries the identity of what is being viewed (the slug, the page) —
 * so navigating /event/a → /event/b re-fires while the component stays
 * mounted, and a re-render does not. A null key means "not ready yet",
 * which is how a page whose title arrives from Sanity waits for it instead
 * of reporting an empty content_name.
 *
 * The ref survives React StrictMode's double-invoke in development (same
 * fiber, effect run twice), so the event is sent once there too.
 *
 * `params` is deliberately not a dependency: it is a fresh object on every
 * render, and `key` already states when the event is a different one.
 */
export function useMetaEvent(event, params, key) {
  const fired = useRef(null);

  useEffect(() => {
    if (!event || !key || fired.current === key) return;
    fired.current = key;
    trackMeta(event, params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, key]);
}
