import React, { useState, useEffect, useRef, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Plane, Sparkles, Lock, ShoppingBag, CreditCard, Wallet, Ticket, CheckCircle2,
  AlertTriangle, RefreshCw, Luggage, Armchair, Coffee, Wifi, Car, ChevronRight,
  X, Send, Bell, QrCode, CalendarClock, Laptop, Zap, ShieldCheck, ArrowRight,
  Repeat, BadgeCheck, MessageCircle, Loader2, TimerReset, Database, Mail, Eye, RotateCcw,
  Search, MapPin, Globe, ArrowLeftRight, Calendar, Info
} from "lucide-react";

/* ── API client — every byte of personalization comes from the backend ── */
const api = {
  get: (p) => fetch(`/api${p}`).then((r) => r.json()),
  post: (p, body) => fetch(`/api${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then((r) => r.json()),
};
const EUR = (n) => `€${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2)}`;
const MILES_RATE = 0.003;
const AIRPORT_MAP = {};   // code → {city,country,region}, filled at load from /api/airports
const cityName = (code) => (AIRPORT_MAP[code] && AIRPORT_MAP[code].city) || code;

/* ── Theme / primitives ── */
const Fonts = () => (
  <style>{`
    :root{ --tap-green:#00A357; --tap-deep:#063A28; --tap-ink:#0E1F18; --tap-mist:#F2F6F3;
      --tap-line:#DCE7E0; --tap-red:#E2354B; --tap-gold:#C9A227; --tap-amber:#E8930C; }
    .font-display{font-family:'Archivo',sans-serif; font-stretch:85%;}
    body{font-family:'Inter',sans-serif;background:var(--tap-mist);}
    .ticket-edge{ mask:radial-gradient(circle 7px at 0 50%, transparent 98%, #000) left/14px 100% no-repeat,
      radial-gradient(circle 7px at 100% 50%, transparent 98%, #000) right/14px 100% no-repeat,
      linear-gradient(#000,#000) center/calc(100% - 26px) 100% no-repeat;
      -webkit-mask:radial-gradient(circle 7px at 0 50%, transparent 98%, #000) left/14px 100% no-repeat,
      radial-gradient(circle 7px at 100% 50%, transparent 98%, #000) right/14px 100% no-repeat,
      linear-gradient(#000,#000) center/calc(100% - 26px) 100% no-repeat;}
    @keyframes pulseDot{0%,100%{opacity:1}50%{opacity:.35}} .pulse-dot{animation:pulseDot 1.6s ease-in-out infinite}
    @keyframes slideUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}} .slide-up{animation:slideUp .35s ease both}
    @media (prefers-reduced-motion: reduce){ .slide-up,.pulse-dot{animation:none} }
    ::selection{background:#00A35733}
  `}</style>
);

const TapLogo = ({ light = false, size = "text-xl" }) => (
  <div className={`font-display font-black tracking-tight ${size}`}>
    <span style={{ color: "var(--tap-red)" }}>T</span>
    <span style={{ color: light ? "#fff" : "var(--tap-deep)" }}>A</span>
    <span style={{ color: "var(--tap-green)" }}>P</span>
    <span className={`ml-2 font-semibold text-xs tracking-widest uppercase ${light ? "text-white/70" : "text-gray-500"}`}>Air Portugal</span>
  </div>
);
const GoldBadge = () => (
  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide"
    style={{ background: "linear-gradient(120deg,#C9A227,#E8C75A)", color: "#3A2D04" }}><BadgeCheck size={12}/> GOLD</span>
);
const Chip = ({ children, tone = "green", className = "" }) => {
  const tones = { green:{background:"#E2F4EA",color:"#066B3C"}, amber:{background:"#FCF1DD",color:"#8A5A06"},
    red:{background:"#FBE4E7",color:"#A31226"}, ink:{background:"#E9EFEC",color:"#26483A"}, gold:{background:"#F7EFD6",color:"#7A6112"} };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${className}`} style={tones[tone]}>{children}</span>;
};
/* (i) explainer — hover/tap reveals WHY a personalization was shown */
const Why = ({ text, className = "" }) => {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <span className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} aria-label="Why am I seeing this?"
        className="inline-flex items-center justify-center w-4 h-4 rounded-full" style={{ color: "var(--tap-green)" }}>
        <Info size={13}/>
      </button>
      {open && (
        <span onClick={(e) => e.stopPropagation()}
          className="absolute z-50 bottom-full right-0 mb-1.5 w-60 p-2.5 rounded-lg text-[11px] font-medium leading-snug shadow-lg"
          style={{ background: "var(--tap-deep)", color: "#fff" }}>
          <span className="block font-bold mb-0.5" style={{ color: "#8FE3B8" }}>Why you're seeing this</span>
          {text}
        </span>
      )}
    </span>
  );
};
const Card = ({ children, className = "", style = {} }) => (
  <div className={`bg-white rounded-2xl border ${className}`} style={{ borderColor: "var(--tap-line)", ...style }}>{children}</div>
);
const PrimaryBtn = ({ children, onClick, className = "", disabled }) => (
  <button onClick={onClick} disabled={disabled}
    className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold text-white text-sm transition-transform active:scale-[.98] disabled:opacity-50 ${className}`}
    style={{ background: "var(--tap-green)" }}>{children}</button>
);
const GhostBtn = ({ children, onClick, className = "" }) => (
  <button onClick={onClick}
    className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm border transition-colors hover:bg-gray-50 ${className}`}
    style={{ borderColor: "var(--tap-line)", color: "var(--tap-deep)" }}>{children}</button>
);
const RouteRibbon = ({ from = "OPO", to = "LIS", dep, arr, small = false }) => (
  <div className={`flex items-center ${small ? "gap-2" : "gap-3"}`}>
    <div className="text-right">
      <div className={`font-display font-extrabold ${small ? "text-base" : "text-2xl"}`} style={{ color: "var(--tap-ink)" }}>{from}</div>
      {dep && <div className="text-xs text-gray-500 font-medium">{dep}</div>}
    </div>
    <div className="flex-1 flex items-center min-w-[60px]">
      <div className="h-px flex-1" style={{ background: "var(--tap-line)" }}/>
      <Plane size={small ? 13 : 16} className="mx-1.5" style={{ color: "var(--tap-green)" }}/>
      <div className="h-px flex-1" style={{ background: "var(--tap-line)" }}/>
    </div>
    <div>
      <div className={`font-display font-extrabold ${small ? "text-base" : "text-2xl"}`} style={{ color: "var(--tap-ink)" }}>{to}</div>
      {arr && <div className="text-xs text-gray-500 font-medium">{arr}</div>}
    </div>
  </div>
);
const FakeQR = ({ seed = 7, size = 120 }) => {
  const cells = useMemo(() => { const out = []; let v = seed;
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) { v = (v * 48271) % 2147483647;
      const finder = (x < 6 && y < 6) || (x > 14 && y < 6) || (x < 6 && y > 14);
      if (finder ? (x % 5 !== 2 || y % 5 !== 2) : v % 7 < 3) out.push([x, y]); } return out; }, [seed]);
  return <svg width={size} height={size} viewBox="0 0 21 21" className="rounded-md bg-white p-0.5">
    {cells.map(([x, y], i) => <rect key={i} x={x} y={y} width="1" height="1" fill="#0E1F18"/>)}</svg>;
};
const AncIcon = ({ k, size = 18 }) => {
  const map = { seat: Armchair, bag: Luggage, meal: Coffee, wifi: Wifi, car: Car, lounge: Sparkles };
  const I = map[k] || Sparkles; return <I size={size} style={{ color: "var(--tap-green)" }}/>;
};

/* Toast — used to surface backend side-effects (emails, DB writes) */
function Toasts({ list, dismiss }) {
  return (
    <div className="fixed bottom-5 left-5 z-[60] space-y-2 max-w-sm">
      {list.map((t) => (
        <div key={t.id} className="bg-white border rounded-xl shadow-lg p-3 flex items-start gap-3 slide-up" style={{ borderColor: "var(--tap-line)" }}>
          <Mail size={16} className="shrink-0 mt-0.5" style={{ color: "var(--tap-green)" }}/>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold" style={{ color: "var(--tap-ink)" }}>{t.title}</div>
            <div className="text-[11px] text-gray-500 truncate">{t.sub}</div>
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} className="text-gray-400"/></button>
        </div>
      ))}
    </div>
  );
}

/* ── LOGIN ── */
function Login({ profile, onLogin }) {
  const [busy, setBusy] = useState(false);
  const u = profile?.user;
  return (
    <div className="min-h-screen flex" style={{ background: "var(--tap-mist)" }}>
      <div className="hidden lg:flex flex-col justify-between w-[44%] p-12 text-white relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, var(--tap-deep) 0%, #0A5A3C 70%, var(--tap-green) 130%)" }}>
        <TapLogo light/>
        <div>
          <div className="text-xs font-bold tracking-[0.25em] uppercase text-white/60 mb-4">TAP Miles&Go · Digital channel</div>
          <h1 className="font-display font-black text-5xl leading-[1.05] mb-5">Your airline already knows the way you fly.</h1>
          <p className="text-white/75 max-w-md leading-relaxed">One sign-in. Your routes, your seat, your payment, your boarding pass — served live from your customer record.</p>
        </div>
        <div className="flex items-center gap-6 text-white/60 text-xs font-medium">
          <span className="flex items-center gap-1.5"><ShieldCheck size={14}/> Secure session</span>
          <span className="flex items-center gap-1.5"><Database size={14}/> Live customer DB</span>
        </div>
        <Plane className="absolute -right-10 -bottom-10 opacity-10" size={280}/>
      </div>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md slide-up">
          <div className="lg:hidden mb-8"><TapLogo/></div>
          <h2 className="font-display font-extrabold text-3xl mb-1" style={{ color: "var(--tap-ink)" }}>Welcome back</h2>
          <p className="text-sm text-gray-500 mb-8">Sign in to TAP Miles&Go</p>
          <Card className="p-5 mb-4 hover:shadow-md transition-shadow">
            <button onClick={() => { setBusy(true); setTimeout(onLogin, 700); }} className="w-full flex items-center gap-4 text-left" disabled={!u}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center font-display font-extrabold text-white text-lg shrink-0" style={{ background: "var(--tap-deep)" }}>DF</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm flex items-center gap-2" style={{ color: "var(--tap-ink)" }}>{u ? u.full_name : "Loading profile…"} {u && <GoldBadge/>}</div>
                <div className="text-xs text-gray-500 mt-0.5">{u?.email}</div>
                <div className="text-xs text-gray-400 mt-0.5">{u && `Member ${u.member_no} · ${u.miles.toLocaleString()} miles`}</div>
              </div>
              {busy || !u ? <Loader2 className="animate-spin" size={18} style={{ color: "var(--tap-green)" }}/> : <ChevronRight size={18} className="text-gray-400"/>}
            </button>
          </Card>
          <div className="space-y-3 opacity-50 pointer-events-none">
            <input className="w-full px-4 py-3 rounded-xl border text-sm" style={{ borderColor: "var(--tap-line)" }} placeholder="Email or member number"/>
            <input className="w-full px-4 py-3 rounded-xl border text-sm" style={{ borderColor: "var(--tap-line)" }} placeholder="Password" type="password"/>
          </div>
          <p className="text-[11px] text-gray-400 mt-6 text-center">Profile loaded live from the customer database · tap to continue as Daniel</p>
        </div>
      </div>
    </div>
  );
}

/* ── HOME — Search & Inspiration ── */
function Home({ profile, destinations, go, openAssistant, toast, bookDestination, bookUsual }) {
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [aiMode, setAiMode] = useState(null);
  const [sendingOffer, setSendingOffer] = useState(false);
  const u = profile.user, pat = profile.pattern, ss = profile.syncedSearch;

  const runPlanner = async (text) => {
    const q = (text || prompt || "").trim();
    if (!q || planning) return;
    setPlanning(true); setPlan(null);
    const r = await api.post("/ai/plan", { prompt: q });
    setPlan(r.plan); setAiMode(r.ai); setPlanning(false);
  };

  const sendOffer = async () => {
    setSendingOffer(true);
    const r = await api.post("/offers/send");
    setSendingOffer(false);
    toast("Personalized offer emailed", `"${r.offer.subject}" → ${r.email.to} · ${r.email.status}`);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 pb-20">
      <div className="pt-8 pb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-bold tracking-[0.2em] uppercase mb-1" style={{ color: "var(--tap-green)" }}>Bom dia</div>
          <h1 className="font-display font-black text-4xl" style={{ color: "var(--tap-ink)" }}>{u.first_name}, ready for next week?</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            <GoldBadge/> <span className="font-semibold" style={{ color: "var(--tap-deep)" }}>{u.miles.toLocaleString()} miles</span>
            <span>·</span><span>{profile.vouchers.length} voucher{profile.vouchers.length === 1 ? "" : "s"} {profile.vouchers[0] && `(${EUR(profile.vouchers[0].amount)})`}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <PrimaryBtn onClick={() => go("search")} className="!py-2.5"><Search size={15}/> Search flights</PrimaryBtn>
          <GhostBtn onClick={sendOffer}>{sendingOffer ? <Loader2 className="animate-spin" size={15}/> : <Mail size={15}/>} Email me this week's offer</GhostBtn>
          <GhostBtn onClick={() => go("manage")}><CalendarClock size={16}/> My bookings</GhostBtn>
        </div>
      </div>

      {ss && (
        <Card className="p-4 mb-5 flex flex-wrap items-center gap-4 slide-up" style={{ background: "#FBFDFC" }}>
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
            <Laptop size={15} style={{ color: "var(--tap-green)" }}/>
            <span>Continue from your {ss.device}</span>
            <span className="text-gray-300">·</span><span className="font-normal">{ss.created_at}</span>
            <Why text={`You started this search on your ${ss.device} (synced_searches table). We carry unfinished searches across your devices so you can pick up where you left off.`}/>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[220px]">
            <RouteRibbon small from={ss.origin} to={ss.dest}/>
            <Chip tone="ink">{ss.travel_date} · {ss.pax} adult</Chip>
          </div>
          <PrimaryBtn onClick={() => go("search")} className="!py-2 !px-4">Resume search <ArrowRight size={15}/></PrimaryBtn>
        </Card>
      )}

      <div className="grid lg:grid-cols-5 gap-5">
        <Card className="lg:col-span-2 p-6 relative overflow-hidden slide-up">
          <div className="absolute top-0 left-0 right-0 h-1" style={{ background: "var(--tap-green)" }}/>
          <Chip tone="green" className="mb-3"><Repeat size={11}/> Your recurring journey <Why text={`Identified from your travel_history: ${pat.matching} of your last ${pat.last} outbound trips were on this route and flight. That makes it your dominant pattern, so we surface it for one-tap rebooking.`}/></Chip>
          <RouteRibbon from="OPO" to="LIS" dep="Porto" arr="Lisbon"/>
          <div className="mt-4 text-sm text-gray-600 leading-relaxed">
            You flew this route on <b>{pat.matching} of your last {pat.last}</b> outbound trips — {pat.usualOut}, back {pat.usualBack}.
            <span className="text-gray-400"> (computed live from your travel_history table)</span>
          </div>
          <div className="mt-4 p-3 rounded-xl text-sm font-semibold flex items-center justify-between" style={{ background: "var(--tap-mist)", color: "var(--tap-deep)" }}>
            <span>Mon 15 Jun · TP1927 07:05</span><span>{EUR(86)}</span>
          </div>
          <PrimaryBtn onClick={bookUsual} className="w-full mt-4"><Zap size={16}/> Book my usual flight</PrimaryBtn>
          <div className="text-[11px] text-gray-400 mt-2 text-center">Seat {profile.prefs.seat.split(" ")[0]}, {profile.prefs.bag.toLowerCase()} and espresso pre-selected</div>
        </Card>

        <Card className="lg:col-span-3 p-6 slide-up">
          <div className="flex items-center justify-between mb-3">
            <Chip tone="gold"><Sparkles size={11}/> AI itinerary planner</Chip>
            <span className="text-[11px] text-gray-400">Claude · reads your profile from the DB{aiMode === "cached" ? " · cached mode" : ""}</span>
          </div>
          <div className="flex gap-2">
            <input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runPlanner()}
              placeholder='Try: "Plan my Lisbon client week"' className="flex-1 px-4 py-3 rounded-xl border text-sm outline-none" style={{ borderColor: "var(--tap-line)" }}/>
            <PrimaryBtn onClick={() => runPlanner()} disabled={planning} className="!px-4">{planning ? <Loader2 className="animate-spin" size={16}/> : <Send size={16}/>}</PrimaryBtn>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {["Plan my Lisbon client week", "Squeeze in Madrid on Friday", "Best return if my Thursday meeting overruns"].map((s) => (
              <button key={s} onClick={() => { setPrompt(s); runPlanner(s); }}
                className="text-xs px-3 py-1.5 rounded-full border hover:bg-gray-50 font-medium text-gray-600" style={{ borderColor: "var(--tap-line)" }}>{s}</button>
            ))}
          </div>
          {planning && <div className="mt-5 flex items-center gap-3 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} style={{ color: "var(--tap-green)" }}/> Reading your travel pattern and building options…</div>}
          {plan && (
            <div className="mt-5 slide-up">
              <div className="font-display font-extrabold text-lg" style={{ color: "var(--tap-ink)" }}>{plan.title}</div>
              <div className="text-sm text-gray-500 mb-3">{plan.summary}</div>
              <div className="space-y-2">
                {plan.legs?.map((l, i) => (
                  <div key={i} className="flex items-center gap-4 p-3 rounded-xl border" style={{ borderColor: "var(--tap-line)" }}>
                    <div className="w-20 shrink-0 text-xs font-bold" style={{ color: "var(--tap-deep)" }}>{l.day}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold" style={{ color: "var(--tap-ink)" }}>{l.flight} · {l.route} · {l.times}</div>
                      <div className="text-xs text-gray-500 truncate">{l.why}</div>
                    </div>
                    <button onClick={() => { const code = (l.route || "").split(/[→\-]/).pop().trim().slice(0,3).toUpperCase(); bookDestination(destinations.find(d => d.code === code) || { code: code || "LIS", city: code }); }} className="text-xs font-bold shrink-0" style={{ color: "var(--tap-green)" }}>Add →</button>
                  </div>
                ))}
              </div>
              {plan.tip && <div className="mt-3 text-xs flex items-start gap-1.5 text-gray-500"><Sparkles size={13} className="shrink-0 mt-0.5" style={{ color: "var(--tap-gold)" }}/>{plan.tip}</div>}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display font-extrabold text-xl" style={{ color: "var(--tap-ink)" }}>Picked for you</h2>
            <Why text="These destinations are chosen from your real data: routes you've flown, trips you've booked, and places you've searched — pulled live from the customer database."/>
          </div>
          <span className="text-xs text-gray-400">From your searches, trips and miles balance</span>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {destinations.map((d) => {
            const booked = pat.destCounts?.[d.code] || 0;
            return (
              <Card key={d.code} className="p-4 hover:shadow-md transition-shadow cursor-pointer group relative" onClick={() => bookDestination(d)}>
                <div className="absolute top-3 right-3" onClick={(e) => e.stopPropagation()}><Why text={d.reason || d.tag}/></div>
                <div className="text-3xl mb-2">{d.emoji}</div>
                <div className="font-display font-extrabold flex items-center gap-2" style={{ color: "var(--tap-ink)" }}>
                  {d.city} <span className="text-gray-400 font-semibold text-sm">{d.code}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 mb-3">{booked > 0 ? `Booked ${booked}× — a favourite` : d.tag}</div>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold" style={{ color: "var(--tap-green)" }}>{d.miles_price ? `${d.miles_price.toLocaleString()} miles` : `from ${EUR(d.price)}`}</div>
                  <span className="text-xs font-bold flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--tap-green)" }}>Book <ArrowRight size={13}/></span>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      <button onClick={openAssistant} className="fixed bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-3 rounded-full shadow-lg text-white text-sm font-semibold" style={{ background: "var(--tap-deep)" }}>
        <MessageCircle size={17}/> TAP Assistant
      </button>
    </div>
  );
}

/* ── FLIGHTS — recommendations + fare lock (persisted to DB) ── */
function Flights({ flights, pattern, selectFlight, toast }) {
  const [locked, setLocked] = useState(null);
  const dest = flights[0]?.dest || "LIS";
  const origin = flights[0]?.origin || "OPO";
  const toggleLock = async (f) => {
    const active = locked !== f.flight_no;
    setLocked(active ? f.flight_no : null);
    const r = await api.post("/fare-lock", { flight_no: f.flight_no, active });
    if (active) toast("Fare locked in DB", `${f.flight_no} at ${EUR(r.price)} until ${r.expires}`);
  };
  return (
    <div className="max-w-4xl mx-auto px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="font-display font-black text-3xl" style={{color:"var(--tap-ink)"}}>{cityName(origin)} → {cityName(dest)}</h1>
        <Chip tone="ink">Mon 15 Jun 2026 · 1 adult · Economy</Chip>
      </div>
      <p className="text-sm text-gray-500 mb-6">Sorted for you: your usual departure first, lowest fare flagged. Recommendations computed from your travel history.</p>
      <div className="space-y-3">
        {flights.map((f) => {
          const isLocked = locked === f.flight_no;
          return (
            <Card key={f.flight_no} className="ticket-edge p-0 overflow-hidden slide-up" style={f.recommended ? { boxShadow: "0 0 0 2px var(--tap-green)" } : {}}>
              <div className="p-5 flex flex-wrap items-center gap-5">
                <div className="w-[88px]">
                  <div className="text-xs font-bold text-gray-400">{f.flight_no}</div>
                  <div className="text-[11px] text-gray-400">{f.aircraft}</div>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <RouteRibbon small from={`${f.origin} ${f.dep}`} to={`${f.dest} ${f.arr}`}/>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {!!f.recommended && (f.dest === pattern.topRoute?.split("→")[1]
                      ? <Chip tone="green"><Sparkles size={11}/> Recommended — matches {pattern.matching} of your last {pattern.last} departures</Chip>
                      : <Chip tone="green"><Sparkles size={11}/> Best fit — earliest arrival for your meetings</Chip>)}
                    {!!f.lowest && <Chip tone="amber">Lowest fare today</Chip>}
                    {f.seats_left < 20 && <Chip tone="red">{f.seats_left} seats left</Chip>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-display font-black text-2xl" style={{color:"var(--tap-ink)"}}>{EUR(f.price)}</div>
                  <div className="text-[11px] text-gray-400">Basic · cabin bag incl.</div>
                </div>
                <div className="flex flex-col gap-2 w-full sm:w-auto">
                  <PrimaryBtn onClick={() => selectFlight(f)} className="!py-2.5">Select <ChevronRight size={15}/></PrimaryBtn>
                  <button onClick={() => toggleLock(f)}
                    className="flex items-center justify-center gap-1.5 text-xs font-bold py-1.5 rounded-lg transition-colors"
                    style={{ color: isLocked ? "#fff" : "var(--tap-deep)", background: isLocked ? "var(--tap-deep)" : "var(--tap-mist)" }}>
                    <Lock size={12}/> {isLocked ? "Fare locked 24h" : "Lock fare · free for Gold"}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ── BASKET — persisted server-side on every change ── */
function Basket({ flight, ancillaries, items, toggleItem, go }) {
  const extras = items.reduce((s, id) => s + (ancillaries.find(a=>a.code===id)?.price || 0), 0);
  const total = flight.price + extras;
  return (
    <div className="max-w-5xl mx-auto px-4 pb-24 pt-8">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="font-display font-black text-3xl" style={{color:"var(--tap-ink)"}}>Your trip basket</h1>
        <Chip tone="green"><ShoppingBag size={11}/> Persistent — saved to DB on every change</Chip>
      </div>
      <p className="text-sm text-gray-500 mb-6">Everything in one place. Your usual choices are pre-loaded from your preference record.</p>
      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-3">
          <Card className="ticket-edge p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs font-bold text-gray-400 mb-1">{flight.flight_no} · Mon 15 Jun 2026</div>
                <RouteRibbon small from={`${flight.origin} ${flight.dep}`} to={`${flight.dest} ${flight.arr}`}/>
              </div>
              <div className="font-display font-black text-xl" style={{color:"var(--tap-ink)"}}>{EUR(flight.price)}</div>
            </div>
          </Card>
          {ancillaries.map(a => {
            const on = items.includes(a.code);
            return (
              <Card key={a.code} className={`p-4 transition-all ${on ? "" : "opacity-60"}`} style={on ? { borderColor: "var(--tap-green)" } : {}}>
                <button onClick={() => toggleItem(a.code)} className="w-full flex items-center gap-4 text-left">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--tap-mist)" }}><AncIcon k={a.icon}/></div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold flex items-center gap-2 flex-wrap" style={{color:"var(--tap-ink)"}}>
                      {a.name}{!!a.auto && on && <Chip tone="green">Pre-selected for you</Chip>}
                    </div>
                    <div className="text-xs text-gray-500">{a.descr}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold" style={{color: a.price===0 ? "var(--tap-green)" : "var(--tap-ink)"}}>{a.price === 0 ? "Free" : EUR(a.price)}</div>
                    {a.was && <div className="text-[11px] text-gray-400 line-through">{EUR(a.was)}</div>}
                  </div>
                  <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0"
                    style={{ borderColor: on ? "var(--tap-green)" : "var(--tap-line)", background: on ? "var(--tap-green)" : "#fff" }}>
                    {on && <CheckCircle2 size={13} className="text-white"/>}
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
        <div>
          <Card className="p-5 sticky top-20">
            <div className="font-display font-extrabold mb-3" style={{color:"var(--tap-ink)"}}>Summary</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600"><span>Flight {flight.flight_no}</span><span>{EUR(flight.price)}</span></div>
              {items.map(id => { const a = ancillaries.find(x=>x.code===id); return a && (
                <div key={id} className="flex justify-between text-gray-600"><span className="truncate pr-2">{a.name}</span><span>{a.price===0?"Free":EUR(a.price)}</span></div>
              );})}
              <div className="h-px my-2" style={{background:"var(--tap-line)"}}/>
              <div className="flex justify-between font-bold text-base" style={{color:"var(--tap-ink)"}}><span>Total</span><span>{EUR(total)}</span></div>
            </div>
            <PrimaryBtn onClick={() => go("checkout")} className="w-full mt-4">Continue to checkout <ArrowRight size={15}/></PrimaryBtn>
            <div className="text-[11px] text-gray-400 mt-3 flex items-center gap-1.5"><Database size={12}/> Basket row visible in the Demo Console.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ── CHECKOUT — autofill from DB profile + Time-to-Think hold ── */
function Checkout({ profile, flight, ancillaries, items, go, hold, setHold, toast }) {
  const extras = items.reduce((s, id) => s + (ancillaries.find(a=>a.code===id)?.price || 0), 0);
  const total = flight.price + extras;
  const u = profile.user;
  const doHold = async () => {
    if (hold) { setHold(false); return; }
    const r = await api.post("/hold", { flight_no: flight.flight_no, items, total });
    setHold(r.expires);
    toast("Hold confirmed by email", `${r.email.subject} → ${r.email.to} · ${r.email.status}`);
  };
  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 pt-8">
      <h1 className="font-display font-black text-3xl mb-1" style={{color:"var(--tap-ink)"}}>Quick review</h1>
      <p className="text-sm text-gray-500 mb-6">One screen. Every field below is fetched live from your customer record.</p>
      <Card className="p-5 mb-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="font-bold text-sm" style={{color:"var(--tap-ink)"}}>Passenger</div>
          <Chip tone="green"><Zap size={11}/> Auto-filled from users table · member {u.member_no}</Chip>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          {[["Full name", u.full_name],["Document", u.doc_id],["Email", u.email],["Mobile", u.phone]].map(([k,v])=>(
            <div key={k} className="p-3 rounded-xl" style={{background:"var(--tap-mist)"}}>
              <div className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">{k}</div>
              <div className="font-semibold" style={{color:"var(--tap-deep)"}}>{v}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="ticket-edge p-5 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-bold text-gray-400 mb-1">{flight.flight_no} · Mon 15 Jun · Seat 4C</div>
            <RouteRibbon small from={`${flight.origin} ${flight.dep}`} to={`${flight.dest} ${flight.arr}`}/>
          </div>
          <div className="text-right">
            <div className="font-display font-black text-2xl" style={{color:"var(--tap-ink)"}}>{EUR(total)}</div>
            <div className="text-[11px] text-gray-400">{items.length} extras included</div>
          </div>
        </div>
      </Card>
      <Card className="p-5 mb-6" style={{ background: hold ? "#FFF9EC" : "#fff", borderColor: hold ? "var(--tap-gold)" : "var(--tap-line)" }}>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:"#F7EFD6"}}><TimerReset size={18} style={{color:"var(--tap-gold)"}}/></div>
          <div className="flex-1">
            <div className="font-bold text-sm" style={{color:"var(--tap-ink)"}}>Need time to think?</div>
            <div className="text-xs text-gray-500 mt-0.5">Hold this booking — price, seat 4C and extras — for <b>48 hours</b>, free for Gold. We email you the hold confirmation.</div>
            {hold && <div className="text-xs font-bold mt-2" style={{color:"var(--tap-gold)"}}>⏳ Held until {hold} · confirmation email sent · reminder 6h before expiry.</div>}
          </div>
          <GhostBtn onClick={doHold} className="shrink-0">{hold ? "Release hold" : "Hold 48h — free"}</GhostBtn>
        </div>
      </Card>
      <div className="flex gap-3">
        <GhostBtn onClick={() => go("basket")} className="flex-1">Back to basket</GhostBtn>
        <PrimaryBtn onClick={() => go("payment")} className="flex-[2]">Continue to payment · {EUR(total)} <ArrowRight size={15}/></PrimaryBtn>
      </div>
    </div>
  );
}

/* ── PAYMENT — card + miles + voucher in one transaction ── */
function Payment({ profile, flight, ancillaries, items, onPaid, toast }) {
  const extras = items.reduce((s, id) => s + (ancillaries.find(a=>a.code===id)?.price || 0), 0);
  const total = flight.price + extras;
  const u = profile.user;
  const voucher = profile.vouchers[0];
  const [useVoucher, setUseVoucher] = useState(!!voucher);
  const [milesUsed, setMilesUsed] = useState(6000);
  const [paying, setPaying] = useState(false);

  const voucherVal = useVoucher && voucher ? Math.min(voucher.amount, total) : 0;
  const milesVal = Math.min(milesUsed * MILES_RATE, Math.max(0, total - voucherVal));
  const cardVal = Math.max(0, total - voucherVal - milesVal);
  const maxMiles = Math.min(u.miles, Math.ceil((total - voucherVal) / MILES_RATE));

  const pay = async () => {
    setPaying(true);
    const r = await api.post("/pay", { flight_no: flight.flight_no, items, total,
      voucher_amt: voucherVal, miles_used: milesVal > 0 ? Math.min(milesUsed, maxMiles) : 0, miles_amt: milesVal, card_amt: cardVal });
    toast("Confirmation email sent", `${r.email.subject} → ${r.email.to} · ${r.email.status}`);
    onPaid({ pnr: r.pnr, total, voucherVal, milesVal, cardVal });
  };

  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 pt-8">
      <h1 className="font-display font-black text-3xl mb-1" style={{color:"var(--tap-ink)"}}>Pay your way</h1>
      <p className="text-sm text-gray-500 mb-6">Split across card, miles and vouchers — one transaction. Balances update live in the DB.</p>
      <div className="space-y-3 mb-6">
        {voucher && (
          <Card className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:"var(--tap-mist)"}}><Ticket size={18} style={{color:"var(--tap-green)"}}/></div>
            <div className="flex-1">
              <div className="text-sm font-bold" style={{color:"var(--tap-ink)"}}>Voucher {voucher.code} — {EUR(voucher.amount)}</div>
              <div className="text-xs text-gray-500">{voucher.reason} · expires {voucher.expiry}</div>
            </div>
            <div className="text-sm font-bold" style={{color:"var(--tap-green)"}}>−{EUR(voucherVal)}</div>
            <button onClick={()=>setUseVoucher(!useVoucher)} role="switch" aria-checked={useVoucher}
              className="w-11 h-6 rounded-full relative transition-colors shrink-0" style={{background: useVoucher ? "var(--tap-green)" : "#D6DEDA"}}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${useVoucher?"left-[22px]":"left-0.5"}`}/>
            </button>
          </Card>
        )}
        <Card className="p-4">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:"var(--tap-mist)"}}><Wallet size={18} style={{color:"var(--tap-green)"}}/></div>
            <div className="flex-1">
              <div className="text-sm font-bold" style={{color:"var(--tap-ink)"}}>Miles&Go balance — {u.miles.toLocaleString()} miles</div>
              <div className="text-xs text-gray-500">Drag to use miles toward this trip</div>
            </div>
            <div className="text-sm font-bold" style={{color:"var(--tap-green)"}}>−{EUR(milesVal)}</div>
          </div>
          <input type="range" min={0} max={maxMiles} step={500} value={Math.min(milesUsed, maxMiles)}
            onChange={(e)=>setMilesUsed(+e.target.value)} className="w-full accent-[#00A357]"/>
          <div className="flex justify-between text-[11px] text-gray-400 font-medium"><span>0</span><span>{Math.min(milesUsed,maxMiles).toLocaleString()} miles</span><span>{maxMiles.toLocaleString()}</span></div>
        </Card>
        <Card className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:"var(--tap-mist)"}}><CreditCard size={18} style={{color:"var(--tap-green)"}}/></div>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{color:"var(--tap-ink)"}}>{u.card_brand} •••• {u.card_last4}</div>
            <div className="text-xs text-gray-500">Saved to your profile · 3-D Secure ready</div>
          </div>
          <div className="text-sm font-bold" style={{color:"var(--tap-ink)"}}>{EUR(cardVal)}</div>
        </Card>
      </div>
      <Card className="p-5" style={{background:"var(--tap-deep)", borderColor:"var(--tap-deep)"}}>
        <div className="flex justify-between text-white/70 text-sm mb-1"><span>Voucher</span><span>−{EUR(voucherVal)}</span></div>
        <div className="flex justify-between text-white/70 text-sm mb-1"><span>{milesVal>0?`${Math.min(milesUsed,maxMiles).toLocaleString()} miles`:"Miles"}</span><span>−{EUR(milesVal)}</span></div>
        <div className="flex justify-between text-white font-display font-extrabold text-xl mt-2 mb-4"><span>Charge to card</span><span>{EUR(cardVal)}</span></div>
        <button onClick={pay} disabled={paying}
          className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-transform active:scale-[.98]"
          style={{background:"var(--tap-green)", color:"#fff"}}>
          {paying ? <><Loader2 className="animate-spin" size={16}/> Confirming with your bank…</> : <><Zap size={16}/> One-click pay · {EUR(total)}</>}
        </button>
        <div className="text-[11px] text-white/50 mt-2 text-center">Instant confirmation · itinerary emailed + visible in the Demo Console</div>
      </Card>
    </div>
  );
}

/* ── CONFIRMATION ── */
function Confirmed({ profile, flight, receipt, go }) {
  return (
    <div className="max-w-xl mx-auto px-4 pt-14 pb-24 text-center">
      <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center slide-up" style={{background:"#E2F4EA"}}>
        <CheckCircle2 size={32} style={{color:"var(--tap-green)"}}/>
      </div>
      <h1 className="font-display font-black text-3xl mb-2" style={{color:"var(--tap-ink)"}}>You're booked, Daniel.</h1>
      <p className="text-sm text-gray-500 mb-6">Confirmation <b>{receipt.pnr}</b> · written to the bookings table · email sent to {profile.user.email}.<br/>Auto check-in is ON — your boarding pass appears here 24h before departure.</p>
      <Card className="ticket-edge p-5 text-left mb-5">
        <div className="text-xs font-bold text-gray-400 mb-1">{flight.flight_no} · Mon 15 Jun 2026 · Seat 4C · Gate close 06:45</div>
        <RouteRibbon from={`${flight.origin} ${flight.dep}`} to={`${flight.dest} ${flight.arr}`}/>
        <div className="h-px my-4" style={{background:"var(--tap-line)"}}/>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div><div className="text-gray-400">Voucher</div><div className="font-bold" style={{color:"var(--tap-deep)"}}>−{EUR(receipt.voucherVal)}</div></div>
          <div><div className="text-gray-400">Miles</div><div className="font-bold" style={{color:"var(--tap-deep)"}}>−{EUR(receipt.milesVal)}</div></div>
          <div><div className="text-gray-400">Card</div><div className="font-bold" style={{color:"var(--tap-deep)"}}>{EUR(receipt.cardVal)}</div></div>
        </div>
      </Card>
      <PrimaryBtn onClick={()=>go("manage")} className="w-full">Manage this booking <ArrowRight size={15}/></PrimaryBtn>
    </div>
  );
}

/* ── MANAGE — auto check-in, boarding pass, AI disruption + emails ── */
function Manage({ profile, flight, openAssistant, toast, go }) {
  const [autoCI, setAutoCI] = useState(!!profile.prefs.auto_checkin);
  const [showPass, setShowPass] = useState(false);
  const [disrupted, setDisrupted] = useState(false);
  const [recovery, setRecovery] = useState(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [rebooked, setRebooked] = useState(null);
  const [bookings, setBookings] = useState(null);
  const [passBooking, setPassBooking] = useState(null);

  const loadBookings = async () => setBookings(await api.get("/bookings"));
  useEffect(() => { loadBookings(); }, []);

  const active = bookings ? bookings.filter(b => b.status !== "cancelled") : [];
  const primary = active[0];   // newest active booking drives disruption demo

  const simulateDisruption = async () => {
    if (!primary) { toast("No active booking", "Book a flight first, then simulate a delay"); return; }
    setDisrupted(true); setRebooked(null); setRecovery(null); setLoadingRec(true);
    const r = await api.post("/disrupt", { flight_no: primary.flight_no });
    setRecovery(r.recovery); setLoadingRec(false);
    toast("Disruption email sent proactively", `${r.email.subject} → ${r.email.to} · ${r.email.status}`);
  };
  const acceptOption = async (opt) => {
    setRebooked(opt);
    const r = await api.post("/rebook", { option: opt });
    toast("Rebooking confirmed by email", `${r.email.subject} → ${r.email.to} · ${r.email.status}`);
    loadBookings();
  };
  const cancelBooking = async (b) => {
    const r = await api.post("/bookings/cancel", {});
    if (r.ok) toast("Booking cancelled — refund issued", `${r.pnr} · ${r.email.subject}`);
    loadBookings();
  };
  const toggleCI = async () => { setAutoCI(!autoCI); await api.post("/checkin", { auto: !autoCI }); };

  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 pt-8">
      <h1 className="font-display font-black text-3xl mb-1" style={{color:"var(--tap-ink)"}}>Your bookings</h1>
      <p className="text-sm text-gray-500 mb-6">Live from the bookings table — change, cancel, check in, all in-app.</p>

      {disrupted && (
        <Card className="p-5 mb-5 slide-up" style={{ borderColor: "var(--tap-red)", background: "#FFF6F7" }}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{background:"#FBE4E7"}}>
              <Bell size={17} style={{color:"var(--tap-red)"}} className="pulse-dot"/>
            </div>
            <div className="flex-1">
              {loadingRec ? (
                <div className="flex items-center gap-2 text-sm text-gray-600"><Loader2 className="animate-spin" size={15}/> Disruption detected — AI preparing your options and emailing you…</div>
              ) : recovery && (
                <>
                  <div className="font-bold text-sm mb-1" style={{color:"var(--tap-red)"}}>{recovery.headline}</div>
                  <p className="text-sm text-gray-700 leading-relaxed mb-3">{recovery.message}</p>
                  {!rebooked ? (
                    <div className="space-y-2">
                      {recovery.options?.map((o)=>(
                        <button key={o.id} onClick={()=>acceptOption(o)}
                          className="w-full text-left p-3 rounded-xl border bg-white hover:shadow-sm transition-shadow flex items-center gap-3" style={{borderColor:"var(--tap-line)"}}>
                          <RefreshCw size={15} style={{color:"var(--tap-green)"}} className="shrink-0"/>
                          <div className="flex-1">
                            <div className="text-sm font-bold" style={{color:"var(--tap-ink)"}}>{o.label}</div>
                            <div className="text-xs text-gray-500">{o.detail}</div>
                          </div>
                          <span className="text-xs font-bold shrink-0" style={{color:"var(--tap-green)"}}>Select — free</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl flex items-center gap-2 text-sm font-semibold" style={{background:"#E2F4EA", color:"#066B3C"}}>
                      <CheckCircle2 size={16}/> Done — {rebooked.label}. New boarding pass issued, confirmation emailed.
                    </div>
                  )}
                  {recovery.compensation && <div className="text-xs text-gray-500 mt-3 flex items-start gap-1.5"><ShieldCheck size={13} className="shrink-0 mt-0.5" style={{color:"var(--tap-gold)"}}/>{recovery.compensation}</div>}
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {bookings === null && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="animate-spin" size={16}/> Loading your bookings…</div>}

      {bookings !== null && active.length === 0 && (
        <Card className="p-8 text-center">
          <CalendarClock size={32} className="mx-auto mb-3" style={{ color: "var(--tap-line)" }}/>
          <div className="font-bold text-sm mb-1" style={{ color: "var(--tap-ink)" }}>No active bookings yet</div>
          <div className="text-xs text-gray-500 mb-4">Once you book a flight it appears here, live from the database.</div>
          <PrimaryBtn onClick={() => go("home")} className="!py-2.5"><Zap size={15}/> Book my usual flight</PrimaryBtn>
        </Card>
      )}

      {active.map((b, idx) => {
        const f = b.flight || {};
        const isPrimary = idx === 0;
        const delayed = isPrimary && disrupted && !rebooked;
        return (
          <Card key={b.id} className="ticket-edge p-5 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="text-xs font-bold text-gray-400">{b.pnr} · {b.flight_date} · {rebooked && isPrimary ? `rebooked to ${rebooked.id}` : b.flight_no}</div>
              <Chip tone={delayed ? "red" : "green"}>
                <span className="pulse-dot">●</span> {delayed ? `Delayed · new dep ${f.new_dep || "08:55"}` : (b.status === "rebooked" ? "Rebooked" : "On time")}
              </Chip>
            </div>
            <RouteRibbon from={`${f.origin || "OPO"} ${delayed ? "08:55" : f.dep}`} to={`${f.dest || "LIS"} ${delayed ? "09:50" : f.arr}`}/>
            <div className="text-xs text-gray-500 mt-2">Seat {b.seat} · {(b.items || []).join(" · ") || "no extras"} · {b.checked_in ? "Checked in ✓" : "Auto check-in 24h before"}</div>
            <div className="h-px my-4" style={{background:"var(--tap-line)"}}/>
            <div className="grid sm:grid-cols-3 gap-2">
              <GhostBtn onClick={()=>{ setPassBooking(b); setShowPass(true); }} className="w-full"><QrCode size={15}/> Boarding pass</GhostBtn>
              <GhostBtn onClick={()=>go("search")} className="w-full"><RefreshCw size={15}/> Change flight</GhostBtn>
              <GhostBtn onClick={()=>cancelBooking(b)} className="w-full text-red-600 !border-red-100"><X size={15}/> Cancel — instant refund</GhostBtn>
            </div>
          </Card>
        );
      })}

      {bookings && bookings.some(b => b.status === "cancelled") && (
        <div className="text-xs text-gray-400 mb-4">+ {bookings.filter(b => b.status === "cancelled").length} cancelled booking(s) in your history (visible in Demo Console).</div>
      )}

      <Card className="p-4 mb-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{background:"var(--tap-mist)"}}><BadgeCheck size={18} style={{color:"var(--tap-green)"}}/></div>
        <div className="flex-1">
          <div className="text-sm font-bold flex items-center gap-1.5" style={{color:"var(--tap-ink)"}}>Auto check-in <Why text="On because your preference record has auto check-in enabled — set from your past behaviour of always checking in early. Stored in the preferences table."/></div>
          <div className="text-xs text-gray-500">We check you in 24h before every flight and push the boarding pass here. Setting stored in your preference record.</div>
        </div>
        <button onClick={toggleCI} role="switch" aria-checked={autoCI}
          className="w-11 h-6 rounded-full relative transition-colors shrink-0" style={{background: autoCI ? "var(--tap-green)" : "#D6DEDA"}}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${autoCI?"left-[22px]":"left-0.5"}`}/>
        </button>
      </Card>

      <Card className="p-4 flex flex-wrap items-center gap-3" style={{background:"#FBFDFC"}}>
        <div className="text-xs text-gray-500 flex-1 min-w-[200px]"><b>Demo control:</b> trigger a live disruption — the ops event hits the DB, Claude writes the recovery, and the notification email goes out in real time.</div>
        <button onClick={simulateDisruption} disabled={loadingRec}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-white flex items-center gap-2 disabled:opacity-50" style={{background:"var(--tap-red)"}}>
          <AlertTriangle size={15}/> Simulate flight delay
        </button>
        <GhostBtn onClick={openAssistant}><MessageCircle size={15}/> Ask the assistant</GhostBtn>
      </Card>

      {showPass && passBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(6,30,22,.6)"}} onClick={()=>setShowPass(false)}>
          <div className="w-full max-w-sm slide-up" onClick={(e)=>e.stopPropagation()}>
            <div className="rounded-t-2xl p-5 text-white" style={{background:"var(--tap-deep)"}}>
              <div className="flex items-center justify-between mb-4"><TapLogo light size="text-base"/><button onClick={()=>setShowPass(false)} aria-label="Close"><X size={18}/></button></div>
              <div className="flex items-center justify-between">
                <div><div className="text-3xl font-display font-black">{passBooking.flight?.origin || "OPO"}</div><div className="text-xs text-white/60">{cityName(passBooking.flight?.origin || "OPO")}</div></div>
                <Plane size={20} className="text-white/60"/>
                <div className="text-right"><div className="text-3xl font-display font-black">{passBooking.flight?.dest || "LIS"}</div><div className="text-xs text-white/60">{cityName(passBooking.flight?.dest || "LIS")}</div></div>
              </div>
            </div>
            <div className="bg-white rounded-b-2xl p-5 ticket-edge">
              <div className="grid grid-cols-4 gap-2 text-center text-xs mb-4">
                {[["Flight", passBooking.flight_no],["Seat",passBooking.seat || "4C"],["Group","A · Gold"],["Gate","12"]].map(([k,v])=>(
                  <div key={k}><div className="text-gray-400">{k}</div><div className="font-bold" style={{color:"var(--tap-ink)"}}>{v}</div></div>
                ))}
              </div>
              <div className="flex justify-center mb-3"><FakeQR seed={42}/></div>
              <div className="text-center text-[11px] text-gray-400">Checked in automatically · {profile.user.full_name}<br/>Updates live if anything changes — this pass is always current.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── DEMO CONSOLE — live DB inspector + email center ── */
function Console({ toast }) {
  const [data, setData] = useState(null);
  const [emails, setEmails] = useState([]);
  const [openEmail, setOpenEmail] = useState(null);
  const [tab, setTab] = useState("users");

  const refresh = async () => {
    const [d, e] = await Promise.all([api.get("/admin/db"), api.get("/admin/emails")]);
    setData(d); setEmails(e);
  };
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  const viewEmail = async (id) => setOpenEmail(await api.get(`/admin/emails/${id}`));
  const reset = async () => { await api.post("/admin/reset"); await refresh(); toast("Demo reset", "Bookings, payments, emails and events cleared; balances restored."); };

  if (!data) return <div className="max-w-6xl mx-auto px-4 pt-12 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="animate-spin" size={16}/> Loading database…</div>;
  const tables = Object.keys(data.tables);
  const rows = data.tables[tab] || [];
  const cols = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="max-w-6xl mx-auto px-4 pb-24 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <h1 className="font-display font-black text-3xl flex items-center gap-3" style={{color:"var(--tap-ink)"}}><Database size={26} style={{color:"var(--tap-green)"}}/> Demo Console</h1>
        <div className="flex gap-2">
          <GhostBtn onClick={refresh}><RefreshCw size={14}/> Refresh</GhostBtn>
          <GhostBtn onClick={reset}><RotateCcw size={14}/> Reset demo</GhostBtn>
        </div>
      </div>
      <p className="text-sm text-gray-500 mb-1">Live view of the SQLite customer database the site runs on — every click on the site writes here. Auto-refreshes every 4s.</p>
      <p className="text-[11px] text-gray-400 mb-6 font-mono">{data.dbPath} · CDP-ready: this store maps 1:1 to customer-profile, behaviour and consent objects for later CDP sync.</p>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tables.map(t => (
              <button key={t} onClick={()=>setTab(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${t===tab?"text-white":"text-gray-500 bg-white border hover:bg-gray-50"}`}
                style={t===tab?{background:"var(--tap-deep)"}:{borderColor:"var(--tap-line)"}}>
                {t} <span className="opacity-60">({data.tables[t].length})</span>
              </button>
            ))}
          </div>
          <Card className="overflow-auto max-h-[480px]">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-white">
                <tr>{cols.map(c => <th key={c} className="text-left px-3 py-2 font-bold text-gray-500 border-b whitespace-nowrap" style={{borderColor:"var(--tap-line)"}}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r,i)=>(
                  <tr key={i} className={i%2?"bg-gray-50/60":""}>
                    {cols.map(c => <td key={c} className="px-3 py-1.5 whitespace-nowrap max-w-[260px] truncate font-mono" style={{color:"var(--tap-ink)"}}>{String(r[c] ?? "")}</td>)}
                  </tr>
                ))}
                {rows.length===0 && <tr><td className="px-3 py-6 text-gray-400 text-xs">No rows yet — interact with the site and refresh.</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>

        <div>
          <div className="font-display font-extrabold mb-3 flex items-center gap-2" style={{color:"var(--tap-ink)"}}><Mail size={17} style={{color:"var(--tap-green)"}}/> Email center</div>
          <div className="space-y-2 max-h-[520px] overflow-auto pr-1">
            {emails.length===0 && <Card className="p-4 text-xs text-gray-400">No emails yet — book a flight, place a hold, send an offer, or simulate a disruption.</Card>}
            {emails.map(e => (
              <Card key={e.id} className="p-3">
                <div className="text-xs font-bold truncate" style={{color:"var(--tap-ink)"}}>{e.subject}</div>
                <div className="text-[11px] text-gray-500 truncate">to {e.to_addr} · {e.created_at}</div>
                <div className="flex items-center justify-between mt-1.5">
                  <Chip tone={e.status.startsWith("delivered") ? "green" : "amber"}>{e.status}</Chip>
                  <button onClick={()=>viewEmail(e.id)} className="text-[11px] font-bold flex items-center gap-1" style={{color:"var(--tap-green)"}}><Eye size={12}/> Preview</button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {openEmail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{background:"rgba(6,30,22,.6)"}} onClick={()=>setOpenEmail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col slide-up" onClick={(e)=>e.stopPropagation()}>
            <div className="p-4 border-b flex items-center justify-between" style={{borderColor:"var(--tap-line)"}}>
              <div className="min-w-0">
                <div className="text-sm font-bold truncate" style={{color:"var(--tap-ink)"}}>{openEmail.subject}</div>
                <div className="text-[11px] text-gray-500">to {openEmail.to_addr} · {openEmail.status}</div>
              </div>
              <button onClick={()=>setOpenEmail(null)} aria-label="Close"><X size={18} className="text-gray-400"/></button>
            </div>
            <iframe title="email preview" srcDoc={openEmail.html} className="flex-1 w-full min-h-[420px]" sandbox=""/>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── ASSISTANT — Claude concierge via backend ── */
function Assistant({ open, onClose, screen }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", content: "Olá Daniel 👋 I can rebook, change seats, check disruption risk or answer anything about your trip — just ask." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); }, [msgs, open]);

  const send = async () => {
    const q = input.trim(); if (!q || busy) return;
    const next = [...msgs.slice(1), { role: "user", content: q }];
    setMsgs([msgs[0], ...next]); setInput(""); setBusy(true);
    const payload = [...next.slice(0, -1), { role: "user", content: `(Daniel is on the "${screen}" screen. Active booking: TP1927 OPO→LIS Mon 15 Jun 07:05, seat 4C.) ${q}` }];
    const r = await api.post("/ai/chat", { messages: payload });
    setMsgs(m => [...m, { role: "assistant", content: r.reply }]); setBusy(false);
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{background:"rgba(6,30,22,.35)"}} onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white flex flex-col slide-up" onClick={(e)=>e.stopPropagation()}>
        <div className="p-4 flex items-center justify-between border-b" style={{borderColor:"var(--tap-line)", background:"var(--tap-deep)"}}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{background:"var(--tap-green)"}}><Sparkles size={17} className="text-white"/></div>
            <div><div className="text-white font-bold text-sm">TAP Assistant</div><div className="text-white/60 text-[11px]">Knows your Gold profile · Claude via backend</div></div>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white" aria-label="Close assistant"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{background:"var(--tap-mist)"}}>
          {msgs.map((m,i)=>(
            <div key={i} className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${m.role==="user"?"ml-auto text-white rounded-br-md":"bg-white rounded-bl-md border"}`}
              style={m.role==="user" ? {background:"var(--tap-green)"} : {borderColor:"var(--tap-line)", color:"var(--tap-ink)"}}>{m.content}</div>
          ))}
          {busy && <div className="bg-white border px-4 py-2.5 rounded-2xl rounded-bl-md w-fit" style={{borderColor:"var(--tap-line)"}}><Loader2 className="animate-spin" size={15} style={{color:"var(--tap-green)"}}/></div>}
          <div ref={endRef}/>
        </div>
        <div className="p-3 border-t" style={{borderColor:"var(--tap-line)"}}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {["Will my Monday flight be on time?","Move me to the 18:35 on Thursday","What do my miles get me?"].map(s=>(
              <button key={s} onClick={()=>setInput(s)} className="text-[11px] px-2.5 py-1 rounded-full border text-gray-500 hover:bg-gray-50" style={{borderColor:"var(--tap-line)"}}>{s}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=>e.key==="Enter"&&send()}
              placeholder="Ask anything about your trip…" className="flex-1 px-4 py-2.5 rounded-xl border text-sm outline-none" style={{borderColor:"var(--tap-line)"}}/>
            <PrimaryBtn onClick={send} disabled={busy} className="!px-4 !py-2.5"><Send size={15}/></PrimaryBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── AIRPORT AUTOCOMPLETE ── */
function AirportInput({ label, value, onChange, icon }) {
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(async () => {
      const rows = await api.get(`/airports?q=${encodeURIComponent(q)}`);
      setOpts(rows);
    }, 120);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    const close = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const display = value ? `${cityName(value)} (${value})` : "";
  return (
    <div className="flex-1 min-w-[160px] relative" ref={boxRef}>
      <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1 mb-1">{icon}{label}</label>
      <input
        value={open ? q : display}
        onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="City or airport"
        className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none font-semibold"
        style={{ borderColor: "var(--tap-line)", color: "var(--tap-ink)" }}/>
      {open && opts.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg max-h-64 overflow-auto" style={{ borderColor: "var(--tap-line)" }}>
          {opts.map((a) => (
            <button key={a.code} onMouseDown={() => { onChange(a.code); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between">
              <span><span className="font-semibold text-sm" style={{ color: "var(--tap-ink)" }}>{a.city}</span> <span className="text-xs text-gray-400">{a.country}</span></span>
              <span className="text-xs font-bold text-gray-400">{a.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── SEARCH SCREEN — search any of the 100 network routes ── */
function SearchScreen({ origin, setOrigin, dest, setDest, date, setDate, onSearch, results, searching, selectFlight, routes, suggested, prefilledReason }) {
  const swap = () => { const o = origin; setOrigin(dest); setDest(o); };
  const [showAll, setShowAll] = useState(false);
  const DATES = [
    { v: "2026-06-15", label: "Mon 15 Jun 2026" },
    { v: "2026-06-16", label: "Tue 16 Jun 2026" },
    { v: "2026-06-18", label: "Thu 18 Jun 2026" },
    { v: "2026-06-22", label: "Mon 22 Jun 2026" },
    { v: "2026-06-29", label: "Mon 29 Jun 2026" },
  ];

  // Personalized first (scored from real history/searches/bookings), then network filler
  const personalized = suggested?.personalized || [];
  const filler = suggested?.filler || (routes || []);
  const list = showAll
    ? [...personalized, ...filler]
    : (personalized.length ? personalized.slice(0, 6) : filler.slice(0, 8));

  return (
    <div className="max-w-4xl mx-auto px-4 pb-24 pt-8">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="font-display font-black text-3xl" style={{ color: "var(--tap-ink)" }}>Search flights</h1>
        <Chip tone="green"><Globe size={11}/> {routes?.length || 100} routes worldwide · {routes?.filter(r => r.region === "Europe").length || 50} in Europe</Chip>
      </div>
      <p className="text-sm text-gray-500 mb-5">Every search is logged to the database and shapes what we recommend you next.</p>

      {prefilledReason && (
        <Card className="p-3 mb-4 flex items-center gap-2 slide-up" style={{ background: "#FBFDFC", borderColor: "var(--tap-green)" }}>
          <Sparkles size={15} style={{ color: "var(--tap-green)" }}/>
          <span className="text-sm" style={{ color: "var(--tap-deep)" }}><b>{cityName(origin)} → {cityName(dest)}</b> is pre-filled for you. Just pick a date and search.</span>
          <Why text={prefilledReason} className="ml-auto"/>
        </Card>
      )}

      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <AirportInput label="From" value={origin} onChange={setOrigin} icon={<MapPin size={11}/>}/>
          <button onClick={swap} className="mb-1 p-2.5 rounded-xl border hover:bg-gray-50 shrink-0" style={{ borderColor: "var(--tap-line)" }} aria-label="Swap"><ArrowLeftRight size={16} style={{ color: "var(--tap-green)" }}/></button>
          <AirportInput label="To" value={dest} onChange={setDest} icon={<MapPin size={11}/>}/>
          <div className="min-w-[150px]">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1 mb-1"><Calendar size={11}/>Date</label>
            <select value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-sm font-semibold bg-white outline-none cursor-pointer" style={{ borderColor: "var(--tap-line)", color: "var(--tap-ink)" }}>
              {DATES.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </div>
          <PrimaryBtn onClick={onSearch} disabled={searching || !origin || !dest} className="!py-2.5 mb-[1px]">
            {searching ? <Loader2 className="animate-spin" size={16}/> : <Search size={16}/>} Search
          </PrimaryBtn>
        </div>
      </Card>

      {searching && <div className="flex items-center gap-3 text-sm text-gray-500"><Loader2 className="animate-spin" size={16} style={{ color: "var(--tap-green)" }}/> Searching the network…</div>}

      {!searching && results && !results.ok && (
        <Card className="p-5 mb-6" style={{ borderColor: "var(--tap-red)", background: "#FFF6F7" }}>
          <div className="text-sm font-semibold" style={{ color: "var(--tap-red)" }}>{results.message}</div>
        </Card>
      )}

      {!searching && results && results.ok && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display font-extrabold text-lg" style={{ color: "var(--tap-ink)" }}>{cityName(results.origin)} → {cityName(results.dest)}</h2>
            <Chip tone="ink">{results.flights.length} flights · Mon 15 Jun</Chip>
          </div>
          <div className="space-y-3">
            {results.flights.map((f) => (
              <Card key={f.flight_no} className="ticket-edge p-0 overflow-hidden" style={f.recommended ? { boxShadow: "0 0 0 2px var(--tap-green)" } : {}}>
                <div className="p-4 flex flex-wrap items-center gap-4">
                  <div className="w-[84px]"><div className="text-xs font-bold text-gray-400">{f.flight_no}</div><div className="text-[11px] text-gray-400">{f.aircraft}</div></div>
                  <div className="flex-1 min-w-[200px]">
                    <RouteRibbon small from={`${f.origin} ${f.dep}`} to={`${f.dest} ${f.arr}`}/>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <Chip tone="ink">{f.duration}</Chip>
                      {!!f.recommended && <Chip tone="green"><Sparkles size={11}/> Recommended for you <Why text="This departure is closest to the time you usually fly this route, based on your travel history. If it's a new route, it's the earliest option — best for business arrivals."/></Chip>}
                      {!!f.lowest && <Chip tone="amber">Lowest fare</Chip>}
                      {f.seats_left < 15 && <Chip tone="red">{f.seats_left} seats left</Chip>}
                    </div>
                  </div>
                  <div className="text-right"><div className="font-display font-black text-2xl" style={{ color: "var(--tap-ink)" }}>{EUR(f.price)}</div></div>
                  <PrimaryBtn onClick={() => selectFlight(f)} className="!py-2.5">Select <ChevronRight size={15}/></PrimaryBtn>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-display font-extrabold text-lg" style={{ color: "var(--tap-ink)" }}>
            {personalized.length ? "Suggested for you" : "Popular routes"}
          </h2>
          <button onClick={() => setShowAll(!showAll)} className="text-xs font-bold" style={{ color: "var(--tap-green)" }}>{showAll ? "Show fewer" : `See all ${routes?.length || 100}`}</button>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {personalized.length ? "Ranked live from your flights, bookings and searches." : "Start searching — these adapt to your activity."}
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {list.map((r) => {
            const whyText = r.reasons && r.reasons.length
              ? `Ranked by your activity: ${r.reasons.join("; ")}. Score ${r.score}.`
              : `A popular ${r.destRegion} route from your home airport — shown because you don't have history here yet.`;
            return (
              <div key={`${r.origin}-${r.dest}`} className="relative p-3 rounded-xl border bg-white hover:shadow-sm transition-shadow flex items-center justify-between" style={{ borderColor: r.reason ? "var(--tap-green)" : "var(--tap-line)" }}>
                <button onClick={() => { setOrigin(r.origin); setDest(r.dest); onSearch(r.origin, r.dest); }} className="text-left min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" style={{ color: "var(--tap-ink)" }}>{r.originCity} → {r.destCity}</div>
                  {r.reason
                    ? <div className="text-[11px] font-semibold truncate" style={{ color: "var(--tap-green)" }}>{r.reason}</div>
                    : <div className="text-[11px] text-gray-400">{r.origin}–{r.dest} · {r.destRegion}</div>}
                </button>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <span className="text-sm font-bold" style={{ color: "var(--tap-green)" }}>{EUR(r.base_fare)}</span>
                  <Why text={whyText}/>
                </div>
              </div>
            );
          })}
          {list.length === 0 && <div className="text-sm text-gray-400 col-span-full py-4">Loading routes…</div>}
        </div>
      </div>
    </div>
  );
}

/* ── APP SHELL ── */
const STEPS = [
  { id: "home", label: "Search & Inspiration" },
  { id: "search", label: "Search flights" },
  { id: "flights", label: "Flight selection" },
  { id: "basket", label: "Basket" },
  { id: "checkout", label: "Checkout" },
  { id: "payment", label: "Payment" },
  { id: "manage", label: "Manage booking" },
  { id: "console", label: "🗄 Demo Console" },
];

function App() {
  const [screen, setScreen] = useState("login");
  const [profile, setProfile] = useState(null);
  const [flights, setFlights] = useState([]);
  const [ancillaries, setAncillaries] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [flight, setFlight] = useState(null);
  const [items, setItems] = useState([]);
  const [hold, setHold] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [activeDest, setActiveDest] = useState("LIS");
  // Flight search
  const [routes, setRoutes] = useState([]);
  const [suggested, setSuggested] = useState(null);
  const [searchOrigin, setSearchOrigin] = useState("OPO");
  const [searchDest, setSearchDest] = useState("LIS");
  const [searchDate, setSearchDate] = useState("2026-06-15");
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [prefilledReason, setPrefilledReason] = useState(null);

  const toast = (title, sub) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, title, sub }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 9000);
  };

  useEffect(() => {
    (async () => {
      const [p, f, a, d, b, ap, rt, sug] = await Promise.all([
        api.get("/profile"), api.get("/flights?dest=LIS"), api.get("/ancillaries"), api.get("/destinations"), api.get("/basket"),
        api.get("/airports"), api.get("/routes"), api.get("/routes/suggested"),
      ]);
      ap.forEach(x => { AIRPORT_MAP[x.code] = x; });   // populate city-name lookup
      setRoutes(rt); setSuggested(sug);
      setProfile(p); setFlights(f); setAncillaries(a); setDestinations(d);
      const rec = f.find(x => x.recommended) || f[0];
      if (b) { setFlight(f.find(x => x.flight_no === b.flight_no) || rec); setItems(b.items); }
      else { setFlight(rec); setItems(a.filter(x => x.auto).map(x => x.code)); }
    })();
  }, []);

  const refreshSuggested = async () => setSuggested(await api.get("/routes/suggested"));
  const refreshProfile = async () => setProfile(await api.get("/profile"));
  const go = (s) => { setScreen(s); window.scrollTo(0, 0); if (s === "home") refreshProfile(); if (s === "search") refreshSuggested(); };
  const selectFlight = async (f) => { setFlight(f); await api.post("/basket", { flight_no: f.flight_no, items }); go("basket"); };

  // Flight search — logs to DB, feeds personalization
  const runSearch = async (o, d) => {
    const origin = (typeof o === "string" ? o : searchOrigin);
    const dest = (typeof d === "string" ? d : searchDest);
    setSearching(true); setSearchResults(null); setPrefilledReason(null);
    const r = await api.get(`/search?origin=${origin}&dest=${dest}&date=${searchDate}`);
    setSearchResults(r); setSearching(false);
    if (r.ok) toast("Search logged to DB", `${cityName(origin)} → ${cityName(dest)} · ${r.flights.length} flights · feeds personalization`);
    refreshSuggested();   // searching this route nudges it up the suggested list
  };

  // Card tap → pre-fill the search with the route + the reason, let the user pick a date
  const bookDestination = (d) => {
    const code = d?.code || "LIS";
    setSearchOrigin(d?.origin || "OPO");
    setSearchDest(code);
    setSearchResults(null);
    setPrefilledReason(d?.reason || d?.reasons?.join("; ") || d?.tag || `Suggested route to ${cityName(code)}.`);
    go("search");
  };
  const bookUsual = async () => {
    const f = await api.get(`/flights?dest=LIS&origin=OPO`);
    setFlights(f);
    const usual = f.find(x => x.flight_no === (profile?.pattern?.topFlight)) || f.find(x => x.recommended) || f[0];
    await selectFlight(usual);   // straight to basket with the usual flight, the one-tap path
  };
  const toggleItem = async (code) => {
    const next = items.includes(code) ? items.filter(x => x !== code) : [...items, code];
    setItems(next);
    await api.post("/basket", { flight_no: flight.flight_no, items: next });
  };
  const onPaid = (r) => { setReceipt(r); refreshProfile(); go("confirmed"); };

  if (!profile || screen === "login")
    return (<><Fonts/><Login profile={profile} onLogin={() => go("home")}/><Toasts list={toasts} dismiss={(id)=>setToasts(t=>t.filter(x=>x.id!==id))}/></>);

  const stepIdx = STEPS.findIndex(s => s.id === (screen === "confirmed" ? "manage" : screen));

  return (
    <div className="min-h-screen" style={{background:"var(--tap-mist)"}}>
      <Fonts/>
      <header className="sticky top-0 z-40 bg-white border-b" style={{borderColor:"var(--tap-line)"}}>
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <button onClick={()=>go("home")}><TapLogo/></button>
          <nav className="hidden md:flex items-center gap-1 overflow-x-auto">
            {STEPS.map((s,i)=>(
              <button key={s.id} onClick={()=>go(s.id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${i===stepIdx?"text-white":"text-gray-500 hover:bg-gray-100"}`}
                style={i===stepIdx?{background: s.id==="console" ? "var(--tap-deep)" : "var(--tap-green)"}:{}}>
                {s.label}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-bold" style={{color:"var(--tap-ink)"}}>{profile.user.first_name}</div>
              <div className="text-[10px] text-gray-400">{profile.user.miles.toLocaleString()} miles</div>
            </div>
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-display font-extrabold text-white text-sm" style={{background:"var(--tap-deep)"}}>DF</div>
          </div>
        </div>
      </header>

      {screen === "home" && <Home profile={profile} destinations={destinations} go={go} openAssistant={()=>setAssistantOpen(true)} toast={toast} bookDestination={bookDestination} bookUsual={bookUsual}/>}
      {screen === "search" && <SearchScreen origin={searchOrigin} setOrigin={setSearchOrigin} dest={searchDest} setDest={setSearchDest} date={searchDate} setDate={setSearchDate} onSearch={runSearch} results={searchResults} searching={searching} selectFlight={selectFlight} routes={routes} suggested={suggested} prefilledReason={prefilledReason}/>}
      {screen === "flights" && <Flights flights={flights} pattern={profile.pattern} selectFlight={selectFlight} toast={toast}/>}
      {screen === "basket" && flight && <Basket flight={flight} ancillaries={ancillaries} items={items} toggleItem={toggleItem} go={go}/>}
      {screen === "checkout" && flight && <Checkout profile={profile} flight={flight} ancillaries={ancillaries} items={items} go={go} hold={hold} setHold={setHold} toast={toast}/>}
      {screen === "payment" && flight && <Payment profile={profile} flight={flight} ancillaries={ancillaries} items={items} onPaid={onPaid} toast={toast}/>}
      {screen === "confirmed" && receipt && <Confirmed profile={profile} flight={flight} receipt={receipt} go={go}/>}
      {screen === "manage" && <Manage profile={profile} flight={flight} openAssistant={()=>setAssistantOpen(true)} toast={toast} go={go}/>}
      {screen === "console" && <Console toast={toast}/>}

      <Assistant open={assistantOpen} onClose={()=>setAssistantOpen(false)} screen={screen}/>
      <Toasts list={toasts} dismiss={(id)=>setToasts(t=>t.filter(x=>x.id!==id))}/>

      <footer className="border-t py-4 text-center text-[11px] text-gray-400" style={{borderColor:"var(--tap-line)"}}>
        Demo · Reimagined pre-travel journey for Daniel, the Digital Commuter · Frontend + Express API + SQLite + Email + Claude
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App/>);
