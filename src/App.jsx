import { useEffect, useState } from "react";
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

function getInitialLang() {
  if (typeof window === "undefined") return "bg";
  const saved = window.localStorage.getItem(LANG_KEY);
  if (saved === "bg" || saved === "en" || saved === "ro") return saved;
  const browser = (navigator.language || "bg").toLowerCase();
  if (browser.startsWith("ro")) return "ro";
  if (browser.startsWith("en")) return "en";
  return "bg";
}

export default function App() {
  const [lang, setLang] = useState(getInitialLang);
  const t = translations[lang];

  useEffect(() => {
    try {
      window.localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* storage unavailable — ignore */
    }
  }, [lang]);

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
