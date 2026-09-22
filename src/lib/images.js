import { urlFor } from "./sanity.js";

// One place that decides what an <img> actually downloads.
//
// Before this, every page called urlFor(x).width(2000).quality(80).url() and
// shipped a single 2000px original-format file to a phone. Measured against
// the live CDN on a 412px-wide Android:
//
//   /restaurant hero   2000px JPEG          541 kB
//   /event/… hero      2000px PNG         5 198 kB   ← upscaled from 1535px
//   same, 1080px + auto=format             ~110 kB
//
// The event hero was the worst case and it is the page the New Year ads
// point at: asking a 1535px-wide PNG for width(2000) makes the CDN upscale
// it and hand back five megabytes of PNG. At 1.6 Mbps that is half a minute
// of staring at a dark box.
//
// Three things fix it, and all three have to be here rather than at each
// call site, because the call sites are where it went wrong:
//
//   · auto("format") — Sanity negotiates AVIF or WebP from the Accept
//     header. Never fm=avif: this project's CDN answers 400 to an explicit
//     avif request, and hard-coding a format would also send AVIF to a
//     browser that cannot read it.
//   · a srcSet capped at the source's real width, so the CDN is never asked
//     to upscale.
//   · intrinsic width/height parsed out of the asset ref, so the box is the
//     right shape before the bytes arrive.
//
// Crops are untouched: same source, same aspect, only the delivered pixel
// count and container format change.

/** Widths worth generating. A phone at 412 CSS px / DPR 2.6 wants ~1080. */
const WIDTHS = [480, 640, 828, 1080, 1280, 1600, 1920];

/**
 * Sanity encodes the asset's real dimensions in its _ref:
 *   image-<sha>-2000x1333-jpg
 * Reading them here avoids both an extra query and the upscale trap.
 */
export function assetDimensions(source) {
  const ref =
    source?.asset?._ref || source?._ref || source?.asset?._id || source?._id || "";
  const match = /-(\d+)x(\d+)-[a-z]+$/i.exec(ref);
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * A responsive descriptor for a Sanity image: `{src, srcSet, sizes, width,
 * height}`, or null when there is no image.
 *
 * `sizes` describes the box the image occupies, so the browser can choose a
 * candidate before layout — get it wrong and srcSet is worse than useless,
 * because the browser assumes 100vw and downloads the largest.
 *
 * `maxWidth` caps the ladder for images that are never full-bleed. It is a
 * ceiling, not a target: the asset's own width always wins, so a 1535px
 * source never generates a 1920px candidate.
 */
export function responsiveImage(source, options = {}) {
  if (!source) return null;
  const { sizes = "100vw", maxWidth = 1920, quality = 75 } = options;

  const dims = assetDimensions(source);
  const ceiling = Math.min(maxWidth, dims?.width ?? maxWidth);

  // Keep every ladder rung at or below the ceiling, and always include the
  // ceiling itself so a small source is still delivered at its native size.
  const widths = [...new Set([...WIDTHS.filter((w) => w < ceiling), ceiling])];

  const build = (w) => {
    const url = urlFor(source);
    if (!url) return "";
    return url.width(w).quality(quality).auto("format").url();
  };

  const srcSet = widths
    .map((w) => `${build(w)} ${w}w`)
    .filter((entry) => !entry.startsWith(" "))
    .join(", ");

  // The `src` fallback is a mid rung, not the largest: a browser that ignores
  // srcSet (or a crawler) should get something sane rather than the heaviest
  // file on the page.
  const fallbackWidth = widths.find((w) => w >= 1080) ?? widths[widths.length - 1];

  return {
    src: build(fallbackWidth),
    srcSet,
    sizes,
    width: dims?.width ?? null,
    height: dims?.height ?? null,
  };
}

/**
 * The page hero: full-bleed, so it occupies the whole viewport width, and it
 * is the LCP element on every landing page. Quality is a touch lower than the
 * galleries because it sits under a dark gradient wash where banding does not
 * show, and because this is the one image the visitor waits on.
 */
export function heroImage(source) {
  return responsiveImage(source, { sizes: "100vw", quality: 72 });
}

/**
 * Gallery and card images. They are never wider than the content column, so
 * the ladder stops well short of full-bleed and `sizes` says so.
 */
export function contentImage(source, sizes = "(min-width: 1024px) 50vw, 100vw") {
  return responsiveImage(source, { sizes, maxWidth: 1280, quality: 76 });
}
