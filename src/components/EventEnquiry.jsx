import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Phone } from "lucide-react";
import { Field, TextField, CheckBox, inputClass } from "./wedding/fields.jsx";
import { trackMeta } from "../lib/metaPixel.js";
import { translations } from "../translations.js";

// The short enquiry form under the /events hero — for the visitor who came
// from an ad, knows roughly what they want, and will not dig through the
// brochures below to find a phone number.
//
// Same backend as /contact: the Formspree form behind VITE_FORMSPREE_ENDPOINT,
// which delivers to hotel@svetagora.bg. The email is always in Bulgarian —
// labels, values and the subject — whatever language the visitor read the
// page in, because the people answering it read Bulgarian.
//
// Validation is the browser's own (required fields), as on /contact: an
// incomplete form never fires a submit event at all, so it can never reach
// the Lead below.

const FORMSPREE_ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT || "";
const PHONE_HREF = "tel:+359896100100";

const TYPE_CODES = ["corporate", "wedding", "birthday", "other"];
const GUEST_CODES = ["lt20", "20-50", "50-100", "gt100"];
const LOCALE = { bg: "bg-BG", en: "en-GB", ro: "ro-RO" };

/**
 * The current month and the five after it, as {value: "2026-09", label}.
 * Labels come from Intl rather than a hand-kept list, capitalised, with the
 * year appended plainly — Intl's Bulgarian adds a "г." we do not want here.
 */
function nextSixMonths(lang, from = new Date()) {
  const fmt = new Intl.DateTimeFormat(LOCALE[lang] || LOCALE.bg, { month: "long" });
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const name = fmt.format(d);
    return {
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${name.charAt(0).toUpperCase()}${name.slice(1)} ${d.getFullYear()}`,
    };
  });
}

function SelectField({ label, value, onChange, children }) {
  return (
    <Field label={label}>
      {(props) => (
        <select
          {...props}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} [color-scheme:dark] cursor-pointer`}
        >
          {children}
        </select>
      )}
    </Field>
  );
}

export default function EventEnquiry({ t, lang, corporate = false }) {
  const s = t.pages.events.enquiry;
  const bg = translations.bg.pages.events.enquiry;
  const months = useMemo(() => nextSixMonths(lang), [lang]);
  const bgMonths = useMemo(() => nextSixMonths("bg"), []);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    // Preselected only for the corporate ad; everyone else chooses.
    type: corporate ? "corporate" : "",
    guests: "",
    month: "",
    consent: false,
  });
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const honeypot = useRef(null);
  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e) {
    e.preventDefault();
    if (status === "sending") return;

    // A bot filled the hidden field: look successful, send nothing, count
    // nothing.
    if (honeypot.current?.value) {
      setStatus("sent");
      return;
    }
    if (!FORMSPREE_ENDPOINT) {
      setStatus("error");
      return;
    }

    setStatus("sending");
    const typeBg = bg.types[form.type];
    const monthBg =
      form.month === "unknown"
        ? bg.monthUnknown
        : bgMonths.find((m) => m.value === form.month)?.label || form.month;

    try {
      const data = new FormData();
      // Field names in English, values in Bulgarian — the exact shape /contact
      // has always sent this Formspree form, so nothing here is untried.
      data.append("_subject", `Запитване за събитие – ${typeBg}`);
      data.append("name", form.name);
      data.append("phone", form.phone);
      data.append("event_type", typeBg);
      data.append("guests", bg.guestOptions[form.guests]);
      data.append("month", monthBg);
      data.append("consent", "Да — https://rayagarden.bg/privacy-policy");
      data.append("page", `${window.location.pathname}${window.location.search}`);
      data.append("lang", lang);

      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Formspree ${res.status}`);

      setStatus("sent");
      // Here and nowhere else: Formspree confirmed. A click, a browser
      // validation stop, a refusal or a network failure never gets here.
      trackMeta("Lead", {
        content_name: "Events enquiry form",
        content_category: "events",
        event_type: form.type,
        lang,
      });
    } catch (err) {
      console.error("[events enquiry]", err);
      setStatus("error");
    }
  }

  return (
    <section id="enquiry" className="bg-ink-950 px-6 pt-8 pb-14 lg:pt-14 lg:pb-20 scroll-mt-24">
      <div className="max-w-6xl mx-auto grid gap-8 lg:grid-cols-[1fr_1.5fr] lg:gap-14 items-start">
        <div>
          <h2 className="font-display text-3xl md:text-4xl text-cream-50 leading-tight">
            {s.title}
          </h2>
          <p className="text-cream-100/70 mt-3 leading-relaxed">{s.lead}</p>
          <a
            href={PHONE_HREF}
            className="btn-gold mt-6 w-full sm:w-auto px-8 py-4 text-xs tracking-[0.25em] uppercase font-medium rounded-sm inline-flex items-center justify-center gap-3"
          >
            <Phone className="w-4 h-4" />
            {s.call}
          </a>
        </div>

        {/* EnquiryBar watches this box — the form, or what replaces it once
            sent — to know when to step aside. */}
        <div id="enquiry-form">
          {status === "sent" ? (
            <div
              role="status"
              className="border border-gold-300/20 bg-ink-900/60 px-6 py-10 text-center rounded-sm"
            >
              <div className="font-display text-3xl text-gold-300 mb-3">✓</div>
              <p className="text-cream-100/85">{s.sent}</p>
            </div>
          ) : (
            <form
              onSubmit={onSubmit}
              className="border border-gold-300/15 bg-ink-900/40 p-5 sm:p-7 rounded-sm space-y-5"
            >
              {/* honeypot — bots fill this, humans never see it */}
              <input
                ref={honeypot}
                type="text"
                name="_gotcha"
                tabIndex={-1}
                autoComplete="off"
                className="hidden"
                aria-hidden="true"
              />
              <div className="grid sm:grid-cols-2 gap-5">
                <TextField
                  label={s.name}
                  value={form.name}
                  onChange={set("name")}
                  autoComplete="name"
                  required
                />
                <TextField
                  label={s.phone}
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  autoComplete="tel"
                  required
                />
                <SelectField label={s.type} value={form.type} onChange={set("type")}>
                  <option value="" disabled>
                    {s.choose}
                  </option>
                  {TYPE_CODES.map((code) => (
                    <option key={code} value={code}>
                      {s.types[code]}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={s.guests} value={form.guests} onChange={set("guests")}>
                  <option value="" disabled>
                    {s.choose}
                  </option>
                  {GUEST_CODES.map((code) => (
                    <option key={code} value={code}>
                      {s.guestOptions[code]}
                    </option>
                  ))}
                </SelectField>
                <SelectField label={s.month} value={form.month} onChange={set("month")}>
                  <option value="" disabled>
                    {s.choose}
                  </option>
                  {months.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                  <option value="unknown">{s.monthUnknown}</option>
                </SelectField>
              </div>

              <CheckBox checked={form.consent} onChange={set("consent")} required>
                {s.consent}{" "}
                <Link to="/privacy-policy" className="text-gold-200 link-underline">
                  {t.footer.links.privacy}
                </Link>
                .
              </CheckBox>

              {status === "error" && (
                <p role="alert" className="text-sm text-red-300/90">
                  {s.error}
                </p>
              )}

              <button
                type="submit"
                disabled={status === "sending"}
                className="btn-gold w-full sm:w-auto px-10 py-4 text-xs tracking-[0.3em] uppercase font-medium rounded-sm disabled:opacity-60"
              >
                {status === "sending" ? s.sending : s.submit}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
