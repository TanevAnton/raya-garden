import { Link } from "react-router-dom";
import { Loader2, Send, AlertTriangle, CheckCircle2 } from "lucide-react";
import { StepHeading, TextField, TextArea, CheckBox } from "./fields.jsx";
import SummaryPanel from "./SummaryPanel.jsx";
import { fill } from "../../i18n/weddingConfigurator.js";

/**
 * Step 4 — the whole configuration to check, then contact details.
 * Contact fields are asked for only here, once the guest has been able to
 * explore the offer.
 */
export default function StepReview({
  s,
  t,
  offer,
  lang,
  config,
  update,
  quote,
  overlap,
  errors,
  status,
  errorMessage,
  reference,
  phone,
  onEdit,
  onSubmit,
}) {
  const { contact } = config;
  const set = (field) => (value) => update("contact", { ...contact, [field]: value });

  if (status === "sent") {
    return (
      <div className="border border-gold-300/30 bg-ink-900 p-8 md:p-12 text-center">
        <CheckCircle2 className="w-10 h-10 text-gold-300 mx-auto" />
        <h2 className="font-display text-2xl md:text-3xl text-cream-50 mt-5 text-balance">
          {s.contact.success}
        </h2>
        {reference && (
          <p className="text-xs tracking-[0.2em] uppercase text-gold-300/70 mt-5">
            {fill(s.contact.successRef, { ref: reference })}
          </p>
        )}
        <div className="divider-gold mt-8 w-32 mx-auto" />
        <p className="text-sm text-cream-100/60 mt-6 max-w-lg mx-auto leading-relaxed">
          {s.summary.notBooking}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* The full estimate, inline — on mobile this is where the guest reads
          it, so the floating bar is hidden on this step. */}
      <section className="lg:hidden border border-gold-300/15 bg-ink-900/60 p-5">
        <SummaryPanel
          s={s}
          offer={offer}
          lang={lang}
          config={config}
          quote={quote}
          overlap={overlap}
          onEdit={onEdit}
        />
      </section>

      <section>
        <StepHeading hint={s.contact.lead}>{s.contact.legend}</StepHeading>

        <form onSubmit={onSubmit} noValidate className="space-y-5">
          <div className="grid sm:grid-cols-2 gap-5">
            <TextField
              label={s.contact.name}
              value={contact.name}
              onChange={set("name")}
              autoComplete="name"
              error={errors.name}
              required
            />
            <TextField
              label={s.contact.phone}
              type="tel"
              value={contact.phone}
              onChange={set("phone")}
              autoComplete="tel"
              error={errors.phone}
              required
            />
            <TextField
              label={s.contact.email}
              type="email"
              value={contact.email}
              onChange={set("email")}
              autoComplete="email"
              error={errors.email}
              required
            />
            <TextField
              label={s.contact.address}
              hint={s.contact.addressHint}
              value={contact.address}
              onChange={set("address")}
              autoComplete="street-address"
              error={errors.address}
              required
            />
          </div>

          <TextArea
            label={s.contact.message}
            rows={3}
            value={contact.message}
            onChange={set("message")}
          />

          {/* Honeypot: never shown, never announced, ignored by humans. */}
          <div aria-hidden="true" className="hidden">
            <label htmlFor="website-url">Website</label>
            <input
              id="website-url"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={config.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </div>

          <div className="pt-2">
            <CheckBox checked={config.consent} onChange={(v) => update("consent", v)}>
              {s.contact.consent}{" "}
              <Link to="/contact" className="text-gold-200 link-underline">
                {t.footer.links.privacy}
              </Link>
              .
            </CheckBox>
            {errors.consent && (
              <p role="alert" className="text-xs text-red-300/90 mt-2 ml-7">
                {errors.consent}
              </p>
            )}
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="flex items-start gap-2 text-sm text-red-200 border border-red-400/30 bg-red-500/[0.06] px-4 py-3"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{fill(errorMessage, { phone })}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="btn-gold w-full px-8 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm inline-flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-wait"
          >
            {status === "submitting" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {s.contact.submitting}
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {s.contact.submit}
              </>
            )}
          </button>

          <p className="text-xs text-cream-100/50 leading-relaxed">{s.summary.notBooking}</p>
        </form>
      </section>
    </div>
  );
}
