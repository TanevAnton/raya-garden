import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fill } from "./strings.js";
import { money } from "../shared/format.js";
import { api, newIdempotencyKey, session } from "../shared/api.js";
import Sheet from "./Sheet.jsx";

// The table's bill, on a "pay at the end" evening: every line ordered for
// this table tonight, from every phone. The guest ticks what they are paying
// for — all of it, only their own, any mix — and pays on Stripe's page.
//
// Lines are named by order code and line number. "Yours" means ordered from
// this phone (its own order codes). Nothing is reserved while someone pays:
// a line another phone is paying for right now says so, and if two people
// do pay for the same line, the second gets that share back automatically.
// The server has the last word on what is paid; this sheet polls it.

const key = (l) => `${l.code}:${l.line}`;
const BILLS = "raya.qr.bills"; // this phone's bill payments: [{ token, code }]

export default function BillSheet({ t, lang, table, myCodes, returned, onClose, onOrders }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const attempt = useRef({ key: null, sig: null });
  const touched = useRef(false);

  const refresh = useCallback(async () => {
    if (!table) return;
    try {
      const tokens = session.get(BILLS, []).map((p) => p.token).join(",");
      const res = await api(`bill.php?table=${table}${tokens ? `&t=${tokens}` : ""}`);
      if (res.ok) {
        setData(res);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [table]);

  // Every 5 s while open; every 2 s for two minutes after coming back from paying.
  useEffect(() => {
    refresh();
    const eager = returned && Date.now() - returned.at < 120000;
    const timer = setInterval(refresh, eager ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [refresh, returned]);

  const lines = useMemo(() => data?.bill?.lines || [], [data]);
  const payable = useMemo(() => lines.filter((l) => l.state === "unpaid" || l.state === "pending"), [lines]);
  const mine = (l) => myCodes.has(l.code);

  // First look: tick this phone's own unpaid lines, until the guest changes it.
  useEffect(() => {
    if (touched.current || !data) return;
    setPicked(new Set(payable.filter(mine).map(key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  // Lines paid or cancelled since drop out of the choice.
  useEffect(() => {
    setPicked((prev) => {
      const still = new Set(payable.map(key));
      const next = new Set([...prev].filter((k) => still.has(k)));
      return next.size === prev.size ? prev : next;
    });
  }, [payable]);

  const choose = (next) => {
    touched.current = true;
    setProblem(null);
    setPicked(next);
  };
  const toggle = (l) => {
    const next = new Set(picked);
    if (next.has(key(l))) next.delete(key(l));
    else next.add(key(l));
    choose(next);
  };
  const selected = payable.filter((l) => picked.has(key(l)));
  const amount = selected.reduce((s, l) => s + l.amount, 0);

  async function pay() {
    if (!selected.length || busy) return;
    const items = selected.map((l) => ({ code: l.code, line: l.line }));
    const sig = JSON.stringify([table, items]);
    if (attempt.current.sig !== sig) attempt.current = { key: newIdempotencyKey(), sig };
    setBusy(true);
    setProblem(null);
    try {
      const res = await api("bill-pay.php", { method: "POST", body: { table, lang, items, expectedAmount: amount }, headers: { "Idempotency-Key": attempt.current.key } });
      if (res.ok && res.checkoutUrl) {
        session.set(BILLS, [...session.get(BILLS, []).filter((p) => p.token !== res.token), { token: res.token, code: res.payment.code }]);
        window.location.assign(res.checkoutUrl);
        return;
      }
      if (res.error === "changed") {
        attempt.current = { key: null, sig: null };
        setData((d) => ({ ...(d || {}), bill: res.bill }));
        setProblem(t.billChanged);
      } else if (res.error === "payment_unavailable") setProblem(t.paymentUnavailable);
      else if (res.error === "rate_limited") setProblem(t.rateLimited);
      else {
        attempt.current = { key: null, sig: null };
        setProblem(t.error);
      }
      setBusy(false);
      refresh();
    } catch {
      setProblem(t.network);
      setBusy(false);
    }
  }

  const totals = data?.bill?.totals;
  const myPayments = data?.payments || [];
  const backedOut = returned?.kind === "billunpaid" ? myPayments.find((p) => p.code === returned.code) : null;

  return (
    <Sheet title={table ? fill(t.billTitle, { n: table }) : t.bill} onClose={onClose} closeLabel={t.close}>
      {!table ? (
        <p className="text-cream-100/70">{t.billNoTable}</p>
      ) : failed && !data ? (
        <p role="alert" className="text-sm text-red-300">{t.network}</p>
      ) : !data ? (
        <div className="h-24 animate-pulse bg-ink-950 rounded-sm" aria-hidden="true" />
      ) : (
        <>
          {backedOut && backedOut.status !== "paid" && <p role="status" className="border border-gold-300/25 bg-ink-950 rounded-sm px-4 py-3 text-sm text-cream-50 mb-4">{t.billUnpaidReturn}</p>}
          {myPayments.length > 0 && (
            <div className="mb-5">
              <div className="text-[10px] tracking-[0.25em] uppercase text-cream-100/50 mb-2">{t.myPayments}</div>
              <ul className="space-y-2">
                {myPayments.map((p) => (
                  <li key={p.token} className="border border-gold-300/20 rounded-sm px-3 py-2 text-sm" data-payment={p.code}>
                    <div className="flex justify-between gap-3">
                      <span className={p.status === "paid" ? "text-sage-200" : p.status === "pending" ? "text-gold-200" : "text-cream-100/50"}>
                        {p.status === "pending" && returned?.kind === "billpaid" && returned.code === p.code ? t.confirmingPayment : t.paymentStatus[p.status]}
                      </span>
                      <span className="text-cream-50">{money(p.amount, lang)}</span>
                    </div>
                    {p.refunded > 0 && <p className="text-xs text-gold-200 mt-1">{fill(t.paymentRefunded, { amount: money(p.refunded, lang) })}</p>}
                    {p.status === "pending" && p.payUrl && (
                      <a href={p.payUrl} className="inline-block mt-1 text-xs text-gold-200 underline underline-offset-4">{t.resumePayment}</a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="text-cream-100/60 py-4">{t.billEmpty}</p>
          ) : (
            <>
              <p className="text-sm text-cream-100/60">{t.billLead}</p>
              {payable.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  <button type="button" onClick={() => choose(new Set(payable.map(key)))} className="h-10 px-3 rounded-full text-xs border border-gold-300/40 text-gold-100">{t.selectAll}</button>
                  {payable.some(mine) && (
                    <button type="button" onClick={() => choose(new Set(payable.filter(mine).map(key)))} className="h-10 px-3 rounded-full text-xs border border-gold-300/40 text-gold-100">{t.selectMine}</button>
                  )}
                  {picked.size > 0 && (
                    <button type="button" onClick={() => choose(new Set())} className="h-10 px-3 rounded-full text-xs border border-gold-300/20 text-cream-100/60">{t.clearSelection}</button>
                  )}
                </div>
              )}
              <ul className="divide-y divide-gold-300/10 mt-3">
                {lines.map((l) => {
                  const canPay = l.state === "unpaid" || l.state === "pending";
                  const name = lang === "en" ? l.nameEn : l.nameBg;
                  const detail = lang === "en" ? l.detailEn : l.detailBg;
                  return (
                    <li key={key(l)} data-line={key(l)}>
                      <label className={`flex items-start gap-3 py-3 ${canPay ? "cursor-pointer" : "opacity-50"}`}>
                        <input
                          type="checkbox"
                          disabled={!canPay}
                          checked={canPay && picked.has(key(l))}
                          onChange={() => toggle(l)}
                          className="mt-1 w-5 h-5 shrink-0 accent-[#c69b3b]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-cream-50">
                            {l.qty} × {name}
                            {detail ? <span className="text-cream-100/60"> · {detail}</span> : null}
                          </span>
                          <span className="block text-xs text-cream-100/45 mt-0.5">
                            {l.name && <span className="text-cream-100/80">{l.name} · </span>}
                            {l.code}
                            {mine(l) && <span className="text-gold-200"> · {t.mine}</span>}
                            {l.state === "pending" && <span className="text-gold-200"> · {t.linePending}</span>}
                            {l.state === "online" && <span className="text-sage-200"> · {t.linePaid}</span>}
                            {l.state === "staff" && <span className="text-sage-200"> · {t.linePaidStaff}</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-cream-50">{money(l.amount, lang)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {totals && (
                <dl className="border-t border-gold-300/20 mt-2 pt-3 text-sm space-y-1">
                  <div className="flex justify-between"><dt className="text-cream-100/60">{t.billTotal}</dt><dd className="text-cream-50">{money(totals.total, lang)}</dd></div>
                  {totals.total > totals.unpaid && (
                    <div className="flex justify-between"><dt className="text-cream-100/60">{t.billPaidSoFar}</dt><dd className="text-sage-200">{money(totals.total - totals.unpaid, lang)}</dd></div>
                  )}
                  <div className="flex justify-between"><dt className="text-cream-100/60">{t.billLeft}</dt><dd className="font-display text-2xl text-gold-100">{money(totals.unpaid, lang)}</dd></div>
                </dl>
              )}
              {problem && <p role="alert" className="border border-red-300/30 bg-red-950/30 rounded-sm px-4 py-3 mt-4 text-sm text-cream-50">{problem}</p>}
              {payable.length === 0 ? (
                <p className="mt-5 text-center text-sage-200">{t.billAllPaid}</p>
              ) : (
                <button
                  type="button"
                  onClick={pay}
                  disabled={!selected.length || busy}
                  className="btn-gold w-full mt-5 py-4 rounded-sm text-sm tracking-[0.15em] uppercase font-medium"
                >
                  {busy ? t.toPayment : selected.length ? fill(t.payButton, { total: money(amount, lang) }) : t.chooseLines}
                </button>
              )}
            </>
          )}
          {onOrders && (
            <button type="button" onClick={onOrders} className="mt-4 w-full py-2 text-sm text-gold-200 underline underline-offset-4">
              {t.myOrders}
            </button>
          )}
        </>
      )}
    </Sheet>
  );
}

/**
 * Coming back from paying part of a bill without paying: tell the server to
 * close that payment page, so the lines stop showing as "being paid".
 */
export async function abandonBillPayment(code) {
  const mine = session.get(BILLS, []).find((p) => p.code === code);
  if (!mine) return;
  try {
    await api("bill-abandon.php", { method: "POST", body: { token: mine.token } });
  } catch {
    /* Stripe closes it on its own within the hour */
  }
}
