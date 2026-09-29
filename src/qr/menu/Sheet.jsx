import { useEffect } from "react";

/** A bottom sheet on phones, a centred dialog on wider screens. Escape or a tap outside closes it. */
export default function Sheet({ title, onClose, closeLabel, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={closeLabel} onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-ink-900 border-t sm:border border-gold-300/20 rounded-t-lg sm:rounded-lg px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="font-display text-2xl text-cream-50">{title}</h2>
          <button type="button" onClick={onClose} className="text-cream-100/60 text-sm underline underline-offset-4 shrink-0 h-10">{closeLabel}</button>
        </div>
        {children}
      </div>
    </div>
  );
}
