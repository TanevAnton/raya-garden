// Custom Studio sidebar.
// Top group "Quick edits" pins the docs that change most often
// (prices, offers, PDFs). The rest is the full content tree.
export const structure = (S) =>
  S.list()
    .title("Content")
    .items([
      // ─── Quick edits — the daily/weekly stuff ────────────────────
      S.listItem()
        .id("quick-edits")
        .title("⚡ Quick edits — prices, offers, PDFs")
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
              S.documentTypeListItem("specialOffer")
                .title("🎁 Special offers")
                .child(
                  S.documentTypeList("specialOffer")
                    .title("Special offers (toggle Active to hide)")
                ),
              S.listItem()
                .id("brochures-shortcut")
                .title("📄 PDFs (menu + brochures)")
                .child(
                  S.document()
                    .schemaType("siteSettings")
                    .documentId("siteSettings")
                    .title("PDFs — scroll to the bottom of Site settings")
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
      S.documentTypeListItem("attraction").title("Nearby attractions"),
    ]);
