#!/usr/bin/env node
// The QR system's code manifest: the version and a SHA-256 of every file
// under api/qr, written to api/qr/_manifest.json after the build. The server
// checks the files against it (public/api/qr/_lib/integrity.php): a file
// changed, missing or added outside a deploy shows on the staff screen and
// in the operations log (Наредба Н-18, Annex 29 т. 4).
//
//   node scripts/qr-manifest.mjs [dir]    default dir: dist/api/qr
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "dist/api/qr");
const files = {};
const walk = (rel) => {
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) walk(r);
    else if (r !== "_manifest.json") files[r] = createHash("sha256").update(readFileSync(path.join(dir, r))).digest("hex");
  }
};
walk("");
const version = readFileSync(path.join(dir, "_lib/core.php"), "utf8").match(/const QR_VERSION = '([^']+)'/)?.[1] || "";
let commit = process.env.GITHUB_SHA || "";
if (!commit) {
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    /* not a git checkout */
  }
}
writeFileSync(path.join(dir, "_manifest.json"), JSON.stringify({ version, commit: commit.slice(0, 12), builtAt: new Date().toISOString(), files }, null, 1));
console.log(`api/qr manifest: version ${version}, ${Object.keys(files).length} files`);
