import { useOutletContext } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";

// The Clock PMS+ web booking engine. It sends `frame-ancestors *` and no
// X-Frame-Options, so it can be embedded inline in an iframe. The URL is
// editable in Studio (siteSettings.bookingUrl); this is the fallback.
const BOOKING_QUERY = `*[_type == "siteSettings"][0].bookingUrl`;
const FALLBACK_BOOKING_URL =
  "https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003";

export default function Reservations() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.reservations;

  const { data: bookingUrlFromSanity } = useSanityQuery(BOOKING_QUERY);
  const bookingUrl = bookingUrlFromSanity || FALLBACK_BOOKING_URL;

  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: null,
    path: "/book",
    lang,
  });

  return (
    <section className="bg-ink-950 pt-28 md:pt-32 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="text-center mb-10 reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {tp.eyebrow}
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-cream-50 mt-5 text-balance">
            {tp.title}
          </h1>
          <p className="text-base lg:text-lg text-cream-100/75 mt-5 max-w-2xl mx-auto font-light">
            {tp.subtitle}
          </p>
          <div className="divider-gold mt-8 w-32 mx-auto" />
        </div>

        {/* Booking engine, embedded inline. Cross-origin, so it manages its
            own internal scroll — we give it a tall, viewport-based canvas. */}
        <div className="relative border border-gold-300/15 bg-ink-900/40 overflow-hidden rounded-sm">
          <iframe
            title={tp.title}
            src={bookingUrl}
            className="w-full h-[calc(100vh-170px)] min-h-[760px]"
            style={{ border: 0 }}
            loading="eager"
            allow="payment"
          />
        </div>

        <div className="text-center mt-6">
          <a
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-xs tracking-[0.25em] uppercase text-gold-300/80 hover:text-gold-200 transition-colors"
          >
            {tp.openNewTab}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </section>
  );
}
