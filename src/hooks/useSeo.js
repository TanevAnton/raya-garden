import { useEffect } from "react";

const SITE_NAME = "Park Hotel RAYA Garden";
// Location appended to the browser title, in the script that matches the
// active language (Cyrillic for BG, Latin for EN/RO).
const LOCATION = { bg: "Велико Търново", en: "Veliko Tarnovo", ro: "Veliko Tarnovo" };
const DEFAULT_IMAGE = "https://rayagarden.bg/img/hotel-all-1.png";
const SITE = "https://rayagarden.bg";
// The languages App.jsx accepts in ?lang=, kept in step with
// scripts/lib/public-routes.mjs, which lists the same set in sitemap.xml.
const LANGS = ["bg", "en", "ro"];

function setMeta(selector, attr, value) {
  if (!value) return;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement("meta");
    const [, name] = selector.match(/\[(?:name|property)="([^"]+)"\]/) || [];
    if (selector.includes("property=")) el.setAttribute("property", name);
    else el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

/**
 * hreflang alternates for the three language versions of this page.
 *
 * There can be several of these tags, so they are replaced wholesale rather
 * than looked up by rel. x-default is the bare URL — the address with no
 * ?lang=, where App.jsx picks a language from the visitor's own country.
 */
function setAlternates(path) {
  for (const el of document.head.querySelectorAll('link[rel="alternate"][hreflang]')) {
    el.remove();
  }
  const add = (hreflang, href) => {
    const el = document.createElement("link");
    el.setAttribute("rel", "alternate");
    el.setAttribute("hreflang", hreflang);
    el.setAttribute("href", href);
    document.head.appendChild(el);
  };
  for (const code of LANGS) add(code, `${SITE}${path}?lang=${code}`);
  add("x-default", `${SITE}${path}`);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

// `titleExact` sets the document title verbatim (no brand/location suffix)
// — used where an exact <title> is dictated, e.g. the SEO-specified home
// title. Otherwise the page title gets the "· Brand · Location" suffix.
export function useSeo({
  title,
  titleExact,
  description,
  image,
  imageWidth,
  imageHeight,
  path,
  lang,
}) {
  useEffect(() => {
    const brand = `${SITE_NAME} · ${LOCATION[lang] || LOCATION.bg}`;
    const fullTitle = titleExact || (title ? `${title} · ${brand}` : brand);
    document.title = fullTitle;

    setMeta('meta[name="description"]', "content", description);
    setMeta('meta[property="og:title"]', "content", fullTitle);
    setMeta('meta[property="og:description"]', "content", description);
    setMeta('meta[property="og:image"]', "content", image || DEFAULT_IMAGE);
    setMeta('meta[property="og:type"]', "content", "website");
    setMeta('meta[property="og:site_name"]', "content", SITE_NAME);
    const ogLocale =
      lang === "en" ? "en_US" : lang === "ro" ? "ro_RO" : "bg_BG";
    setMeta('meta[property="og:locale"]', "content", ogLocale);
    setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
    setMeta('meta[name="twitter:title"]', "content", fullTitle);
    setMeta('meta[name="twitter:description"]', "content", description);
    setMeta('meta[name="twitter:image"]', "content", image || DEFAULT_IMAGE);
    // Only when the size is actually known. Declaring them lets a scraper lay
    // the card out before it has fetched the image; declaring them wrongly is
    // worse than leaving them off.
    if (imageWidth && imageHeight) {
      setMeta('meta[property="og:image:width"]', "content", String(imageWidth));
      setMeta('meta[property="og:image:height"]', "content", String(imageHeight));
    }

    if (path) {
      // Self-referential per language. Pointing all three at the bare URL —
      // as this did — told Google the language versions were duplicates of
      // one address, so only whichever language its crawler happened to be
      // served could be indexed. Each language now canonicalises to itself
      // and the alternates below tie the set together.
      const canonical = `${SITE}${path}?lang=${lang}`;
      setLink("canonical", canonical);
      setMeta('meta[property="og:url"]', "content", canonical);
      setAlternates(path);
    }
  }, [title, titleExact, description, image, imageWidth, imageHeight, path, lang]);
}
