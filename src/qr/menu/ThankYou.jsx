import { useEffect, useState } from "react";
import { fill } from "./strings.js";
import { money } from "../shared/format.js";
import { api } from "../shared/api.js";
import { myBillTokens } from "./BillSheet.jsx";

// Back from Stripe's page after paying: a whole screen that says thank you,
// with a way back to the menu. Coming back proves nothing by itself, so it
// first waits for the server — which only believes Stripe's signed
// confirmation — and says so: "Потвърждаваме плащането…". If that takes
// more than two minutes it says where the payment will show up instead.
//
//   kind "order": an order paid before it went to the kitchen (its status
//                 comes from the menu page's own polling, as `order`)
//   kind "bill":  a payment from the table's bill (polled here)

const SLOW_MS = 120000;

export default function ThankYou({ t, lang, kind, code, table, since, order, onMenu, onOrders, onBill }) {
  const [bill, setBill] = useState(null);
  const [, tick] = useState(0);
  const payment = bill?.payments?.find((p) => p.code === code);
  const billDone = kind === "bill" && payment && payment.status !== "pending";

  useEffect(() => {
    if (kind !== "bill" || billDone || !table) return undefined;
    let stopped = false;
    const load = async () => {
      try {
        const tokens = myBillTokens().join(",");
        const res = await api(`bill.php?table=${table}${tokens ? `&t=${tokens}` : ""}`);
        if (!stopped && res.ok) setBill(res);
      } catch {
        /* the next round tries again */
      }
    };
    load();
    const timer = setInterval(load, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [kind, table, billDone]);

  // A screen of its own: the menu underneath stays put; Escape goes back to it.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onMenu();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onMenu]);

  // Re-render when the wait counts as slow.
  useEffect(() => {
    const left = since + SLOW_MS - Date.now();
    if (left <= 0) return undefined;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [since]);

  let state = "waiting";
  if (kind === "order" && order?.status && order.status !== "pending_payment") state = order.status === "expired" ? "failed" : "paid";
  if (kind === "bill" && payment) state = payment.status === "paid" ? "paid" : payment.status === "pending" ? "waiting" : "failed";
  const slow = state === "waiting" && Date.now() - since >= SLOW_MS;

  const amount = kind === "order" ? (order?.orderedTotal ?? order?.total) + (order?.tip || 0) : payment ? payment.amount + payment.tip : null;
  const tipPaid = kind === "order" ? order?.tip || 0 : payment?.tip || 0;
  // The e-receipt for the payment, once the server has issued it (see
  // public/api/qr/_lib/ereceipt.php); it is e-mailed as well.
  const receiptUrl = kind === "order" ? order?.receiptUrl : payment?.receiptUrl;
  const left = bill?.bill?.totals?.unpaid;

  return (
    <div className="fixed inset-0 z-50 bg-ink-950 overflow-y-auto" role="dialog" aria-modal="true" aria-label={state === "paid" ? t.thanksTitle : t.confirmingPayment} data-thanks={state}>
      <div className="min-h-full max-w-md mx-auto px-6 py-12 flex flex-col items-center justify-center text-center">
        <img src="/img/logo.png" alt="" width="56" height="56" className="w-14 h-14 mb-8 opacity-90" />
        {state === "waiting" && (
          <>
            {!slow && <div className="w-12 h-12 rounded-full border-2 border-gold-300/30 border-t-gold-200 animate-spin" aria-hidden="true" />}
            <h1 className="font-display text-3xl text-cream-50 mt-6">{t.confirmingPayment}</h1>
            <p className="text-cream-100/70 mt-3" aria-live="polite">{slow ? (kind === "bill" ? t.thanksSlowBill : t.thanksSlowOrder) : t.thanksWaitingLead}</p>
          </>
        )}
        {state === "paid" && (
          <>
            <div className="w-16 h-16 rounded-full bg-sage-500/25 border border-sage-300/50 flex items-center justify-center text-3xl text-sage-100" aria-hidden="true">
              ✓
            </div>
            <h1 className="font-display text-4xl text-cream-50 mt-6">{t.thanksTitle}</h1>
            <p className="text-cream-100/80 mt-3 leading-relaxed">
              {kind === "order" ? fill(t.thanksOrder, { n: order?.table ?? table }) : t.thanksBill}
            </p>
            <dl className="mt-6 w-full border border-gold-300/20 rounded-sm divide-y divide-gold-300/10 text-left">
              <div className="flex justify-between gap-4 px-4 py-3">
                <dt className="text-cream-100/60">{t.code}</dt>
                <dd className="font-sans font-semibold tracking-wider text-cream-50">{code}</dd>
              </div>
              {amount != null && (
                <div className="flex justify-between gap-4 px-4 py-3">
                  <dt className="text-cream-100/60">{t.thanksPaid}</dt>
                  <dd className="text-cream-50">
                    {money(amount, lang)}
                    {tipPaid > 0 && <span className="block text-xs text-cream-100/50">{fill(t.paymentTip, { amount: money(tipPaid, lang) })}</span>}
                  </dd>
                </div>
              )}
              {kind === "bill" && left != null && (
                <div className="px-4 py-3 text-sm text-cream-100/70">{left > 0 ? fill(t.thanksBillLeft, { amount: money(left, lang) }) : t.thanksBillDone}</div>
              )}
            </dl>
            {receiptUrl && (
              <p className="mt-4 text-sm text-cream-100/60 leading-relaxed" data-receipt>
                <a href={receiptUrl} target="_blank" rel="noopener noreferrer" className="text-gold-200 underline underline-offset-4">
                  {t.receiptLink}
                </a>
                <span className="block mt-1">{t.receiptEmailed}</span>
              </p>
            )}
          </>
        )}
        {state === "failed" && (
          <>
            <h1 className="font-display text-3xl text-cream-50">{t.thanksFailedTitle}</h1>
            <p className="text-cream-100/70 mt-3">{kind === "bill" ? t.billUnpaidReturn : t.unpaidReturn}</p>
          </>
        )}

        <button type="button" onClick={onMenu} className="btn-gold w-full mt-8 py-4 rounded-sm text-sm tracking-[0.15em] uppercase font-medium">
          {t.backToMenu}
        </button>
        {(kind === "bill" ? onBill : onOrders) && (
          <button type="button" onClick={kind === "bill" ? onBill : onOrders} className="mt-3 w-full py-3 text-sm text-gold-200 underline underline-offset-4">
            {kind === "bill" ? t.bill : t.myOrders}
          </button>
        )}
      </div>
    </div>
  );
}
