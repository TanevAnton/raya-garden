#!/usr/bin/env node
/**
 * Seeds (or replaces) the 4 hero slideshow photos on the Home page.
 * patch().set() — other fields on page-home are untouched.
 *
 * Run once:  node scripts/seed-home-hero-slideshow.mjs
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";
import { IMG } from "../src/data.js";

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
  return { _type: "image", asset: { _type: "reference", _ref: asset._id } };
}

const SOURCES = [
  `${IMG}/hotel-all-1.png`,
  `${IMG}/hotel-all-5.png`,
  `${IMG}/hotel-all-9.png`,
  `${IMG}/hotel-all-14.png`,
];

(async () => {
  console.log("Uploading hero slideshow photos…");
  const heroSlideshow = [];
  for (let i = 0; i < SOURCES.length; i++) {
    const ref = await uploadImage(SOURCES[i]);
    if (ref) heroSlideshow.push({ ...ref, _key: `hero-${i}` });
  }
  console.log("\nPatching page-home.heroSlideshow (other fields untouched)");
  await client.patch("page-home").set({ heroSlideshow }).commit();
  console.log("✓ Done. Open Page content → Home → Hero slideshow photos in Studio.");
})();
