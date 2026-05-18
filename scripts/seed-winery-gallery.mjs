#!/usr/bin/env node
/**
 * Seeds (or replaces) the photo gallery on the Winery pageContent doc.
 * patch().set() — other fields are untouched, safe to re-run.
 *
 * Run once:   node scripts/seed-winery-gallery.mjs
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
    src: `${IMG}/hotel-all-11.png`,
    title: {
      bg: "Старото училище · класна стая, превърната в изба",
      en: "The old schoolhouse · classroom turned cellar",
      ro: "Vechea școală · sala de clasă transformată în pivniță",
    },
    text: {
      bg: "Винарната заема старото училище на село Ялово. Виното отлежава в някогашна класна стая — място с дебели стени, тишина и постоянна температура, точно както трябва на едно добро вино.",
      en: "The winery sits in the old Yalovo schoolhouse. Wines age in what used to be a classroom — thick walls, silence and a steady temperature, exactly what good wine needs.",
      ro: "Crama ocupă vechea școală din satul Yalovo. Vinurile se maturează în ceea ce era cândva o sală de clasă — pereți groși, liniște și o temperatură constantă, exact ce are nevoie un vin bun.",
    },
  },
  {
    src: `${IMG}/hotel-all-12.png`,
    title: {
      bg: "Местни сортове · Гъмза, Мавруд, Памид",
      en: "Local varieties · Gamza, Mavrud, Pamid",
      ro: "Soiuri locale · Gamza, Mavrud, Pamid",
    },
    text: {
      bg: "Работим основно с български сортове, които носят характера на тази земя. Ръчно гроздобрание, малки серии и щадяща винификация — за вина с истински вкус на мястото, от което идват.",
      en: "We work mainly with Bulgarian varieties that carry the character of this land. Hand-picked grapes, small batches and gentle vinification — for wines that truly taste of where they come from.",
      ro: "Lucrăm în principal cu soiuri bulgărești care poartă caracterul acestor pământuri. Struguri culeși manual, loturi mici și o vinificație delicată — pentru vinuri care au cu adevărat gustul locului din care provin.",
    },
  },
  {
    src: `${IMG}/hotel-all-13.png`,
    title: {
      bg: "Дегустации с местни сирена и колбаси",
      en: "Tastings with local cheese & charcuterie",
      ro: "Degustări cu brânzeturi și mezeluri locale",
    },
    text: {
      bg: "Предлагаме дегустационни сесии в избата по предварителна заявка — водени от винаря, придружени от подбрани местни сирена, луканка и домашни конфитюри. За двойки или малки групи.",
      en: "We host tasting sessions in the cellar by appointment — led by the winemaker, paired with selected local cheeses, lukanka and house jams. Suited to couples or small groups.",
      ro: "Organizăm sesiuni de degustare în pivniță, pe bază de programare — conduse de vinificator, însoțite de brânzeturi locale selecționate, lukanka și dulcețuri de casă. Potrivit pentru cupluri sau grupuri mici.",
    },
  },
  {
    src: `${IMG}/hotel-all-9.png`,
    title: {
      bg: "Частни събития и вечери в избата",
      en: "Private events & cellar dinners",
      ro: "Evenimente private și cine în pivniță",
    },
    text: {
      bg: "Старата класна стая се превръща в маса за 10–20 души за вечери с вино, водени дегустации или малки сватбени тостове. Възможност за съчетаване с престой в Парк Хотел RAYA Garden.",
      en: "The old classroom becomes a table for 10–20 — for wine dinners, guided tastings or intimate wedding toasts. Pairs well with a stay at Park Hotel RAYA Garden.",
      ro: "Vechea sală de clasă devine o masă pentru 10–20 de persoane — pentru cine cu vin, degustări ghidate sau toasturi intime de nuntă. Se combină perfect cu un sejur la Park Hotel RAYA Garden.",
    },
  },
];

(async () => {
  console.log("Uploading winery gallery photos…");
  const gallery = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const image = await uploadImage(it.src);
    gallery.push({
      _key: `winery-gallery-${i}`,
      _type: "galleryItem",
      image,
      title: it.title,
      text: it.text,
    });
  }

  console.log("\nPatching pageContent/page-winery.gallery (other fields untouched)");
  await client.patch("page-winery").set({ gallery }).commit();
  console.log("✓ Done. Open the Winery doc in Studio to see the gallery.");
})();
