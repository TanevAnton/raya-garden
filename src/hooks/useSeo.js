import { useEffect } from "react";

const SITE_NAME = "Park Hotel RAYA Garden";
const DEFAULT_IMAGE =
  "https://rayagarden.bg/wp-content/uploads/2022/01/hotel-all-1.png";

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

export function useSeo({ title, description, image, path, lang }) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
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

    if (path) {
      const canonical = `https://rayagarden.bg${path}`;
      setLink("canonical", canonical);
      setMeta('meta[property="og:url"]', "content", canonical);
    }
  }, [title, description, image, path, lang]);
}
