import { useOutletContext } from "react-router-dom";
import { Wine, ArrowRight, ExternalLink } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "winery"][0]{
  eyebrow, title, subtitle, heroImage, extraImages,
  blocks[]{key, title, body},
  gallery[]{ image, "galleryExtras": extraImages, title, text }
}`;
const WINERY_URL_QUERY = `*[_type == "siteSettings"][0].wineryUrl`;
const FALLBACK_WINERY_URL = "https://www.vinarnayalovo.com";

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

export default function Winery() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.winery;

  const { data: pageData, loading: pageLoading } = useSanityQuery(PAGE_QUERY);
  const { data: wineryUrlFromSanity } = useSanityQuery(WINERY_URL_QUERY);
  const wineryUrl = wineryUrlFromSanity || FALLBACK_WINERY_URL;

  // Images gated on pageLoading so bundled hotel-all-{11,12}.png don't
  // flash before Sanity responds. Text uses translations as fallback.
  const hero = {
    eyebrow: pickLocale(pageData?.eyebrow, lang) || tp.eyebrow,
    title: pickLocale(pageData?.title, lang) || tp.title,
    subtitle: pickLocale(pageData?.subtitle, lang) || tp.subtitle,
    image: pageLoading
      ? ""
      : pageData?.heroImage
      ? urlFor(pageData.heroImage).width(2000).quality(80).url()
      : `${IMG}/hotel-all-11.png`,
    secondaryImage: pageLoading
      ? ""
      : pageData?.extraImages?.[0]
      ? urlFor(pageData.extraImages[0]).width(1200).quality(80).url()
      : `${IMG}/hotel-all-12.png`,
  };

  const story = pickLocale(findBlock(pageData?.blocks, "story")?.body, lang) || tp.story;
  const story2 = pickLocale(findBlock(pageData?.blocks, "story2")?.body, lang) || tp.story2;
  const visitText = pickLocale(findBlock(pageData?.blocks, "visitText")?.body, lang) || tp.visitText;

  const gallery = (pageData?.gallery || []).map((item) => {
    const main = item.image ? urlFor(item.image).width(1400).quality(82).url() : "";
    const extras = (item.galleryExtras || [])
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
        ready={!pageLoading}
      />

      {/* Body content fades in as one unit when Sanity returns. */}
      <div
        className={`transition-opacity duration-700 ease-out ${
          pageLoading ? "opacity-0" : "opacity-100"
        }`}
      >
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

      {/* Photo gallery — alternating image + text rows */}
      {gallery.length > 0 && (
        <section className="bg-ink-900 py-24">
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

      <section className="py-24 bg-ink-950">
        <div className="max-w-3xl mx-auto px-6 text-center reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {hero.eyebrow}
          </span>
          <h3 className="font-display text-3xl md:text-5xl text-cream-50 mt-5 mb-6">
            {tp.visit}
          </h3>
          <p className="text-cream-100/75 mb-10">{visitText}</p>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href="tel:+359896100100"
              className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              +359 896 100 100
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href={wineryUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              {t.sections.winery.externalCta}
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
