import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Single photo → static <img>.
// Multiple → photo + prev/next arrows + dot indicators. Keyboard arrows
// scroll through too when the gallery has focus. Smooth easeOutQuart
// crossfade between slides matches the hero animation.
export default function MediaGallery({ images, alt }) {
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState({});
  const safeImages = images?.length ? images : [""];
  const count = safeImages.length;

  const go = (delta) => setIdx((c) => (c + delta + count) % count);

  // Keep the visible slide's "loaded" state in sync if the user comes
  // back to an image they've already seen (img.complete is true).
  const imgRef = useRef(null);
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded((m) => ({ ...m, [idx]: true }));
    }
  }, [idx]);

  if (count === 1) {
    return (
      <img
        ref={imgRef}
        src={safeImages[0]}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded((m) => ({ ...m, 0: true }))}
        style={{
          transitionProperty: "opacity, transform",
          transitionDuration: "900ms",
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className={`w-full h-full object-cover img-luxury group-hover:scale-105 ${
          loaded[0] ? "opacity-100" : "opacity-0"
        }`}
      />
    );
  }

  return (
    <div
      className="w-full h-full relative"
      role="region"
      aria-roledescription="carousel"
      aria-label={`${alt} — gallery`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }}
    >
      {safeImages.map((src, i) => (
        <img
          key={i}
          ref={i === idx ? imgRef : null}
          src={src}
          alt={`${alt} — ${i + 1}/${count}`}
          loading={i === 0 ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded((m) => ({ ...m, [i]: true }))}
          style={{
            transitionProperty: "opacity",
            transitionDuration: "900ms",
            transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className={`absolute inset-0 w-full h-full object-cover img-luxury ${
            i === idx && loaded[i] ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous photo"
        className="absolute top-1/2 left-3 -translate-y-1/2 w-10 h-10 rounded-full bg-ink-950/60 border border-gold-300/40 text-gold-200 hover:bg-ink-950/85 hover:border-gold-300 transition-all flex items-center justify-center z-10"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next photo"
        className="absolute top-1/2 right-3 -translate-y-1/2 w-10 h-10 rounded-full bg-ink-950/60 border border-gold-300/40 text-gold-200 hover:bg-ink-950/85 hover:border-gold-300 transition-all flex items-center justify-center z-10"
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2 z-10">
        {safeImages.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setIdx(i)}
            aria-label={`Go to photo ${i + 1}`}
            className={`h-px transition-all duration-500 ${
              i === idx ? "w-10 bg-gold-300" : "w-5 bg-cream-100/40"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
