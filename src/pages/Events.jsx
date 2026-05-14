import { useOutletContext } from "react-router-dom";
import { Heart, Briefcase, Users, Check, ArrowRight, Phone } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { eventsPackages as fallback, IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "events"][0]{
  eyebrow, title, subtitle, intro, heroImage,
  blocks[]{key, title, body}
}`;
const PACKAGES_QUERY = `*[_type == "eventPackage"] | order(kind asc, order asc){
  _id, kind, tier, from, capacity, includes
}`;

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

function PackageCard({ p, i, tp }) {
  return (
    <article className="reveal bg-ink-900 border border-gold-300/10 hover:border-gold-300/30 transition-all duration-700 p-8 md:p-10 flex flex-col">
      <div className="flex items-center gap-3 mb-5">
        <span className="font-mono text-xs tracking-[0.3em] uppercase text-gold-300/60">
          0{i + 1}
        </span>
        <div className="w-8 h-px bg-gold-300/40" />
      </div>
      <h3 className="font-display text-2xl md:text-3xl text-cream-50 mb-3">
        {p.tier}
      </h3>
      <div className="text-sm gradient-gold font-medium mb-2">{p.from}</div>
      <div className="flex items-center gap-2 text-xs text-cream-100/55 mb-8">
        <Users className="w-3.5 h-3.5 text-gold-300" />
        <span>
          {tp.capacity}: {p.capacity}
        </span>
      </div>

      <div className="text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-4">
        {tp.whatsIncluded}
      </div>
      <ul className="space-y-2 mb-8 flex-1">
        {p.includes.map((item, j) => (
          <li key={j} className="flex items-start gap-2 text-sm text-cream-100/80">
            <Check className="w-3.5 h-3.5 text-gold-300 flex-shrink-0 mt-1" />
            <span>{item}</span>
          </li>
        ))}
      </ul>

      <a
        href="tel:+359879107500"
        className="inline-flex items-center gap-3 text-xs tracking-[0.3em] uppercase text-gold-300 hover:gap-5 transition-all duration-500"
      >
        {tp.inquire}
        <ArrowRight className="w-3.5 h-3.5" />
      </a>
    </article>
  );
}

export default function Events() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.events;

  const { data: pageData } = useSanityQuery(PAGE_QUERY);
  const { data: packages } = useSanityQuery(PACKAGES_QUERY);

  const hero = pageData
    ? {
        eyebrow: pickLocale(pageData.eyebrow, lang) || tp.eyebrow,
        title: pickLocale(pageData.title, lang) || tp.title,
        subtitle: pickLocale(pageData.subtitle, lang) || tp.subtitle,
        intro: pickLocale(pageData.intro, lang) || tp.intro,
        image: pageData.heroImage
          ? urlFor(pageData.heroImage).width(2000).quality(80).url()
          : `${IMG}/hotel-all-9.png`,
      }
    : { eyebrow: tp.eyebrow, title: tp.title, subtitle: tp.subtitle, intro: tp.intro, image: `${IMG}/hotel-all-9.png` };

  const consultingBlock = findBlock(pageData?.blocks, "consulting");
  const consulting = pickLocale(consultingBlock?.title, lang) || tp.consulting;
  const consultingText = pickLocale(consultingBlock?.body, lang) || tp.consultingText;

  const localize = (pkg) => ({
    tier: pickLocale(pkg.tier, lang),
    from: pickLocale(pkg.from, lang),
    capacity: pickLocale(pkg.capacity, lang),
    includes: pkg.includes?.[lang] || pkg.includes?.bg || [],
  });

  const weddings = packages
    ? packages.filter((p) => p.kind === "wedding").map(localize)
    : fallback[lang].weddings;
  const corporate = packages
    ? packages.filter((p) => p.kind === "corporate").map(localize)
    : fallback[lang].corporate;

  useSeo({
    title: hero.title,
    description: hero.subtitle,
    image: hero.image,
    path: "/events",
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

      <section className="py-20 bg-ink-950">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg text-cream-100/85 leading-relaxed font-light">
            {hero.intro}
          </p>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
      </section>

      <section className="pb-20 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex items-center gap-5 mb-12 reveal">
            <Heart className="w-8 h-8 text-gold-300" />
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.weddings}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {weddings.map((p, i) => (
              <PackageCard key={i} p={p} i={i} tp={tp} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 bg-ink-900">
        <div className="max-w-7xl mx-auto px-6 lg:px-10">
          <div className="flex items-center gap-5 mb-12 reveal">
            <Briefcase className="w-8 h-8 text-gold-300" />
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.corporate}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {corporate.map((p, i) => (
              <PackageCard key={i} p={p} i={i} tp={tp} />
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 bg-ink-950">
        <div className="max-w-3xl mx-auto px-6 text-center reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {hero.eyebrow}
          </span>
          <h3 className="font-display text-3xl md:text-5xl text-cream-50 mt-5 mb-6 text-balance leading-tight">
            {consulting}
          </h3>
          <p className="text-base lg:text-lg text-cream-100/75 leading-relaxed mb-10">
            {consultingText}
          </p>
          <a
            href="tel:+359879107500"
            className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
          >
            <Phone className="w-4 h-4" />
            +359 879 107 500
          </a>
        </div>
      </section>
    </>
  );
}
