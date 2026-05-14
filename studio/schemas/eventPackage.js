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
    { name: "from", title: "Price line (e.g. 'от 8 500 лв')", type: "localeString" },
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
    select: { title: "tier.bg", subtitle: "kind", media: undefined },
    prepare: ({ title, subtitle }) => ({
      title,
      subtitle: subtitle === "wedding" ? "Wedding" : "Corporate",
    }),
  },
};
