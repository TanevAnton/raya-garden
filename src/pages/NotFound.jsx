import { Link, useOutletContext } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useSeo } from "../hooks/useSeo.js";

export default function NotFound() {
  const { lang, t } = useOutletContext();
  const isEn = lang === "en";

  useSeo({
    title: isEn ? "Page not found" : "Страницата не е намерена",
    description: isEn
      ? "The page you're looking for doesn't exist."
      : "Страницата, която търсите, не съществува.",
    path: "/404",
    lang,
  });

  return (
    <section className="min-h-[80vh] flex items-center justify-center bg-ink-950 px-6 py-32">
      <div className="max-w-xl text-center">
        <div className="font-display text-[10rem] leading-none gradient-gold">404</div>
        <div className="divider-gold w-32 mx-auto my-8" />
        <h1 className="font-display text-3xl md:text-4xl text-cream-50 mb-4 text-balance">
          {isEn ? "We can't find that page" : "Тази страница не съществува"}
        </h1>
        <p className="text-cream-100/70 mb-10 leading-relaxed">
          {isEn
            ? "The link may be broken or the page may have been moved. Let us point you somewhere lovely."
            : "Връзката може да е невалидна или страницата да е преместена. Нека Ви насочим към нещо хубаво."}
        </p>
        <Link
          to="/"
          className="btn-gold inline-flex items-center gap-3 px-8 py-4 text-xs tracking-[0.3em] uppercase rounded-sm"
        >
          {t.nav.home}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </section>
  );
}
