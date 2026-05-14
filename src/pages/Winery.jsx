import { useOutletContext } from "react-router-dom";
import { Wine, ArrowRight } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "winery"][0]{
  eyebrow, title, subtitle, heroImage, extraImages,
  blocks[]{key, title, body}
}`;
const WINES_QUERY = `*[_type == "wine"] | order(order asc) { _id, name, type, year, note }`;

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

export default function Winery() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.winery;

  const { data: pageData } = useSanityQuery(PAGE_QUERY);
  const { data: winesData } = useSanityQuery(WINES_QUERY);

  const hero = pageData
    ? {
        eyebrow: pickLocale(pageData.eyebrow, lang) || tp.eyebrow,
        title: pickLocale(pageData.title, lang) || tp.title,
        subtitle: pickLocale(pageData.subtitle, lang) || tp.subtitle,
        image: pageData.heroImage
          ? urlFor(pageData.heroImage).width(2000).quality(80).url()
          : `${IMG}/hotel-all-11.png`,
        secondaryImage:
          pageData.extraImages?.[0]
            ? urlFor(pageData.extraImages[0]).width(1200).quality(80).url()
            : `${IMG}/hotel-all-12.png`,
      }
    : {
        eyebrow: tp.eyebrow,
        title: tp.title,
        subtitle: tp.subtitle,
        image: `${IMG}/hotel-all-11.png`,
        secondaryImage: `${IMG}/hotel-all-12.png`,
      };

  const story = pickLocale(findBlock(pageData?.blocks, "story")?.body, lang) || tp.story;
  const story2 = pickLocale(findBlock(pageData?.blocks, "story2")?.body, lang) || tp.story2;
  const visitText = pickLocale(findBlock(pageData?.blocks, "visitText")?.body, lang) || tp.visitText;

  const wines = winesData
    ? winesData.map((w) => ({
        name: pickLocale(w.name, lang),
        type: pickLocale(w.type, lang),
        year: w.year,
        note: pickLocale(w.note, lang),
      }))
    : tp.wineList;

  useSeo({
    title: hero.title,
    description: hero.subtitle,
    image: hero.image,
    path: "/winery",
    lang,
  });

  return (
    <>
      <PageHero
        image={hero.image}
        eyebrow={hero.eyebrow}
        title={hero.title}
        subtitle={hero.subtitle}
      />

      <section className="py-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="grid md:grid-cols-12 gap-10 lg:gap-16 items-center">
            <div className="md:col-span-6 reveal">
              <div className="relative aspect-[4/5] overflow-hidden">
                <img
                  src={hero.secondaryImage}
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
                {story}
              </p>
              <p className="text-base text-cream-100/65 leading-relaxed">
                {story2}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-12 reveal">
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.wines}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <ul className="space-y-8 reveal">
            {wines.map((w, i) => (
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

      <section className="py-24 bg-ink-950">
        <div className="max-w-3xl mx-auto px-6 text-center reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {hero.eyebrow}
          </span>
          <h3 className="font-display text-3xl md:text-5xl text-cream-50 mt-5 mb-6">
            {tp.visit}
          </h3>
          <p className="text-cream-100/75 mb-10">{visitText}</p>
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
