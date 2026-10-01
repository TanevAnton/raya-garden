#!/usr/bin/env node
// Put the QR ordering system's server settings in place: the staff password
// for rayagarden.bg/admin and, for paying on the phone, the two Stripe keys.
//
// They come from repository secrets and go into raya-qr-config.php one
// folder ABOVE the web root (where the API looks — public/api/qr/_lib/
// core.php). Outside the web root, so it can never be downloaded, and
// outside what scripts/deploy-ftp.mjs mirrors, so a deploy never deletes it.
//
//   QR_ADMIN_PASSWORD           → 'admin_password_hash' (bcrypt; the password
//                                 itself never leaves GitHub)
//   QR_STRIPE_SECRET_KEY        → 'stripe_secret_key'   (a restricted key,
//                                 rk_test_… / rk_live_…)
//   QR_STRIPE_WEBHOOK_SECRET    → 'stripe_webhook_secret' (whsec_…)
//
// A secret that is not set leaves its line as it is. A Stripe secret set to
// "off" removes its line — the system then falls back to paying staff.
//
// Run by .github/workflows/deploy.yml after the site is live. It downloads
// the current file first and uploads only if something changed. The
// password is re-hashed only when it no longer matches: a new hash signs
// every staff device out (the sign-in cookie is tied to it), so staff stay
// signed in across deploys. Any other lines in the file are kept.
//
// Hashing and checking use PHP's own password_hash()/password_verify() —
// what the server uses — so `php` must be on the PATH (it is on GitHub's
// Ubuntu runners). Secret values are never printed.
//
//   node scripts/qr-server-config.mjs           upload (FTP_* + the secrets above)
//   node scripts/qr-server-config.mjs --print   print a file with the staff
//                                               password, for a manual upload

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { FTPS, lftpSessions } from "./lib/lftp.mjs";

const NAME = "raya-qr-config.php";
const TEMP = `.up.${NAME}`;
const MIN_LENGTH = 8;
const STRIPE = [
  // [secret, config key, allowed value]
  ["QR_STRIPE_SECRET_KEY", "stripe_secret_key", /^[rs]k_(test|live)_[A-Za-z0-9]{10,}$/],
  ["QR_STRIPE_WEBHOOK_SECRET", "stripe_webhook_secret", /^whsec_[A-Za-z0-9]{10,}$/],
];

const line = (key) => new RegExp(`^([ \\t]*'${key}'\\s*=>\\s*)'([^'\\\\]*)',?[ \\t]*\\n?`, "m");
const valueOf = (text, key) => text?.match(line(key))?.[2];

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

const TEMPLATE = `<?php
// RAYA Garden QR ordering — server settings, kept outside the web root.
//
// Written by the deploy from GitHub secrets (scripts/qr-server-config.mjs):
//   admin_password_hash    the staff password for rayagarden.bg/admin, as a
//                          bcrypt hash (secret QR_ADMIN_PASSWORD). Changing
//                          it signs every staff device out.
//   stripe_secret_key      paying on the phone: a restricted Stripe key
//                          (secret QR_STRIPE_SECRET_KEY)
//   stripe_webhook_secret  its webhook's signing secret
//                          (secret QR_STRIPE_WEBHOOK_SECRET)
// To change one, change the secret and run the deploy again.
return [
];
`;

/** The file with key set to value (value null: the line removed). Values are checked to need no escaping. */
function withValue(text, key, value) {
  const base = text && /return\s*\[/.test(text) ? text : TEMPLATE;
  if (value === null) return base.replace(line(key), "");
  if (line(key).test(base)) return base.replace(line(key), (_, head) => `${head}'${value}',\n`);
  const end = base.lastIndexOf("];");
  return `${base.slice(0, end)}    '${key}' => '${value}',\n${base.slice(end)}`;
}

function checkPassword(password) {
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
  checkPassword(password);
  process.stdout.write(withValue(null, "admin_password_hash", hashOf(password)));
  console.error(`\nSave the text above as ${NAME} in the folder that holds the site's folder (one level above the web root).`);
  process.exit(0);
}

// ── what the secrets ask for ─────────────────────────────────────────
const { FTP_SERVER, FTP_USERNAME, FTP_PASSWORD, QR_ADMIN_PASSWORD } = process.env;
if (!FTP_SERVER || !FTP_USERNAME || !FTP_PASSWORD) die("FTP_SERVER, FTP_USERNAME and FTP_PASSWORD are required");
if (QR_ADMIN_PASSWORD) checkPassword(QR_ADMIN_PASSWORD);
const stripe = [];
for (const [secret, key, allowed] of STRIPE) {
  const value = (process.env[secret] || "").trim();
  if (!value) continue;
  if (value === "off") {
    stripe.push([secret, key, null]);
    continue;
  }
  if (!allowed.test(value)) die(`${secret} does not look like a Stripe ${key === "stripe_secret_key" ? "API key (rk_… or sk_…)" : "webhook signing secret (whsec_…)"}. Nothing was changed.`);
  if (key === "stripe_secret_key" && value.startsWith("sk_")) {
    console.log(`::warning::${secret} is a full secret key (sk_…). Stripe recommends a restricted key (rk_…) with only Checkout Sessions and Refunds — see docs/qr-ordering/SETUP.md.`);
  }
  stripe.push([secret, key, value]);
}
const testKey = stripe.find(([, key, v]) => key === "stripe_secret_key" && v)?.[2];
const webhookSet = stripe.some(([, key, v]) => key === "stripe_webhook_secret" && v);
if (!QR_ADMIN_PASSWORD && !stripe.length) {
  console.log("No QR ordering secrets are set — nothing to do.");
  process.exit(0);
}

// The web root is FTP_DIR; the file goes in the folder that holds it.
const DIR = (process.env.FTP_DIR || "rayagarden.bg/").replace(/\/+$/, "");
const above = path.posix.dirname(DIR);
const remote = (name) => (above === "." ? name : `${above}/${name}`);
if (!/^[A-Za-z0-9._\/-]*$/.test(DIR)) die(`FTP_DIR "${DIR}" has characters this script will not quote.`);

const SETTINGS = [
  ...FTPS, // TLS 1.2, cert not verified — scripts/lib/lftp.mjs says why
  "set net:timeout 40",
  "set net:max-retries 6",
  "set net:reconnect-interval-base 5",
  "set xfer:use-temp-file no",
].join("; ");

const work = mkdtempSync(path.join(tmpdir(), "qr-config-"));
// Each session under a watchdog (scripts/lib/lftp.mjs): ok() says whether the
// last command succeeded, read() gives a command's output or null.
const lftp = lftpSessions({ server: FTP_SERVER, user: FTP_USERNAME, password: FTP_PASSWORD, settings: SETTINGS, work, quiet: true });
const finish = (code, msg) => {
  rmSync(work, { recursive: true, force: true });
  (code ? console.error : console.log)(msg);
  process.exit(code);
};

// ── compare with the server's copy ───────────────────────────────────
const current = lftp.read(`cat "${remote(NAME)}"`);
if (current == null && !lftp.ok([`cls -1 "${above}"`])) finish(1, "Could not reach the server over FTP. The site is deployed; its QR settings are not updated.");
let next = current;
const changes = [];
if (QR_ADMIN_PASSWORD) {
  const hash = valueOf(current, "admin_password_hash");
  if (!hash || !matches(QR_ADMIN_PASSWORD, hash)) {
    next = withValue(next, "admin_password_hash", hashOf(QR_ADMIN_PASSWORD));
    changes.push(hash ? "staff password changed (staff devices will need to sign in again)" : "staff password set");
  }
}
for (const [secret, key, value] of stripe) {
  if (valueOf(next, key) === (value ?? undefined)) continue;
  next = withValue(next, key, value);
  changes.push(value === null ? `${key} removed (${secret}=off)` : `${key} ${valueOf(current, key) ? "replaced" : "set"}`);
}
if (!changes.length) finish(0, `${NAME}: already up to date — unchanged, nobody signed out.`);
for (const c of changes) console.log(`${NAME}: ${c}`);
if (testKey?.includes("_test_")) console.log(`${NAME}: the Stripe key is a TEST key — payments on the phone will not be real.`);
if (testKey && !webhookSet && !valueOf(next, "stripe_webhook_secret")) console.log(`::warning::QR_STRIPE_WEBHOOK_SECRET is not set: payments on the phone stay off until it is.`);

// ── upload, then read back ───────────────────────────────────────────
const local = path.join(work, NAME);
writeFileSync(local, next);
// Uploaded beside it and renamed over it: the old file stays whole until the
// new one is complete.
lftp.ok([`put "${local}" -o "${remote(TEMP)}" && mv "${remote(TEMP)}" "${remote(NAME)}"`]);
const written = lftp.read(`cat "${remote(NAME)}"`);
const ok =
  written != null &&
  (!QR_ADMIN_PASSWORD || matches(QR_ADMIN_PASSWORD, valueOf(written, "admin_password_hash") || "")) &&
  stripe.every(([, key, value]) => valueOf(written, key) === (value ?? undefined));
if (!ok) {
  lftp.ok([`rm -f "${remote(TEMP)}"`]);
  finish(1, `${NAME} could not be written or read back. The site is deployed; its QR settings are not updated.`);
}
finish(0, `${NAME}: written and checked.`);
