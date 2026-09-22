import { Link } from "react-router-dom";

// Shared frame and typography for the privacy policy and the cookies page.
//
// No photo hero: these are pages people read, and the one that matters most
// is opened straight from a Meta lead form on a phone. The Nav is fixed, so
// the content starts below it (pt-32) the same way NotFound does.

export default function LegalPage({ eyebrow, title, updatedLabel, updated, children }) {
  return (
    <section className="bg-ink-950 px-6 pt-32 pb-24 lg:pt-40">
      <article className="max-w-3xl mx-auto">
        <div className="text-xs tracking-[0.4em] uppercase text-gold-300/80 mb-5">
          {eyebrow}
        </div>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl leading-[1.05] text-cream-50 text-balance">
          {title}
        </h1>
        <p className="text-sm text-cream-100/50 mt-5">
          {updatedLabel}: {updated}
        </p>
        <div className="divider-gold mt-10 mb-4" />
        {children}
      </article>
    </section>
  );
}

export function H2({ children }) {
  return (
    <h2 className="font-display text-2xl sm:text-3xl text-cream-50 mt-12 mb-4 text-balance">
      {children}
    </h2>
  );
}

export function H3({ children }) {
  return (
    <h3 className="text-xs tracking-[0.25em] uppercase text-gold-200/90 mt-8 mb-3">
      {children}
    </h3>
  );
}

export function P({ children }) {
  return <p className="text-cream-100/75 leading-relaxed mb-4">{children}</p>;
}

export function Ul({ children }) {
  return (
    <ul className="list-disc pl-5 space-y-2 mb-4 text-cream-100/75 leading-relaxed marker:text-gold-300/60">
      {children}
    </ul>
  );
}

/** Label/value pair inside a data-card — e.g. "Legal basis: contract". */
export function Row({ label, children }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4 py-2 border-t border-gold-300/10 first:border-t-0">
      <dt className="text-xs tracking-[0.15em] uppercase text-cream-100/45 sm:pt-0.5">
        {label}
      </dt>
      <dd className="text-cream-100/80 leading-relaxed">{children}</dd>
    </div>
  );
}

/**
 * A bordered card holding Rows. Used instead of a table: on a 390px phone a
 * five-column table either scrolls sideways or crushes its cells, and the
 * visitor arriving from a lead form is on exactly that phone.
 */
export function Card({ title, children }) {
  return (
    <div className="border border-gold-300/15 bg-ink-900/40 rounded-sm px-5 py-4 mb-4">
      {title && (
        <div className="font-display text-xl text-cream-50 mb-2">{title}</div>
      )}
      <dl>{children}</dl>
    </div>
  );
}

/** External link, or a mailto:/tel:. */
export function A({ href, children }) {
  const external = /^https?:/.test(href);
  return (
    <a
      href={href}
      className="text-gold-200 link-underline break-words"
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

/** Link to another page of this site. */
export function L({ to, children }) {
  return (
    <Link to={to} className="text-gold-200 link-underline">
      {children}
    </Link>
  );
}
