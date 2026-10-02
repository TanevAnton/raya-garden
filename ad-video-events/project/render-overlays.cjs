// Renders every text/logo card of the ad as a transparent PNG, once per
// format, with headless Chromium. Typography lives here as HTML/CSS so the
// Bulgarian copy is shaped by a real text engine (Cyrillic, kerning,
// variable-font weights) and can be edited without touching the video.
//
//   NODE_PATH=$(npm root -g) node render-overlays.cjs
//
// Output: overlays/<format>/<card>.png  (format = 916 | 45)
// The logo is the original PARK HOTEL lockup from the official corporate
// brochure, recoloured to white only (same pixels, same alpha) — never redrawn.

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const font = (f) => "file://" + path.join(here, "fonts", f);
const logo = "file://" + path.join(here, "logo", "raya-garden-park-hotel_white.png");

const CSS = `
@font-face { font-family: Cormorant; src: url(${font("CormorantGaramond.ttf")}); font-weight: 300 700; }
@font-face { font-family: Montserrat; src: url(${font("Montserrat.ttf")}); font-weight: 100 900; }
* { margin: 0; padding: 0; box-sizing: border-box; font-feature-settings: "locl" 0; }
html, body { background: transparent; }
body { width: var(--w); height: var(--h); position: relative; overflow: hidden;
       color: #F7F2E9; -webkit-font-smoothing: antialiased; }
.scrim { position: absolute; left: 0; right: 0; }
.block { position: absolute; left: 0; right: 0; text-align: center; }
.serif { font-family: Cormorant, serif; font-weight: 600; line-height: 1.08;
         text-shadow: 0 2px 18px rgba(0,0,0,.45), 0 1px 3px rgba(0,0,0,.35); }
.sans  { font-family: Montserrat, sans-serif; font-weight: 500;
         text-shadow: 0 1px 10px rgba(0,0,0,.5); }
.rule  { display: block; margin: 0 auto; height: 2px; background: rgba(247,242,233,.75); }
`;

// Each card: list of absolutely positioned pieces. y values are the TOP of
// the block in px. Safe areas: 9:16 keeps everything between y=250 and
// y=1300 and 90px from the sides (Reels/Stories UI); 4:5 keeps 70px margins.
const FORMATS = {
  916: { w: 1080, h: 1920, cards: {
    hook: `
      <div class="scrim" style="top:780px;height:560px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.58) 32%,rgba(0,0,0,.58) 68%,rgba(0,0,0,0))"></div>
      <div class="block serif" style="top:962px;font-size:80px;padding:0 110px">Всеки повод заслужава<br>специално място.</div>`,
    corporate: `
      <div class="scrim" style="top:0;height:900px;background:linear-gradient(rgba(0,0,0,.74),rgba(0,0,0,.52) 50%,rgba(0,0,0,0))"></div>
      <div class="block" style="top:318px"><span class="rule" style="width:64px"></span></div>
      <div class="block serif" style="top:352px;font-size:104px">Фирмени събития</div>`,
    private: `
      <div class="scrim" style="top:0;height:820px;background:linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,.26) 55%,rgba(0,0,0,0))"></div>
      <div class="block" style="top:318px"><span class="rule" style="width:64px"></span></div>
      <div class="block serif" style="top:352px;font-size:104px">Лични празници</div>`,
    tagline1: `
      <div class="scrim" style="top:0;height:900px;background:linear-gradient(rgba(0,0,0,.76),rgba(0,0,0,.56) 50%,rgba(0,0,0,0))"></div>
      <div class="block serif" style="top:318px;font-size:84px">Вие създавате повода.</div>`,
    tagline2: `
      <div class="block serif" style="top:420px;font-size:84px">Ние — атмосферата.</div>`,
    endcard: `
      <div class="scrim" style="top:0;height:1920px;background:radial-gradient(ellipse 90% 60% at 50% 45%,rgba(0,0,0,.48),rgba(0,0,0,.68))"></div>
      <div class="block" style="top:430px"><img src="${logo}" style="width:232px;height:auto"></div>
      <div class="block serif" style="top:700px;font-size:72px;font-weight:600">Вашето събитие<br>в RAYA Garden</div>
      <div class="block" style="top:906px"><span class="rule" style="width:56px;height:1.5px"></span></div>
      <div class="block sans" style="top:944px;font-size:44px;font-weight:600;letter-spacing:.01em">Изпратете запитване</div>
      <div class="block sans" style="top:1032px;font-size:27px;font-weight:500;letter-spacing:.32em;text-transform:uppercase;opacity:.92">Велико Търново</div>
      <div class="block sans" style="top:1090px;font-size:28px;font-weight:400;letter-spacing:.06em;opacity:.85">rayagarden.bg</div>`,
  }},
  45: { w: 1080, h: 1350, cards: {
    hook: `
      <div class="scrim" style="top:810px;height:540px;background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.6) 40%,rgba(0,0,0,.66))"></div>
      <div class="block serif" style="top:1030px;font-size:76px;padding:0 70px">Всеки повод заслужава<br>специално място.</div>`,
    corporate: `
      <div class="scrim" style="top:0;height:620px;background:linear-gradient(rgba(0,0,0,.74),rgba(0,0,0,.5) 50%,rgba(0,0,0,0))"></div>
      <div class="block" style="top:112px"><span class="rule" style="width:56px"></span></div>
      <div class="block serif" style="top:140px;font-size:92px">Фирмени събития</div>`,
    private: `
      <div class="scrim" style="top:0;height:560px;background:linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,.24) 55%,rgba(0,0,0,0))"></div>
      <div class="block" style="top:112px"><span class="rule" style="width:56px"></span></div>
      <div class="block serif" style="top:140px;font-size:92px">Лични празници</div>`,
    tagline1: `
      <div class="scrim" style="top:0;height:660px;background:linear-gradient(rgba(0,0,0,.76),rgba(0,0,0,.54) 50%,rgba(0,0,0,0))"></div>
      <div class="block serif" style="top:110px;font-size:78px">Вие създавате повода.</div>`,
    tagline2: `
      <div class="block serif" style="top:204px;font-size:78px">Ние — атмосферата.</div>`,
    endcard: `
      <div class="scrim" style="top:0;height:1350px;background:radial-gradient(ellipse 90% 70% at 50% 48%,rgba(0,0,0,.48),rgba(0,0,0,.68))"></div>
      <div class="block" style="top:170px"><img src="${logo}" style="width:216px;height:auto"></div>
      <div class="block serif" style="top:420px;font-size:68px;font-weight:600">Вашето събитие<br>в RAYA Garden</div>
      <div class="block" style="top:612px"><span class="rule" style="width:52px;height:1.5px"></span></div>
      <div class="block sans" style="top:646px;font-size:42px;font-weight:600">Изпратете запитване</div>
      <div class="block sans" style="top:728px;font-size:26px;font-weight:500;letter-spacing:.32em;text-transform:uppercase;opacity:.92">Велико Търново</div>
      <div class="block sans" style="top:784px;font-size:27px;font-weight:400;letter-spacing:.06em;opacity:.85">rayagarden.bg</div>`,
  }},
};

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--allow-file-access-from-files"] });
  for (const [name, fmt] of Object.entries(FORMATS)) {
    const dir = path.join(here, "overlays", name);
    fs.mkdirSync(dir, { recursive: true });
    const page = await browser.newPage({ viewport: { width: fmt.w, height: fmt.h }, deviceScaleFactor: 1 });
    for (const [card, body] of Object.entries(fmt.cards)) {
      const html = `<!doctype html><html lang="bg-x-std"><head><meta charset="utf-8"><style>${CSS}
        body{--w:${fmt.w}px;--h:${fmt.h}px}</style></head><body>${body}</body></html>`;
      const file = path.join(dir, `_${card}.html`);
      fs.writeFileSync(file, html);
      await page.goto("file://" + file);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(dir, `${card}.png`), omitBackground: true });
    }
    await page.close();
  }
  await browser.close();
  console.log("overlays rendered");
})();
