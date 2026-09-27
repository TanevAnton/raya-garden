#!/usr/bin/env node
// Put the staff password for rayagarden.bg/admin on the server.
//
// The password itself never leaves GitHub: it is the repository secret
// QR_ADMIN_PASSWORD, and all the server gets is its bcrypt hash, in
// raya-qr-config.php one folder ABOVE the web root (where the API looks for
// it — see public/api/qr/_lib/core.php). Outside the web root, so it can
// never be downloaded, and outside what scripts/deploy-ftp.mjs mirrors, so a
// deploy can never delete it.
//
// Run by .github/workflows/deploy.yml after the site is live, only when the
// secret is set. It downloads the current file first and leaves it alone if
// the password still matches: re-hashing on every deploy would give a new
// hash each time, and a new hash signs every staff device out (the sign-in
// cookie is tied to it). So staff stay signed in across deploys, and
// changing the secret + running the deploy is how the password changes.
//
// Any other settings already in the file are kept; only the
// 'admin_password_hash' line is replaced.
//
// Hashing and checking use PHP's own password_hash()/password_verify() —
// the functions the server uses — so `php` must be on the PATH (it is on
// GitHub's Ubuntu runners).
//
//   node scripts/qr-admin-password.mjs            upload (FTP_* + QR_ADMIN_PASSWORD)
//   node scripts/qr-admin-password.mjs --print    print the file instead, for a
//                                                 manual upload (asks for the password)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";

const NAME = "raya-qr-config.php";
const TEMP = `.up.${NAME}`;
const MIN_LENGTH = 8;
const HASH_LINE = /('admin_password_hash'\s*=>\s*)'([^'\\]*)'/;

function die(msg) {
  console.error(`\n${msg}`);
  process.exit(1);
}

/** Run a line of PHP with the password in the environment, not the command line. */
function php(code, password, hash = "") {
  try {
    return execFileSync("php", ["-r", code], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, RAYA_PW: password, RAYA_HASH: hash },
      stdio: ["ignore", "pipe", "inherit"],
    });
  } catch (e) {
    die(e.code === "ENOENT" ? "php is not installed — it is needed to hash the password the way the server checks it." : `php failed: ${e.message}`);
  }
}
const hashOf = (pw) => php("echo password_hash(getenv('RAYA_PW'), PASSWORD_DEFAULT);", pw).trim();
const matches = (pw, hash) => php("echo password_verify(getenv('RAYA_PW'), getenv('RAYA_HASH')) ? 'yes' : 'no';", pw, hash).trim() === "yes";

/** The config file with this hash: the existing one with its hash line swapped, or a new one. */
function configWith(hash, existing) {
  if (existing && HASH_LINE.test(existing)) return existing.replace(HASH_LINE, (_, head) => `${head}'${hash}'`);
  return `<?php
// RAYA Garden QR ordering — settings kept outside the web root.
//
// admin_password_hash is the staff password for rayagarden.bg/admin, as a
// bcrypt hash. The deploy writes it from the GitHub secret QR_ADMIN_PASSWORD
// (scripts/qr-admin-password.mjs): to change the password, change the secret
// and run the deploy again. Changing it signs every staff device out.
return [
    'admin_password_hash' => '${hash}',
];
`;
}

function check(password) {
  if (!password) die("QR_ADMIN_PASSWORD is empty.");
  if (password.length < MIN_LENGTH) die(`The staff password must be at least ${MIN_LENGTH} characters.`);
}

// ── --print: for a manual upload ─────────────────────────────────────
if (process.argv.includes("--print")) {
  let password = process.env.QR_ADMIN_PASSWORD;
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    password = await rl.question("Staff password for /admin: ");
    rl.close();
  }
  check(password);
  process.stdout.write(configWith(hashOf(password)));
  console.error(`\nSave the text above as ${NAME} in the folder that holds the site's folder (one level above the web root).`);
  process.exit(0);
}

// ── upload ───────────────────────────────────────────────────────────
const { FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, QR_ADMIN_PASSWORD } = process.env;
if (!FTP_SERVER || !FTP_USERNAME || !FTP_PASSWORD) die("FTP_SERVER, FTP_USERNAME and FTP_PASSWORD are required");
check(QR_ADMIN_PASSWORD);

// The web root is FTP_DIR; the file goes in the folder that holds it.
const DIR = (process.env.FTP_DIR || "rayagarden.bg/").replace(/\/+$/, "");
const above = path.posix.dirname(DIR);
const remote = (name) => (above === "." ? name : `${above}/${name}`);
if (!/^[A-Za-z0-9._\/-]*$/.test(DIR)) die(`FTP_DIR "${DIR}" has characters this script will not quote.`);

const SETTINGS = [
  "set ftp:ssl-force true",
  "set ftp:ssl-protect-data true",
  "set ssl:verify-certificate no", // SuperHosting's self-signed cert — see deploy-ftp.mjs
  "set net:timeout 40",
  "set net:max-retries 6",
  "set net:reconnect-interval-base 5",
  "set xfer:use-temp-file no",
].join("; ");

const work = mkdtempSync(path.join(tmpdir(), "qr-config-"));
function lftp(commands) {
  const file = path.join(work, "cmds.lftp");
  writeFileSync(file, commands.join("\n") + "\n");
  try {
    return execFileSync(
      "lftp",
      ["-c", `${SETTINGS}; ${process.env.LFTP_EXTRA || ""}; open -u "${FTP_USERNAME}","${FTP_PASSWORD}" "${FTP_SERVER}"; source "${file}"`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    return null;
  }
}
const finish = (code, msg) => {
  rmSync(work, { recursive: true, force: true });
  (code ? console.error : console.log)(msg);
  process.exit(code);
};

const current = lftp([`cat "${remote(NAME)}"`]);
if (current == null && lftp([`cls -1 "${above}"`]) == null) finish(1, "Could not reach the server over FTP. The site is deployed; the staff password is not updated.");
const currentHash = current?.match(HASH_LINE)?.[2];
if (currentHash && matches(QR_ADMIN_PASSWORD, currentHash)) {
  finish(0, `${NAME}: the staff password is already in place — unchanged, nobody signed out.`);
}
console.log(current == null ? `${NAME}: not on the server yet — writing it.` : `${NAME}: the password differs — replacing the hash (staff devices will need to sign in again).`);

const local = path.join(work, NAME);
writeFileSync(local, configWith(hashOf(QR_ADMIN_PASSWORD), current));
// Upload beside it and rename over it: the old file stays whole until the
// new one is complete.
lftp([`put "${local}" -o "${remote(TEMP)}" && mv "${remote(TEMP)}" "${remote(NAME)}"`]);

const written = lftp([`cat "${remote(NAME)}"`]);
const writtenHash = written?.match(HASH_LINE)?.[2];
if (!writtenHash || !matches(QR_ADMIN_PASSWORD, writtenHash)) {
  lftp([`rm -f "${remote(TEMP)}"`]);
  finish(1, `${NAME} could not be written or read back. The site is deployed; the staff password is not updated.`);
}
finish(0, `${NAME}: written and checked.`);
