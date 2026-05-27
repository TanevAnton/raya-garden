import { useEffect, useRef, useState } from "react";

export default function PageHero({
  image,
  eyebrow,
  title,
  subtitle,
  ready = true,
}) {
  // Fade the photo in once the browser has actually finished decoding it,
  // not the moment the `src` is set. Avoids the brief "snap" when an
  // already-loaded image appears, and the half-loaded flicker when a
  // fresh one streams in.
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    setLoaded(false);
    if (!image) return;
    const el = imgRef.current;
    // Image might already be cached & complete by the time React runs
    // this effect — in that case onLoad won't fire, so check `complete`.
    if (el?.complete && el.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [image]);

  return (
    <section
      className="relative h-[60vh] min-h-[420px] w-full overflow-hidden grain bg-ink-950"
      aria-labelledby="page-hero-title"
    >
      {image && (
        <img
          ref={imgRef}
          src={image}
          alt=""
          fetchpriority="high"
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover animate-slow-zoom transition-opacity duration-[900ms] ease-out ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {/* Smooth top-to-bottom darken — no flat plateau, the alpha steps
          roughly follow an ease-in curve so the transition reads as a
          gentle wash rather than a visible band. Bottom still ends at
          0.85 for text legibility against busy photos. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(10,9,8,0) 0%, rgba(10,9,8,0.05) 25%, rgba(10,9,8,0.18) 50%, rgba(10,9,8,0.45) 75%, rgba(10,9,8,0.72) 90%, rgba(10,9,8,0.85) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(10,9,8,0) 40%, rgba(10,9,8,0.12) 70%, rgba(10,9,8,0.35) 100%)",
        }}
      />
      <div className="relative z-10 h-full flex flex-col justify-end max-w-7xl mx-auto px-6 lg:px-10 pb-16">
        <div
          className={`animate-fade-up transition-opacity duration-700 ease-out ${
            ready ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-px bg-gold-300" />
            <span className="text-xs tracking-[0.4em] uppercase text-gold-200/90">
              {eyebrow}
            </span>
          </div>
          <h1
            id="page-hero-title"
            className="font-display text-5xl sm:text-6xl lg:text-7xl xl:text-8xl leading-[0.95] text-cream-50 text-shadow-lg text-balance max-w-3xl"
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-base lg:text-lg text-cream-100/85 max-w-2xl leading-relaxed mt-6 text-shadow-lg">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
