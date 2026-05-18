#!/usr/bin/env node
/**
 * Seeds (or replaces) the photo gallery on the Restaurant pageContent doc.
 * Uses patch().set() so other fields on the doc (intro, hero copy, etc.)
 * are preserved — re-runnable without wiping Studio edits.
 *
 * Run once:   node scripts/seed-restaurant-gallery.mjs
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";
import { IMG } from "../src/data.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const projectId = process.env.VITE_SANITY_PROJECT_ID;
const dataset = process.env.VITE_SANITY_DATASET || "production";
const token = process.env.SANITY_WRITE_TOKEN;

if (!projectId || !token) {
  console.error("Missing VITE_SANITY_PROJECT_ID or SANITY_WRITE_TOKEN.");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  token,
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

const items = [
  {
    src: `${IMG}/hotel-all-8.png`,
    title: {
      bg: "Зала с панорамна гледка",
      en: "Dining hall with a panoramic view",
      ro: "Sala cu vedere panoramică",
    },
    text: {
      bg: "Гледка към Велико Търново от всяка маса, приказен интериор по мотиви на „Алиса в страната на чудесата“ и приглушено осветление за вечер с характер.",
      en: "Veliko Tarnovo from every table, a fairytale interior inspired by Alice in Wonderland and warm lighting for an evening with character.",
      ro: "Veliko Tarnovo de la fiecare masă, un interior de poveste inspirat de Alice în Țara Minunilor și o iluminare caldă pentru o seară cu caracter.",
    },
  },
  {
    src: `${IMG}/hotel-all-13.png`,
    title: {
      bg: "Открита градина с барбекю",
      en: "Open-air garden with BBQ",
      ro: "Grădină în aer liber cu grătar",
    },
    text: {
      bg: "Зеленина, аромат на жар и жива музика през летните вечери — мястото, в което се ражда повечето от менюто ни на открито.",
      en: "Greenery, the scent of open fire and live music on summer evenings — the heart of our outdoor menu.",
      ro: "Verdeață, parfum de foc deschis și muzică live în serile de vară — inima meniului nostru în aer liber.",
    },
  },
  {
    src: `${IMG}/hotel-all-10.png`,
    title: {
      bg: "Жива риба от нашето езеро",
      en: "Live fish from our lake",
      ro: "Pește viu din lacul nostru",
    },
    text: {
      bg: "Пресен улов от Езеро Света Гора, приготвен по Ваш избор — на жар, на скара или по класическа рецепта.",
      en: "Fresh catch from Sveta Gora Lake, prepared the way you like — over open fire, grilled or to a classic recipe.",
      ro: "Captură proaspătă din Lacul Sveta Gora, gătită după preferința dvs. — la foc deschis, la grătar sau după o rețetă clasică.",
    },
  },
  {
    src: `${IMG}/hotel-all-6.png`,
    title: {
      bg: "Сватби и празнични вечери",
      en: "Weddings & celebrations",
      ro: "Nunți și sărbători",
    },
    text: {
      bg: "Капацитет до 270 души, отворена градина, безупречна организация и индивидуален подход за Вашия специален ден.",
      en: "Up to 270 guests, an open garden, flawless coordination and a personal approach for your special day.",
      ro: "Până la 270 de oaspeți, o grădină deschisă, organizare impecabilă și o abordare personală pentru ziua dvs. specială.",
    },
  },
];

(async () => {
  console.log("Uploading gallery photos…");
  const gallery = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const image = await uploadImage(it.src);
    gallery.push({
      _key: `gallery-${i}`,
      _type: "galleryItem",
      image,
      title: it.title,
      text: it.text,
    });
  }

  console.log("\nPatching pageContent/page-restaurant.gallery (other fields untouched)");
  await client.patch("page-restaurant").set({ gallery }).commit();
  console.log("✓ Done. Open the Restaurant doc in Studio to see the gallery.");
})();
