#!/usr/bin/env node
/**
 * Serves dist/ the way SuperHosting's Apache serves it, so a Lighthouse run
 * measures the site rather than the test server.
 *
 * Matching production matters for exactly three things, all of which change
 * the numbers:
 *
 *   · gzip on the same types public/.htaccess lists in mod_deflate. Without
 *     it the JS bundle reports ~537 kB instead of ~162 kB and "total
 *     transfer size" is a fiction.
 *   · the same Cache-Control headers, since Lighthouse audits them.
 *   · the SPA fallback (real file → serve it, anything else → index.html),
 *     which is what makes /event/<slug> resolve at all.
 *
 * What it deliberately does NOT reproduce is the network between a phone in
 * Bulgaria and the host: no real RTT, no TLS handshake, no HTTP/2. That is
 * the point. Lighthouse applies its own simulated Slow 4G on top, so what
 * gets measured is the cost the page imposes on itself — the part a code
 * change can move. Third-party origins (Sanity, Google Fonts, Clock, Meta)
 * are still fetched for real over the runner's network, so their cost is
 * counted.
 *
 *   node scripts/serve-dist.mjs --port 5300 --root dist
 */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = Number(argOf("port", 5300));
const ROOT = path.resolve(argOf("root", "dist"));

// Same list as the AddType block in public/.htaccess, plus the types Vite
// emits. Anything unlisted is served as octet-stream rather than guessed.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".pdf": "application/pdf",
};

// mod_deflate's AddOutputFilterByType list.
const COMPRESS = new Set([
  "text/html; charset=utf-8",
  "text/css; charset=utf-8",
  "application/javascript; charset=utf-8",
  "application/json; charset=utf-8",
  "image/svg+xml",
  "text/plain; charset=utf-8",
  "application/xml; charset=utf-8",
]);

const IMMUTABLE = /\.(?:js|mjs|css|woff2?|png|jpe?g|svg|webp|avif)$/i;

function cacheControl(file) {
  const base = path.basename(file);
  if (base === "index.html") return "no-cache, must-revalidate";
  if (base === "robots.txt") return "no-cache, must-revalidate, max-age=0";
  if (IMMUTABLE.test(file)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

async function resolveFile(urlPath) {
  // Strip the query — ?lang=bg is the app's business, not the file system's.
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  // Refuse to escape the root. A traversal here would only hurt the runner,
  // but a static server that serves /etc/passwd is never worth shipping.
  const candidate = path.resolve(ROOT, `.${clean}`);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + path.sep)) return null;

  try {
    const s = await stat(candidate);
    if (s.isFile()) return candidate;
    if (s.isDirectory()) {
      const index = path.join(candidate, "index.html");
      if ((await stat(index)).isFile()) return index;
    }
  } catch {
    /* fall through to the SPA fallback */
  }
  return null;
}

const server = createServer(async (req, res) => {
  const file =
    (await resolveFile(req.url || "/")) ?? path.join(ROOT, "index.html");

  let type;
  try {
    type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    const info = await stat(file);
    const headers = {
      "Content-Type": type,
      "Cache-Control": cacheControl(file),
      "Last-Modified": info.mtime.toUTCString(),
    };

    const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (wantsGzip && COMPRESS.has(type)) {
      const body = gzipSync(await readFile(file));
      res.writeHead(200, {
        ...headers,
        "Content-Encoding": "gzip",
        "Content-Length": body.length,
        Vary: "Accept-Encoding",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }

    res.writeHead(200, { ...headers, "Content-Length": info.size });
    if (req.method === "HEAD") return res.end();
    createReadStream(file).pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`serve-dist: ${err.message}`);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`serve-dist: ${ROOT} on http://127.0.0.1:${PORT}`);
});
