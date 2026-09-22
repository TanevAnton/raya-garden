import { useOutletContext } from "react-router-dom";
import LegalPage from "../components/LegalPage.jsx";
import { CookiesBg, CookiesEn } from "../content/legal/cookies.jsx";
import { LAST_UPDATED } from "../content/legal/controller.js";
import { useSeo } from "../hooks/useSeo.js";

// Same language rule as the privacy policy: Bulgarian by default, English
// for ?lang=en and, as the nearest readable fallback, ?lang=ro.
export default function Cookies() {
  const { lang } = useOutletContext();
  const bg = lang === "bg";

  useSeo({
    title: bg ? "Политика за бисквитки" : "Cookie Policy",
    description: bg
      ? "Кои бисквитки поставя rayagarden.bg, за какво служат, кой ги поставя и за колко време."
      : "Which cookies rayagarden.bg sets, what they are for, who sets them and for how long.",
    path: "/cookies",
    lang,
  });

  return (
    <LegalPage
      eyebrow={bg ? "Бисквитки" : "Cookies"}
      title={bg ? "Политика за бисквитки" : "Cookie Policy"}
      updatedLabel={bg ? "Последна актуализация" : "Last updated"}
      updated={bg ? LAST_UPDATED.bg : LAST_UPDATED.en}
    >
      {bg ? <CookiesBg /> : <CookiesEn />}
    </LegalPage>
  );
}
