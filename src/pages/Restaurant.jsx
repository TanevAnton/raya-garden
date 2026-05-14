import { useOutletContext } from "react-router-dom";
import { Phone, Download } from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { menu as fallbackMenu, IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { urlFor, pickLocale } from "../lib/sanity.js";

const PAGE_QUERY = `*[_type == "pageContent" && page == "restaurant"][0]{
  eyebrow, title, subtitle, intro, heroImage
}`;
const MENU_QUERY = `*[_type == "menuCategory"] | order(order asc) {
  _id, title,
  items[]{
    name, price, desc
  }
}`;

export default function Restaurant() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.restaurant;

  const { data: pageData } = useSanityQuery(PAGE_QUERY);
  const { data: menuData } = useSanityQuery(MENU_QUERY);

  const hero = pageData
    ? {
        eyebrow: pickLocale(pageData.eyebrow, lang) || tp.eyebrow,
        title: pickLocale(pageData.title, lang) || tp.title,
        subtitle: pickLocale(pageData.subtitle, lang) || tp.subtitle,
        intro: pickLocale(pageData.intro, lang) || tp.intro,
        image: pageData.heroImage
          ? urlFor(pageData.heroImage).width(2000).quality(80).url()
          : `${IMG}/hotel-all-8.png`,
      }
    : { eyebrow: tp.eyebrow, title: tp.title, subtitle: tp.subtitle, intro: tp.intro, image: `${IMG}/hotel-all-8.png` };

  const list = menuData
    ? menuData.map((cat) => ({
        title: pickLocale(cat.title, lang),
        items: (cat.items || []).map((it) => ({
          name: pickLocale(it.name, lang),
          desc: pickLocale(it.desc, lang),
          price: it.price,
        })),
      }))
    : fallbackMenu[lang];

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
      />

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
            <a
              href="https://rayagarden.bg/wp-content/uploads/2022/06/Menu-Raya-2025.pdf"
              target="_blank"
              rel="noreferrer"
              className="btn-ghost px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
            >
              <Download className="w-4 h-4" />
              {tp.downloadMenu}
            </a>
          </div>
          <div className="divider-gold mt-12 w-32 mx-auto" />
        </div>
      </section>

      <section className="bg-ink-950 pb-24">
        <div className="max-w-5xl mx-auto px-6 lg:px-10">
          {list.map((category, ci) => (
            <div key={category.title || ci} className="mb-20 reveal">
              <div className="flex items-baseline gap-5 mb-10">
                <span className="font-mono text-xs tracking-[0.3em] uppercase text-gold-300/60">
                  0{ci + 1}
                </span>
                <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-cream-50">
                  {category.title}
                </h2>
                <div className="divider-gold flex-1" />
              </div>
              <ul className="space-y-6">
                {category.items.map((item, i) => (
                  <li key={i} className="group">
                    <div className="flex items-baseline gap-4">
                      <h3 className="font-display text-xl md:text-2xl text-cream-50 group-hover:text-gold-200 transition-colors">
                        {item.name}
                      </h3>
                      <div className="flex-1 border-b border-dotted border-gold-300/20" />
                      <span className="font-display text-xl md:text-2xl gradient-gold whitespace-nowrap">
                        {item.price} {lang === "bg" ? "лв" : "BGN"}
                      </span>
                    </div>
                    {item.desc && (
                      <p className="text-sm text-cream-100/55 mt-2 max-w-2xl">
                        {item.desc}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <p className="text-xs text-cream-100/40 italic mt-16 text-center">
            {tp.note}
          </p>
        </div>
      </section>
    </>
  );
}
