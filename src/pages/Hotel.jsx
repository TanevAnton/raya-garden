import { useOutletContext } from "react-router-dom";
import { Users, Ruler, Eye, Check, ArrowRight } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { rooms, IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";

export default function Hotel() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.hotel;
  const list = rooms[lang];
  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: `${IMG}/hotel-all-5.png`,
    path: "/hotel",
    lang,
  });

  return (
    <>
      <PageHero
        image={`${IMG}/hotel-all-5.png`}
        eyebrow={tp.eyebrow}
        title={tp.title}
        subtitle={tp.subtitle}
      />

      {/* Intro */}
      <section className="py-20 md:py-28 bg-ink-950">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg lg:text-xl text-cream-100/85 leading-relaxed font-light">
            {tp.intro}
          </p>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
      </section>

      {/* Rooms */}
      <section className="bg-ink-950 pb-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 space-y-10">
          {list.map((r, i) => (
            <article
              key={r.id}
              className="reveal grid md:grid-cols-12 gap-0 bg-ink-900 border border-gold-300/10 overflow-hidden group hover:border-gold-300/30 transition-colors duration-700"
            >
              <div className={`md:col-span-7 relative aspect-[4/3] md:aspect-auto overflow-hidden ${i % 2 ? "md:order-2" : ""}`}>
                <img
                  src={r.image}
                  alt={r.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover img-luxury group-hover:scale-105 transition-transform duration-[1400ms]"
                />
              </div>

              <div className={`md:col-span-5 p-8 md:p-12 flex flex-col justify-between ${i % 2 ? "md:order-1" : ""}`}>
                <div>
                  <div className="flex items-center gap-3 text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-4">
                    <span className="font-mono text-gold-300/60">0{i + 1}</span>
                    <div className="w-8 h-px bg-gold-300/40" />
                    <span>{r.id}</span>
                  </div>
                  <h2 className="font-display text-3xl lg:text-4xl text-cream-50 mb-6 leading-tight">
                    {r.name}
                  </h2>

                  <div className="flex flex-wrap gap-6 text-sm text-cream-100/70 mb-8">
                    <div className="flex items-center gap-2">
                      <Ruler className="w-4 h-4 text-gold-300" />
                      <span>{r.size} {tp.size}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-gold-300" />
                      <span>{tp.sleeps} {r.sleeps} {tp.guests}</span>
                    </div>
                  </div>

                  <div className="text-sm text-cream-100/60 mb-2">{tp.view}</div>
                  <div className="text-sm text-cream-100/85 mb-6">{r.view}</div>

                  <div className="text-sm text-cream-100/60 mb-3">{tp.amenities}</div>
                  <ul className="space-y-2 mb-8">
                    {r.amenities.slice(0, 5).map((a, ai) => (
                      <li key={ai} className="flex items-start gap-2 text-sm text-cream-100/80">
                        <Check className="w-3.5 h-3.5 text-gold-300 flex-shrink-0 mt-1" />
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-4 pt-6 border-t border-gold-300/10">
                  <div>
                    <div className="text-xs tracking-[0.3em] uppercase text-gold-300/70">
                      {tp.from}
                    </div>
                    <div className="font-display text-4xl gradient-gold leading-none mt-1">
                      {r.price}
                    </div>
                    <div className="text-xs text-cream-100/55 mt-1">{tp.perNight}</div>
                  </div>
                  <a
                    href="https://sky-eu1.clock-software.com/60837/10183/wbe/products/new"
                    target="_blank"
                    rel="noreferrer"
                    className="btn-gold px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-2"
                  >
                    {tp.book}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Included */}
      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="text-center mb-12 reveal">
            <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
              {tp.included}
            </span>
            <div className="divider-gold mt-6 w-32 mx-auto" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 reveal">
            {tp.includedItems.map((item, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-ink-950/50 p-5 border border-gold-300/10"
              >
                <Check className="w-5 h-5 text-gold-300 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-cream-100/80">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
