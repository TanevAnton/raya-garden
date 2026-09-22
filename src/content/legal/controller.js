// Who the data controller is, in one place.
//
// The privacy policy and the cookies page both render from these values, so
// correcting the legal entity is a one-line change here and nowhere else.
//
// Legal name, EIK and registered address are as entered in the Commercial
// Register (Агенция по вписванията, portal.registryagency.bg, EIK 203389338):
//   CR_F_2  Фирма                        Света гора-Велико Търново
//   CR_F_3  Правна форма                 Дружество с ограничена отговорност
//   CR_F_5  Седалище и адрес на управление, entry of 24.04.2024
// The register's spelling is the legal one — hyphenated, lowercase „гора“ —
// so it is used even where a brief writes it differently. If the company
// moves its seat, CR_F_5 changes and so must this.
//
// The name has no registered Latin form (CR_F_4 is Cyrillic too), so the
// English page gives the Cyrillic legal name with a transliteration beside
// it rather than inventing an English one.
export const CONTROLLER = {
  legalName: {
    bg: "„Света гора-Велико Търново“ ООД",
    en: "„Света гора-Велико Търново“ ООД (Sveta Gora-Veliko Tarnovo OOD)",
  },
  eik: "203389338",
  registeredAddress: {
    bg: "гр. Горна Оряховица 5100, ул. „Росица“ № 6, ап. 4, обл. Велико Търново",
    en: "6 Rositsa St., apt. 4, 5100 Gorna Oryahovitsa, Veliko Tarnovo Province, Bulgaria",
  },
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
  bg: "23 септември 2026 г.",
  en: "23 September 2026",
};
