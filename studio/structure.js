// Custom Studio structure: pin singletons (Site settings, Lake pricing)
// at the top and present pageContent grouped by page.
export const structure = (S) =>
  S.list()
    .title("Content")
    .items([
      S.listItem()
        .title("Site settings")
        .id("siteSettings")
        .child(
          S.document().schemaType("siteSettings").documentId("siteSettings")
        ),
      S.listItem()
        .title("Lake — pricing & rules")
        .id("lakePricing")
        .child(
          S.document().schemaType("lakePricing").documentId("lakePricing")
        ),
      S.divider(),
      S.listItem()
        .title("Page content")
        .schemaType("pageContent")
        .child(S.documentTypeList("pageContent").title("Pages")),
      S.divider(),
      S.documentTypeListItem("specialOffer").title("Special offers"),
      S.divider(),
      S.documentTypeListItem("room").title("Rooms & suites"),
      S.documentTypeListItem("menuCategory").title("Menu categories"),
      S.documentTypeListItem("wine").title("Wines"),
      S.documentTypeListItem("eventPackage").title("Event packages"),
      S.documentTypeListItem("attraction").title("Nearby attractions"),
    ]);
