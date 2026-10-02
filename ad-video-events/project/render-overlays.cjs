// Renders every text/logo card of every film as a transparent PNG, once per
// format, with headless Chromium. The copy lives in films.json; the layout
// (positions, sizes, scrims) lives here, one block per style and format.
//
//   NODE_PATH=$(npm root -g) node render-overlays.cjs [film ...]
//
// Output: overlays/<film>/<format>/<card>.png   (format = 916 | 45)
//
// Cyrillic is set with the standard (not the Bulgarian-localised) glyph
// forms for at-a-glance readability on a phone. The logo is the original
// RAYA GARDEN / PARK HOTEL lockup from the official corporate brochure,
// recoloured to white only (same pixels, same alpha) — never redrawn.
//
// Safe areas: 9:16 keeps copy between y≈250 and y≈1420 and inside x 90–990
// (Reels/Stories top bar, caption block and right-hand action rail);
// 4:5 keeps 70 px margins.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const films = JSON.parse(fs.readFileSync(path.join(here, "films.json"), "utf8"));
const url = (p) => "file://" + path.join(here, p);
const logo = url("logo/raya-garden-park-hotel_white.png");

const CSS = `
@font-face { font-family: Cormorant; src: url(${url("fonts/CormorantGaramond.ttf")}); font-weight: 300 700; }
@font-face { font-family: Montserrat; src: url(${url("fonts/Montserrat.ttf")}); font-weight: 100 900; }
* { margin: 0; padding: 0; box-sizing: border-box; font-feature-settings: "locl" 0; }
html, body { background: transparent; }
body { position: relative; overflow: hidden; color: #F7F2E9; -webkit-font-smoothing: antialiased; }
.scrim { position: absolute; left: 0; right: 0; }
.block { position: absolute; left: 0; right: 0; text-align: center; }
.serif { font-family: Cormorant, serif; font-weight: 600; line-height: 1.08;
         text-shadow: 0 2px 18px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35); }
.sans  { font-family: Montserrat, sans-serif; font-weight: 500; text-shadow: 0 1px 10px rgba(0,0,0,.5); }
.rule  { display: block; margin: 0 auto; height: 2px; background: rgba(247,242,233,.75); }
.fit   { white-space: nowrap; }
`;

const down = (a, h) => `linear-gradient(rgba(0,0,0,${a}),rgba(0,0,0,${(a * 0.7).toFixed(2)}) 50%,rgba(0,0,0,0))`;
const band = (a) => `linear-gradient(rgba(0,0,0,0),rgba(0,0,0,${a}) 32%,rgba(0,0,0,${a}) 68%,rgba(0,0,0,0))`;

// style -> (card) -> html, per format. `fit` = max text width in px.
const LAYOUT = {
  916: { w: 1080, h: 1920, fit: 880,
    "hook-lower": (c) => `
      <div class="scrim" style="top:780px;height:560px;background:${band(c.scrim ?? 0.58)}"></div>
      <div class="block serif" style="top:962px;font-size:80px">${c.text}</div>`,
    "hook-top": (c) => `
      <div class="scrim" style="top:0;height:900px;background:${down(c.scrim ?? 0.66)}"></div>
      <div class="block serif" style="top:300px;font-size:84px">${c.text}</div>`,
    title: (c) => `
      <div class="scrim" style="top:0;height:900px;background:${down(c.scrim ?? 0.74)}"></div>
      <div class="block" style="top:318px"><span class="rule" style="width:64px"></span></div>
      <div class="block serif fit" style="top:352px;font-size:104px">${c.text}</div>`,
    "title-lower": (c) => `
      <div class="scrim" style="top:1000px;height:620px;background:${band(c.scrim ?? 0.6)}"></div>
      <div class="block" style="top:1146px"><span class="rule" style="width:64px"></span></div>
      <div class="block serif" style="top:1180px;font-size:88px">${c.text}</div>`,
    tagline1: (c) => `
      <div class="scrim" style="top:0;height:900px;background:${down(c.scrim ?? 0.76)}"></div>
      <div class="block serif fit" style="top:318px;font-size:84px">${c.text}</div>`,
    tagline2: (c) => `
      <div class="block serif fit" style="top:420px;font-size:84px">${c.text}</div>`,
    end: (c) => `
      <div class="scrim" style="top:0;height:1920px;background:radial-gradient(ellipse 90% 60% at 50% 45%,rgba(0,0,0,${c.scrim ?? 0.48}),rgba(0,0,0,${Math.min(0.8, (c.scrim ?? 0.48) + 0.2)}))"></div>
      <div class="block" style="top:430px"><img src="${logo}" style="width:232px;height:auto"></div>
      <div class="block serif" style="top:700px;font-size:72px">${c.text}</div>
      <div class="block" style="top:906px"><span class="rule" style="width:56px;height:1.5px"></span></div>
      <div class="block sans" style="top:944px;font-size:44px;font-weight:600">Изпратете запитване</div>
      <div class="block sans" style="top:1032px;font-size:27px;letter-spacing:.32em;text-transform:uppercase;opacity:.92">Велико Търново</div>
      <div class="block sans" style="top:1090px;font-size:28px;font-weight:400;letter-spacing:.06em;opacity:.85">rayagarden.bg</div>`,
  },
  45: { w: 1080, h: 1350, fit: 920,
    "hook-lower": (c) => `
      <div class="scrim" style="top:810px;height:540px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.6) 40%,rgba(0,0,0,.66))"></div>
      <div class="block serif" style="top:1030px;font-size:76px">${c.text}</div>`,
    "hook-top": (c) => `
      <div class="scrim" style="top:0;height:640px;background:${down(c.scrim ?? 0.66)}"></div>
      <div class="block serif" style="top:110px;font-size:78px">${c.text}</div>`,
    title: (c) => `
      <div class="scrim" style="top:0;height:620px;background:${down(c.scrim ?? 0.74)}"></div>
      <div class="block" style="top:112px"><span class="rule" style="width:56px"></span></div>
      <div class="block serif fit" style="top:140px;font-size:92px">${c.text}</div>`,
    "title-lower": (c) => `
      <div class="scrim" style="top:800px;height:550px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.6) 40%,rgba(0,0,0,.66))"></div>
      <div class="block" style="top:1000px"><span class="rule" style="width:56px"></span></div>
      <div class="block serif" style="top:1032px;font-size:80px">${c.text}</div>`,
    tagline1: (c) => `
      <div class="scrim" style="top:0;height:660px;background:${down(c.scrim ?? 0.76)}"></div>
      <div class="block serif fit" style="top:110px;font-size:78px">${c.text}</div>`,
    tagline2: (c) => `
      <div class="block serif fit" style="top:204px;font-size:78px">${c.text}</div>`,
    end: (c) => `
      <div class="scrim" style="top:0;height:1350px;background:radial-gradient(ellipse 90% 70% at 50% 48%,rgba(0,0,0,${c.scrim ?? 0.48}),rgba(0,0,0,${Math.min(0.8, (c.scrim ?? 0.48) + 0.2)}))"></div>
      <div class="block" style="top:170px"><img src="${logo}" style="width:216px;height:auto"></div>
      <div class="block serif" style="top:420px;font-size:68px">${c.text}</div>
      <div class="block" style="top:612px"><span class="rule" style="width:52px;height:1.5px"></span></div>
      <div class="block sans" style="top:646px;font-size:42px;font-weight:600">Изпратете запитване</div>
      <div class="block sans" style="top:728px;font-size:26px;letter-spacing:.32em;text-transform:uppercase;opacity:.92">Велико Търново</div>
      <div class="block sans" style="top:784px;font-size:27px;font-weight:400;letter-spacing:.06em;opacity:.85">rayagarden.bg</div>`,
  },
};

(async () => {
  const wanted = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });
  for (const [film, cfg] of Object.entries(films)) {
    if (film.startsWith("_") || (wanted.length && !wanted.includes(film))) continue;
    for (const [fmt, L] of Object.entries(LAYOUT)) {
      const dir = path.join(here, "overlays", film, fmt);
      fs.mkdirSync(dir, { recursive: true });
      const page = await browser.newPage({ viewport: { width: L.w, height: L.h } });
      for (const card of cfg.cards) {
        const html = `<!doctype html><html lang="bg-x-std"><head><meta charset="utf-8"><style>${CSS}
          body{width:${L.w}px;height:${L.h}px}</style></head><body>${L[card.style](card)}</body></html>`;
        const file = path.join(dir, `_${card.id}.html`);
        fs.writeFileSync(file, html);
        await page.goto("file://" + file);
        await page.evaluate(() => document.fonts.ready);
        // Single-line copy that would run past the safe width is scaled down
        // until it fits, so a longer title never reaches the screen edge.
        await page.evaluate((max) => {
          for (const el of document.querySelectorAll(".fit")) {
            const r = document.createRange(); r.selectNodeContents(el);
            let size = parseFloat(getComputedStyle(el).fontSize);
            while (r.getBoundingClientRect().width > max && size > 40) {
              size -= 2; el.style.fontSize = size + "px";
            }
          }
        }, L.fit);
        await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(dir, `${card.id}.png`), omitBackground: true });
      }
      await page.close();
    }
  }
  await browser.close();
  console.log("overlays rendered");
})();
