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
      name: "includedAmenities",
      title: "“Included with every stay” list",
      description:
        "Hotel page only. The list shown at the bottom of /hotel under \"Included with every stay\".",
      type: "localeArray",
    },
    {
      name: "formNote",
      title: "Form note (Contact page)",
      description:
        "The small italic line under the contact form, e.g. \"We will get back to you within 24 hours.\"",
      type: "localeText",
    },
    {
      name: "experiences",
      title: "“One place, many experiences” cards",
      description:
        "Home page only. The dark grid of icon + title + description cards under \"Why RAYA Garden\".",
      type: "array",
      of: [
        {
          type: "object",
          name: "experienceCard",
          fields: [
            {
              name: "icon",
              title: "Icon",
              type: "string",
              options: {
                list: [
                  { title: "🍃 Leaf — nature", value: "leaf" },
                  { title: "✨ Sparkles — premium", value: "sparkles" },
                  { title: "♡ Heart — weddings", value: "heart" },
                  { title: "💼 Briefcase — business", value: "briefcase" },
                  { title: "👶 Baby — family", value: "baby" },
                  { title: "🌲 Trees — sustainability", value: "trees" },
                  { title: "🍷 Wine — winery", value: "wine" },
                  { title: "🐟 Fish — lake", value: "fish" },
                  { title: "🌙 Moon — spa", value: "moon" },
                  { title: "⛰ Mountain — view", value: "mountain" },
                  { title: "👥 Users — groups", value: "users" },
                  { title: "🌊 Waves — wellness", value: "waves" },
                ],
                layout: "dropdown",
              },
            },
            { name: "title", title: "Title", type: "localeString" },
            { name: "text", title: "Description", type: "localeText" },
          ],
          preview: {
            select: { title: "title.bg", subtitle: "text.bg", icon: "icon" },
            prepare: ({ title, subtitle, icon }) => ({
              title: `${icon ? `[${icon}] ` : ""}${title || ""}`,
              subtitle,
            }),
          },
        },
      ],
    },
    {
      name: "gallery",
      title: "Photo gallery with captions",
      description:
        "Used on the Restaurant page (and any other page that wants paired image + text cards).",
      type: "array",
      of: [
        {
          type: "object",
          name: "galleryItem",
          fields: [
            {
              name: "image",
              title: "Photo",
              type: "image",
              options: { hotspot: true },
              validation: (Rule) => Rule.required(),
            },
            { name: "title", title: "Title", type: "localeString" },
            { name: "text", title: "Caption / description", type: "localeText" },
          ],
          preview: {
            select: { title: "title.bg", subtitle: "text.bg", media: "image" },
          },
        },
      ],
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
