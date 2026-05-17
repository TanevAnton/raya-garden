import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Hotel from "./pages/Hotel.jsx";
import Restaurant from "./pages/Restaurant.jsx";
import Winery from "./pages/Winery.jsx";
import Lake from "./pages/Lake.jsx";
import Park from "./pages/Park.jsx";
import Events from "./pages/Events.jsx";
import Contact from "./pages/Contact.jsx";
import NotFound from "./pages/NotFound.jsx";
import { translations } from "./translations.js";

const LANG_KEY = "raya.lang";
const VALID_LANGS = ["bg", "en", "ro"];

function getSavedLang() {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(LANG_KEY);
  return VALID_LANGS.includes(saved) ? saved : null;
}

// Country code → site language. Anything not listed gets EN.
function langForCountry(country) {
  const cc = (country || "").toUpperCase();
  if (cc === "BG") return "bg";
  if (cc === "RO") return "ro";
  return "en";
}

export default function App() {
  // Default to BG while the geo-IP request is in flight on first visit.
  // If the visitor has previously chosen a language, that wins outright.
  const [lang, setLangState] = useState(() => getSavedLang() || "bg");
  const t = translations[lang];

  // Geo-IP detect language exactly once per visit, only when the user
  // hasn't already made an explicit choice (no localStorage entry).
  useEffect(() => {
    if (getSavedLang()) return; // explicit user choice → don't override
    let cancelled = false;
    fetch("https://ipwho.is/", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || data?.success === false) return;
        const detected = langForCountry(data?.country_code);
        setLangState(detected);
      })
      .catch(() => {
        /* network blocked / offline — keep the default and move on */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Manual switch (Nav buttons) — persist the choice so geo-IP no longer
  // applies on return visits.
  const setLang = useCallback((newLang) => {
    if (!VALID_LANGS.includes(newLang)) return;
    setLangState(newLang);
    try {
      window.localStorage.setItem(LANG_KEY, newLang);
    } catch {
      /* storage unavailable — ignore */
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout lang={lang} setLang={setLang} t={t} />}>
          <Route index element={<Home />} />
          <Route path="hotel" element={<Hotel />} />
          <Route path="restaurant" element={<Restaurant />} />
          <Route path="winery" element={<Winery />} />
          <Route path="lake" element={<Lake />} />
          <Route path="park" element={<Park />} />
          <Route path="events" element={<Events />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
