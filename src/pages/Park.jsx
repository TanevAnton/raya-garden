import { useOutletContext } from "react-router-dom";
import { Trees, MapPin } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";

export default function Park() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.park;
  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: `${IMG}/hotel-all-17.png`,
    path: "/park",
    lang,
  });

  return (
    <>
      <PageHero
        image={`${IMG}/hotel-all-17.png`}
        eyebrow={tp.eyebrow}
        title={tp.title}
        subtitle={tp.subtitle}
      />

      {/* Park & City split */}
      <section className="py-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-2 gap-10 lg:gap-16">
          <div className="reveal">
            <div className="relative aspect-[4/3] overflow-hidden mb-8">
              <img
                src={`${IMG}/hotel-all-17.png`}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover img-luxury"
              />
            </div>
            <Trees className="w-7 h-7 text-gold-300 mb-4" />
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4">
              {tp.parkTitle}
            </h2>
            <p className="text-cream-100/75 leading-relaxed">{tp.parkText}</p>
          </div>
          <div className="reveal">
            <div className="relative aspect-[4/3] overflow-hidden mb-8">
              <img
                src={`${IMG}/hotel-all-15.png`}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover img-luxury"
              />
            </div>
            <MapPin className="w-7 h-7 text-gold-300 mb-4" />
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4">
              {tp.cityTitle}
            </h2>
            <p className="text-cream-100/75 leading-relaxed">{tp.cityText}</p>
          </div>
        </div>
      </section>

      {/* Attractions */}
      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-12 reveal">
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.attractions}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <ul className="grid sm:grid-cols-2 gap-6 reveal">
            {tp.attractionsList.map((a, i) => (
              <li
                key={i}
                className="bg-ink-950/60 p-6 border border-gold-300/10 hover:border-gold-300/30 transition-colors group"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-gold-300/60">0{i + 1}</span>
                  <h3 className="font-display text-xl text-cream-50 group-hover:text-gold-200 transition-colors">
                    {a.name}
                  </h3>
                </div>
                <p className="text-sm text-cream-100/60 mt-2 pl-8">{a.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
