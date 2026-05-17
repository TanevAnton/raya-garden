import { createClient } from "@sanity/client";
import imageUrlBuilder from "@sanity/image-url";

export const PROJECT_ID = import.meta.env.VITE_SANITY_PROJECT_ID || "";
export const DATASET = import.meta.env.VITE_SANITY_DATASET || "production";
export const SANITY_ENABLED = Boolean(PROJECT_ID);

export const sanityClient = SANITY_ENABLED
  ? createClient({
      projectId: PROJECT_ID,
      dataset: DATASET,
      apiVersion: "2024-10-01",
      useCdn: import.meta.env.PROD,
      perspective: "published",
    })
  : null;

const builder = sanityClient ? imageUrlBuilder(sanityClient) : null;

export function urlFor(source) {
  if (!builder || !source) return "";
  return builder.image(source);
}

// Pick the active language out of a localeString / localeText.
// Fallback order: requested lang → EN → BG. A Romanian visitor whose
// RO content isn't filled in yet sees EN rather than BG they can't read.
export function pickLocale(field, lang) {
  if (!field) return "";
  if (typeof field === "string") return field;
  return field[lang] || field.en || field.bg || "";
}
