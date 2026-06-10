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

// Open the booking overlay straight to the room list.
// Returns false if the integration script hasn't loaded yet (callers can
// then fall back to opening WBE_BASE_URL directly).
export function openBooking() {
  if (
    typeof window !== "undefined" &&
    typeof window.clockPmsWbeShowRooms === "function"
  ) {
    window.clockPmsWbeShowRooms();
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
    return true;
  }
  return false;
}
