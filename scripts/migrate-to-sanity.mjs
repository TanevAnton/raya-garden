#!/usr/bin/env node
/**
 * One-shot migration: pushes the current data.js + translations.js content
 * into Sanity. Uploads existing rayagarden.bg images as Sanity assets so
 * everything ends up in one place.
 *
 * Usage:
 *   1. Copy .env.example → .env.local and fill in:
 *        VITE_SANITY_PROJECT_ID=<your projectId>
 *        VITE_SANITY_DATASET=production
 *        SANITY_WRITE_TOKEN=<token with Editor permission>
 *      (Create a token at sanity.io/manage → API → Tokens → "Add API token")
 *   2. node scripts/migrate-to-sanity.mjs
 *
 * Idempotent: re-running replaces documents instead of duplicating.
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";

// Same precedence as Vite: .env.local overrides .env.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import { rooms, menu, lakePricing, eventsPackages, IMG } from "../src/data.js";
import { translations as t } from "../src/translations.js";

const projectId = process.env.VITE_SANITY_PROJECT_ID;
const dataset = process.env.VITE_SANITY_DATASET || "production";
const token = process.env.SANITY_WRITE_TOKEN;

if (!projectId || !token) {
  console.error(
    "Missing VITE_SANITY_PROJECT_ID or SANITY_WRITE_TOKEN in .env.local.\n" +
      "Get them from sanity.io/manage → your project → API."
  );
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  token,
  apiVersion: "2024-10-01",
  useCdn: false,
});

// ─── helpers ────────────────────────────────────────────────────────────

function localeStr(bg, en) {
  return { bg, en };
}

function localeArr(bg, en) {
  return { bg, en };
}

// Cache uploaded image assets by URL so we don't re-upload duplicates.
const imageCache = new Map();
async function uploadImage(url) {
  if (!url) return undefined;
  if (imageCache.has(url)) return imageCache.get(url);
  process.stdout.write(`  ↑ uploading ${url.split("/").pop()}…`);
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`\n    skip — ${res.status} ${res.statusText}`);
    return undefined;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const filename = url.split("/").pop();
  const asset = await client.assets.upload("image", buf, { filename });
  console.log(" ok");
  const ref = { _type: "image", asset: { _type: "reference", _ref: asset._id } };
  imageCache.set(url, ref);
  return ref;
}

async function publish(doc) {
  await client.createOrReplace(doc);
  console.log(`  ✓ ${doc._type}/${doc._id}`);
}

// ─── site settings ──────────────────────────────────────────────────────

async function migrateSiteSettings() {
  console.log("\nSite settings");
  await publish({
    _id: "siteSettings",
    _type: "siteSettings",
    phone: t.bg.contact.phone,
    restaurantPhone: t.bg.contact.restaurantPhone,
    email: t.bg.contact.email,
    address: localeStr(t.bg.contact.address, t.en.contact.address),
    hours: localeStr(t.bg.contact.hours, t.en.contact.hours),
    footerTagline: localeStr(t.bg.footer.tagline, t.en.footer.tagline),
    bookingUrl: "https://sky-eu1.clock-software.com/60837/10183/wbe/products/new",
    instagramUrl: "https://www.instagram.com/raya.garden/",
    facebookUrl: "https://www.facebook.com/hotel.sveta.gora",
    googleMapsUrl: "https://g.page/Park-Hotel-RAYA-Garden?share",
  });
}

// ─── pages ──────────────────────────────────────────────────────────────

async function migratePages() {
  console.log("\nPage content");

  // Home
  await publish({
    _id: "page-home",
    _type: "pageContent",
    page: "home",
    eyebrow: localeStr(t.bg.hero.eyebrow, t.en.hero.eyebrow),
    title: localeStr(t.bg.hero.title, t.en.hero.title),
    titleAccent: localeStr(t.bg.hero.titleAccent, t.en.hero.titleAccent),
    subtitle: localeStr(t.bg.hero.subtitle, t.en.hero.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-1.png`),
    intro: localeStr(t.bg.welcome.lead, t.en.welcome.lead),
    blocks: [
      { _key: "welcomeBody", key: "welcomeBody", body: localeStr(t.bg.welcome.body, t.en.welcome.body) },
      { _key: "ctaTitle", key: "ctaTitle", body: localeStr(t.bg.cta.title, t.en.cta.title) },
      { _key: "ctaText", key: "ctaText", body: localeStr(t.bg.cta.text, t.en.cta.text) },
    ],
  });

  // Hotel
  await publish({
    _id: "page-hotel",
    _type: "pageContent",
    page: "hotel",
    eyebrow: localeStr(t.bg.pages.hotel.eyebrow, t.en.pages.hotel.eyebrow),
    title: localeStr(t.bg.pages.hotel.title, t.en.pages.hotel.title),
    subtitle: localeStr(t.bg.pages.hotel.subtitle, t.en.pages.hotel.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-5.png`),
    intro: localeStr(t.bg.pages.hotel.intro, t.en.pages.hotel.intro),
  });

  // Restaurant
  await publish({
    _id: "page-restaurant",
    _type: "pageContent",
    page: "restaurant",
    eyebrow: localeStr(t.bg.pages.restaurant.eyebrow, t.en.pages.restaurant.eyebrow),
    title: localeStr(t.bg.pages.restaurant.title, t.en.pages.restaurant.title),
    subtitle: localeStr(t.bg.pages.restaurant.subtitle, t.en.pages.restaurant.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-8.png`),
    intro: localeStr(t.bg.pages.restaurant.intro, t.en.pages.restaurant.intro),
  });

  // Winery
  await publish({
    _id: "page-winery",
    _type: "pageContent",
    page: "winery",
    eyebrow: localeStr(t.bg.pages.winery.eyebrow, t.en.pages.winery.eyebrow),
    title: localeStr(t.bg.pages.winery.title, t.en.pages.winery.title),
    subtitle: localeStr(t.bg.pages.winery.subtitle, t.en.pages.winery.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-11.png`),
    extraImages: [await uploadImage(`${IMG}/hotel-all-12.png`)],
    blocks: [
      { _key: "story", key: "story", body: localeStr(t.bg.pages.winery.story, t.en.pages.winery.story) },
      { _key: "story2", key: "story2", body: localeStr(t.bg.pages.winery.story2, t.en.pages.winery.story2) },
      { _key: "visitText", key: "visitText", body: localeStr(t.bg.pages.winery.visitText, t.en.pages.winery.visitText) },
    ],
  });

  // Lake
  await publish({
    _id: "page-lake",
    _type: "pageContent",
    page: "lake",
    eyebrow: localeStr(t.bg.pages.lake.eyebrow, t.en.pages.lake.eyebrow),
    title: localeStr(t.bg.pages.lake.title, t.en.pages.lake.title),
    subtitle: localeStr(t.bg.pages.lake.subtitle, t.en.pages.lake.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-14.png`),
    intro: localeStr(t.bg.pages.lake.intro, t.en.pages.lake.intro),
  });

  // Park
  await publish({
    _id: "page-park",
    _type: "pageContent",
    page: "park",
    eyebrow: localeStr(t.bg.pages.park.eyebrow, t.en.pages.park.eyebrow),
    title: localeStr(t.bg.pages.park.title, t.en.pages.park.title),
    subtitle: localeStr(t.bg.pages.park.subtitle, t.en.pages.park.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-17.png`),
    extraImages: [await uploadImage(`${IMG}/hotel-all-15.png`)],
    blocks: [
      { _key: "parkText", key: "parkText", title: localeStr(t.bg.pages.park.parkTitle, t.en.pages.park.parkTitle), body: localeStr(t.bg.pages.park.parkText, t.en.pages.park.parkText) },
      { _key: "cityText", key: "cityText", title: localeStr(t.bg.pages.park.cityTitle, t.en.pages.park.cityTitle), body: localeStr(t.bg.pages.park.cityText, t.en.pages.park.cityText) },
    ],
  });

  // Events
  await publish({
    _id: "page-events",
    _type: "pageContent",
    page: "events",
    eyebrow: localeStr(t.bg.pages.events.eyebrow, t.en.pages.events.eyebrow),
    title: localeStr(t.bg.pages.events.title, t.en.pages.events.title),
    subtitle: localeStr(t.bg.pages.events.subtitle, t.en.pages.events.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-9.png`),
    intro: localeStr(t.bg.pages.events.intro, t.en.pages.events.intro),
    blocks: [
      { _key: "consulting", key: "consulting", title: localeStr(t.bg.pages.events.consulting, t.en.pages.events.consulting), body: localeStr(t.bg.pages.events.consultingText, t.en.pages.events.consultingText) },
    ],
  });

  // Contact
  await publish({
    _id: "page-contact",
    _type: "pageContent",
    page: "contact",
    eyebrow: localeStr(t.bg.pages.contact.eyebrow, t.en.pages.contact.eyebrow),
    title: localeStr(t.bg.pages.contact.title, t.en.pages.contact.title),
    subtitle: localeStr(t.bg.pages.contact.subtitle, t.en.pages.contact.subtitle),
    heroImage: await uploadImage(`${IMG}/hotel-all-7.png`),
  });
}

// ─── rooms ──────────────────────────────────────────────────────────────

async function migrateRooms() {
  console.log("\nRooms");
  for (let i = 0; i < rooms.bg.length; i++) {
    const bg = rooms.bg[i];
    const en = rooms.en[i];
    await publish({
      _id: `room-${bg.id}`,
      _type: "room",
      slug: { _type: "slug", current: bg.id },
      order: i,
      name: localeStr(bg.name, en.name),
      image: await uploadImage(bg.image),
      price: bg.price,
      size: bg.size,
      sleeps: bg.sleeps,
      view: localeStr(bg.view, en.view),
      amenities: localeArr(bg.amenities, en.amenities),
    });
  }
}

// ─── menu ───────────────────────────────────────────────────────────────

async function migrateMenu() {
  console.log("\nMenu");
  for (let ci = 0; ci < menu.bg.length; ci++) {
    const bgCat = menu.bg[ci];
    const enCat = menu.en[ci];
    const items = bgCat.items.map((bgIt, i) => {
      const enIt = enCat.items[i] || {};
      return {
        _key: `i${ci}-${i}`,
        _type: "menuItem",
        name: localeStr(bgIt.name, enIt.name || bgIt.name),
        price: bgIt.price,
        desc: localeStr(bgIt.desc, enIt.desc || ""),
      };
    });
    await publish({
      _id: `menu-${ci}`,
      _type: "menuCategory",
      order: ci,
      title: localeStr(bgCat.title, enCat.title),
      items,
    });
  }
}

// ─── wines ──────────────────────────────────────────────────────────────

async function migrateWines() {
  console.log("\nWines");
  const bgList = t.bg.pages.winery.wineList;
  const enList = t.en.pages.winery.wineList;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `wine-${i}`,
      _type: "wine",
      order: i,
      name: localeStr(bgList[i].name, enList[i].name),
      type: localeStr(bgList[i].type, enList[i].type),
      year: bgList[i].year,
      note: localeStr(bgList[i].note, enList[i].note),
    });
  }
}

// ─── lake pricing ───────────────────────────────────────────────────────

async function migrateLake() {
  console.log("\nLake pricing");
  await publish({
    _id: "lakePricing",
    _type: "lakePricing",
    daily: lakePricing.bg.daily.map((d, i) => ({
      _key: `d${i}`,
      label: localeStr(d.label, lakePricing.en.daily[i].label),
      price: localeStr(d.price, lakePricing.en.daily[i].price),
    })),
    fish: lakePricing.bg.fish.map((f, i) => ({
      _key: `f${i}`,
      name: localeStr(f.name, lakePricing.en.fish[i].name),
      price: localeStr(f.price, lakePricing.en.fish[i].price),
    })),
    rules: localeArr(lakePricing.bg.rules, lakePricing.en.rules),
    includes: localeArr(lakePricing.bg.includes, lakePricing.en.includes),
  });
}

// ─── event packages ─────────────────────────────────────────────────────

async function migrateEvents() {
  console.log("\nEvent packages");
  const push = async (kind, list, listEn) => {
    for (let i = 0; i < list.length; i++) {
      await publish({
        _id: `event-${kind}-${i}`,
        _type: "eventPackage",
        kind,
        order: i,
        tier: localeStr(list[i].tier, listEn[i].tier),
        from: localeStr(list[i].from, listEn[i].from),
        capacity: localeStr(list[i].capacity, listEn[i].capacity),
        includes: localeArr(list[i].includes, listEn[i].includes),
      });
    }
  };
  await push("wedding", eventsPackages.bg.weddings, eventsPackages.en.weddings);
  await push("corporate", eventsPackages.bg.corporate, eventsPackages.en.corporate);
}

// ─── special offers ─────────────────────────────────────────────────────

async function migrateOffers() {
  console.log("\nSpecial offers");
  const bgList = t.bg.offers.items;
  const enList = t.en.offers.items;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `offer-${i}`,
      _type: "specialOffer",
      order: i,
      active: true,
      tag: localeStr(bgList[i].tag, enList[i].tag),
      title: localeStr(bgList[i].title, enList[i].title),
      text: localeStr(bgList[i].text, enList[i].text),
    });
  }
}

// ─── attractions ────────────────────────────────────────────────────────

async function migrateAttractions() {
  console.log("\nNearby attractions");
  const bgList = t.bg.pages.park.attractionsList;
  const enList = t.en.pages.park.attractionsList;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `attraction-${i}`,
      _type: "attraction",
      order: i,
      name: localeStr(bgList[i].name, enList[i].name),
      note: localeStr(bgList[i].note, enList[i].note),
    });
  }
}

// ─── run ────────────────────────────────────────────────────────────────

(async () => {
  console.log(`Migrating to Sanity project ${projectId} (dataset: ${dataset})\n`);
  try {
    await migrateSiteSettings();
    await migratePages();
    await migrateRooms();
    await migrateMenu();
    await migrateWines();
    await migrateLake();
    await migrateEvents();
    await migrateOffers();
    await migrateAttractions();
    console.log("\n✓ Migration complete. Visit /studio to verify.");
  } catch (e) {
    console.error("\n✗ Migration failed:", e);
    process.exit(1);
  }
})();
