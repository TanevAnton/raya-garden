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
      title: "Price per night (BGN)",
      type: "number",
      validation: (Rule) => Rule.required().positive(),
    },
    { name: "size", title: "Size (m²)", type: "number" },
    { name: "sleeps", title: "Sleeps up to", type: "number" },
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
      subtitle: subtitle ? `от ${subtitle} лв / нощ` : "—",
      media,
    }),
  },
};
