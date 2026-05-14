export default function PageHero({ image, eyebrow, title, subtitle }) {
  return (
    <section
      className="relative h-[60vh] min-h-[420px] w-full overflow-hidden grain"
      aria-labelledby="page-hero-title"
    >
      <img
        src={image}
        alt=""
        fetchpriority="high"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover animate-slow-zoom"
      />
      <div className="absolute inset-0 gradient-overlay-dark" />
      <div className="absolute inset-0 gradient-overlay-vignette" />
      <div className="relative z-10 h-full flex flex-col justify-end max-w-7xl mx-auto px-6 lg:px-10 pb-16">
        <div className="animate-fade-up">
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
