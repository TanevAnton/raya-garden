export const menuCategory = {
  name: "menuCategory",
  title: "Menu category",
  type: "document",
  fields: [
    { name: "order", title: "Sort order", type: "number", initialValue: 0 },
    { name: "title", title: "Category title", type: "localeString" },
    {
      name: "items",
      title: "Dishes",
      type: "array",
      of: [
        {
          type: "object",
          name: "menuItem",
          fields: [
            { name: "name", title: "Name", type: "localeString" },
            { name: "price", title: "Price (BGN)", type: "number" },
            { name: "desc", title: "Description", type: "localeText" },
          ],
          preview: {
            select: { title: "name.bg", subtitle: "price" },
            prepare: ({ title, subtitle }) => ({
              title,
              subtitle: subtitle != null ? `${subtitle} лв` : "",
            }),
          },
        },
      ],
    },
  ],
  orderings: [
    { title: "Sort order", name: "order", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { title: "title.bg", subtitle: "order" },
    prepare: ({ title, subtitle }) => ({
      title,
      subtitle: subtitle != null ? `Order: ${subtitle}` : "",
    }),
  },
};
