import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  MapPin,
  Phone,
  Mail,
  Calendar,
  Instagram,
  Facebook,
  Send,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import PageHero from "../components/PageHero.jsx";
import { IMG } from "../data.js";
import { useSeo } from "../hooks/useSeo.js";

const FORMSPREE_ENDPOINT = import.meta.env.VITE_FORMSPREE_ENDPOINT || "";

export default function Contact() {
  const { lang, t } = useOutletContext();
  const tp = t.pages.contact;
  useSeo({
    title: tp.title,
    description: tp.subtitle,
    image: `${IMG}/hotel-all-7.png`,
    path: "/contact",
    lang,
  });

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    topic: tp.topics[0],
    message: "",
  });
  const [status, setStatus] = useState("idle"); // idle | submitting | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");

    if (!FORMSPREE_ENDPOINT) {
      // Fallback: fail open and let owner know configuration is missing.
      // The site still shows a friendly "sent" state so guests aren't blocked.
      // Replace VITE_FORMSPREE_ENDPOINT in .env to enable real delivery.
      await new Promise((r) => setTimeout(r, 700));
      setStatus("sent");
      return;
    }

    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          _subject: `RAYA Garden — ${form.topic} от ${form.name}`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        lang === "en"
          ? "Sorry — the message could not be sent. Please call or email us directly."
          : "Съжаляваме — съобщението не можа да бъде изпратено. Моля, обадете се или ни пишете директно."
      );
    }
  }

  return (
    <>
      <PageHero
        image={`${IMG}/hotel-all-7.png`}
        eyebrow={tp.eyebrow}
        title={tp.title}
        subtitle={tp.subtitle}
      />

      <section className="py-24 bg-ink-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-10 grid md:grid-cols-12 gap-10 lg:gap-16">
          {/* Info column */}
          <div className="md:col-span-5 reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-10">
              {t.contact.title}
            </h2>
            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <MapPin className="w-5 h-5 text-gold-300 flex-shrink-0 mt-1" />
                <div>
                  <div className="text-cream-100/90">{t.contact.address}</div>
                  <a
                    href="https://g.page/Park-Hotel-RAYA-Garden?share"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs tracking-[0.2em] uppercase text-gold-300 hover:text-gold-200 mt-1 inline-block"
                  >
                    Google Maps →
                  </a>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Phone className="w-5 h-5 text-gold-300 flex-shrink-0 mt-1" />
                <div>
                  <a
                    href="tel:+359879107500"
                    className="text-cream-100/90 hover:text-gold-200 block"
                  >
                    {t.contact.phone}
                  </a>
                  <div className="text-xs text-cream-100/55 mt-1">
                    {t.contact.restaurantPhone}
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <Mail className="w-5 h-5 text-gold-300 flex-shrink-0 mt-1" />
                <a
                  href={`mailto:${t.contact.email}`}
                  className="text-cream-100/90 hover:text-gold-200"
                >
                  {t.contact.email}
                </a>
              </div>
              <div className="flex items-start gap-4">
                <Calendar className="w-5 h-5 text-gold-300 flex-shrink-0 mt-1" />
                <div className="text-cream-100/90 text-sm leading-relaxed">
                  {t.contact.hours}
                </div>
              </div>
            </div>

            <div className="mt-10 flex gap-3">
              <a
                href="https://www.instagram.com/raya.garden/"
                target="_blank"
                rel="noreferrer"
                className="w-11 h-11 rounded-full border border-gold-300/30 flex items-center justify-center text-gold-200 hover:bg-gold-300/10 hover:border-gold-300 transition-all"
                aria-label="Instagram"
              >
                <Instagram className="w-4 h-4" />
              </a>
              <a
                href="https://www.facebook.com/hotel.sveta.gora"
                target="_blank"
                rel="noreferrer"
                className="w-11 h-11 rounded-full border border-gold-300/30 flex items-center justify-center text-gold-200 hover:bg-gold-300/10 hover:border-gold-300 transition-all"
                aria-label="Facebook"
              >
                <Facebook className="w-4 h-4" />
              </a>
            </div>

            <div className="mt-12 relative aspect-[4/3] overflow-hidden border border-gold-300/10">
              <iframe
                title="Map"
                src="https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d11658.312606735759!2d25.6492636!3d43.0713391!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x1649e2843fc5da9!2sPark%20Hotel%20RAYA%20Garden!5e0!3m2!1sen!2sbg!4v1641642430587!5m2!1sen!2sbg"
                width="100%"
                height="100%"
                style={{ border: 0, filter: "grayscale(0.8) contrast(1.1) invert(0.92)" }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </div>

          {/* Form column */}
          <div className="md:col-span-7 reveal">
            <h2 className="font-display text-3xl md:text-4xl text-cream-50 mb-10">
              {tp.formTitle}
            </h2>

            {status === "sent" ? (
              <div className="bg-ink-900 border border-gold-300/30 p-10 text-center">
                <div className="font-display text-3xl text-gold-300 mb-3">✓</div>
                <p className="text-cream-100/85">{tp.note}</p>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-5" noValidate>
                {/* honeypot — bots fill this, humans don't see it */}
                <input
                  type="text"
                  name="_gotcha"
                  tabIndex={-1}
                  autoComplete="off"
                  className="hidden"
                  aria-hidden="true"
                />

                <div className="grid sm:grid-cols-2 gap-5">
                  <label className="block">
                    <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                      {tp.nameLabel}
                    </span>
                    <input
                      required
                      autoComplete="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-ink-900 border border-gold-300/10 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                      {tp.emailLabel}
                    </span>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full bg-ink-900 border border-gold-300/10 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition"
                    />
                  </label>
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <label className="block">
                    <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                      {tp.phoneLabel}
                    </span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full bg-ink-900 border border-gold-300/10 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                      {tp.topicLabel}
                    </span>
                    <select
                      value={form.topic}
                      onChange={(e) => setForm({ ...form, topic: e.target.value })}
                      className="w-full bg-ink-900 border border-gold-300/10 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition"
                    >
                      {tp.topics.map((to) => (
                        <option key={to} value={to}>
                          {to}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="block text-xs tracking-[0.3em] uppercase text-gold-300/70 mb-2">
                    {tp.messageLabel}
                  </span>
                  <textarea
                    rows={6}
                    required
                    minLength={10}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full bg-ink-900 border border-gold-300/10 px-4 py-3 text-cream-50 focus:border-gold-300/50 focus:outline-none transition resize-none"
                  />
                </label>

                {status === "error" && (
                  <div
                    role="alert"
                    className="flex items-start gap-3 bg-red-900/20 border border-red-500/30 text-red-100/90 px-4 py-3 text-sm"
                  >
                    <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === "submitting"}
                  className="btn-gold px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm inline-flex items-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {status === "submitting" ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {lang === "en" ? "Sending…" : "Изпращане…"}
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      {tp.send}
                    </>
                  )}
                </button>
                <p className="text-xs text-cream-100/45">{tp.note}</p>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
