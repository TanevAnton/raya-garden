import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import menu from "../../../public/api/qr-menu.json";
import { money, clock, sofiaDate } from "../shared/format.js";
import { api } from "../shared/api.js";

// The staff screen at /admin: tonight's orders as they arrive, the
// evening's set-up, and what is sold out. Bulgarian only — it is for the
// staff. Made for a tablet on the pass, works on a phone.
//
// Orders arrive by polling /api/qr/admin/feed.php every 4 seconds with the
// last change number seen. If the connection drops, the next successful
// poll asks with that same number and gets everything that happened in
// between — nothing is lost, and nothing needs a page reload.
//
// When guests pay on the phone, an order only arrives here once it is paid
// ("Платена"); cancelling it refunds the guest. "За касата" lists the paid
// orders still to be entered in the till (Clock) — this system cannot reach
// it — and refunded ones to void there.

const POLL_MS = 4000;
const STATUS = {
  new: { label: "Нова", tone: "border-gold-300 text-gold-100", card: "border-gold-300/70" },
  accepted: { label: "Приета", tone: "border-sage-300 text-sage-200", card: "border-sage-400/50" },
  served: { label: "Сервирана", tone: "border-cream-100/30 text-cream-100/60", card: "border-gold-300/10" },
  cancelled: { label: "Отказана", tone: "border-red-400/60 text-red-300", card: "border-red-400/30" },
};
const NEXT = {
  new: { action: "accept", label: "Приеми" },
  accepted: { action: "serve", label: "Сервирано" },
};
const REASONS = ["Грешна маса", "Изчерпан продукт", "Гостът се отказа", "Дублирана поръчка"];
const ITEMS = menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, category: c.bg })));

const adminApi = (path, body) =>
  api(`admin/${path}`, body === undefined ? {} : { method: "POST", body, headers: { "X-Raya-Admin": "1" } });

export default function AdminApp() {
  const [session, setSession] = useState(null); // null = checking
  useEffect(() => {
    api("admin/session.php")
      .then((res) => setSession(res))
      .catch(() => setSession({ signedIn: false, configured: true, offline: true }));
  }, []);
  if (!session) return <Centered>Зареждане…</Centered>;
  if (!session.signedIn) return <Login configured={session.configured} onDone={() => setSession({ signedIn: true, configured: true })} />;
  return <Dashboard onSignedOut={() => setSession({ signedIn: false, configured: true })} />;
}

function Centered({ children }) {
  return <div className="min-h-screen flex items-center justify-center px-6 text-cream-100/70">{children}</div>;
}

function Login({ configured, onDone }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api("admin/login.php", { method: "POST", body: { password } });
      if (res.ok) onDone();
      else
        setError(
          {
            wrong_password: "Грешна парола.",
            rate_limited: "Твърде много опити. Опитайте отново след 15 минути.",
            not_configured: "Паролата не е настроена на сървъра — виж docs/qr-ordering/SETUP.md.",
          }[res.error] || "Нещо се обърка. Опитайте отново."
        );
    } catch {
      setError("Няма връзка със сървъра.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm border border-gold-300/20 bg-ink-900 rounded-sm p-8">
        <img src="/img/logo.png" alt="" width="48" height="48" className="w-12 h-12 mb-4" />
        <h1 className="font-display text-3xl text-cream-50">Поръчки · вход</h1>
        {!configured && <p className="text-sm text-red-300 mt-3">Паролата не е настроена на сървъра — виж docs/qr-ordering/SETUP.md.</p>}
        <label className="block mt-6">
          <span className="text-xs tracking-[0.2em] uppercase text-gold-300/80">Парола</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-3 text-cream-50"
            autoFocus
          />
        </label>
        {error && <p role="alert" className="text-sm text-red-300 mt-3">{error}</p>}
        <button type="submit" disabled={busy || !password} className="btn-gold w-full mt-6 py-4 rounded-sm text-sm tracking-[0.2em] uppercase font-medium">
          {busy ? "Влизане…" : "Вход"}
        </button>
      </form>
    </div>
  );
}

/** A two-tone chime, made on the spot — no audio file to load. */
function useChime() {
  const ctx = useRef(null);
  const [enabled, setEnabled] = useState(false);
  const play = useCallback(() => {
    const ac = ctx.current;
    if (!ac) return;
    const now = ac.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.35, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.5);
      osc.connect(gain).connect(ac.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.55);
    });
  }, []);
  // Browsers only allow sound after a tap on the page, hence the button.
  const enable = useCallback(() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx.current) ctx.current = new AC();
    ctx.current.resume();
    setEnabled(true);
    play();
  }, [play]);
  return { enabled, enable, play };
}

function Dashboard({ onSignedOut }) {
  const [orders, setOrders] = useState(() => new Map());
  const [state, setState] = useState(null);
  const [soldOut, setSoldOut] = useState([]);
  const [offline, setOffline] = useState(false);
  const [flash, setFlash] = useState(() => new Set());
  const [tab, setTab] = useState("orders");
  const [toast, setToast] = useState("");
  const [, tick] = useState(0);
  const seq = useRef(0);
  const loaded = useRef(false);
  const chime = useChime();
  const chimeRef = useRef(chime);
  chimeRef.current = chime;

  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  const merge = useCallback((list, full) => {
    setOrders((prev) => {
      const next = full ? new Map() : new Map(prev);
      for (const o of list) {
        const old = next.get(o.id);
        if (!old || old.seq <= o.seq) next.set(o.id, o);
      }
      return next;
    });
  }, []);

  // The poll loop: ask for everything after the last change number.
  useEffect(() => {
    let stopped = false;
    let timer;
    let failures = 0;
    const poll = async () => {
      try {
        const res = await api(`admin/feed.php?since=${seq.current}`);
        if (res.status === 401) {
          onSignedOut();
          return;
        }
        if (!res.ok) throw new Error(res.error);
        failures = 0;
        setOffline(false);
        const isNew = res.orders.filter((o) => o.status === "new" && loaded.current && !ordersRef.current.has(o.id));
        merge(res.orders, res.full);
        seq.current = res.seq;
        setState(res.state);
        setSoldOut(res.soldOut);
        if (isNew.length) {
          setFlash((f) => new Set([...f, ...isNew.map((o) => o.id)]));
          if (chimeRef.current.enabled) chimeRef.current.play();
          setTimeout(() => setFlash((f) => new Set([...f].filter((id) => !isNew.some((o) => o.id === id)))), 8000);
        }
        loaded.current = true;
      } catch {
        failures += 1;
        if (failures >= 2) setOffline(true);
      }
      if (!stopped) timer = setTimeout(poll, failures ? Math.min(15000, POLL_MS * 2 ** failures) : POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [merge, onSignedOut]);
  // "преди 7 мин" moves on by itself.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const say = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 5000);
  };

  async function move(order, action, reason) {
    try {
      const res = await adminApi("order.php", { id: order.id, action, from: order.status, ...(reason ? { reason } : {}) });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      if (res.error === "stale") say("Поръчката вече е променена от друго устройство — показвам я както е сега.");
      else if (res.error === "refund_failed") say("Връщането на парите не успя, затова поръчката НЕ е отказана. Опитайте отново след малко.");
      else if (!res.ok) say("Не успях да променя поръчката. Опитайте отново.");
      else if (action === "cancel" && res.order?.payStatus === "refunded") say(`${res.order.code} е отказана, ${money(res.order.total)} са върнати на госта.`);
    } catch {
      say("Няма връзка — промяната не е записана. Опитайте отново.");
    }
  }

  async function till(order, change) {
    try {
      const res = await adminApi("till.php", { id: order.id, ...change });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      if (!res.ok) say("Не успях да запиша. Опитайте отново.");
    } catch {
      say("Няма връзка — отметката не е записана. Опитайте отново.");
    }
  }

  const newCount = [...orders.values()].filter((o) => o.status === "new").length;
  const tillCount = [...orders.values()].filter(needsTill).length;
  const showTill = Boolean(state?.paymentsConfigured) || [...orders.values()].some((o) => o.payStatus);

  return (
    <div className="min-h-screen pb-16">
      <header className="sticky top-0 z-20 bg-ink-950/95 backdrop-blur border-b border-gold-300/15">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <img src="/img/logo.png" alt="" width="36" height="36" className="w-9 h-9" />
          <div className="font-display text-2xl text-cream-50 mr-2">Поръчки</div>
          <ServiceChip state={state} />
          <div className="ml-auto flex items-center gap-2">
            {chime.enabled ? (
              <span className="text-xs text-sage-200 px-2">🔔 Звук: вкл.</span>
            ) : (
              <button type="button" onClick={chime.enable} className="h-11 px-4 rounded-sm btn-gold text-xs tracking-[0.15em] uppercase font-medium">
                🔔 Включи звук
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  await adminApi("logout.php", {});
                } finally {
                  onSignedOut();
                }
              }}
              className="h-11 px-4 rounded-sm border border-gold-300/25 text-xs text-cream-100/70"
            >
              Изход
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-2 flex gap-1">
          {[
            ["orders", `Поръчки${newCount ? ` (${newCount} нови)` : ""}`],
            ["service", "Вечерта"],
            ["soldout", `Изчерпани${soldOut.length ? ` (${soldOut.length})` : ""}`],
            ...(showTill ? [["till", `За касата${tillCount ? ` (${tillCount})` : ""}`]] : []),
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`px-4 py-3 text-sm border-b-2 ${tab === id ? "border-gold-300 text-gold-100" : "border-transparent text-cream-100/60"}`}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      {offline && (
        <div role="alert" className="bg-red-950/80 border-b border-red-400/40 text-cream-50 text-sm px-4 py-3 text-center">
          Няма връзка със сървъра — опитвам отново. Поръчките няма да се изгубят: ще се появят, щом връзката се върне.
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 pt-4">
        {tab === "orders" && <Orders orders={orders} flash={flash} state={state} onMove={move} />}
        {tab === "service" && <Service state={state} onSaved={(s) => setState(s)} say={say} onSignedOut={onSignedOut} />}
        {tab === "soldout" && <SoldOut soldOut={soldOut} setSoldOut={setSoldOut} say={say} onSignedOut={onSignedOut} />}
        {tab === "till" && <Till orders={orders} onTill={till} />}
      </main>

      {toast && (
        <div role="status" className="fixed bottom-4 inset-x-4 z-30 max-w-lg mx-auto bg-ink-800 border border-gold-300/30 rounded-sm px-4 py-3 text-sm text-cream-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** On the "За касата" list: paid on the phone and not yet in the till, or refunded after it was. */
function needsTill(o) {
  return (o.payStatus === "paid" && !o.tillAt) || (o.payStatus === "refunded" && o.tillAt > 0 && !o.tillVoidAt);
}

function PayChip({ order }) {
  if (order.payStatus === "paid") return <span className="text-xs px-2 py-1 rounded-sm bg-sage-500/30 text-sage-100">Платена онлайн</span>;
  if (order.payStatus === "refunded") return <span className="text-xs px-2 py-1 rounded-sm bg-gold-300/20 text-gold-100">Сумата е върната</span>;
  return null;
}

function ServiceChip({ state }) {
  if (!state) return null;
  let text = "Не е настроено";
  let tone = "border-cream-100/30 text-cream-100/60";
  if (state.open) {
    text = `Отворено до ${state.closes}`;
    tone = "border-sage-300 text-sage-200";
  } else if (state.reason === "paused") {
    text = "Пауза";
    tone = "border-red-400/60 text-red-300";
  } else if (state.reason === "not_yet_open") {
    text = `Отваря в ${state.opens}`;
    tone = "border-gold-300/50 text-gold-200";
  } else if (state.reason === "closed") {
    text = "Затворено";
  }
  return <span className={`text-xs px-3 py-1 border rounded-full ${tone}`}>{text}</span>;
}

function elapsed(createdAt) {
  const minutes = Math.floor((Date.now() / 1000 - createdAt) / 60);
  if (minutes < 1) return "току-що";
  if (minutes < 60) return `преди ${minutes} мин`;
  return `преди ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
}

function Orders({ orders, flash, state, onMove }) {
  const [view, setView] = useState("active");
  const [table, setTable] = useState("");
  const [cancelling, setCancelling] = useState(null);
  const list = useMemo(() => {
    const all = [...orders.values()].filter((o) => (table ? o.table === Number(table) : true));
    const active = view === "active";
    return all
      .filter((o) => (view === "all" ? true : active ? o.status === "new" || o.status === "accepted" : o.status === "served" || o.status === "cancelled"))
      .sort((a, b) => (active ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
  }, [orders, view, table]);
  const tables = useMemo(() => [...new Set([...orders.values()].map((o) => o.table))].sort((a, b) => a - b), [orders]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {[
          ["active", "Активни"],
          ["done", "Приключени"],
          ["all", "Всички"],
        ].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)} className={`h-10 px-4 rounded-full text-sm border ${view === id ? "border-gold-300 bg-gold-300/15 text-gold-100" : "border-gold-300/20 text-cream-100/60"}`}>
            {label}
          </button>
        ))}
        <select value={table} onChange={(e) => setTable(e.target.value)} className="h-10 ml-auto bg-ink-900 border border-gold-300/25 rounded-sm px-3 text-cream-50 [color-scheme:dark]">
          <option value="">Всички маси</option>
          {tables.map((n) => (
            <option key={n} value={n}>Маса {n}</option>
          ))}
        </select>
      </div>

      {list.length === 0 ? (
        <p className="text-cream-100/50 py-16 text-center">
          {view === "active" ? (state?.open ? "Няма чакащи поръчки." : "Няма чакащи поръчки. Приемането на поръчки не е отворено — виж „Вечерта“.") : "Няма поръчки тук."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((o) => (
            <OrderCard key={o.id} order={o} flash={flash.has(o.id)} onMove={onMove} onCancel={() => setCancelling(o)} />
          ))}
        </div>
      )}

      {cancelling && <CancelDialog order={cancelling} onClose={() => setCancelling(null)} onConfirm={(reason) => { onMove(cancelling, "cancel", reason); setCancelling(null); }} />}
    </>
  );
}

function OrderCard({ order, flash, onMove, onCancel }) {
  const s = STATUS[order.status];
  const minutes = (Date.now() / 1000 - order.createdAt) / 60;
  const active = order.status === "new" || order.status === "accepted";
  const late = active && minutes > 20 ? "text-red-300" : active && minutes > 10 ? "text-amber-300" : "text-cream-100/60";
  const next = NEXT[order.status];
  return (
    <article className={`border-2 rounded-sm bg-ink-900 p-4 transition-shadow ${s.card} ${flash ? "ring-4 ring-gold-300/70 animate-pulse" : ""}`} data-order={order.code}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-cream-100/50">Маса</div>
          {/* Sans-serif on purpose: in the display face "11" reads as "II". */}
          <div className="font-sans font-semibold tabular-nums text-6xl leading-none text-cream-50">{order.table}</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg text-gold-100">{order.code}</div>
          <div className="text-sm text-cream-100/70">{clock(order.createdAt)}</div>
          <div className={`text-sm ${late}`}>{elapsed(order.createdAt)}</div>
        </div>
      </div>
      <ul className="mt-3 border-t border-gold-300/15 pt-3 space-y-2">
        {order.lines.map((l, i) => (
          <li key={i} className="text-cream-50">
            <span className="font-semibold text-lg">{l.qty} ×</span> {l.nameBg}
            {l.detailBg ? <span className="text-cream-100/70"> · {l.detailBg}</span> : null}
            {l.note && <div className="mt-1 ml-6 inline-block bg-gold-300/20 text-gold-50 px-2 py-0.5 rounded-sm text-sm">„{l.note}“</div>}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between mt-3 border-t border-gold-300/15 pt-3">
        <span className="text-cream-50 flex items-center gap-2 flex-wrap">
          <span>
            Общо <span className="font-semibold">{money(order.total)}</span>
          </span>
          <PayChip order={order} />
        </span>
        <span className={`text-xs px-3 py-1 border rounded-full ${s.tone}`}>{s.label}</span>
      </div>
      {order.status === "cancelled" && order.cancelReason && <p className="text-sm text-red-300/90 mt-2">Причина: {order.cancelReason}</p>}
      {active && (
        <div className="flex gap-2 mt-4">
          {next && (
            <button type="button" onClick={() => onMove(order, next.action)} className="btn-gold flex-1 h-14 rounded-sm text-sm tracking-[0.15em] uppercase font-semibold">
              {next.label}
            </button>
          )}
          <button type="button" onClick={onCancel} className="h-14 px-4 rounded-sm border border-red-400/40 text-red-300 text-sm">
            Откажи
          </button>
        </div>
      )}
    </article>
  );
}

function CancelDialog({ order, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Отказ на поръчка">
      <button type="button" aria-label="Затвори" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-md bg-ink-900 border border-gold-300/25 rounded-sm p-6">
        <h2 className="font-display text-2xl text-cream-50">
          Откажи {order.code} · маса {order.table}
        </h2>
        <p className="text-sm text-cream-100/60 mt-1">Причината се вижда и от госта.</p>
        {order.payStatus === "paid" && (
          <p className="text-sm text-gold-100 mt-3 border border-gold-300/30 rounded-sm px-3 py-2">
            Гостът е платил {money(order.total)} онлайн. Сумата ще му бъде върната автоматично.
          </p>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={`px-3 py-2 rounded-full text-sm border ${reason === r ? "border-gold-300 bg-gold-300/15 text-gold-100" : "border-gold-300/25 text-cream-100/80"}`}>
              {r}
            </button>
          ))}
        </div>
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="или напишете причина" className="mt-3 w-full bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-3 text-cream-50" />
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-sm border border-gold-300/25 text-cream-100/80">Назад</button>
          <button type="button" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())} className="flex-1 h-12 rounded-sm bg-red-700 disabled:bg-ink-700 disabled:text-cream-100/40 text-cream-50 font-medium">
            Откажи поръчката
          </button>
        </div>
      </div>
    </div>
  );
}

function Service({ state, onSaved, say, onSignedOut }) {
  const today = sofiaDate(Math.floor(Date.now() / 1000));
  const [form, setForm] = useState(() => ({
    date: state?.serviceDate && state.serviceDate >= today ? state.serviceDate : today,
    opens: state?.opens || "18:00",
    closes: state?.closes || "23:00",
    tables: state?.tables || 10,
    disabled: new Set(state?.disabledTables || []),
    payment: state?.paymentMode === "online" && state?.paymentsConfigured ? "online" : "on_site",
  }));
  const [busy, setBusy] = useState(false);
  const nextDay = form.closes <= form.opens;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const count = Math.max(0, Math.min(300, Number(form.tables) || 0));

  async function save() {
    setBusy(true);
    try {
      const res = await adminApi("settings.php", {
        date: form.date,
        opens: form.opens,
        closes: form.closes,
        tables: count,
        disabledTables: [...form.disabled].filter((n) => n <= count),
        paused: false,
        paymentMode: form.payment,
      });
      if (res.status === 401) return onSignedOut();
      if (res.ok) {
        onSaved(res.state);
        say("Записано. Приемането на поръчки следва новите настройки.");
      } else
        say(
          res.field === "window"
            ? "Невалидна дата или час."
            : res.field === "tables"
              ? "Броят маси трябва да е между 1 и 300."
              : res.error === "payments_not_configured"
                ? "Плащането с карта не е настроено на сървъра (Stripe) — виж docs/qr-ordering/SETUP.md."
                : "Не успях да запиша."
        );
    } catch {
      say("Няма връзка — настройките не са записани.");
    } finally {
      setBusy(false);
    }
  }
  async function togglePause() {
    try {
      const res = await adminApi("settings.php", { paused: !state?.paused });
      if (res.status === 401) return onSignedOut();
      if (res.ok) onSaved(res.state);
    } catch {
      say("Няма връзка — опитайте отново.");
    }
  }

  return (
    <div className="max-w-2xl">
      {state && state.opensAt > 0 && (
        <div className="border border-gold-300/20 bg-ink-900 rounded-sm p-5 mb-6">
          <p className="text-cream-50">
            {state.open ? "Приемаме поръчки" : state.reason === "paused" ? "Приемането е на ПАУЗА" : state.reason === "not_yet_open" ? "Още не приемаме поръчки" : "Приемането е приключило"}
            {" · "}
            {state.serviceDate} от {state.opens} до {state.closes}
            {state.closes <= state.opens ? " (следващия ден)" : ""} · {state.tables} маси
            {" · "}
            {state.payment === "online" ? "плащане с карта в телефона" : "плащане при сервитьора"}
          </p>
          {state.payment === "online" && state.paymentsTest && (
            <p className="text-sm text-amber-300 mt-2">ТЕСТОВ РЕЖИМ: плащанията не са истински (тестов ключ на Stripe).</p>
          )}
          <button
            type="button"
            onClick={togglePause}
            className={`mt-4 w-full h-16 rounded-sm text-lg font-semibold tracking-[0.1em] uppercase ${state.paused ? "btn-gold" : "bg-red-800 text-cream-50"}`}
          >
            {state.paused ? "Поднови приемането" : "Пауза"}
          </button>
          <p className="text-xs text-cream-100/50 mt-2">Пауза спира само новите поръчки. Приетите продължават да се обработват.</p>
        </div>
      )}

      <h2 className="font-display text-3xl text-cream-50">Вечерта</h2>
      <div className="grid sm:grid-cols-3 gap-4 mt-4">
        <Field label="Дата">
          <input type="date" value={form.date} onChange={set("date")} className={inputClass} />
        </Field>
        <Field label="Поръчки от">
          <input type="time" value={form.opens} onChange={set("opens")} className={inputClass} />
        </Field>
        <Field label={`до${nextDay ? " (следващия ден)" : ""}`}>
          <input type="time" value={form.closes} onChange={set("closes")} className={inputClass} />
        </Field>
      </div>
      <Field label="Брой маси" className="mt-4 max-w-[12rem]">
        <input type="number" inputMode="numeric" min="1" max="300" value={form.tables} onChange={set("tables")} className={inputClass} />
      </Field>
      {count > 0 && (
        <div className="mt-5">
          <div className="text-xs tracking-[0.2em] uppercase text-gold-300/80">Маси, които не приемат поръчки</div>
          <p className="text-xs text-cream-100/50 mt-1">Докоснете номер, за да го изключите.</p>
          <div className="grid grid-cols-6 sm:grid-cols-10 gap-2 mt-3">
            {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
              const off = form.disabled.has(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() =>
                    setForm((f) => {
                      const d = new Set(f.disabled);
                      if (d.has(n)) d.delete(n);
                      else d.add(n);
                      return { ...f, disabled: d };
                    })
                  }
                  aria-pressed={off}
                  className={`h-11 rounded-sm text-sm ${off ? "bg-red-900/60 text-red-200 line-through" : "border border-gold-300/25 text-cream-50"}`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="mt-6">
        <div className="text-xs tracking-[0.2em] uppercase text-gold-300/80">Плащане</div>
        <div className="grid sm:grid-cols-2 gap-2 mt-2">
          {[
            ["on_site", "При сервитьора", "Поръчката идва веднага; плаща се на място."],
            ["online", "С карта в телефона", "Поръчката идва, щом гостът плати. Отказ = автоматично връщане на парите."],
          ].map(([id, label, hint]) => {
            const unavailable = id === "online" && !state?.paymentsConfigured;
            return (
              <button
                key={id}
                type="button"
                disabled={unavailable}
                aria-pressed={form.payment === id}
                onClick={() => setForm((f) => ({ ...f, payment: id }))}
                className={`text-left rounded-sm p-3 border ${form.payment === id ? "border-gold-300 bg-gold-300/15" : "border-gold-300/25"} disabled:opacity-40`}
              >
                <span className="block text-cream-50">{label}</span>
                <span className="block text-xs text-cream-100/60 mt-1">{unavailable ? "Stripe не е настроен на сървъра — виж SETUP.md." : hint}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" onClick={save} disabled={busy || count < 1} className="btn-gold mt-6 w-full h-14 rounded-sm text-sm tracking-[0.2em] uppercase font-semibold">
        {busy ? "Записване…" : "Запази и активирай"}
      </button>
    </div>
  );
}

/**
 * "За касата": what guests paid on the phone still has to be entered in the
 * till (Clock) by hand; refunds of orders already entered have to be voided
 * there. Oldest first. Ticks sync to every tablet.
 */
function Till({ orders, onTill }) {
  const all = [...orders.values()].filter((o) => o.payStatus === "paid" || o.payStatus === "refunded");
  const toEnter = all.filter((o) => o.payStatus === "paid" && !o.tillAt).sort((a, b) => a.paidAt - b.paidAt);
  const toVoid = all.filter((o) => o.payStatus === "refunded" && o.tillAt > 0 && !o.tillVoidAt).sort((a, b) => a.updatedAt - b.updatedAt);
  const done = all.filter((o) => o.tillAt > 0 && !toVoid.includes(o)).sort((a, b) => b.tillAt - a.tillAt).slice(0, 30);
  const Row = ({ order, children }) => (
    <li className="border border-gold-300/20 bg-ink-900 rounded-sm p-4 flex flex-wrap items-center gap-4" data-till={order.code}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg text-gold-100">{order.code}</span>
          <span className="text-cream-100/70">маса {order.table}</span>
          <span className="text-cream-100/50 text-sm">{clock(order.paidAt || order.createdAt)}</span>
        </div>
        <div className="text-sm text-cream-100/80 mt-1">{order.lines.map((l) => `${l.qty} × ${l.nameBg}${l.detailBg ? ` · ${l.detailBg}` : ""}`).join(", ")}</div>
      </div>
      <div className="font-semibold text-cream-50 text-lg">{money(order.total)}</div>
      {children}
    </li>
  );
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-cream-100/60">
        Платените онлайн поръчки се въвеждат в Clock ръчно, с плащане „карта“. Отметнете всяка, след като я въведете.
      </p>
      {toVoid.length > 0 && (
        <>
          <h2 className="font-display text-2xl text-red-300 mt-6">Сторнирай в Clock</h2>
          <p className="text-sm text-cream-100/60 mt-1">Върнати на госта, след като вече са въведени.</p>
          <ul className="space-y-3 mt-3">
            {toVoid.map((o) => (
              <Row key={o.id} order={o}>
                <button type="button" onClick={() => onTill(o, { voided: true })} className="h-12 px-4 rounded-sm bg-red-800 text-cream-50 text-sm">Сторнирана ✓</button>
              </Row>
            ))}
          </ul>
        </>
      )}
      <h2 className="font-display text-2xl text-cream-50 mt-6">За въвеждане {toEnter.length ? `(${toEnter.length})` : ""}</h2>
      {toEnter.length === 0 ? (
        <p className="text-cream-100/50 py-6">Всичко е въведено.</p>
      ) : (
        <ul className="space-y-3 mt-3">
          {toEnter.map((o) => (
            <Row key={o.id} order={o}>
              <button type="button" onClick={() => onTill(o, { entered: true })} className="btn-gold h-12 px-4 rounded-sm text-sm">Въведена в Clock ✓</button>
            </Row>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-8">
          <summary className="text-sm text-cream-100/60 cursor-pointer">Въведени ({done.length})</summary>
          <ul className="space-y-2 mt-3 opacity-80">
            {done.map((o) => (
              <Row key={o.id} order={o}>
                <button type="button" onClick={() => onTill(o, { entered: false })} className="h-10 px-3 rounded-sm border border-gold-300/25 text-xs text-cream-100/70">Върни в списъка</button>
              </Row>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const inputClass = "mt-2 w-full bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-3 text-cream-50 [color-scheme:dark]";
function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs tracking-[0.2em] uppercase text-gold-300/80">{label}</span>
      {children}
    </label>
  );
}

function SoldOut({ soldOut, setSoldOut, say, onSignedOut }) {
  const [query, setQuery] = useState("");
  const off = new Set(soldOut);
  const q = query.trim().toLowerCase();
  const shown = ITEMS.filter((i) => i.orderable !== false && (!q || i.bg.toLowerCase().includes(q) || i.en.toLowerCase().includes(q)));
  async function toggle(item) {
    try {
      const res = await adminApi("sold-out.php", { itemId: item.id, soldOut: !off.has(item.id) });
      if (res.status === 401) return onSignedOut();
      if (res.ok) setSoldOut(res.soldOut);
      else say("Не успях да запиша.");
    } catch {
      say("Няма връзка — опитайте отново.");
    }
  }
  let lastCategory = "";
  return (
    <div className="max-w-2xl">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Търсене в менюто" className={`${inputClass} mt-0`} />
      {soldOut.length > 0 && <p className="text-sm text-red-300 mt-3">Изчерпани сега: {soldOut.map((id) => ITEMS.find((i) => i.id === id)?.bg || id).join(", ")}</p>}
      <ul className="mt-4">
        {shown.map((item) => {
          const header = item.category !== lastCategory ? item.category : null;
          lastCategory = item.category;
          return (
            <li key={item.id}>
              {header && <div className="text-xs tracking-[0.2em] uppercase text-gold-300/70 mt-5 mb-2">{header}</div>}
              <div className="flex items-center justify-between gap-3 py-2 border-b border-gold-300/10">
                <span className={off.has(item.id) ? "text-cream-100/40 line-through" : "text-cream-50"}>{item.bg}</span>
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  aria-pressed={off.has(item.id)}
                  className={`shrink-0 h-10 w-32 rounded-sm text-sm ${off.has(item.id) ? "bg-red-900/60 text-red-200" : "border border-sage-300/50 text-sage-200"}`}
                >
                  {off.has(item.id) ? "Изчерпано" : "Налично"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
