# RAYA Garden — event enquiry ad (“Вие създавате повода. Ние — атмосферата.”)

Nothing here has been published or uploaded to an ad account.

## Files

| File | What it is |
|---|---|
| `RAYA-Garden-events-ad_9x16_1080x1920.mp4` | Main film: 24.0 s, 1080×1920, H.264 24 fps, AAC 48 kHz stereo, −15 LUFS |
| `RAYA-Garden-events-ad_4x5_1080x1350.mp4` | Feed version: same cut, reframed per shot, typography re-laid out for 4:5 |
| `RAYA-Garden-events-cover_9x16_1080x1920.jpg` | Reels/Stories cover |
| `RAYA-Garden-events-cover_4x5_1080x1350.jpg` | Feed cover |
| `project/` | Editable project (see “Editing” below) |

## Ad destination (clickable link, set in the ad, not in the video)

**https://rayagarden.bg/events?lang=bg#enquiry**

Checked live on 2 Oct 2026 in a real browser: the page opens in Bulgarian and
scrolls to the “Запитване за събитие” form, which has these fields: Име, Телефон,
Тип събитие (Фирмено / Сватба / Рожден ден / Друго), Брой гости, Месец and a
consent box, plus “Изпрати запитване”. `?lang=bg` forces Bulgarian, because
without it the site picks the language by geo-IP. For an audience that is only
companies, `https://rayagarden.bg/events?for=corporate&lang=bg#enquiry` also works:
it switches the hero to the corporate wording and pre-selects “Фирмено”.

The video shows only `rayagarden.bg` as plain text, not styled as a button.

## Copy (Bulgarian)

**Headline:** Вашето събитие в RAYA Garden

**Primary text / caption:**
> Фирмено събитие, рожден ден, годишнина или вечеря с приятели — Вие създавате повода, ние се грижим за атмосферата. Красиво подредени маси, топла светлина и внимание към всеки детайл в RAYA Garden, Велико Търново.
> Изпратете запитване и ще се свържем с Вас.

**Description (optional):** Запитване за събитие — Велико Търново

**Call-to-action button:** “Изпратете запитване” if the platform offers it, or the closest equivalent (Meta: “Get quote” / “Contact us”).

The copy deliberately makes no claims about capacity, prices, packages, availability or included services.

## Timeline (9:16)

| Time | Shot (real photo → Higgsfield image-to-video) | Move | On screen |
|---|---|---|---|
| 0.0–3.0 | 0266 evening banquet table, event hall | slow push-in | Всеки повод заслужава / специално място. |
| 3.0–7.6 | 0269 long tables in the hall, daylight | lateral glide | Фирмени събития |
| 7.6–12.4 | 0069 garden gazebo at dusk, guests at the table | slow push-in | Лични празници |
| 12.4–15.1 | 0072 desserts | slow drift | Вие създавате повода. |
| 15.1–17.6 | 0075 rosé being poured | near-static push | + Ние — атмосферата. |
| 17.6–24.0 | 0092 restaurant view over Veliko Tarnovo | very slow push-in | Logo, Вашето събитие в RAYA Garden, Изпратете запитване, Велико Търново, rayagarden.bg (fully readable 18.6–24.0 = 5.4 s) |

Transitions: 0.4 s dissolves between sections and straight cuts inside the detail pair.

## Sources and rights

**Venue photos:** “RAYA Garden & Yalovo Winery” Collect by WeTransfer board
(`collect.wetransfer.com/board/s2wxfcucjpp12u3gx20240603164308`). It loaded here
and has 303 photos plus one MP4. The originals were downloaded at 2000 px, the
largest size the board serves. Files used: `Raya Garden, Yalovo Winery-0266 / 0269 / 0069 / 0072 / 0075 / 0092.jpg`
(copies in `project/source-photos/`). The winery-only shots (barrels, cellar,
river bottles) were left out. Please confirm you hold the photographer's usage
rights for paid advertising.

**Logo:** original RAYA GARDEN / PARK HOTEL lockup, taken from the official
corporate brochure PDF linked on rayagarden.bg/events. It is black artwork on
transparency, 216 px. For the video it was recoloured to white only: same pixels
and alpha, not redrawn. The site's own `logo.png` is the emblem alone (270 px).
The “RESTAURANT” lockup described in the brief was not attached in this session,
and I couldn't find it on the site or in its CMS.

**Video:** Higgsfield, Kling 3.0 Pro image-to-video (Ultra plan), one clip per
photo, with no text or logos generated. Job IDs: c2f6d3be, 02201912, ad09f5d2,
3b486a63, 7d8b565c, eedfa567. No watermark on the downloads.

**Music:** F. Chopin, Nocturne in E major, Op. 62 No. 2, performed for Musopen
(“Set Chopin Free”). Recording released under **CC0 1.0** (archive.org item
`musopen-chopin`; Wikimedia Commons marks it PD-author (Musopen)), and the
composition is public domain. Excerpt 0:31–0:55 is used. Commercial use is
allowed with no attribution needed. The licence record is in
`project/music/archive.org_musopen-chopin_metadata.json`.

**Ambience:** the native audio of the hall clip and the pour clip, mixed low
under the music. The gazebo clip's native audio was discarded: Whisper found
invented English dialogue in it.

**Fonts:** Cormorant Garamond and Montserrat (SIL Open Font License, Google Fonts),
using standard Cyrillic letterforms.

## Editing (`project/`)

- `render-overlays.cjs` holds every text and logo card as HTML/CSS, one layout for each format. To change copy, sizes or positions, edit it and run `NODE_PATH=$(npm root -g) node render-overlays.cjs`.
- `build.py` holds the timeline: shot trims, dissolves, text fade times, music excerpt, ambience and colour grade. Run `python3 build.py` (or `python3 build.py 916` / `45`) to re-render. It needs ffmpeg.
- `render-cover.cjs` renders the two covers.
- `clips/` has the six Higgsfield clips. `overlays/` has the rendered PNG cards. `logo/`, `fonts/`, `music/` and `source-photos/` hold the inputs.

To swap in a high-resolution or RESTAURANT version of the logo, replace
`logo/raya-garden-park-hotel_white.png`, then re-run the overlays and the build.
