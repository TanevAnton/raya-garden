export const wine = {
  name: "wine",
  title: "Wine",
  type: "document",
  fields: [
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    { name: "name", title: "Wine name", type: "localeString" },
    { name: "type", title: "Type (e.g. Red dry)", type: "localeString" },
    { name: "year", title: "Vintage", type: "string" },
    { name: "note", title: "Tasting note", type: "localeText" },
  ],
  orderings: [
    { title: "Sort order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { title: "name.bg", subtitle: "year" },
  },
};
