import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronUp } from "lucide-react";
import { useSeo } from "../hooks/useSeo.js";
import { useSanityQuery } from "../hooks/useSanity.js";
import { weddingStrings, fill } from "../i18n/weddingConfigurator.js";
import { buildQuote, formatMoney, toCount } from "../lib/weddingPricing.js";
import offer from "../../public/api/wedding-offer.json";
import StepDateGuests from "../components/wedding/StepDateGuests.jsx";
import StepMenus from "../components/wedding/StepMenus.jsx";
import StepExtras from "../components/wedding/StepExtras.jsx";
import StepReview from "../components/wedding/StepReview.jsx";
import SummaryPanel from "../components/wedding/SummaryPanel.jsx";

// The offer JSON lives under public/ so the PHP endpoint can read the very
// same file at runtime; importing it here means the page and the server can
// never disagree about prices, menus or terms.

const ENDPOINT = "/api/wedding-enquiry.php";
const STORAGE_KEY = "raya.wedding.config";
const PHONE_QUERY = `*[_type == "siteSettings"][0].phone`;
const FALLBACK_PHONE = "+359 896 100 100";

const emptyConfig = () => ({
  date: { mode: "date", date: "", period: "", time: "" },
  guests: { standard: "", children: "0" },
  menus: { primary: "", mixed: false, allocation: {} },
  childMenus: {},
  dietary: "",
  extras: {},
  requests: {},
  otherWishes: "",
  contact: { name: "", phone: "", email: "", address: "", message: "" },
  consent: false,
  website: "",
});

/**
 * Everything except the contact details survives a reload or a trip through
 * the browser's back button. Names, phones, emails and addresses are held in
 * React state only — keeping a menu choice is no reason to leave someone's
 * personal data in the browser.
 */
function loadStoredConfig() {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    const base = emptyConfig();
    return { ...base, ...saved, contact: base.contact, consent: false, website: "" };
  } catch {
    return null;
  }
}

export default function WeddingConfigurator() {
  const { lang, t } = useOutletContext();
  const s = weddingStrings(lang);
  const { data: phoneFromSanity } = useSanityQuery(PHONE_QUERY);
  const phone = phoneFromSanity || FALLBACK_PHONE;

  const [config, setConfig] = useState(() => loadStoredConfig() || emptyConfig());
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | submitting | sent | error
  const [errorMessage, setErrorMessage] = useState("");
  const [reference, setReference] = useState("");
  const [includedOpen, setIncludedOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const startedAt = useRef(Date.now());
  const topRef = useRef(null);

  useSeo({
    title: s.meta.title,
    description: s.meta.description,
    path: "/svatben-konfigurator",
    lang,
  });

  useEffect(() => {
    try {
      const { contact, consent, website, ...rest } = config;
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    } catch {
      /* storage unavailable (private mode) — the page still works */
    }
  }, [config]);

  const update = useCallback((key, value) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const standard = toCount(config.guests.standard);
  const children = toCount(config.guests.children);

  // Children dropping to zero must not leave their menus (and their charges)
  // behind — the same for menu allocations when the mixed option is off.
  useEffect(() => {
    if (children === 0 && Object.keys(config.childMenus).length > 0) {
      setConfig((prev) => ({ ...prev, childMenus: {} }));
    }
  }, [children, config.childMenus]);

  const quote = useMemo(() => buildQuote(offer, { ...config, standardGuests: standard, children }), [
    config,
    standard,
    children,
  ]);

  const overlap = useMemo(
    () => offer.venueOverlapIds.filter((id) => config.extras[id]?.selected),
    [config.extras]
  );

  // ── Per-step validation ────────────────────────────────────────────
  const validateStep = useCallback(
    (index) => {
      const next = {};
      if (index === 0) {
        if (standard < 1) next.standardGuests = s.date.errStandard;
        if (config.guests.children !== "" && toCount(config.guests.children) < 0) {
          next.children = s.date.errChildren;
        }
        if (config.date.mode === "date" && !config.date.date) next.date = s.date.errDate;
      }
      if (index === 1) {
        if (config.menus.mixed) {
          const sum = Object.values(config.menus.allocation).reduce(
            (acc, n) => acc + toCount(n),
            0
          );
          if (sum !== standard) {
            next.menuAllocation = fill(s.menus.mixedSumError, { n: standard });
          }
        } else if (!config.menus.primary) {
          next.primaryMenu = s.menus.errNoMenu;
        }
        if (children > 0) {
          const sum = Object.values(config.childMenus).reduce((acc, n) => acc + toCount(n), 0);
          if (sum !== children) {
            next.childMenus = fill(s.menus.childSumError, { n: children });
          }
        }
      }
      if (index === 2) {
        for (const extra of offer.extras) {
          const selection = config.extras[extra.id];
          if (!selection?.selected) continue;
          if (extra.unit === "per_person" && toCount(selection.covers) < 1) {
            next[`extra.${extra.id}.covers`] = s.contact.errRequired;
          }
          if (extra.unit === "per_hour" && toCount(selection.hours) < 1) {
            next[`extra.${extra.id}.hours`] = s.contact.errRequired;
          }
          if (extra.cateringChoices && (selection.catering?.length || 0) !== extra.cateringChoices) {
            next[`extra.${extra.id}.catering`] = fill(s.extras.cateringError, {
              max: extra.cateringChoices,
            });
          }
        }
      }
      if (index === 3) {
        const c = config.contact;
        if (c.name.trim().length < 2) next.name = s.contact.errRequired;
        const digits = c.phone.replace(/\D+/g, "");
        if (digits.length < 6 || digits.length > 15) next.phone = s.contact.errPhone;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())) next.email = s.contact.errEmail;
        if (c.address.trim().length < 5) next.address = s.contact.errRequired;
        if (!config.consent) next.consent = s.contact.errConsent;
      }
      return next;
    },
    [config, standard, children, s]
  );

  const goToStep = useCallback((index) => {
    setStep(index);
    setErrors({});
    setSheetOpen(false);
    // Land on the step's heading rather than wherever the previous step
    // happened to be scrolled to.
    window.requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const next = () => {
    const found = validateStep(step);
    setErrors(found);
    if (Object.keys(found).length === 0) goToStep(step + 1);
  };

  // ── Submission ─────────────────────────────────────────────────────
  const stepOfField = (field) => {
    if (["date", "time", "standardGuests", "children"].includes(field)) return 0;
    if (["primaryMenu", "menuAllocation", "childMenus"].includes(field)) return 1;
    if (field.startsWith("extra.") || field === "extras" || field === "requests") return 2;
    return 3;
  };

  const serverFieldMessage = (field, code) => {
    if (field === "standardGuests") return s.date.errStandard;
    if (field === "children") return s.date.errChildren;
    if (field === "date" || field === "time") return s.date.errDate;
    if (field === "primaryMenu") return s.menus.errNoMenu;
    if (field === "menuAllocation") return fill(s.menus.mixedSumError, { n: standard });
    if (field === "childMenus") return fill(s.menus.childSumError, { n: children });
    if (field.endsWith(".catering")) return fill(s.extras.cateringError, { max: 3 });
    if (field === "phone") return s.contact.errPhone;
    if (field === "email") return s.contact.errEmail;
    if (field === "consent") return s.contact.errConsent;
    return code === "required" ? s.contact.errRequired : s.contact.fixErrors;
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (status === "submitting") return; // a second click must not send twice

    const found = validateStep(3);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setStatus("submitting");
    setErrorMessage("");

    const payload = {
      offerVersion: offer.version,
      lang,
      elapsedSeconds: Math.round((Date.now() - startedAt.current) / 1000),
      website: config.website,
      date: {
        mode: config.date.mode,
        date: config.date.date,
        period: config.date.period,
        time: config.date.time,
      },
      guests: { standard, children },
      menus: {
        primary: config.menus.mixed ? "" : config.menus.primary,
        mixed: config.menus.mixed,
        allocation: Object.fromEntries(
          Object.entries(config.menus.allocation)
            .map(([id, n]) => [id, toCount(n)])
            .filter(([, n]) => n > 0)
        ),
      },
      childMenus: Object.fromEntries(
        Object.entries(config.childMenus)
          .map(([id, n]) => [id, toCount(n)])
          .filter(([, n]) => n > 0)
      ),
      dietary: config.dietary,
      extras: Object.fromEntries(
        Object.entries(config.extras)
          .filter(([, sel]) => sel?.selected)
          .map(([id, sel]) => [
            id,
            {
              selected: true,
              covers: toCount(sel.covers) || undefined,
              hours: toCount(sel.hours) || undefined,
              catering: sel.catering || undefined,
              notes: sel.notes || "",
            },
          ])
      ),
      requests: Object.fromEntries(
        Object.entries(config.requests)
          .filter(([, sel]) => sel?.selected)
          .map(([id, sel]) => [
            id,
            {
              selected: true,
              rooms: toCount(sel.rooms),
              guests: toCount(sel.guests),
              nights: toCount(sel.nights),
              notes: sel.notes || "",
            },
          ])
      ),
      otherWishes: config.otherWishes,
      contact: config.contact,
      consent: config.consent,
    };

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body.ok) {
        setReference(body.reference || "");
        setStatus("sent");
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        window.requestAnimationFrame(() => {
          topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return;
      }

      if (res.status === 422 && body.fields) {
        // Everything the guest entered stays put; we only point at the fields.
        const mapped = {};
        for (const [field, code] of Object.entries(body.fields)) {
          mapped[field] = serverFieldMessage(field, code);
        }
        setErrors(mapped);
        setStatus("error");
        setErrorMessage(s.contact.fixErrors);
        const first = Object.keys(body.fields)[0];
        const target = stepOfField(first);
        if (target !== 3) goToStep(target);
        return;
      }

      throw new Error(body.error || `HTTP ${res.status}`);
    } catch (err) {
      // Never claim delivery we cannot see: any non-ok answer keeps the
      // configuration and asks the guest to retry.
      console.error("[wedding-enquiry]", err);
      setStatus("error");
      setErrorMessage(s.contact.errSend);
    }
  };

  const steps = [
    <StepDateGuests
      key="0"
      s={s}
      offer={offer}
      config={config}
      update={update}
      errors={errors}
      includedOpen={includedOpen}
      setIncludedOpen={setIncludedOpen}
    />,
    <StepMenus key="1" s={s} offer={offer} config={config} update={update} errors={errors} />,
    <StepExtras
      key="2"
      s={s}
      offer={offer}
      lang={lang}
      config={config}
      update={update}
      errors={errors}
      overlap={overlap}
    />,
    <StepReview
      key="3"
      s={s}
      t={t}
      offer={offer}
      lang={lang}
      config={config}
      update={update}
      quote={quote}
      overlap={overlap}
      errors={errors}
      status={status}
      errorMessage={errorMessage}
      reference={reference}
      phone={phone}
      onEdit={goToStep}
      onSubmit={onSubmit}
    />,
  ];

  const showMobileBar = step < 3 && status !== "sent";

  return (
    <div className="bg-ink-950 min-h-screen">
      {/* Intro — deliberately short, so step 1 is on screen almost at once. */}
      <section ref={topRef} className="pt-28 md:pt-32 pb-10 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 text-center">
          <span className="text-xs tracking-[0.4em] uppercase text-gold-300/80">
            {s.intro.eyebrow}
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-cream-50 mt-4 text-balance">
            {s.intro.title}
          </h1>
          <p className="text-base lg:text-lg text-cream-100/70 mt-5 max-w-2xl mx-auto font-light leading-relaxed">
            {s.intro.lead}
          </p>
          <div className="divider-gold mt-8 w-32 mx-auto" />
        </div>
      </section>

      {/* Stepper */}
      <nav aria-label={s.nav.step} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-10">
        <ol className="flex flex-wrap gap-x-6 gap-y-3 justify-center border-y border-gold-300/10 py-4">
          {s.steps.map((label, i) => {
            const state = i === step ? "current" : i < step ? "done" : "todo";
            return (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => (i < step ? goToStep(i) : undefined)}
                  aria-current={state === "current" ? "step" : undefined}
                  disabled={i > step || status === "sent"}
                  className={`text-[11px] tracking-[0.2em] uppercase transition-colors inline-flex items-center gap-2 ${
                    state === "current"
                      ? "text-gold-200"
                      : state === "done"
                      ? "text-cream-100/60 hover:text-gold-200"
                      : "text-cream-100/25 cursor-default"
                  }`}
                >
                  <span className="font-mono">{String(i + 1).padStart(2, "0")}</span>
                  {label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div
        className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-10 lg:py-14 ${
          showMobileBar ? "pb-32 lg:pb-14" : ""
        }`}
      >
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Not a <main>: Layout already provides the page landmark. */}
          <div className="lg:col-span-8 min-w-0">{steps[step]}</div>

          {/* Desktop rail — follows the guest down the page. */}
          <aside className="hidden lg:block lg:col-span-4 sticky top-28">
            <div className="border border-gold-300/15 bg-ink-900/60 p-6">
              <SummaryPanel
                s={s}
                offer={offer}
                lang={lang}
                config={config}
                quote={quote}
                overlap={overlap}
                onEdit={status === "sent" ? undefined : goToStep}
              />
            </div>
          </aside>
        </div>

        {status !== "sent" && (
          <div className="flex items-center justify-between gap-4 mt-10 lg:mt-14 lg:w-2/3">
            <button
              type="button"
              onClick={() => goToStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="btn-ghost px-7 py-3.5 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="w-4 h-4" />
              {s.nav.back}
            </button>
            {step < 3 && (
              <button
                type="button"
                onClick={next}
                className="btn-gold px-8 py-3.5 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3"
              >
                {s.nav.next}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mobile: a compact total that expands, hidden on the final step so it
          can never cover the contact fields or the submit button. */}
      {showMobileBar && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-gold-300/20 bg-ink-950/95 backdrop-blur">
          {sheetOpen && (
            <div className="max-h-[60vh] overflow-y-auto px-5 py-5 border-b border-gold-300/10">
              <SummaryPanel
                s={s}
                offer={offer}
                lang={lang}
                config={config}
                quote={quote}
                overlap={overlap}
                onEdit={goToStep}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              onClick={() => setSheetOpen(!sheetOpen)}
              aria-expanded={sheetOpen}
              className="text-left min-w-0"
            >
              <div className="text-[10px] tracking-[0.2em] uppercase text-gold-300/70">
                {s.summary.estimate}
              </div>
              <div className="font-display text-lg text-cream-50 leading-tight truncate">
                {quote.standardGuests > 0
                  ? quote.isRange
                    ? `${formatMoney(quote.minTotalCents, lang)} – ${formatMoney(
                        quote.maxTotalCents,
                        lang
                      )}`
                    : formatMoney(quote.maxTotalCents, lang)
                  : "—"}
              </div>
              <div className="text-[10px] tracking-[0.15em] uppercase text-gold-300/60 inline-flex items-center gap-1">
                {sheetOpen ? s.summary.close : s.summary.open}
                <ChevronUp
                  className={`w-3 h-3 transition-transform ${sheetOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>
            <button
              type="button"
              onClick={next}
              className="btn-gold px-6 py-3 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-2 shrink-0"
            >
              {s.nav.next}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
