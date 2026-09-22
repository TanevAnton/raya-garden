// Who the data controller is, in one place.
//
// The privacy policy and the cookies page both render from these values, so
// correcting the legal entity is a one-line change here and nowhere else.
//
// ⚠ legalName, eik and registeredAddress are still the bracketed placeholders
// the brief was issued with. They are published exactly as given, not
// guessed: the real company name, EIK and registered address are not
// recorded anywhere in this repo or in Sanity, and a wrong controller on a
// GDPR notice is worse than a visibly unfinished one. Replace them as soon as
// the details are confirmed.
export const CONTROLLER = {
  legalName: "[ЮРИДИЧЕСКО ЛИЦЕ, напр. „Х“ ЕООД]",
  eik: "[ЕИК]",
  registeredAddress: "[АДРЕС ПО РЕГИСТРАЦИЯ]",
  tradingName: "Park Hotel RAYA Garden",
  tradingAddress: {
    bg: "парк „Света гора“, 5000 Велико Търново",
    en: "Sveta Gora Park, 5000 Veliko Tarnovo, Bulgaria",
  },
  email: "hotel@svetagora.bg",
  phone: "+359 896 100 100",
  phoneHref: "tel:+359896100100",
};

// Shown at the top of both pages. Bump it whenever either text changes.
export const LAST_UPDATED = {
  bg: "22 септември 2026 г.",
  en: "22 September 2026",
};
