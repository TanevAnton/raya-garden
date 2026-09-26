import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Nav from "./Nav.jsx";
import Footer from "./Footer.jsx";
import {
  trackMeta,
  trackEventEnquiry,
  contentCategoryForPath,
  contactMethodForHref,
  isEventEnquiryPage,
} from "../lib/metaPixel.js";

export default function Layout({ lang, setLang, t }) {
  const { pathname } = useLocation();
  const progressRef = useRef(null);
  const lastPixelPath = useRef(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname]);

  // GA4 + Facebook Pixel + OpenAI Ads page views. All three are initialised
  // in index.html WITHOUT an automatic page view (send_page_view: false / no
  // PageView in the base code / the OAIQ SDK has no automatic page tracking
  // at all), so this is the only place they fire — once per route change,
  // including the first load. Child page effects (useSeo) run before this
  // parent effect, so document.title is already updated.
  useEffect(() => {
    window.gtag?.("event", "page_view", {
      page_path: pathname,
      page_location: window.location.href,
      page_title: document.title,
    });
    // Through trackMeta so it carries a dedup eventID like every other
    // event — PageView is the highest-volume one, so it is the one the
    // Conversions API would most double-count later.
    //
    // Guarded on the path, unlike the two calls around it: StrictMode
    // double-invokes this effect in development, and a pixel event that
    // fires twice locally makes the Events Manager test flow unreadable.
    // gtag and oaiq are deliberately left as they were — they have always
    // double-fired in dev, and neither is this change's business.
    if (lastPixelPath.current !== pathname) {
      lastPixelPath.current = pathname;
      trackMeta("PageView");
    }
    // page_viewed needs contents[] to pass OpenAI's schema validation —
    // without it the event is accepted (202) and then silently dropped.
    window.oaiq?.("measure", "page_viewed", {
      type: "contents",
      contents: [
        { id: pathname, name: document.title, content_type: "product" },
      ],
    });
  }, [pathname]);

  // One delegated listener rather than a handler on each contact link — the
  // tel: and mailto: links are spread across a dozen places, and a Viber or
  // WhatsApp link added later (there are none today) is covered without
  // touching this. Capture phase, so it still counts if something stops
  // propagation. Registered once per language, so each click is one event.
  //
  // The category is read from the URL at click time rather than from the
  // `pathname` above, which this effect does not depend on and would see
  // stale.
  useEffect(() => {
    const onClick = (event) => {
      const link = event.target?.closest?.("a[href]");
      if (!link) return;
      const method = contactMethodForHref(link.getAttribute("href"));
      if (!method) return;
      trackMeta("Contact", {
        content_category: contentCategoryForPath(window.location.pathname),
        method,
        lang,
      });
      // On /events and the event pages the same tap is also an event
      // enquiry — the mobile bar's call button included, being a tel: link.
      if (isEventEnquiryPage(window.location.pathname)) {
        const corporate = new URLSearchParams(window.location.search).get("for") === "corporate";
        trackEventEnquiry({ method, event_type: corporate ? "corporate" : undefined });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [lang]);

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

    const tracked = new WeakSet();
    const observeReveals = () => {
      document.querySelectorAll(".reveal:not(.visible)").forEach((el) => {
        if (!tracked.has(el)) {
          tracked.add(el);
          observer.observe(el);
        }
      });
    };

    // First pass for elements rendered immediately.
    observeReveals();

    // Subsequent passes catch elements that React adds later — e.g. content
    // hydrated from async Sanity queries. Without this, reveal elements that
    // mount after the initial scan stay at opacity 0 forever.
    const mutationObserver = new MutationObserver(observeReveals);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
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
        {/* The Suspense boundary sits here rather than around <Routes>, so a
            route chunk arriving does not unmount the header and footer.

            The fallback is a full viewport tall, not the hero's 60vh. A
            60vh placeholder left the footer sitting in plain view about
            halfway down the screen, and when the route chunk mounted it was
            shoved off the bottom — one 0.40 layout shift, measured, which is
            most of a CLS budget spent on a spacer. At 100vh the footer
            starts below the fold, so it has nothing to shift within. */}
        <Suspense
          fallback={
            <div className="min-h-screen w-full bg-ink-950" aria-hidden="true" />
          }
        >
          <Outlet context={{ lang, t }} />
        </Suspense>
      </main>
      <Footer t={t} />
    </div>
  );
}
