#!/usr/bin/env node
/**
 * Post-build step: re-renders the brochure covers shown on /events from
 * page 1 of the PDFs currently uploaded in Studio, into dist/img/.
 *
 * Why: the cards on /events show a cover so guests see what they're
 * opening. The committed public/img/brochure-*.jpg are rendered from the
 * brochures as they are today; this step keeps them honest — swap a
 * brochure in Studio (Site settings → Wedding / Corporate brochure) and the
 * next deploy renders the new first page over the committed one, with no
 * code change and nothing to upload twice.
 *
 * Never blocks a deploy: any failure (Sanity unreachable, no pdftoppm on
 * the runner, a PDF that won't render) leaves the committed cover in place
 * and exits 0.
 *
 * Needs poppler-utils (pdftoppm) on the machine — CI installs it next to
 * lftp. Usage: node scripts/generate-pdf-covers.mjs  (after `vite build`,
 * from the repo root; CI wires it in via `npm run covers:pdf`)
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);

const SANITY_PROJECT_ID = process.env.VITE_SANITY_PROJECT_ID || "q2yxl7gs";
const SANITY_DATASET = process.env.VITE_SANITY_DATASET || "production";
const OUT_DIR = path.resolve("dist/img");

// Keep these in sync with BROCHURE_COVERS in src/pages/Events.jsx: `width`
// is the rendered pixel width (~2× its size on screen), `aspect` what the
// page reserves for the box. A brochure whose shape no longer matches its
// aspect still renders — the page contains it rather than cropping — but
// the mismatch is logged so the constant can be corrected.
const COVERS = [
  { key: "weddings", field: "weddingsBrochurePdf", width: 440, aspect: 210 / 297 },
  { key: "corporate", field: "corporateBrochurePdf", width: 640, aspect: 16 / 9 },
];

async function fetchBrochureUrls() {
  const query = `*[_type == "siteSettings"][0]{${COVERS.map(
    (c) => `"${c.key}": ${c.field}.asset->url`
  ).join(", ")}}`;
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v2021-10-21/data/query/${SANITY_DATASET}?query=${encodeURIComponent(
    query
  )}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity responded ${res.status}`);
  const { result } = await res.json();
  return result || {};
}

async function renderCover({ key, width, aspect }, pdfUrl, tmpDir) {
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`PDF fetch responded ${res.status}`);
  const pdfPath = path.join(tmpDir, `${key}.pdf`);
  await writeFile(pdfPath, Buffer.from(await res.arrayBuffer()));

  // -singlefile drops the page-number suffix, so the output lands exactly
  // on the filename the page asks for.
  const out = path.join(OUT_DIR, `brochure-${key}`);
  await run("pdftoppm", [
    "-jpeg",
    "-jpegopt", "quality=82",
    "-f", "1", "-l", "1",
    "-singlefile",
    "-scale-to-x", String(width),
    "-scale-to-y", "-1",
    pdfPath,
    out,
  ]);

  // Page shape check: the page reserves a fixed box per cover, so a
  // brochure that changed orientation should be flagged rather than
  // silently letterboxed.
  const { stdout } = await run("pdfinfo", ["-f", "1", "-l", "1", pdfPath]);
  const page = stdout.match(/Page\s+1 size:\s+([\d.]+) x ([\d.]+)/) ||
    stdout.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  if (page) {
    const actual = Number(page[1]) / Number(page[2]);
    if (Math.abs(actual - aspect) / aspect > 0.02) {
      console.log(
        `[covers] ${key}: page is now ${actual.toFixed(2)}:1, page.jsx reserves ` +
          `${aspect.toFixed(2)}:1 — update BROCHURE_COVERS in src/pages/Events.jsx`
      );
    }
  }

  const { size } = await stat(`${out}.jpg`);
  return size;
}

async function main() {
  const tmpDir = path.join(os.tmpdir(), "raya-pdf-covers");
  try {
    await run("pdftoppm", ["-v"]);
  } catch {
    console.log("[covers] pdftoppm not installed — keeping committed covers");
    return;
  }

  let urls;
  try {
    urls = await fetchBrochureUrls();
  } catch (err) {
    console.log(`[covers] Sanity unreachable (${err.message}) — keeping committed covers`);
    return;
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(tmpDir, { recursive: true });
  for (const cover of COVERS) {
    const pdfUrl = urls[cover.key];
    if (!pdfUrl) {
      console.log(`[covers] no ${cover.key} brochure in Studio — keeping committed cover`);
      continue;
    }
    try {
      const size = await renderCover(cover, pdfUrl, tmpDir);
      console.log(`[covers] brochure-${cover.key}.jpg ← ${pdfUrl} (${Math.round(size / 1024)} kB)`);
    } catch (err) {
      console.log(`[covers] ${cover.key} failed (${err.message}) — keeping committed cover`);
    }
  }
  await rm(tmpDir, { recursive: true, force: true });
}

// Same contract as the prerender step: log, never fail the build.
main().catch((err) => {
  console.log(`[covers] skipped: ${err.message}`);
});
