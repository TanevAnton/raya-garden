import { useOutletContext } from "react-router-dom";
import { Wine, ArrowRight } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";

export default function Winery() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.winery;
  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: `${IMG}/hotel-all-11.png`,
    path: "/winery",
    lang,
  });

  return (
    <>
      <PageHero
        image={`${IMG}/hotel-all-11.png`}
        eyebrow={tp.eyebrow}
        title={tp.title}
        subtitle={tp.subtitle}
      />

      {/* Story */}
      <section className="py-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-12 gap-10 lg:gap-16 items-center">
            <div className="md:col-span-6 reveal">
              <div className="relative aspect-[4/5] overflow-hidden">
                <img
                  src={`${IMG}/hotel-all-12.png`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover img-luxury"
                />
                <div className="absolute inset-0 ring-1 ring-inset ring-gold-300/10 pointer-events-none" />
                <div className="absolute -bottom-1 -right-1 w-20 h-20 border-r-2 border-b-2 border-gold-300 pointer-events-none" />
              </div>
            </div>
            <div className="md:col-span-6 reveal">
              <Wine className="w-8 h-8 text-gold-300 mb-6" />
              <p className="text-lg text-cream-100/85 leading-relaxed font-light mb-6">
                {tp.story}
              </p>
              <p className="text-base text-cream-100/65 leading-relaxed">
                {tp.story2}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Wine list */}
      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-12 reveal">
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.wines}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <ul className="space-y-8 reveal">
            {tp.wineList.map((w, i) => (
              <li key={i} className="group">
                <div className="flex items-baseline gap-4">
                  <h3 className="font-display text-2xl md:text-3xl text-cream-50 group-hover:text-gold-200 transition-colors">
                    {w.name}
                  </h3>
                  <div className="flex-1 border-b border-dotted border-gold-300/20" />
                  <span className="text-sm text-gold-300/80 whitespace-nowrap">
                    {w.year}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 text-xs tracking-[0.2em] uppercase text-gold-300/70 mt-1.5">
                  {w.type}
                </div>
                <p className="text-sm text-cream-100/60 mt-2 max-w-2xl">{w.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Visit CTA */}
      <section className="py-24 bg-ink-950">
        <div className="max-w-3xl mx-auto px-6 text-center reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {tp.eyebrow}
          </span>
          <h3 className="font-display text-3xl md:text-5xl text-cream-50 mt-5 mb-6">
            {tp.visit}
          </h3>
          <p className="text-cream-100/75 mb-10">{tp.visitText}</p>
          <a
            href="tel:+359879107500"
            className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
          >
            +359 879 107 500
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </>
  );
}
