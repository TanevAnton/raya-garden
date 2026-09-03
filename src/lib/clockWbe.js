// Thin wrapper around the Clock PMS+ web booking engine integration
// (loaded globally in index.html). The integration exposes window.clockPmsWbe*
// helpers once its deferred script has executed. Because that can happen after
// React mounts, init() polls until the global is ready.
//
// The booking overlay it opens reports the booking funnel to the GA4 property
// configured in Clock (Website integration → Google Measurement ID).

export const WBE_BASE_URL =
  "https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003";

// Map the site language to a Clock WBE language code. The hotel publishes
// BG + EN; RO falls back to EN so Romanian visitors get a working engine
// rather than a broken locale.
function clockLang(lang) {
  if (lang === "bg") return "bg";
  return "en";
}

let initialized = false;

export function initClockWbe(lang) {
  if (typeof window === "undefined" || initialized) return;
  let tries = 0;
  const attempt = () => {
    if (initialized) return;
    if (typeof window.clockPmsWbeInit === "function") {
      window.clockPmsWbeInit({
        wbeBaseUrl: WBE_BASE_URL,
        entrypoint: "rooms",
        defaultMode: "standard",
        roundedCorners: true,
        language: clockLang(lang),
      });
      initialized = true;
    } else if (tries++ < 50) {
      setTimeout(attempt, 200);
    }
  };
  attempt();
}

export function setClockLang(lang) {
  if (
    typeof window !== "undefined" &&
    typeof window.clockPmsWbeChangeLanguage === "function"
  ) {
    window.clockPmsWbeChangeLanguage(clockLang(lang));
  }
}

// ChatGPT Ads conversion — the guest has entered the booking engine.
//
// Fired from the functions that actually open the overlay rather than from
// clockPmsWbePageViewCallback: verified against the live site that Clock
// does NOT invoke that callback when the overlay first opens (the iframe
// mounts, the callback never runs), so hanging the conversion off it meant
// it never fired. The callback still guards on the same global, so if Clock
// does call it later in the funnel it won't report a second conversion.
//
// window.oaiq is defined synchronously by the pixel loader in <head>, but
// stay defensive — an ad blocker or the prerender step can leave it absent.
export function trackCheckoutStarted() {
  if (typeof window === "undefined") return;
  if (window.oaiqCheckoutStarted) return;
  if (typeof window.oaiq !== "function") return;
  window.oaiqCheckoutStarted = true;
  window.oaiq("measure", "checkout_started", { type: "contents" });
}

// Open the booking overlay straight to the room list.
// Returns false if the integration script hasn't loaded yet (callers can
// then fall back to opening WBE_BASE_URL directly).
export function openBooking() {
  if (
    typeof window !== "undefined" &&
    typeof window.clockPmsWbeShowRooms === "function"
  ) {
    window.clockPmsWbeShowRooms();
    trackCheckoutStarted();
    return true;
  }
  return false;
}

// Open the booking overlay at availability for specific dates / params.
export function searchAvailability(params) {
  if (
    typeof window !== "undefined" &&
    typeof window.clockPmsWbeShow === "function"
  ) {
    window.clockPmsWbeShow({ submit: true, ...params });
    trackCheckoutStarted();
    return true;
  }
  return false;
}
