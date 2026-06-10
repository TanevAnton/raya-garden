import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useSeo } from "../hooks/useSeo.js";
import {
  WBE_BASE_URL,
  openBooking,
  searchAvailability,
} from "../lib/clockWbe.js";

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function defaultDates() {
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  return { arrival: isoDate(today), departure: isoDate(tomorrow) };
}

// /book — the on-site booking page. Picking dates (or "browse all rooms")
// opens the official Clock booking overlay, which keeps the guest on our
// domain and reports the funnel to the GA4 property configured in Clock.
// If the integration script hasn't loaded, every action falls back to
// opening the engine directly.
export default function Reservations() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.reservations;

  const [{ arrival, departure }, setDates] = useState(defaultDates);
  const [adults, setAdults] = useState(2);
  const [promo, setPromo] = useState("");

  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: null,
    path: "/book",
    lang,
  });

  const onSubmit = (e) => {
    e.preventDefault();
    const ok = searchAvailability({
      arrival,
      departure,
      adults: Number(adults) || 2,
      bonusCode: promo || null,
    });
    if (!ok) window.open(WBE_BASE_URL, "_blank", "noopener");
  };

  const onBrowse = () => {
    if (!openBooking()) window.open(WBE_BASE_URL, "_blank", "noopener");
  };

  const inputClass =
    "w-full bg-ink-950 border border-gold-300/15 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition";

  return (
    <section className="bg-ink-950 pt-28 md:pt-32 pb-24 min-h-screen">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-10">
        <div className="text-center mb-12 reveal">
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

        <form
          onSubmit={onSubmit}
          className="reveal bg-ink-900 border border-gold-300/15 p-6 sm:p-8 lg:p-10 rounded-sm"
        >
          <div className="grid sm:grid-cols-2 gap-5">
            <label className="block">
              <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                {tp.arrivalLabel}
              </span>
              <input
                type="date"
                required
                value={arrival}
                min={isoDate(new Date())}
                onChange={(e) =>
                  setDates((d) => ({ ...d, arrival: e.target.value }))
                }
                className={`${inputClass} [color-scheme:dark]`}
              />
            </label>
            <label className="block">
              <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                {tp.departureLabel}
              </span>
              <input
                type="date"
                required
                value={departure}
                min={arrival}
                onChange={(e) =>
                  setDates((d) => ({ ...d, departure: e.target.value }))
                }
                className={`${inputClass} [color-scheme:dark]`}
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-5 mt-5">
            <label className="block">
              <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                {tp.guestsLabel}
              </span>
              <input
                type="number"
                min={1}
                max={10}
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                {tp.promoLabel}
              </span>
              <input
                type="text"
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <button
            type="submit"
            className="btn-gold w-full mt-7 px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center justify-center gap-3"
          >
            {tp.searchCta}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center mt-8 reveal">
          <div className="text-xs uppercase tracking-[0.3em] text-cream-100/40 mb-4">
            {tp.orText}
          </div>
          <button
            type="button"
            onClick={onBrowse}
            className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center gap-3"
          >
            {tp.browseAll}
            <ArrowRight className="w-4 h-4" />
          </button>
          <div className="mt-6">
            <a
              href={WBE_BASE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs tracking-[0.25em] uppercase text-gold-300/70 hover:text-gold-200 transition-colors"
            >
              {tp.openNewTab}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
