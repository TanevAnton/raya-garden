# RAYA Garden — event ad campaign

Four 24-second films, each in 9:16 (Reels/Stories) and 4:5 (feed), each with
covers in both sizes. Same look, typography, structure and end card across all
four. Nothing here has been published or uploaded to an ad account.

| Film | Files (`RAYA-Garden-<film>-…`) | Ad destination (clickable link set in the ad) |
|---|---|---|
| Events (all occasions) | `events-ad_9x16`, `events-ad_4x5`, `events-cover_*` | https://rayagarden.bg/events?lang=bg#enquiry |
| Birthdays | `birthday-ad_9x16`, `birthday-ad_4x5`, `birthday-cover_*` | https://rayagarden.bg/events?lang=bg#enquiry |
| Corporate | `corporate-ad_9x16`, `corporate-ad_4x5`, `corporate-cover_*` | https://rayagarden.bg/events?for=corporate&lang=bg#enquiry |
| Weddings | `wedding-ad_9x16`, `wedding-ad_4x5`, `wedding-cover_*` | https://rayagarden.bg/svatben-konfigurator?lang=bg |

All destinations were checked live on 2 Oct 2026:
- `/events#enquiry` opens the "Запитване за събитие" form: name, phone, event
  type (Фирмено / Сватба / Рожден ден / Друго), guests, month.
- `for=corporate` changes the hero to the corporate wording and pre-selects
  "Фирмено". Birthday has no pre-select on the site today, so the visitor picks
  "Рожден ден".
- `/svatben-konfigurator` is the 4-step wedding offer builder (date and guests,
  menu, extras, review and send). It ends by sending the enquiry to the hotel
  team, and it reserves nothing.

## Copy per film (Bulgarian)

**Birthdays.** Headline: *Вашият рожден ден в RAYA Garden*
> Рожден ден с любимите хора — на маса в градината, с вкусна храна и хубаво вино. Вие създавате повода, ние се грижим за атмосферата. RAYA Garden, Велико Търново.
> Изпратете запитване и ще се свържем с Вас.

On screen: Рожденият ден заслужава специално място. / Наздраве за още една година / Маса за любимите хора / Вие създавате повода. Ние — атмосферата. / end card.
Music: Chopin, Waltz Op. 64 No. 3 (from 0:00.9).

**Corporate.** Headline: *Вашето фирмено събитие в RAYA Garden*
> Фирмена вечеря, парти за екипа или делова среща с гледка към Велико Търново. Красиво подредени маси, внимателно обслужване и спокойна атмосфера — Вие създавате повода, ние се грижим за останалото.
> Изпратете запитване и ще се свържем с Вас.

On screen: Екипът заслужава специална вечер. / Срещи и обеди с гледка / Фирмени вечери и партита / Вие създавате повода. Ние — атмосферата. / end card.
Music: Chopin, Nocturne Op. 62 No. 2 (0:31–0:55), the same as the events film.

**Weddings.** Headline: *Вашата сватба в RAYA Garden*
> Церемония в градината с гледка, тържество в залата и внимание към всеки детайл. Вие създавате повода, ние създаваме атмосферата. Съставете своята сватбена оферта онлайн и изпратете запитване.
> RAYA Garden, Велико Търново.

On screen: Денят, за който мечтаете. / Церемония в градината / Празник с любимите хора / Вие създавате повода. Ние — атмосферата. / end card.
Music: Chopin, Nocturne Op. 32 No. 2 (from 0:13.9, the theme).

All end cards: original logo, headline, "Изпратете запитване", "Велико Търново",
rayagarden.bg (plain text, not a button). The CTA is fully readable for 5.4 s.
The copy makes no claims about capacity, prices, packages or availability.

## Photos used per film (all real, see Sources)

- **Birthdays:** gazebo at dusk with friends (0069), toast on the terrace (0039), wine on the terrace table (0024), dessert (0072), rosé pour (0075), garden gazebos (0119).
- **Corporate:** banquet table (0266), dining room with guests by the windows (0118), long tables in the hall (0269), buffet platters (0089, 0094), restaurant view over the town (0092).
- **Weddings:** head table with candles (CMS `IMG_3601`), floral ceremony arch on the lawn (0270), reception tables (CMS `IMG_3603`), table centrepiece (0267), head table in tulle (0268), garden with arch and view (0265). The crops deliberately exclude a previous couple's monogram and names on the backdrop.

---

# Events film (first film) — details

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
photo, with no text or logos generated, and no watermark on the downloads.
There are 19 clips in `project/clips/`, all checked frame by frame. Two were
regenerated after QC: the events end shot (made slower and longer) and the
wedding reception hall (the first take drifted into invented architecture).
The extra wedding photos `IMG_3601` and `IMG_3603` come from the site's Sanity
CMS (wedding section).

**Music (all films):** Musopen "Complete Chopin Collection", archive.org item
`musopen-chopin`, **CC0 1.0** (recordings), composition public domain. Files
are in `project/music/`: Nocturne Op. 62 No. 2, Waltz Op. 64 No. 3, Nocturne
Op. 32 No. 2. Events film: F. Chopin, Nocturne in E major, Op. 62 No. 2, performed for Musopen
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

Everything is driven by `project/films.json`: shots, trims, dissolves, the copy
on each card, text timings, music excerpt, ambience and cover photo for each film.

```bash
cd project
NODE_PATH=$(npm root -g) node render-overlays.cjs [film]   # text/logo cards
python3 build.py [film] [916|45]                            # videos
NODE_PATH=$(npm root -g) node render-cover.cjs [film]       # covers
```

- `render-overlays.cjs` holds the layout of each card style (positions, sizes, scrims) for both formats. The words come from `films.json`.
- `build.py` holds the shared colour grade and encoding settings. It needs ffmpeg.
- `clips/` has the 19 Higgsfield clips, `overlays/<film>/<format>/` has the rendered PNG cards, and `logo/`, `fonts/`, `music/` and `source-photos/` hold the inputs.

To swap in a high-resolution or RESTAURANT version of the logo, replace
`logo/raya-garden-park-hotel_white.png`, then re-run the overlays and the build.
