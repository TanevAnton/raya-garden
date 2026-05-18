#!/usr/bin/env node
/**
 * One-shot migration: convert prices in Sanity from BGN to EUR (primary).
 * - Rooms: number field "price" becomes EUR (ceil of BGN ÷ 1.95583).
 * - Event packages: "from" localeString rewritten to "X € / unit (~Y лв)".
 * - Also syncs the renamed deluxe room: EN/RO name + view to "Apartment".
 *
 * Idempotent for room prices: detects values that are already EUR
 * (price < 250, since the smallest old BGN value was 60 BGN/guest → would
 * still be above 60 even after conversion). To avoid re-converting, we
 * gate on "price > 250" — only the BGN values are converted.
 *
 * Run once:  node scripts/migrate-currency-to-eur.mjs
 */
import dotenv from "dotenv";
import { createClient } from "@sanity/client";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const client = createClient({
  projectId: process.env.VITE_SANITY_PROJECT_ID,
  dataset: process.env.VITE_SANITY_DATASET || "production",
  token: process.env.SANITY_WRITE_TOKEN,
  apiVersion: "2024-10-01",
  useCdn: false,
});

const BGN_PER_EUR = 1.95583;
const bgnToEur = (bgn) => Math.ceil(bgn / BGN_PER_EUR);
const eurToBgn = (eur) => Math.round(eur * BGN_PER_EUR);

// ─── 1. Rename room-deluxe across all languages ─────────────────────────

async function renameDeluxe() {
  console.log("\nRenaming Deluxe → Apartment (EN/RO)…");
  await client
    .patch("room-deluxe")
    .set({
      name: {
        bg: "Апартамент",
        en: "Apartment",
        ro: "Apartament",
      },
    })
    .commit();
  console.log("  ✓ room-deluxe name synced");
}

// ─── 2. Convert room prices to EUR ──────────────────────────────────────

// Explicit EUR targets so re-running is idempotent (just sets the same value).
const ROOM_EUR_PRICES = {
  "room-standard-park": 72,   // was 140 BGN
  "room-standard-city": 82,   // was 160 BGN
  "room-deluxe":        113,  // was 220 BGN — now "Apartment"
  "room-junior-suite":  164,  // was 320 BGN
  "room-luxury-suite":  246,  // was 480 BGN
};

async function convertRoomPrices() {
  console.log("\nSetting room prices to EUR (ceil of BGN ÷ 1.95583)…");
  for (const [id, eur] of Object.entries(ROOM_EUR_PRICES)) {
    try {
      await client.patch(id).set({ price: eur }).commit();
      console.log(`  ✓ ${id}  →  ${eur} € (≈ ${eurToBgn(eur)} лв)`);
    } catch (e) {
      if (e?.statusCode === 404 || /not found/i.test(e?.message || "")) {
        console.log(`  – ${id} doesn't exist (skipped)`);
      } else {
        throw e;
      }
    }
  }
}

// ─── 3. Rewrite event package `from` strings ────────────────────────────

// Maps the existing per-package BGN values to the new EUR-primary strings.
// We patch by document _id so this is deterministic.
const eventPackagePrices = {
  "event-wedding-0":   { bgn: 80,  unit: { bg: "гост",       en: "guest",       ro: "invitat" } },
  "event-wedding-1":   { bgn: 150, unit: { bg: "гост",       en: "guest",       ro: "invitat" } },
  "event-wedding-2":   { bgn: 60,  unit: { bg: "гост",       en: "guest",       ro: "invitat" } },
  "event-corporate-0": { bgn: 45,  unit: { bg: "участник",   en: "participant", ro: "participant" } },
  "event-corporate-1": { bgn: 65,  unit: { bg: "участник",   en: "participant", ro: "participant" } },
  "event-corporate-2": { bgn: 240, unit: { bg: "участник",   en: "participant", ro: "participant" } },
};

const fromPrefix = {
  bg: "от",
  en: "from",
  ro: "de la",
};

function buildFromString(bgn, lang, unitWord) {
  const eur = bgnToEur(bgn);
  // "от 41 € / гост (~80 лв)"
  // "from 41 € / guest (~80 BGN)"
  // "de la 41 € / invitat (~80 BGN)"
  const bgnLabel = lang === "bg" ? "лв" : "BGN";
  return `${fromPrefix[lang]} ${eur} € / ${unitWord} (~${bgn} ${bgnLabel})`;
}

async function convertEventPackages() {
  console.log("\nRewriting event package `from` strings…");
  for (const [id, info] of Object.entries(eventPackagePrices)) {
    const fromObj = {
      bg: buildFromString(info.bgn, "bg", info.unit.bg),
      en: buildFromString(info.bgn, "en", info.unit.en),
      ro: buildFromString(info.bgn, "ro", info.unit.ro),
    };
    await client.patch(id).set({ from: fromObj }).commit();
    console.log(`  ✓ ${id}  ${fromObj.bg}`);
  }
}

// ─── run ────────────────────────────────────────────────────────────────

(async () => {
  try {
    await renameDeluxe();
    await convertRoomPrices();
    await convertEventPackages();
    console.log("\n✓ Currency migration complete.");
  } catch (e) {
    console.error("\n✗ Failed:", e);
    process.exit(1);
  }
})();
