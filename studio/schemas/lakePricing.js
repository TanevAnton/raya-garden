// Singleton — exactly one document of this type.
export const lakePricing = {
  name: "lakePricing",
  title: "Lake — pricing & rules",
  type: "document",
  __experimental_actions: ["update", "publish"], // singleton: no create/delete
  fields: [
    {
      name: "daily",
      title: "Daily rates",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            { name: "label", title: "Label", type: "localeString" },
            { name: "price", title: "Price", type: "localeString" },
          ],
          preview: { select: { title: "label.bg", subtitle: "price.bg" } },
        },
      ],
    },
    {
      name: "fish",
      title: "Stocked species & price/kg",
      type: "array",
      of: [
        {
          type: "object",
          fields: [
            { name: "name", title: "Species", type: "localeString" },
            { name: "price", title: "Price / kg", type: "localeString" },
          ],
          preview: { select: { title: "name.bg", subtitle: "price.bg" } },
        },
      ],
    },
    { name: "rules", title: "Rules", type: "localeArray" },
    { name: "includes", title: "What the fee includes", type: "localeArray" },
  ],
  preview: { prepare: () => ({ title: "Lake — pricing & rules" }) },
};
