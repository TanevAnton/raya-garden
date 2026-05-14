import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";
import { schemaTypes } from "./studio/schemas/index.js";
import { structure } from "./studio/structure.js";

// projectId is public (visible in API URLs); safe to hardcode.
// The dataset is also public.
export default defineConfig({
  name: "raya-garden",
  title: "RAYA Garden",
  projectId: "q2yxl7gs",
  dataset: "production",
  plugins: [structureTool({ structure }), visionTool()],
  schema: { types: schemaTypes },
});
