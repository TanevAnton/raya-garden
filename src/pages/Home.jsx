import { useState, useEffect } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowRight,
  ChevronDown,
  Calendar,
  Phone,
  Sparkles,
  Leaf,
  Heart,
  Briefcase,
  Baby,
  Trees,
} from "lucide-react";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const HOME_QUERY = `*[_type == "pageContent" && page == "home"][0]{
  eyebrow, title, titleAccent, subtitle, heroImage,
  blocks[]{key, body}
}`;
const OFFERS_QUERY = `*[_type == "specialOffer" && active == true] | order(order asc){
  _id, tag, title, text, image, ctaLink
}`;

const heroImages = [
  `${IMG}/hotel-all-1.png`,
  `${IMG}/hotel-all-5.png`,
  `${IMG}/hotel-all-9.png`,
  `${IMG}/hotel-all-14.png`,
];

function Hero({ t, heroImageOverride }) {
  // If Sanity has a hero image, lead with it and rotate through the
  // remaining static photos. Otherwise rotate through the static list.
  const slides = heroImageOverride
    ? [heroImageOverride, ...heroImages.slice(1)]
    : heroImages;

  const [current, setCurrent] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setCurrent((c) => (c + 1) % slides.length), 6500);
    return () => clearInterval(i);
  }, [slides.length]);

  return (
    <section id="home" className="relative h-screen min-h-[700px] w-full overflow-hidden grain">
      {slides.map((src, i) => (
        <div
          key={src}
          className={`absolute inset-0 transition-opacity duration-[2500ms] ${
            i === current ? "opacity-100" : "opacity-0"
          }`}
        >
          <img
            src={src}
            alt=""
            className="w-full h-full object-cover animate-slow-zoom"
            loading={i === 0 ? "eager" : "lazy"}
          />
        </div>
      ))}
      <div className="absolute inset-0 gradient-overlay-dark pointer-events-none" />
      <div className="absolute inset-0 gradient-overlay-vignette pointer-events-none" />

      <div className="relative z-10 h-full flex flex-col justify-center max-w-7xl mx-auto px-6 lg:px-10">
        <div className="max-w-3xl animate-fade-up">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-px bg-gold-300" />
            <span className="text-xs tracking-[0.4em] uppercase text-gold-200/90">
              {t.hero.eyebrow}
            </span>
          </div>
          <h1 className="font-display text-6xl sm:text-7xl lg:text-8xl xl:text-9xl leading-[0.95] text-cream-50 text-shadow-lg mb-8 text-balance">
            {t.hero.title}
            <br />
            <em className="italic gradient-gold font-light">{t.hero.titleAccent}</em>
          </h1>
          <p className="text-base sm:text-lg text-cream-100/85 max-w-xl leading-relaxed mb-10 text-shadow-lg">
            {t.hero.subtitle}
          </p>
          <div className="flex flex-wrap gap-4">
            <a
              href="https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003"
              target="_blank"
              rel="noreferrer"
              className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center gap-3"
            >
              {t.hero.cta1}
              <ArrowRight className="w-4 h-4" />
            </a>
            <Link
              to="/restaurant"
              className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center gap-3"
            >
              {t.hero.cta2}
            </Link>
          </div>
        </div>

        <div className="absolute bottom-12 right-6 lg:right-10 flex gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-px transition-all duration-700 ${
                i === current ? "w-12 bg-gold-300" : "w-6 bg-cream-100/30"
              }`}
            />
          ))}
        </div>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-scroll-hint">
          <span className="text-[10px] tracking-[0.4em] uppercase text-cream-100/60">
            {t.hero.scroll}
          </span>
          <ChevronDown className="w-4 h-4 text-gold-300" />
        </div>
      </div>
    </section>
  );
}

function Welcome({ t }) {
  return (
    <section className="relative py-24 md:py-32 bg-ink-950">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="grid md:grid-cols-12 gap-10 lg:gap-20 items-start">
          <div className="md:col-span-5 reveal">
            <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
              {t.welcome.eyebrow}
            </span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] text-cream-50 mt-6 text-balance">
              {t.welcome.title}
            </h2>
            <div className="divider-gold mt-10 w-32" />
          </div>
          <div className="md:col-span-7 reveal">
            <p className="text-lg text-cream-100/85 leading-relaxed mb-6 font-light">
              {t.welcome.lead}
            </p>
            <p className="text-base text-cream-100/65 leading-relaxed">
              {t.welcome.body}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-gold-300/10 mt-20 border border-gold-300/10 reveal">
          {[t.welcome.stat1, t.welcome.stat2, t.welcome.stat3, t.welcome.stat4].map(
            (s, i) => (
              <div
                key={i}
                className="bg-ink-950 p-8 md:p-10 text-center hover:bg-ink-900 transition-colors duration-500"
              >
                <div className="font-display text-5xl md:text-6xl gradient-gold">
                  {s.num}
                </div>
                <div className="mt-3 text-xs tracking-[0.3em] uppercase text-cream-100/60">
                  {s.label}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}

function SectionCard({ to, tag, title, text, cta, image, reverse }) {
  return (
    <section className="relative py-20 md:py-28 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div
          className={`grid md:grid-cols-12 gap-10 lg:gap-16 items-center ${
            reverse ? "md:[direction:rtl]" : ""
          }`}
        >
          <div className={`md:col-span-7 reveal ${reverse ? "md:[direction:ltr]" : ""}`}>
            <Link to={to} className="block">
              <div className="relative aspect-[4/3] overflow-hidden group">
                <img
                  src={image}
                  alt={title}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover img-luxury group-hover:scale-[1.04] transition-transform duration-[1200ms]"
                />
                <div className="absolute inset-0 ring-1 ring-inset ring-gold-300/10 pointer-events-none" />
                <div className="absolute -bottom-1 -right-1 w-20 h-20 border-r-2 border-b-2 border-gold-300 pointer-events-none" />
                <div className="absolute -top-1 -left-1 w-20 h-20 border-l-2 border-t-2 border-gold-300/50 pointer-events-none" />
              </div>
            </Link>
          </div>
          <div className={`md:col-span-5 reveal ${reverse ? "md:[direction:ltr]" : ""}`}>
            <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">{tag}</span>
            <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] text-cream-50 mt-5 mb-8 text-balance">
              {title}
            </h2>
            <p className="text-base lg:text-lg text-cream-100/75 leading-relaxed mb-8 font-light">
              {text}
            </p>
            <Link
              to={to}
              className="inline-flex items-center gap-4 text-xs tracking-[0.3em] uppercase text-gold-300 hover:text-gold-200 transition-colors duration-500 group"
            >
              <span>{cta}</span>
              <span className="w-8 h-px bg-gold-300 group-hover:w-14 transition-all duration-500" />
              <ArrowRight className="w-4 h-4 transition-transform duration-500 group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Experience({ t }) {
  const icons = [Leaf, Sparkles, Heart, Briefcase, Baby, Trees];
  return (
    <section className="relative py-24 md:py-36 bg-gradient-to-b from-ink-950 to-ink-900">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-20 reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {t.experience.eyebrow}
          </span>
          <h2 className="font-display text-4xl md:text-6xl lg:text-7xl leading-[1.05] text-cream-50 mt-6 text-balance max-w-3xl mx-auto">
            {t.experience.title}
          </h2>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gold-300/10 border border-gold-300/10 reveal">
          {t.experience.items.map((item, i) => {
            const Icon = icons[i % icons.length];
            return (
              <div
                key={i}
                className="bg-ink-900 p-10 group hover:bg-ink-800 transition-all duration-500 cursor-default"
              >
                <Icon className="w-7 h-7 text-gold-300 mb-6 transition-transform duration-500 group-hover:scale-110" />
                <h3 className="font-display text-2xl text-cream-50 mb-3">{item.title}</h3>
                <p className="text-sm text-cream-100/70 leading-relaxed">{item.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CtaBanner({ t }) {
  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      <div className="absolute inset-0">
        <img
          src={`${IMG}/hotel-all-16.png`}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-ink-950/80" />
        <div className="absolute inset-0 gradient-overlay-vignette" />
      </div>
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center reveal">
        <span className="text-xs tracking-[0.4em] uppercase text-gold-300/90">
          {t.cta.eyebrow}
        </span>
        <h2 className="font-display text-4xl md:text-6xl lg:text-7xl text-cream-50 mt-6 mb-8 text-balance leading-[1.05]">
          {t.cta.title}
        </h2>
        <p className="text-base md:text-lg text-cream-100/80 max-w-2xl mx-auto mb-12 leading-relaxed">
          {t.cta.text}
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003"
            target="_blank"
            rel="noreferrer"
            className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center gap-3"
          >
            {t.cta.btn1}
            <Calendar className="w-4 h-4" />
          </a>
          <a
            href="tel:+359879107500"
            className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center gap-3"
          >
            <Phone className="w-4 h-4" />
            {t.cta.btn2}
          </a>
        </div>
      </div>
    </section>
  );
}

function Offers({ t, lang, offers }) {
  return (
    <section className="relative py-24 md:py-32 bg-ink-900">
      <div className="max-w-7xl mx-auto px-6 lg:px-10">
        <div className="text-center mb-16 reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {t.offers.eyebrow}
          </span>
          <h2 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1.05] text-cream-50 mt-6 text-balance">
            {t.offers.title}
          </h2>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 reveal">
          {offers.map((o) => {
            const image = o.image ? urlFor(o.image).width(800).quality(80).url() : null;
            return (
              <article
                key={o._id}
                className="group bg-ink-950 border border-gold-300/10 hover:border-gold-300/30 transition-colors duration-700 overflow-hidden flex flex-col"
              >
                {image && (
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover img-luxury group-hover:scale-105 transition-transform duration-[1200ms]"
                    />
                  </div>
                )}
                <div className="p-8 flex flex-col flex-1">
                  <span className="text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-3">
                    {pickLocale(o.tag, lang)}
                  </span>
                  <h3 className="font-display text-2xl text-cream-50 mb-3 leading-tight">
                    {pickLocale(o.title, lang)}
                  </h3>
                  <p className="text-sm text-cream-100/70 leading-relaxed flex-1">
                    {pickLocale(o.text, lang)}
                  </p>
                  <a
                    href={o.ctaLink || "/contact"}
                    target={o.ctaLink ? "_blank" : undefined}
                    rel={o.ctaLink ? "noreferrer" : undefined}
                    className="inline-flex items-center gap-3 text-xs tracking-[0.3em] uppercase text-gold-300 hover:gap-5 transition-all duration-500 mt-6"
                  >
                    {t.offers.cta}
                    <ArrowRight className="w-3.5 h-3.5" />
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { lang, t } = useOutletContext();
  const { data: pageData } = useSanityQuery(HOME_QUERY);
  const { data: offers } = useSanityQuery(OFFERS_QUERY);

  // Compose a tCMS object that mirrors the shape Hero/Welcome/CtaBanner
  // expect, with Sanity values when present and translations.js as fallback.
  const findBlock = (key) => pageData?.blocks?.find((b) => b.key === key);
  const heroImage = pageData?.heroImage
    ? urlFor(pageData.heroImage).width(2400).quality(85).url()
    : null;

  const tCMS = {
    ...t,
    hero: {
      ...t.hero,
      eyebrow: pickLocale(pageData?.eyebrow, lang) || t.hero.eyebrow,
      title: pickLocale(pageData?.title, lang) || t.hero.title,
      titleAccent: pickLocale(pageData?.titleAccent, lang) || t.hero.titleAccent,
      subtitle: pickLocale(pageData?.subtitle, lang) || t.hero.subtitle,
    },
    welcome: {
      ...t.welcome,
      lead: pickLocale(pageData?.intro, lang) || t.welcome.lead,
      body: pickLocale(findBlock("welcomeBody")?.body, lang) || t.welcome.body,
    },
    cta: {
      ...t.cta,
      title: pickLocale(findBlock("ctaTitle")?.body, lang) || t.cta.title,
      text: pickLocale(findBlock("ctaText")?.body, lang) || t.cta.text,
    },
  };

  useSeo({
    title: null,
    description: tCMS.hero.subtitle,
    image: heroImage || `${IMG}/hotel-all-1.png`,
    path: "/",
    lang,
  });

  return (
    <>
      <Hero t={tCMS} heroImageOverride={heroImage} />
      <Welcome t={tCMS} />
      {offers && offers.length > 0 && <Offers t={tCMS} lang={lang} offers={offers} />}
      <SectionCard
        to="/hotel"
        tag={t.sections.hotel.tag}
        title={t.sections.hotel.title}
        text={t.sections.hotel.text}
        cta={t.sections.hotel.cta}
        image={`${IMG}/hotel-all-3.png`}
      />
      <SectionCard
        to="/restaurant"
        tag={t.sections.restaurant.tag}
        title={t.sections.restaurant.title}
        text={t.sections.restaurant.text}
        cta={t.sections.restaurant.cta}
        image={`${IMG}/hotel-all-8.png`}
        reverse
      />
      <SectionCard
        to="/winery"
        tag={t.sections.winery.tag}
        title={t.sections.winery.title}
        text={t.sections.winery.text}
        cta={t.sections.winery.cta}
        image={`${IMG}/hotel-all-11.png`}
      />
      <SectionCard
        to="/lake"
        tag={t.sections.lake.tag}
        title={t.sections.lake.title}
        text={t.sections.lake.text}
        cta={t.sections.lake.cta}
        image={`${IMG}/hotel-all-14.png`}
        reverse
      />
      <SectionCard
        to="/park"
        tag={t.sections.park.tag}
        title={t.sections.park.title}
        text={t.sections.park.text}
        cta={t.sections.park.cta}
        image={`${IMG}/hotel-all-17.png`}
      />
      <Experience t={tCMS} />
      <CtaBanner t={tCMS} />
    </>
  );
}
