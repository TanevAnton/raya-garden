import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Users,
  Ruler,
  Check,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { rooms as fallbackRooms, IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale, SANITY_ENABLED } from "../lib/sanity.js";

const ROOMS_QUERY = `*[_type == "room"] | order(order asc) {
  _id,
  "slug": slug.current,
  name, image, extraImages, price, size, sleeps, sleepsLabel, view, amenities
}`;

// Single photo → static img.
// Multiple → photo + prev/next arrows + dot indicators. Keyboard arrows
// scroll through too when the gallery has focus.
function RoomGallery({ images, alt }) {
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState({});
  const safeImages = images?.length ? images : [""];
  const count = safeImages.length;

  const go = (delta) =>
    setIdx((c) => (c + delta + count) % count);

  // Keep the visible slide's "loaded" state in sync if the user comes
  // back to an image they've already seen (img.complete is true).
  const imgRef = useRef(null);
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded((m) => ({ ...m, [idx]: true }));
    }
  }, [idx]);

  if (count === 1) {
    return (
      <img
        ref={imgRef}
        src={safeImages[0]}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded((m) => ({ ...m, 0: true }))}
        style={{
          transitionProperty: "opacity, transform",
          transitionDuration: "900ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className={`w-full h-full object-cover img-luxury group-hover:scale-105 ${
          loaded[0] ? "opacity-100" : "opacity-0"
        }`}
      />
    );
  }

  return (
    <div
      className="w-full h-full relative"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${alt} — gallery`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      {safeImages.map((src, i) => (
        <img
          key={i}
          ref={i === idx ? imgRef : null}
          src={src}
          alt={`${alt} — ${i + 1}/${count}`}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded((m) => ({ ...m, [i]: true }))}
          // Custom timing function — same easeOutQuart curve as the hero
          // animation, ~900 ms for a perceptibly smooth crossfade with
          // no scale-on-hover interference between slides.
          style={{
            transitionProperty: "opacity",
            transitionDuration: "900ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className={`absolute inset-0 w-full h-full object-cover img-luxury ${
            i === idx && loaded[i] ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous photo"
        className="absolute top-1/2 left-3 -translate-y-1/2 w-10 h-10 rounded-full bg-ink-950/60 border border-gold-300/40 text-gold-200 hover:bg-ink-950/85 hover:border-gold-300 transition-all flex items-center justify-center z-10"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next photo"
        className="absolute top-1/2 right-3 -translate-y-1/2 w-10 h-10 rounded-full bg-ink-950/60 border border-gold-300/40 text-gold-200 hover:bg-ink-950/85 hover:border-gold-300 transition-all flex items-center justify-center z-10"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {safeImages.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIdx(i)}
            aria-label={`Go to photo ${i + 1}`}
            className={`h-px transition-all duration-500 ${
              i === idx ? "w-10 bg-gold-300" : "w-5 bg-cream-100/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
const PAGE_QUERY = `*[_type == "pageContent" && page == "hotel"][0]{
  eyebrow, title, subtitle, intro, heroImage, includedAmenities
}`;

export default function Hotel() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.hotel;

  const { data: pageData, loading: pageLoading } = useSanityQuery(PAGE_QUERY);
  const { data: roomsData, loading: roomsLoading } =
    useSanityQuery(ROOMS_QUERY);

  // Hero copy: prefer Sanity, fall back to translations file.
  // The image is gated on pageLoading so the bundled hotel-all-5.png
  // doesn't flash before Sanity responds (~200-400 ms).
  const hero = {
    eyebrow: pickLocale(pageData?.eyebrow, lang) || tp.eyebrow,
    title: pickLocale(pageData?.title, lang) || tp.title,
    subtitle: pickLocale(pageData?.subtitle, lang) || tp.subtitle,
    intro: pickLocale(pageData?.intro, lang) || tp.intro,
    image: pageLoading
      ? ""
      : pageData?.heroImage
      ? urlFor(pageData.heroImage).width(2000).quality(80).url()
      : `${IMG}/hotel-all-5.png`,
  };

  // "Included with every stay" list: prefer Sanity, fall back to translations.
  const includedAmenities =
    pageData?.includedAmenities?.[lang] ||
    pageData?.includedAmenities?.en ||
    pageData?.includedAmenities?.bg ||
    tp.includedItems;

  // Room list: prefer Sanity. Render nothing while loading so the bundled
  // room photos in data.js don't preload. The `images` array always
  // includes the primary photo first, then any extras — the gallery
  // component below renders arrows whenever images.length > 1.
  const list = roomsLoading
    ? []
    : roomsData
    ? roomsData.map((r) => {
        const main = r.image
          ? urlFor(r.image).width(1400).quality(82).url()
          : "";
        const extras = (r.extraImages || [])
          .map((img) =>
            img ? urlFor(img).width(1400).quality(82).url() : ""
          )
          .filter(Boolean);
        return {
          id: r.slug || r._id,
          name: pickLocale(r.name, lang),
          price: r.price,
          size: r.size,
          sleeps: r.sleeps,
          sleepsLabel: r.sleepsLabel ? pickLocale(r.sleepsLabel, lang) : null,
          view: pickLocale(r.view, lang),
          images: main ? [main, ...extras] : extras,
          amenities: (r.amenities?.[lang] || r.amenities?.bg || []).slice(),
        };
      })
    : fallbackRooms[lang].map((r) => ({ ...r, images: [r.image] }));

  useSeo({
    title: hero.title,
    description: hero.subtitle,
    image: hero.image,
    path: "/hotel",
    lang,
  });

  return (
    <>
      <PageHero
        image={hero.image}
        eyebrow={hero.eyebrow}
        title={hero.title}
        subtitle={hero.subtitle}
        ready={!pageLoading}
      />
      <div
        className={`transition-opacity duration-700 ease-out ${
          pageLoading || roomsLoading ? "opacity-0" : "opacity-100"
        }`}
      >

      <section className="py-20 md:py-28 bg-ink-950">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg lg:text-xl text-cream-100/85 leading-relaxed font-light">
            {hero.intro}
          </p>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
      </section>

      <section className="bg-ink-950 pb-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 space-y-10">
          {list.map((r, i) => (
            <article
              key={r.id}
              className="reveal grid md:grid-cols-12 gap-0 bg-ink-900 border border-gold-300/10 overflow-hidden group hover:border-gold-300/30 transition-colors duration-700"
            >
              <div
                className={`md:col-span-7 relative aspect-[4/3] md:aspect-auto overflow-hidden ${
                  i % 2 ? "md:order-2" : ""
                }`}
              >
                <RoomGallery images={r.images} alt={r.name} />
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
                      <span>
                        {tp.sleeps} {r.sleepsLabel || r.sleeps} {tp.guests}
                      </span>
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
                      {r.price} €
                    </div>
                    <div className="text-xs text-cream-100/55 mt-1">{tp.perNight}</div>
                    <div className="text-[11px] text-cream-100/40 mt-0.5">
                      ≈ {(r.price * 1.95583).toFixed(2)} {lang === "bg" ? "лв" : "BGN"}
                    </div>
                  </div>
                  <a
                    href="https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003"
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

      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="text-center mb-12 reveal">
            <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
              {tp.included}
            </span>
            <div className="divider-gold mt-6 w-32 mx-auto" />
          </div>
          <div className="grid sm:grid-cols-2 gap-4 reveal">
            {includedAmenities.map((item, i) => (
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
      </div>
    </>
  );
}
