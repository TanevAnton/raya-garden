import { Link } from "react-router-dom";
import { Instagram, Facebook } from "lucide-react";
import { Logo } from "./Nav.jsx";

export default function Footer({ t }) {
  return (
    <footer className="bg-ink-950 border-t border-gold-300/10">
      <div className="max-w-7xl mx-auto px-6 lg:px-10 py-16">
        <div className="grid md:grid-cols-12 gap-10">
          <div className="md:col-span-4">
            <Logo />
            <p className="text-sm text-cream-100/60 mt-6 max-w-sm leading-relaxed">
              {t.footer.tagline}
            </p>
          </div>

          <div className="md:col-span-3">
            <div className="text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-5">
              {t.footer.explore}
            </div>
            <ul className="space-y-2 text-sm text-cream-100/70">
              <li>
                <Link to="/hotel" className="hover:text-gold-200 transition-colors">
                  {t.nav.hotel}
                </Link>
              </li>
              <li>
                <Link to="/restaurant" className="hover:text-gold-200 transition-colors">
                  {t.nav.restaurant}
                </Link>
              </li>
              <li>
                <Link to="/winery" className="hover:text-gold-200 transition-colors">
                  {t.nav.winery}
                </Link>
              </li>
              <li>
                <Link to="/lake" className="hover:text-gold-200 transition-colors">
                  {t.nav.lake}
                </Link>
              </li>
              <li>
                <Link to="/events" className="hover:text-gold-200 transition-colors">
                  {t.nav.events}
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3">
            <div className="text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-5">
              {t.nav.contact}
            </div>
            <div className="space-y-2 text-sm text-cream-100/70">
              <div>{t.contact.address}</div>
              <a
                href="tel:+359879107500"
                className="block hover:text-gold-200 transition-colors"
              >
                {t.contact.phone}
              </a>
              <a
                href="mailto:hotel@svetagora.bg"
                className="block hover:text-gold-200 transition-colors"
              >
                hotel@svetagora.bg
              </a>
            </div>
          </div>

          <div className="md:col-span-2">
            <div className="text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-5">
              Social
            </div>
            <div className="flex gap-3">
              <a
                href="https://www.instagram.com/raya.garden/"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-full border border-gold-300/30 flex items-center justify-center text-gold-200 hover:bg-gold-300/10 transition-all"
                aria-label="Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://www.facebook.com/hotel.sveta.gora"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-full border border-gold-300/30 flex items-center justify-center text-gold-200 hover:bg-gold-300/10 transition-all"
                aria-label="Facebook"
              >
                <Facebook className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>

        <div className="divider-gold mt-16" />

        <div className="flex flex-col sm:flex-row justify-between gap-4 mt-8 text-xs text-cream-100/45">
          <div>
            © {new Date().getFullYear()} Park Hotel RAYA Garden. {t.footer.rights}
          </div>
          <div className="flex gap-6">
            <Link to="/contact" className="hover:text-gold-200 transition-colors">
              {t.footer.links.privacy}
            </Link>
            <Link to="/contact" className="hover:text-gold-200 transition-colors">
              {t.footer.links.cookies}
            </Link>
            <Link to="/contact" className="hover:text-gold-200 transition-colors">
              {t.footer.links.terms}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
