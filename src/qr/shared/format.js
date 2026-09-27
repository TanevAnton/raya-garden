// Formatting shared by the guest menu and the admin screen.

/** 1250 → "12,50 €" in Bulgarian, "€12.50" in English. */
export function money(cents, lang = "bg") {
  const value = (cents / 100).toFixed(2);
  return lang === "en" ? `€${value}` : `${value.replace(".", ",")} €`;
}

const UNITS = {
  bg: { g: "г", ml: "мл", pc: "бр." },
  en: { g: "g", ml: "ml", pc: "pc" },
};

/** "250 g" → "250 г" / "250 g". Empty for a wine bottle, which has no size. */
export function size(value, lang = "bg") {
  if (!value) return "";
  const [amount, unit] = value.split(" ");
  return `${amount} ${UNITS[lang]?.[unit] || unit}`;
}

/** A unix time as "20:45" in Sofia, whatever the device's own time zone. */
export function clock(unix) {
  return new Intl.DateTimeFormat("bg-BG", {
    timeZone: "Europe/Sofia",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(unix * 1000));
}

/** Sofia calendar date of a unix time, as YYYY-MM-DD. */
export function sofiaDate(unix) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(unix * 1000));
}

/** Name of a menu entry in the chosen language. */
export const pick = (entry, lang, key = "") => {
  if (!entry) return "";
  if (key) return (lang === "en" ? entry[`${key}En`] : entry[`${key}Bg`]) || entry[`${key}Bg`] || "";
  return (lang === "en" ? entry.en : entry.bg) || entry.bg || "";
};
