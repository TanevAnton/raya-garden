import { useOutletContext } from "react-router-dom";
import LegalPage from "../components/LegalPage.jsx";
import { PrivacyBg, PrivacyEn } from "../content/legal/privacy.jsx";
import { LAST_UPDATED } from "../content/legal/controller.js";
import { useSeo } from "../hooks/useSeo.js";

// Bulgarian by default, English at ?lang=en. There is no Romanian text, so
// ?lang=ro gets English — the same fallback pickLocale uses site-wide, since
// a Romanian visitor can read English far more readily than Bulgarian.
export default function PrivacyPolicy() {
  const { lang } = useOutletContext();
  const bg = lang === "bg";

  useSeo({
    title: bg ? "Политика за поверителност" : "Privacy Policy",
    description: bg
      ? "Какви лични данни събира Park Hotel RAYA Garden, защо, на какво основание и какви са правата Ви."
      : "What personal data Park Hotel RAYA Garden collects, why, on what legal basis, and your rights.",
    path: "/privacy-policy",
    lang,
  });

  return (
    <LegalPage
      eyebrow={bg ? "Лични данни" : "Personal data"}
      title={bg ? "Политика за поверителност" : "Privacy Policy"}
      updatedLabel={bg ? "Последна актуализация" : "Last updated"}
      updated={bg ? LAST_UPDATED.bg : LAST_UPDATED.en}
    >
      {bg ? <PrivacyBg /> : <PrivacyEn />}
    </LegalPage>
  );
}
