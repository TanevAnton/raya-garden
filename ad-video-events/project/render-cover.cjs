// Cover images: real photo (garden gazebo at dusk, board image 0069), the
// original RAYA Garden lockup (white recolour) and the headline.
//   NODE_PATH=$(npm root -g) node render-cover.cjs
const { chromium } = require("playwright");
const path = require("path");
const here = __dirname;
const f = (p) => "file://" + path.join(here, p);

const page = (w, h, top) => `<!doctype html><html lang="bg-x-std"><head><meta charset="utf-8"><style>
@font-face { font-family: Cormorant; src: url(${f("fonts/CormorantGaramond.ttf")}); font-weight: 300 700; }
* { margin:0; padding:0; box-sizing:border-box; font-feature-settings:"locl" 0; }
body { width:${w}px; height:${h}px; position:relative; overflow:hidden; background:#0d1420; }
.bg { position:absolute; inset:0; background:url('${f("source-photos/Raya Garden, Yalovo Winery-0069.jpg")}') center ${top} / cover no-repeat; }
.shade { position:absolute; inset:0; background:linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.18) 45%, rgba(0,0,0,0) 60%); }
.stack { position:absolute; left:0; right:0; top:${Math.round(h * (h > 1500 ? 0.13 : 0.07))}px; text-align:center; color:#F7F2E9; }
img { width:${Math.round(w * 0.21)}px; height:auto; }
h1 { font-family:Cormorant, serif; font-weight:600; font-size:${Math.round(w * 0.074)}px; line-height:1.08; margin-top:${Math.round(w * 0.05)}px;
     text-shadow:0 2px 18px rgba(0,0,0,.45); }
</style></head><body><div class="bg"></div><div class="shade"></div>
<div class="stack"><img src="${f("logo/raya-garden-park-hotel_white.png")}"><h1>Вашето събитие<br>в RAYA Garden</h1></div></body></html>`;

(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });
  for (const [w, h, top, name] of [[1080, 1920, "40%", "cover_9x16_1080x1920.jpg"], [1080, 1350, "0%", "cover_4x5_1080x1350.jpg"]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const file = path.join(here, `_cover_${w}x${h}.html`);
    require("fs").writeFileSync(file, page(w, h, top));
    await p.goto("file://" + file);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(200);
    await p.screenshot({ path: path.join(here, "..", "RAYA-Garden-events-" + name), type: "jpeg", quality: 92 });
  }
  await b.close();
  console.log("covers rendered");
})();
