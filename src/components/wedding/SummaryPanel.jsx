import { Pencil, Info } from "lucide-react";
import { formatMoney, offerExpired, upgradesForMenu } from "../../lib/weddingPricing.js";
import { fill } from "../../i18n/weddingConfigurator.js";

function label(offer, group, id, lang) {
  const item = offer[group].find((x) => x.id === id);
  if (!item) return id;
  if (lang === "en" && item.labelEn) return item.labelEn;
  if (lang === "ro" && item.labelRo) return item.labelRo;
  return item.name || item.label || id;
}

function Row({ children, onEdit, editLabel }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 flex-1">{children}</div>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-gold-300/70 hover:text-gold-200 transition-colors inline-flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" />
          {editLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The running estimate. Rendered in three places — the desktop rail, the
 * mobile sheet and the review step — so it stays one component and can never
 * disagree with itself.
 */
export default function SummaryPanel({ s, offer, lang, config, quote, overlap, onEdit }) {
  const standard = quote.standardGuests;
  const children = quote.children;
  const money = (cents) => formatMoney(cents, lang);
  const expired = offerExpired(offer);
  const deadline = new Date(offer.reservationDeadline).toLocaleDateString(
    lang === "en" ? "en-GB" : lang === "ro" ? "ro-RO" : "bg-BG"
  );

  // Only the services the hotel has not priced belong under "individual
  // quotation" — the priced ones are lines in the estimate above.
  const selectedRequests = Object.entries(config.requests).filter(
    ([id, r]) =>
      r?.selected && offer.quotationRequests.find((q) => q.id === id)?.priceCents == null
  );
  const hasNumbers = standard > 0;

  const menuUpgrades = upgradesForMenu(offer, config.menus.primary);
  const upgradeName = (id) => menuUpgrades.find((u) => u.id === id)?.name || id;
  // Upgrades the hotel has not priced yet sit with the other requests rather
  // than in the numbers.
  const onRequestUpgrades = (quote.quotedUpgrades || []).map((u) => u.name);

  const lineLabel = (line) => {
    if (line.id === "standard-menus") return s.summary.standardSubtotal;
    if (line.id === "child-menus") return s.summary.childSubtotal;
    if (line.label) return line.label;
    const upgrade = menuUpgrades.find((u) => u.id === line.id);
    if (upgrade) return upgrade.name;
    if (offer.quotationRequests.some((r) => r.id === line.id)) {
      return label(offer, "quotationRequests", line.id, lang);
    }
    return label(offer, "extras", line.id, lang);
  };

  const unitSuffix = (unit) =>
    unit === "per_hour"
      ? s.extras.perHour
      : unit === "fixed"
      ? s.extras.fixed
      : unit === "per_room"
      ? s.extras.perRoom
      : unit === "per_child"
      ? ""
      : s.extras.perPerson;

  return (
    <div className="text-sm">
      <h2 className="font-display text-xl text-cream-50 mb-4">{s.summary.title}</h2>

      <div className="divide-y divide-gold-300/10 border-y border-gold-300/10">
        <Row onEdit={onEdit && (() => onEdit(0))} editLabel={s.nav.edit}>
          <div className="text-xs tracking-[0.2em] uppercase text-gold-300/60">
            {config.date.mode === "period" ? s.summary.period : s.summary.date}
          </div>
          <div className="text-cream-50 mt-1">
            {config.date.mode === "period"
              ? config.date.period || s.summary.noDateYet
              : config.date.date || "—"}
          </div>
        </Row>

        <Row onEdit={onEdit && (() => onEdit(0))} editLabel={s.nav.edit}>
          <div className="text-xs tracking-[0.2em] uppercase text-gold-300/60">
            {s.summary.guests}
          </div>
          <div className="text-cream-50 mt-1">
            {fill(s.summary.guestsValue, { a: standard, c: children })}
          </div>
        </Row>

        {config.menus.primary && (
          <Row onEdit={onEdit && (() => onEdit(1))} editLabel={s.nav.edit}>
            <div className="text-xs tracking-[0.2em] uppercase text-gold-300/60">
              {s.summary.menu}
            </div>
            <div className="text-cream-50 mt-1 space-y-0.5">
              <div>{label(offer, "menus", config.menus.primary, lang)}</div>
              {Object.entries(config.childMenus)
                .filter(([, n]) => Number.parseInt(n, 10) > 0)
                .map(([id, n]) => (
                  <div key={id} className="text-cream-100/70">
                    {label(offer, "childMenus", id, lang)} × {n}
                  </div>
                ))}
            </div>
          </Row>
        )}
      </div>

      {/* Priced lines */}
      {hasNumbers ? (
        <div className="mt-4 space-y-2">
          {quote.lines.map((line) => (
            <div key={line.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-cream-100/85 leading-snug">{lineLabel(line)}</div>
                <div className="text-xs text-cream-100/45 mt-0.5">
                  {line.minUnitPriceCents
                    ? `${line.quantity} × ${money(line.minUnitPriceCents)} / ${money(
                        line.maxUnitPriceCents
                      )}`
                    : `${line.quantity} × ${money(line.unitPriceCents)} ${unitSuffix(line.unit)}`}
                </div>
              </div>
              <div className="text-cream-50 shrink-0 tabular-nums">
                {line.minTotalCents
                  ? `${money(line.minTotalCents)} – ${money(line.maxTotalCents)}`
                  : money(line.totalCents)}
              </div>
            </div>
          ))}

          <div className="pt-4 mt-2 border-t border-gold-300/20">
            <div className="text-xs tracking-[0.2em] uppercase text-gold-300/70">
              {s.summary.estimate}
            </div>
            <div className="font-display text-3xl gradient-gold mt-1 leading-none">
              {quote.isRange
                ? `${money(quote.minTotalCents)} – ${money(quote.maxTotalCents)}`
                : money(quote.maxTotalCents)}
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-cream-100/50 mt-4">{s.summary.empty}</p>
      )}

      {quote.isRange && (
        <p className="flex gap-2 text-xs text-gold-200/80 leading-relaxed mt-4 border border-gold-300/25 bg-gold-300/[0.05] px-3 py-2.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{s.summary.thresholdNote}</span>
        </p>
      )}

      {overlap.length > 1 && (
        <p className="text-xs text-gold-200/75 leading-relaxed mt-3 border border-gold-300/25 px-3 py-2.5">
          {s.extras.overlapWarning}
        </p>
      )}

      {/* Requests that carry no price never touch the numbers above. */}
      {(selectedRequests.length > 0 || onRequestUpgrades.length > 0) && (
        <div className="mt-5 pt-4 border-t border-gold-300/10">
          <div className="text-xs tracking-[0.2em] uppercase text-gold-300/60 flex items-center justify-between gap-3">
            {s.summary.quotation}
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(2)}
                className="text-[10px] tracking-[0.15em] uppercase text-gold-300/70 hover:text-gold-200 inline-flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                {s.nav.edit}
              </button>
            )}
          </div>
          <ul className="mt-2 space-y-1">
            {onRequestUpgrades.map((name) => (
              <li key={name} className="text-xs text-cream-100/70">
                · {name}
              </li>
            ))}
            {selectedRequests.map(([id]) => (
              <li key={id} className="text-xs text-cream-100/70">
                · {label(offer, "quotationRequests", id, lang)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-cream-100/45 mt-2">{s.summary.quotationExcluded}</p>
        </div>
      )}

      <div className="mt-5 pt-4 border-t border-gold-300/10 space-y-2">
        <div className="text-xs tracking-[0.2em] uppercase text-gold-300/60">
          {s.summary.conditionsTitle}
        </div>
        <p className="text-xs text-cream-100/60 leading-relaxed">{s.summary.notBooking}</p>
        <p className="text-xs text-cream-100/60 leading-relaxed">
          {fill(expired ? s.summary.expired : s.summary.validUntil, { date: deadline })}
        </p>
        {offer.conditions.slice(0, 1).map((condition, i) => (
          <p key={i} className="text-xs text-cream-100/60 leading-relaxed">
            {condition}
          </p>
        ))}
      </div>
    </div>
  );
}
