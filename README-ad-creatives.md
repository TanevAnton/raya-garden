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

## 08A and 08B exist twice, and both copies stay

```
08A-RAYA-steak-closeup.jpeg    1536x1024
08A-RAYA-steak-closeup.jpg     1024x1024   (1:1)
08B-RAYA-steak-and-wine.jpeg   1022x1536
08B-RAYA-steak-and-wine.jpg    1022x1277   (~4:5)
```

The `.jpg` pair is not a duplicate of the `.jpeg` pair and not a renamed
copy of it — they are different crops of the same two shots, cut to the
aspect ratios Meta requires for those placements. Re-cropping either one
breaks it.

**The extension is load-bearing.** Meta's uploader rejects `.jpeg` on the
path the `.jpg` files are used for, so neither spelling may be "normalised"
to the other, and neither pair may be deleted as redundant. `.htaccess`
declares `AddType image/jpeg .jpeg .jpg`, so both answer `image/jpeg`.

## 11 is a conversion, not an original

```
11-RAYA-corporate-team-dinner.png   1254x1254   md5 91e5bef580de0d9a8cf6643e06187ddc
```

Unlike 01–10, this file never arrived as the approved original. The only
copy was a chat attachment, which the chat delivered as a lossy WebP
(1254x1254, sRGB ICC profile). The PNG was made by decoding that WebP once
and writing the pixels into a PNG — no resize, no colour change, profile
kept, verified pixel-identical to the decoded WebP. So it adds no loss of
its own, but it carries whatever the chat's WebP compression already did,
and its md5 will not match the original artwork.

**When the original PNG is available, replace this file with it** (send it
in a ZIP, which is what keeps the bytes intact) and update the md5 above.

## Missing files answer 404

`.htaccess` stops every `/ad-creatives/` request before the SPA fallback. A
file that exists is served as itself; one that does not is a plain 404.
Before that rule, a missing creative answered `200 text/html` — the app's
own index.html — which looks alive to a status check and is useless to
Meta.

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
