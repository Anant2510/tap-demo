// FlyTAP v2 — screens. Homepage (logged-out) + the personalized Home (returning
// user), built to the approved Figma and wired to the live backend. Remaining
// screens are scaffolded as a navigable map of the full program.
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, tierProgress, MILES_RATE } from "./lib.js";
import { Btn, Card, Pill, Eyebrow, TierBadge, Field, Input, Icon, Divider, Img, imageFor, cx } from "./ui.jsx";
import { Page } from "./shell.jsx";
import { Results } from "./results.jsx";
import { Cart, Passenger, Payment, Confirmation, ExpressCheckout } from "./checkout.jsx";
import { AIConcierge } from "./ai.jsx";
import { ManageBooking, CabinUpgrade, SeatChange, Rebook, CheckInIndirect, AddExtras, Refund } from "./mmb.jsx";
import { DemoConsole } from "./demo.jsx";

const TRIP_TABS = ["Flights", "Flights + Hotel", "Hotels", "Experiences", "Cabs & Transfers", "Flight Status"];

/* deterministic gradient "photo" header per city/route (real imagery can be added via AEM) */
const GRADS = [["#2e7d33", "#9efd38"], ["#1a1f29", "#46a41a"], ["#0a3d2e", "#c7f21f"], ["#163a4a", "#5ec6c0"], ["#3a2a1f", "#e8a23a"]];
function gradFor(seed) { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const g = GRADS[h % GRADS.length]; return { background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }; }

/* ─────────────────────────── shared: search widget ─────────────────────────── */
function SearchWidget({ airports = [], onSearch, defaults = {} }) {
  const [tab, setTab] = useState("Flights");
  const [type, setType] = useState("round");
  const [from, setFrom] = useState(defaults.origin || "OPO");
  const [to, setTo] = useState(defaults.dest || "");
  const [date, setDate] = useState(defaults.date || "");
  const [ret, setRet] = useState(defaults.ret || "");
  const [pax, setPax] = useState(1);
  const [cabin, setCabin] = useState("Economy");
  const [stopover, setStopover] = useState(false);
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex gap-1 overflow-x-auto v2-track -mx-1 px-1 pb-3">
        {TRIP_TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={cx("shrink-0 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors", tab === t ? "bg-surface-dark text-white" : "text-ink-muted hover:bg-surface-mute")}>{t}</button>
        ))}
      </div>
      <div className="flex gap-4 text-[12px] font-semibold text-ink-muted mb-3">
        {[["round", "Round trip"], ["oneway", "One way"], ["multi", "Multi-city"]].map(([k, l]) => (
          <button key={k} onClick={() => setType(k)} className={cx("pb-1 border-b-2", type === k ? "border-tap-green text-ink" : "border-transparent")}>{l}</button>
        ))}
      </div>
      <div className="grid md:grid-cols-12 gap-3">
        <Field label="From" className="md:col-span-3"><Input list="ap" value={from} onChange={e => setFrom(e.target.value.toUpperCase())} placeholder="OPO" /></Field>
        <Field label="To" className="md:col-span-3"><Input list="ap" value={to} onChange={e => setTo(e.target.value.toUpperCase())} placeholder="Where to?" /></Field>
        <Field label="Depart" className="md:col-span-2"><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        {type === "round" && <Field label="Return" className="md:col-span-2"><Input type="date" value={ret} onChange={e => setRet(e.target.value)} /></Field>}
        <Field label="Travellers" className="md:col-span-2">
          <select value={pax} onChange={e => setPax(+e.target.value)} className="w-full bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px]">{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} {n === 1 ? "traveller" : "travellers"}</option>)}</select>
        </Field>
      </div>
      <datalist id="ap">{airports.map(a => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}</datalist>
      <div className="flex flex-wrap items-center gap-4 mt-4">
        <label className="flex items-center gap-2 text-[12px] font-medium text-ink-muted"><input type="checkbox" checked={stopover} onChange={e => setStopover(e.target.checked)} className="accent-[#46a41a]" /> Add Portugal Stopover <span className="text-ink-faint">· free, up to 10 days</span></label>
        <Btn size="lg" className="ml-auto" onClick={() => onSearch({ origin: from, dest: to, date, ret, pax, cabin, type, stopover })}><Icon name="search" /> Search flights</Btn>
      </div>
    </Card>
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
function HeroSearch({ u, pat, cityOf, airports, go }) {
  const retDefault = (() => { if (!pat.recommendedDate) return ""; const d = new Date(pat.recommendedDate); d.setDate(d.getDate() + 5); return d.toISOString().slice(0, 10); })();
  const [type, setType] = useState("round");
  const [from, setFrom] = useState(pat.origin || u.home_airport || "OPO");
  const [to, setTo] = useState(pat.dest || "LIS");
  const [date, setDate] = useState(pat.recommendedDate || "");
  const [ret, setRet] = useState(retDefault);
  const [pax, setPax] = useState(1);
  const [cabin, setCabin] = useState("Economy");
  const [payMiles, setPayMiles] = useState(false);
  const [leg2, setLeg2] = useState({ from: pat.dest || "LIS", to: "", date: "" });
  const swap = () => { setFrom(to); setTo(from); };
  const go2 = () => go("results", { origin: from, dest: to, date, ret: type === "oneway" ? "" : ret, type, pax, cabin, payMiles });
  const cell = "rounded-xl border border-line p-3";
  const lbl = "text-[9px] font-bold uppercase tracking-wide text-ink-faint";
  const bare = "w-full bg-transparent text-[15px] font-bold outline-none";

  return (
    <Card className="mt-5 p-4 sm:p-5">
      <div className="flex gap-4 overflow-x-auto v2-track text-[13px] font-semibold pb-3 border-b border-line">
        {TRIP_TABS.map((t, i) => <button key={t} className={cx("shrink-0 pb-2 -mb-3 border-b-2", i === 0 ? "border-tap-green text-ink" : "border-transparent text-ink-muted hover:text-ink")}>{t}</button>)}
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-4 text-[12px] font-semibold">
          {[["round", "Round trip"], ["oneway", "One way"], ["multi", "Multi-city"]].map(([k, l]) => (
            <button key={k} onClick={() => setType(k)} className={cx("pb-0.5 border-b-2", type === k ? "border-tap-green text-ink" : "border-transparent text-ink-muted")}>{l}</button>
          ))}
        </div>
        <button onClick={() => setPayMiles(v => !v)} className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted">Pay with Miles <Icon name="spark" size={13} className={payMiles ? "text-tap-green" : "text-ink-faint"} /><span className={cx("w-9 h-5 rounded-full relative transition-colors", payMiles ? "bg-tap-green" : "bg-surface-mute")}><span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", payMiles ? "right-0.5" : "left-0.5")} /></span></button>
      </div>

      <div className="grid md:grid-cols-12 gap-3 mt-3">
        <div className={cx(cell, "md:col-span-3 relative")}>
          <div className={lbl}>Frequent route · editable</div>
          <div className="flex items-center gap-2 mt-1"><select value={from} onChange={e => setFrom(e.target.value)} className={cx(bare, "appearance-none cursor-pointer")}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select><button onClick={swap} className="text-tap-green shrink-0" title="Swap"><Icon name="arrow" size={14} /></button><select value={to} onChange={e => setTo(e.target.value)} className={cx(bare, "appearance-none cursor-pointer text-right")}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select></div>
          <div className="text-[10px] text-ink-faint mt-0.5">{cityOf(from)} → {cityOf(to)}</div>
        </div>
        <div className={cx(cell, type === "oneway" ? "md:col-span-3" : "md:col-span-3")}>
          <div className={lbl}>{type === "oneway" ? "Depart" : "Depart · Return"}</div>
          <div className="flex items-center gap-2 mt-1"><input type="date" value={date} onChange={e => setDate(e.target.value)} className={cx(bare, "text-[13px]")} />{type !== "oneway" && <input type="date" value={ret} onChange={e => setRet(e.target.value)} className={cx(bare, "text-[13px]")} />}</div>
          <div className="text-[10px] text-ink-faint mt-0.5">± 3 days flexibility on</div>
        </div>
        <div className={cx(cell, "md:col-span-2")}><div className={lbl}>Passenger</div><select value={pax} onChange={e => setPax(+e.target.value)} className={cx(bare, "mt-1")}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} Adult{n > 1 ? "s" : ""}</option>)}</select><div className="text-[10px] text-ink-faint mt-0.5">{u.first_name} · saved</div></div>
        <div className={cx(cell, "md:col-span-2")}><div className={lbl}>Cabin</div><select value={cabin} onChange={e => setCabin(e.target.value)} className={cx(bare, "mt-1")}>{["Economy", "Premium", "Business"].map(c => <option key={c}>{c}</option>)}</select><div className="text-[10px] text-ink-faint mt-0.5">Preferred</div></div>
        <div className="md:col-span-2 flex"><Btn size="lg" className="w-full h-full" onClick={go2}>Search flight</Btn></div>
      </div>
      {type === "multi" && (
        <div className="grid md:grid-cols-12 gap-3 mt-3">
          <div className={cx(cell, "md:col-span-3")}><div className={lbl}>Flight 2 · from</div><select value={leg2.from} onChange={e => setLeg2({ ...leg2, from: e.target.value })} className={cx(bare, "mt-1 appearance-none cursor-pointer")}>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select></div>
          <div className={cx(cell, "md:col-span-3")}><div className={lbl}>Flight 2 · to</div><select value={leg2.to} onChange={e => setLeg2({ ...leg2, to: e.target.value })} className={cx(bare, "mt-1 appearance-none cursor-pointer")}><option value="">Where to?</option>{airports.map(a => <option key={a.code} value={a.code}>{a.code} · {a.city}</option>)}</select></div>
          <div className={cx(cell, "md:col-span-3")}><div className={lbl}>Flight 2 · date</div><input type="date" value={leg2.date} onChange={e => setLeg2({ ...leg2, date: e.target.value })} className={cx(bare, "mt-1 text-[13px]")} /></div>
          <div className="md:col-span-3 flex items-center text-[11px] text-ink-faint">Add up to 5 flights · we'll price the full itinerary.</div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 mt-4 text-[12px] text-ink-muted">
        {[["Traveler details saved", true], [`Default ${u.card_brand || "card"} ready`, true], [`${u.tier} benefits active`, true], ["Use miles available", (u.miles || 0) > 0]].map(([t, ok], i) => (
          <span key={i} className="flex items-center gap-1.5"><Icon name="check" size={13} className={ok ? "text-tap-green" : "text-ink-faint"} /> {t}</span>
        ))}
      </div>
    </Card>
  );
}

export function Home({ shared, go }) {
  const { profile, journey, airports = [] } = shared;
  const [rec, setRec] = useState(null);
  const [anc, setAnc] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [aiOn, setAiOn] = useState(false);          // TAP AI is OFF by default
  useEffect(() => {
    api.get("/recommendation").then(setRec).catch(() => {});
    api.get("/ancillaries").then(a => setAnc((a || []).sort((x, y) => (y.recommended ? 1 : 0) - (x.recommended ? 1 : 0)))).catch(() => {});
    api.get("/bookings").then(setBookings).catch(() => {});
  }, []);
  if (!profile) return <Page><div className="py-20 text-center text-ink-faint">Loading your journey…</div></Page>;

  const u = profile.user, pat = profile.pattern || {}, prog = tierProgress(u.tier, u.miles);
  const cityOf = (c) => airports.find(a => a.code === c)?.city || c;
  const resumable = journey && journey.stage && journey.stage !== "search" && journey.dest;
  const upcoming = bookings.filter(b => b.status === "confirmed" && b.days_to_go >= 0).sort((a, b) => a.days_to_go - b.days_to_go)[0] || bookings.find(b => b.status === "confirmed");
  const search = () => go("results", { origin: pat.origin || u.home_airport, dest: pat.dest || "LIS", date: pat.recommendedDate, type: "round", pax: 1, cabin: "Economy" });

  return (
    <div className="bg-surface-soft">
      {/* HERO: full-bleed video background, white content panel */}
      <div className="relative overflow-hidden bg-surface-navy">
        <video className="absolute inset-0 w-full h-full object-cover" autoPlay loop muted playsInline preload="auto" ref={v => { if (v) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } }}>
          <source src="/v2/hero.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/15" />
        <div className="relative mx-auto max-w-page px-6 pt-12 pb-14">
          <div className="rounded-3xl bg-surface shadow-pop p-6 sm:p-8">
            <div className="flex items-start justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-tap-green"><span className="w-1.5 h-1.5 rounded-full bg-tap-green inline-block" /> Personalized for you</span>
              <button onClick={() => setAiOn(v => !v)} className="flex items-center gap-2 text-ink-muted text-[12px] font-semibold">TAP AI <span className={cx("w-9 h-5 rounded-full relative transition-colors", aiOn ? "bg-tap-green" : "bg-ink/15")}><span className={cx("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow", aiOn ? "right-0.5" : "left-0.5")} /></span></button>
            </div>
            <div className="text-ink-muted text-[14px] mt-3">Bom dia, {u.first_name}.</div>
            <h1 className="text-[34px] font-black text-ink tracking-tight">{aiOn ? "Ask me anything about your trip." : "Ready for your usual trip?"}</h1>
            {aiOn
              ? <AIConcierge shared={shared} go={go} embedded onToggleOff={() => setAiOn(false)} />
              : <HeroSearch u={u} pat={pat} cityOf={cityOf} airports={airports} go={go} />}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-page px-6 py-8 space-y-12">
        {/* COMMUTE TEMPLATES */}
        <section>
          <div className="flex items-end justify-between mb-4">
            <div><h2 className="text-[22px] font-bold">Your commute templates</h2><div className="flex gap-4 text-[12px] font-semibold mt-2"><span className="text-ink border-b-2 border-ink pb-0.5">Templates</span><span className="text-ink-faint">Recent searches</span><span className="text-ink-faint">Favourites</span></div></div>
            <div className="flex gap-2"><button className="w-9 h-9 rounded-full border border-line flex items-center justify-center text-ink-muted">←</button><button className="w-9 h-9 rounded-full bg-surface-dark text-white flex items-center justify-center">→</button></div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {buildTemplates(profile, cityOf).map((t, i) => (
              <Card key={i} className="overflow-hidden">
                <div className="h-24 relative overflow-hidden"><Img seed={"route-" + t.route} src={imageFor(t.route)} className="absolute inset-0 w-full h-full" /><span className="absolute inset-0 bg-gradient-to-t from-black/55 to-black/10" /><span className="absolute bottom-2 left-3 text-white text-[10px] font-bold uppercase tracking-wide">{t.label}</span><span className="absolute top-2 right-3 text-white/90 text-[10px]">{t.used ? `Used ${t.used}×` : t.shuttle ? "Recurring" : ""}</span></div>
                <div className="p-3.5">
                  <div className="flex items-center justify-between"><div className="text-[15px] font-bold">{t.route}</div><div className="text-[12px] font-semibold text-ink-muted v2-num">{t.time}</div></div>
                  <div className="text-[11px] text-ink-muted mt-1 min-h-[28px]">{t.detail}</div>
                  <Btn size="sm" variant={t.shuttle ? "outline" : "lime"} className="mt-2 w-full" onClick={() => t.shuttle ? null : go("express")}>{t.shuttle ? "Manage shuttle" : "One-tap book"}</Btn>
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
      <section className="bg-surface-dark text-white" style={{ background: "radial-gradient(120% 100% at 50% 0%, #16331f, #0a0a0a 70%)" }}>
        <div className="mx-auto max-w-content px-6 py-14 text-center">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase px-3 py-1 rounded-full bg-gradient-to-br from-[#E8C75A] to-[#C9A227] text-ink"><Icon name="spark" size={11} /> Your Miles&Go journey · {u.tier} member</span>
          <h2 className="text-[44px] font-black leading-tight mt-5">{prog.next ? <>You're {miles(prog.toGo)} miles<br />from {prog.next}, {u.first_name}.</> : <>You're at the top tier, {u.first_name}.</>}</h2>
          <p className="text-white/60 text-[14px] mt-3 max-w-2xl mx-auto">One Lisbon stopover + one European return gets you there — and unlocks free upgrades and lounge access for two.</p>
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/40 p-5 text-left">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div><div className="text-[10px] uppercase tracking-wide text-white/50">Current balance</div><div className="text-[34px] font-black v2-num">{miles(u.miles)} <span className="text-[14px] font-medium text-white/50">tap.miles</span></div><div className="text-[11px] mt-1"><TierBadge tier={u.tier} /> {prog.next && <span className="text-white/50 ml-1">You · {miles(prog.toGo)} mi to {prog.next}</span>}</div></div>
              {prog.next && <div className="rounded-xl bg-black/40 border border-white/10 p-4 min-w-[220px] text-center"><div className="text-[40px] font-black text-lime leading-none v2-num">{prog.pct}%</div><div className="text-[10px] uppercase tracking-wide text-white/50 mt-1">Progress to {prog.next}</div><div className="h-2 rounded-full bg-white/15 mt-2 overflow-hidden"><div className="h-full rounded-full" style={{ width: prog.pct + "%", background: "linear-gradient(90deg,#9efd38,#8b5cf6)" }} /></div></div>}
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-5">
              {[["🏠", "Because you're " + u.tier, "Use miles to discount your Lisbon hotel", "Apply 8,000 mi to any 3-night stay · save up to €80 instantly.", "8,000 mi", "Apply"],
                ["✈", "Limited · next trip", "Upgrade " + cityOf(pat.origin || "LIS") + "–" + cityOf(pat.dest || "OPO") + " to Business with miles", "20% mileage discount when upgrading on your existing booking.", "42,000 mi", "Upgrade"],
                ["⊕", "Partner offer · Nov", "Earn 3× miles at Memmo Príncipe Real", "Triple miles when booking your favourite hotel through voa stay.", "3× MI", "Activate"]].map((o, i) => (
                <div key={i} className="rounded-xl bg-black/30 border border-white/10 p-4 flex flex-col">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-tap-green flex items-center gap-1.5"><span>{o[0]}</span> + {o[1]}</div>
                  <div className="text-[14px] font-bold mt-2">{o[2]}</div>
                  <div className="text-[11px] text-white/50 mt-1 flex-1">{o[3]}</div>
                  <div className="flex items-center justify-between mt-3"><span className="text-[12px] font-bold v2-num">{o[4]}</span><Btn size="sm" variant="lime" onClick={() => go("miles")}>{o[5]} →</Btn></div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-[12px] text-tap-green mt-4 flex items-center justify-center gap-1.5"><Icon name="spark" size={12} /> Earn up to 4,832 voa.miles on your Lisbon stopover hotel and experiences this trip.</div>
        </div>
      </section>

      <div className="mx-auto max-w-page px-6 py-10 space-y-12">
        {/* PICK UP WHERE YOU LEFT OFF */}
        <section>
          <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Pick up where you left off</h2><span className="text-[11px] text-ink-faint">{journey?.updated_at ? "Updated " + timeAgo(journey.updated_at) : ""}</span></div>
          <div className="grid md:grid-cols-3 gap-4">
            {/* usual trip */}
            <Card className="overflow-hidden">
              <div className="h-28 relative overflow-hidden"><Img seed={"dest-" + (pat.dest || "LIS")} src={imageFor(pat.dest || "LIS", cityOf(pat.dest || "LIS"))} className="absolute inset-0 w-full h-full" /><Pill tone="lime" className="absolute top-3 left-3">Usual trip</Pill></div>
              <div className="p-4">
                <div className="font-bold text-[15px]">Book {cityOf(pat.origin || "OPO")} → {cityOf(pat.dest || "LIS")}</div>
                <div className="text-[12px] text-ink-muted mt-1">{pat.recommendedLabel} {pat.usualDep} · fare from {EUR(pat.usualPrice)} · hand bag only.</div>
                <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="slate">2 taps</Pill><Pill tone="slate">Default card</Pill><Pill tone="slate">{miles(u.miles)} mi avail.</Pill></div>
                <div className="flex items-center justify-between mt-3"><div><div className="text-[9px] uppercase tracking-wide text-ink-faint">from</div><div className="text-[18px] font-black v2-num">{EUR(rec?.package?.total || pat.usualPrice)}</div></div><Btn size="sm" onClick={() => go("express")}>Book Now →</Btn></div>
              </div>
            </Card>
            {/* resume */}
            <Card className="overflow-hidden">
              <div className="h-28 relative overflow-hidden"><Img seed={"resume-" + (journey?.dest || "OPO")} src={imageFor(journey?.dest || "OPO", cityOf(journey?.dest || "OPO"))} className="absolute inset-0 w-full h-full" /><span className="absolute inset-0 bg-black/15" /><Pill tone={resumable ? "green" : "slate"} className="absolute top-3 left-3"><Icon name="clock" size={10} /> {resumable ? "In-progress" : "No draft"}</Pill></div>
              <div className="p-4">
                {resumable ? <>
                  <div className="font-bold text-[15px]">Resume booking</div>
                  <div className="text-[12px] text-ink-muted mt-1">{journey.origin} → {journey.dest} · stopped at {journey.stage}.{journey.seat ? ` Seat ${journey.seat} held.` : ""}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="green">{["search", "results", "seat", "extras", "review"].indexOf(journey.stage) + 1} of 5 done</Pill><Pill tone="slate">€2 fare delta</Pill></div>
                  <Btn size="sm" variant="outline" className="mt-3 w-full" onClick={() => { api.post("/journey/resume", {}).catch(() => {}); go("cart"); }}>Continue →</Btn>
                </> : <>
                  <div className="font-bold text-[15px]">Nothing in progress</div>
                  <div className="text-[12px] text-ink-muted mt-1">Start a new search to begin a booking.</div>
                  <Btn size="sm" variant="outline" className="mt-3 w-full" onClick={search}>New search →</Btn>
                </>}
              </div>
            </Card>
            {/* tomorrow / boarding */}
            <Card className="overflow-hidden">
              <div className="h-28 relative overflow-hidden"><Img seed={"trip-" + (upcoming?.flight?.dest || "OPO")} src={imageFor(upcoming?.flight?.dest || "OPO", cityOf(upcoming?.flight?.dest || "OPO"))} className="absolute inset-0 w-full h-full" /><span className="absolute inset-0 bg-black/15" /><Pill tone="slate" className="absolute top-3 left-3"><Icon name="clock" size={10} /> {upcoming ? "Upcoming" : "No trips"}</Pill></div>
              <div className="p-4">
                {upcoming ? <>
                  <div className="font-bold text-[15px]">{upcoming.flight_no} · {upcoming.flight?.origin} → {upcoming.flight?.dest}</div>
                  <div className="text-[12px] text-ink-muted mt-1">Boarding {upcoming.flight?.dep} · seat {upcoming.seat || "—"}. {upcoming.days_to_go === 0 ? "Today." : upcoming.days_to_go === 1 ? "Tomorrow." : "On time."}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2"><Pill tone="slate">Check-in soon</Pill><Pill tone="slate">Mobile pass</Pill></div>
                  <Btn size="sm" variant="outline" className="mt-3 w-full" onClick={() => go("basket")}>Manage trip →</Btn>
                </> : <>
                  <div className="font-bold text-[15px]">No upcoming trips</div>
                  <div className="text-[12px] text-ink-muted mt-1">Book your usual to get going.</div>
                  <Btn size="sm" variant="outline" className="mt-3 w-full" onClick={() => go("express")}>Book usual →</Btn>
                </>}
              </div>
            </Card>
          </div>
        </section>

        {/* TOMORROW'S TRIP · LIVE */}
        {upcoming && (
          <section>
            <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Your next trip · live</h2><span className="text-[11px] text-ink-faint">Auto-pulled from itinerary</span></div>
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-6">
                <div><Pill tone="green" className="mb-2">Confirmed</Pill><div className="text-[11px] text-ink-faint">{upcoming.flight_no} · {upcoming.flight?.aircraft || "A320"}</div><div className="flex items-center gap-3 mt-1"><div><div className="text-[22px] font-bold v2-num">{upcoming.flight?.dep}</div><div className="text-[11px] text-ink-faint">{upcoming.flight?.origin}</div></div><Icon name="plane" size={16} className="text-tap-green" /><div><div className="text-[22px] font-bold v2-num">{upcoming.flight?.arr}</div><div className="text-[11px] text-ink-faint">{upcoming.flight?.dest}</div></div></div><div className="text-[11px] text-ink-muted mt-1">Seat {upcoming.seat || "—"} · Hand bag · Carbon offset on</div></div>
                <div className="flex-1 min-w-[260px]">
                  <div className="flex items-center justify-between">
                    {["Booked", "Seat picked", "Check-in", "Board", "Arrive"].map((s, i) => (
                      <div key={s} className="flex-1 flex flex-col items-center relative">
                        {i > 0 && <div className={cx("absolute right-1/2 top-1.5 h-0.5 w-full", i <= 2 ? "bg-tap-green" : "bg-line-strong")} />}
                        <span className={cx("relative w-3.5 h-3.5 rounded-full border-2", i <= 2 ? "bg-tap-green border-tap-green" : "bg-surface border-line-strong")} />
                        <span className="text-[10px] text-ink-muted mt-1.5">{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="min-w-[200px]"><div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Next action</div><Btn variant="primary" className="w-full" onClick={() => go("basket")}>Check in early →</Btn><Btn variant="lime" className="w-full mt-2" onClick={() => go("basket")}>Add mobile pass to Wallet</Btn></div>
              </div>
            </Card>
          </section>
        )}

        {/* WORTH YOUR WHILE */}
        {anc.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4"><h2 className="text-[22px] font-bold">Worth your while{upcoming ? ` · for ${upcoming.flight?.dep || "your trip"}` : ""}</h2><span className="text-[11px] text-ink-faint">Ranked for {u.tier} commuters</span></div>
            <div className="grid md:grid-cols-3 gap-4">
              {anc.slice(0, 3).map((a, i) => (
                <Card key={a.code || i} className="p-4 flex flex-col">
                  <div className="flex items-center justify-between"><Pill tone={a.recommended ? "lime" : "slate"}>{a.recommended ? "Recommended" : i === 1 ? "Cash + miles" : "Popular · " + u.tier}</Pill><span className="text-[10px] text-ink-faint">{a.reason ? "" : ""}</span></div>
                  <div className="text-[15px] font-bold mt-2">{a.name}</div>
                  <div className="text-[11px] text-ink-muted mt-1 flex-1">{a.reason || a.desc || "Add before you fly."}</div>
                  <div className="flex items-center justify-between mt-3"><div className="text-[13px] font-bold v2-num">{EUR(a.price)} <span className="text-[11px] font-medium text-ink-faint">or {miles(Math.round(a.price / MILES_RATE))} mi</span></div><Btn size="sm" variant={i === 1 ? "outline" : "primary"} onClick={() => go("cart")}>{i === 1 ? "Review" : "Add"}</Btn></div>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* QUICK ACTIONS */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[["cart", "Manage booking", "PNR or last name", "basket"], ["check", "Online check-in", "Opens 22h before", "basket"], ["clock", "Flight status", "Track any TP", "results"], ["bag", "Add bag", "Cheaper before airport", "cart"], ["plane", "Change flight", u.tier + " · no fee", "basket"], ["star", "Help center", "Chat or call", "ai"]].map(([ic, t, s, r]) => (
            <button key={t} onClick={() => go(r)} className="text-left rounded-xl border border-lime/40 bg-lime-tint/40 hover:bg-lime-tint p-3.5"><span className="text-tap-greenDeep"><Icon name={ic} size={16} /></span><div className="text-[13px] font-bold mt-2">{t}</div><div className="text-[11px] text-ink-muted">{s}</div></button>
          ))}
        </section>

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
  if (pat.usualBackNo) out.push({ label: "Thu · return", route: `${pat.dest} → ${pat.origin}`, time: "19:25", detail: `${pat.usualBackNo} · Evening · ${profile.prefs?.bag || "window seat"} · Fast Track`, used: hist.filter(h => h.flight_no === pat.usualBackNo).length || 1 });
  const counts = {}; hist.forEach(h => { if (h.route) counts[h.route] = (counts[h.route] || 0) + 1; });
  const third = Object.entries(counts).sort((a, b) => b[1] - a[1]).find(([r]) => r !== pat.topRoute);
  if (third) out.push({ label: "Same-day", route: third[0].replace("→", " ↔ "), time: "07:10 / 20:55", detail: `Out & back · flex fare`, used: third[1] });
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
  basket: { title: "Manage my booking", comp: ManageBooking },
  manage: { title: "Manage my booking", comp: ManageBooking },
  upgrade: { title: "Upgrade cabin", comp: CabinUpgrade },
  seatchange: { title: "Change seat", comp: SeatChange },
  rebook: { title: "Rebook", comp: Rebook },
  checkin: { title: "Online check-in", comp: CheckInIndirect },
  addextras: { title: "Add extras", comp: AddExtras },
  refund: { title: "Cancel & refund", comp: Refund },
  express: { title: "Express checkout", comp: ExpressCheckout },
  hold: { title: "Hold My Fare", phase: 2, plan: "Free 48h fare hold for tier members (A8).", reuses: "/api/fare-lock, /api/hold" },
  disruption: { title: "Disruption / IROPS", comp: Rebook },
  stopover: { title: "Portugal Stopover", phase: 3, plan: "Free Lisbon/Porto stopover builder.", reuses: "/api/search (new)" },
  extras: { title: "Trip Extras", comp: AddExtras },
  miles: { title: "TAP Miles & Go", phase: 3, plan: "Tier progress, miles redemption, partner earn.", reuses: "/api/profile, /api/recommendation" },
  wishlist: { title: "Wishlist", phase: 3, plan: "Saved routes & destinations.", reuses: "(new)" },
  ai: { title: "TAP AI · Travel concierge", comp: AIConcierge },
  console: { title: "Demo Console", comp: DemoConsole },
  admin: { title: "Demo Console", comp: DemoConsole },
};
