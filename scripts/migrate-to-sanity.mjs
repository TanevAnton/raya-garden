#!/usr/bin/env node
/**
 * One-shot migration: pushes data.js + translations.js content into Sanity.
 * Trilingual (BG/EN/RO). Idempotent — re-running replaces documents.
 *
 * Usage:
 *   npm run migrate
 *
 * Requires VITE_SANITY_PROJECT_ID + SANITY_WRITE_TOKEN in .env.local.
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";
import { rooms, menu, lakePricing, eventsPackages, IMG } from "../src/data.js";
import { translations as t } from "../src/translations.js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const projectId = process.env.VITE_SANITY_PROJECT_ID;
const dataset = process.env.VITE_SANITY_DATASET || "production";
const token = process.env.SANITY_WRITE_TOKEN;

if (!projectId || !token) {
  console.error(
    "Missing VITE_SANITY_PROJECT_ID or SANITY_WRITE_TOKEN in .env.local."
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

const lStr = (bg, en, ro) => ({ bg, en, ro });
const lArr = (bg, en, ro) => ({ bg, en, ro });

// Read the same key across all three translation roots.
const tri = (path) => {
  const get = (obj) => path.split(".").reduce((o, k) => o?.[k], obj);
  return lStr(get(t.bg), get(t.en), get(t.ro));
};

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
  // Re-fetch existing siteSettings so we preserve any uploaded files (menuPdf)
  // that aren't in our source data.
  const existing = await client.fetch(`*[_id == "siteSettings"][0]`);
  await publish({
    _id: "siteSettings",
    _type: "siteSettings",
    phone: t.bg.contact.phone,
    restaurantPhone: t.bg.contact.restaurantPhone,
    email: t.bg.contact.email,
    address: tri("contact.address"),
    hours: tri("contact.hours"),
    footerTagline: tri("footer.tagline"),
    bookingUrl: "https://sky-eu1.clock-software.com/spa/pms-wbe/#/hotel/15003",
    instagramUrl: "https://www.instagram.com/raya.garden/",
    facebookUrl: "https://www.facebook.com/hotel.sveta.gora",
    googleMapsUrl: "https://g.page/Park-Hotel-RAYA-Garden?share",
    ...(existing?.menuPdf ? { menuPdf: existing.menuPdf } : {}),
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
    eyebrow: tri("hero.eyebrow"),
    title: tri("hero.title"),
    titleAccent: tri("hero.titleAccent"),
    subtitle: tri("hero.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-1.png`),
    intro: tri("welcome.lead"),
    blocks: [
      { _key: "welcomeBody", key: "welcomeBody", body: tri("welcome.body") },
      { _key: "ctaTitle", key: "ctaTitle", body: tri("cta.title") },
      { _key: "ctaText", key: "ctaText", body: tri("cta.text") },
    ],
  });

  await publish({
    _id: "page-hotel",
    _type: "pageContent",
    page: "hotel",
    eyebrow: tri("pages.hotel.eyebrow"),
    title: tri("pages.hotel.title"),
    subtitle: tri("pages.hotel.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-5.png`),
    intro: tri("pages.hotel.intro"),
  });

  await publish({
    _id: "page-restaurant",
    _type: "pageContent",
    page: "restaurant",
    eyebrow: tri("pages.restaurant.eyebrow"),
    title: tri("pages.restaurant.title"),
    subtitle: tri("pages.restaurant.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-8.png`),
    intro: tri("pages.restaurant.intro"),
  });

  await publish({
    _id: "page-winery",
    _type: "pageContent",
    page: "winery",
    eyebrow: tri("pages.winery.eyebrow"),
    title: tri("pages.winery.title"),
    subtitle: tri("pages.winery.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-11.png`),
    extraImages: [await uploadImage(`${IMG}/hotel-all-12.png`)],
    blocks: [
      { _key: "story", key: "story", body: tri("pages.winery.story") },
      { _key: "story2", key: "story2", body: tri("pages.winery.story2") },
      { _key: "visitText", key: "visitText", body: tri("pages.winery.visitText") },
    ],
  });

  await publish({
    _id: "page-lake",
    _type: "pageContent",
    page: "lake",
    eyebrow: tri("pages.lake.eyebrow"),
    title: tri("pages.lake.title"),
    subtitle: tri("pages.lake.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-14.png`),
    intro: tri("pages.lake.intro"),
  });

  await publish({
    _id: "page-park",
    _type: "pageContent",
    page: "park",
    eyebrow: tri("pages.park.eyebrow"),
    title: tri("pages.park.title"),
    subtitle: tri("pages.park.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-17.png`),
    extraImages: [await uploadImage(`${IMG}/hotel-all-15.png`)],
    blocks: [
      { _key: "parkText", key: "parkText", title: tri("pages.park.parkTitle"), body: tri("pages.park.parkText") },
      { _key: "cityText", key: "cityText", title: tri("pages.park.cityTitle"), body: tri("pages.park.cityText") },
    ],
  });

  await publish({
    _id: "page-events",
    _type: "pageContent",
    page: "events",
    eyebrow: tri("pages.events.eyebrow"),
    title: tri("pages.events.title"),
    subtitle: tri("pages.events.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-9.png`),
    intro: tri("pages.events.intro"),
    blocks: [
      { _key: "consulting", key: "consulting", title: tri("pages.events.consulting"), body: tri("pages.events.consultingText") },
    ],
  });

  await publish({
    _id: "page-contact",
    _type: "pageContent",
    page: "contact",
    eyebrow: tri("pages.contact.eyebrow"),
    title: tri("pages.contact.title"),
    subtitle: tri("pages.contact.subtitle"),
    heroImage: await uploadImage(`${IMG}/hotel-all-7.png`),
  });
}

// ─── rooms ──────────────────────────────────────────────────────────────

async function migrateRooms() {
  console.log("\nRooms");
  for (let i = 0; i < rooms.bg.length; i++) {
    const bg = rooms.bg[i];
    const en = rooms.en[i];
    const ro = rooms.ro?.[i] || {};
    await publish({
      _id: `room-${bg.id}`,
      _type: "room",
      slug: { _type: "slug", current: bg.id },
      order: i,
      name: lStr(bg.name, en.name, ro.name),
      image: await uploadImage(bg.image),
      price: bg.price,
      size: bg.size,
      sleeps: bg.sleeps,
      view: lStr(bg.view, en.view, ro.view),
      amenities: lArr(bg.amenities, en.amenities, ro.amenities),
    });
  }
}

// ─── menu ───────────────────────────────────────────────────────────────

async function migrateMenu() {
  console.log("\nMenu");
  for (let ci = 0; ci < menu.bg.length; ci++) {
    const bgCat = menu.bg[ci];
    const enCat = menu.en[ci];
    const roCat = menu.ro?.[ci];
    const items = bgCat.items.map((bgIt, i) => {
      const enIt = enCat.items[i] || {};
      const roIt = roCat?.items?.[i] || {};
      return {
        _key: `i${ci}-${i}`,
        _type: "menuItem",
        name: lStr(bgIt.name, enIt.name || bgIt.name, roIt.name),
        price: bgIt.price,
        desc: lStr(bgIt.desc, enIt.desc || "", roIt.desc),
      };
    });
    await publish({
      _id: `menu-${ci}`,
      _type: "menuCategory",
      order: ci,
      title: lStr(bgCat.title, enCat.title, roCat?.title),
      items,
    });
  }
}

// ─── wines ──────────────────────────────────────────────────────────────

async function migrateWines() {
  console.log("\nWines");
  const bgList = t.bg.pages.winery.wineList;
  const enList = t.en.pages.winery.wineList;
  const roList = t.ro.pages.winery.wineList;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `wine-${i}`,
      _type: "wine",
      order: i,
      name: lStr(bgList[i].name, enList[i].name, roList[i].name),
      type: lStr(bgList[i].type, enList[i].type, roList[i].type),
      year: bgList[i].year,
      note: lStr(bgList[i].note, enList[i].note, roList[i].note),
    });
  }
}

// ─── lake pricing ───────────────────────────────────────────────────────

async function migrateLake() {
  console.log("\nLake pricing");
  const bg = lakePricing.bg;
  const en = lakePricing.en;
  const ro = lakePricing.ro;
  await publish({
    _id: "lakePricing",
    _type: "lakePricing",
    daily: bg.daily.map((d, i) => ({
      _key: `d${i}`,
      label: lStr(d.label, en.daily[i].label, ro.daily[i].label),
      price: lStr(d.price, en.daily[i].price, ro.daily[i].price),
    })),
    fish: bg.fish.map((f, i) => ({
      _key: `f${i}`,
      name: lStr(f.name, en.fish[i].name, ro.fish[i].name),
      price: lStr(f.price, en.fish[i].price, ro.fish[i].price),
    })),
    rules: lArr(bg.rules, en.rules, ro.rules),
    includes: lArr(bg.includes, en.includes, ro.includes),
  });
}

// ─── event packages ─────────────────────────────────────────────────────

async function migrateEvents() {
  console.log("\nEvent packages");
  const push = async (kind, bgList, enList, roList) => {
    for (let i = 0; i < bgList.length; i++) {
      await publish({
        _id: `event-${kind}-${i}`,
        _type: "eventPackage",
        kind,
        order: i,
        tier: lStr(bgList[i].tier, enList[i].tier, roList[i].tier),
        from: lStr(bgList[i].from, enList[i].from, roList[i].from),
        capacity: lStr(bgList[i].capacity, enList[i].capacity, roList[i].capacity),
        includes: lArr(bgList[i].includes, enList[i].includes, roList[i].includes),
      });
    }
  };
  await push("wedding", eventsPackages.bg.weddings, eventsPackages.en.weddings, eventsPackages.ro.weddings);
  await push("corporate", eventsPackages.bg.corporate, eventsPackages.en.corporate, eventsPackages.ro.corporate);
}

// ─── special offers ─────────────────────────────────────────────────────

async function migrateOffers() {
  console.log("\nSpecial offers");
  const bgList = t.bg.offers.items;
  const enList = t.en.offers.items;
  const roList = t.ro.offers.items;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `offer-${i}`,
      _type: "specialOffer",
      order: i,
      active: true,
      tag: lStr(bgList[i].tag, enList[i].tag, roList[i].tag),
      title: lStr(bgList[i].title, enList[i].title, roList[i].title),
      text: lStr(bgList[i].text, enList[i].text, roList[i].text),
    });
  }
}

// ─── attractions ────────────────────────────────────────────────────────

async function migrateAttractions() {
  console.log("\nNearby attractions");
  const bgList = t.bg.pages.park.attractionsList;
  const enList = t.en.pages.park.attractionsList;
  const roList = t.ro.pages.park.attractionsList;
  for (let i = 0; i < bgList.length; i++) {
    await publish({
      _id: `attraction-${i}`,
      _type: "attraction",
      order: i,
      name: lStr(bgList[i].name, enList[i].name, roList[i].name),
      note: lStr(bgList[i].note, enList[i].note, roList[i].note),
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
    console.log("\n✓ Migration complete.");
  } catch (e) {
    console.error("\n✗ Migration failed:", e);
    process.exit(1);
  }
})();
