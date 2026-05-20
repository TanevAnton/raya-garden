#!/usr/bin/env node
/**
 * Refactors event packages in Sanity from the legacy `from` localeString
 * (free text like "от 41 € / гост (~80 лв)") to structured fields:
 *   priceEur (number) + unit (localeString).
 *
 * Idempotent: re-running just re-applies the same values.
 * Also unsets the legacy `from` field on each doc.
 *
 * Run once:  node scripts/migrate-event-packages-to-structured.mjs
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

// Source of truth for the EUR price + per-language unit word.
const packages = {
  "event-wedding-0":   { priceEur: 41,  unit: { bg: "гост", en: "guest", ro: "invitat" } },
  "event-wedding-1":   { priceEur: 77,  unit: { bg: "гост", en: "guest", ro: "invitat" } },
  "event-wedding-2":   { priceEur: 31,  unit: { bg: "гост", en: "guest", ro: "invitat" } },
  "event-corporate-0": { priceEur: 24,  unit: { bg: "участник", en: "participant", ro: "participant" } },
  "event-corporate-1": { priceEur: 34,  unit: { bg: "участник", en: "participant", ro: "participant" } },
  "event-corporate-2": { priceEur: 123, unit: { bg: "участник", en: "participant", ro: "participant" } },
};

(async () => {
  console.log("Patching event packages to priceEur + unit, unsetting legacy `from`…");
  for (const [id, info] of Object.entries(packages)) {
    try {
      await client
        .patch(id)
        .set({ priceEur: info.priceEur, unit: info.unit })
        .unset(["from"])
        .commit();
      console.log(`  ✓ ${id}  →  ${info.priceEur} € / ${info.unit.bg}`);
    } catch (e) {
      if (e?.statusCode === 404 || /not found/i.test(e?.message || "")) {
        console.log(`  – ${id} doesn't exist (skipped)`);
      } else {
        throw e;
      }
    }
  }
  console.log("\n✓ Done.");
})();
