import { useParams, useOutletContext, Link } from "react-router-dom";
import { Check, Phone, ArrowRight, Download } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import MediaGallery from "../components/MediaGallery.jsx";
import NotFound from "./NotFound.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

// Generic seasonal/event landing page (New Year, Easter…). Fully driven
// by an `eventPage` document in Sanity: /event/<slug> renders only while
// the document's Active toggle is on — otherwise it 404s and the menu
// link (see Nav.jsx) disappears with it.
const PAGE_QUERY = `*[_type == "eventPage" && slug.current == $slug && active == true][0]{
  eyebrow, title, subtitle, heroImage, intro, highlights, priceText,
  gallery[]{ image, extraImages, title, text },
  offerPdfs[]{ label, "url": pdf.asset->url }
}`;
const PHONE_QUERY = `*[_type == "siteSettings"][0].phone`;
const FALLBACK_PHONE = "+359 896 100 100";

export default function EventPage() {
  const { slug } = useParams();
  const { lang, t } = useOutletContext();
  const { data, loading } = useSanityQuery(PAGE_QUERY, { slug });
  const { data: phoneFromSanity } = useSanityQuery(PHONE_QUERY);

  const hero = {
    eyebrow: pickLocale(data?.eyebrow, lang),
    title: pickLocale(data?.title, lang),
    subtitle: pickLocale(data?.subtitle, lang),
    image: loading
      ? ""
      : data?.heroImage
      ? urlFor(data.heroImage).width(2000).quality(80).url()
      : `${IMG}/hotel-all-16.png`,
  };
  const intro = pickLocale(data?.intro, lang);
  const highlights =
    data?.highlights?.[lang] || data?.highlights?.en || data?.highlights?.bg || [];
  const priceText = pickLocale(data?.priceText, lang);
  const gallery = (data?.gallery || []).map((item) => {
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
  const phone = phoneFromSanity || FALLBACK_PHONE;
  // Only entries that actually have a file uploaded become buttons.
  const offerPdfs = (data?.offerPdfs || [])
    .filter((o) => o.url)
    .map((o) => ({ url: o.url, label: pickLocale(o.label, lang) }));

  useSeo({
    title: hero.title || null,
    description: hero.subtitle,
    image: hero.image,
    path: `/event/${slug}`,
    lang,
  });

  // After all hooks: unknown slug or Active switched off → branded 404.
  if (!loading && !data) return <NotFound />;

  return (
    <>
      <PageHero
        image={hero.image}
        eyebrow={hero.eyebrow}
        title={hero.title}
        subtitle={hero.subtitle}
        ready={!loading}
      />

      {/* Body fades in as one unit once Sanity returns. */}
      <div
        className={`transition-opacity duration-700 ease-out ${
          loading ? "opacity-0" : "opacity-100"
        }`}
      >
        {intro && (
          <section className="py-20 bg-ink-950">
            <div className="max-w-4xl mx-auto px-6 lg:px-10 text-center reveal">
              <p className="text-lg lg:text-xl text-cream-100/85 leading-relaxed font-light">
                {intro}
              </p>
              <div className="divider-gold mt-10 w-32 mx-auto" />
            </div>
          </section>
        )}

        {highlights.length > 0 && (
          <section className="pb-20 bg-ink-950">
            <div className="max-w-5xl mx-auto px-6 lg:px-10">
              <div className="grid sm:grid-cols-2 gap-4 reveal">
                {highlights.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 bg-ink-900/60 p-5 border border-gold-300/10"
                  >
                    <Check className="w-5 h-5 text-gold-300 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-cream-100/85">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Booking panel — deliberately above the photo story: the price and
            the ways to act on it belong together at the decision point,
            while the gallery keeps selling below. Framed with the same
            corner accents as the gallery images. */}
        <section className="pb-24 bg-ink-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-10 reveal">
            <div className="relative overflow-hidden border border-gold-300/20 bg-gradient-to-b from-ink-900/90 to-ink-900/30 px-6 py-12 sm:px-12 text-center">
              <div className="absolute -top-px -left-px w-16 h-16 border-l-2 border-t-2 border-gold-300/50 pointer-events-none" />
              <div className="absolute -bottom-px -right-px w-16 h-16 border-r-2 border-b-2 border-gold-300/50 pointer-events-none" />

              {priceText && (
                <div className="font-display text-4xl md:text-5xl gradient-gold leading-none">
                  {priceText}
                </div>
              )}

              <div
                className={`divider-gold w-24 mx-auto mb-8 ${
                  priceText ? "mt-8" : ""
                }`}
              />

              <div className="flex flex-wrap gap-4 justify-center">
                <Link
                  to="/book"
                  className="btn-gold px-10 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
                >
                  {t.nav.book}
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <a
                  href={`tel:${phone.replace(/\s/g, "")}`}
                  className="btn-ghost px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
                >
                  <Phone className="w-4 h-4" />
                  {phone}
                </a>
              </div>

              {/* Downloads are secondary — quiet links, not buttons competing
                  with the booking CTA. */}
              {offerPdfs.length > 0 && (
                <div className="mt-10 pt-8 border-t border-gold-300/10 flex flex-wrap gap-x-10 gap-y-4 justify-center">
                  {offerPdfs.map((o, i) => (
                    <a
                      key={i}
                      href={o.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-3 text-xs tracking-[0.25em] uppercase text-gold-300/85 hover:text-gold-200 transition-colors"
                    >
                      <Download className="w-4 h-4 transition-transform duration-500 group-hover:translate-y-0.5" />
                      {o.label}
                    </a>
                  ))}
                </div>
              )}
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
                    <div className={`md:col-span-5 ${reversed ? "md:order-1" : ""}`}>
                      <div className="flex items-center gap-3 text-xs tracking-[0.3em] uppercase text-gold-300/80 mb-5">
                        <span className="font-mono text-gold-300/60">0{i + 1}</span>
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

      </div>
    </>
  );
}
