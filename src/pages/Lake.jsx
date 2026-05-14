import { useOutletContext } from "react-router-dom";
import { Fish, Check, ArrowRight } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { lakePricing, IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";

export default function Lake() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.lake;
  const data = lakePricing[lang];
  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: `${IMG}/hotel-all-14.png`,
    path: "/lake",
    lang,
  });

  return (
    <>
      <PageHero
        image={`${IMG}/hotel-all-14.png`}
        eyebrow={tp.eyebrow}
        title={tp.title}
        subtitle={tp.subtitle}
      />

      <section className="py-20 bg-ink-950">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg text-cream-100/85 leading-relaxed font-light">
            {tp.intro}
          </p>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
      </section>

      {/* Daily pricing */}
      <section className="pb-12 bg-ink-950">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-10 reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50">
              {tp.daily}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 reveal">
            {data.daily.map((d, i) => (
              <div
                key={i}
                className="flex items-center justify-between bg-ink-900 p-6 border border-gold-300/10"
              >
                <span className="text-sm text-cream-100/80">{d.label}</span>
                <span className="font-display text-xl gradient-gold whitespace-nowrap">
                  {d.price}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Fish species pricing */}
      <section className="py-12 bg-ink-950">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-10 reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50">
              {tp.species}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 reveal">
            {data.fish.map((f, i) => (
              <div
                key={i}
                className="bg-ink-900 p-6 border border-gold-300/10 hover:border-gold-300/30 transition-colors group"
              >
                <Fish className="w-6 h-6 text-gold-300 mb-3 group-hover:scale-110 transition-transform" />
                <div className="font-display text-xl text-cream-50">{f.name}</div>
                <div className="text-sm gradient-gold font-medium mt-2">{f.price}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Rules + Included two-column */}
      <section className="py-16 bg-ink-900">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-2 gap-10 lg:gap-16">
          <div className="reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-8">
              {tp.rules}
            </h2>
            <ul className="space-y-3">
              {data.rules.map((r, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-cream-100/80 text-sm"
                >
                  <span className="mt-1.5 w-4 h-px bg-gold-300 flex-shrink-0" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-8">
              {tp.included}
            </h2>
            <ul className="space-y-3">
              {data.includes.map((r, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-cream-100/80 text-sm"
                >
                  <Check className="w-4 h-4 text-gold-300 flex-shrink-0 mt-0.5" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-ink-950 text-center">
        <div className="max-w-3xl mx-auto px-6 reveal">
          <a
            href="tel:+359879107500"
            className="btn-gold inline-flex items-center gap-3 px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm"
          >
            {tp.reserve}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>
    </>
  );
}
