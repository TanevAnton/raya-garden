import { useId } from "react";
import { AlertCircle } from "lucide-react";

// Form primitives for the wedding configurator, built from the same tokens
// the rest of the site uses (see /book and /contact): ink surfaces, a hairline
// gold border, wide-tracked uppercase labels.

export const inputClass =
  "w-full bg-ink-950 border border-gold-300/15 px-4 py-3 text-cream-50 " +
  "placeholder:text-cream-100/30 focus:border-gold-300/50 focus:outline-none transition";

export const labelClass =
  "block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2";

/** Section heading used at the top of every step. */
export function StepHeading({ children, hint }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-2xl md:text-3xl text-cream-50 leading-tight">
        {children}
      </h2>
      {hint && (
        <p className="text-sm text-cream-100/60 mt-2 leading-relaxed">{hint}</p>
      )}
    </div>
  );
}

/**
 * Labelled control. `error` is a message, not a boolean, so the same string
 * is announced to screen readers and shown under the field.
 */
export function Field({ label, hint, error, children, className = "" }) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-cream-100/45 mt-2 leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p
          id={`${id}-err`}
          role="alert"
          className="flex items-start gap-2 text-xs text-red-300/90 mt-2"
        >
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Whole numbers only — inputMode numeric brings up the digit keypad. */
export function NumberField({ label, hint, error, value, onChange, min = 0, max = 2000 }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <input
          {...props}
          type="number"
          inputMode="numeric"
          step="1"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${error ? "border-red-400/50" : ""}`}
        />
      )}
    </Field>
  );
}

/**
 * A guest count with a slider beside it. The slider is the quick way to a
 * number; the field above it stays typable, so an exact count is never more
 * than a keystroke away. Both write the same value.
 */
export function SliderNumberField({ label, hint, error, value, onChange, min = 0, max = 150 }) {
  const typed = Number.parseInt(String(value ?? ""), 10);
  const current = Number.isFinite(typed) ? Math.min(Math.max(typed, min), max) : min;

  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <div>
          <input
            {...props}
            type="number"
            inputMode="numeric"
            step="1"
            min={min}
            max={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`${inputClass} ${error ? "border-red-400/50" : ""}`}
          />
          <input
            type="range"
            min={min}
            max={max}
            step="1"
            value={current}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className="w-full mt-3 accent-[#d7b85f] cursor-pointer"
          />
          <div className="flex justify-between text-[10px] tracking-[0.2em] text-cream-100/35 mt-1">
            <span>{min}</span>
            <span>{max}</span>
          </div>
        </div>
      )}
    </Field>
  );
}

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  required,
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <input
          {...props}
          type={type}
          value={value}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} ${error ? "border-red-400/50" : ""}`}
        />
      )}
    </Field>
  );
}

export function TextArea({ label, hint, error, value, onChange, placeholder, rows = 3 }) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <textarea
          {...props}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} resize-y ${error ? "border-red-400/50" : ""}`}
        />
      )}
    </Field>
  );
}

/** Square gold checkbox — the native control, restyled rather than replaced. */
export function CheckBox({ checked, onChange, children, id }) {
  const generated = useId();
  const inputId = id || generated;
  return (
    <div className="flex items-start gap-3">
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 flex-shrink-0 accent-[#d7b85f] bg-ink-950 border border-gold-300/40 cursor-pointer"
      />
      <label htmlFor={inputId} className="text-sm text-cream-100/80 leading-relaxed cursor-pointer">
        {children}
      </label>
    </div>
  );
}

/** Quiet framed note — used for the "subject to confirmation" caveats. */
export function Notice({ children, tone = "neutral" }) {
  const tones = {
    neutral: "border-gold-300/15 bg-ink-950/60 text-cream-100/70",
    warn: "border-gold-300/40 bg-gold-300/[0.06] text-cream-100/85",
  };
  return (
    <p className={`text-xs leading-relaxed border px-4 py-3 ${tones[tone]}`}>{children}</p>
  );
}
