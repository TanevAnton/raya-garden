// Custom Studio sidebar.
// Top group "Quick edits" pins the docs that change most often
// (prices, offers, the menu PDF). The rest is the full content tree.
export const structure = (S) =>
  S.list()
    .title("Content")
    .items([
      // ─── Quick edits — the daily/weekly stuff ────────────────────
      S.listItem()
        .id("quick-edits")
        .title("⚡ Quick edits — prices, offers, menu")
        .child(
          S.list()
            .title("Quick edits")
            .items([
              S.documentTypeListItem("room")
                .title("💰 Room prices")
                .child(
                  S.documentTypeList("room")
                    .title("Room prices (in EUR — BGN shown automatically)")
                ),
              S.documentTypeListItem("eventPackage")
                .title("🎉 Event package prices")
                .child(
                  S.documentTypeList("eventPackage")
                    .title("Wedding & corporate packages")
                ),
              S.documentTypeListItem("specialOffer")
                .title("🎁 Special offers")
                .child(
                  S.documentTypeList("specialOffer")
                    .title("Special offers (toggle Active to hide)")
                ),
              S.listItem()
                .id("menu-pdf-shortcut")
                .title("📄 Restaurant menu PDF")
                .child(
                  S.document()
                    .schemaType("siteSettings")
                    .documentId("siteSettings")
                    .title("Restaurant menu PDF — scroll to bottom")
                ),
            ])
        ),
      S.divider(),
      // ─── Full content tree ───────────────────────────────────────
      S.listItem()
        .title("Site settings")
        .id("siteSettings-full")
        .child(
          S.document().schemaType("siteSettings").documentId("siteSettings")
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
      S.documentTypeListItem("eventPackage").title("Event packages"),
      S.documentTypeListItem("attraction").title("Nearby attractions"),
    ]);
