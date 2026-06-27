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
  const [holdOpen, setHoldOpen] = useState(false);
  const [F, setF] = useState({ direct: false, oneStop: false, twoStop: false, brands: new Set(["Basic", "Classic", "Plus", "Executive"]), depLo: 0, depHi: 24, airlines: new Set(["TAP Air Portugal", "TAP Express", "Partners"]), priceLo: 0, priceHi: 800, wifi: false, useMiles: false, refundable: false, bag: false });

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
    const c = { direct: 0, oneStop: 0, twoStop: 0, airline: {}, brand: { Basic: 0, Classic: 0, Plus: 0, Executive: 0 }, wifi: 0, useMiles: 0, refundable: 0, bag: 0 };
    (flights || []).forEach(f => {
      if (f._m.stops === 0) c.direct++; else if (f._m.stops === 1) c.oneStop++; else c.twoStop++;
      c.airline[f._m.airline] = (c.airline[f._m.airline] || 0) + 1;
      if (f._m.features.includes("WiFi")) c.wifi++;
      if (f._fares?.find(x => x.key === "Classic")?.feats?.[1]?.[1]) c.bag++;
      c.useMiles++; c.refundable++; ["Basic", "Classic", "Plus", "Executive"].forEach(b => c.brand[b]++);
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
        && (!F.wifi || m.features.includes("WiFi"))
        && (!F.bag || f._fares.find(x => x.key === "Classic")?.feats?.[1]?.[1])
        && (!F.refundable || ["Classic", "Plus", "Executive"].some(b => F.brands.has(b)));
    });
    const cls = f => f._fares.find(x => x.key === "Classic").price;
    if (sort === "All") v = [...v].sort((a, b) => depMins(a.dep) - depMins(b.dep));
    else if (sort === "Cheapest") v = [...v].sort((a, b) => a.price - b.price);
    else if (sort === "Fastest") v = [...v].sort((a, b) => durMins(a.duration) - durMins(b.duration));
    else if (sort === "Earliest") v = [...v].sort((a, b) => depMins(a.dep) - depMins(b.dep));
    else if (sort === "Eco") v = [...v].sort((a, b) => (a._m.partner ? 1 : 0) - (b._m.partner ? 1 : 0) || a.price - b.price);
    else v = [...v].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) || a.price - b.price); // Best
    return v;
  }, [flights, F, sort]);

  const lowest = useMemo(() => (flights || []).reduce((m, f) => Math.min(m, f.price), Infinity), [flights]);
  const fastest = useMemo(() => (flights || []).reduce((m, f) => Math.min(m, durMins(f.duration)), 999), [flights]);
  const earliest = useMemo(() => (flights || []).map(f => f.dep).sort()[0], [flights]);

  // Always surface fares on the top "Best" flight so a fare is visible to pick on every leg.
  // Keyed on the fetched list + leg, so it re-opens on a new search/leg but doesn't fight manual collapses.
  useEffect(() => {
    if (flights && flights.length) setExpanded(view[0]?.flight_no ?? null);
  }, [flights, leg]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <button onClick={() => go("results", { ...params, origin: params.dest || dest, dest: params.origin || origin })} className="px-1.5 text-ink hover:text-tap-greenDeep" title="Swap origin and destination" aria-label="Swap"><Icon name="swap" size={18} /></button>
          <Chip label="To" value={`${cityOf(dest)} · ${dest}`} />
          <Chip label="Dates" value={type === "round" ? `${fmtDate(date)} — ${fmtDate(retDate)}`.replace(/ \d{4}/g, "") : fmtDate(date)} />
          <Chip label="Pax" value={`${pax} adult · ${cabin === "Business" ? "Business" : "Eco"}`} />
          <Btn variant="outline" size="sm" className="ml-auto text-ink border-line-strong" onClick={() => go("home")}>Edit search</Btn>
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
        <div className="mx-auto max-w-page px-6 pb-3 -mt-1 text-[12px] text-ink-muted">Step 1 of 5 · Pick your flight</div>
      </div>

      <div className="mx-auto max-w-page px-6 py-6 grid lg:grid-cols-[260px_1fr] gap-6">
        {/* filters */}
        <aside className="space-y-5">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3"><div className="font-bold text-[15px]">Filters</div><button className="text-[12px] text-ink font-semibold hover:text-tap-greenDeep" onClick={() => setF({ direct: false, oneStop: false, twoStop: false, brands: new Set(["Basic", "Classic", "Plus", "Executive"]), depLo: 0, depHi: 24, airlines: new Set(["TAP Air Portugal", "TAP Express", "Partners"]), priceLo: 0, priceHi: 800, wifi: false, useMiles: false, refundable: false, bag: false })}>Clear all</button></div>
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
              <DualRange min={0} max={24} lo={F.depLo} hi={F.depHi} onLo={v => setF({ ...F, depLo: v })} onHi={v => setF({ ...F, depHi: v })} fmtLo={`${String(F.depLo).padStart(2, "0")}:00`} fmtHi={`${String(F.depHi).padStart(2, "0")}:00`} />
            </FGroup>
            <FGroup title="Price range">
              <DualRange min={0} max={800} step={10} lo={F.priceLo} hi={F.priceHi} onLo={v => setF({ ...F, priceLo: v })} onHi={v => setF({ ...F, priceHi: v })} fmtLo={EUR(F.priceLo)} fmtHi={F.priceHi >= 800 ? "€800+" : EUR(F.priceHi)} />
            </FGroup>
            <FGroup title="Airline">
              {["TAP Air Portugal", "TAP Express", "Partners"].map(a => <Chk key={a} label={a} count={counts.airline[a] || 0} on={F.airlines.has(a)} set={v => { const s = new Set(F.airlines); v ? s.add(a) : s.delete(a); setF({ ...F, airlines: s }); }} />)}
            </FGroup>
            <FGroup title="Inclusions" last>
              <Chk label="Bag included" count={counts.bag} on={F.bag} set={v => setF({ ...F, bag: v })} />
              <Chk label="Wi-Fi onboard" count={counts.wifi} on={F.wifi} set={v => setF({ ...F, wifi: v })} />
              <Chk label="Refundable" count={counts.refundable} on={F.refundable} set={v => setF({ ...F, refundable: v })} />
              <Chk label="Use miles" count={counts.useMiles} on={F.useMiles} set={v => setF({ ...F, useMiles: v })} />
            </FGroup>
          </Card>
        </aside>

        {/* results */}
        <div className="space-y-4">
          {leg === "inbound" && trip.outbound && (() => {
            const ob = trip.outbound, of = ob.flight;
            return (
              <>
                {/* selected outbound — shown first, labelled (#2,#3) */}
                <div className="pt-2">
                  <Card className="border border-tap-green/30 bg-lime-tint/25 overflow-hidden">
                    <div className="px-4 pt-3 text-[10px] font-bold uppercase tracking-wide text-ink inline-flex items-center gap-1">Outbound <Icon name="check" size={11} className="text-ink" /></div>
                    <div className="px-4 pb-4 pt-1 flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-4 min-w-[220px]">
                        <div className="text-center"><div className="text-[20px] font-bold leading-none v2-num">{of.dep}</div><div className="text-[11px] text-ink-faint mt-1">{of.origin}</div></div>
                        <div className="text-center text-ink-faint min-w-[56px]"><div className="text-[11px]">{of.duration}</div><div className="w-14 h-px bg-line-strong my-1.5 mx-auto" /><div className="text-[11px]">Direct</div></div>
                        <div className="text-center"><div className="text-[20px] font-bold leading-none v2-num">{of.arr}</div><div className="text-[11px] text-ink-faint mt-1">{of.dest}</div></div>
                      </div>
                      <div className="flex-1 min-w-[160px]">
                        <div className="flex items-center gap-1.5"><span className="font-black text-[13px] leading-none inline-flex items-center"><span className="text-tap-red">T</span><span className="text-tap-greenDeep">P</span></span><span className="text-[13px] font-semibold">{String(of.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")}</span></div>
                        <div className="text-[11px] text-ink-faint mt-0.5">{of.aircraft} · Bag included</div>
                      </div>
                      <div className="text-right rounded-xl bg-surface border border-line px-4 py-2.5 min-w-[140px]">
                        <div className="text-[10px] font-semibold text-amber-600">OR {miles(Math.round(ob.price * 110 / 500) * 500)} MI + {EUR(Math.round(ob.price * 0.18))}</div>
                        <div className="text-[20px] font-bold v2-num leading-tight">{EUR(ob.price)}</div>
                        <div className="text-[10px] text-ink-faint">1 adult · {ob.fare}</div>
                        <Btn size="sm" variant="primary" className="w-full mt-1.5">Selected ✓</Btn>
                      </div>
                    </div>
                  </Card>
                </div>
                {/* divider (#9) */}
                <div className="flex items-center gap-3 py-1"><div className="flex-1 h-px bg-line-strong" /><span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">Select inbound flight</span><div className="flex-1 h-px bg-line-strong" /></div>
                {/* smart re-rank recommendation band (#10) */}
                <div className="rounded-2xl bg-surface-dark text-white px-5 py-4 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[260px]">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-lime">Smart re-rank · paired with your outbound</div>
                    <div className="text-[14px] font-semibold mt-1">Re-ordered for the cheapest pairing, best gate-to-gate time, and full Gold benefits on both legs.</div>
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      {["+ Bundle bag −€15", "+ Same-day return", "+ Earn 2× miles"].map(t => <span key={t} className="text-[11px] font-semibold rounded-full border border-white/25 px-2.5 py-1 text-lime">{t}</span>)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-white/50 mb-1.5">Why this order?</div>
                    <Btn size="sm" variant="lime" onClick={() => go("ai")}>Explain ranking</Btn>
                  </div>
                </div>
              </>
            );
          })()}
          {/* date strip */}
          <Card className="p-1.5 flex items-stretch gap-1">
            <button onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: shiftISO(date, -7) })} className="px-2 rounded-xl hover:bg-surface-mute text-ink-muted shrink-0 text-[18px] leading-none" title="Previous week">‹</button>
            <div className="flex-1 flex gap-1 overflow-x-auto v2-track">
            {week.map(d => {
              const on = d.date === date;
              return <button key={d.date} onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: d.date })}
                className={cx("flex-1 min-w-[88px] rounded-xl px-3 py-2 text-center", on ? "bg-lime-tint" : "hover:bg-surface-mute")}>
                <div className={cx("text-[11px]", on ? "text-tap-greenDark font-bold" : "text-ink-muted")}>{new Date(d.date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                <div className={cx("text-[15px] font-bold v2-num", on ? "text-tap-greenDark" : "text-ink")}>{d.price ? EUR(d.price) : "—"}</div>
              </button>;
            })}
            </div>
            <button onClick={() => go("results", { ...params, [leg === "inbound" ? "ret" : "date"]: shiftISO(date, 7) })} className="px-2 rounded-xl hover:bg-surface-mute text-ink-muted shrink-0 text-[18px] leading-none" title="Next week">›</button>
          </Card>

          {/* sort tabs — borderless, label-only, green active state */}
          <div className="flex items-center gap-1 overflow-x-auto v2-track">
            {["All flights", "Best", "Cheapest", "Fastest", "Earliest", "Eco-friendly"].map(k => {
              const key = k === "Eco-friendly" ? "Eco" : k === "All flights" ? "All" : k;
              const on = sort === key;
              const label = k === "Best" && leg === "inbound" ? "Best pairing" : k;
              return <button key={k} onClick={() => setSort(key)} className={cx("shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-bold transition-colors", on ? "bg-tap-green text-white shadow-sm" : "text-ink-muted hover:bg-surface-mute")}>
                {label}
              </button>;
            })}
            <div className="ml-auto shrink-0 pr-1">
              <button onClick={() => setHoldOpen(true)} className={cx("inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-[12px] font-semibold transition-colors", held ? "border-tap-green bg-lime-tint text-tap-greenDeep" : "border-tap-green/50 bg-lime-tint/40 text-tap-greenDeep hover:bg-lime-tint")}>
                <Icon name={held ? "check" : "lock"} size={13} /> {held ? "Fare held · 72h" : "Hold your fare"}
              </button>
            </div>
          </div>

          {flights === null && <div className="py-16 text-center text-ink-faint">Searching {cityOf(origin)} → {cityOf(dest)}…</div>}
          {flights && view.length === 0 && <Card className="p-8 text-center text-ink-muted">No flights match these filters. Try widening them.</Card>}

          {(showAll ? view : view.slice(0, 5)).map((f, i) => (
            <FlightCard key={f.flight_no} f={f} expanded={expanded === f.flight_no} sel={sel} lowest={lowest}
              pairing={leg === "inbound" && i === 0 && !sel} originCity={cityOf(f.origin)} destCity={cityOf(f.dest)}
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
              <div className="min-w-0">
                <div className="text-[10px] font-bold tracking-widest text-lime uppercase">{leg === "inbound" ? "Inbound selected · ✓ Outbound" : "Outbound selected"}</div>
                {leg === "inbound" && trip.outbound
                  ? <div className="text-[13px] font-semibold truncate">{String(trip.outbound.flight.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")} {trip.outbound.flight.origin}→{trip.outbound.flight.dest} {EUR(trip.outbound.price)} &nbsp;+&nbsp; {String(sel.flight.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")} {sel.flight.origin}→{sel.flight.dest} {EUR(sel.price)} &nbsp;=&nbsp; <span className="text-lime">{EUR(trip.outbound.price + sel.price - 15)}</span> <span className="text-white/60 font-normal">(bundle saved €15)</span></div>
                  : <div className="text-[13px] font-semibold">{String(sel.flight.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")} · {sel.flight.dep} → {sel.flight.arr} · {EUR(sel.price)}</div>}
              </div>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <button onClick={() => go("express")} className="rounded-full border border-white/40 px-4 py-1.5 text-[12px] font-semibold text-white hover:bg-white/10 transition-colors shrink-0">Express Checkout</button>
                <Btn variant="lime" onClick={advance}>{type === "round" && leg === "outbound" ? "Pick inbound" : "Continue to cart"} <Icon name="arrow" size={14} /></Btn>
              </div>
            </div>
          </div>
        </div>
      )}
      {holdOpen && (sel?.flight || view[0]) && (
        <HoldFareModal flight={sel?.flight || view[0]} date={date} fare={sel?.fare || "Eco Classic"}
          price={sel?.price ?? (view[0] && view[0]._fares.find(x => x.key === "Classic").price) ?? 0} seat="12A"
          onClose={() => setHoldOpen(false)} onHeld={() => setHeld(true)} onContinue={() => { setHoldOpen(false); advance(); }} />
      )}
    </div>
  );
}

/* Hold-fare dialog (A8) — three windows; every hold decision records a hold and fires a
   confirmation email server-side (/api/hold → sendEmail "hold_confirmation"). */
function HoldFareModal({ flight, date, fare, price, seat, onClose, onHeld, onContinue }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const opts = [
    { dur: "24h", label: "Hold 24 hours", fee: 9, note: "Fully deductible from final fare" },
    { dur: "48h", label: "Hold 48 hours", fee: 18, note: "Fully deductible from final fare", pop: true },
    { dur: "7d", label: "Hold 7 days", fee: 39, note: "Non-deductible" },
  ];
  async function hold(o) {
    setBusy(true);
    try { const r = await api.post("/hold", { flight_no: flight.flight_no, duration: o.dur, fee: o.fee, total: price }); setDone({ ...o, expires: r.expires, to: r.email && r.email.to }); onHeld && onHeld(); }
    catch { setDone({ ...o, error: true }); }
    setBusy(false);
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-pop w-full max-w-[760px] my-6 p-7" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-lime inline-flex items-center justify-center text-ink"><Icon name="clock" size={20} /></span>
          <div className="text-[22px] font-black">Not ready to book?</div>
        </div>
        <div className="text-[13px] text-ink-muted mt-1">Lock this price for up to 7 days. Fee deductible from final total.</div>
        {done ? (
          <div className="mt-5 rounded-xl border border-tap-green bg-lime-tint/50 p-6 text-center">
            <div className="text-[16px] font-bold text-tap-greenDeep">Fare held ✓ — {done.label.toLowerCase()}</div>
            <div className="text-[13px] text-ink-700 mt-1">{String(flight.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")} locked at {EUR(price)} until <b>{done.expires}</b>. Hold fee {EUR(done.fee)}{done.dur === "7d" ? "" : " (deductible from final fare)"}.</div>
            <div className="text-[12px] text-ink-muted mt-1">{done.error ? "Hold saved — confirmation email pending." : `Confirmation emailed${done.to ? " to " + done.to : ""}.`}</div>
            <div className="flex justify-center gap-2 mt-4">
              <Btn variant="outline" onClick={onClose}>← Back to results</Btn>
              <Btn variant="primary" onClick={onContinue}>Continue to passengers →</Btn>
            </div>
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-xl bg-surface-soft border border-line p-4">
              <div className="text-[14px] font-bold">Your selected flight</div>
              <div className="text-[13px] font-semibold mt-1">{flight.origin}–{flight.dest} · {String(flight.flight_no).replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")} · {fmtDate(date).replace(/ \d{4}/, "")} · {fare} · {EUR(price)}</div>
              <div className="text-[11px] text-ink-faint mt-1">Hold preserves: fare, seat {seat}, bag entitlement, current taxes</div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-4">
              {opts.map(o => (
                <div key={o.dur} className={cx("relative rounded-xl border p-4 flex flex-col", o.pop ? "border-tap-green bg-lime-tint/40" : "border-line")}>
                  {o.pop && <span className="absolute -top-2 right-3 text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded-full px-2 py-0.5">Most popular</span>}
                  <div className="text-[15px] font-bold">{o.label}</div>
                  <div className="text-[30px] font-black v2-num mt-1 leading-none">{EUR(o.fee)}</div>
                  <div className="text-[11px] text-ink-muted mt-2">{o.note}</div>
                  <ul className="mt-3 space-y-1.5 flex-1">
                    {["Fare locked", "Seat held", "Notifications"].map(t => <li key={t} className="flex items-center gap-2 text-[12px] text-ink-700"><Icon name="check" size={13} className="text-tap-green" />{t}</li>)}
                  </ul>
                  <Btn variant={o.pop ? "lime" : "outline"} className="w-full mt-3" disabled={busy} onClick={() => hold(o)}>Hold for {EUR(o.fee)}</Btn>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 mt-4 text-[12px]">
              {[["lock", `Price locked at ${EUR(price)} even if fare rises`], ["swap", "Auto-refunded if you decide not to book"], ["clock", "Reminder 6 h before window closes"]].map(([ic, t]) => (
                <div key={t} className="flex items-center gap-2 rounded-lg bg-surface-soft border border-line px-3 py-2 text-ink-700"><Icon name={ic} size={14} className="text-ink-muted shrink-0" />{t}</div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-5">
              <Btn variant="outline" onClick={onClose}>← Back to results</Btn>
              <a className="text-[12px] text-ink-muted underline cursor-pointer">Terms &amp; conditions</a>
            </div>
          </>
        )}
      </div>
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
const DualRange = ({ min, max, step = 1, lo, hi, onLo, onHi, fmtLo, fmtHi }) => {
  const span = (max - min) || 1; const pct = v => ((v - min) / span) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-[13px] font-semibold v2-num text-ink mb-2"><span>{fmtLo}</span><span>{fmtHi}</span></div>
      <div className="dual-range-wrap">
        <div className="dual-range-track" />
        <div className="dual-range-fill" style={{ left: pct(lo) + "%", right: (100 - pct(hi)) + "%" }} />
        <input type="range" min={min} max={max} step={step} value={lo} onChange={e => onLo(Math.min(+e.target.value, hi))} className="dual-range" style={{ zIndex: lo >= max - step ? 5 : 3 }} aria-label="Minimum" />
        <input type="range" min={min} max={max} step={step} value={hi} onChange={e => onHi(Math.max(+e.target.value, lo))} className="dual-range" style={{ zIndex: 4 }} aria-label="Maximum" />
      </div>
    </div>
  );
};

function Badge({ children, tone = "slate" }) {
  const tones = { lime: "bg-lime-tint text-tap-greenDark", green: "bg-tap-green/10 text-tap-greenDeep", gold: "bg-[#F6E9B8] text-[#7a5c00]", dark: "bg-surface-dark text-white", slate: "bg-surface-mute text-ink-muted" };
  return <span className={cx("inline-flex items-center text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded", tones[tone])}>{children}</span>;
}

// Important #3 — full-screen fare comparison modal (Discount/Basic/Classic/Plus/Executive),
// selected column highlighted, per-component disclosure + legend, matching the Figma.
function CompareFareModal({ f, selectedKey, originCity, destCity, onClose, onPick }) {
  const byKey = k => f._fares.find(x => x.key === k);
  const basic = byKey("Basic")?.price ?? f.price;
  const cols = [
    { key: "Discount", price: Math.round(basic * 0.86) },
    { key: "Basic", price: basic },
    { key: "Classic", price: byKey("Classic")?.price ?? Math.round(basic * 1.62) },
    { key: "Plus", price: byKey("Plus")?.price ?? Math.round(basic * 2.81) },
    { key: "Executive", price: byKey("Executive")?.price ?? Math.round(basic * 7.43) },
  ];
  let selIdx = cols.findIndex(c => c.key === selectedKey);
  if (selIdx < 0) selIdx = 2; // default Classic
  const sel = cols[selIdx];
  const ROWS = [
    { label: "Hand baggage", sub: "Up to 8 kg", cells: ["inc", "inc", "inc", "inc", "inc"] },
    { label: "Checked bag", sub: "1 × 23 kg", cells: ["no", "add:32", "inc", "inc", "inc2"] },
    { label: "Seat selection", sub: "Standard", cells: ["add:8", "add:8", "inc", "inc", "incXL"] },
    { label: "Meal", sub: "Hot · drinks", cells: ["add:14", "Snack", "Hot", "Hot+wine", "Premium menu"] },
    { label: "Refund", sub: "If you cancel", cells: ["pct:0", "pct:0", "ok:80%", "ok:90%", "ok:100%"] },
    { label: "Change fee", sub: "Per change", cells: ["€80", "€55", "€20", "€0", "€0"] },
    { label: "Miles earned", sub: "Status miles", cells: ["25%", "50%", "100%", "150%", "200%"] },
    { label: "Lounge access", sub: "TAP Premium", cells: ["no", "no", "no", "no", "inc"] },
  ];
  const Cell = ({ v }) => {
    if (v === "inc") return <Icon name="check" size={15} className="text-tap-green" />;
    if (v === "inc2") return <span className="inline-flex items-center gap-0.5 text-tap-green font-semibold"><Icon name="check" size={14} /> ×2</span>;
    if (v === "incXL") return <span className="inline-flex items-center gap-0.5 text-tap-green font-semibold"><Icon name="check" size={14} /> XL</span>;
    if (v === "no") return <span className="text-ink-faint">—</span>;
    if (v.startsWith("add:")) return <span className="text-ink-faint">— €{v.slice(4)}</span>;
    if (v.startsWith("ok:")) return <span className="text-tap-greenDeep font-semibold inline-flex items-center gap-0.5"><Icon name="check" size={13} /> {v.slice(3)}</span>;
    if (v.startsWith("pct:")) return <span className="text-ink-faint">— {v.slice(4)}</span>;
    return <span className="text-ink">{v}</span>;
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-[1080px] my-6 p-7" onClick={e => e.stopPropagation()}>
        <h2 className="text-[30px] font-black leading-tight">{sel.key} bundle — {EUR(f.price)}</h2>
        <p className="text-[13px] text-ink-muted mt-1">{originCity}–{destCity} · {f.flight_no} · Single brand price · full per-component disclosure below.</p>
        <div className="mt-5 rounded-2xl border border-line overflow-hidden">
          <div className="grid grid-cols-[1.4fr_repeat(5,1fr)] bg-surface-soft">
            <div className="p-4"><div className="text-[12px] font-bold">Fare</div><div className="text-[11px] text-ink-faint">Per passenger, one-way</div></div>
            {cols.map((c, i) => (
              <div key={c.key} className={cx("p-4 text-center", i === selIdx && "bg-lime")}>
                <div className="text-[13px] font-bold">{c.key}</div>
                <div className="text-[18px] font-black v2-num">{EUR(c.price)}</div>
                {i === selIdx && <div className="text-[8px] font-bold uppercase tracking-wide bg-surface-dark text-white rounded px-1.5 py-0.5 inline-block mt-1">Selected</div>}
              </div>
            ))}
          </div>
          {ROWS.map((r, ri) => (
            <div key={r.label} className={cx("grid grid-cols-[1.4fr_repeat(5,1fr)] border-t border-line", ri % 2 === 1 && "bg-surface-soft/40")}>
              <div className="p-3.5"><div className="text-[13px] font-semibold">{r.label}</div><div className="text-[11px] text-ink-faint">{r.sub}</div></div>
              {r.cells.map((v, ci) => <div key={ci} className={cx("p-3.5 text-center text-[12px] flex items-center justify-center", ci === selIdx && "bg-lime-tint/40")}><Cell v={v} /></div>)}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[11px] text-ink-muted flex-wrap">
          <span className="inline-flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> Included</span>
          <span className="text-ink-faint">— Not included</span>
          <span className="text-ink-faint">— €N Available as paid add-on</span>
        </div>
        <div className="flex items-center justify-between mt-5 gap-3">
          <Btn variant="outline" onClick={onClose}>← Back to results</Btn>
          <Btn variant="primary" onClick={() => onPick(byKey(sel.key) || byKey("Classic"))}>Continue with {sel.key} · {EUR(sel.price)} →</Btn>
        </div>
      </div>
    </div>
  );
}

function FlightCard({ f, expanded, sel, lowest, pairing, originCity, destCity, onToggle, onPick }) {
  const [compare, setCompare] = useState(false);
  const m = f._m, classic = f._fares.find(x => x.key === "Classic");
  const isSelected = sel && sel.flight.flight_no === f.flight_no;
  // deterministic urgency + value cues derived from the flight (no hardcoding)
  const h = [...f.flight_no].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const seatsLeft = (h % 7) + 1, bookedToday = (h % 22) + 6;
  const isCheapest = lowest != null && f.price === lowest;
  // When selected, reflect the chosen fare's price/label/miles (fixes price-not-updating).
  const selFare = isSelected ? (f._fares.find(x => x.key === sel.fare) || classic) : classic;
  const milesEarn = 1000 + (h % 520);   // stable per-flight earn estimate
  return (
    <div className={cx("relative", pairing && "pt-3")}>
      {pairing && <span className="absolute top-0 left-4 z-10 text-[10px] font-bold uppercase tracking-wide bg-tap-greenDeep text-white rounded-md px-2 py-1 inline-flex items-center gap-1">★ Best pairing · recommended for you</span>}
      <Card className={cx("overflow-hidden", pairing && "ring-2 ring-tap-green bg-lime-tint/40", !pairing && expanded && !isSelected && "ring-2 ring-lime", !pairing && isSelected && "ring-2 ring-tap-green")}>
      {/* header row — compact single-line layout per design */}
      <div className="p-5 flex flex-wrap items-center gap-4">
        {/* times + route — airport under time, no arrow */}
        <div className="flex items-center gap-4 min-w-[230px]">
          <div className="text-center"><div className="text-[22px] font-bold leading-none v2-num">{f.dep}</div><div className="text-[11px] text-ink-faint mt-1">{f.origin}</div></div>
          <div className="text-center text-ink-faint min-w-[60px]"><div className="text-[11px]">{f.duration}</div><div className="w-16 h-px bg-line-strong my-1.5 mx-auto" /><div className="text-[11px]">{m.stops ? `1 stop · ${m.hub}` : "Direct"}</div></div>
          <div className="text-center"><div className="text-[22px] font-bold leading-none v2-num">{f.arr}</div><div className="text-[11px] text-ink-faint mt-1">{f.dest}</div></div>
        </div>
        {/* status — vertical, centered, light weight */}
        <div className="text-center min-w-[92px]">
          {seatsLeft <= 4 && <div className="inline-block text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-tap-red/10 text-tap-red">{seatsLeft} seats left</div>}
          <div className="text-[10px] text-ink-faint mt-1">Booked {bookedToday}× today</div>
        </div>
        {/* airline block — TP mark + number, aircraft, bag + earn MI */}
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-1.5"><span className="font-black text-[13px] leading-none"><span className="text-tap-red">T</span><span className="text-tap-greenDeep">P</span></span><span className="text-[13px] font-semibold">{f.flight_no.replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")}</span></div>
          <div className="text-[11px] text-ink-faint mt-0.5">{f.aircraft}{m.features.length ? " · " + m.features.join(" · ") : ""}</div>
          <div className="flex items-center gap-2 mt-1.5">
            {classic.feats[1][1] ? <Badge tone="green">Bag included</Badge> : <Badge>No bag</Badge>}
            <span className="text-[11px] font-semibold text-ink-700">Earn {miles(milesEarn)} MI</span>
          </div>
          {pairing && <div className="text-[11px] text-tap-greenDeep font-medium mt-1.5 flex items-start gap-1.5"><span className="text-amber-500 leading-none mt-0.5">●</span> Home in {f.dest} by {f.arr} · same fare brand → bundle €15 off</div>}
        </div>
        {/* price panel — light grey, right-aligned */}
        <div className="text-right rounded-xl bg-surface-soft px-4 py-3 min-w-[148px]">
          {pairing && <div className="text-[11px] font-bold text-tap-greenDeep">BUNDLE −€15</div>}
          {selFare.milesOpt && <div className="text-[11px] font-semibold text-amber-600">OR {miles(selFare.milesOpt.mi)} MI + {EUR(selFare.milesOpt.cash)}</div>}
          <div className="text-[24px] font-bold v2-num leading-tight">{EUR(selFare.price)}</div>
          <div className="text-[10px] text-ink-faint">1 adult · {isSelected ? sel.fare : "Eco Classic"}</div>
          <div className="mt-2">
            {isSelected
              ? <Btn size="sm" variant="primary" className="w-full" onClick={onToggle}>{expanded ? "Hide fares ↑" : "Selected ✓"}</Btn>
              : <Btn size="sm" variant="outline" className="w-full" onClick={onToggle}>{expanded ? "Hide fares ↑" : "See 4 fares ↓"}</Btn>}
          </div>
        </div>
      </div>

      {/* expanded fare grid — shown whenever the card is expanded, including when a fare is
          already selected, so the user can re-open and switch fares (Outbound #62 / Inbound #15,#33) */}
      {expanded && (
        <div className="border-t border-line bg-surface-soft px-5 py-5">
          <div className="flex items-center justify-between mb-3">
            <div><div className="font-bold text-[15px]">Choose your fare</div><div className="text-[11px] text-ink-muted">All fares earn miles · 24h free cancel · Gold benefits applied</div></div>
            <button onClick={() => setCompare(true)} className="text-[12px] font-semibold text-tap-greenDeep hover:underline">Compare fares</button>
          </div>
          {compare && <CompareFareModal f={f} selectedKey={isSelected ? sel.fare : "Classic"} originCity={originCity} destCity={destCity} onClose={() => setCompare(false)} onPick={(fare) => { setCompare(false); onPick(f, fare); }} />}
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
                  <Btn variant={picked ? "primary" : "outline"} className="mt-3 w-full" onClick={() => onPick(f, fare)}>{picked ? "Selected ✓" : "Select →"}</Btn>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
    </div>
  );
}
