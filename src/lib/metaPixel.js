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
 * The ad category a page belongs to, sent as content_category so results can
 * be split the way the campaigns are: events, hotel, restaurant, nye.
 *
 * Only pages that plainly belong to one of the four get a value. The home
 * page, /contact, /park, /winery and the legal pages are about the whole
 * place, and labelling a call from them "hotel" would make the hotel look
 * better than it is — they return undefined, which clean() drops.
 *
 * NYE is matched on the slug, so next year's /event/nova-godina-2028 is
 * classified without a code change; every other event page is "events".
 */
export function contentCategoryForPath(pathname = "") {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (/^\/event\/nova-godina/.test(path)) return "nye";
  if (path === "/events" || path === "/svatben-konfigurator" || path.startsWith("/event/")) {
    return "events";
  }
  if (path === "/hotel" || path === "/book") return "hotel";
  if (path === "/restaurant") return "restaurant";
  return undefined;
}

/**
 * Which way a guest is reaching out, from a link's href — or null when the
 * link is not a contact link at all. WhatsApp has three spellings in the
 * wild (wa.me, api.whatsapp.com, the whatsapp: scheme); all count.
 */
export function contactMethodForHref(href = "") {
  const h = String(href).trim().toLowerCase();
  if (h.startsWith("tel:")) return "phone";
  if (h.startsWith("mailto:")) return "email";
  if (h.startsWith("viber:")) return "viber";
  if (h.startsWith("whatsapp:") || /^https?:\/\/(www\.)?(wa\.me|api\.whatsapp\.com)\//.test(h)) {
    return "whatsapp";
  }
  return null;
}

/**
 * The pages where reaching out counts as an event enquiry: /events, the
 * wedding configurator, and every /event/<slug> — except New Year, which is
 * its own campaign (nye) and not an event enquiry.
 */
export function isEventEnquiryPage(pathname = "") {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/events" || path === "/svatben-konfigurator") return true;
  return path.startsWith("/event/") && contentCategoryForPath(path) !== "nye";
}

/**
 * event_type for a contact-link tap on an event-enquiry page: "wedding" on
 * the wedding configurator, whatever its URL says; "corporate" where the
 * page was opened with ?for=corporate; otherwise none.
 */
export function eventTypeForTap(pathname = "", search = "") {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/svatben-konfigurator") return "wedding";
  return new URLSearchParams(search).get("for") === "corporate" ? "corporate" : undefined;
}

function send(kind, event, params, eventID) {
  try {
    if (typeof window === "undefined" || typeof window.fbq !== "function") {
      return null;
    }
    const id = eventID || newEventId();
    window.fbq(kind, event, clean(params), { eventID: id });
    return id;
  } catch (err) {
    // Never let a pixel problem surface to a guest.
    if (typeof console !== "undefined") console.error("[meta-pixel]", err);
    return null;
  }
}

/**
 * Send one standard event. Returns the eventID used, or null when nothing
 * was sent (no pixel, or it threw) — callers ignore it; it exists for tests.
 */
export function trackMeta(event, params = {}, eventID = undefined) {
  return send("track", event, params, eventID);
}

/**
 * EventEnquiry — a custom event that puts every way of asking about an event
 * under one name, so a single custom conversion can count them all. It is
 * sent alongside the standard event (Lead for a form, Contact for a tap),
 * never instead of it, and exactly once per action:
 *
 *   method      form | phone | email | viber | whatsapp
 *   event_type  corporate | wedding | birthday | other — from the form's
 *               dropdown; for a tap, eventTypeForTap(): "wedding" on the
 *               configurator, "corporate" when the page was opened with
 *               ?for=corporate, otherwise left out.
 *
 * Only from the two event forms (on a confirmed send) and from contact links
 * on isEventEnquiryPage() pages.
 */
export function trackEventEnquiry({ method, event_type } = {}) {
  return send("trackCustom", "EventEnquiry", { method, event_type });
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
