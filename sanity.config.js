import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./studio/schemas/index.js";
import { structure } from "./studio/structure.js";

// Sanity CLI reads SANITY_STUDIO_* env vars from .env.
// Falls back to VITE_SANITY_* so a single .env.local works for both
// the frontend (Vite) and the Studio (Sanity CLI).
const projectId =
  process.env.SANITY_STUDIO_PROJECT_ID ||
  process.env.VITE_SANITY_PROJECT_ID ||
  "";
const dataset =
  process.env.SANITY_STUDIO_DATASET ||
  process.env.VITE_SANITY_DATASET ||
  "production";

export default defineConfig({
  name: "raya-garden",
  title: "RAYA Garden",
  projectId,
  dataset,
  plugins: [structureTool({ structure }), visionTool()],
  schema: { types: schemaTypes },
});
