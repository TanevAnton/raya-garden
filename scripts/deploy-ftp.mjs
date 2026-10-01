#!/usr/bin/env node
// Upload dist/ to SuperHosting over FTPS so that visitors never see a
// half-deployed site. Run by .github/workflows/deploy.yml.
//
// Why the order matters. index.html names the build's JS and CSS by hash,
// and the moment a new index.html is live every visitor asks for the new
// files. A single `mirror` uploaded top-level files first, so index.html went
// up minutes before assets/: during deploy #80 and #81 the page asked for
// chunks that were not on the server yet, Apache's SPA fallback answered with
// index.html, and /events stayed blank for 4½ and 6 minutes.
//
// Why no file is ever deleted before its replacement is up. `mirror` replaced
// a changed file by removing it and then uploading the new one, and it
// re-sent every image on every deploy (the build gives every file a new
// mtime). Each image was missing for a second or two per deploy — and the
// images are served `immutable` for a year, so a visitor who caught one half
// written kept the broken copy. Now a file is uploaded under a temporary name
// next to the old one and renamed over it: the old file is whole until the
// instant it is replaced, and nothing is re-sent that has not changed.
//
// Four steps, each only if the one before succeeded:
//
//   1. assets/     New chunks go up next to the old ones; nothing is deleted,
//                  so the live (old) index.html keeps working. Names are
//                  content hashes, so a chunk already there at the right size
//                  is not re-sent.
//   2. the rest    Images, api/, .htaccess, sitemap.xml, the bot snapshots —
//                  everything except assets/ and index.html. A file is sent
//                  only if it is missing, the wrong size, or its SHA-256
//                  differs from the one recorded when it was last uploaded
//                  (.deploy-manifest.json). Before anything is sent, the
//                  files about to change are struck from that record, so a
//                  run that dies halfway leaves them "unknown" and the next
//                  run sends them again. Then the whole server is listed and
//                  every file of the build — chunks included — checked at the
//                  right size, with no temporary upload left behind (a rename
//                  that failed), before anything points at it.
//   3. index.html  Last, the same way: temporary name, renamed over the old
//                  one — the switch to the new build is a single rename.
//   4. clean up    Only now, with the new build live: delete chunks that
//                  belong to neither this build nor the previous one (the
//                  previous build's stay one more deploy for tabs opened
//                  before it), then files that are no longer in the build,
//                  then directories left empty.
//
// Never touched: api/error_log (PHP writes it when a request fatals; it is
// the only record of what went wrong) and .git* files — as with the old
// mirror.
//
// FTPS: SuperHosting's Pure-FTPd uses a self-signed cert (CN
// cloud.theadmin.net), so strict verification fails — lftp keeps the
// transfer encrypted but skips cert verification. Serial, with generous
// retries: parallel transfers had a data channel die mid-file.
//
// File by file, resuming: whatever a step could not get up whole is sent
// again one file at a time, each picked up where it stopped (put -c), round
// after round while anything still grows (sendResuming) — so a connection
// cut part-way through every upload still gets each file up in pieces. If a
// round moves nothing, the server is refusing rather than dropping: the
// deploy stops and prints the server's own answer for one of the files
// (serverSays) — "Quota exceeded", "Disk full", a dropped connection — never
// what was sent. Deploys #91–#93 (01.10.2026) left files on the server with
// their names but not their contents; this is the way through, or the reason. One lftp
// session per step: `set cmd:fail-exit` hangs lftp 4.9 after a failed
// command, so instead of trusting exit codes every step is checked against a
// fresh listing of the server.
//
// Watchdog: every lftp session runs under one (scripts/lib/lftp.mjs): lftp
// is stopped a few seconds after its last command has run, and at a time
// limit in any case. Deploy #95's lftp finished its work, then never exited.
//
// LFTP_EXTRA is appended to the settings — for testing against a local plain
// FTP server; empty in CI.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FTPS, allow, bytesOf, lftpSessions } from "./lib/lftp.mjs";

const { FTP_SERVER, FTP_USERNAME, FTP_PASSWORD } = process.env;
const SRC = process.env.SRC || "dist";
const DIR = (process.env.FTP_DIR || "rayagarden.bg/").replace(/\/+$/, "");
const CHUNK_LIST = "assets/.deployed"; // this build's chunk names, for the next deploy
const MANIFEST = ".deploy-manifest.json"; // SHA-256 and size of every step-2 file
const TEMP = ".up."; // prefix of a file still being uploaded
// This run's own temporary names: ".up.<run>.<name>". A half-sent temporary
// file found later can then only be this run's, so it is safe to resume onto;
// an earlier run's leftovers are cleaned up in step 4 like any stray file.
const RUN = `${process.env.GITHUB_RUN_ID || Date.now().toString(36)}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
const tempOf = (p) => {
  const d = path.posix.dirname(p);
  return `${d === "." ? "" : `${d}/`}${TEMP}${RUN}.${path.posix.basename(p)}`;
};

const SETTINGS = [
  ...FTPS, // TLS 1.2, cert not verified — scripts/lib/lftp.mjs says why
  "set net:timeout 40",
  "set net:max-retries 6",
  "set net:reconnect-interval-base 5",
  "set net:persist-retries 3",
  "set xfer:use-temp-file no", // temp names are done explicitly below
].join("; ");

const work = mkdtempSync(path.join(tmpdir(), "deploy-"));
const log = (s) => console.log(s);
function die(msg) {
  console.error(`\n${msg}`);
  rmSync(work, { recursive: true, force: true });
  process.exit(1);
}
if (!FTP_SERVER || !FTP_USERNAME || !FTP_PASSWORD) die("FTP_SERVER, FTP_USERNAME and FTP_PASSWORD are required");
// Every session runs under a watchdog (scripts/lib/lftp.mjs): lftpRun gives
// what echo printed and whether the last command succeeded, lftp only the
// latter, lftpRead a command's output (a listing, a remote file) or null.
const { run: lftpRun, ok: lftp, read: lftpRead } = lftpSessions({
  server: FTP_SERVER,
  user: FTP_USERNAME,
  password: FTP_PASSWORD,
  settings: SETTINGS,
  work,
});

const remote = (p) => (DIR ? `${DIR}/${p}` : p);
const q = (s) => `"${s}"`;
// Every path that reaches an lftp command is one of these, so quoting is
// never a question. Checked for the build up front; a remote name outside it
// is reported and left alone.
const SAFE = /^[A-Za-z0-9._\/-]+$/;

/**
 * Every file and directory under DIR: Map path → size (files) or "dir".
 * `find -l` prints "<perms> [owner] <size> <date> [<time>] <path>", every
 * path starting with DIR/ and directories ending in a slash. The path is
 * found by that prefix rather than by column, and a file's size is the
 * number just before its date. Returns null if a file line does not parse —
 * a listing we cannot read is treated as knowing nothing.
 */
function listRemote() {
  const out = lftpRead(`find -l ${q(DIR || ".")}`);
  if (out == null) return null;
  const files = new Map();
  const base = DIR ? `${DIR}/` : "./";
  for (const line of out.split("\n").filter(Boolean)) {
    const at = line.indexOf(` ${base}`);
    if (at < 0) {
      console.error(`   unreadable listing line: ${line}`);
      return null;
    }
    const p = line.slice(at + 1 + base.length);
    if (p === "") continue; // DIR itself
    if (p.endsWith("/")) {
      files.set(p.slice(0, -1), "dir");
      continue;
    }
    const head = line.slice(0, at).trim().split(/\s+/);
    const date = head.findIndex((t) => /^\d{4}-\d{2}-\d{2}$/.test(t));
    if (date < 1 || !/^\d+$/.test(head[date - 1])) {
      console.error(`   unreadable listing line: ${line}`);
      return null;
    }
    files.set(p, Number(head[date - 1]));
  }
  return files;
}

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Every file under dir, as paths relative to it. */
function walk(dir, rel = "") {
  return readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    return e.isDirectory() ? walk(dir, p) : [p];
  });
}

const isProtected = (p) => {
  const name = p.split("/").pop();
  return name === "error_log" || name.startsWith(".git");
};

/**
 * Upload each path to a temporary name beside its target, then rename it
 * over the target. Returns false if lftp reported a failure on the last
 * file — meaningful for a single file; a batch is checked by listing.
 */
function uploadAtomically(paths, fromDir) {
  const dirs = [...new Set(paths.map((p) => path.posix.dirname(p)).filter((d) => d !== "."))].sort();
  const cmds = dirs.map((d) => `mkdir -p -f ${q(remote(d))}`);
  for (const p of paths) {
    // The rename only runs if the whole file went up, and "DONE" is only
    // printed after both: the one sure sign a file is in place (its size
    // alone is not — a changed file can be as long as the old one).
    cmds.push(`put ${q(path.join(fromDir, p))} -o ${q(remote(tempOf(p)))} && mv ${q(remote(tempOf(p)))} ${q(remote(p))} && echo ${q(`DONE ${p}`)}`);
  }
  const sent = lftpRun([...cmds, "echo END"], allow(bytesOf(paths.map((p) => path.join(fromDir, p))), paths.length)).out;
  const missed = paths.filter((p) => !doneIn(sent).has(p));
  if (!missed.length) return [];
  // Some did not make it: pick each up where it stopped, file by file.
  return sendResuming(missed.map((p) => ({ from: path.join(fromDir, p), to: p, via: tempOf(p) })));
}

const doneIn = (out) => new Set((out || "").split("\n").filter((l) => l.startsWith("DONE ")).map((l) => l.slice(5)));

/**
 * Send files that did not get up whole, each resumed from where it stopped
 * (put -c) rather than from the start, round after round — so a connection
 * that drops part-way through every upload still gets each file up, a piece
 * at a time. Each item goes to `via` (this run's temporary name) and is then
 * renamed to `to`, or straight to `to` when it has no `via` (assets/, whose
 * content-hash names make a shorter file of that name the start of this very
 * one). A round in which nothing grew ends it: the server is refusing, not
 * dropping, and resuming will not help. Returns the ones still not in place.
 */
function sendResuming(items) {
  let todo = items;
  const sizeOf = (it, listing) => Number(listing?.get(it.via || it.to)) || 0;
  for (let round = 1; round <= 20 && todo.length; round++) {
    log(`   ${todo.length} file(s) not whole yet — round ${round}, picking up where each stopped`);
    const before = listRemote();
    const done = new Set();
    // One short session per file: a connection that breaks mid-file costs
    // that file's turn, not everyone else's.
    for (const it of todo) {
      const send = `put -c ${q(it.from)} -o ${q(remote(it.via || it.to))}` + (it.via ? ` && mv ${q(remote(it.via))} ${q(remote(it.to))}` : "");
      for (const d of doneIn(lftpRun(["set net:max-retries 3", `${send} && echo ${q(`DONE ${it.to}`)}`, "echo END"], allow(bytesOf([it.from]))).out)) done.add(d);
    }
    const after = listRemote();
    const moved = todo.some((it) => done.has(it.to) || sizeOf(it, after) > sizeOf(it, before));
    todo = todo.filter((it) => !done.has(it.to));
    if (!moved) break; // nothing grew: the server refuses rather than drops
  }
  return todo;
}

/** Write a record to the server, atomically, or stop the deploy. */
function putJson(name, value, failure) {
  const dir = path.join(work, "json");
  rmSync(dir, { recursive: true, force: true });
  const file = path.join(dir, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 1) + "\n");
  if (uploadAtomically([name], dir).length) die(`Could not write ${name}. ${failure}`);
}

// ── the build ────────────────────────────────────────────────────────
if (!statSync(path.join(SRC, "index.html"), { throwIfNoEntry: false })?.size) die(`no ${SRC}/index.html`);
const all = walk(SRC).filter((p) => !isProtected(p));
const unsafe = all.filter((p) => !SAFE.test(p));
if (unsafe.length) die(`File names this script will not quote:\n${unsafe.join("\n")}`);
const chunks = all.filter((p) => p.startsWith("assets/"));
const rest = all.filter((p) => !p.startsWith("assets/") && p !== "index.html");
const local = new Map(all.map((p) => [p, statSync(path.join(SRC, p)).size]));
const hashes = new Map(rest.map((p) => [p, sha256(path.join(SRC, p))]));

// ── 1/4 assets/ ──────────────────────────────────────────────────────
log(`── 1/4 assets/ (${chunks.length} files), nothing deleted`);
const mirrored = lftp(
  [`mkdir -p -f ${q(remote("assets"))}`, `mirror -R --ignore-time ${q(`${SRC}/assets/`)} ${q(remote("assets/"))}`],
  allow(bytesOf(chunks.map((p) => path.join(SRC, p))), chunks.length)
);
if (!mirrored) {
  // The mirror gave up on some (lftp: "max-retries exceeded"). Finish them
  // file by file, each resumed from where it stopped.
  const seen = listRemote();
  const todo = seen ? chunks.filter((p) => seen.get(p) !== local.get(p)) : chunks;
  const left = sendResuming(todo.map((p) => ({ from: path.join(SRC, p), to: p })));
  if (left.length) {
    const now = listRemote();
    console.error(`\n${left.length} file(s) are still not whole on the server, e.g. ${left[0].to} (${now?.get(left[0].to) ?? "missing"} of ${local.get(left[0].to)} bytes).`);
    const why = serverSays(left[0].to);
    if (why.length) console.error(`What the server answers when it is sent again:\n${why.map((l) => `   ${l}`).join("\n")}`);
    console.error(
      "The server takes a file's name but not all of its contents. Usual causes: the FTP account's own quota is full " +
        "(SPanel → FTP accounts: raise it or set it to unlimited — separate from the disk), the disk is full, or the " +
        "connection is cut part-way. The server's answer above says which."
    );
    die("Uploading assets/ failed — index.html NOT switched.");
  }
}

/**
 * Send one of the files again (to `target`: its own name in assets/, a
 * temporary name anywhere else, so never over a live file), with lftp's
 * protocol log on, and return the server's replies and lftp's own notes about
 * the connection (timeouts, resets). Only those lines: never what was sent,
 * so never the password.
 */
function serverSays(file, target = file) {
  if (!file) return [];
  const debugLog = path.join(work, "debug.log");
  lftp([`debug -o ${q(debugLog)} 3`, "set net:max-retries 2", `put ${q(`${SRC}/${file}`)} -o ${q(remote(target))}`], allow(bytesOf([`${SRC}/${file}`])));
  let text = "";
  try {
    text = readFileSync(debugLog, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(<--- [1-5]\d\d|\*\*\*\* )/.test(l) && !/^<--- (1|2[23]0|33[01])/.test(l))
    .slice(-12);
}

// ── 2/4 everything except assets/ and index.html ─────────────────────
log(`── 2/4 everything except assets/ and index.html (${rest.length} files)`);
const before = listRemote();
if (!before) log("   could not read the server's listing — sending every file");
let record = {};
try {
  record = JSON.parse(lftpRead(`cat ${q(remote(MANIFEST))}`) || "{}").files || {};
} catch {
  record = {};
}
if (!Object.keys(record).length) log(`   no ${MANIFEST} from an earlier deploy — sending every file this time`);

const changed = rest.filter((p) => {
  if (!before || before.get(p) !== local.get(p)) return true; // missing, or the wrong size
  return record[p]?.sha256 !== hashes.get(p); // same size, different content — or never recorded
});
log(`   ${changed.length} changed, ${rest.length - changed.length} unchanged and not sent`);

if (changed.length) {
  // Strike them from the record first: if this run dies mid-way, the next
  // one will not trust whatever it finds under these names.
  const pending = { ...record };
  for (const p of changed) delete pending[p];
  putJson(MANIFEST, { files: pending }, "Nothing sent — index.html NOT switched.");
  for (const p of changed) log(`   → ${p}`);
  const missed = uploadAtomically(changed, SRC);
  if (missed.length) {
    const why = serverSays(missed[0].to, tempOf(missed[0].to)); // never over a live file
    if (why.length) console.error(`What the server answers when ${missed[0].to} is sent again:\n${why.map((l) => `   ${l}`).join("\n")}`);
  }
}

const after = listRemote();
if (!after) die("Could not list the server after uploading — index.html NOT switched.");
const wrong = [...chunks, ...rest].filter((p) => after.get(p) !== local.get(p));
const leftover = [...after.keys()].filter((p) => changed.some((c) => p === tempOf(c)));
if (wrong.length || leftover.length) {
  die(
    "On the server but wrong, or not there — index.html NOT switched:\n" +
      wrong.map((p) => `  ${p}: ${after.get(p) ?? "missing"}, expected ${local.get(p)} bytes`).join("\n") +
      (leftover.length ? `\nUploaded but not renamed into place:\n  ${leftover.join("\n  ")}` : "")
  );
}
putJson(
  MANIFEST,
  { files: Object.fromEntries(rest.map((p) => [p, { sha256: hashes.get(p), size: local.get(p) }])) },
  "The files are up and checked, but unrecorded — index.html NOT switched."
);
log(`   all ${chunks.length + rest.length} files present at the right size`);

// ── 3/4 index.html ───────────────────────────────────────────────────
log("── 3/4 index.html");
const switched = uploadAtomically(["index.html"], SRC).length === 0;
const live = listRemote();
if (!switched || !live || live.get("index.html") !== local.get("index.html") || live.has(tempOf("index.html"))) {
  die("index.html did not switch — the previous build is still live, whole.");
}

// ── 4/4 clean up ─────────────────────────────────────────────────────
log("── 4/4 clean up");
const current = chunks.map((p) => p.slice("assets/".length));
const previous = (lftpRead(`cat ${q(remote(CHUNK_LIST))}`) || "").split("\n").filter(Boolean);
const keep = new Set([...current, ...previous, path.posix.basename(CHUNK_LIST)]);
const inBuild = new Set(all);
const stale = [];
for (const [p, size] of live) {
  if (size === "dir" || isProtected(p) || p === MANIFEST || p === "index.html") continue;
  if (p.startsWith("assets/")) {
    const name = p.slice("assets/".length);
    if (!previous.length || name.includes("/") || keep.has(name)) continue; // no list yet: keep everything
    stale.push(p);
  } else if (!inBuild.has(p)) {
    stale.push(p);
  }
}
if (!previous.length) log(`   no ${CHUNK_LIST} from an earlier deploy — keeping every chunk this time`);
const deletable = stale.filter((p) => SAFE.test(p));
for (const p of stale.filter((p) => !SAFE.test(p))) log(`   left alone (name not safe to quote): ${p}`);
if (deletable.length) {
  for (const p of deletable) log(`   ✕ ${p}`);
  lftp([`rm -f ${deletable.map((p) => q(remote(p))).join(" ")}`], allow(0, deletable.length));
} else {
  log("   nothing stale");
}
// Directories no longer in the build, deepest first — except one still
// holding an error_log (or a .git* file), which stays with it.
const localDirs = new Set(all.flatMap((p) => p.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
const holdsProtected = (d) => [...live.keys()].some((p) => p.startsWith(`${d}/`) && isProtected(p));
const goneDirs = [...live]
  .filter(([p, t]) => t === "dir" && p !== "assets" && !p.startsWith("assets/") && !localDirs.has(p) && SAFE.test(p) && !holdsProtected(p))
  .map(([p]) => p)
  .sort((a, b) => b.split("/").length - a.split("/").length);
for (const d of goneDirs) log(`   ✕ ${d}/`);
if (goneDirs.length) lftp(goneDirs.map((d) => `rmdir ${q(remote(d))}`), allow(0, goneDirs.length));
putJson(CHUNK_LIST, current.join("\n") + "\n", "The new build is live; the next deploy will keep every chunk.");

rmSync(work, { recursive: true, force: true });
log("── done");
