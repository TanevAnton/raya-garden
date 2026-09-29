import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import menu from "../../../public/api/qr-menu.json";
import { strings, fill } from "./strings.js";
import { money, size, clock, sofiaDate, pick } from "../shared/format.js";
import { api, newIdempotencyKey, session } from "../shared/api.js";
import Sheet from "./Sheet.jsx";
import BillSheet, { abandonBillPayment } from "./BillSheet.jsx";

// The guest page at /menu, opened from the QR code on the tables.
//
// The menu itself is built into the page (public/api/qr-menu.json, the same
// file the server checks orders against), so it shows at once, even on a
// weak connection. What changes during the evening — is ordering open,
// which tables, what is sold out — comes from /api/qr/state.php every half
// minute.
//
// Table, cart and this phone's orders live in sessionStorage: a reload keeps
// them, a new visit starts clean. The server decides everything that
// matters (prices, availability, the table); this page only reflects it.
//
// On evenings when guests pay on the phone (state.payment === "online") the
// order is sent to Stripe's payment page and comes back to
// /menu/?paid=<code> or ?unpaid=<code>. Coming back proves nothing: the
// order counts as paid only when the server says so, after Stripe's own
// signed confirmation.
//
// On "pay at the end" evenings (state.payment === "tab") orders go straight
// to the kitchen and onto the table's bill; "Сметка" (BillSheet.jsx) is
// where anyone at the table pays — all of it or their part — coming back
// to ?billpaid= / ?billunpaid=.

const ITEMS = new Map(menu.categories.flatMap((c) => c.items.map((i) => [i.id, i])));
const lineKey = (l) => `${l.itemId}|${l.variantId}|${l.choiceId || ""}`;
const FINAL = new Set(["served", "cancelled", "expired"]);

/** ?paid=CODE / ?unpaid=CODE from Stripe's return — read once, then removed from the address. */
function takeReturn() {
  try {
    const url = new URL(window.location.href);
    const found = ["paid", "unpaid", "billpaid", "billunpaid"].find((k) => url.searchParams.get(k));
    if (!found) return null;
    const code = url.searchParams.get(found);
    ["paid", "unpaid", "billpaid", "billunpaid"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState(null, "", url);
    return { kind: found, code, at: Date.now() };
  } catch {
    return null;
  }
}

function initialLang() {
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (fromUrl === "bg" || fromUrl === "en") return fromUrl;
  try {
    const saved = window.localStorage.getItem("raya.lang");
    if (saved === "en" || saved === "ro") return "en";
  } catch {
    /* no storage */
  }
  return "bg";
}

/** useState that survives a reload, in sessionStorage. */
function useStored(key, fallback) {
  const [value, setValue] = useState(() => session.get(key, fallback));
  useEffect(() => session.set(key, value), [key, value]);
  return [value, setValue];
}

/** Is ordering open, the tables, sold-out — refreshed every 30 s and on return to the tab. */
function useServiceState() {
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    try {
      const res = await api("state.php");
      if (res.ok) {
        setState(res);
        setFailed(false);
      } else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    reload();
    const timer = setInterval(reload, 30000);
    const onVisible = () => document.visibilityState === "visible" && reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);
  return { state, failed, reload };
}

/**
 * This phone's orders, as the server sees them; polled while any is still
 * open — every 3 s for two minutes after coming back from paying, when the
 * guest is waiting to see the payment confirmed.
 */
function useOrderStatuses(orders, returned) {
  const [byToken, setByToken] = useState({});
  const tokens = orders.map((o) => o.token).join(",");
  const refresh = useCallback(async () => {
    if (!tokens) return;
    try {
      const res = await api(`order-status.php?t=${encodeURIComponent(tokens)}`);
      if (res.ok) setByToken(Object.fromEntries(res.orders.map((o) => [o.token, o])));
    } catch {
      /* keep what we have; the next poll tries again */
    }
  }, [tokens]);
  const open = orders.some((o) => !FINAL.has(byToken[o.token]?.status));
  const eager = returned?.kind === "paid" && orders.some((o) => byToken[o.token]?.status === "pending_payment" || !byToken[o.token]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!returned) return undefined;
    const left = returned.at + 120000 - Date.now();
    if (left <= 0) return undefined;
    const timer = setTimeout(() => tick((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [returned]);
  const fast = eager && Date.now() - returned.at < 120000;
  useEffect(() => {
    refresh();
    if (!open) return undefined;
    const timer = setInterval(refresh, fast ? 3000 : 10000);
    return () => clearInterval(timer);
  }, [refresh, open, fast]);
  return { byToken, refresh };
}

export default function MenuApp() {
  const [lang, setLangState] = useState(initialLang);
  const t = strings[lang];
  const { state, failed, reload } = useServiceState();
  const [table, setTable] = useStored("raya.qr.table", null);
  const [cart, setCart] = useStored("raya.qr.cart", []);
  const [orders, setOrders] = useStored("raya.qr.orders", []);
  const [browsing, setBrowsing] = useStored("raya.qr.browsing", false);
  const [sheet, setSheet] = useState(null);
  const [choiceFor, setChoiceFor] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [problem, setProblem] = useState(null);
  const [sentOrder, setSentOrder] = useState(null);
  const [returned] = useState(takeReturn);
  const attempt = useRef({ key: null, sig: null });
  const honeypot = useRef(null);
  const { byToken, refresh: refreshOrders } = useOrderStatuses(orders, returned);

  // Back from Stripe's page: show that order, or the bill, and what became of it.
  useEffect(() => {
    if (!returned) return;
    if (returned.kind === "paid") {
      setSentOrder({ code: returned.code });
      setSheet("sent");
    } else if (returned.kind === "unpaid") setSheet("orders");
    else {
      if (returned.kind === "billunpaid") abandonBillPayment(returned.code);
      setSheet("bill");
    }
  }, [returned]);
  const myCodes = useMemo(() => new Set(orders.map((o) => o.code)), [orders]);

  const setLang = (next) => {
    setLangState(next);
    try {
      window.localStorage.setItem("raya.lang", next);
    } catch {
      /* no storage */
    }
    document.documentElement.lang = next;
    // Keep ?lang= in the address in step, so a reload keeps the choice.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    } catch {
      /* old browser: the saved choice still applies without ?lang= */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = `${strings[lang].title} · RAYA Garden`;
  }, [lang]);

  const open = Boolean(state?.open);
  const tabMode = state?.payment === "tab";
  const soldOut = useMemo(() => new Set(state?.soldOut || []), [state]);
  const tables = useMemo(() => {
    if (!state) return [];
    const off = new Set(state.disabledTables);
    return Array.from({ length: state.tables }, (_, i) => i + 1).filter((n) => !off.has(n));
  }, [state]);

  // A table from an earlier evening, or one switched off since, is forgotten.
  useEffect(() => {
    if (state && table != null && !tables.includes(table)) setTable(null);
  }, [state, table, tables, setTable]);
  // Ordering is open and we do not know the table yet: ask, once.
  useEffect(() => {
    if (open && table == null && !browsing && sheet == null) setSheet("table");
  }, [open, table, browsing, sheet]);

  const total = cart.reduce((sum, l) => sum + l.price * l.qty, 0);
  const count = cart.reduce((sum, l) => sum + l.qty, 0);

  const add = (item, variant, choiceId = "") => {
    setProblem(null);
    setCart((lines) => {
      const key = lineKey({ itemId: item.id, variantId: variant.id, choiceId });
      const found = lines.find((l) => lineKey(l) === key);
      if (found) return lines.map((l) => (l === found ? { ...l, qty: Math.min(20, l.qty + 1) } : l));
      return [...lines, { itemId: item.id, variantId: variant.id, choiceId, qty: 1, note: "", price: variant.price }];
    });
  };
  const setQty = (key, qty) =>
    setCart((lines) => (qty < 1 ? lines.filter((l) => lineKey(l) !== key) : lines.map((l) => (lineKey(l) === key ? { ...l, qty: Math.min(20, qty) } : l))));
  const setNote = (key, note) => setCart((lines) => lines.map((l) => (lineKey(l) === key ? { ...l, note } : l)));

  const chooseTable = (n) => {
    setTable(n);
    setConfirmed(false);
    setBrowsing(false);
    setProblem((p) => (p?.kind === "table" ? null : p));
    setSheet(cart.length ? "review" : null);
  };

  async function submit() {
    if (!table || !confirmed || submitting || !cart.length) return;
    const lines = cart.map((l) => ({ itemId: l.itemId, variantId: l.variantId, choiceId: l.choiceId || "", qty: l.qty, note: l.note.trim(), price: l.price }));
    const body = { table, lang, expectedTotal: total, lines, website: honeypot.current?.value || "" };
    // One key per attempt: a retry of the very same order reuses it, so the
    // server can never make two; any change to the order makes a new one.
    const sig = JSON.stringify([table, lines]);
    if (attempt.current.sig !== sig) attempt.current = { key: newIdempotencyKey(), sig };
    setSubmitting(true);
    setProblem(null);
    try {
      const res = await api("order.php", { method: "POST", body, headers: { "Idempotency-Key": attempt.current.key } });
      if (res.ok) {
        const entry = { token: res.token, code: res.order.code, createdAt: res.order.createdAt };
        setOrders((list) => (list.some((o) => o.token === entry.token) ? list : [...list, entry]));
        setCart([]);
        setConfirmed(false);
        attempt.current = { key: null, sig: null };
        if (res.checkoutUrl) {
          // To Stripe's page. The order is saved on this phone first, so
          // coming back — paid or not — finds it.
          setRedirecting(true);
          session.set("raya.qr.orders", [...orders.filter((o) => o.token !== entry.token), entry]);
          window.location.assign(res.checkoutUrl);
          return;
        }
        setSentOrder(res.order);
        setSheet("sent");
        refreshOrders();
      } else if (res.error === "payment_unavailable") {
        // The order exists but Stripe could not be reached. Keep the same
        // attempt: pressing Pay again finishes this order, never a second one.
        setProblem({ kind: "payment" });
      } else if (res.error === "changed") {
        const drop = new Set([...res.removed, ...res.soldOut].map((r) => r.line));
        const now = new Map(res.priceChanged.map((p) => [p.line, p.now]));
        const notes = [];
        cart.forEach((l, i) => {
          const name = lineName(l, lang);
          if (res.removed.some((r) => r.line === i)) notes.push(fill(t.removedLine, { name }));
          else if (res.soldOut.some((r) => r.line === i)) notes.push(fill(t.soldOutLine, { name }));
          else if (now.has(i)) notes.push(fill(t.priceLine, { name, old: money(l.price, lang), now: money(now.get(i), lang) }));
        });
        setCart(cart.map((l, i) => (now.has(i) ? { ...l, price: now.get(i) } : l)).filter((_, i) => !drop.has(i)));
        setConfirmed(false);
        setProblem({ kind: "changed", notes });
        reload();
      } else if (res.error === "closed") {
        setProblem({ kind: "closed" });
        reload();
      } else if (res.error === "table_invalid") {
        setProblem({ kind: "table", n: table });
        setTable(null);
        reload();
        setSheet("table");
      } else if (res.error === "rate_limited") {
        setProblem({ kind: "rate" });
      } else {
        attempt.current = { key: null, sig: null };
        setProblem({ kind: "error" });
      }
    } catch {
      setProblem({ kind: "network" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen pb-28">
      <Header
        t={t}
        lang={lang}
        setLang={setLang}
        table={table}
        open={open}
        orders={orders}
        onTable={() => setSheet("table")}
        onOrders={() => setSheet("orders")}
        onBill={tabMode && table ? () => setSheet("bill") : null}
      />
      <StatusBanner t={t} lang={lang} state={state} failed={failed} reload={reload} />
      <CategoryTabs lang={lang} label={t.categories} />
      <main className="max-w-2xl mx-auto px-4">
        {menu.categories.map((category) => (
          <section key={category.id} id={`c-${category.id}`} data-category={category.id} className="scroll-mt-28 pt-8">
            <h2 className="font-display text-3xl text-cream-50">{pick(category, lang)}</h2>
            {category.noteBg && <p className="text-sm text-cream-100/50 italic mt-1">{pick(category, lang, "note")}</p>}
            <div className="mt-4 space-y-3">
              {category.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  t={t}
                  lang={lang}
                  canOrder={open}
                  soldOut={soldOut.has(item.id)}
                  cart={cart}
                  onAdd={(variant) => (item.choices ? setChoiceFor({ item, variant }) : add(item, variant))}
                  onQty={setQty}
                  onAllergens={() => setSheet("allergens")}
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-xs text-cream-100/40 mt-10 text-center">{t.allergensLead}</p>
      </main>

      {count > 0 && sheet !== "review" && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-ink-950/95 backdrop-blur border-t border-gold-300/15 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={() => setSheet("review")} className="btn-gold w-full max-w-2xl mx-auto flex items-center justify-between gap-4 rounded-sm px-5 py-3 text-left">
            <span className="leading-tight">
              <span className="block text-lg font-medium whitespace-nowrap">{money(total, lang)}</span>
              <span className="block text-xs whitespace-nowrap">{count === 1 ? t.itemsOne : fill(t.itemsMany, { n: count })}</span>
            </span>
            <span className="tracking-[0.15em] uppercase text-xs font-medium text-right">{t.review}</span>
          </button>
        </div>
      )}

      {sheet === "table" && (
        <Sheet title={t.chooseTable} onClose={() => { setSheet(null); if (table == null) setBrowsing(true); }} closeLabel={t.close}>
          {problem?.kind === "table" && <p role="alert" className="mb-4 text-sm text-red-300">{fill(t.tableInvalid, { n: problem.n })}</p>}
          <p className="text-sm text-cream-100/60 mb-4">{t.chooseTableLead}</p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {tables.map((n) => (
              <button key={n} type="button" onClick={() => chooseTable(n)} className={`h-14 rounded-sm text-lg font-medium tabular-nums ${n === table ? "btn-gold" : "border border-gold-300/30 text-cream-50"}`}>
                {n}
              </button>
            ))}
          </div>
          {table == null && (
            <button type="button" onClick={() => { setBrowsing(true); setSheet(null); }} className="mt-5 w-full py-3 text-sm text-gold-200 underline underline-offset-4">
              {t.justBrowsing}
            </button>
          )}
        </Sheet>
      )}

      {sheet === "review" && (
        <Sheet title={t.yourOrder} onClose={() => setSheet(null)} closeLabel={t.close}>
          <Review
            t={t}
            lang={lang}
            cart={cart}
            total={total}
            table={table}
            open={open}
            confirmed={confirmed}
            setConfirmed={setConfirmed}
            submitting={submitting || redirecting}
            redirecting={redirecting}
            problem={problem}
            onQty={setQty}
            onNote={setNote}
            onTable={() => setSheet("table")}
            onSubmit={submit}
            honeypot={honeypot}
            state={state}
          />
        </Sheet>
      )}

      {sheet === "bill" && (
        <BillSheet t={t} lang={lang} table={table} myCodes={myCodes} returned={returned?.kind.startsWith("bill") ? returned : null} onClose={() => setSheet(null)} onOrders={orders.length ? () => setSheet("orders") : null} />
      )}

      {sheet === "sent" && sentOrder && (
        <SentSheet t={t} lang={lang} order={byToken[orders.find((o) => o.code === sentOrder.code)?.token] || sentOrder} onClose={() => setSheet(null)} onBill={tabMode ? () => setSheet("bill") : null}>
          <button type="button" onClick={() => setSheet(null)} className="btn-gold w-full mt-6 py-4 rounded-sm text-sm tracking-[0.15em] uppercase font-medium">
            {t.orderMore}
          </button>
        </SentSheet>
      )}

      {sheet === "orders" && (
        <Sheet title={t.myOrders} onClose={() => setSheet(null)} closeLabel={t.close}>
          {returned?.kind === "unpaid" && byToken[orders.find((o) => o.code === returned.code)?.token]?.status === "pending_payment" && (
            <p role="status" className="border border-gold-300/25 bg-ink-950 rounded-sm px-4 py-3 text-sm text-cream-50">{t.unpaidReturn}</p>
          )}
          <div className="space-y-4">
            {[...orders].reverse().map((o) => (
              <OrderCard key={o.token} t={t} lang={lang} order={byToken[o.token] || { code: o.code, createdAt: o.createdAt, status: "new", lines: [], total: null }} />
            ))}
          </div>
        </Sheet>
      )}

      {sheet === "allergens" && (
        <Sheet title={t.allergens} onClose={() => setSheet(null)} closeLabel={t.close}>
          <p className="text-sm text-cream-100/60 mb-4">{t.allergensLead}</p>
          <ol className="space-y-2 text-sm">
            {Object.entries(menu.allergens).map(([n, a]) => (
              <li key={n} className="flex gap-3">
                <span className="w-6 h-6 shrink-0 rounded-full border border-gold-300/40 text-gold-200 text-xs flex items-center justify-center">{n}</span>
                <span className="text-cream-100/80">{pick(a, lang)}</span>
              </li>
            ))}
          </ol>
        </Sheet>
      )}

      {choiceFor && (
        <Sheet title={`${pick(choiceFor.item, lang)} — ${pick(choiceFor.item.choices, lang).toLowerCase()}`} onClose={() => setChoiceFor(null)} closeLabel={t.close}>
          <div className="grid grid-cols-2 gap-2">
            {choiceFor.item.choices.options.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  add(choiceFor.item, choiceFor.variant, c.id);
                  setChoiceFor(null);
                }}
                className="border border-gold-300/30 rounded-sm px-3 py-4 text-cream-50"
              >
                {pick(c, lang)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** "Салата „Цезар“ · с пиле" — a cart line's name. */
function lineName(line, lang) {
  const item = ITEMS.get(line.itemId);
  if (!item) return line.itemId;
  const variant = item.variants.find((v) => v.id === line.variantId);
  const choice = item.choices?.options.find((c) => c.id === line.choiceId);
  return [pick(item, lang), variant && item.variants.length > 1 ? pick(variant, lang) : "", choice ? pick(choice, lang) : ""].filter(Boolean).join(" · ");
}

function Header({ t, lang, setLang, table, open, orders, onTable, onOrders, onBill }) {
  return (
    <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-gold-300/10">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
        <img src="/img/logo.png" alt="" width="32" height="32" className="w-8 h-8" />
        {/* With all three buttons a narrow phone has no room for the name:
            the subtitle goes first, then (below 380 px) the title — the logo stays. */}
        <div className={`leading-tight min-w-0 ${orders.length || onBill ? "hidden min-[380px]:block" : ""}`}>
          <div className="font-display text-xl text-cream-50">{t.title}</div>
          <div className={`text-[10px] tracking-[0.25em] uppercase text-gold-300/70 whitespace-nowrap ${orders.length || onBill ? "hidden min-[480px]:block" : ""}`}>{t.restaurant}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* On "pay at the end" evenings the bill takes this place; "my orders" is inside it. */}
          {onBill ? (
            <button type="button" onClick={onBill} className="h-10 px-3 text-xs text-gold-200 border border-gold-300/30 rounded-sm whitespace-nowrap">
              {t.bill}
            </button>
          ) : (
            orders.length > 0 && (
              <button type="button" onClick={onOrders} aria-label={`${t.myOrders} (${orders.length})`} className="h-10 px-3 text-xs text-gold-200 border border-gold-300/30 rounded-sm whitespace-nowrap">
                {t.ordersShort} {orders.length}
              </button>
            )
          )}
          {open && (
            <button type="button" onClick={onTable} aria-label={table ? fill(t.tableN, { n: table }) : t.chooseTable} className="h-10 px-3 text-xs border border-gold-300/30 rounded-sm text-cream-50 whitespace-nowrap">
              {table ? `№${table}` : t.table}
            </button>
          )}
          <div className="flex text-xs border border-gold-300/30 rounded-sm overflow-hidden" role="group" aria-label="Language">
            {["bg", "en"].map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`h-10 w-10 uppercase ${lang === l ? "bg-gold-300/20 text-gold-100" : "text-cream-100/60"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusBanner({ t, lang, state, failed, reload }) {
  if (failed && !state) {
    return (
      <div role="alert" className="max-w-2xl mx-auto px-4 mt-4">
        <div className="border border-red-300/30 bg-red-950/30 px-4 py-3 text-sm text-cream-100 flex items-center justify-between gap-3">
          <span>{t.loadError}</span>
          <button type="button" onClick={reload} className="shrink-0 underline text-gold-200">{t.retry}</button>
        </div>
      </div>
    );
  }
  if (!state) return <div className="max-w-2xl mx-auto px-4 mt-4 h-12 animate-pulse bg-ink-900 rounded-sm" aria-hidden="true" />;
  if (state.open) return null;
  let message = t.closed;
  if (state.reason === "paused") message = t.paused;
  else if (state.reason === "not_yet_open") {
    const today = sofiaDate(state.now) === sofiaDate(state.opensAt);
    message = today
      ? fill(t.notYetToday, { time: clock(state.opensAt) })
      : fill(t.notYetOn, { date: new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "bg-BG", { day: "numeric", month: "long", timeZone: "Europe/Sofia" }).format(new Date(state.opensAt * 1000)), time: clock(state.opensAt) });
  }
  return (
    <div role="status" className="max-w-2xl mx-auto px-4 mt-4">
      <div className="border border-gold-300/25 bg-ink-900 px-4 py-3 text-sm">
        <p className="text-cream-50">{message}</p>
        <p className="text-cream-100/50 mt-1">{t.browseStill}</p>
      </div>
    </div>
  );
}

/** Sticky category tabs; the one in view is highlighted, a tap scrolls to it. */
function CategoryTabs({ lang, label }) {
  const [active, setActive] = useState(menu.categories[0].id);
  const bar = useRef(null);
  useEffect(() => {
    const seen = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.dataset.category, e.isIntersecting ? e.boundingClientRect.top : null);
        const first = menu.categories.find((c) => seen.get(c.id) != null);
        if (first) setActive(first.id);
      },
      { rootMargin: "-120px 0px -55% 0px" }
    );
    document.querySelectorAll("[data-category]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    bar.current?.querySelector(`[data-tab="${active}"]`)?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);
  return (
    <nav aria-label={label} className="sticky top-14 z-10 bg-ink-950/95 backdrop-blur border-b border-gold-300/10">
      <div ref={bar} className="no-scrollbar max-w-2xl mx-auto px-2 flex gap-1 overflow-x-auto">
        {menu.categories.map((c) => (
          <a
            key={c.id}
            data-tab={c.id}
            href={`#c-${c.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(`c-${c.id}`)?.scrollIntoView({ behavior: "smooth" });
            }}
            className={`shrink-0 px-3 py-3 text-xs tracking-[0.1em] uppercase whitespace-nowrap border-b-2 ${active === c.id ? "border-gold-300 text-gold-100" : "border-transparent text-cream-100/50"}`}
          >
            {pick(c, lang)}
          </a>
        ))}
      </div>
    </nav>
  );
}

function ItemCard({ item, t, lang, canOrder, soldOut, cart, onAdd, onQty, onAllergens }) {
  const [expanded, setExpanded] = useState(false);
  const description = pick(item, lang, "desc");
  const long = description.length > 140;
  const orderable = item.orderable !== false && !soldOut && canOrder;
  const single = item.variants.length === 1;
  const inCart = (variant) => cart.filter((l) => l.itemId === item.id && l.variantId === variant.id).reduce((s, l) => s + l.qty, 0);
  return (
    <article className={`border border-gold-300/15 bg-ink-900/50 rounded-sm p-4 ${soldOut ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-cream-50 leading-snug">{pick(item, lang)}</h3>
          {description && (
            <p className={`text-sm text-cream-100/55 mt-1 leading-relaxed ${long && !expanded ? "line-clamp-2" : ""}`}>
              {description}
              {long && (
                <button type="button" onClick={() => setExpanded(!expanded)} className="ml-1 text-gold-200/80 underline underline-offset-2">
                  {expanded ? t.less : t.more}
                </button>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {single && item.variants[0].size && !item.byWeight && <span className="text-xs text-cream-100/50">{size(item.variants[0].size, lang)}</span>}
            {item.allergens.length > 0 && (
              <button type="button" onClick={onAllergens} className="flex gap-1" aria-label={`${t.allergens}: ${item.allergens.join(", ")}`}>
                {item.allergens.map((a) => (
                  <span key={a} className="w-5 h-5 rounded-full border border-gold-300/30 text-[10px] text-gold-200/80 flex items-center justify-center">{a}</span>
                ))}
              </button>
            )}
          </div>
        </div>
        {single && (
          <div className="text-right shrink-0">
            <div className="text-gold-100 whitespace-nowrap">{money(item.variants[0].price, lang)}</div>
            {item.byWeight && <div className="text-[11px] text-cream-100/50">{t.per100}</div>}
          </div>
        )}
      </div>
      {item.byWeight && <p className="text-xs text-cream-100/50 mt-3">{t.byWeight}</p>}
      {soldOut && <p className="text-xs tracking-[0.2em] uppercase text-red-300/80 mt-3">{t.soldOut}</p>}
      {orderable && (
        <div className="mt-3 space-y-2">
          {item.variants.map((variant) => (
            <div key={variant.id} className="flex items-center justify-between gap-3">
              {!single ? (
                <span className="text-sm text-cream-100/80">
                  {pick(variant, lang) || size(variant.size, lang)}
                  {variant.size && pick(variant, lang) !== size(variant.size, lang) ? ` · ${size(variant.size, lang)}` : ""}
                  <span className="text-gold-100 ml-2">{money(variant.price, lang)}</span>
                </span>
              ) : (
                <span />
              )}
              {item.choices || inCart(variant) === 0 ? (
                <button type="button" onClick={() => onAdd(variant)} className="h-11 px-5 rounded-sm btn-ghost text-xs tracking-[0.15em] uppercase">
                  {t.add}
                  {item.choices && inCart(variant) > 0 ? ` (${inCart(variant)})` : ""}
                </button>
              ) : (
                <Stepper value={inCart(variant)} onChange={(q) => onQty(lineKey({ itemId: item.id, variantId: variant.id }), q)} t={t} />
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function Stepper({ value, onChange, t }) {
  return (
    <div className="flex items-center border border-gold-300/40 rounded-sm">
      <button type="button" onClick={() => onChange(value - 1)} aria-label={value === 1 ? t.remove : "−"} className="w-11 h-11 text-xl text-gold-100">−</button>
      <span className="w-8 text-center text-cream-50" aria-live="polite">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={value >= 20} aria-label="+" className="w-11 h-11 text-xl text-gold-100 disabled:opacity-30">+</button>
    </div>
  );
}

function Review({ t, lang, cart, total, table, open, confirmed, setConfirmed, submitting, redirecting, problem, onQty, onNote, onTable, onSubmit, honeypot, state }) {
  const closedNow = state && !state.open;
  const online = state?.payment === "online";
  const onTab = state?.payment === "tab";
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      {/* invisible to people; bots fill it and are refused */}
      <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] w-px h-px opacity-0" />
      <button type="button" onClick={onTable} className="w-full flex items-center justify-between border border-gold-300/30 rounded-sm px-4 py-3 mb-5">
        <span className={table ? "text-2xl font-semibold tabular-nums text-cream-50" : "font-display text-2xl text-cream-50"}>{table ? fill(t.tableN, { n: table }) : t.chooseTable}</span>
        <span className="text-xs text-gold-200 underline underline-offset-4">{t.change}</span>
      </button>

      {problem && <Problem t={t} problem={problem} />}

      {cart.length === 0 ? (
        <p className="text-cream-100/60 py-6 text-center">{t.emptyCart}</p>
      ) : (
        <ul className="divide-y divide-gold-300/10">
          {cart.map((l) => {
            const key = lineKey(l);
            return (
              <li key={key} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-cream-50 leading-snug">{lineName(l, lang)}</div>
                    <div className="text-xs text-cream-100/50 mt-0.5">{money(l.price, lang)}</div>
                  </div>
                  <Stepper value={l.qty} onChange={(q) => onQty(key, q)} t={t} />
                </div>
                <label className="block mt-2">
                  <span className="sr-only">{t.note}</span>
                  <input
                    value={l.note}
                    maxLength={200}
                    onChange={(e) => onNote(key, e.target.value)}
                    placeholder={`${t.note}: ${t.notePlaceholder}`}
                    className="w-full bg-ink-950 border border-gold-300/15 rounded-sm px-3 py-2 text-cream-50 placeholder:text-cream-100/30"
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-gold-300/20 mt-2 pt-4">
        <span className="text-cream-100/70">{t.total}</span>
        <span className="font-display text-3xl text-gold-100">{money(total, lang)}</span>
      </div>
      <p className="text-sm text-cream-100/60 mt-2">{online ? t.payOnline : onTab && table ? fill(t.payTab, { n: table }) : t.payment}</p>

      {table && cart.length > 0 && (
        <label className="flex items-start gap-3 mt-5 cursor-pointer">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 w-5 h-5 accent-[#c69b3b]" />
          <span className="text-cream-50">{fill(t.confirmTable, { n: table })}</span>
        </label>
      )}

      <button
        type="submit"
        disabled={!table || !confirmed || submitting || !cart.length || !open || closedNow}
        className="btn-gold w-full mt-5 py-4 rounded-sm text-sm tracking-[0.15em] uppercase font-medium"
      >
        {redirecting ? t.toPayment : submitting ? t.sending : online ? fill(t.payButton, { total: money(total, lang) }) : t.send}
      </button>
    </form>
  );
}

function Problem({ t, problem }) {
  const text = {
    closed: t.closed,
    rate: t.rateLimited,
    network: t.network,
    error: t.error,
    payment: t.paymentUnavailable,
    table: fill(t.tableInvalid, { n: problem.n }),
  }[problem.kind];
  return (
    <div role="alert" className="border border-red-300/30 bg-red-950/30 rounded-sm px-4 py-3 mb-4 text-sm">
      {problem.kind === "changed" ? (
        <>
          <p className="text-cream-50 font-medium">{t.changedTitle}</p>
          <p className="text-cream-100/70 mt-1">{t.changedLead}</p>
          <ul className="mt-2 space-y-1 text-cream-100/90 list-disc pl-5">
            {problem.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      ) : (
        <p className="text-cream-50">{text}</p>
      )}
    </div>
  );
}

/**
 * "Поръчката е изпратена" — or, back from paying and until the server has
 * Stripe's confirmation, "Потвърждаваме плащането…".
 */
function SentSheet({ t, lang, order, onClose, onBill, children }) {
  const onTab = order.tabId > 0 || (order.payStatus || "").startsWith("tab");
  const waiting = !onTab && (!order.status || order.status === "pending_payment");
  const title = waiting ? t.confirmingPayment : order.status === "expired" ? t.status.expired : t.sent;
  return (
    <Sheet title={title} onClose={onClose} closeLabel={t.close}>
      {!waiting && order.status !== "expired" && <p className="text-sm text-cream-100/60">{onTab ? t.sentTab : t.sentLead}</p>}
      <OrderCard t={t} lang={lang} order={order} big />
      {onTab && onBill && (
        <button type="button" onClick={onBill} className="btn-ghost w-full mt-4 py-3 rounded-sm text-sm tracking-[0.15em] uppercase">
          {t.bill}
        </button>
      )}
      {children}
    </Sheet>
  );
}

function OrderCard({ t, lang, order, big = false }) {
  const status = order.status || "new";
  const tone = { pending_payment: "text-gold-200", expired: "text-cream-100/50", new: "text-gold-200", accepted: "text-sage-200", served: "text-cream-100/60", cancelled: "text-red-300" }[status];
  return (
    <div className="border border-gold-300/20 rounded-sm p-4 mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-cream-100/50">{t.code}</div>
          <div className={`font-sans font-semibold text-cream-50 tracking-wider ${big ? "text-4xl" : "text-2xl"}`}>{order.code}</div>
        </div>
        {order.table && <div className="text-right text-cream-100/70">{fill(t.tableN, { n: order.table })}</div>}
      </div>
      <p className={`mt-2 text-sm ${tone}`} aria-live="polite">
        {t.status[status]}
        {status === "cancelled" && order.cancelReason ? ` — ${order.cancelReason}` : ""}
      </p>
      {(order.payStatus === "paid" || order.payStatus === "refunded") && (
        <p className={`mt-1 text-xs tracking-[0.15em] uppercase ${order.payStatus === "paid" ? "text-sage-200" : "text-gold-200"}`}>
          {order.payStatus === "paid" ? t.paid : t.refunded}
        </p>
      )}
      {t.orderPay[order.payStatus] && status !== "cancelled" && (
        <p className={`mt-1 text-xs tracking-[0.15em] uppercase ${order.payStatus === "tab_paid" ? "text-sage-200" : "text-cream-100/60"}`}>
          {t.orderPay[order.payStatus]}
        </p>
      )}
      {status === "pending_payment" && order.payUrl && (
        <a href={order.payUrl} className="btn-gold block text-center w-full mt-3 py-3 rounded-sm text-sm tracking-[0.15em] uppercase font-medium">
          {order.total != null ? fill(t.payButton, { total: money(order.total, lang) }) : t.payNow}
        </a>
      )}
      {order.createdAt && <p className="text-xs text-cream-100/40 mt-1">{fill(t.orderedAt, { time: clock(order.createdAt) })}</p>}
      {order.lines?.length > 0 && (
        <ul className="mt-3 text-sm text-cream-100/80 space-y-1">
          {order.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>
                {l.qty} × {lang === "en" ? l.nameEn : l.nameBg}
                {(lang === "en" ? l.detailEn : l.detailBg) ? ` · ${lang === "en" ? l.detailEn : l.detailBg}` : ""}
                {l.note ? <span className="block text-xs text-cream-100/50">„{l.note}“</span> : null}
              </span>
              <span className="shrink-0">{money(l.price * l.qty, lang)}</span>
            </li>
          ))}
        </ul>
      )}
      {order.total != null && (
        <div className="flex justify-between border-t border-gold-300/15 mt-3 pt-2 text-cream-50">
          <span>{t.total}</span>
          <span>{money(order.total, lang)}</span>
        </div>
      )}
    </div>
  );
}
