import { useOutletContext } from "react-router-dom";
import { Trees, MapPin } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "park"][0]{
  eyebrow, title, subtitle, heroImage, extraImages,
  blocks[]{key, title, body}
}`;
const ATTRACTIONS_QUERY = `*[_type == "attraction"] | order(order asc) { name, note }`;

function findBlock(blocks, key) {
  return blocks?.find((b) => b.key === key);
}

export default function Park() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.park;

  const { data: pageData } = useSanityQuery(PAGE_QUERY);
  const { data: attractionsData } = useSanityQuery(ATTRACTIONS_QUERY);

  const hero = pageData
    ? {
        eyebrow: pickLocale(pageData.eyebrow, lang) || tp.eyebrow,
        title: pickLocale(pageData.title, lang) || tp.title,
        subtitle: pickLocale(pageData.subtitle, lang) || tp.subtitle,
        image: pageData.heroImage
          ? urlFor(pageData.heroImage).width(2000).quality(80).url()
          : `${IMG}/hotel-all-17.png`,
        parkImage: pageData.heroImage
          ? urlFor(pageData.heroImage).width(1200).quality(80).url()
          : `${IMG}/hotel-all-17.png`,
        cityImage: pageData.extraImages?.[0]
          ? urlFor(pageData.extraImages[0]).width(1200).quality(80).url()
          : `${IMG}/hotel-all-15.png`,
      }
    : {
        eyebrow: tp.eyebrow,
        title: tp.title,
        subtitle: tp.subtitle,
        image: `${IMG}/hotel-all-17.png`,
        parkImage: `${IMG}/hotel-all-17.png`,
        cityImage: `${IMG}/hotel-all-15.png`,
      };

  const parkBlock = findBlock(pageData?.blocks, "parkText");
  const cityBlock = findBlock(pageData?.blocks, "cityText");
  const parkTitle = pickLocale(parkBlock?.title, lang) || tp.parkTitle;
  const parkText = pickLocale(parkBlock?.body, lang) || tp.parkText;
  const cityTitle = pickLocale(cityBlock?.title, lang) || tp.cityTitle;
  const cityText = pickLocale(cityBlock?.body, lang) || tp.cityText;

  const attractions = attractionsData
    ? attractionsData.map((a) => ({
        name: pickLocale(a.name, lang),
        note: pickLocale(a.note, lang),
      }))
    : tp.attractionsList;

  useSeo({
    title: hero.title,
    description: hero.subtitle,
    image: hero.image,
    path: "/park",
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
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-2 gap-10 lg:gap-16">
          <div className="reveal">
            <div className="relative aspect-[4/3] overflow-hidden mb-8">
              <img
                src={hero.parkImage}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover img-luxury"
              />
            </div>
            <Trees className="w-7 h-7 text-gold-300 mb-4" />
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4">
              {parkTitle}
            </h2>
            <p className="text-cream-100/75 leading-relaxed">{parkText}</p>
          </div>
          <div className="reveal">
            <div className="relative aspect-[4/3] overflow-hidden mb-8">
              <img
                src={hero.cityImage}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover img-luxury"
              />
            </div>
            <MapPin className="w-7 h-7 text-gold-300 mb-4" />
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-4">
              {cityTitle}
            </h2>
            <p className="text-cream-100/75 leading-relaxed">{cityText}</p>
          </div>
        </div>
      </section>

      <section className="py-24 bg-ink-900">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          <div className="flex items-baseline gap-5 mb-12 reveal">
            <h2 className="font-display text-3xl md:text-5xl text-cream-50">
              {tp.attractions}
            </h2>
            <div className="divider-gold flex-1" />
          </div>
          <ul className="grid sm:grid-cols-2 gap-6 reveal">
            {attractions.map((a, i) => (
              <li
                key={i}
                className="bg-ink-950/60 p-6 border border-gold-300/10 hover:border-gold-300/30 transition-colors group"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-gold-300/60">0{i + 1}</span>
                  <h3 className="font-display text-xl text-cream-50 group-hover:text-gold-200 transition-colors">
                    {a.name}
                  </h3>
                </div>
                <p className="text-sm text-cream-100/60 mt-2 pl-8">{a.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
