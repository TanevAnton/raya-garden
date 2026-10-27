import { useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { TextField } from "./fields.jsx";
import { fill } from "../../i18n/weddingConfigurator.js";
import {
  trackCallbackEnquiry,
  weddingEnquiryTracked,
  markWeddingEnquiryTracked,
  trackEnquirySubmitted,
} from "../../lib/metaPixel.js";

// The quick callback on step 1: a name and a phone, for a couple who would
// rather talk than click through four steps (the menu step alone is several
// screens on a phone). Optional — the configurator carries on below it.
//
// Same backend as the /events enquiry: the Formspree form behind
// VITE_FORMSPREE_ENDPOINT, with `kind: quick_callback` so the hotel can tell
// it from a full configuration. The configurator's own honeypot (`website`)
// is reused: a bot that fills it is shown success, and nothing is sent or
// counted. EventEnquiry fires only when Formspree confirms, once per visit.

const FORMSPREE_ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT || "";

export default function QuickCallback({ s, lang, phone, config, update, standard, children }) {
  const c = s.callback;
  const [name, setName] = useState("");
  const [tel, setTel] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  // Set before the first await: a double tap sends once.
  const busy = useRef(false);

  async function onSubmit(event) {
    event.preventDefault();
    if (status === "sending" || busy.current) return;
    const found = {};
    if (name.trim().length < 2) found.name = s.contact.errRequired;
    const digits = tel.replace(/\D+/g, "");
    if (digits.length < 6 || digits.length > 15) found.phone = s.contact.errPhone;
    setErrors(found);
    if (Object.keys(found).length) return;

    if (config.website) {
      setStatus("sent");
      return;
    }
    if (!FORMSPREE_ENDPOINT) {
      setStatus("error");
      return;
    }
    busy.current = true;
    setStatus("sending");
    try {
      const data = new FormData();
      data.append("_subject", "Обратно обаждане – сватбен конфигуратор");
      data.append("kind", "quick_callback");
      data.append("name", name.trim());
      data.append("phone", tel.trim());
      data.append("event_type", "Сватба");
      // What the couple had already chosen, if anything — helps the call.
      if (config.date.mode === "date" && config.date.date) data.append("date", config.date.date);
      if (config.date.mode === "period" && config.date.period) data.append("period", config.date.period);
      if (standard > 0) data.append("guests", String(standard + children));
      data.append("page", `${window.location.pathname}${window.location.search}`);
      data.append("lang", lang);
      data.append("_gotcha", config.website || "");

      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Formspree ${res.status}`);
      setStatus("sent");
      // Formspree confirmed. One EventEnquiry per visit: if the full form
      // already counted, this one does not.
      if (!weddingEnquiryTracked()) {
        trackCallbackEnquiry();
        markWeddingEnquiryTracked();
      }
      trackEnquirySubmitted({ source: "configurator_callback", event_type: "wedding" });
    } catch (err) {
      busy.current = false;
      console.error("[wedding callback]", err);
      setStatus("error");
    }
  }

  return (
    <section
      data-quick-callback
      className="border border-gold-300/20 bg-ink-900/50 p-5 sm:p-6 rounded-sm"
    >
      <p className="font-display text-xl text-cream-50 flex items-center gap-3">
        <PhoneCall className="w-5 h-5 text-gold-300/80 flex-shrink-0" />
        {c.lead}
      </p>
      {status === "sent" ? (
        <p role="status" className="mt-4 text-cream-100/85">
          {c.sent}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-5 space-y-4">
          {/* The configurator's honeypot, shared with step 4. */}
          <div aria-hidden="true" className="hidden">
            <input
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={config.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField
              label={s.contact.name}
              value={name}
              onChange={setName}
              autoComplete="name"
              error={errors.name}
            />
            <TextField
              label={s.contact.phone}
              type="tel"
              value={tel}
              onChange={setTel}
              autoComplete="tel"
              error={errors.phone}
            />
          </div>
          <button
            type="submit"
            disabled={status === "sending"}
            className="btn-gold w-full sm:w-auto min-h-[44px] px-7 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center justify-center gap-3 disabled:opacity-60"
          >
            {status === "sending" ? c.sending : c.submit}
          </button>
          {status === "error" && (
            <p role="alert" className="text-xs text-red-300/90">
              {fill(c.error, { phone })}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
