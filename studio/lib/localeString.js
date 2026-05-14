// Reusable bilingual (BG/EN) string + text + portable text types.
// Every translatable field on a document uses one of these.

export const localeString = {
  name: "localeString",
  type: "object",
  title: "Localized string",
  fields: [
    { name: "bg", type: "string", title: "Български", validation: (Rule) => Rule.required() },
    { name: "en", type: "string", title: "English" },
  ],
  options: { columns: 2 },
};

export const localeText = {
  name: "localeText",
  type: "object",
  title: "Localized text",
  fields: [
    { name: "bg", type: "text", title: "Български", rows: 4, validation: (Rule) => Rule.required() },
    { name: "en", type: "text", title: "English", rows: 4 },
  ],
};

export const localeArray = {
  name: "localeArray",
  type: "object",
  title: "Localized list",
  fields: [
    {
      name: "bg",
      type: "array",
      title: "Български",
      of: [{ type: "string" }],
      options: { layout: "list" },
      validation: (Rule) => Rule.required().min(1),
    },
    {
      name: "en",
      type: "array",
      title: "English",
      of: [{ type: "string" }],
      options: { layout: "list" },
    },
  ],
};
