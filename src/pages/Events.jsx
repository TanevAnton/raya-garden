import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Heart, Briefcase, Phone, ExternalLink, Sparkles } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "events"][0]{
  eyebrow, title, subtitle, intro, heroImage,
  blocks[]{key, title, body},
  gallery[]{ image, extraImages, title, text }
}`;

const BROCHURES_QUERY = `*[_type == "siteSettings"][0]{
  phone,
  "weddingsPdf": weddingsBrochurePdf.asset->url,
  weddingsBrochurePreview,
  "weddingsPreviewSize": weddingsBrochurePreview.asset->metadata.dimensions{width, height},
  "corporatePdf": corporateBrochurePdf.asset->url,
  corporateBrochurePreview,
  "corporatePreviewSize": corporateBrochurePreview.asset->metadata.dimensions{width, height}
}`;

// Cover of each brochure, rendered from page 1 of the PDF itself
// (scripts/generate-pdf-covers.mjs re-renders them at deploy time from
// whatever is uploaded in Studio, so a swapped brochure updates its own
// cover). aspect keeps the box the shape of the page — the wedding offer
// is A4 portrait, the hotel presentation 16:9 — so nothing is cropped.
const COVER_HEIGHT = 300; // px — both covers stand this tall, side by side
const BROCHURE_COVERS = {
  weddings: { src: "/img/brochure-weddings.jpg", w: 210, h: 297 }, // A4 offer
  corporate: { src: "/img/brochure-corporate.jpg", w: 16, h: 9 }, // 16:9 deck
};

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

function EventCard({ Icon, heading, description, phone, pdfUrl, cover, ctaTo, ctaLabel, t }) {
  // The brochure link carries its own cover — the same treatment the offer
  // PDFs get on /event/<slug>. Without a PDF uploaded there is no link at all,
  // and a cover that fails to load falls back to the plain button rather than
  // leaving an empty frame.
  const [coverBroken, setCoverBroken] = useState(false);
  const showCover = Boolean(pdfUrl && cover?.src && !coverBroken);
  // Width follows the page's own shape, so both covers come out COVER_HEIGHT
  // tall; on a screen too narrow for that the box scales down by its aspect
  // ratio rather than letterboxing.
  const coverWidth = showCover
    ? Math.round((COVER_HEIGHT * cover.w) / cover.h)
    : 0;

  return (
    <article className="reveal min-w-0 bg-ink-900 border border-gold-300/10 p-10 md:p-14 flex flex-col items-center text-center">
      <Icon className="w-9 h-9 text-gold-300 mb-6" />
      <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4 leading-tight">
        {heading}
      </h2>
      {description && (
        <p className="text-base text-cream-100/70 leading-relaxed mb-8 max-w-lg">
          {description}
        </p>
      )}

      {/* Cover + CTAs share one bottom-aligned block, so the two cards line
          up even though their descriptions run to different lengths. */}
      <div className="mt-auto w-full flex flex-col items-center">
        {showCover && (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="group block max-w-full mb-8 border border-gold-300/15 bg-ink-950/40 hover:border-gold-300/45 hover:bg-ink-950/70 transition-all duration-500"
            style={{ width: `${coverWidth}px` }}
          >
            {/* The box keeps the page's own shape — the portrait offer and
                the landscape presentation stand the same height next to each
                other, neither of them cropped. */}
            <div
              className="relative overflow-hidden bg-ink-950"
              style={{ aspectRatio: `${cover.w} / ${cover.h}` }}
            >
              <img
                src={cover.src}
                alt={heading}
                loading="lazy"
                decoding="async"
                onError={() => setCoverBroken(true)}
                className="w-full h-full object-contain opacity-85 group-hover:opacity-100 group-hover:scale-[1.03] transition-all duration-700"
              />
              <div className="absolute inset-0 ring-1 ring-inset ring-gold-300/10 pointer-events-none" />
            </div>
            <div className="flex items-center justify-center gap-3 px-4 py-3.5">
              <ExternalLink className="w-4 h-4 text-gold-300 flex-shrink-0 transition-transform duration-500 group-hover:-translate-y-0.5" />
              <span className="text-[11px] tracking-[0.2em] uppercase text-cream-100/85 group-hover:text-gold-200 transition-colors leading-snug">
                {t.pages.events.viewBrochure}
              </span>
            </div>
          </a>
        )}

        {ctaTo && (
          <Link
            to={ctaTo}
            className="btn-gold w-full sm:w-auto px-8 py-4 mb-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center justify-center gap-3"
          >
            <Sparkles className="w-4 h-4" />
            {ctaLabel}
          </Link>
        )}

        <div className="flex flex-wrap gap-4 justify-center">
          <a
            href={`tel:${(phone || "+359896100100").replace(/\s/g, "")}`}
            className={`${
              ctaTo ? "btn-ghost" : "btn-gold"
            } px-7 py-3.5 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3`}
          >
            <Phone className="w-4 h-4" />
            {t.pages.events.callUs}
          </a>
          {pdfUrl && !showCover && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-7 py-3.5 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              <ExternalLink className="w-4 h-4" />
              {t.pages.events.viewBrochure}
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

export default function Events() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.events;

  const { data: pageData, loading: pageLoading } = useSanityQuery(PAGE_QUERY);
  const { data: brochures, loading: brochuresLoading } =
    useSanityQuery(BROCHURES_QUERY);

  // Wait for both queries so the brochure buttons don't pop in after the
  // body has already faded in.
  const bodyLoading = pageLoading || brochuresLoading;

  // Image gated on pageLoading so the bundled hotel-all-9.png doesn't
  // flash before Sanity responds.
  const hero = {
    eyebrow: pickLocale(pageData?.eyebrow, lang) || tp.eyebrow,
    title: pickLocale(pageData?.title, lang) || tp.title,
    subtitle: pickLocale(pageData?.subtitle, lang) || tp.subtitle,
    intro: pickLocale(pageData?.intro, lang) || tp.intro,
    image: pageLoading
      ? ""
      : pageData?.heroImage
      ? urlFor(pageData.heroImage).width(2000).quality(80).url()
      : `${IMG}/hotel-all-9.png`,
  };

  const consultingBlock = findBlock(pageData?.blocks, "consulting");
  const consulting = pickLocale(consultingBlock?.title, lang) || tp.consulting;
  const consultingText = pickLocale(consultingBlock?.body, lang) || tp.consultingText;

  // Page 1 of the PDF is the cover by default; an image uploaded in Studio
  // (Site settings → brochure cover) overrides it when a nicer one exists,
  // and brings its own shape so the box fits it too.
  const brochureCover = (key, override, size) =>
    override && size?.width && size?.height
      ? {
          src: urlFor(override).width(640).quality(82).url(),
          w: size.width,
          h: size.height,
        }
      : BROCHURE_COVERS[key];
  const weddingsCover = brochureCover(
    "weddings",
    brochures?.weddingsBrochurePreview,
    brochures?.weddingsPreviewSize
  );
  const corporateCover = brochureCover(
    "corporate",
    brochures?.corporateBrochurePreview,
    brochures?.corporatePreviewSize
  );

  const gallery = (pageData?.gallery || []).map((item) => {
    const main = item.image ? urlFor(item.image).width(1400).quality(82).url() : "";
    const extras = (item.extraImages || [])
      .map((img) => (img ? urlFor(img).width(1400).quality(82).url() : ""))
      .filter(Boolean);
    return {
      images: main ? [main, ...extras] : extras,
      title: pickLocale(item.title, lang),
      text: pickLocale(item.text, lang),
    };
  });

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
        ready={!pageLoading}
      />
      <div
        className={`transition-opacity duration-700 ease-out ${
          bodyLoading ? "opacity-0" : "opacity-100"
        }`}
      >

      <section className="py-20 bg-ink-950">
        <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg text-cream-100/85 leading-relaxed font-light">
            {hero.intro}
          </p>
          <div className="divider-gold mt-10 w-32 mx-auto" />
        </div>
      </section>

      {gallery.length > 0 && (
        <section className="bg-ink-950 pb-24">
          <div className="max-w-7xl mx-auto px-6 lg:px-10 space-y-20">
            {gallery.map((item, i) => {
              const reversed = i % 2 === 1;
              return (
                <article
                  key={i}
                  className="reveal grid md:grid-cols-12 gap-8 lg:gap-16 items-center"
                >
                  <div
                    className={`md:col-span-7 relative aspect-[4/3] overflow-hidden group ${
                      reversed ? "md:order-2" : ""
                    }`}
                  >
                    <MediaGallery images={item.images} alt={item.title || ""} />
                    <div className="absolute inset-0 ring-1 ring-inset ring-gold-300/10 pointer-events-none" />
                    <div className="absolute -bottom-1 -right-1 w-20 h-20 border-r-2 border-b-2 border-gold-300/60 pointer-events-none" />
                    <div className="absolute -top-1 -left-1 w-20 h-20 border-l-2 border-t-2 border-gold-300/30 pointer-events-none" />
                  </div>
                  <div
                    className={`md:col-span-5 ${reversed ? "md:order-1" : ""}`}
                  >
                    <div className="flex items-center gap-3 text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-5">
                      <span className="font-mono text-gold-300/60">
                        0{i + 1}
                      </span>
                      <div className="w-8 h-px bg-gold-300/40" />
                    </div>
                    {item.title && (
                      <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-cream-50 mb-5 leading-tight text-balance">
                        {item.title}
                      </h2>
                    )}
                    {item.text && (
                      <p className="text-base lg:text-lg text-cream-100/75 leading-relaxed font-light">
                        {item.text}
                      </p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="pb-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-2 gap-6">
          <EventCard
            Icon={Heart}
            heading={tp.weddings}
            description={`${tp.weddingsDescription} ${tp.configuratorIntro}`}
            ctaTo="/svatben-konfigurator"
            ctaLabel={tp.configuratorCta}
            phone={brochures?.phone}
            pdfUrl={brochures?.weddingsPdf}
            cover={weddingsCover}
            t={t}
          />
          <EventCard
            Icon={Briefcase}
            heading={tp.corporate}
            description={tp.corporateDescription}
            phone={brochures?.phone}
            pdfUrl={brochures?.corporatePdf}
            cover={corporateCover}
            t={t}
          />
        </div>
      </section>

      <section className="py-24 bg-ink-900">
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
            href={`tel:${(brochures?.phone || "+359896100100").replace(/\s/g, "")}`}
            className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
          >
            <Phone className="w-4 h-4" />
            {brochures?.phone || "+359 896 100 100"}
          </a>
        </div>
      </section>
      </div>
    </>
  );
}
