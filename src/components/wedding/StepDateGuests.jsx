import { CalendarDays, Users, Check, ChevronDown } from "lucide-react";
import { StepHeading, Field, NumberField, TextField, CheckBox, Notice, inputClass, labelClass } from "./fields.jsx";

/** Step 1 — when, and how many people eat what. */
export default function StepDateGuests({ s, offer, config, update, errors, includedOpen, setIncludedOpen }) {
  const { date, guests } = config;
  const standard = Number.parseInt(guests.standard, 10) || 0;
  const children = Number.parseInt(guests.children, 10) || 0;
  const noDate = date.mode === "period";

  return (
    <div className="space-y-10">
      <section>
        <StepHeading>{s.date.legend}</StepHeading>

        <div className="grid sm:grid-cols-2 gap-5">
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

          <Field label={s.date.timeLabel}>
            {(props) => (
              <input
                {...props}
                type="time"
                value={date.time}
                onChange={(e) => update("date", { ...date, time: e.target.value })}
                className={`${inputClass} [color-scheme:dark]`}
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
          <NumberField
            label={s.date.standardLabel}
            hint={s.date.standardHint}
            error={errors.standardGuests}
            value={guests.standard}
            min={1}
            onChange={(v) => update("guests", { ...guests, standard: v })}
          />
          <NumberField
            label={s.date.childrenLabel}
            hint={s.date.childrenHint}
            error={errors.children}
            value={guests.children}
            min={0}
            onChange={(v) => update("guests", { ...guests, children: v })}
          />
        </div>

        <div className="mt-5 flex items-center justify-between border border-gold-300/15 bg-ink-900/60 px-4 py-3.5">
          <span className={`${labelClass} mb-0 flex items-center gap-2`}>
            <Users className="w-4 h-4 text-gold-300/70" />
            {s.date.totalLabel}
          </span>
          <span className="font-display text-2xl text-cream-50">{standard + children}</span>
        </div>
      </section>

      {/* What the package already includes — collapsed by default so the step
          stays short, but present before any money is discussed. */}
      <section className="border border-gold-300/15 bg-ink-900/40">
        <button
          type="button"
          onClick={() => setIncludedOpen(!includedOpen)}
          aria-expanded={includedOpen}
          className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left group"
        >
          <span className="font-display text-xl text-cream-50">{s.included.title}</span>
          <span className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-gold-300/80">
            {includedOpen ? s.included.toggleClose : s.included.toggleOpen}
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-300 ${
                includedOpen ? "rotate-180" : ""
              }`}
            />
          </span>
        </button>
        {includedOpen && (
          <div className="px-5 pb-5">
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {offer.inclusions.map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-cream-100/80">
                  <Check className="w-4 h-4 text-gold-300 flex-shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-cream-100/45 mt-5">{s.included.note}</p>
          </div>
        )}
      </section>
    </div>
  );
}
