// Cover images per film (films.json -> cover): the real venue photo, the
// original RAYA Garden lockup (white recolour) and the film's headline.
//   NODE_PATH=$(npm root -g) node render-cover.cjs [film ...]
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const here = __dirname;
const f = (p) => "file://" + path.join(here, p);
const films = JSON.parse(fs.readFileSync(path.join(here, "films.json"), "utf8"));

const page = (w, h, photo, pos, headline) => `<!doctype html><html lang="bg-x-std"><head><meta charset="utf-8"><style>
@font-face { font-family: Cormorant; src: url(${f("fonts/CormorantGaramond.ttf")}); font-weight: 300 700; }
* { margin:0; padding:0; box-sizing:border-box; font-feature-settings:"locl" 0; }
body { width:${w}px; height:${h}px; position:relative; overflow:hidden; background:#0d1420; }
.bg { position:absolute; inset:0; background:url('${f(photo)}') ${pos} / cover no-repeat; }
.shade { position:absolute; inset:0; background:linear-gradient(rgba(0,0,0,.66), rgba(0,0,0,.3) 42%, rgba(0,0,0,0) 62%); }
.stack { position:absolute; left:0; right:0; top:${Math.round(h * (h > 1500 ? 0.13 : 0.07))}px; text-align:center; color:#F7F2E9; }
img { width:${Math.round(w * 0.21)}px; height:auto; }
h1 { font-family:Cormorant, serif; font-weight:600; font-size:${Math.round(w * 0.074)}px; line-height:1.08; margin-top:${Math.round(w * 0.05)}px;
     text-shadow:0 2px 18px rgba(0,0,0,.45); white-space:nowrap; }
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="stack"><img src="${f("logo/raya-garden-park-hotel_white.png")}"><h1>${headline}</h1></div></body></html>`;

(async () => {
  const wanted = process.argv.slice(2);
  const b = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });
  for (const [film, cfg] of Object.entries(films)) {
    if (film.startsWith("_") || (wanted.length && !wanted.includes(film))) continue;
    const c = cfg.cover;
    for (const [w, h, pos, suffix] of [[1080, 1920, c.pos916, "9x16_1080x1920"], [1080, 1350, c.pos45, "4x5_1080x1350"]]) {
      const p = await b.newPage({ viewport: { width: w, height: h } });
      const file = path.join(here, `_cover_${film}_${suffix}.html`);
      fs.writeFileSync(file, page(w, h, c.photo, `center ${pos}`, c.headline));
      await p.goto("file://" + file);
      await p.evaluate(() => document.fonts.ready);
      await p.waitForTimeout(200);
      await p.screenshot({ path: path.join(here, "..", `${cfg.out.replace("-ad", "")}-cover_${suffix}.jpg`), type: "jpeg", quality: 92 });
      await p.close();
    }
  }
  await b.close();
  console.log("covers rendered");
})();
