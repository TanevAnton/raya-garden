import { Check, Plus, X } from "lucide-react";
import { StepHeading, NumberField, TextArea, Notice, labelClass } from "./fields.jsx";
import { formatMoney } from "../../lib/weddingPricing.js";
import { fill } from "../../i18n/weddingConfigurator.js";

function unitLabel(s, unit) {
  if (unit === "per_person") return s.extras.perPerson;
  if (unit === "per_hour") return s.extras.perHour;
  return s.extras.fixed;
}

/** Priced addition — collapsed to a price row until it is added. */
function ExtraCard({ extra, s, lang, selection, onChange, errors, defaultCovers }) {
  const selected = Boolean(selection?.selected);
  const label =
    lang === "en" ? extra.labelEn || extra.label : lang === "ro" ? extra.labelRo || extra.label : extra.label;
  const cateringPicked = selection?.catering?.length || 0;

  const toggle = () =>
    onChange(
      selected
        ? { selected: false, covers: "", hours: "", catering: [], notes: "" }
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
            <ul className="mt-3 space-y-1">
              {extra.bullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-cream-100/70">
                  <Check className="w-3.5 h-3.5 text-gold-300/80 flex-shrink-0 mt-px" />
                  {b}
                </li>
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
                        <span className="inline-flex items-start gap-2">
                          <Check
                            className={`w-3.5 h-3.5 flex-shrink-0 mt-px ${
                              picked ? "text-gold-300" : "text-transparent"
                            }`}
                          />
                          {item.name}
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

/** Request with no published price — never priced, never added to the total. */
function RequestCard({ request, s, lang, selection, onChange }) {
  const selected = Boolean(selection?.selected);
  const label =
    lang === "en"
      ? request.labelEn || request.label
      : lang === "ro"
      ? request.labelRo || request.label
      : request.label;

  return (
    <article
      className={`border p-5 transition-all duration-500 ${
        selected ? "border-gold-300/50 bg-ink-900" : "border-gold-300/15 bg-ink-900/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm text-cream-50 leading-snug">{label}</h3>
        <span className="text-[10px] tracking-[0.15em] uppercase text-gold-300/60 shrink-0 border border-gold-300/20 px-2 py-1">
          {s.extras.quotationBadge}
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
export default function StepExtras({ s, offer, lang, config, update, errors, overlap, defaultCovers }) {
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
