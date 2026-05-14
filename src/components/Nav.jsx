import { useState, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Menu, X, ArrowRight } from "lucide-react";

export function Logo({ className = "" }) {
  return (
    <Link to="/" className={`flex items-center gap-3 group ${className}`}>
      <div className="w-10 h-10 rounded-full border border-gold-300/60 flex items-center justify-center transition-transform duration-700 group-hover:rotate-180">
        <span className="font-display text-gold-200 text-xl leading-none">R</span>
      </div>
      <div className="leading-tight">
        <div className="font-display text-xl tracking-wider text-cream-50">
          RAYA <span className="text-gold-300">Garden</span>
        </div>
        <div className="text-[10px] tracking-[0.3em] uppercase text-gold-200/70">
          Park Hotel
        </div>
      </div>
    </Link>
  );
}

export default function Nav({ lang, setLang, t }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const links = [
    { to: "/hotel", label: t.nav.hotel },
    { to: "/restaurant", label: t.nav.restaurant },
    { to: "/winery", label: t.nav.winery },
    { to: "/lake", label: t.nav.lake },
    { to: "/park", label: t.nav.park },
    { to: "/events", label: t.nav.events },
    { to: "/contact", label: t.nav.contact },
  ];

  const isHome = pathname === "/";

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
        scrolled || !isHome
          ? "py-3 bg-ink-950/85 backdrop-blur-xl border-b border-gold-300/10"
          : "py-6 bg-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-10 flex items-center justify-between">
        <Logo />

        <nav className="hidden lg:flex items-center gap-7">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-sm tracking-wide transition-colors relative group ${
                  isActive ? "text-gold-300" : "text-cream-100/80 hover:text-gold-200"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {l.label}
                  <span
                    className={`absolute -bottom-1 left-0 h-px bg-gold-300 transition-all duration-500 ${
                      isActive ? "w-full" : "w-0 group-hover:w-full"
                    }`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <div
            className="hidden sm:flex items-center gap-1 text-xs tracking-wider"
            role="group"
            aria-label="Language"
          >
            <button
              type="button"
              onClick={() => setLang("bg")}
              aria-pressed={lang === "bg"}
              className={`px-2 py-1 transition-colors ${
                lang === "bg" ? "text-gold-300" : "text-cream-100/50 hover:text-cream-100"
              }`}
            >
              BG
            </button>
            <span className="text-cream-100/30" aria-hidden="true">|</span>
            <button
              type="button"
              onClick={() => setLang("en")}
              aria-pressed={lang === "en"}
              className={`px-2 py-1 transition-colors ${
                lang === "en" ? "text-gold-300" : "text-cream-100/50 hover:text-cream-100"
              }`}
            >
              EN
            </button>
          </div>

          <a
            href="https://sky-eu1.clock-software.com/60837/10183/wbe/products/new"
            target="_blank"
            rel="noreferrer"
            className="hidden md:inline-flex items-center gap-2 btn-gold px-5 py-2.5 text-xs tracking-[0.2em] uppercase font-medium rounded-sm"
          >
            {t.nav.book}
            <ArrowRight className="w-3.5 h-3.5" />
          </a>

          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="lg:hidden text-cream-50 p-2"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
          >
            {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        className={`lg:hidden overflow-hidden transition-all duration-500 ${
          open ? "max-h-[600px] mt-4" : "max-h-0"
        }`}
      >
        <div className="px-6 py-6 bg-ink-900/95 backdrop-blur-xl border-y border-gold-300/10">
          <nav className="flex flex-col gap-4">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="font-display text-2xl text-cream-50 hover:text-gold-300 transition"
              >
                {l.label}
              </Link>
            ))}
            <div className="flex gap-3 pt-4 border-t border-gold-300/10">
              <button
                onClick={() => setLang("bg")}
                className={`px-3 py-1.5 text-xs tracking-wider ${
                  lang === "bg" ? "text-gold-300" : "text-cream-100/50"
                }`}
              >
                BG
              </button>
              <button
                onClick={() => setLang("en")}
                className={`px-3 py-1.5 text-xs tracking-wider ${
                  lang === "en" ? "text-gold-300" : "text-cream-100/50"
                }`}
              >
                EN
              </button>
            </div>
            <a
              href="https://sky-eu1.clock-software.com/60837/10183/wbe/products/new"
              target="_blank"
              rel="noreferrer"
              className="btn-gold px-5 py-3 text-xs tracking-[0.2em] uppercase text-center rounded-sm mt-2"
            >
              {t.nav.book}
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
