import { EurWithBgnPreview } from "../components/EurWithBgnPreview.jsx";

export const eventPackage = {
  name: "eventPackage",
  title: "Event package",
  type: "document",
  fields: [
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    {
      name: "kind",
      title: "Kind",
      type: "string",
      options: {
        list: [
          { title: "Wedding", value: "wedding" },
          { title: "Corporate / team-building", value: "corporate" },
        ],
        layout: "radio",
      },
      validation: (Rule) => Rule.required(),
    },
    { name: "tier", title: "Tier name", type: "localeString" },
    {
      name: "priceEur",
      title: "Price from (EUR)",
      description:
        "Per guest / participant. BGN equivalent shown below is calculated automatically.",
      type: "number",
      components: { input: EurWithBgnPreview },
      validation: (Rule) => Rule.required().positive(),
    },
    {
      name: "unit",
      title: "Unit (per …)",
      description: "What the price is per — e.g. \"guest\", \"participant\".",
      type: "localeString",
    },
    { name: "capacity", title: "Capacity (e.g. 'до 120 души')", type: "localeString" },
    { name: "includes", title: "What's included", type: "localeArray" },
  ],
  orderings: [
    { title: "Kind + order", name: "kindOrder", by: [
      { field: "kind", direction: "asc" },
      { field: "order", direction: "asc" },
    ]},
  ],
  preview: {
    select: { title: "tier.bg", subtitle: "kind", priceEur: "priceEur" },
    prepare: ({ title, subtitle, priceEur }) => ({
      title,
      subtitle: `${subtitle === "wedding" ? "Wedding" : "Corporate"}${
        priceEur ? ` · от ${priceEur} €` : ""
      }`,
    }),
  },
};
