#!/usr/bin/env node
// The QR code for table ordering, and the A6 card to print it on.
//
//   npm run qr:print                    one card with a blank "Маса №" box,
//                                       to write the number in on the day
//   npm run qr:print -- --tables 40     one card per table, numbered 1–40
//
// Every card carries the SAME code, https://rayagarden.bg/menu/: the tables
// are numbered on the day of each event, so the guest picks their table on
// the phone and the cards can be reused for any arrangement.
//
// Writes into docs/qr-ordering/print/:
//   raya-menu-qr.svg     the code alone, vector — for any other design
//   raya-menu-qr.png     the same, 1200 px, for tools that want a picture
//   table-card-a6.pdf    (or table-cards-a6-1-40.pdf) 105 × 148 mm, print at
//                        100 % / "actual size"
//
// Error correction level Q (a quarter of the code can be smudged or covered
// and it still scans) with the standard four-module quiet zone. The logo is
// public/img/logo.png, recoloured dark for a light card; it is a 270 px
// picture, sharp at the 20 mm it is printed here but no bigger — a vector
// logo would be better.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import puppeteer from "puppeteer";

const URL = "https://rayagarden.bg/menu/";
const OUT = "docs/qr-ordering/print";
const INK = "#100e0c";
const GOLD = "#a87f28";

const arg = process.argv.indexOf("--tables");
const tables = arg > 0 ? Number(process.argv[arg + 1]) : 0;
if (arg > 0 && !(Number.isInteger(tables) && tables >= 1 && tables <= 300)) {
  console.error("--tables needs a number from 1 to 300");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
const options = { errorCorrectionLevel: "Q", margin: 4, color: { dark: INK, light: "#ffffff" } };
const svg = await QRCode.toString(URL, { ...options, type: "svg" });
writeFileSync(path.join(OUT, "raya-menu-qr.svg"), svg);
await QRCode.toFile(path.join(OUT, "raya-menu-qr.png"), URL, { ...options, width: 1200 });

const logo = `data:image/png;base64,${readFileSync("public/img/logo.png").toString("base64")}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const card = (n) => `
<section class="card">
  <img class="logo" src="${logo}" alt="">
  <p class="brand">RAYA Garden</p>
  <h1>Меню и поръчка</h1>
  <p class="en">Menu &amp; ordering</p>
  <div class="qr">${svg}</div>
  <p class="how">Сканирай, избери маса, поръчай.</p>
  <p class="how-en">Scan, pick your table, order.</p>
  <div class="table">
    <span class="label">Маса №<br><span class="label-en">Table</span></span>
    ${n ? `<span class="no">${esc(n)}</span>` : `<span class="blank"></span>`}
  </div>
  <p class="url">rayagarden.bg/menu</p>
</section>`;

const html = `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Inter:wght@400;500&display=block" rel="stylesheet">
<style>
  @page { size: 105mm 148mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Inter, Arial, sans-serif; color: ${INK}; }
  .card { width: 105mm; height: 148mm; padding: 9mm 10mm 7mm; display: flex; flex-direction: column;
          align-items: center; text-align: center; background: #fff; }
  .card + .card { break-before: page; }
  .logo { width: 17mm; height: 17mm; filter: brightness(0); opacity: .85; }
  .brand { font-size: 6.5pt; letter-spacing: .32em; text-transform: uppercase; margin-top: 2.2mm; color: ${GOLD}; }
  h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 500; font-size: 21pt; line-height: 1; margin-top: 3mm; }
  .en { font-size: 7.5pt; letter-spacing: .08em; color: #6b645c; margin-top: 1.2mm; }
  .qr { width: 60mm; height: 60mm; margin-top: 4mm; padding: 1.2mm; border: .35mm solid ${GOLD}; border-radius: 2mm; }
  .qr svg { width: 100%; height: 100%; display: block; }
  .how { font-family: "Cormorant Garamond", Georgia, serif; font-style: italic; font-size: 14pt; margin-top: 4mm; }
  .how-en { font-size: 7.5pt; color: #6b645c; margin-top: .8mm; }
  .table { display: flex; align-items: flex-end; gap: 3mm; margin-top: auto; }
  .label { font-size: 8pt; font-weight: 500; text-align: right; line-height: 1.25; }
  .label-en { font-weight: 400; color: #6b645c; }
  .no { font-size: 26pt; font-weight: 500; font-variant-numeric: tabular-nums; min-width: 14mm; text-align: left; }
  .blank { width: 20mm; height: 11mm; border-bottom: .35mm solid ${INK}; }
  .url { font-size: 6.5pt; letter-spacing: .06em; color: #6b645c; margin-top: 2.5mm; }
</style></head>
<body>${(tables ? Array.from({ length: tables }, (_, i) => card(i + 1)) : [card(0)]).join("")}</body></html>`;

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 }).catch(() => {
    console.warn("Could not load the web fonts — printing with fallback fonts.");
  });
  await page.evaluate(() => document.fonts.ready);
  const name = tables ? `table-cards-a6-1-${tables}.pdf` : "table-card-a6.pdf";
  await page.pdf({ path: path.join(OUT, name), width: "105mm", height: "148mm", printBackground: true });
  console.log(`${OUT}/raya-menu-qr.svg\n${OUT}/raya-menu-qr.png\n${OUT}/${name}  → ${URL}`);
} finally {
  await browser.close();
}
