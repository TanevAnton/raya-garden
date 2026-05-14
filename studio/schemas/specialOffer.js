export const specialOffer = {
  name: "specialOffer",
  title: "Special offer",
  type: "document",
  fields: [
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    {
      name: "active",
      title: "Currently active",
      type: "boolean",
      description: "Untick to hide this offer from the website without deleting it.",
      initialValue: true,
    },
    { name: "tag", title: "Tag (e.g. 'Нова Година 2026')", type: "localeString" },
    { name: "title", title: "Title", type: "localeString" },
    { name: "text", title: "Description", type: "localeText" },
    {
      name: "image",
      title: "Photo (optional)",
      type: "image",
      options: { hotspot: true },
    },
    {
      name: "validFrom",
      title: "Valid from",
      type: "date",
    },
    {
      name: "validTo",
      title: "Valid to",
      type: "date",
    },
    {
      name: "ctaLink",
      title: "Optional CTA link",
      type: "url",
      description: "Booking engine URL, or leave blank to use the default 'Send inquiry' button.",
    },
  ],
  orderings: [
    { title: "Sort order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { title: "title.bg", subtitle: "tag.bg", media: "image" },
  },
};
