import { useState } from "react";
import { money } from "../shared/format.js";

// A tip on top of a payment on the phone — an order paid as it is sent, or
// part of a table's bill. Optional, and none to start with: 5, 10 or 15 % of
// the amount (rounded to 10 cents), or an amount of the guest's own, at most
// the amount itself. It is its own line on Stripe's page and reaches staff
// apart from the till amount.

const PERCENTS = [5, 10, 15];
const TIP_MAX = 50000; // the server's limit too

/** "2,50" or "2.5" → 250 cents; NaN when it is not an amount. */
function cents(text) {
  const value = text.trim().replace(",", ".");
  if (!/^\d{1,4}(\.\d{0,2})?$/.test(value)) return value === "" ? 0 : NaN;
  return Math.round(Number(value) * 100);
}

const ofPercent = (amount, percent) => Math.round((amount * percent) / 1000) * 10;

/** The guest's tip choice for an amount: { tip (cents, 0 while bad), bad, … }. */
export function useTip(amount) {
  const [choice, setChoice] = useState(0); // 0 = none, a percent, or "other"
  const [text, setText] = useState("");
  const raw = choice === "other" ? cents(text) : ofPercent(amount, choice);
  const bad = Number.isNaN(raw) || raw > amount || raw > TIP_MAX;
  const reset = () => {
    setChoice(0);
    setText("");
  };
  return { tip: bad ? 0 : raw, bad, choice, setChoice, text, setText, reset };
}

export function TipPicker({ t, lang, amount, tip, tooBig }) {
  return (
    <fieldset className="mt-5" data-tip>
      <legend className="text-sm text-cream-50">
        {t.tip} <span className="text-cream-100/50">· {t.tipHint}</span>
      </legend>
      <div className="flex flex-wrap gap-2 mt-2">
        {[0, ...PERCENTS, "other"].map((choice) => {
          const label = choice === 0 ? t.tipNone : choice === "other" ? t.tipOther : `${choice}% · ${money(ofPercent(amount, choice), lang)}`;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={tip.choice === choice}
              onClick={() => tip.setChoice(choice)}
              className={`h-10 px-3 rounded-full text-xs border ${tip.choice === choice ? "border-gold-300 bg-gold-300/15 text-gold-100" : "border-gold-300/25 text-cream-100/70"}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      {tip.choice === "other" && (
        <label className="block mt-3">
          <span className="text-xs text-cream-100/60">{t.tipOtherLabel}</span>
          <input
            value={tip.text}
            onChange={(e) => tip.setText(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="2,00"
            className="mt-1 w-32 bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-2 text-cream-50"
            aria-invalid={tip.bad}
          />
        </label>
      )}
      {tip.bad && <p role="alert" className="text-xs text-red-300 mt-2">{tooBig}</p>}
    </fieldset>
  );
}
