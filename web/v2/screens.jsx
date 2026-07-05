// FlyTAP v2 — screens. Homepage (logged-out) + the personalized Home (returning
// user), built to the approved Figma and wired to the live backend. Remaining
// screens are scaffolded as a navigable map of the full program.
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { api, EUR, miles, fmtDate, tierProgress, MILES_RATE } from "./lib.js";
import { Btn, Card, Pill, Eyebrow, PersonalizedTag, TierBadge, Field, Input, Icon, Divider, Img, imageFor, WhyChip, cx } from "./ui.jsx";
import { Page } from "./shell.jsx";
import { Results } from "./results.jsx";
import { Cart, Basket, Passenger, Payment, Confirmation, ExpressCheckout, StopoverBuilder, MilesShop } from "./checkout.jsx";
import { AIConcierge } from "./ai.jsx";
import { ManageBooking, CabinUpgrade, SeatChange, Rebook, CheckInIndirect, AddExtras, Refund, Retrieve, SplitBooking, DisruptionCenter } from "./mmb.jsx";
import { DemoConsole } from "./demo.jsx";

const TRIP_TABS = ["Flights", "Flights + Hotel", "Hotels", "Experiences", "Cabs & Transfers", "Flight Status"];
const ASSET = "/v2/assets/homepage/";   // #14/#5 — approved design assets

/* deterministic gradient "photo" header per city/route (real imagery can be added via AEM) */
const GRADS = [["#2e7d33", "#9efd38"], ["#1a1f29", "#46a41a"], ["#0a3d2e", "#c7f21f"], ["#163a4a", "#5ec6c0"], ["#3a2a1f", "#e8a23a"]];
function gradFor(seed) { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const g = GRADS[h % GRADS.length]; return { background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }; }

/* ─────────────────────────── shared: search widget ─────────────────────────── */
// #13 — passenger configuration panel: separate Adults / Children / Infants counters (replaces adult-only dropdown).
function PaxPanel({ adults, children, infants, onChange, buttonClassName }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const summary = [
    `${adults} adult${adults !== 1 ? "s" : ""}`,
    children ? `${children} child${children !== 1 ? "ren" : ""}` : "",
    infants ? `${infants} infant${infants !== 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" · ");
  const step = (k, delta, min, max) => {
    const cur = { adults, children, infants };
    cur[k] = Math.max(min, Math.min(max, cur[k] + delta));
    if (cur.infants > cur.adults) cur.infants = cur.adults;   // one lap infant per adult
    onChange(cur);
  };
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width }); };
  const toggle = () => { if (!open) place(); setOpen(o => !o); };
  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener("scroll", on, true); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open]); // eslint-disable-line
  const Row = ({ label, sub, val, k, min = 0, max = 9 }) => (
    <div className="flex items-center justify-between py-2">
      <div><div className="text-[13px] font-semibold text-ink">{label}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
      <div className="flex items-center gap-2.5">
        <button type="button" disabled={val <= min} onClick={() => step(k, -1, min, max)} className="w-7 h-7 rounded-full border border-line-strong inline-flex items-center justify-center text-[16px] leading-none text-ink disabled:opacity-30 hover:border-tap-green">−</button>
        <span className="w-5 text-center text-[14px] font-bold v2-num">{val}</span>
        <button type="button" disabled={val >= max} onClick={() => step(k, 1, min, max)} className="w-7 h-7 rounded-full border border-line-strong inline-flex items-center justify-center text-[16px] leading-none text-ink disabled:opacity-30 hover:border-tap-green">+</button>
      </div>
    </div>
  );
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={toggle} className={buttonClassName || "w-full text-left bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] inline-flex items-center justify-between"}>{summary}<span className="text-ink-faint text-[10px] ml-2">▾</span></button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
        <div className="fixed z-[61] bg-white rounded-xl border border-line shadow-pop p-3" style={{ left: pos.left, top: pos.top, width: "min(256px, calc(100vw - 24px))" }}>
          <Row label="Adults" sub="12+ years" val={adults} k="adults" min={1} />
          <div className="h-px bg-line" />
          <Row label="Children" sub="2–11 years" val={children} k="children" />
          <div className="h-px bg-line" />
          <Row label="Infants" sub="Under 2 · on lap" val={infants} k="infants" max={adults} />
          <button type="button" onClick={() => setOpen(false)} className="w-full mt-2 rounded-full bg-tap-green text-white py-2 text-[13px] font-semibold">Done</button>
        </div>
      </>, document.body)}
    </div>
  );
}
// #10 — airport picker: opens BELOW the field, with a search box that filters by code, city or country.
function AirportPicker({ value, onChange, airports = [], placeholder = "Select airport", buttonClassName }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const sel = airports.find(a => a.code === value);
  const ql = q.trim().toLowerCase();
  const list = (ql
    ? airports.filter(a => a.code.toLowerCase().includes(ql) || (a.city || "").toLowerCase().includes(ql) || (a.country || "").toLowerCase().includes(ql))
    : airports).slice(0, 80);
  const pick = (code) => { onChange(code); setOpen(false); setQ(""); };
  // Anchor the panel with position:fixed (viewport coords) so it escapes the
  // overflow-hidden search card / fields grid that would otherwise clip the results.
  const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setPos({ left: r.left, top: r.bottom + 6, width: r.width }); };
  const toggle = () => { if (!open) place(); setQ(""); setOpen(o => !o); };
  useEffect(() => {
    if (!open) return;
    place();
    const on = () => place();
    window.addEventListener("scroll", on, true); window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open]); // eslint-disable-line
  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={toggle} className={buttonClassName || "w-full text-left bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] inline-flex items-center justify-between"}>
        {sel ? <span className="truncate"><span className="font-bold">{sel.code}</span><span className="text-ink-muted"> · {sel.city}</span></span> : <span className="text-ink-faint">{placeholder}</span>}
        <span className="text-ink-faint text-[10px] ml-2 shrink-0">▾</span>
      </button>
      {open && pos && createPortal(<>
        <div className="fixed inset-0 z-[60]" onClick={() => { setOpen(false); setQ(""); }} />
        <div className="fixed z-[61] bg-white rounded-xl border border-line shadow-pop overflow-hidden" style={{ left: pos.left, top: pos.top, width: "min(288px, calc(100vw - 24px))" }}>
          <div className="p-2 border-b border-line">
            <div className="relative"><Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search city, airport or country" className="w-full bg-surface border border-line rounded-lg pl-8 pr-3 py-2 text-[13px] outline-none focus:border-tap-green" /></div>
          </div>
          <div className="max-h-64 overflow-y-auto v2-track">
            {list.length === 0 && <div className="px-3 py-4 text-[12px] text-ink-faint text-center">No airports match "{q}"</div>}
            {list.map(a => (
              <button key={a.code} type="button" onClick={() => pick(a.code)} className={cx("w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-surface-mute transition-colors", a.code === value && "bg-lime-tint/40")}>
                <span className="w-9 shrink-0 text-[12px] font-bold text-ink v2-num">{a.code}</span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold truncate">{a.city}</span>{a.country && <span className="block text-[11px] text-ink-faint truncate">{a.country}</span>}</span>
                {a.code === value && <Icon name="check" size={14} className="text-tap-green shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </>, document.body)}
    </div>
  );
}
function SearchWidget({ airports = [], onSearch, defaults = {} }) {
  const [tab, setTab] = useState("Flights");
  const [type, setType] = useState("round");
  const [from, setFrom] = useState(defaults.origin || "OPO");
  const [to, setTo] = useState(defaults.dest || "");
  const [date, setDate] = useState(defaults.date || "");
  const [ret, setRet] = useState(defaults.ret || "");
  const [pax, setPax] = useState(1);
  const [kids, setKids] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabin, setCabin] = useState("Economy");
  const [stopover, setStopover] = useState(false);
  return (
    // #32 — two-container layout: OUTER translucent/glass frame (blur lives here only),
    // INNER solid white box holds the tabs + form. Tabs restyled to pills with a clear
    // active state. Replaces the previous single flat Card.
    <div className="rounded-[26px] bg-white/55 backdrop-blur-2xl border border-white/60 shadow-pop p-2.5 sm:p-3">
      {/* tab bar — pill style, on the glass frame */}
      <div className="flex gap-1.5 overflow-x-auto v2-track px-1.5 pt-1 pb-2.5">
        {TRIP_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={cx("shrink-0 px-4 py-2 rounded-full text-[12px] font-bold transition-colors", tab === t ? "bg-tap-green text-white shadow-sm" : "bg-white/60 text-ink-muted hover:bg-white")}>{t}</button>
        ))}
      </div>
      {/* inner solid white box — the form content */}
      <div className="rounded-[20px] bg-surface shadow-sm p-4 sm:p-5">
      <div className="flex gap-4 text-[12px] font-semibold text-ink-muted mb-3">
        {[["round", "Round trip"], ["oneway", "One way"], ["multi", "Multi-city"]].map(([k, l]) => (
          <button key={k} onClick={() => setType(k)} className={cx("pb-1 border-b-2", type === k ? "border-tap-green text-ink" : "border-transparent")}>{l}</button>
        ))}
      </div>
      <div className="grid lg:grid-cols-12 gap-3">
        <Field label="From" className="lg:col-span-3"><AirportPicker value={from} onChange={setFrom} airports={airports} placeholder="Origin" /></Field>
        <Field label="To" className="lg:col-span-3"><AirportPicker value={to} onChange={setTo} airports={airports} placeholder="Where to?" /></Field>
        <Field label="Depart" className="lg:col-span-2"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        {type === "round" && <Field label="Return" className="lg:col-span-2"><Input type="date" value={ret} onChange={e => setRet(e.target.value)} /></Field>}
        <Field label="Travellers" className="lg:col-span-2">
          <PaxPanel adults={pax} children={kids} infants={infants} onChange={c => { setPax(c.adults); setKids(c.children); setInfants(c.infants); }} />
        </Field>
      </div>
      <datalist id="ap">{airports.map(a => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}</datalist>
      <div className="mt-4">
        <label className="flex items-center gap-2 text-[12px] font-medium text-ink-muted"><input type="checkbox" checked={stopover} onChange={e => setStopover(e.target.checked)} className="accent-[#46a41a]" /> Add Portugal Stopover <span className="text-ink-faint">· free, up to 10 days</span></label>
      </div>
      </div>
      {/* F6 — the Search flight CTA is a separate component, outside the grouped Route/Date/Passenger/Cabin container */}
      <div className="flex justify-end px-1 pt-3">
        <Btn size="lg" className="w-full sm:w-auto" onClick={() => onSearch({ origin: from, dest: to, date, ret, pax: pax + kids, adults: pax, children: kids, infants, cabin, type, stopover })}><Icon name="search" /> Search flights</Btn>
      </div>
    </div>
  );
}

/* ─────────────────────────── shared: destination grid ─────────────────────────── */
function DestGrid({ destinations = [], go }) {
  const [filter, setFilter] = useState("Popular");
  const chips = ["Popular", "Stopover-friendly", "Beach", "City breaks", "Long weekend"];
  return (
    <section className="mt-10">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div><Eyebrow>Where do you want to go next?</Eyebrow><h2 className="text-[22px] font-bold mt-1">Picked for you</h2></div>
        <div className="hidden sm:flex gap-1">{chips.map(c => <button key={c} onClick={() => setFilter(c)} className={cx("px-3 py-1.5 rounded-full text-[12px] font-semibold", filter === c ? "bg-lime text-ink" : "bg-surface-mute text-ink-muted")}>{c}</button>)}</div>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {destinations.slice(0, 8).map(d => (
          <Card key={d.code} className="overflow-hidden hover:shadow-pop transition-shadow cursor-pointer" onClick={() => go("results", { origin: d.origin, dest: d.code })}>
            <div className="h-28 relative overflow-hidden"><Img seed={d.code + "-" + d.city} src={d.image_url || imageFor(d.code, d.city)} alt={d.city} className="absolute inset-0 w-full h-full" />{d.emoji && <span className="absolute bottom-2 left-3 text-2xl drop-shadow">{d.emoji}</span>}</div>
            <div className="p-3.5">
              <div className="flex items-center justify-between"><div className="font-bold text-[15px]">{d.city}</div><span className="text-[11px] text-ink-faint v2-num">{d.code}</span></div>
              <div className="text-[11px] text-ink-muted mt-1 line-clamp-2 min-h-[30px]">{d.reason || d.tag}</div>
              {(d.reason || d.signals) && <WhyChip reason={d.reason} signals={d.signals} className="mt-1" />}
              <div className="flex items-center justify-between mt-2.5"><div className="text-[13px] font-bold">from {EUR(d.price)}</div><div className="flex items-center gap-1">{d.miles_price && <Pill tone="green"><Icon name="spark" size={10} /> miles</Pill>}<Pill tone={d.contentSource === "aem" ? "lime" : "slate"}>{d.contentSource || "local"}</Pill></div></div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── HOMEPAGE (logged-out) ─────────────────────────── */
export function Homepage({ shared, go }) {
  const { airports = [], destinations = [] } = shared;
  return (
    <Page wide>
      <section className="relative rounded-3xl overflow-hidden bg-surface-navy text-white px-6 sm:px-10 py-12 mb-6 v2-in">
        <div className="absolute inset-0 opacity-30 bg-gradient-to-tr from-tap-green/30 via-transparent to-lime/20" />
        <div className="relative max-w-2xl">
          <Pill tone="lime" className="mb-3">NEW · Summer in Portugal</Pill>
          <h1 className="text-[40px] sm:text-[52px] leading-[1.02] font-black tracking-tight">Fly more. Stay longer.<br />See Portugal on the way.</h1>
          <p className="mt-3 text-white/70 text-[15px]">Free Portugal Stopover up to 10 days · earn Miles on every booking · best-price guarantee.</p>
        </div>
      </section>
      <div className="-mt-16 relative z-10 max-w-content mx-auto"><SearchWidget airports={airports} onSearch={(q) => go("results", q)} /></div>
      <div className="max-w-content mx-auto">
        <DestGrid destinations={destinations} go={go} />
        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          {[["plane", "Free Portugal Stopover", "Break your long-haul in Lisbon or Porto for up to 10 days — no extra fare."], ["spark", "Earn & spend Miles", "Collect on flights, hotels and cars; redeem against fares and upgrades."], ["check", "Best-price guarantee", "Transparent fees, free cancellation on select fares, 24/7 disruption support."]].map(([ic, t, s]) => (
            <Card key={t} className="p-5"><span className="text-tap-green"><Icon name={ic} size={20} /></span><div className="mt-3 font-bold text-[15px]">{t}</div><div className="text-[12px] text-ink-muted mt-1">{s}</div></Card>
          ))}
        </div>
      </div>
    </Page>
  );
}

/* ─────────────────────────── HOME (returning user · Daniel) ─────────────────────────── */
/* editable, functional hero search (route editable · trip-type + pay-with-miles work) */
function HomeAIPanel({ go, aiOn, onToggle }) {
  const [q, setQ] = useState("");
  const cats = ["Book Flights", "Book Hotels", "Book Experiences", "Book Cabs & Transfers", "Check Flight Status", "Manage Trips", "More.."];
  const submit = () => go("ai");
  return (
    <div className="mt-5">
      <div className="flex items-center justify-center gap-2 text-[17px] font-bold"><Icon name="spark" size={18} className="text-tap-green" /> Enhance your travel journey</div>
      <div className="flex flex-wrap justify-center gap-2 mt-5">
        {cats.map(c => <button key={c} onClick={submit} className="rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] font-medium shadow-sm hover:border-tap-green hover:text-tap-greenDeep transition-colors">{c}</button>)}
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="e.g. Book Thursday 06:10 LIS → OPO with miles" className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint" />
        <button className="text-ink-muted hover:text-ink shrink-0" title="Voice input"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v4" /></svg></button>
        <button onClick={submit} className="w-10 h-10 rounded-full bg-surface-dark text-white inline-flex items-center justify-center shrink-0 hover:bg-ink-strong" title="Ask TAP AI"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="9" width="2.5" height="6" rx="1.25" /><rect x="9" y="5" width="2.5" height="14" rx="1.25" /><rect x="14" y="7" width="2.5" height="10" rx="1.25" /><rect x="19" y="10" width="2.5" height="4" rx="1.25" /></svg></button>
      </div>
    </div>
  );
}

function HeroSearch({ u, pat, cityOf, airports, go }) {
  const retDefault = (() => { if (!pat.recommendedDate) return ""; const d = new Date(pat.recommendedDate); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); })();
  const [type, setType] = useState("round");
  const [from, setFrom] = useState(pat.origin || u.home_airport || "OPO");
  const [to, setTo] = useState(pat.dest || "LIS");
  const [date, setDate] = useState(pat.recommendedDate || "");
  const [ret, setRet] = useState(retDefault);
  const [pax, setPax] = useState(1);
  const [kids, setKids] = useState(0);
  const [infants, setInfants] = useState(0);
  const [cabin, setCabin] = useState("Economy");
  const [payMiles, setPayMiles] = useState(false);
  const [leg2, setLeg2] = useState({ from: pat.dest || "LIS", to: "", date: "" });
  const swap = () => { setFrom(to); setTo(from); };
  const go2 = () => {
    if (type === "multi") {
      // B1 — build the leg list; step through them one at a time in Results.
      const legs = [{ origin: from, dest: to, date }];
      if (leg2.to) legs.push({ origin: leg2.from, dest: leg2.to, date: leg2.date });
      return go("results", { type: "multi", legs, legIndex: 0, pax: pax + kids, adults: pax, children: kids, infants, cabin, payMiles, origin: from, dest: legs[legs.length - 1].dest, date });
    }
    return go("results", { origin: from, dest: to, date, ret: type === "oneway" ? "" : ret, type, pax: pax + kids, adults: pax, children: kids, infants, cabin, payMiles });
  };
  const lbl = "text-[10px] font-semibold uppercase tracking-[1px] text-[rgba(139,142,134,1)]";
  const bare = "w-full min-w-0 bg-transparent text-[15px] font-bold outline-none";
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const compactRange = () => {
    const d = date ? new Date(date + "T00:00:00") : null, r = ret ? new Date(ret + "T00:00:00") : null;
    if (!d) return "Select dates";
    const dd = d.getDate(), dm = MON[d.getMonth()];
    if (type === "oneway" || !r) return `${dd} ${dm}`;
    const rd = r.getDate(), rm = MON[r.getMonth()];
    return dm === rm ? `${dd}–${rd} ${dm}` : `${dd} ${dm} – ${rd} ${rm}`;
  };

  return (
    <div className="mt-5">
      {/* #6 inner search module — 18px radius, soft shadow, status row contained inside */}
      <div className="rounded-[18px] bg-surface overflow-hidden" style={{ boxShadow: "0px 8px 24px -16px rgba(15,20,16,0.12)" }}>
        {/* #7 service tabs — flat, integrated into the bar */}
        <div className="flex overflow-x-auto v2-track font-bold border-b border-line px-1">
          {TRIP_TABS.map((t, i) => <button key={t} className={cx("shrink-0 px-4 py-3 border-b-2 -mb-px transition-colors whitespace-nowrap text-[13.5px]", i === 0 ? "font-bold" : "border-transparent text-ink-muted hover:text-ink font-semibold")} style={i === 0 ? { color: "rgba(70,164,26,1)", borderBottomColor: "rgba(70,164,26,1)" } : {}}>{t}</button>)}
        </div>
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {/* #8 trip-type selector — compact 251×37 pill group */}
            <div className="inline-flex gap-1 p-1 rounded-[10px]" style={{ background: "rgba(250,250,247,1)" }}>
              {[["round", "Round trip"], ["oneway", "One way"], ["multi", "Multi-city"]].map(([k, l]) => (
                <button key={k} onClick={() => setType(k)} className="px-3 py-1 rounded-[7px] text-[12px] font-semibold transition-colors" style={type === k ? { background: "rgba(255,255,255,1)", color: "rgba(20,22,28,1)", boxShadow: "0px 1px 2px 0px rgba(20,22,28,0.06)" } : { color: "rgba(107,107,107,1)" }}>{l}</button>
              ))}
            </div>
            {/* #9 pay-with-miles — toggle first, then label + filled star */}
            <button onClick={() => setPayMiles(v => !v)} className="inline-flex items-center gap-2.5 text-[12px] font-semibold text-ink-muted">
              <span className={cx("w-9 h-5 rounded-full relative transition-colors shrink-0", payMiles ? "bg-tap-green" : "bg-surface-mute")}><span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", payMiles ? "right-0.5" : "left-0.5")} /></span>
              Pay with Miles <span className={cx("text-[14px] leading-none", payMiles ? "text-tap-green" : "text-ink-faint")}>✦</span>
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-line overflow-hidden grid lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-line">
            {/* #10 #13 route — single container, location icons + circular swap between */}
            <div className="lg:col-span-4 p-4">
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 min-w-0">
                  <div className={lbl}>From</div>
                  <div className="flex items-center gap-1.5 mt-1"><Icon name="plane" size={14} className="text-tap-green shrink-0" /><AirportPicker value={from} onChange={setFrom} airports={airports} buttonClassName={cx(bare, "text-left inline-flex items-center justify-between")} /></div>
                </div>
                <button onClick={swap} title="Swap origin & destination" aria-label="Swap origin and destination" className="shrink-0 w-[34px] h-[34px] rounded-full inline-flex items-center justify-center self-end mb-0.5 hover:brightness-95 transition-[filter]" style={{ border: "1px solid rgba(217,230,203,1)", background: "rgba(241,245,236,1)" }}><Icon name="swap" size={14} className="text-tap-greenDeep" /></button>
                <div className="flex-1 min-w-0">
                  <div className={lbl}>To</div>
                  <div className="flex items-center gap-1.5 mt-1"><Icon name="globe" size={14} className="text-tap-greenDeep shrink-0" /><AirportPicker value={to} onChange={setTo} airports={airports} buttonClassName={cx(bare, "text-left inline-flex items-center justify-between")} /></div>
                </div>
              </div>
            </div>
            {/* #14 dates — compact range + calendar icon (dynamic, still selectable) */}
            <div className="lg:col-span-3 p-4">
              <div className={lbl}>{type === "oneway" ? "Depart" : "Depart · Return"}</div>
              <div className="flex items-center gap-2 mt-1.5"><Icon name="clock" size={14} className="text-ink-muted shrink-0" /><span className="text-[15px] font-bold">{compactRange()}</span></div>
              <div className="flex items-center gap-1.5 mt-1">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-transparent text-[10px] text-ink-faint outline-none w-[94px]" />
                {type !== "oneway" && <><span className="text-ink-faint text-[10px]">→</span><input type="date" value={ret} onChange={e => setRet(e.target.value)} className="bg-transparent text-[10px] text-ink-faint outline-none w-[94px]" /></>}
              </div>
            </div>
            {/* #15 passenger — traveler icon before count */}
            <div className="lg:col-span-2 p-4"><div className={lbl}>Passenger</div><div className="flex items-center gap-2 mt-1.5"><Icon name="user" size={14} className="text-ink-muted shrink-0" /><PaxPanel adults={pax} children={kids} infants={infants} onChange={c => { setPax(c.adults); setKids(c.children); setInfants(c.infants); }} buttonClassName={cx(bare, "text-left inline-flex items-center justify-between")} /></div><div className="text-[10px] text-ink-faint mt-1">{u.first_name} · saved</div></div>
            <div className="lg:col-span-1 p-4"><div className={lbl}>Cabin</div><select value={cabin} onChange={e => setCabin(e.target.value)} className={cx(bare, "mt-1.5")}>{["Economy", "Premium", "Business"].map(c => <option key={c}>{c}</option>)}</select></div>
            {/* #11 search CTA — 161×92 rounded green button */}
            <div className="lg:col-span-2 p-2 flex items-stretch">
              <button onClick={go2} className="w-full text-white font-bold text-[14px] flex items-center justify-center gap-2.5 rounded-[16px] hover:opacity-95 transition-opacity" style={{ background: "rgba(70,164,26,1)", padding: "16px 22px" }}>Search flight <Icon name="arrow" size={15} /></button>
            </div>
          </div>
          {type === "multi" && (
            <div className="grid lg:grid-cols-12 gap-3 mt-3">
              <div className={cx("rounded-xl border border-line bg-surface-soft p-3", "lg:col-span-3")}><div className={lbl}>Flight 2 · from</div><select value={leg2.from} onChange={e => setLeg2({ ...leg2, from: e.target.value })} className={cx(bare, "mt-1 appearance-none cursor-pointer")}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select></div>
              <div className={cx("rounded-xl border border-line bg-surface-soft p-3", "lg:col-span-3")}><div className={lbl}>Flight 2 · to</div><select value={leg2.to} onChange={e => setLeg2({ ...leg2, to: e.target.value })} className={cx(bare, "mt-1 appearance-none cursor-pointer")}><option value="">Where to?</option>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select></div>
              <div className={cx("rounded-xl border border-line bg-surface-soft p-3", "lg:col-span-3")}><div className={lbl}>Flight 2 · date</div><input type="date" value={leg2.date} onChange={e => setLeg2({ ...leg2, date: e.target.value })} className={cx(bare, "mt-1 text-[13px]")} /></div>
              <div className="lg:col-span-3 flex items-center text-[11px] text-ink-faint">Add up to 5 flights · we'll price the full itinerary.</div>
            </div>
          )}
          {/* #6 status indicators — contained inside the search module */}
          <div className="flex flex-wrap gap-4 mt-4 text-[12px] text-ink-muted">
            {[["Traveler details saved", true], [`Default ${u.card_brand || "Mastercard"} ready`, true], [`${u.tier} benefits active`, true], ["Use miles available", (u.miles || 0) > 0]].map(([t, ok], i) => (
              <span key={i} className="flex items-center gap-1.5"><Icon name="check" size={13} className={ok ? "text-tap-green" : "text-ink-faint"} /> {t}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Home({ shared, go }) {
  const { profile, airports = [] } = shared;
  // The resume card must reflect the LIVE journey, re-read on every mount — not the
  // boot-time shared snapshot. Otherwise a search made after boot (or on another channel)
  // updates the server but never appears here. Seed from the snapshot for instant paint.
  const [journey, setJourney] = useState(shared.journey);
  const [rec, setRec] = useState(null);
  const [anc, setAnc] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [offerTiles, setOfferTiles] = useState(null);
  const [aiOn, setAiOn] = useState(false);          // TAP AI is OFF by default
  const tplRef = useRef(null);
  const scrollTpl = (dir) => tplRef.current?.scrollBy({ left: dir * 336, behavior: "smooth" });
  // High-contrast status badge for image overlays — solid/blurred white pill so it reads on any photo
  const overlayBadge = "absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 backdrop-blur px-2.5 py-1 text-[11px] font-bold shadow-sm";
  useEffect(() => {
    api.get("/recommendation").then(setRec).catch(() => {});
    api.get("/ancillaries").then(a => setAnc((a || []).sort((x, y) => (y.recommended ? 1 : 0) - (x.recommended ? 1 : 0)))).catch(() => {});
    api.get("/bookings").then(setBookings).catch(() => {});
    api.get("/offers/tiles").then(d => setOfferTiles(d?.tiles || null)).catch(() => {});
    api.get("/journey").then(j => setJourney(j && j.stage ? j : null)).catch(() => {});
  }, []);
  if (!profile) return <Page><div className="py-20 text-center text-ink-faint">Loading your journey…</div></Page>;

  const u = profile.user, pat = profile.pattern || {}, prog = tierProgress(u.tier, u.miles);
  const cityOf = (c) => airports.find(a => a.code === c)?.city || c;
  const resumable = journey && journey.stage && journey.stage !== "search" && journey.dest;
  const upcoming = bookings.filter(b => b.status === "confirmed" && b.days_to_go >= 0).sort((a, b) => a.days_to_go - b.days_to_go)[0] || bookings.find(b => b.status === "confirmed");
  const search = () => go("results", { origin: pat.origin || u.home_airport, dest: pat.dest || "LIS", date: pat.recommendedDate, type: "round", pax: 1, cabin: "Economy" });

  return (
    <div className="bg-surface-mute">
      {/* HERO: full-bleed video background, white content panel */}
      <div className="relative overflow-hidden bg-surface-navy">
        <video className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted playsInline preload="auto" ref={v => { if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } }}>
          <source src="/v2/hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/15" />
        <div className="relative mx-auto max-w-page px-6 pt-12 pb-14">
          <div className="rounded-[37px] border-2 border-white shadow-pop p-5 sm:p-8 max-w-[1320px] mx-auto" style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }}>
            <div className="flex items-start justify-between">
              <PersonalizedTag />
              <button onClick={() => setAiOn(v => !v)} className="inline-flex items-center gap-1.5 rounded-full bg-white shadow-sm text-ink-muted text-[12px] font-semibold pl-3.5 pr-2 py-2"><span className={cx("w-9 h-5 rounded-full relative transition-colors shrink-0", aiOn ? "bg-tap-green" : "bg-ink/15")}><span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow", aiOn ? "right-0.5" : "left-0.5")} /></span> TAP AI</button>
            </div>
            <div className="text-ink-muted text-[14px] mt-3">Bom dia, {u.first_name}.</div>
            <h1 className="text-[32px] font-semibold tracking-[-0.8px] leading-none text-[rgba(15,20,16,1)]">{aiOn ? "Ask me anything about your trip." : "Ready for your usual trip?"}</h1>
            {aiOn
              ? <HomeAIPanel go={go} aiOn={aiOn} onToggle={() => setAiOn(false)} />
              : <HeroSearch u={u} pat={pat} cityOf={cityOf} airports={airports} go={go} />}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-page px-6 py-8 space-y-12">
        {/* COMMUTE TEMPLATES */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div><h2 className="text-[22px] font-bold">Your commute templates</h2><div className="flex gap-4 text-[12px] font-semibold mt-2"><span className="text-ink border-b-2 border-ink pb-0.5">Templates</span><span className="text-ink-faint">Recent searches</span><span className="text-ink-faint">Favourites</span></div></div>
            <div className="flex gap-2"><button onClick={() => scrollTpl(-1)} className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-ink-muted hover:bg-surface-mute">←</button><button onClick={() => scrollTpl(1)} className="w-9 h-9 rounded-full bg-surface-dark text-white flex items-center justify-center hover:bg-ink-strong">→</button></div>
          </div>
          <div ref={tplRef} className="flex gap-3 overflow-x-auto v2-track snap-x pb-2 -mx-1 px-1">
            {buildTemplates(profile, cityOf).map((t, i) => (
              <Card key={i} className="overflow-hidden shrink-0 w-[377px] snap-start border" style={{ borderRadius: "22px", boxShadow: "0px 4px 16px 0px rgba(0,0,0,0.06)" }}>
                <div className="h-[100px] relative overflow-hidden"><Img seed={"route-" + t.route} src={imageFor(t.route)} className="absolute inset-0 w-full h-full" /></div>
                <div className="p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[rgba(70,164,26,1)]">{t.label}</span>
                    <span className="text-[10px] text-ink-faint">{t.used ? `Used ${t.used}×` : t.shuttle ? "Recurring" : ""}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2"><div className="text-[15px] font-bold">{t.route}</div><div className="text-[12px] font-semibold text-ink-muted v2-num">{t.time}</div></div>
                  <div className="text-[11px] text-ink-muted mt-2 min-h-[28px]">{t.detail}</div>
                  <Btn size="sm" variant="soft" className="mt-2 w-full" onClick={() => go(t.shuttle ? "manage" : "express")}>{t.shuttle ? "Manage shuttle" : "One-tap book"}</Btn>
                </div>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4 text-[12px]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Recent</span>
            {(profile.recentSearches || []).slice(0, 3).map((s, i) => (
              <button key={i} onClick={() => go("results", { origin: s.origin, dest: s.dest, date: s.travel_date, type: "round" })} className="px-3 py-1.5 rounded-full bg-surface border border-line font-semibold hover:bg-surface-mute">{s.origin} → {s.dest} · {fmtDate(s.travel_date).replace(/ \d{4}/, "")}</button>
            ))}
            <button className="px-3 py-1.5 rounded-full bg-surface-mute text-ink-muted font-semibold">+ more</button>
          </div>
        </section>
      </div>

      {/* MILES & GO JOURNEY (dark full-bleed) */}
      <section className="text-white" style={{ background: "linear-gradient(90deg, #000000 0%, #143817 100%)" }}>
        <div className="mx-auto max-w-content px-6 py-20 text-center">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-gradient-to-br from-[#E8C75A] to-[#C9A227] text-ink"><Icon name="spark" size={11} /> Your Miles&Go journey · {u.tier} member</span>
          <h2 className="text-[44px] font-black leading-tight mt-5">{prog.next ? <>You're {miles(prog.toGo)} miles<br />from {prog.next}, {u.first_name}.</> : <>You're at the top tier, {u.first_name}.</>}</h2>
          <p className="text-white/60 text-[14px] mt-3 max-w-2xl mx-auto">One Lisbon stopover + one European return gets you there — and unlocks free upgrades and lounge access for two.</p>
          <div className="mt-8 rounded-[24px] p-9 text-left" style={{ background: "rgba(13,13,13,0.2)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex flex-wrap items-center justify-center gap-8 text-center">
              <div><div className="text-[10px] uppercase tracking-wide text-white/50">Current balance</div><div className="text-[34px] font-black v2-num">{miles(u.miles)} <span className="text-[14px] font-medium text-white/50">tap.miles</span></div><div className="text-[11px] mt-1"><TierBadge tier={u.tier} /> {prog.next && <span className="text-white/50 ml-1">You · {miles(prog.toGo)} mi to <span className="text-lime font-bold uppercase">{prog.next}</span></span>}</div></div>
              {prog.next && <div className="rounded-[18px] p-3.5 min-w-[280px] text-center" style={{ background: "rgba(15,26,17,1)", border: "1px solid rgba(46,77,52,1)" }}><div className="text-[40px] font-black text-lime leading-none v2-num">{prog.pct}%</div><div className="text-[10px] uppercase tracking-wide text-white/50 mt-1">Progress to {prog.next}</div><div className="h-2 rounded-full bg-white/15 mt-2 overflow-hidden"><div className="h-full rounded-full" style={{ width: prog.pct + "%", background: "linear-gradient(90deg,#9efd38,#8b5cf6)" }} /></div></div>}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-5">
              {(offerTiles && offerTiles.length ? offerTiles : [
                { icon: "home", img: ASSET + "because-you-are-gold.png", badge: "Because you're " + u.tier, title: "Use miles to discount your Lisbon hotel", detail: "Apply 8,000 mi to any 3-night stay · save up to €80 instantly.", value: "8,000 mi", cta: "Apply", reason: `${u.tier} member · ${miles(u.miles)} tap.miles available (users)` },
                { icon: "plane", img: ASSET + "limited-next-trip.png", badge: "Limited · next trip", title: "Upgrade " + cityOf(pat.origin || "LIS") + "–" + cityOf(pat.dest || "OPO") + " to Business with miles", detail: "20% mileage discount when upgrading on your existing booking.", value: "42,000 mi", cta: "Upgrade", reason: `${cityOf(pat.origin || "LIS")}–${cityOf(pat.dest || "OPO")} is your most-flown route (travel_history)` },
                { icon: "star", img: ASSET + "partner-offer.png", badge: "Partner offer · Nov", title: "Earn 3× miles at Memmo Príncipe Real", detail: "Triple miles when booking your favourite hotel through voa stay.", value: "3× MI", cta: "Activate", reason: "Memmo Príncipe Real is in your recent stays (bookings)" },
              ]).slice(0, 3).map((o, i) => (
                <div key={o.id || i} className="rounded-[14px] p-[18px] flex flex-col text-left" style={{ background: "rgba(15,26,17,1)", border: "1px solid rgba(46,77,52,1)" }}>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="w-11 h-11 rounded-xl inline-flex items-center justify-center text-lime shrink-0 overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(158,253,56,0.18), rgba(46,125,51,0.25))", border: "1px solid rgba(158,253,56,0.25)" }}>{o.img ? <img src={o.img} alt="" className="w-6 h-6 object-contain" onError={e => { e.currentTarget.style.display = "none"; }} /> : <Icon name={o.icon} size={20} />}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-lime-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep"><Icon name="spark" size={9} /> {o.badge}</span>
                  </div>
                  <div className="text-[14px] font-bold mt-3">{o.title}</div>
                  <div className="text-[11px] text-white/50 mt-1 flex-1">{o.detail}</div>
                  {(o.reason || o.signals) && <WhyChip reason={o.reason} signals={o.signals} dark className="mt-2" />}
                  <div className="h-px bg-white/10 my-3" />
                  <div className="flex items-center justify-between"><span className="text-[14px] font-black v2-num text-lime">{o.value}</span><Btn size="sm" variant="lime" onClick={() => go(o.action || "miles")}>{o.cta} →</Btn></div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6 flex items-center justify-center gap-2 pt-2"><span className="text-[14px]" style={{ color: "rgba(158,253,56,1)" }}>✦</span><span className="text-[14px] font-medium leading-none text-white" style={{ opacity: 0.8 }}>Earn up to {miles(Math.round((rec?.package?.total || pat.usualPrice || 250) * 12))} voa.miles on your Lisbon stopover hotel and experiences this trip.</span></div>
        </div>
      </section>

      <div className="mx-auto max-w-page px-6 py-10 space-y-12">
        {/* PICK UP WHERE YOU LEFT OFF */}
        <section>
          <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Pick up where you left off</h2><span className="text-[11px] text-ink-faint">{journey?.updated_at ? "Updated " + timeAgo(journey.updated_at) : ""}</span></div>
          <div className="grid md:grid-cols-3 gap-4">
            {/* usual trip */}
            <Card className="overflow-hidden flex flex-col">
              <div className="h-40 relative overflow-hidden"><Img seed={"dest-" + (pat.dest || "LIS")} src={ASSET + "book-lisbon-porto.jpg"} className="absolute inset-0 w-full h-full" /><span className={cx(overlayBadge, "text-tap-greenDeep")}><Icon name="home" size={11} /> Usual trip</span></div>
              <div className="p-4 flex flex-col flex-1">
                <div className="font-bold text-[15px]">Book {cityOf(pat.origin || "OPO")} → {cityOf(pat.dest || "LIS")}</div>
                <div className="text-[12px] text-ink-muted mt-1">{pat.recommendedLabel} {pat.usualDep} · fare from {EUR(pat.usualPrice)} · hand bag only.</div>
                <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="slate">2 taps</Pill><Pill tone="slate">Default card</Pill><Pill tone="slate">{miles(u.miles)} mi avail.</Pill></div>
                <div className="mt-auto"><div className="h-px bg-line my-3" />
                <div className="flex items-center justify-between"><div><div className="text-[9px] uppercase tracking-wide text-ink-faint">from ({rec?.package?.hotelNights || 3} night{(rec?.package?.hotelNights || 3) !== 1 ? "s" : ""} · 1 pax)</div><div className="text-[18px] font-black v2-num">€{Number(rec?.package?.total || pat.usualPrice || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div><Btn size="sm" variant="outline" onClick={() => go("express")}>Book Now →</Btn></div></div>
              </div>
            </Card>
            {/* resume */}
            <Card className="overflow-hidden flex flex-col">
              <div className="h-40 relative overflow-hidden"><Img seed={"resume-" + (journey?.dest || "OPO")} src={ASSET + "continue-booking.jpg"} className="absolute inset-0 w-full h-full" /><span className="absolute inset-0 bg-black/15" /><span className={cx(overlayBadge, resumable ? "text-tap-greenDeep" : "text-ink-muted")}><Icon name="clock" size={11} /> {resumable ? "In-progress" : "No draft"}</span></div>
              <div className="p-4 flex flex-col flex-1">
                {resumable ? <>
                  <div className="font-bold text-[15px]">Resume booking</div>
                  <div className="text-[12px] text-ink-muted mt-1">{journey.origin} → {journey.dest} · stopped at {journey.stage}.{journey.seat ? ` Seat ${journey.seat} held.` : ""}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="green">{["search", "results", "seat", "extras", "review"].indexOf(journey.stage) + 1} of 5 done</Pill><Pill tone="slate">Fare held</Pill></div>
                  <div className="mt-auto"><div className="h-px bg-line my-3" /><div className="flex justify-end"><Btn size="sm" variant="outline" onClick={() => { if (typeof window !== "undefined") window.__tapForceReval = true; api.post("/journey/resume", {}).catch(() => {}); const _sr = { search: "results", results: "results", seat: "results", extras: "cart", review: "cart" }; go(_sr[journey.stage] || "results", { origin: journey.origin || pat.origin || u.home_airport, dest: journey.dest || pat.dest || "LIS", date: journey.date || journey.travel_date || pat.recommendedDate, type: "round", pax: 1, cabin: journey.cabin || "Economy" }); }}>Continue →</Btn></div></div>
                </> : <>
                  <div className="font-bold text-[15px]">Nothing in progress</div>
                  <div className="text-[12px] text-ink-muted mt-1">Start a new search to begin a booking.</div>
                  <div className="mt-auto"><div className="h-px bg-line my-3" /><div className="flex justify-end"><Btn size="sm" variant="outline" onClick={search}>New search →</Btn></div></div>
                </>}
              </div>
            </Card>
            {/* tomorrow / boarding */}
            <Card className="overflow-hidden flex flex-col">
              <div className="h-40 relative overflow-hidden"><Img seed={"trip-" + (upcoming?.flight?.dest || "OPO")} src={imageFor("trip-" + (upcoming?.flight?.dest || "OPO"), cityOf(upcoming?.flight?.dest || "OPO"))} className="absolute inset-0 w-full h-full" /><span className="absolute inset-0 bg-black/15" /><span className={cx(overlayBadge, upcoming ? "text-tap-greenDeep" : "text-ink-muted")}><Icon name="clock" size={11} /> {upcoming ? "Upcoming" : "No trips"}</span></div>
              <div className="p-4 flex flex-col flex-1">
                {upcoming ? <>
                  <div className="font-bold text-[15px]">{upcoming.flight_no} · {upcoming.flight?.origin} → {upcoming.flight?.dest}</div>
                  <div className="text-[12px] text-ink-muted mt-1">Boarding {upcoming.flight?.dep} · seat {upcoming.seat || "—"}. {upcoming.days_to_go === 0 ? "Today." : upcoming.days_to_go === 1 ? "Tomorrow." : "On time."}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="slate">Check-in soon</Pill><Pill tone="slate">Mobile pass</Pill></div>
                  <div className="mt-auto"><div className="h-px bg-line my-3" /><div className="flex justify-end"><Btn size="sm" variant="outline" onClick={() => go("manage")}>Manage trip →</Btn></div></div>
                </> : <>
                  <div className="font-bold text-[15px]">No upcoming trips</div>
                  <div className="text-[12px] text-ink-muted mt-1">Book your usual to get going.</div>
                  <div className="mt-auto"><div className="h-px bg-line my-3" /><div className="flex justify-end"><Btn size="sm" variant="outline" onClick={() => go("express")}>Book usual →</Btn></div></div>
                </>}
              </div>
            </Card>
          </div>
        </section>

      </div>

      {/* TOMORROW'S TRIP · LIVE — own white band so sections alternate (zebra) */}
      {upcoming && (
        <section className="bg-surface border-y border-line">
          <div className="mx-auto max-w-page px-6 py-10">
            <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Your next trip · live</h2><span className="text-[11px] text-ink-faint">Auto-pulled from itinerary</span></div>
            <div className="rounded-2xl border border-line bg-surface-soft p-5">
              <div className="flex flex-wrap items-center gap-6">
                <div><Pill tone="green" className="mb-2">Confirmed</Pill><div className="text-[11px] text-ink-faint">{upcoming.flight_no} · {upcoming.flight?.aircraft || "A320"}</div><div className="flex items-start gap-3 mt-1"><div><div className="text-[22px] font-bold leading-none v2-num">{upcoming.flight?.dep}</div><div className="text-[11px] text-ink-faint mt-1">{upcoming.flight?.origin}{upcoming.flight?.terminal ? ` · ${upcoming.flight.terminal}` : ""}</div></div><Icon name="arrow" size={16} className="text-ink-faint shrink-0 mt-1.5" /><div><div className="text-[22px] font-bold leading-none v2-num">{upcoming.flight?.arr}</div><div className="text-[11px] text-ink-faint mt-1">{upcoming.flight?.dest}</div></div></div><div className="text-[11px] text-ink-muted mt-1">Seat <span className="font-bold text-ink">{upcoming.seat || "—"}</span> · Hand bag · Carbon offset on</div></div>
                <div className="flex-1 min-w-[240px]">
                  {(() => {
                    const dep = upcoming.flight?.dep || "", arr = upcoming.flight?.arr || "", dtg = upcoming.days_to_go;
                    const ciSub = upcoming.checked_in ? "Checked in" : (dtg > 1 ? `in ${dtg}d` : dtg === 1 ? "Tomorrow" : dtg === 0 ? "Open today" : "Open");
                    const STEPS = [
                      { label: "Booked", sub: "Done" },
                      { label: "Seat picked", sub: upcoming.seat ? `Seat ${upcoming.seat}` : "Done" },
                      { label: "Check-in", sub: ciSub },
                      { label: "Board", sub: dep },
                      { label: "Arrive", sub: arr },
                    ];
                    const cur = upcoming.checked_in ? 3 : 2;            // current step (advances once checked in)
                    const n = STEPS.length;
                    return (
                      <div className="relative">
                        {/* single shared track behind the icon row — runs first→last icon centre */}
                        <div className="absolute top-[7px] left-[10%] right-[10%] h-0.5 bg-line-strong" />
                        <div className="absolute top-[7px] left-[10%] h-0.5 bg-tap-green" style={{ width: `${(cur / (n - 1)) * 80}%` }} />
                        <div className="flex items-start">
                          {STEPS.map((s, i) => (
                            <div key={s.label} className="flex-1 min-w-0 flex flex-col items-center text-center px-0.5">
                              <span className={cx("relative z-10 w-3.5 h-3.5 rounded-full border-2 shrink-0",
                                i < cur ? "bg-tap-green border-tap-green" : i === cur ? "bg-tap-green border-tap-green ring-2 ring-tap-green/30" : "bg-surface border-line-strong")} />
                              <span className={cx("text-[10px] mt-1.5 leading-tight", i === cur ? "text-tap-greenDeep font-semibold" : "text-ink-muted")}>{s.label}</span>
                              {s.sub ? <span className="text-[9px] text-ink-faint leading-tight mt-0.5 v2-num">{s.sub}</span> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="min-w-[200px]"><div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Next action</div><Btn variant="primary" className="w-full" onClick={() => go("checkin")}>Check in early →</Btn><Btn variant="soft" className="w-full mt-2" onClick={() => go("checkin")}>Add mobile pass to Wallet</Btn></div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* WORTH YOUR WHILE — grey page band */}
      {anc.length > 0 && (
        <div className="mx-auto max-w-page px-6 py-10">
          <section>
            <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Worth your while{upcoming ? ` · for ${upcoming.flight?.dep || "your trip"}` : ""}</h2><span className="text-[11px] text-ink-faint">Ranked for {u.tier} commuters</span></div>
            <div className="grid md:grid-cols-3 gap-4">
              {anc.slice(0, 3).map((a, i) => {
                const s = ((a.code || "") + " " + (a.name || "")).toLowerCase();
                const ancImg = /upgrad|cabin|business/.test(s) ? "business-upgrade.jpg" : /secur|priorit|fast/.test(s) ? "fast-track-security.jpg" : /chang|flex/.test(s) ? "flexible-change.jpg" : /seat/.test(s) ? "business-upgrade.jpg" : null;   // #14/#7 — approved asset photo; seat reuses the cabin-seat shot
                const ancIcon = /seat/.test(s) ? "seat" : /bag|lugg/.test(s) ? "bag" : /meal|food|veg|kid/.test(s) ? "leaf" : /loung/.test(s) ? "star" : /wifi|internet/.test(s) ? "bolt" : /upgrad|cabin|business/.test(s) ? "plane" : /insur|secur|protect/.test(s) ? "shield" : "spark";
                return (
                  <Card key={a.code || i} className="overflow-hidden flex" style={{ borderRadius: "16px" }}>
                    <div className="w-[92px] shrink-0 self-stretch flex items-center justify-center overflow-hidden" style={{ background: "linear-gradient(135deg, #eef5e8, #dbead0)" }}>
                      {ancImg ? <Img seed={"anc-" + (a.code || i)} src={ASSET + ancImg} className="w-full h-full" /> : <div className="w-full h-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #dcecca, #b7d69a)" }}><span className="w-11 h-11 rounded-2xl bg-white/85 inline-flex items-center justify-center text-tap-greenDeep shadow-sm"><Icon name={ancIcon} size={26} /></span></div>}
                    </div>
                    <div className="p-3.5 flex flex-col flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.recommended
                          ? <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(241,245,236,1)", color: "rgba(46,122,14,1)" }}><span className="w-1.5 h-1.5 rounded-full bg-tap-green inline-block" /> Recommended</span>
                          : <Pill tone="slate">{i === 1 ? "Cash + miles" : "Popular · " + u.tier}</Pill>}
                      </div>
                      <div className="text-[14px] font-bold mt-1.5 truncate">{a.name}</div>
                      <div className="text-[11px] text-ink-muted mt-0.5 flex-1">{a.reason || a.desc || "Add before you fly."}</div>
                      <div className="flex items-center justify-between mt-2.5 gap-2"><div className="text-[13px] font-bold v2-num shrink-0">{EUR(a.price)} <span className="text-[11px] font-medium text-ink-faint">or {miles(Math.round(a.price / MILES_RATE))} mi</span></div><Btn size="sm" variant={i === 1 ? "outline" : "primary"} className="shrink-0" onClick={() => go("extras", { add: a.code, addName: a.name, addPrice: a.price })}>{i === 1 ? "Review" : "Add"}</Btn></div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* QUICK ACTIONS — own white band so the section alternates (zebra) from the grey page */}
      <section className="bg-surface border-y border-line">
        <div className="mx-auto max-w-page px-6 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[["cart", "Manage booking", "PNR or last name", "manage"], ["check", "Online check-in", "Opens 22h before", "checkin"], ["clock", "Flight status", "Track any TP", "manage"], ["bag", "Add bag", "Cheaper before airport", "extras"], ["plane", "Change flight", u.tier + " · no fee", "rebook"], ["star", "Help center", "Chat or call", "ai"]].map(([ic, t, s, r]) => (
              <button key={t} onClick={() => go(r)} className="text-left rounded-[14px] p-4 transition-colors hover:brightness-95" style={{ background: "rgba(242,255,219,1)", border: "1px solid rgba(199,242,31,1)" }}><span className="text-tap-greenDeep"><Icon name={ic} size={16} /></span><div className="text-[13px] font-bold mt-2">{t}</div><div className="text-[11px] text-ink-muted">{s}</div></button>
            ))}
          </div>
        </div>
      </section>

      {/* DESTINATIONS — back on the grey page background */}
      <div className="mx-auto max-w-page px-6 py-10">
        <DestGrid destinations={shared.destinations} go={go} />
      </div>
    </div>
  );
}

/* derive commute templates from real pattern + history */
function buildTemplates(profile, cityOf) {
  const pat = profile.pattern || {}, hist = profile.history || [], seat = (profile.prefs?.seat || "").split(" ")[0];
  const out = [];
  if (pat.usualOutNo) out.push({ label: "Mon · early", route: `${pat.origin} → ${pat.dest}`, time: pat.usualDep || "", detail: `${pat.usualOutNo} · Hand bag · seat ${seat} · default card`, used: pat.matching || pat.last || 1 });
  if (pat.usualBackNo) out.push({ label: "Thu · return", route: `${pat.dest} → ${pat.origin}`, time: pat.usualBackDep || "", detail: `${pat.usualBackNo} · Evening · ${profile.prefs?.bag || "window seat"} · Fast Track`, used: hist.filter(h => h.flight_no === pat.usualBackNo).length || 1 });
  const counts = {}; hist.forEach(h => { if (h.route) counts[h.route] = (counts[h.route] || 0) + 1; });
  const third = Object.entries(counts).sort((a, b) => b[1] - a[1]).find(([r]) => r !== pat.topRoute);
  if (third) {
    const deps = hist.filter(h => h.route === third[0]).map(h => h.dep_time).filter(Boolean).sort();
    const sameDayTime = deps.length >= 2 ? `${deps[0]} / ${deps[deps.length - 1]}` : (deps[0] || "");
    out.push({ label: "Same-day", route: third[0].replace("→", " ↔ "), time: sameDayTime, detail: `Out & back · flex fare`, used: third[1] });
  }
  out.push({ label: "Weekly shuttle", route: `${pat.origin || "OPO"} ↔ ${pat.dest || "LIS"}`, time: "", detail: "Auto-rebook each week · pause anytime", shuttle: true });
  return out.slice(0, 4);
}

function timeAgo(iso) {
  const d = new Date((iso || "").replace(" ", "T")); if (isNaN(d)) return "recently";
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return "just now"; if (m < 60) return m + "m ago"; const h = Math.round(m / 60); if (h < 24) return h + "h ago"; return Math.round(h / 24) + "d ago";
}

/* ─────────────────────────── Placeholder + ROUTES (program map) ─────────────────────────── */
export function Placeholder({ title, phase, plan, reuses, go }) {
  return (
    <Page>
      <Card className="p-8 v2-in">
        <Pill tone="slate" className="mb-3">Phase {phase} · on the build queue</Pill>
        <h1 className="text-[24px] font-bold">{title}</h1>
        {plan && <p className="text-[13px] text-ink-muted mt-2 max-w-xl">{plan}</p>}
        {reuses && <div className="mt-4 text-[11px] text-ink-faint">Reuses live endpoints: <span className="font-mono text-ink-muted">{reuses}</span></div>}
        <div className="mt-6"><Btn variant="outline" onClick={() => go("home")}>← Back to Home</Btn></div>
      </Card>
    </Page>
  );
}

export const ROUTES = {
  home: { title: "Home", comp: Home },
  homepage: { title: "Homepage", comp: Homepage },
  results: { title: "Search results", comp: Results },
  cart: { title: "View & customize cart", comp: Cart },
  passenger: { title: "Passenger details", comp: Passenger },
  payment: { title: "Payment", comp: Payment },
  confirmation: { title: "Booking confirmed", comp: Confirmation },
  basket: { title: "My trip basket", comp: Basket },
  manage: { title: "Manage my booking", comp: ManageBooking },
  upgrade: { title: "Upgrade cabin", comp: CabinUpgrade },
  seatchange: { title: "Change seat", comp: SeatChange },
  rebook: { title: "Rebook", comp: Rebook },
  checkin: { title: "Online check-in", comp: CheckInIndirect },
  addextras: { title: "Add extras", comp: AddExtras },
  refund: { title: "Cancel & refund", comp: Refund },
  split: { title: "Change / split travellers", comp: SplitBooking },
  retrieve: { title: "Retrieve booking", comp: Retrieve },
  express: { title: "Express checkout", comp: ExpressCheckout },
  hold: { title: "Hold My Fare", phase: 2, plan: "Free 48h fare hold for tier members (A8).", reuses: "/api/fare-lock, /api/hold" },
  disruption: { title: "Disruption / IROPS", comp: DisruptionCenter },
  stopover: { title: "Portugal Stopover", comp: StopoverBuilder },
  extras: { title: "Trip Extras", comp: AddExtras },
  miles: { title: "TAP Miles & Go", comp: MilesShop },
  wishlist: { title: "Wishlist", phase: 3, plan: "Saved routes & destinations.", reuses: "(new)" },
  ai: { title: "TAP AI · Travel concierge", comp: AIConcierge },
  console: { title: "Demo Console", comp: DemoConsole },
  admin: { title: "Demo Console", comp: DemoConsole },
};
