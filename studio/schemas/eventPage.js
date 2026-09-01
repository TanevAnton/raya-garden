// Toggleable seasonal/event landing pages (New Year, Easter, concerts…).
// Each active document gets its own page at /event/<slug> and a GOLD link
// in the site menu. Flip "Active" off to hide both instantly — the
// document (photos, texts) stays saved for next year.

export const eventPage = {
  name: "eventPage",
  title: "Event page (New Year, holidays…)",
  type: "document",
  fields: [
    {
      name: "active",
      title: "Active (visible on the website)",
      description:
        "ON → the page is live and a gold link appears in the menu. OFF → both disappear; the content stays saved for reuse.",
      type: "boolean",
      initialValue: false,
    },
    { name: "order", title: "Menu order (if several are active)", type: "number", initialValue: 0 },
    {
      name: "slug",
      title: "URL slug",
      description: "The page lives at /event/<slug>, e.g. nova-godina-2027. Latin letters and dashes.",
      type: "slug",
      options: { source: "menuTitle.en", maxLength: 60 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: "menuTitle",
      title: "Menu label (shown in gold in the navigation)",
      type: "localeString",
      validation: (Rule) => Rule.required(),
    },
    { name: "eyebrow", title: "Hero eyebrow (small line above the title)", type: "localeString" },
    { name: "title", title: "Hero title", type: "localeString", validation: (Rule) => Rule.required() },
    { name: "subtitle", title: "Hero subtitle", type: "localeText" },
    {
      name: "heroImage",
      title: "Hero photo",
      type: "image",
      options: { hotspot: true },
    },
    { name: "intro", title: "Intro paragraph", type: "localeText" },
    {
      name: "highlights",
      title: "Highlights (bullet list — program, what's included…)",
      type: "localeArray",
    },
    {
      name: "priceText",
      title: "Price line (e.g. „от 199 € на човек“)",
      description: "Optional. Shown emphasized under the highlights.",
      type: "localeString",
    },
    {
      name: "gallery",
      title: "Photo gallery with captions",
      description:
        "Alternating photo + text rows. Add extra photos to an item to turn it into a carousel.",
      type: "array",
      of: [
        {
          type: "object",
          name: "eventGalleryItem",
          fields: [
            {
              name: "image",
              title: "Main photo",
              type: "image",
              options: { hotspot: true },
              validation: (Rule) => Rule.required(),
            },
            {
              name: "extraImages",
              title: "Additional photos (optional, becomes a carousel)",
              type: "array",
              of: [{ type: "image", options: { hotspot: true } }],
            },
            { name: "title", title: "Title", type: "localeString" },
            { name: "text", title: "Caption / description", type: "localeText" },
          ],
          preview: { select: { title: "title.bg", media: "image" } },
        },
      ],
    },
    {
      name: "offerPdfs",
      title: "Offer files (PDF) — e.g. hotel offer + restaurant offer",
      description:
        "Each entry becomes a download button on the page. Upload the PDF into the slot; entries without a file are simply not shown.",
      type: "array",
      of: [
        {
          type: "object",
          name: "offerPdf",
          fields: [
            {
              name: "label",
              title: "Button label",
              type: "localeString",
              validation: (Rule) => Rule.required(),
            },
            {
              name: "pdf",
              title: "PDF file",
              type: "file",
              options: { accept: "application/pdf" },
            },
            {
              name: "previewImage",
              title: "Preview image (optional)",
              description:
                "A small cover thumbnail shown next to the download link — usually the first page of the PDF. If left empty the link still works, just without a picture.",
              type: "image",
              options: { hotspot: true },
            },
          ],
          preview: {
            select: { title: "label.bg", media: "previewImage" },
            prepare: ({ title, media }) => ({
              title: title || "(unnamed PDF)",
              media,
            }),
          },
        },
      ],
    },
  ],
  orderings: [
    { title: "Menu order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { title: "menuTitle.bg", active: "active", slug: "slug.current" },
    prepare: ({ title, active, slug }) => ({
      title: `${active ? "🟢" : "⚪️"} ${title || "(untitled)"}`,
      subtitle: `/event/${slug || "…"}${active ? "" : " · hidden"}`,
    }),
  },
};
