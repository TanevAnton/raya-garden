import { CalendarDays, Users } from "lucide-react";
import { StepHeading, Field, SliderNumberField, TextField, CheckBox, Notice, inputClass, labelClass } from "./fields.jsx";
import { fill } from "../../i18n/weddingConfigurator.js";

/** Step 1 — when, and how many people eat what. */
export default function StepDateGuests({ s, offer, config, update, errors }) {
  const { date, guests } = config;
  const maxGuests = offer.package.maxGuests;
  const standard = Number.parseInt(guests.standard, 10) || 0;
  const children = Number.parseInt(guests.children, 10) || 0;
  const noDate = date.mode === "period";

  /**
   * The two counts share one room. Whichever the couple is moving wins, and
   * the other gives way — so the pair can never quietly add up to more than
   * the restaurant seats. One adult always stays behind.
   */
  const setGuests = (key, raw) => {
    const parsed = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(parsed)) {
      // Mid-edit (an emptied field): keep what was typed, couple nothing.
      update("guests", { ...guests, [key]: raw });
      return;
    }
    const otherKey = key === "standard" ? "children" : "standard";
    const otherFloor = otherKey === "standard" ? 1 : 0;
    const floor = key === "standard" ? 1 : 0;
    const value = Math.max(floor, Math.min(parsed, maxGuests - otherFloor));
    const other = otherKey === "standard" ? standard : children;
    const nextOther = Math.max(otherFloor, Math.min(other, maxGuests - value));
    update("guests", { ...guests, [key]: String(value), [otherKey]: String(nextOther) });
  };

  return (
    <div className="space-y-10">
      <section>
        <StepHeading>{s.date.legend}</StepHeading>

        <div className="sm:max-w-sm">
          <Field label={s.date.dateLabel} error={errors.date}>
            {(props) => (
              <input
                {...props}
                type="date"
                value={date.date}
                disabled={noDate}
                onChange={(e) => update("date", { ...date, date: e.target.value })}
                className={`${inputClass} [color-scheme:dark] cursor-pointer ${
                  noDate ? "opacity-40 cursor-not-allowed" : ""
                } ${errors.date ? "border-red-400/50" : ""}`}
              />
            )}
          </Field>
        </div>

        <div className="mt-5">
          <CheckBox
            checked={noDate}
            onChange={(checked) =>
              update("date", {
                ...date,
                mode: checked ? "period" : "date",
                // Keep whichever value the other mode had; nothing is lost by
                // toggling back and forth while deciding.
              })
            }
          >
            {s.date.noDate}
          </CheckBox>
        </div>

        {noDate && (
          <div className="mt-5">
            <TextField
              label={s.date.periodLabel}
              placeholder={s.date.periodPlaceholder}
              value={date.period}
              onChange={(v) => update("date", { ...date, period: v })}
            />
          </div>
        )}

        <div className="mt-5">
          <Notice>
            <CalendarDays className="inline w-3.5 h-3.5 mr-2 -mt-0.5 text-gold-300/80" />
            {s.date.dateNotice}
          </Notice>
        </div>
      </section>

      <section>
        <StepHeading>{s.date.guestsLegend}</StepHeading>

        <div className="grid sm:grid-cols-2 gap-5">
          <SliderNumberField
            label={s.date.standardLabel}
            hint={s.date.standardHint}
            error={errors.standardGuests}
            value={guests.standard}
            min={1}
            max={maxGuests}
            onChange={(v) => setGuests("standard", v)}
          />
          <SliderNumberField
            label={s.date.childrenLabel}
            hint={s.date.childrenHint}
            error={errors.children}
            value={guests.children}
            min={0}
            max={maxGuests}
            onChange={(v) => setGuests("children", v)}
          />
        </div>

        <div className="mt-5 flex items-center justify-between border border-gold-300/15 bg-ink-900/60 px-4 py-3.5">
          <span className={`${labelClass} mb-0 flex items-center gap-2`}>
            <Users className="w-4 h-4 text-gold-300/70" />
            {s.date.totalLabel}
          </span>
          <span className="font-display text-2xl text-cream-50">{standard + children}</span>
        </div>

        <p className="text-xs text-cream-100/45 mt-3">
          {fill(s.date.capacityHint, { max: maxGuests })}
        </p>
      </section>

    </div>
  );
}
