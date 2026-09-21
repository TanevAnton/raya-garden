# /ad-creatives/ — the approved Meta Ads images

Eleven final creatives, served straight from `public/ad-creatives/` at

```
https://rayagarden.bg/ad-creatives/<filename>
```

They are **assets for the ad platform, not part of the site**. Nothing links
to them, they are not in `sitemap.xml`, and they are not in Sanity. Meta
fetches each URL once when the ad is built; the URL has to stay stable and
keep answering 200 with a correct `Content-Type` for as long as the ads run.

## The bytes are not to be touched

These files are approved artwork. Re-encoding, resizing, cropping, stripping
metadata or running them through an optimiser changes what the ad shows, so
none of that may happen — including silently, as a build step.

Nothing currently does. `vite.config.js` loads `[react()]` and no image
plugin; `package.json` has no `sharp`, `imagemin`, `vite-imagetools` or
`squoosh`; Vite copies `public/` into `dist/` verbatim. **If an image
optimiser is ever added, exclude this directory from it.**

Checked after each build:

```bash
npm run build
diff <(cd public/ad-creatives && md5sum * | sort -k2) \
     <(cd dist/ad-creatives  && md5sum * | sort -k2) && echo "bytes unchanged"
```

## Why robots.txt and not noindex

`robots.txt` carries `Disallow: /ad-creatives/`, which keeps the directory
out of search results. There is deliberately **no `X-Robots-Tag: noindex`**
header: that header travels with the response, and an image-fetching crawler
that reads it can treat the URL as unusable. `robots.txt` is only consulted
by crawlers doing discovery, which is the behaviour wanted here.

## Why they cannot be served from anywhere else

`.htaccess` has to leave this path alone, and does:

- the canonical host is `rayagarden.bg` (non-www), so the URLs above are
  already canonical — no 301;
- the trailing-slash rule only rewrites URLs ending in `/`;
- every bot-snapshot rule is anchored to an explicit page whitelist
  (`^event/…`, `^(hotel|restaurant|…)$`, `^$`), so a crawler UA asking for
  an image is not handed an HTML snapshot;
- the SPA fallback is guarded by `!-f`, so a real file is served as itself.

The `mod_mime` block states `image/png` and `image/jpeg` explicitly rather
than inheriting them from the host's config, so the `Content-Type` cannot
change under us.
