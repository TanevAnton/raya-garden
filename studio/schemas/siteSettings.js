// Singleton — global site info (phones, email, hours, socials, footer tagline).
export const siteSettings = {
  name: "siteSettings",
  title: "Site settings",
  type: "document",
  __experimental_actions: ["update", "publish"],
  fields: [
    {
      name: "logo",
      title: "Logo",
      description:
        "Square logo shown in the top-left of the navigation. Best uploaded as a PNG with transparent background, at least 200×200 px.",
      type: "image",
      options: { hotspot: true },
    },
    { name: "phone", title: "Main phone", type: "string" },
    { name: "restaurantPhone", title: "Restaurant phone", type: "string" },
    { name: "email", title: "Contact email", type: "string" },
    { name: "address", title: "Address", type: "localeString" },
    { name: "hours", title: "Reception / check-in hours", type: "localeString" },
    { name: "footerTagline", title: "Footer tagline", type: "localeString" },
    { name: "bookingUrl", title: "Booking-engine URL", type: "url" },
    { name: "instagramUrl", title: "Instagram URL", type: "url" },
    { name: "facebookUrl", title: "Facebook URL", type: "url" },
    { name: "googleMapsUrl", title: "Google Maps share URL", type: "url" },
    {
      name: "menuPdf",
      title: "Restaurant menu (PDF)",
      description:
        "Upload the current menu PDF. The Download button on /restaurant will link to this.",
      type: "file",
      options: { accept: "application/pdf" },
    },
  ],
  preview: { prepare: () => ({ title: "Site settings" }) },
};
