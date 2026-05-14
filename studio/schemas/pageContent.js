// One document per page (home, hotel, restaurant, etc.) holding
// the editable hero / intro / section copy that pages render.
// Static UI labels (nav, buttons, form labels) stay in src/translations.js.

export const pageContent = {
  name: "pageContent",
  title: "Page content",
  type: "document",
  fields: [
    {
      name: "page",
      title: "Page",
      type: "string",
      options: {
        list: [
          { title: "Home", value: "home" },
          { title: "Hotel", value: "hotel" },
          { title: "Restaurant", value: "restaurant" },
          { title: "Winery", value: "winery" },
          { title: "Lake", value: "lake" },
          { title: "Park & Town", value: "park" },
          { title: "Events", value: "events" },
          { title: "Contact", value: "contact" },
        ],
      },
      validation: (Rule) => Rule.required(),
    },
    { name: "eyebrow", title: "Hero eyebrow", type: "localeString" },
    { name: "title", title: "Hero title", type: "localeString" },
    { name: "titleAccent", title: "Hero title accent (Home only)", type: "localeString" },
    { name: "subtitle", title: "Hero subtitle", type: "localeText" },
    {
      name: "heroImage",
      title: "Hero photo",
      type: "image",
      options: { hotspot: true },
    },
    { name: "intro", title: "Intro paragraph (rooms / restaurant / lake etc.)", type: "localeText" },
    {
      name: "extraImages",
      title: "Additional photos",
      description: "Used by pages that show a gallery / split image (Winery, Park, etc.)",
      type: "array",
      of: [{ type: "image", options: { hotspot: true } }],
    },
    {
      name: "blocks",
      title: "Free-form copy blocks",
      description: "Optional named text blocks (e.g. wineryStory, parkText, cityText, consulting, visitText)",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            { name: "key", title: "Key", type: "string", description: "e.g. story, story2, parkText, cityText" },
            { name: "title", title: "Optional heading", type: "localeString" },
            { name: "body", title: "Body", type: "localeText" },
          ],
          preview: { select: { title: "key", subtitle: "body.bg" } },
        },
      ],
    },
  ],
  preview: { select: { title: "page", subtitle: "title.bg" } },
};
