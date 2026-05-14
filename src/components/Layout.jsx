import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Nav from "./Nav.jsx";
import Footer from "./Footer.jsx";

export default function Layout({ lang, setLang, t }) {
  const { pathname } = useLocation();
  const progressRef = useRef(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -80px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    function onScroll() {
      const el = progressRef.current;
      if (!el) return;
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      const ratio = max > 0 ? h.scrollTop / max : 0;
      el.style.transform = `scaleX(${ratio})`;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-ink-950 text-cream-50 overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-[70] focus:bg-ink-900 focus:text-gold-200 focus:px-4 focus:py-2 focus:rounded-sm focus:border focus:border-gold-300/40"
      >
        {lang === "en" ? "Skip to content" : "Към съдържанието"}
      </a>
      <div ref={progressRef} className="scroll-progress" aria-hidden="true" />
      <Nav lang={lang} setLang={setLang} t={t} />
      <main id="main">
        <Outlet context={{ lang, t }} />
      </main>
      <Footer t={t} />
    </div>
  );
}
