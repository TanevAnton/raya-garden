import { useOutletContext } from "react-router-dom";
import { Phone, Download } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "restaurant"][0]{
  eyebrow, title, subtitle, intro, heroImage,
  gallery[]{ image, extraImages, title, text }
}`;
const MENU_PDF_QUERY = `*[_type == "siteSettings"][0]{
  "url": menuPdf.asset->url,
  "wineUrl": wineListPdf.asset->url
}`;
// Fallback only if Sanity is unreachable — points at the menu PDF's stable
// Sanity CDN URL (the menu itself is editable in Studio: siteSettings.menuPdf).
const FALLBACK_MENU_PDF =
  "https://cdn.sanity.io/files/q2yxl7gs/production/ddb48ae7d80007591b77b5f5394b06032b0279ef.pdf";

export default function Restaurant() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.restaurant;

  const { data: pageData, loading: pageLoading } = useSanityQuery(PAGE_QUERY);
  const { data: menuPdfData } = useSanityQuery(MENU_PDF_QUERY);
  const menuPdfUrl = menuPdfData?.url || FALLBACK_MENU_PDF;
  // Wine list has no static fallback — the button only shows once the
  // PDF is uploaded in Studio (Site settings → Wine list).
  const wineListUrl = menuPdfData?.wineUrl;

  // Image gated on pageLoading so the bundled hotel-all-8.png doesn't
  // flash before Sanity responds. Text uses translations as fallback.
  const hero = {
    eyebrow: pickLocale(pageData?.eyebrow, lang) || tp.eyebrow,
    title: pickLocale(pageData?.title, lang) || tp.title,
    subtitle: pickLocale(pageData?.subtitle, lang) || tp.subtitle,
    intro: pickLocale(pageData?.intro, lang) || tp.intro,
    image: pageLoading
      ? ""
      : pageData?.heroImage
      ? urlFor(pageData.heroImage).width(2000).quality(80).url()
      : `${IMG}/hotel-all-8.png`,
  };

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
    path: "/restaurant",
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

      {/* Wrap everything below the hero in a single fade so the intro,
          gallery and menu band ease in together once Sanity returns —
          instead of popping in as items arrive piecemeal. */}
      <div
        className={`transition-opacity duration-700 ease-out ${
          pageLoading ? "opacity-0" : "opacity-100"
        }`}
      >
      <section className="py-20 bg-ink-950">
        <div className="max-w-5xl mx-auto px-6 lg:px-10 text-center reveal">
          <p className="text-lg text-cream-100/85 leading-relaxed font-light mb-8">
            {hero.intro}
          </p>
          <div className="flex flex-wrap gap-4 justify-center items-center">
            <a
              href="tel:0896100100"
              className="btn-gold px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              <Phone className="w-4 h-4" />
              {tp.reservations}
            </a>
          </div>
          <div className="divider-gold mt-12 w-32 mx-auto" />
        </div>
      </section>

      {/* Photo gallery — alternating image + text rows */}
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

      {/* Menu PDF — moved to bottom so guests browse the gallery first. */}
      <section className="py-24 bg-ink-900">
        <div className="max-w-3xl mx-auto px-6 text-center reveal">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {tp.eyebrow}
          </span>
          <h2 className="font-display text-3xl md:text-5xl text-cream-50 mt-5 mb-8 text-balance leading-tight">
            {tp.title}
          </h2>
          <div className="flex flex-wrap gap-4 justify-center">
            <a
              href={menuPdfUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              <Download className="w-4 h-4" />
              {tp.downloadMenu}
            </a>
            {wineListUrl && (
              <a
                href={wineListUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
              >
                <Download className="w-4 h-4" />
                {tp.downloadWineList}
              </a>
            )}
          </div>
        </div>
      </section>
      </div>
    </>
  );
}
