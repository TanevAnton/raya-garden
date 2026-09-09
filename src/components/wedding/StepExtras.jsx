import { Fragment } from "react";
import { Check, Plus, X } from "lucide-react";
import { StepHeading, NumberField, TextArea, Notice, labelClass } from "./fields.jsx";
import { formatMoney } from "../../lib/weddingPricing.js";
import { fill } from "../../i18n/weddingConfigurator.js";

function unitLabel(s, unit) {
  if (unit === "per_person") return s.extras.perPerson;
  if (unit === "per_hour") return s.extras.perHour;
  if (unit === "per_room") return s.extras.perRoom;
  return s.extras.fixed;
}

function pick(item, lang, key) {
  if (lang === "en") return item[`${key}En`] || item[key];
  if (lang === "ro") return item[`${key}Ro`] || item[key];
  return item[key];
}

/**
 * The glass upgrades that sit with the drink they replace. One glass is
 * poured, so `exclusive` makes them a choice rather than a checklist —
 * picking a second one puts the first back.
 */
function UpgradeChoices({ extra, s, lang, chosen, onChange }) {
  const exclusive = Boolean(extra.upgradesExclusive);
  const note = pick(extra, lang, "upgradesNote");

  return (
    <fieldset className="mt-2">
      <legend className="text-[11px] tracking-[0.2em] uppercase text-gold-300/70">
        {s.extras.glassUpgradeTitle}
      </legend>
      {note && (
        <p className="text-[11px] text-cream-100/45 leading-relaxed mt-1 mb-2">{note}</p>
      )}
      <ul className="space-y-1.5">
        {extra.upgrades.map((upgrade) => {
          const picked = chosen.includes(upgrade.id);
          return (
            <li key={upgrade.id}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() =>
                  onChange(
                    picked
                      ? chosen.filter((u) => u !== upgrade.id)
                      : exclusive
                      ? [upgrade.id]
                      : [...chosen, upgrade.id]
                  )
                }
                className={`w-full text-left border px-3 py-2 flex items-center gap-3 transition ${
                  picked
                    ? "border-gold-300/50 bg-gold-300/[0.07]"
                    : "border-gold-300/15 hover:border-gold-300/35"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-4 h-4 flex-shrink-0 flex items-center justify-center border transition ${
                    exclusive ? "rounded-full" : ""
                  } ${
                    picked
                      ? "bg-gold-300/90 border-gold-300 text-ink-950"
                      : "border-gold-300/40 text-transparent"
                  }`}
                >
                  <Check className="w-3 h-3" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1 flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-xs text-cream-50">{upgrade.name}</span>
                  <span className="text-[10px] tracking-[0.15em] uppercase text-gold-300/70">
                    {upgrade.priceCents == null
                      ? s.menus.upgradeOnRequest
                      : `+ ${formatMoney(upgrade.priceCents, lang)} ${unitLabel(s, upgrade.unit)}`}
                  </span>
                </span>
              </button>
              {upgrade.text && (
                <p className="text-[11px] text-cream-100/50 leading-relaxed mt-1 px-3">
                  {upgrade.text}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Priced addition — collapsed to a price row until it is added. */
function ExtraCard({ extra, s, lang, selection, onChange, errors, defaultCovers, required, blocked, offerExtras }) {
  const selected = Boolean(selection?.selected);
  const label =
    lang === "en" ? extra.labelEn || extra.label : lang === "ro" ? extra.labelRo || extra.label : extra.label;
  const cateringPicked = selection?.catering?.length || 0;

  const toggle = () =>
    onChange(
      selected
        ? { selected: false, covers: "", hours: "", catering: [], location: "", upgrades: [], notes: "" }
        : {
            ...selection,
            selected: true,
            // Start from the guest count already entered on step 1 — the
            // couple can lower it if not everyone joins the welcome drink.
            covers:
              extra.unit === "per_person" && !selection.covers
                ? String(defaultCovers || "")
                : selection.covers,
          }
    );

  const toggleCatering = (id) => {
    const picked = selection?.catering || [];
    const next = picked.includes(id)
      ? picked.filter((c) => c !== id)
      : picked.length < extra.cateringChoices
      ? [...picked, id]
      : picked; // the offer specifies exactly three — ignore further picks
    onChange({ ...selection, catering: next });
  };

  return (
    <article
      className={`border transition-all duration-500 ${
        selected ? "border-gold-300/50 bg-ink-900" : "border-gold-300/15 bg-ink-900/50"
      }`}
    >
      <div className="p-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl text-cream-50 leading-snug">{label}</h3>
          {extra.text && (
            <p className="text-xs text-cream-100/60 leading-relaxed mt-2 max-w-prose">
              {extra.text}
            </p>
          )}
          {extra.bullets && (
            <ul className="mt-3 space-y-1 max-w-prose">
              {extra.bullets.map((b, i) => (
                <Fragment key={i}>
                  <li className="flex items-start gap-2 text-xs text-cream-100/70">
                    <Check className="w-3.5 h-3.5 text-gold-300/80 flex-shrink-0 mt-px" />
                    {b}
                  </li>
                  {/* The champagne upgrades stand next to the glass they
                      replace, and only once the ritual itself is added. */}
                  {selected && extra.upgrades?.length > 0 && extra.upgradesAfterBullet === i && (
                    <li className="pl-5">
                      <UpgradeChoices
                        extra={extra}
                        s={s}
                        lang={lang}
                        chosen={selection.upgrades || []}
                        onChange={(upgrades) => onChange({ ...selection, upgrades })}
                      />
                    </li>
                  )}
                </Fragment>
              ))}
            </ul>
          )}
          {extra.condition && (
            <p className="text-xs text-gold-200/70 mt-3">{extra.condition}</p>
          )}
        </div>

        <div className="text-right shrink-0">
          <div className="font-display text-2xl text-cream-50">
            {formatMoney(extra.priceCents, lang)}
          </div>
          <div className="text-[11px] tracking-[0.2em] uppercase text-gold-300/60 mt-1">
            {unitLabel(s, extra.unit)}
          </div>
        </div>
      </div>

      <div className="px-5 pb-5">
        {blocked ? (
          <p className="text-xs text-cream-100/45 leading-relaxed border border-gold-300/10 px-4 py-3">
            {s.extras.unavailableWithLocation}
          </p>
        ) : required ? (
          <div className="border border-gold-300/30 bg-gold-300/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-gold-200">
              <Check className="w-3.5 h-3.5" />
              {s.extras.requiredBadge}
            </div>
            <p className="text-xs text-cream-100/65 leading-relaxed mt-2">
              {s.extras.requiredNote}
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-pressed={selected}
            className={`px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-2 ${
              selected ? "btn-ghost" : "btn-gold"
            }`}
          >
            {selected ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {selected ? s.extras.remove : s.extras.add}
          </button>
        )}

        {selected && (
          <div className="mt-5 space-y-5 border-t border-gold-300/10 pt-5">
            {extra.unit === "per_person" && (
              <NumberField
                label={s.extras.coversLabel}
                error={errors[`extra.${extra.id}.covers`]}
                value={selection.covers ?? ""}
                min={1}
                onChange={(v) => onChange({ ...selection, covers: v })}
              />
            )}
            {extra.unit === "per_hour" && (
              <NumberField
                label={s.extras.hoursLabel}
                hint={s.extras.hoursHint}
                error={errors[`extra.${extra.id}.hours`]}
                value={selection.hours ?? ""}
                min={1}
                max={24}
                onChange={(v) => onChange({ ...selection, hours: v })}
              />
            )}

            {extra.locations && (
              <fieldset>
                <legend className={labelClass}>{s.extras.locationLabel}</legend>
                <p className="text-xs text-cream-100/45 mb-3 leading-relaxed">
                  {s.extras.locationHint}
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {extra.locations.map((location) => {
                    const picked = selection.location === location.id;
                    const name =
                      lang === "en"
                        ? location.labelEn || location.label
                        : lang === "ro"
                        ? location.labelRo || location.label
                        : location.label;
                    const note =
                      lang === "en"
                        ? location.noteEn || location.note
                        : lang === "ro"
                        ? location.noteRo || location.note
                        : location.note;
                    // What choosing this place costs, straight from the extra
                    // it pulls in — never a number typed in twice.
                    const fees = (location.requires || [])
                      .map((id) => offerExtras.find((e) => e.id === id))
                      .filter(Boolean);
                    return (
                      <button
                        key={location.id}
                        type="button"
                        onClick={() => onChange({ ...selection, location: location.id })}
                        aria-pressed={picked}
                        className={`text-left px-4 py-3 border transition ${
                          picked
                            ? "border-gold-300/60 bg-gold-300/10"
                            : "border-gold-300/15 hover:border-gold-300/40"
                        }`}
                      >
                        {location.image && (
                          <img
                            src={location.image}
                            alt=""
                            loading="lazy"
                            className="w-full h-28 object-cover mb-3"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        <span className="flex items-start gap-2">
                          <Check
                            className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${
                              picked ? "text-gold-300" : "text-transparent"
                            }`}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-cream-50">{name}</span>
                            <span className="block text-[11px] text-gold-300/70 mt-1">
                              {fees.length
                                ? fees
                                    .map(
                                      (fee) =>
                                        `+ ${formatMoney(fee.priceCents, lang)} ${unitLabel(s, fee.unit)}`
                                    )
                                    .join(" · ")
                                : s.extras.locationIncluded}
                            </span>
                            {note && (
                              <span className="block text-[11px] text-cream-100/45 mt-1">
                                {note}
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors[`extra.${extra.id}.location`] && (
                  <p role="alert" className="text-xs text-red-300/90 mt-3">
                    {errors[`extra.${extra.id}.location`]}
                  </p>
                )}
              </fieldset>
            )}

            {extra.catering && (
              <fieldset>
                <legend className={labelClass}>{s.extras.cateringTitle}</legend>
                <p
                  className={`text-xs mb-3 ${
                    cateringPicked === extra.cateringChoices ? "text-gold-200" : "text-cream-100/60"
                  }`}
                  aria-live="polite"
                >
                  {fill(s.extras.cateringCounter, {
                    n: cateringPicked,
                    max: extra.cateringChoices,
                  })}
                  {extra.cateringIncluded && (
                    <span className="text-cream-100/45"> · {s.extras.cateringIncluded}</span>
                  )}
                </p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {extra.catering.map((item) => {
                    const picked = selection.catering?.includes(item.id);
                    const full = cateringPicked >= extra.cateringChoices && !picked;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleCatering(item.id)}
                        aria-pressed={picked}
                        disabled={full}
                        className={`text-left text-xs leading-relaxed px-4 py-3 border transition ${
                          picked
                            ? "border-gold-300/60 bg-gold-300/10 text-cream-50"
                            : full
                            ? "border-gold-300/10 text-cream-100/30 cursor-not-allowed"
                            : "border-gold-300/15 text-cream-100/75 hover:border-gold-300/40"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Check
                            className={`w-3.5 h-3.5 flex-shrink-0 ${
                              picked ? "text-gold-300" : "text-transparent"
                            }`}
                          />
                          <span className="min-w-0 flex-1">{item.name}</span>
                          {extra.cateringIncluded && (
                            <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-gold-300/60">
                              {formatMoney(0, lang)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors[`extra.${extra.id}.catering`] && (
                  <p role="alert" className="text-xs text-red-300/90 mt-3">
                    {errors[`extra.${extra.id}.catering`]}
                  </p>
                )}
              </fieldset>
            )}

            {/* Anything not anchored to a bullet still gets a home here. */}
            {extra.upgrades?.length > 0 && extra.upgradesAfterBullet == null && (
              <UpgradeChoices
                extra={extra}
                s={s}
                lang={lang}
                chosen={selection.upgrades || []}
                onChange={(upgrades) => onChange({ ...selection, upgrades })}
              />
            )}

            <TextArea
              label={s.extras.notesLabel}
              rows={2}
              value={selection.notes ?? ""}
              onChange={(v) => onChange({ ...selection, notes: v })}
            />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * An additional service. Some carry the hotel's own price and are counted in
 * the estimate; the rest are quoted individually and never touch the numbers.
 */
function RequestCard({ request, s, lang, selection, onChange, totalGuests }) {
  const selected = Boolean(selection?.selected);
  const label = pick(request, lang, "label");
  const priced = request.priceCents != null;
  const quantity = request.unit === "per_person" ? totalGuests : 1;

  const badge = priced
    ? `${formatMoney(request.priceCents, lang)} ${unitLabel(s, request.unit)}`
    : request.fromPriceCents != null
    ? fill(s.extras.fromPrice, {
        price: formatMoney(request.fromPriceCents, lang),
        unit: unitLabel(s, request.fromUnit),
      })
    : s.extras.quotationBadge;

  return (
    <article
      className={`border p-5 transition-all duration-500 ${
        selected ? "border-gold-300/50 bg-ink-900" : "border-gold-300/15 bg-ink-900/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm text-cream-50 leading-snug">{label}</h3>
        <span
          className={`text-[10px] tracking-[0.15em] uppercase shrink-0 border px-2 py-1 ${
            priced ? "text-gold-200 border-gold-300/40" : "text-gold-300/60 border-gold-300/20"
          }`}
        >
          {badge}
        </span>
      </div>
      {/* Who actually arranges it: the hotel's own rooms and grounds, or a
          partner the hotel works with. */}
      <p className="text-[10px] tracking-[0.15em] uppercase text-cream-100/40 mt-2">
        {request.viaPartner ? s.extras.partnerBadge : s.extras.hotelBadge}
      </p>

      <button
        type="button"
        onClick={() =>
          onChange(selected ? { selected: false, notes: "" } : { ...selection, selected: true })
        }
        aria-pressed={selected}
        className={`mt-4 px-5 py-2.5 text-[11px] tracking-[0.25em] uppercase rounded-sm inline-flex items-center gap-2 ${
          selected ? "btn-ghost" : "btn-ghost"
        }`}
      >
        {selected ? <Check className="w-3.5 h-3.5 text-gold-300" /> : <Plus className="w-3.5 h-3.5" />}
        {selected ? s.extras.added : s.extras.add}
      </button>

      {selected && (
        <div className="mt-5 space-y-4">
          {/* What that price comes to for this wedding — the same arithmetic
              the server repeats before the enquiry is sent. */}
          {priced && quantity > 0 && (
            <p className="text-xs text-cream-100/70 border border-gold-300/15 px-3 py-2">
              {quantity} × {formatMoney(request.priceCents, lang)} ={" "}
              <span className="text-cream-50">
                {formatMoney(quantity * request.priceCents, lang)}
              </span>
            </p>
          )}
          {request.collectRooms && (
            <div className="grid grid-cols-3 gap-3">
              <NumberField
                label={s.extras.roomsLabel}
                value={selection.rooms ?? ""}
                onChange={(v) => onChange({ ...selection, rooms: v })}
                max={999}
              />
              <NumberField
                label={s.extras.guestsLabel}
                value={selection.guests ?? ""}
                onChange={(v) => onChange({ ...selection, guests: v })}
                max={999}
              />
              <NumberField
                label={s.extras.nightsLabel}
                value={selection.nights ?? ""}
                onChange={(v) => onChange({ ...selection, nights: v })}
                max={999}
              />
            </div>
          )}
          <TextArea
            label={s.extras.notesLabel}
            rows={2}
            value={selection.notes ?? ""}
            onChange={(v) => onChange({ ...selection, notes: v })}
          />
        </div>
      )}
    </article>
  );
}

/** Step 3 — priced additions, then everything quoted individually. */
export default function StepExtras({ s, offer, lang, config, update, errors, overlap, defaultCovers, totalGuests }) {
  // Extras pulled in by another selected extra — shown as required, not
  // offered as a choice.
  const requiredIds = new Set();
  const blockedIds = new Set();
  for (const extra of offer.extras) {
    const selection = config.extras[extra.id];
    if (!selection?.selected) continue;
    for (const id of extra.requires || []) requiredIds.add(id);
    const location = (extra.locations || []).find((l) => l.id === selection.location);
    for (const id of location?.requires || []) requiredIds.add(id);
    if (extra.locations && location) {
      for (const other of extra.locations) {
        for (const id of other.requires || []) {
          if (!(location.requires || []).includes(id)) blockedIds.add(id);
        }
      }
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <StepHeading>{s.extras.pricedLegend}</StepHeading>
        <div className="space-y-5">
          {offer.extras.map((extra) => (
            <ExtraCard
              key={extra.id}
              extra={extra}
              s={s}
              lang={lang}
              errors={errors}
              defaultCovers={defaultCovers}
              required={requiredIds.has(extra.id)}
              blocked={blockedIds.has(extra.id)}
              offerExtras={offer.extras}
              selection={config.extras[extra.id] || {}}
              onChange={(next) =>
                update("extras", { ...config.extras, [extra.id]: next })
              }
            />
          ))}
        </div>

        {overlap.length > 1 && (
          <div className="mt-5">
            <Notice tone="warn">{s.extras.overlapWarning}</Notice>
          </div>
        )}
      </section>

      <section>
        <StepHeading hint={s.extras.quotationNote}>{s.extras.quotationLegend}</StepHeading>
        <div className="grid sm:grid-cols-2 gap-4">
          {offer.quotationRequests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              s={s}
              lang={lang}
              totalGuests={totalGuests}
              selection={config.requests[request.id] || {}}
              onChange={(next) =>
                update("requests", { ...config.requests, [request.id]: next })
              }
            />
          ))}
        </div>
      </section>

      <section>
        <TextArea
          label={s.extras.otherLabel}
          placeholder={s.extras.otherPlaceholder}
          rows={4}
          value={config.otherWishes}
          onChange={(v) => update("otherWishes", v)}
        />
      </section>
    </div>
  );
}
