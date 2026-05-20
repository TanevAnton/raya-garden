import { EurWithBgnPreview } from "../components/EurWithBgnPreview.jsx";

export const room = {
  name: "room",
  title: "Room / Suite",
  type: "document",
  fields: [
    {
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "name.en", maxLength: 50 },
      validation: (Rule) => Rule.required(),
    },
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    { name: "name", title: "Name", type: "localeString" },
    {
      name: "image",
      title: "Photo",
      type: "image",
      options: { hotspot: true },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "price",
      title: "Price per night (EUR)",
      description:
        "Type the price in euros. The BGN equivalent is computed automatically (fixed peg 1 € = 1.95583 лв).",
      type: "number",
      components: { input: EurWithBgnPreview },
      validation: (Rule) => Rule.required().positive(),
    },
    { name: "size", title: "Size (m²)", type: "number" },
    { name: "sleeps", title: "Sleeps up to", type: "number" },
    {
      name: "sleepsLabel",
      title: "Sleeps label (override)",
      description:
        "Optional. If set, replaces the number in the \"up to X guests\" line on the website. Use for rooms with multiple bed configurations, e.g. \"4 (2+2)\".",
      type: "localeString",
    },
    { name: "view", title: "View description", type: "localeString" },
    {
      name: "amenities",
      title: "Amenities",
      type: "localeArray",
    },
  ],
  orderings: [
    { title: "Sort order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { title: "name.bg", subtitle: "price", media: "image" },
    prepare: ({ title, subtitle, media }) => ({
      title,
      subtitle: subtitle ? `от ${subtitle} € / нощ` : "—",
      media,
    }),
  },
};
