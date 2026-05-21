#!/usr/bin/env node
/**
 * Seeds (or replaces) the 4 section cards on the Home page:
 * Hotel, Restaurant, Winery, Park & Town.
 *
 * patch().set() — other fields on page-home are untouched, safe to re-run.
 *
 * Run once:  node scripts/seed-home-section-cards.mjs
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";
import { IMG } from "../src/data.js";
import { translations as t } from "../src/translations.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const client = createClient({
  projectId: process.env.VITE_SANITY_PROJECT_ID,
  dataset: process.env.VITE_SANITY_DATASET || "production",
  token: process.env.SANITY_WRITE_TOKEN,
  apiVersion: "2024-10-01",
  useCdn: false,
});

const cache = new Map();
async function uploadImage(url) {
  if (cache.has(url)) return cache.get(url);
  process.stdout.write(`  ↑ ${url.split("/").pop()}…`);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(` skip (${res.status})`);
    return undefined;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const asset = await client.assets.upload("image", buf, {
    filename: url.split("/").pop(),
  });
  console.log(" ok");
  const ref = { _type: "image", asset: { _type: "reference", _ref: asset._id } };
  cache.set(url, ref);
  return ref;
}

const cards = [
  { key: "hotel",      linkTo: "/hotel",      src: `${IMG}/hotel-all-3.png` },
  { key: "restaurant", linkTo: "/restaurant", src: `${IMG}/hotel-all-8.png` },
  { key: "winery",     linkTo: "/winery",     src: `${IMG}/hotel-all-11.png` },
  { key: "park",       linkTo: "/park",       src: `${IMG}/hotel-all-17.png` },
];

(async () => {
  console.log("Uploading section card photos…");
  const sectionCards = [];
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const image = await uploadImage(c.src);
    const bg = t.bg.sections[c.key];
    const en = t.en.sections[c.key];
    const ro = t.ro.sections[c.key];
    sectionCards.push({
      _key: `section-${c.key}`,
      _type: "sectionCard",
      linkTo: c.linkTo,
      image,
      tag:   { bg: bg.tag,   en: en.tag,   ro: ro.tag },
      title: { bg: bg.title, en: en.title, ro: ro.title },
      text:  { bg: bg.text,  en: en.text,  ro: ro.text },
      cta:   { bg: bg.cta,   en: en.cta,   ro: ro.cta },
    });
  }

  console.log("\nPatching page-home.sectionCards (other fields untouched)");
  await client.patch("page-home").set({ sectionCards }).commit();
  console.log("✓ Done. Open Page content → Home → Section cards in Studio to edit.");
})();
