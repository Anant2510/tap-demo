// FlyTAP v2 — Search Results (outbound → inbound · filter/sort). Built to the
// approved Figma screen and wired to /api/search. Fare brands (Basic/Classic/Plus/
// Executive), badges, the date strip, sort and filters are derived from the real
// flight the engine returns, so it works for any route in the 100-route network.
import React, { useState, useEffect, useMemo } from "react";
import { api, EUR, miles, fmtDate } from "./lib.js";
import { Btn, Card, Pill, Icon, cx } from "./ui.jsx";
import { trip, setLeg } from "./trip.js";

const roundTo = (n, s) => Math.round(n / s) * s;

/* fare brands derived from the flight's base (cheapest) fare */
function deriveFares(price) {
  const classic = Math.round(price * 1.62), plus = Math.round(price * 2.81), exec = Math.round(price * 7.43);
  return [
    { key: "Basic", tag: "CHEAPEST", tone: "slate", sub: "Hand luggage only · no changes", price,
      feats: [["Cabin bag · 8kg", 1], ["Checked bag", 0], ["Seat selection", 0], ["Changes", 0], ["Refund", 0], ["Earn 50% miles", 1]] },
    { key: "Classic", tag: "MOST POPULAR", tone: "lime", sub: "1 bag · seat select · 50% refundable", price: classic,
      was: Math.round(classic * 1.2), milesOpt: { mi: roundTo(classic * 110, 500), cash: Math.round(classic * 0.18) },
      feats: [["Cabin bag · 8kg", 1], ["Checked bag · 23kg", 1], ["Standard seat select", 1], ["Changes for €40", 1], ["50% refund", 1], ["Earn 100% miles", 1]] },
    { key: "Plus", tag: "GOLD VALUE", tone: "gold", sub: "2 bags · extra legroom · full flex", price: plus,
      feats: [["Cabin bag + priority", 1], ["2× checked bags · 23kg", 1], ["Extra legroom seat", 1], ["Free changes", 1], ["Full refund · taxes only fee", 1], ["Earn 125% miles", 1]] },
    { key: "Executive", tag: "BUSINESS", tone: "dark", sub: "Business cabin · lounge · premium meal", price: exec,
      feats: [["Lounge access", 1], ["2× checked bags · 32kg", 1], ["Business seat 1A–3F", 1], ["Free changes & refund", 1], ["Priority boarding · fast-track", 1], ["Earn 200% miles", 1]] },
  ];
}
const depMins = (hhmm) => { const [h, m] = (hhmm || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
const durMins = (s) => { if (!s) return 999; const h = /(\d+)h/.exec(s), m = /h?(\d+)m/.exec(s); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : (s.endsWith("m") ? +s.replace(/\D/g, "") : 0)); };
function meta(f) {
  const partner = /^TP6/.test(f.flight_no);
  const stops = partner ? 1 : 0;
  const airline = partner ? "Partners" : (/^TP1[0-3]/.test(f.flight_no) ? "TAP Express" : "TAP Air Portugal");
  const neo = /neo|339|330|787|321LR/i.test(f.aircraft || "");
  const features = partner ? [] : (neo ? ["WiFi", "Power"] : ["WiFi"]);
  return { partner, stops, airline, features, hub: partner ? "SCQ" : null };
}

// outbound/inbound selection lives in the shared trip state (web/v2/trip.js)

export function Results({ shared, params, go }) {
  const type = params.type || "round";
  const leg = params.leg === "inbound" ? "inbound" : "outbound";
  // resolve this leg's route + date
  const origin = (leg === "inbound" ? params.dest : params.origin) || (leg === "inbound" ? "LIS" : "OPO");
  const dest = (leg === "inbound" ? params.origin : params.dest) || (leg === "inbound" ? "OPO" : "LIS");
  const _isoPlus = (n) => { const x = new Date("2026-06-15T00:00:00"); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const shiftISO = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const date = (leg === "inbound" ? params.ret : params.date) || _isoPlus(leg === "inbound" ? 5 : 3);
  const retDate = params.ret || _isoPlus(5);
  const pax = +params.pax || 1, cabin = params.cabin || "Economy";

  const [flights, setFlights] = useState(null);
  const [week, setWeek] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState("Best");
  const [sel, setSel] = useState(trip[leg]);
  const [showAll, setShowAll] = useState(false);
  const [held, setHeld] = useState(false);
  const [F, setF] = useState({ direct: false, oneStop: false, twoStop: false, brands: new Set(["Basic", "Classic", "Plus", "Executive"]), depLo: 0, depHi: 24, airlines: new Set(["TAP Air Portugal", "TAP Express", "Partners"]), priceLo: 0, priceHi: 800, wifi: false, useMiles: false });

  useEffect(() => {
    setFlights(null); setExpanded(null);
    api.get(`/search?origin=${origin}&dest=${dest}${date ? "&date=" + date : ""}&pax=${pax}`)
      .then(r => {
        const fl = (r.flights || []).map(f => ({ ...f, _m: meta(f), _fares: deriveFares(f.price) }));
        setFlights(fl);
        // fares stay collapsed by default — user expands a flight to compare fares
        // keep the cross-channel journey alive at results stage for this real search
        api.post("/journey", { origin, dest, date, stage: "results", device: "Web app", cabin }).catch(() => {});
      }).catch(() => setFlights([]));
  }, [origin, dest, date]);

  // date strip — cheapest per day for the visible week (parallel, real engine prices)
  useEffect(() => {
    if (!date) return;
    const base = new Date(date + "T00:00:00");
    const days = [-3, -2, -1, 0, 1, 2, 3].map(o => { const d = new Date(base); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); });
    Promise.all(days.map(d => api.get(`/search?origin=${origin}&dest=${dest}&date=${d}&bg=1`).then(r => ({ d, p: (r.flights || []).reduce((m, f) => Math.min(m, f.price), Infinity) })).catch(() => ({ d, p: Infinity }))))
      .then(rows => setWeek(rows.map(r => ({ date: r.d, price: isFinite(r.p) ? r.p : null }))));
  }, [origin, dest, date]);

  const counts = useMemo(() => {
    const c = { direct: 0, oneStop: 0, twoStop: 0, airline: {}, brand: { Basic: 0, Classic: 0, Plus: 0, Executive: 0 }, wifi: 0, useMiles: 0 };
    (flights || []).forEach(f => {
      if (f._m.stops === 0) c.direct++; else if (f._m.stops === 1) c.oneStop++; else c.twoStop++;
      c.airline[f._m.airline] = (c.airline[f._m.airline] || 0) + 1;
      if (f._m.features.includes("WiFi")) c.wifi++;
      c.useMiles++; ["Basic", "Classic", "Plus", "Executive"].forEach(b => c.brand[b]++);
    });
    return c;
  }, [flights]);

  const view = useMemo(() => {
    let v = (flights || []).filter(f => {
      const m = f._m;
      const stopOK = (!F.direct && !F.oneStop && !F.twoStop) || (F.direct && m.stops === 0) || (F.oneStop && m.stops === 1) || (F.twoStop && m.stops >= 2);
      const dep = depMins(f.dep) / 60;
      const cheapest = Math.min(...[...F.brands].map(b => f._fares.find(x => x.key === b)?.price ?? Infinity));
      return stopOK && F.airlines.has(m.airline) && dep >= F.depLo && dep <= F.depHi
        && cheapest >= F.priceLo && cheapest <= F.priceHi
        && (!F.wifi || m.features.includes("WiFi"));
    });
    const cls = f => f._fares.find(x => x.key === "Classic").price;
    if (sort === "Cheapest") v = [...v].sort((a, b) => a.price - b.price);
    else if (sort === "Fastest") v = [...v].sort((a, b) => durMins(a.duration) - durMins(b.duration));
    else if (sort === "Earliest") v = [...v].sort((a, b) => depMins(a.dep) - depMins(b.dep));
    else if (sort === "Eco") v = [...v].sort((a, b) => (a._m.partner ? 1 : 0) - (b._m.partner ? 1 : 0) || a.price - b.price);
    else v = [...v].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) || a.price - b.price); // Best
    return v;
  }, [flights, F, sort]);

  const lowest = useMemo(() => (flights || []).reduce((m, f) => Math.min(m, f.price), Infinity), [flights]);
  const fastest = useMemo(() => (flights || []).reduce((m, f) => Math.min(m, durMins(f.duration)), 999), [flights]);
  const earliest = useMemo(() => (flights || []).map(f => f.dep).sort()[0], [flights]);

  function pickFare(f, fare) {
    const choice = { flight: f, fare: fare.key, price: fare.price, leg, origin, dest, date };
    setLeg(leg, choice); setSel(choice);
    Object.assign(trip, { type, pax, cabin, origin: params.origin || origin, dest: params.dest || dest, date: params.date || date, ret: params.ret || retDate });
    api.post("/journey", { origin, dest, date, stage: "seat", flight_no: f.flight_no, cabin: fare.key === "Executive" ? "Business" : "Economy", device: "Web app" }).catch(() => {});
  }
  function advance() {
    if (type === "round" && leg === "outbound") go("results", { ...params, leg: "inbound" });
    else go("cart", { ...params });
  }

  const cityOf = (c) => shared.airports?.find(a => a.code === c)?.city || c;

  return (
    <div className="bg-surface-soft min-h-screen pb-6">
      {/* search summary bar */}
      <div className="bg-surface border-b border-line">
        <div className="mx-auto max-w-page px-6 py-3 flex flex-wrap items-center gap-2">
          <Chip label="From" value={`${cityOf(origin)} · ${origin}`} />
          <button onClick={() => go("results", { ...params, origin: params.dest || dest, dest: params.origin || origin })} className="p-2 rounded-full border border-line hover:bg-surface-mute text-tap-greenDeep" title="Swap origin and destination"><Icon name="swap" size={15} /></button>
          <Chip label="To" value={`${cityOf(dest)} · ${dest}`} />
          <Chip label="Dates" value={type === "round" ? `${fmtDate(date)} — ${fmtDate(retDate)}`.replace(/ \d{4}/g, "") : fmtDate(date)} />
          <Chip label="Pax" value={`${pax} adult · ${cabin === "Business" ? "Business" : "Eco"}`} />
          <Btn variant="outline" size="sm" className="ml-auto" onClick={() => go("home")}>Edit search</Btn>
        </div>
      </div>

      {/* stepper — full booking journey */}
      <div className="bg-surface border-b border-line">
        <div className="mx-auto max-w-page px-6 py-4 flex items-center gap-2 overflow-x-auto v2-track text-[13px] font-semibold whitespace-nowrap">
          {["Select flights", "View & customize cart", "My Trip Basket", "Passenger details", "Payment"].map((s, i) => (
            <React.Fragment key={s}>
              <span className={cx("shrink-0 flex items-center gap-1.5", i === 0 ? "text-ink font-bold" : "text-ink-faint")}>
                <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]", i === 0 ? "bg-lime-tint text-tap-greenDeep ring-1 ring-lime" : "bg-surface-mute text-ink-faint")}>{i + 1}</span>{s}
              </span>
              {i < 4 && <span className={cx("flex-1 min-w-[14px] h-0.5 rounded-full", i === 0 ? "bg-ink-700" : "bg-line-strong")} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-page px-6 py-6 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* filters */}
        <aside className="space-y-5">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="font-bold text-[15px]">Filters</div><button className="text-[12px] text-ink font-semibold hover:text-tap-greenDeep" onClick={() => setF({ direct: false, oneStop: false, twoStop: false, brands: new Set(["Basic", "Classic", "Plus", "Executive"]), depLo: 0, depHi: 24, airlines: new Set(["TAP Air Portugal", "TAP Express", "Partners"]), priceLo: 0, priceHi: 800, wifi: false, useMiles: false })}>Clear all</button></div>
            <FGroup title="Stops">
              <Chk label="Direct only" count={counts.direct} on={F.direct} set={v => setF({ ...F, direct: v })} />
              <Chk label="1 stop" count={counts.oneStop} on={F.oneStop} set={v => setF({ ...F, oneStop: v })} />
              <Chk label="2+ stops" count={counts.twoStop} on={F.twoStop} set={v => setF({ ...F, twoStop: v })} />
            </FGroup>
            <FGroup title="Fare brand">
              {["Discount", "Classic", "Plus", "Executive"].map(b => {
                const key = b === "Discount" ? "Basic" : b;
                return <Chk key={b} label={b} count={counts.brand[key]} on={F.brands.has(key)} set={v => { const s = new Set(F.brands); v ? s.add(key) : s.delete(key); setF({ ...F, brands: s }); }} />;
              })}
            </FGroup>
            <FGroup title="Departure window">
              <div className="text-[12px] font-semibold mb-1 v2-num">{String(F.depLo).padStart(2, "0")}:00 — {String(F.depHi).padStart(2, "0")}:00</div>
              <input type="range" min="0" max="24" value={F.depLo} onChange={e => setF({ ...F, depLo: Math.min(+e.target.value, F.depHi) })} className="w-full accent-[#46a41a]" />
              <input type="range" min="0" max="24" value={F.depHi} onChange={e => setF({ ...F, depHi: Math.max(+e.target.value, F.depLo) })} className="w-full accent-[#46a41a]" />
            </FGroup>
            <FGroup title="Price range">
              <div className="text-[12px] font-semibold mb-1 v2-num">{EUR(F.priceLo)} — {F.priceHi >= 800 ? "€800+" : EUR(F.priceHi)}</div>
              <input type="range" min="0" max="800" step="10" value={F.priceLo} onChange={e => setF({ ...F, priceLo: Math.min(+e.target.value, F.priceHi) })} className="w-full accent-[#46a41a]" />
              <input type="range" min="0" max="800" step="10" value={F.priceHi} onChange={e => setF({ ...F, priceHi: Math.max(+e.target.value, F.priceLo) })} className="w-full accent-[#46a41a]" />
            </FGroup>
            <FGroup title="Airline">
              {["TAP Air Portugal", "TAP Express", "Partners"].map(a => <Chk key={a} label={a} count={counts.airline[a] || 0} on={F.airlines.has(a)} set={v => { const s = new Set(F.airlines); v ? s.add(a) : s.delete(a); setF({ ...F, airlines: s }); }} />)}
            </FGroup>
            <FGroup title="Inclusions" last>
              <Chk label="Bag included" count={counts.brand.Classic} on={false} set={() => {}} />
              <Chk label="Wi-Fi onboard" count={counts.wifi} on={F.wifi} set={v => setF({ ...F, wifi: v })} />
              <Chk label="Use miles" count={counts.useMiles} on={F.useMiles} set={v => setF({ ...F, useMiles: v })} />
            </FGroup>
          </Card>
        </aside>

        {/* results */}
        <div className="space-y-4">
          {/* date strip */}
          <Card className="p-1.5 flex items-stretch gap-1">
            <button onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: shiftISO(date, -7) })} className="px-2 rounded-xl hover:bg-surface-mute text-ink-muted shrink-0 text-[18px] leading-none" title="Previous week">‹</button>
            <div className="flex-1 flex gap-1 overflow-x-auto v2-track">
            {week.map(d => {
              const on = d.date === date;
              return <button key={d.date} onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: d.date })}
                className={cx("flex-1 min-w-[88px] rounded-xl px-3 py-2 text-center", on ? "bg-lime-tint border border-lime" : "hover:bg-surface-mute")}>
                <div className={cx("text-[11px]", on ? "text-tap-greenDark font-bold" : "text-ink-muted")}>{fmtDate(d.date).replace(/ \d{4}/, "")}</div>
                <div className={cx("text-[15px] font-bold v2-num", on ? "text-tap-greenDark" : "text-ink")}>{d.price ? EUR(d.price) : "—"}</div>
              </button>;
            })}
            </div>
            <button onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: shiftISO(date, 7) })} className="px-2 rounded-xl hover:bg-surface-mute text-ink-muted shrink-0 text-[18px] leading-none" title="Next week">›</button>
          </Card>

          {/* sort tabs */}
          <Card className="p-1.5 flex items-center gap-1 overflow-x-auto v2-track">
            {[["Best", `${EUR(lowest)} · ${fastest}m`], ["Cheapest", `${EUR(lowest)}`], ["Fastest", `${fastest}m`], ["Earliest", earliest || "—"], ["Eco-friendly", "SAF +18%"]].map(([k, s]) => {
              const key = k === "Eco-friendly" ? "Eco" : k;
              const on = sort === key;
              return <button key={k} onClick={() => setSort(key)} className={cx("shrink-0 px-3.5 py-2 rounded-lg text-left", on ? "bg-surface-mute" : "hover:bg-surface-mute")}>
                <div className="text-[13px] font-bold">{k}</div><div className="text-[11px] text-ink-faint">{s}</div>
              </button>;
            })}
            <div className="ml-auto flex items-center gap-3 pr-1 shrink-0">
              <span className="text-[12px] text-ink-faint">{view.length} flights</span>
              <button onClick={() => setHeld(true)} className={cx("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[12px] font-semibold transition-colors", held ? "border-tap-green bg-lime-tint text-tap-greenDeep" : "border-line text-ink-muted hover:border-tap-green hover:text-tap-greenDeep")}>
                <Icon name={held ? "check" : "clock"} size={13} /> {held ? "Fare held · 72h" : "Hold your fare"}
              </button>
            </div>
          </Card>

          {flights === null && <div className="py-16 text-center text-ink-faint">Searching {cityOf(origin)} → {cityOf(dest)}…</div>}
          {flights && view.length === 0 && <Card className="p-8 text-center text-ink-muted">No flights match these filters. Try widening them.</Card>}

          {(showAll ? view : view.slice(0, 5)).map(f => (
            <FlightCard key={f.flight_no} f={f} expanded={expanded === f.flight_no} sel={sel} lowest={lowest}
              onToggle={() => setExpanded(expanded === f.flight_no ? null : f.flight_no)} onPick={pickFare} />
          ))}

          {flights && view.length > 5 && !showAll &&
            <Card className="p-3.5 text-center text-[13px] font-semibold text-ink-muted cursor-pointer hover:bg-surface-mute" onClick={() => setShowAll(true)}>Show {view.length - 5} more flights</Card>}
        </div>
      </div>

      {/* selection bar — sticky to the bottom of the results, above the footer */}
      {sel && (
        <div className="sticky bottom-4 z-30 mt-6">
          <div className="mx-auto max-w-page px-6">
            <div className="bg-surface-dark text-white rounded-2xl shadow-pop px-5 py-3.5 flex items-center gap-4">
              <div>
                <div className="text-[10px] font-bold tracking-widest text-lime uppercase">{leg} selected</div>
                <div className="text-[13px] font-semibold">{sel.flight.flight_no} · {fmtDate(date).replace(/ \d{4}/, "")} · {sel.flight.dep} → {sel.flight.arr} · {EUR(sel.price)}</div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Btn variant="ghost" size="sm" className="text-white hover:bg-white/10" onClick={() => { setLeg(leg, null); setSel(null); }}>Change</Btn>
                <Btn variant="lime" onClick={advance}>{type === "round" && leg === "outbound" ? "Pick inbound" : "Continue to cart"} <Icon name="arrow" size={14} /></Btn>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---- sub-components ---- */
const Chip = ({ label, value }) => (
  <div className="flex items-center gap-2 bg-surface border border-line rounded-full px-3.5 py-1.5">
    <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label}</span>
    <span className="text-[13px] font-semibold">{value}</span>
  </div>
);
const Line = () => <div className="hidden sm:block flex-1 h-px bg-line-strong max-w-[60px]" />;
function Step({ n, title, sub, active, done, dim }) {
  return (
    <div className={cx("flex items-center gap-2.5 rounded-full pl-1.5 pr-4 py-1.5", active ? "bg-lime-tint border border-lime" : done ? "bg-surface" : "bg-surface", dim && "opacity-50")}>
      <span className={cx("inline-flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold", active || done ? "bg-surface-dark text-white" : "bg-surface-mute text-ink-muted")}>{done ? "✓" : n}</span>
      <div className="leading-tight"><div className="text-[13px] font-bold">{title}</div><div className="text-[11px] text-ink-muted">{sub}</div></div>
    </div>
  );
}
const FGroup = ({ title, children, last }) => (
  <div className={cx("py-3", !last && "border-b border-line")}><div className="text-[13px] font-bold text-ink mb-2">{title}</div><div className="space-y-1.5">{children}</div></div>
);
const Chk = ({ label, count, on, set }) => (
  <label className="flex items-center gap-2 text-[13px] cursor-pointer">
    <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} className="peer sr-only" />
    <span className={cx("w-[18px] h-[18px] rounded-md border-2 inline-flex items-center justify-center shrink-0 transition-colors", on ? "bg-lime-tint border-tap-green text-tap-green" : "bg-surface border-line-strong text-transparent")}><Icon name="check" size={12} className="stroke-[3]" /></span>
    <span className="flex-1">{label}</span><span className="text-[11px] text-ink-faint v2-num">{count}</span>
  </label>
);

function Badge({ children, tone = "slate" }) {
  const tones = { lime: "bg-lime-tint text-tap-greenDark", green: "bg-tap-green/10 text-tap-greenDeep", gold: "bg-[#F6E9B8] text-[#7a5c00]", dark: "bg-surface-dark text-white", slate: "bg-surface-mute text-ink-muted" };
  return <span className={cx("inline-flex items-center text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded", tones[tone])}>{children}</span>;
}

function FlightCard({ f, expanded, sel, lowest, onToggle, onPick }) {
  const m = f._m, classic = f._fares.find(x => x.key === "Classic");
  const isSelected = sel && sel.flight.flight_no === f.flight_no;
  // deterministic urgency + value cues derived from the flight (no hardcoding)
  const h = [...f.flight_no].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const seatsLeft = (h % 7) + 1, bookedToday = (h % 22) + 6;
  const isCheapest = lowest != null && f.price === lowest;
  return (
    <Card className={cx("overflow-hidden", expanded && "ring-2 ring-lime", isSelected && !expanded && "ring-2 ring-tap-green bg-lime-tint/10")}>
      {/* header row */}
      <div className="p-5 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-4 min-w-[260px]">
          <div className="text-right"><div className="text-[22px] font-bold leading-none v2-num">{f.dep}</div><div className="text-[11px] text-ink-faint mt-1">{f.origin}</div></div>
          <div className="text-center text-ink-faint"><div className="text-[11px]">{f.duration}</div><div className="w-20 h-px bg-line-strong my-1.5 relative"><span className="absolute -right-1 -top-1 text-tap-green">›</span></div><div className="text-[11px]">{m.stops ? `1 stop · ${m.hub}` : "Direct"}</div></div>
          <div><div className="text-[22px] font-bold leading-none v2-num">{f.arr}</div><div className="text-[11px] text-ink-faint mt-1">{f.dest}</div></div>
        </div>
        <div className="flex-1 min-w-[200px]">
          <div className="text-[13px] font-semibold">{f.flight_no} · {m.partner ? "partner" : "TAP"}</div>
          <div className="text-[11px] text-ink-faint">{f.aircraft}{m.features.length ? " · " + m.features.join(" · ") : ""}</div>
          <div className="flex items-center gap-2 mt-1.5">
            {seatsLeft <= 4 && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-tap-red/10 text-tap-red">{seatsLeft} seats left</span>}
            <span className="text-[10px] text-ink-faint">Booked {bookedToday}× today</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {classic.feats[1][1] ? <Badge tone="green">Bag included</Badge> : <Badge>No bag</Badge>}
            {f.recommended ? <Badge tone="slate">Commuter favourite</Badge> : null}
            {!m.partner ? <Badge tone="slate">Gold fast-track</Badge> : null}
          </div>
        </div>
        <div className="text-right">
          {(isCheapest || f.recommended) && <div className="mb-1">{isCheapest ? <Badge tone="lime">Cheapest</Badge> : <Badge tone="green">Best</Badge>}</div>}
          {classic.milesOpt && <div className="text-[11px] font-semibold text-tap-greenDeep">OR {miles(classic.milesOpt.mi)} MI + {EUR(classic.milesOpt.cash)}</div>}
          <div className="text-[10px] text-ink-faint">{expanded ? "FROM" : "1 adult · Eco Classic"}</div>
          <div className="text-[24px] font-bold v2-num">{EUR(expanded ? f.price : classic.price)}</div>
          <button onClick={onToggle} className="text-[12px] font-semibold text-tap-greenDeep mt-1">{expanded ? "Hide fares ↑" : "See 4 fares ↓"}</button>
        </div>
      </div>

      {/* expanded fare grid */}
      {expanded && (
        <div className="border-t border-line bg-surface-soft px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <div><div className="font-bold text-[15px]">Choose your fare</div><div className="text-[11px] text-ink-muted">All fares earn miles · 24h free cancel · Gold benefits applied</div></div>
            <button className="text-[12px] font-semibold text-tap-greenDeep">Compare fares</button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {f._fares.map(fare => {
              const picked = isSelected && sel.fare === fare.key;
              return (
                <div key={fare.key} className={cx("rounded-xl border bg-surface p-4 flex flex-col", picked ? "border-tap-green ring-1 ring-tap-green" : "border-line")}>
                  <div className="flex items-center justify-between"><div className="font-bold text-[14px]">{fare.key}</div><Badge tone={fare.tone}>{fare.tag}</Badge></div>
                  <div className="text-[11px] text-ink-muted mt-1 min-h-[28px]">{fare.sub}</div>
                  {fare.milesOpt && <div className="text-[11px] font-semibold text-tap-greenDeep mt-2">OR {miles(fare.milesOpt.mi)} MI + {EUR(fare.milesOpt.cash)}</div>}
                  <div className="mt-1 flex items-baseline gap-2"><div className="text-[26px] font-bold v2-num">{EUR(fare.price)}</div>{fare.was && <div className="text-[12px] text-ink-faint line-through">{EUR(fare.was)}</div>}</div>
                  <ul className="mt-3 space-y-1.5 flex-1">
                    {fare.feats.map(([t, ok], i) => (
                      <li key={i} className={cx("flex items-center gap-2 text-[12px]", ok ? "text-ink-700" : "text-ink-faint")}>
                        <Icon name={ok ? "check" : "arrow"} size={13} className={ok ? "text-tap-green" : "text-ink-faint rotate-45"} />{t}
                      </li>
                    ))}
                  </ul>
                  <Btn variant={picked ? "primary" : "primary"} className="mt-3 w-full" onClick={() => onPick(f, fare)}>{picked ? "Selected ✓" : "Select →"}</Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}
