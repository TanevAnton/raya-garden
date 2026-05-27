import { useOutletContext } from "react-router-dom";
import { Heart, Briefcase, Phone, ExternalLink } from "lucide-react";
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
  "corporatePdf": corporateBrochurePdf.asset->url
}`;

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

function EventCard({ Icon, heading, description, phone, pdfUrl, t }) {
  return (
    <article className="reveal bg-ink-900 border border-gold-300/10 p-10 md:p-14 flex flex-col items-start">
      <Icon className="w-9 h-9 text-gold-300 mb-6" />
      <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4 leading-tight">
        {heading}
      </h2>
      {description && (
        <p className="text-base text-cream-100/70 leading-relaxed mb-8 max-w-lg">
          {description}
        </p>
      )}
      <div className="flex flex-wrap gap-4 mt-auto">
        <a
          href={`tel:${(phone || "+359879107500").replace(/\s/g, "")}`}
          className="btn-gold px-7 py-3.5 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
        >
          <Phone className="w-4 h-4" />
          {t.pages.events.callUs}
        </a>
        {pdfUrl && (
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
    </article>
  );
}

export default function Events() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.events;

  const { data: pageData, loading: pageLoading } = useSanityQuery(PAGE_QUERY);
  const { data: brochures } = useSanityQuery(BROCHURES_QUERY);

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
          pageLoading ? "opacity-0" : "opacity-100"
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

      <section className="pb-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-2 gap-6">
          <EventCard
            Icon={Heart}
            heading={tp.weddings}
            description={tp.weddingsDescription}
            phone={brochures?.phone}
            pdfUrl={brochures?.weddingsPdf}
            t={t}
          />
          <EventCard
            Icon={Briefcase}
            heading={tp.corporate}
            description={tp.corporateDescription}
            phone={brochures?.phone}
            pdfUrl={brochures?.corporatePdf}
            t={t}
          />
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
            href={`tel:${(brochures?.phone || "+359879107500").replace(/\s/g, "")}`}
            className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
          >
            <Phone className="w-4 h-4" />
            {brochures?.phone || "+359 879 107 500"}
          </a>
        </div>
      </section>
      </div>
    </>
  );
}
