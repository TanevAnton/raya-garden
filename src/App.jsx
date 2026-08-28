import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
} from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Home from "./pages/Home.jsx";
import Hotel from "./pages/Hotel.jsx";
import Restaurant from "./pages/Restaurant.jsx";
import Winery from "./pages/Winery.jsx";
import Park from "./pages/Park.jsx";
import Events from "./pages/Events.jsx";
import Contact from "./pages/Contact.jsx";
import Reservations from "./pages/Reservations.jsx";
import EventPage from "./pages/EventPage.jsx";
import NotFound from "./pages/NotFound.jsx";
import { translations } from "./translations.js";
import { initClockWbe, setClockLang } from "./lib/clockWbe.js";

const LANG_KEY = "raya.lang";
const LANG_PARAM = "lang";
const VALID_LANGS = ["bg", "en", "ro"];

function getSavedLang() {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(LANG_KEY);
  return VALID_LANGS.includes(saved) ? saved : null;
}

// ?lang=en in the URL — an explicit request that beats both the saved
// choice and geo-IP, so a link shared in one language opens in that
// language for everyone, wherever they are.
function getUrlLang() {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get(LANG_PARAM);
  return VALID_LANGS.includes(v) ? v : null;
}

// Captured once at module load — before React renders and therefore before
// LangUrlSync writes the parameter itself. Reading the live URL later would
// see our own synced value and mistake it for a visitor's explicit choice,
// which would silently disable geo-IP detection for every first-time guest.
const INITIAL_URL_LANG = getUrlLang();

// Country code → site language. Anything not listed gets EN.
function langForCountry(country) {
  const cc = (country || "").toUpperCase();
  if (cc === "BG") return "bg";
  if (cc === "RO") return "ro";
  return "en";
}

// Keeps ?lang= in the address bar in sync with the active language.
// Internal navigation would otherwise drop the parameter, so a URL copied
// from a subpage would lose the language. Uses the router's own navigate
// (replace) rather than history.replaceState so React Router stays in sync.
function LangUrlSync({ lang }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get(LANG_PARAM) === lang) return;
    params.set(LANG_PARAM, lang);
    navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
        hash: location.hash,
      },
      { replace: true }
    );
  }, [lang, location.pathname, location.search, location.hash, navigate]);

  return null;
}

export default function App() {
  // Priority: ?lang= in the URL → the visitor's saved choice → geo-IP
  // (below) → BG while that request is in flight.
  const [lang, setLangState] = useState(
    () => INITIAL_URL_LANG || getSavedLang() || "bg"
  );
  const t = translations[lang];

  // A language arriving via ?lang= is treated as a deliberate choice and
  // persisted, so it survives internal navigation and return visits.
  useEffect(() => {
    if (!INITIAL_URL_LANG) return;
    try {
      window.localStorage.setItem(LANG_KEY, INITIAL_URL_LANG);
    } catch {
      /* storage unavailable — ignore */
    }
  }, []);

  // Geo-IP detect language exactly once per visit, only when the visitor
  // hasn't already expressed a choice (via ?lang= or localStorage).
  useEffect(() => {
    if (INITIAL_URL_LANG || getSavedLang()) return; // explicit choice wins
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

  // Initialise the Clock booking engine once, then keep its language in
  // sync with the site. init() is guarded + polls for the deferred script.
  useEffect(() => {
    initClockWbe(lang);
    setClockLang(lang);
  }, [lang]);

  // Manual switch (Nav buttons) — persist the choice so geo-IP no longer
  // applies on return visits. LangUrlSync mirrors it into the URL.
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
      <LangUrlSync lang={lang} />
      <Routes>
        <Route element={<Layout lang={lang} setLang={setLang} t={t} />}>
          <Route index element={<Home />} />
          <Route path="hotel" element={<Hotel />} />
          <Route path="restaurant" element={<Restaurant />} />
          <Route path="winery" element={<Winery />} />
          <Route path="park" element={<Park />} />
          <Route path="events" element={<Events />} />
          <Route path="book" element={<Reservations />} />
          <Route path="event/:slug" element={<EventPage />} />
          <Route path="contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
