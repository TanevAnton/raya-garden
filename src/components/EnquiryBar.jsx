import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone, Send } from "lucide-react";

// The phone-only bar pinned to the bottom of /events and every /event/* page:
// call, or jump to the enquiry form. Hidden from md: up, where the page's own
// buttons are never more than a glance away.
//
// "Запитване" scrolls to #enquiry when the page has it (/events). The event
// pages have no form of their own, so there it opens the /events form — the
// same form, reached in one tap, rather than a second copy to keep in step.
//
// On /events the bar steps aside while the form is on screen, so it never
// sits on top of the submit button it is pointing at.
//
// The phone link needs no tracking of its own: Layout's delegated listener
// already sends Contact for every tel: link, with the page's category.

const PHONE_HREF = "tel:+359896100100";

export default function EnquiryBar({ t, lang }) {
  const s = t.pages.events.enquiry;
  const navigate = useNavigate();
  const [formInView, setFormInView] = useState(false);

  // Reserve the bar's height at the foot of the page, so the footer's last
  // line is never under it. Mobile only, via the media query in index.css.
  useEffect(() => {
    document.body.classList.add("has-enquiry-bar");
    return () => document.body.classList.remove("has-enquiry-bar");
  }, []);

  useEffect(() => {
    const target = document.getElementById("enquiry");
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setFormInView(entry.isIntersecting),
      { threshold: 0.2 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const toEnquiry = () => {
    const target = document.getElementById("enquiry");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    navigate({ pathname: "/events", search: `?lang=${lang}`, hash: "#enquiry" });
  };

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-40 bg-ink-950/95 backdrop-blur border-t border-gold-300/15 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] transition-transform duration-300 ${
        formInView ? "translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="grid grid-cols-2 gap-3">
        <a
          href={PHONE_HREF}
          className="inline-flex items-center justify-center gap-2 border border-gold-300/40 text-gold-200 py-3 text-xs tracking-[0.25em] uppercase rounded-sm"
        >
          <Phone className="w-4 h-4" />
          {s.barCall}
        </a>
        <button
          type="button"
          onClick={toEnquiry}
          className="btn-gold inline-flex items-center justify-center gap-2 py-3 text-xs tracking-[0.25em] uppercase font-medium rounded-sm"
        >
          <Send className="w-4 h-4" />
          {s.barEnquire}
        </button>
      </div>
    </div>
  );
}
