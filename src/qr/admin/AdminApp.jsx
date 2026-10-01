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
//
// On "pay at the end" evenings orders arrive at once and collect on their
// table's bill. "Сметки" shows each table's bill: what is paid on phones,
// what staff took on the spot, what is left; staff settle the rest and close
// the bill. Payments from bills go on "За касата" too, at their net amount,
// with any tip shown beside it.
//
// One line of an order can be taken off on its own ("Няма"): some or all of
// it, with a reason the guest sees. Whatever was paid for it goes back to
// whoever paid; the rest of the order goes on.
//
// Kitchen and bar: food is made in the kitchen, drinks at the bar (each menu
// category says which). An order with both is two cards, one per station,
// each accepted and served on its own. A tablet shows the kitchen, the bar,
// or both side by side ("Двете"), remembers the choice, and chimes only for
// what it shows.

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
const STATIONS = { kitchen: "Кухня", bar: "Бар" };
const STATION_OF = { kitchen: "кухнята", bar: "бара" };
const STATION_THE = { kitchen: "Кухнята", bar: "Барът" };
const VIEW_KEY = "raya.qr.station"; // this tablet's choice: kitchen, bar or both

/**
 * An order as the stations see it: one job per station it has lines for,
 * with that station's status (the order's own once it is cancelled).
 */
function jobsOf(order) {
  return Object.keys(STATIONS)
    .filter((st) => order.stations?.[st])
    .map((st) => ({ order, station: st, status: order.status === "cancelled" ? "cancelled" : order.stations[st] }));
}
const shows = (view, station) => view === "both" || view === station;

function storedView() {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    return v === "kitchen" || v === "bar" ? v : "both";
  } catch {
    return "both";
  }
}
const LINE_REASONS = ["Изчерпан продукт", "Гостът се отказа", "Грешка в поръчката"];
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
  const [tabs, setTabs] = useState(() => new Map());
  const [billPayments, setBillPayments] = useState(() => new Map());
  const [state, setState] = useState(null);
  const [soldOut, setSoldOut] = useState([]);
  const [offline, setOffline] = useState(false);
  const [flash, setFlash] = useState(() => new Set());
  const [tab, setTab] = useState("orders");
  const [stationView, setStationViewState] = useState(storedView);
  const setStationView = (v) => {
    setStationViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* the choice lasts until the page is reloaded */
    }
  };
  const viewRef = useRef(stationView);
  viewRef.current = stationView;
  const [toast, setToast] = useState("");
  const [, tick] = useState(0);
  const seq = useRef(0);
  // The change number the shown settings belong to. A poll that was already
  // on its way when staff pressed Pause must not put the old state back.
  const stateSeq = useRef(0);
  const applyState = useCallback((next, at) => {
    if (at < stateSeq.current) return;
    stateSeq.current = at;
    setState(next);
  }, []);
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
  /**
   * Tabs and bill payments: the newest version by change number wins. Laid
   * over the one held, so an answer that leaves a field out (a payment's
   * lines) never takes it away.
   */
  const mergeBy = (setter) => (list, full) =>
    setter((prev) => {
      const next = full ? new Map() : new Map(prev);
      for (const x of list || []) {
        const old = next.get(x.id);
        if (!old || old.seq <= x.seq) next.set(x.id, old ? { ...old, ...x } : x);
      }
      return next;
    });
  const mergeTabs = useCallback(mergeBy(setTabs), []);
  const mergeBillPayments = useCallback(mergeBy(setBillPayments), []);

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
        // New for this tablet: an order it has not seen with something new for a station it shows.
        const isNew = res.orders.filter(
          (o) => loaded.current && !ordersRef.current.has(o.id) && jobsOf(o).some((j) => j.status === "new" && shows(viewRef.current, j.station))
        );
        merge(res.orders, res.full);
        mergeTabs(res.tabs, res.full);
        mergeBillPayments(res.billPayments, res.full);
        seq.current = res.seq;
        applyState(res.state, res.seq);
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
  }, [merge, mergeTabs, mergeBillPayments, applyState, onSignedOut]);
  // "преди 7 мин" moves on by itself.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const say = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 5000);
  };

  /** Move one station's part of an order on, or cancel it (the whole order when nothing else is left). */
  async function move(job, action, reason) {
    const { order, station } = job;
    const partOnly = action === "cancel" && jobsOf(order).some((j) => j.station !== station && j.status !== "cancelled");
    try {
      const res = await adminApi("order.php", { id: order.id, action, station, from: job.status, ...(reason ? { reason } : {}) });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      if (res.error === "stale") say("Поръчката вече е променена от друго устройство — показвам я както е сега.");
      else if (res.error === "refund_failed") say("Връщането на парите не успя, затова поръчката НЕ е отказана. Опитайте отново след малко.");
      else if (!res.ok) say("Не успях да променя поръчката. Опитайте отново.");
      else if (partOnly && res.order?.status !== "cancelled") {
        const part = `Частта за ${STATION_OF[station]} от ${order.code} е отказана`;
        if (res.refundPending) say(`${part}, но връщането на ${money(res.amount)} не успя — натиснете „Върни сега“.`);
        else if (res.cashBack) say(`${part}. Върнете ${money(res.cashBack)} на госта — беше платено на място.`);
        else if (order.payStatus === "paid" || order.lines.some((l) => l.station === station && l.paidVia === "online")) say(`${part}, ${money(res.amount)} са върнати на госта.`);
        else say(`${part}. ${STATION_THE[station === "kitchen" ? "bar" : "kitchen"]} продължава.`);
      }
      else if (action === "cancel" && res.refundPending) say(`${res.order.code} е отказана, но връщането на парите не успя — опитайте пак от „Сметки“.`);
      else if (action === "cancel" && res.order?.payStatus === "refunded")
        say(res.order.tabId ? `${res.order.code} е отказана, платеното за нея е върнато на госта.` : `${res.order.code} е отказана, ${money(res.order.total)} са върнати на госта.`);
    } catch {
      say("Няма връзка — промяната не е записана. Опитайте отново.");
    }
  }

  /** Cancel qty of one line, not the whole order. */
  async function voidLine(order, line, qty, reason) {
    try {
      const res = await adminApi("order.php", { id: order.id, action: "void", line: line.line, qty, have: line.qty, reason });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      const what = `${qty} × ${line.nameBg}`;
      if (res.error === "stale") say("Поръчката вече е променена от друго устройство — показвам я както е сега.");
      else if (res.error === "last_line") say("Това е последното в поръчката — откажете цялата поръчка.");
      else if (!res.ok) say("Не успях да откажа реда. Опитайте отново.");
      else if (res.refundPending) say(`${what} е отказано, но връщането на ${money(res.amount)} не успя — натиснете „Върни сега“.`);
      else if (res.cashBack) say(`${what} е отказано. Върнете ${money(res.cashBack)} на госта — беше платено на място.`);
      else if (order.payStatus === "paid" || line.paidVia === "online") say(`${what} е отказано, ${money(res.amount)} са върнати на госта.`);
      else say(`${what} е отказано. Новата сума е ${money(res.order.total)}.`);
    } catch {
      say("Няма връзка — промяната не е записана. Опитайте отново.");
    }
  }

  async function refundOrder(order) {
    try {
      const res = await adminApi("order.php", { id: order.id, action: "refund" });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      say(res.ok ? `Сумата е върната на госта (${order.code}).` : "Stripe отново отказа връщането. Опитайте след малко.");
    } catch {
      say("Няма връзка — опитайте отново.");
    }
  }

  async function till(entry, change) {
    try {
      const res = await adminApi("till.php", { ...(entry.kind === "bill" ? { paymentId: entry.id } : { id: entry.id }), ...change });
      if (res.status === 401) return onSignedOut();
      if (res.order) merge([res.order], false);
      if (res.payment) mergeBillPayments([res.payment], false);
      if (!res.ok) say("Не успях да запиша. Опитайте отново.");
    } catch {
      say("Няма връзка — отметката не е записана. Опитайте отново.");
    }
  }

  async function billAction(body, done) {
    try {
      const res = await adminApi("bill.php", body);
      if (res.status === 401) return onSignedOut();
      if (res.tab) mergeTabs([res.tab], false);
      if (res.payment) mergeBillPayments([res.payment], false);
      if (res.ok) say(done);
      else if (res.error === "unpaid") say(`Сметката не може да се затвори: остават ${money(res.unpaid)} неплатени.`);
      else if (res.error === "refund_failed") say("Stripe отново отказа връщането. Опитайте след малко.");
      else say("Не успях да запиша. Опитайте отново.");
    } catch {
      say("Няма връзка — опитайте отново.");
    }
  }

  const newCount = [...orders.values()].flatMap(jobsOf).filter((j) => j.status === "new" && shows(stationView, j.station)).length;
  const tillEntries = tillList(orders, billPayments);
  const tillCount = tillEntries.filter((e) => e.todo).length;
  const showTill = Boolean(state?.paymentsConfigured) || tillEntries.length > 0;
  const openTabs = [...tabs.values()].filter((x) => !x.closedAt);
  const owedTabs = openTabs.filter((x) => x.totals.unpaid > 0 || x.payments.some((p) => p.refundDue > 0)).length;
  const showTabs = state?.payment === "tab" || tabs.size > 0;

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
              <button type="button" onClick={chime.enable} className="h-10 sm:h-11 px-3 sm:px-4 rounded-sm btn-gold text-xs tracking-[0.15em] uppercase font-medium">
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
              className="h-10 sm:h-11 px-3 sm:px-4 rounded-sm border border-gold-300/25 text-xs text-cream-100/70"
            >
              Изход
            </button>
          </div>
        </div>
        {/* On a phone the tabs scroll sideways rather than wrap or run off the edge. */}
        <nav className="max-w-7xl mx-auto px-2 flex gap-1 overflow-x-auto">
          {[
            ["orders", `Поръчки${newCount ? ` (${newCount} нови)` : ""}`],
            ["service", "Вечерта"],
            ["soldout", `Изчерпани${soldOut.length ? ` (${soldOut.length})` : ""}`],
            ...(showTabs ? [["tabs", `Сметки${owedTabs ? ` (${owedTabs})` : ""}`]] : []),
            ...(showTill ? [["till", `За касата${tillCount ? ` (${tillCount})` : ""}`]] : []),
          ].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 whitespace-nowrap px-3 sm:px-4 py-3 text-sm border-b-2 ${tab === id ? "border-gold-300 text-gold-100" : "border-transparent text-cream-100/60"}`}>
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
        {tab === "orders" && (
          <Orders orders={orders} flash={flash} state={state} stationView={stationView} setStationView={setStationView} onMove={move} onVoid={voidLine} onRefund={refundOrder} />
        )}
        {tab === "service" && <Service state={state} onSaved={applyState} say={say} onSignedOut={onSignedOut} />}
        {tab === "soldout" && <SoldOut soldOut={soldOut} setSoldOut={setSoldOut} say={say} onSignedOut={onSignedOut} />}
        {tab === "tabs" && <Tabs tabs={tabs} onAction={billAction} />}
        {tab === "till" && <Till entries={tillEntries} onTill={till} />}
      </main>

      {toast && (
        <div role="status" className="fixed bottom-4 inset-x-4 z-30 max-w-lg mx-auto bg-ink-800 border border-gold-300/30 rounded-sm px-4 py-3 text-sm text-cream-50 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function PayChip({ order }) {
  if (order.payStatus === "paid") return <span className="text-xs px-2 py-1 rounded-sm bg-sage-500/30 text-sage-100">Платена онлайн</span>;
  if (order.payStatus === "refunded") return <span className="text-xs px-2 py-1 rounded-sm bg-gold-300/20 text-gold-100">Сумата е върната</span>;
  if (order.payStatus === "tab") return <span className="text-xs px-2 py-1 rounded-sm border border-cream-100/20 text-cream-100/70">По сметка</span>;
  if (order.payStatus === "tab_partial") return <span className="text-xs px-2 py-1 rounded-sm bg-gold-300/20 text-gold-100">Частично платена</span>;
  if (order.payStatus === "tab_paid") return <span className="text-xs px-2 py-1 rounded-sm bg-sage-500/30 text-sage-100">Платена</span>;
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

function Orders({ orders, flash, state, stationView, setStationView, onMove, onVoid, onRefund }) {
  const [view, setView] = useState("active");
  const [table, setTable] = useState("");
  const [cancelling, setCancelling] = useState(null); // a job
  const [voiding, setVoiding] = useState(null); // { order, line }
  const jobs = useMemo(() => {
    const active = view === "active";
    return [...orders.values()]
      .filter((o) => (table ? o.table === Number(table) : true))
      .flatMap(jobsOf)
      .filter((j) => (view === "all" ? true : active ? j.status === "new" || j.status === "accepted" : j.status === "served" || j.status === "cancelled"))
      .sort((a, b) => (active ? a.order.createdAt - b.order.createdAt : b.order.createdAt - a.order.createdAt));
  }, [orders, view, table]);
  const tables = useMemo(() => [...new Set([...orders.values()].map((o) => o.table))].sort((a, b) => a - b), [orders]);
  const waiting = (st) => [...orders.values()].flatMap(jobsOf).filter((j) => j.station === st && (j.status === "new" || j.status === "accepted")).length;
  const shown = Object.keys(STATIONS).filter((st) => shows(stationView, st));
  const empty = view === "active" ? (state?.open ? "Няма чакащи поръчки." : "Няма чакащи поръчки. Приемането на поръчки не е отворено — виж „Вечерта“.") : "Няма поръчки тук.";

  const card = (j) => (
    <OrderCard
      key={`${j.order.id}:${j.station}`}
      job={j}
      flash={flash.has(j.order.id)}
      onMove={onMove}
      onCancel={() => setCancelling(j)}
      onVoid={(line) => setVoiding({ order: j.order, line })}
      onRefund={() => onRefund(j.order)}
    />
  );

  return (
    <>
      <div className="flex gap-2 mb-3" role="group" aria-label="Кухня или бар">
        {[...Object.entries(STATIONS), ["both", "Двете"]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={stationView === id}
            onClick={() => setStationView(id)}
            className={`flex-1 sm:flex-none h-12 px-5 rounded-sm text-sm font-medium border ${stationView === id ? "btn-gold border-transparent" : "border-gold-300/30 text-cream-100/80"}`}
          >
            {label}
            {id !== "both" && waiting(id) > 0 ? ` (${waiting(id)})` : ""}
          </button>
        ))}
      </div>
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

      {shown.length === 1 ? (
        jobs.filter((j) => j.station === shown[0]).length === 0 ? (
          <p className="text-cream-100/50 py-16 text-center">{empty}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-station-list={shown[0]}>
            {jobs.filter((j) => j.station === shown[0]).map(card)}
          </div>
        )
      ) : (
        // Both on one page, still apart: the kitchen on the left, the bar on the right.
        <div className="grid gap-6 lg:grid-cols-2">
          {shown.map((st) => {
            const mine = jobs.filter((j) => j.station === st);
            return (
              <section key={st} aria-label={STATIONS[st]} data-station-list={st}>
                <h2 className="font-display text-2xl text-cream-50 border-b border-gold-300/20 pb-2 mb-3">
                  {STATIONS[st]} <span className="font-sans text-base text-cream-100/50">({mine.length})</span>
                </h2>
                {mine.length === 0 ? <p className="text-cream-100/50 py-8 text-center">{empty}</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">{mine.map(card)}</div>}
              </section>
            );
          })}
        </div>
      )}

      {cancelling && <CancelDialog job={cancelling} onClose={() => setCancelling(null)} onConfirm={(reason) => { onMove(cancelling, "cancel", reason); setCancelling(null); }} />}
      {voiding && (
        <VoidDialog
          order={voiding.order}
          line={voiding.line}
          onClose={() => setVoiding(null)}
          onConfirm={(qty, reason) => {
            onVoid(voiding.order, voiding.line, qty, reason);
            setVoiding(null);
          }}
        />
      )}
    </>
  );
}

/** One station's part of an order: its lines, its status, its buttons. */
function OrderCard({ job, flash, onMove, onCancel, onVoid, onRefund }) {
  const { order, station } = job;
  const s = STATUS[job.status];
  const minutes = (Date.now() / 1000 - order.createdAt) / 60;
  const active = job.status === "new" || job.status === "accepted";
  const lines = order.lines.filter((l) => l.station === station);
  // One line can be cancelled on its own while anything else stays on the
  // order; the last thing left is cancelling the order.
  const units = order.lines.reduce((n, l) => n + l.qty, 0);
  const canVoid = (active || job.status === "served") && order.status !== "cancelled" && units > 1;
  const late = active && minutes > 20 ? "text-red-300" : active && minutes > 10 ? "text-amber-300" : "text-cream-100/60";
  const next = NEXT[job.status];
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  // The other station's part of the same order, for whoever brings it out.
  const other = jobsOf(order).find((j) => j.station !== station);
  return (
    <article className={`border-2 rounded-sm bg-ink-900 p-4 transition-shadow ${s.card} ${flash ? "ring-4 ring-gold-300/70 animate-pulse" : ""}`} data-order={order.code} data-station={station}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] tracking-[0.25em] uppercase text-cream-100/50">Маса</div>
          {/* Sans-serif on purpose: in the display face "11" reads as "II". */}
          <div className="font-sans font-semibold tabular-nums text-6xl leading-none text-cream-50">{order.table}</div>
          {/* The name the guest gave when ordering: to call out at the table. */}
          {order.guestName && <div className="text-xl text-gold-100 mt-2" data-guest-name>{order.guestName}</div>}
        </div>
        <div className="text-right">
          <div className={`inline-block text-[10px] tracking-[0.25em] uppercase px-2 py-0.5 rounded-sm mb-1 ${station === "bar" ? "bg-sky-900/60 text-sky-100" : "bg-amber-900/50 text-amber-100"}`}>{STATIONS[station]}</div>
          <div className="font-mono text-lg text-gold-100">{order.code}</div>
          <div className="text-sm text-cream-100/70">{clock(order.createdAt)}</div>
          <div className={`text-sm ${late}`}>{elapsed(order.createdAt)}</div>
        </div>
      </div>
      <ul className="mt-3 border-t border-gold-300/15 pt-3 space-y-2">
        {lines.map((l) => (
          <li key={l.line} className="text-cream-50 flex items-start gap-2" data-line={l.line}>
            <div className={`min-w-0 flex-1 ${l.qty === 0 ? "opacity-50" : ""}`}>
              <span className={l.qty === 0 ? "line-through" : ""}>
                <span className="font-semibold text-lg">{l.qty === 0 ? l.voidQty : l.qty} ×</span> {l.nameBg}
                {l.detailBg ? <span className="text-cream-100/70"> · {l.detailBg}</span> : null}
              </span>
              {l.voidQty > 0 && (
                <div className="text-sm text-red-300/90">
                  {l.qty === 0 ? "Отказано" : `${l.voidQty} отказан${l.voidQty === 1 ? "" : "и"}`}: {l.voidReason}
                </div>
              )}
              {l.note && <div className="mt-1 ml-6 inline-block bg-gold-300/20 text-gold-50 px-2 py-0.5 rounded-sm text-sm">„{l.note}“</div>}
            </div>
            {canVoid && l.qty > 0 && (
              <button type="button" onClick={() => onVoid(l)} aria-label={`Откажи само ${l.nameBg}`} className="shrink-0 h-9 px-2 rounded-sm border border-red-400/30 text-red-300/90 text-xs">
                Няма
              </button>
            )}
          </li>
        ))}
      </ul>
      {other && (
        <p className="text-xs text-cream-100/50 mt-2">
          + {STATIONS[other.station].toLowerCase()}: {order.lines.filter((l) => l.station === other.station && l.qty > 0).reduce((n, l) => n + l.qty, 0)} бр. · {STATUS[other.status]?.label.toLowerCase()}
        </p>
      )}
      <div className="flex items-center justify-between mt-3 border-t border-gold-300/15 pt-3">
        <span className="text-cream-50 flex items-center gap-2 flex-wrap">
          <span>
            {other ? `${STATIONS[station]}: ` : "Общо "}
            <span className="font-semibold">{money(other ? subtotal : order.total)}</span>
            {order.voided > 0 && order.status !== "cancelled" && !other && <span className="text-xs text-cream-100/60"> (отказано {money(order.voided)})</span>}
          </span>
          <PayChip order={order} />
          {order.payerName && <span className="text-xs text-cream-100/70">платил: {order.payerName}</span>}
        </span>
        <span className={`text-xs px-3 py-1 border rounded-full ${s.tone}`}>{s.label}</span>
      </div>
      {order.status === "cancelled" && order.cancelReason && <p className="text-sm text-red-300/90 mt-2">Причина: {order.cancelReason}</p>}
      {order.refundDue > 0 && (
        <div className="mt-3 border border-red-400/40 bg-red-950/30 rounded-sm px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
          <span className="text-cream-50">Дължим на госта {money(order.refundDue)}{order.refundError ? " — връщането не успя" : " — връща се…"}</span>
          <button type="button" onClick={onRefund} className="h-10 px-3 rounded-sm border border-red-300/50 text-red-200 text-xs">
            Върни сега
          </button>
        </div>
      )}
      {active && (
        <div className="flex gap-2 mt-4">
          {next && (
            <button type="button" onClick={() => onMove(job, next.action)} className="btn-gold flex-1 h-14 rounded-sm text-sm tracking-[0.15em] uppercase font-semibold">
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

/**
 * Cancel a station's part of an order — or the whole order, when that part
 * is all that is left to make. What happens to the money is said first.
 */
function CancelDialog({ job, onClose, onConfirm }) {
  const { order, station } = job;
  const [reason, setReason] = useState("");
  const partOnly = jobsOf(order).some((j) => j.station !== station && j.status !== "cancelled");
  const lines = order.lines.filter((l) => l.station === station && l.qty > 0);
  const part = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const otherName = STATION_THE[station === "kitchen" ? "bar" : "kitchen"];
  let moneyNote = null;
  if (partOnly) {
    if (order.payStatus === "paid") moneyNote = `Гостът е платил онлайн: ${money(part)} ще му бъдат върнати автоматично.`;
    else if (lines.some((l) => l.paidVia === "online")) moneyNote = "Платеното от сметката на масата за тези редове ще бъде върнато автоматично на платилия.";
    else if (lines.some((l) => l.paidVia === "staff")) moneyNote = "Част от тези редове е платена на място — таблетът ще каже колко да върнете.";
  } else if (order.payStatus === "paid") moneyNote = `Гостът е платил ${money(order.total)} онлайн. Сумата ще му бъде върната автоматично.`;
  else if (order.payStatus === "tab_paid" || order.payStatus === "tab_partial") moneyNote = "Част от поръчката е платена от сметката на масата. Платеното онлайн ще бъде върнато автоматично на платилия.";
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Отказ на поръчка">
      <button type="button" aria-label="Затвори" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-md bg-ink-900 border border-gold-300/25 rounded-sm p-6">
        <h2 className="font-display text-2xl text-cream-50">
          {partOnly ? `Откажи частта за ${STATION_OF[station]}` : `Откажи ${order.code}`} · маса {order.table}
        </h2>
        <p className="text-sm text-cream-100/60 mt-1">
          {partOnly ? `${lines.map((l) => `${l.qty} × ${l.nameBg}`).join(", ")}. ${otherName} продължава с останалото. ` : ""}Причината се вижда и от госта.
        </p>
        {moneyNote && <p className="text-sm text-gold-100 mt-3 border border-gold-300/30 rounded-sm px-3 py-2">{moneyNote}</p>}
        <div className="flex flex-wrap gap-2 mt-4">
          {(partOnly ? LINE_REASONS : REASONS).map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={`px-3 py-2 rounded-full text-sm border ${reason === r ? "border-gold-300 bg-gold-300/15 text-gold-100" : "border-gold-300/25 text-cream-100/80"}`}>
              {r}
            </button>
          ))}
        </div>
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="или напишете причина" className="mt-3 w-full bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-3 text-cream-50" />
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-sm border border-gold-300/25 text-cream-100/80">Назад</button>
          <button type="button" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())} className="flex-1 h-12 rounded-sm bg-red-700 disabled:bg-ink-700 disabled:text-cream-100/40 text-cream-50 font-medium">
            {partOnly ? `Откажи ${station === "bar" ? "напитките" : "храната"}` : "Откажи поръчката"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cancel one line, or some of it: "2 of the 3 mojitos". What happens to the
 * money is said before staff confirm.
 */
function VoidDialog({ order, line, onClose, onConfirm }) {
  const others = order.lines.reduce((n, l) => n + (l.line === line.line ? 0 : l.qty), 0);
  const max = others > 0 ? line.qty : line.qty - 1;
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("Изчерпан продукт");
  const amount = line.price * qty;
  let moneyNote;
  if (order.payStatus === "paid") moneyNote = `Гостът е платил онлайн: ${money(amount)} ще му бъдат върнати автоматично.`;
  else if (line.paidVia === "online") moneyNote = `Редът е платен от сметката на масата: ${money(amount)} ще бъдат върнати автоматично на платилия.`;
  else if (line.paidVia === "staff") moneyNote = `Редът е платен на място: върнете ${money(amount)} на госта.`;
  else moneyNote = `Сумата за плащане става ${money(order.total - amount)}.`;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Откажи ред">
      <button type="button" aria-label="Затвори" onClick={onClose} className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-md bg-ink-900 border border-gold-300/25 rounded-sm p-6">
        <h2 className="font-display text-2xl text-cream-50">Няма: {line.nameBg}</h2>
        <p className="text-sm text-cream-100/60 mt-1">
          {order.code} · маса {order.table}. Останалото от поръчката остава. Причината се вижда и от госта.
        </p>
        {max > 1 && (
          <div className="flex items-center gap-3 mt-4">
            <span className="text-cream-100/80">Колко</span>
            <div className="flex items-center border border-gold-300/40 rounded-sm">
              <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} className="w-11 h-11 text-xl text-gold-100" aria-label="−">−</button>
              <span className="w-10 text-center text-cream-50 tabular-nums" aria-live="polite">{qty}</span>
              <button type="button" onClick={() => setQty(Math.min(max, qty + 1))} disabled={qty >= max} className="w-11 h-11 text-xl text-gold-100 disabled:opacity-30" aria-label="+">+</button>
            </div>
            <span className="text-sm text-cream-100/60">от {line.qty}</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {LINE_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={`px-3 py-2 rounded-full text-sm border ${reason === r ? "border-gold-300 bg-gold-300/15 text-gold-100" : "border-gold-300/25 text-cream-100/80"}`}>
              {r}
            </button>
          ))}
        </div>
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="или напишете причина" className="mt-3 w-full bg-ink-950 border border-gold-300/25 rounded-sm px-3 py-3 text-cream-50" />
        <p className="text-sm text-gold-100 mt-4 border border-gold-300/30 rounded-sm px-3 py-2">{moneyNote}</p>
        <div className="flex gap-2 mt-5">
          <button type="button" onClick={onClose} className="flex-1 h-12 rounded-sm border border-gold-300/25 text-cream-100/80">Назад</button>
          <button type="button" disabled={!reason.trim()} onClick={() => onConfirm(qty, reason.trim())} className="flex-1 h-12 rounded-sm bg-red-700 disabled:bg-ink-700 disabled:text-cream-100/40 text-cream-50 font-medium">
            Откажи {qty} × {money(amount)}
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
    payment: state?.paymentsConfigured && ["online", "tab"].includes(state?.paymentMode) ? state.paymentMode : "on_site",
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
        onSaved(res.state, res.seq);
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
      if (res.ok) onSaved(res.state, res.seq);
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
            {state.payment === "online" ? "плащане с карта в телефона" : state.payment === "tab" ? "сметка накрая, плащане от телефона" : "плащане при сервитьора"}
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
            ["tab", "Сметка накрая", "Поръчките идват веднага и се трупат по масата. Накрая всеки плаща от телефона — цялата сметка или своето."],
          ].map(([id, label, hint]) => {
            const unavailable = id !== "on_site" && !state?.paymentsConfigured;
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
 * Everything paid on a phone that the till (Clock) has to hear about:
 * orders paid before they went out, and payments from tables' bills (at
 * their net amount — what was owed back is not a sale; a tip is shown
 * apart). "todo": still to be entered, or refunded — all of it or one line —
 * after it was entered, and that difference still to be voided.
 */
function tillList(orders, billPayments) {
  const entries = [];
  const lines = (list = []) => list.filter((l) => l.qty > 0).map((l) => `${l.qty} × ${l.nameBg}${l.detailBg ? ` · ${l.detailBg}` : ""}`).join(", ");
  for (const o of orders.values()) {
    if (o.payStatus !== "paid" && o.payStatus !== "refunded") continue;
    if (!o.tillAt && o.net <= 0) continue; // refunded before it was entered: nothing to do
    const voidAmount = o.tillCents - o.tillVoidCents - o.net;
    entries.push({
      kind: "order", id: o.id, code: o.code, table: o.table, at: o.paidAt || o.createdAt,
      text: (o.payerName ? `${o.payerName} · ` : "") + lines(o.lines),
      amount: o.tillAt ? o.tillCents : o.net, voidAmount, tip: 0, tillAt: o.tillAt,
      toEnter: o.payStatus === "paid" && !o.tillAt && o.net > 0, toVoid: o.tillAt > 0 && voidAmount > 0,
    });
  }
  for (const p of billPayments.values()) {
    if (p.status !== "paid") continue;
    if (!p.tillAt && p.net <= 0) continue; // all of it owed back before it was entered
    const voidAmount = p.tillCents - p.tillVoidCents - p.net;
    entries.push({
      kind: "bill", id: p.id, code: p.code, table: p.table, at: p.paidAt,
      text: `сметка${p.payerName ? `, платил ${p.payerName}` : ""} · ${lines(p.lines)}`,
      amount: p.tillAt ? p.tillCents : p.net, voidAmount, tip: p.tipNet, tillAt: p.tillAt,
      toEnter: !p.tillAt && p.net > 0, toVoid: p.tillAt > 0 && voidAmount > 0,
    });
  }
  for (const e of entries) e.todo = e.toEnter || e.toVoid;
  return entries;
}

/**
 * "За касата": what guests paid on the phone still has to be entered in the
 * till (Clock) by hand; refunds of what was already entered have to be
 * voided there. Oldest first. Ticks sync to every tablet.
 */
function Till({ entries, onTill }) {
  const toEnter = entries.filter((e) => e.toEnter).sort((a, b) => a.at - b.at);
  const toVoid = entries.filter((e) => e.toVoid).sort((a, b) => a.at - b.at);
  const done = entries.filter((e) => e.tillAt > 0 && !e.toVoid).sort((a, b) => b.tillAt - a.tillAt).slice(0, 30);
  // Tips paid with bills today, for sharing out at the end of the evening.
  const today = sofiaDate(Math.floor(Date.now() / 1000));
  const tipped = entries.filter((e) => e.tip > 0 && sofiaDate(e.at) === today);
  const tips = tipped.reduce((sum, e) => sum + e.tip, 0);
  const Row = ({ entry, amount, tip = 0, children }) => (
    <li className="border border-gold-300/20 bg-ink-900 rounded-sm p-4 flex flex-wrap items-center gap-4" data-till={entry.code}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg text-gold-100">{entry.code}</span>
          <span className="text-cream-100/70">маса {entry.table}</span>
          <span className="text-cream-100/50 text-sm">{clock(entry.at)}</span>
        </div>
        <div className="text-sm text-cream-100/80 mt-1">{entry.text}</div>
      </div>
      <div className="text-right">
        <div className="font-semibold text-cream-50 text-lg">{money(amount)}</div>
        {tip > 0 && <div className="text-xs text-sage-200">+ бакшиш {money(tip)}</div>}
      </div>
      {children}
    </li>
  );
  return (
    <div className="max-w-3xl">
      <p className="text-sm text-cream-100/60">
        Платеното онлайн се въвежда в Clock ръчно, с плащане „карта“. Отметнете всяко, след като го въведете. Кодовете „P-…“ са плащания от сметка на маса.
      </p>
      {tips > 0 && (
        <p className="mt-3 border border-sage-300/30 rounded-sm px-3 py-2 text-sm text-cream-50" data-tips-today>
          Бакшиши с карта днес: <span className="font-semibold text-sage-200">{money(tips)}</span> ({tipped.length} {tipped.length === 1 ? "плащане" : "плащания"}). Те не са част от сумата за въвеждане.
        </p>
      )}
      {toVoid.length > 0 && (
        <>
          <h2 className="font-display text-2xl text-red-300 mt-6">Сторнирай в Clock</h2>
          <p className="text-sm text-cream-100/60 mt-1">Върнати на госта, след като вече са въведени.</p>
          <ul className="space-y-3 mt-3">
            {toVoid.map((e) => (
              <Row key={`${e.kind}${e.id}`} entry={e} amount={e.voidAmount}>
                <button type="button" onClick={() => onTill(e, { voided: true })} className="h-12 px-4 rounded-sm bg-red-800 text-cream-50 text-sm">Сторнирана ✓</button>
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
          {toEnter.map((e) => (
            <Row key={`${e.kind}${e.id}`} entry={e} amount={e.amount} tip={e.tip}>
              <button type="button" onClick={() => onTill(e, { entered: true })} className="btn-gold h-12 px-4 rounded-sm text-sm">Въведена в Clock ✓</button>
            </Row>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <details className="mt-8">
          <summary className="text-sm text-cream-100/60 cursor-pointer">Въведени ({done.length})</summary>
          <ul className="space-y-2 mt-3 opacity-80">
            {done.map((e) => (
              <Row key={`${e.kind}${e.id}`} entry={e} amount={e.amount} tip={e.tip}>
                <button type="button" onClick={() => onTill(e, { entered: false })} className="h-10 px-3 rounded-sm border border-gold-300/25 text-xs text-cream-100/70">Върни в списъка</button>
              </Row>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * "Сметки": each table's bill on a "pay at the end" evening — paid on
 * phones, paid on the spot, left to pay — with money owed back to a guest
 * shown until it is refunded. Staff settle what is left (cash or terminal)
 * and close the bill; the table's next order starts a new one.
 */
function Tabs({ tabs, onAction }) {
  const [settling, setSettling] = useState(null);
  const open = [...tabs.values()].filter((x) => !x.closedAt).sort((a, b) => a.table - b.table);
  const closed = [...tabs.values()].filter((x) => x.closedAt).sort((a, b) => b.closedAt - a.closedAt);
  const state = { online: ["платено онлайн", "text-sage-200"], staff: ["платено на място", "text-sage-200"], pending: ["плаща се…", "text-gold-200"], unpaid: ["", ""] };
  return (
    <div className="max-w-5xl">
      <p className="text-sm text-cream-100/60">
        Сметката на всяка маса: какво е платено от телефоните и какво остава. Когато гостите платят остатъка на място (в брой или на терминала), натиснете „Платено на място“. Затворете сметката, когато масата си тръгне.
      </p>
      {open.length === 0 && <p className="text-cream-100/50 py-10 text-center">Няма отворени сметки.</p>}
      <div className="grid gap-4 md:grid-cols-2 mt-4">
        {open.map((x) => {
          const owed = x.payments.filter((p) => p.refundDue > 0);
          return (
            <article key={x.id} className={`border-2 rounded-sm bg-ink-900 p-4 ${x.totals.unpaid > 0 ? "border-gold-300/60" : "border-sage-400/50"}`} data-tab={x.table}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] tracking-[0.25em] uppercase text-cream-100/50">Маса</div>
                  <div className="font-sans font-semibold tabular-nums text-5xl leading-none text-cream-50">{x.table}</div>
                </div>
                <dl className="text-right text-sm space-y-0.5">
                  <div><dt className="inline text-cream-100/60">Общо </dt><dd className="inline text-cream-50">{money(x.totals.total)}</dd></div>
                  {x.totals.paidOnline > 0 && <div><dt className="inline text-cream-100/60">Онлайн </dt><dd className="inline text-sage-200">{money(x.totals.paidOnline)}</dd></div>}
                  {x.totals.paidStaff > 0 && <div><dt className="inline text-cream-100/60">На място </dt><dd className="inline text-sage-200">{money(x.totals.paidStaff)}</dd></div>}
                  {x.payments.some((p) => p.status === "paid" && p.tipNet > 0) && (
                    <div><dt className="inline text-cream-100/60">Бакшиш </dt><dd className="inline text-sage-200">{money(x.payments.filter((p) => p.status === "paid").reduce((n, p) => n + p.tipNet, 0))}</dd></div>
                  )}
                  <div><dt className="inline text-cream-100/60">Остава </dt><dd className={`inline font-semibold text-lg ${x.totals.unpaid ? "text-gold-100" : "text-sage-200"}`}>{money(x.totals.unpaid)}</dd></div>
                </dl>
              </div>
              <details className="mt-3">
                <summary className="text-sm text-cream-100/60 cursor-pointer">{x.lines.length} реда</summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {x.lines.map((l) => (
                    <li key={`${l.code}:${l.line}`} className="flex justify-between gap-3">
                      <span className="text-cream-50">
                        {l.name && <span className="text-gold-100">{l.name}: </span>}
                        {l.qty} × {l.nameBg}
                        {l.detailBg ? <span className="text-cream-100/60"> · {l.detailBg}</span> : null}
                        <span className="text-xs text-cream-100/40"> {l.code}</span>
                        {state[l.state][0] && <span className={`text-xs ${state[l.state][1]}`}> · {state[l.state][0]}</span>}
                      </span>
                      <span className="shrink-0 text-cream-100/80">{money(l.amount)}</span>
                    </li>
                  ))}
                </ul>
              </details>
              {x.payments.some((p) => p.status === "paid") && (
                <ul className="mt-3 space-y-1 text-sm" aria-label="Плащания от телефон">
                  {x.payments.filter((p) => p.status === "paid").map((p) => (
                    <li key={p.id} className="flex justify-between gap-3 text-cream-100/80" data-bill-payment={p.code}>
                      <span>
                        <span className="font-mono text-xs text-cream-100/50">{p.code}</span> {clock(p.paidAt)}
                        {p.payerName ? <span className="text-cream-50"> · {p.payerName}</span> : null}
                      </span>
                      <span className="text-sage-200 shrink-0">
                        {money(p.amount)}
                        {p.tipNet > 0 && <span className="text-xs text-cream-100/70"> + бакшиш {money(p.tipNet)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {owed.map((p) => (
                <div key={p.id} className="mt-3 border border-red-400/40 bg-red-950/30 rounded-sm px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2">
                  <span className="text-cream-50">
                    Дължим на госта {money(p.refundDue)} ({p.code}){p.refundError ? " — връщането не успя" : " — връща се…"}
                  </span>
                  <button type="button" onClick={() => onAction({ action: "refund", paymentId: p.id }, `${money(p.refundDue)} са върнати.`)} className="h-10 px-3 rounded-sm border border-red-300/50 text-red-200 text-xs">
                    Върни сега
                  </button>
                </div>
              ))}
              <div className="flex gap-2 mt-4">
                {x.totals.unpaid > 0 ? (
                  <button type="button" onClick={() => setSettling(x)} className="btn-gold flex-1 h-12 rounded-sm text-sm">
                    Платено на място ({money(x.totals.unpaid)})
                  </button>
                ) : (
                  <button type="button" onClick={() => onAction({ action: "close", tabId: x.id }, `Сметката на маса ${x.table} е затворена.`)} className="btn-gold flex-1 h-12 rounded-sm text-sm">
                    Затвори сметката
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {closed.length > 0 && (
        <details className="mt-8">
          <summary className="text-sm text-cream-100/60 cursor-pointer">Затворени днес ({closed.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-cream-100/70">
            {closed.map((x) => (
              <li key={x.id}>Маса {x.table} · {money(x.totals.total)} · затворена в {clock(x.closedAt)}</li>
            ))}
          </ul>
        </details>
      )}
      {settling && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Платено на място">
          <button type="button" aria-label="Затвори" onClick={() => setSettling(null)} className="absolute inset-0 bg-black/70" />
          <div className="relative w-full max-w-md bg-ink-900 border border-gold-300/25 rounded-sm p-6">
            <h2 className="font-display text-2xl text-cream-50">Маса {settling.table}: платено на място</h2>
            <p className="text-cream-100/80 mt-3">
              Остатъкът от <span className="font-semibold text-gold-100">{money(settling.totals.unpaid)}</span> е платен в брой или на терминала и е маркиран в Clock?
            </p>
            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => setSettling(null)} className="flex-1 h-12 rounded-sm border border-gold-300/25 text-cream-100/80">Назад</button>
              <button
                type="button"
                onClick={() => {
                  onAction({ action: "settle", tabId: settling.id }, `Маса ${settling.table}: остатъкът е маркиран като платен на място.`);
                  setSettling(null);
                }}
                className="btn-gold flex-1 h-12 rounded-sm font-medium"
              >
                Да, платено
              </button>
            </div>
          </div>
        </div>
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
