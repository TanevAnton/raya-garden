export const attraction = {
  name: "attraction",
  title: "Nearby attraction",
  type: "document",
  fields: [
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    { name: "name", title: "Name", type: "localeString" },
    { name: "note", title: "Short note", type: "localeText" },
  ],
  orderings: [
    { title: "Sort order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: { select: { title: "name.bg", subtitle: "note.bg" } },
};
