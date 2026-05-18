#!/usr/bin/env node
// One-shot cleanup: delete lakePricing + wine documents from Sanity.
// The Lake page has been removed from the site and the Winery page no
// longer renders a wine list — these documents are now orphaned.
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

const idsToDelete = [
  "lakePricing",
  "page-lake",
  "wine-0",
  "wine-1",
  "wine-2",
  "wine-3",
  "wine-4",
  "wine-5",
  "menu-0",
  "menu-1",
  "menu-2",
  "menu-3",
  "menu-4",
  "menu-5",
  "menu-6",
];

(async () => {
  for (const id of idsToDelete) {
    try {
      await client.delete(id);
      console.log(`  ✓ deleted ${id}`);
    } catch (e) {
      console.log(`  – ${id} (already gone or doesn't exist)`);
    }
  }
  console.log("\n✓ Cleanup done.");
})();
