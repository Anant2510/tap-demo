// FlyTAP v2 — booking spine rebuilt to the approved Figma: Cart (View & customize,
// 8 modules) → Passenger details (identity + travel doc + loyalty + GDPR consents)
// → Payment (card + secure banner + billing + grouped basket) → Confirmation.
// A booking completes for real via /api/pay (DB row + email + CDP "booked").
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE } from "./lib.js";
import { trip, tripTotals, toggleExtra, hasExtra, extrasByCategory, bundleSavings, setLeg, pingBasket, clearBasket, tripSnapshot, extrasBySource, SOURCE_META, SOURCE_ORDER } from "./trip.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, Img, imageFor, WhyChip, cx } from "./ui.jsx";

const EARN = (t) => Math.round(t * 2.88);
const BRL = (eur) => "R$ " + (eur * 5.39).toLocaleString("en-US", { maximumFractionDigits: 0 });
const CAT_ORDER = ["Hotels", "Cars & transfers", "Insurance", "Lounge & services", "Onboard", "Experiences", "Seats & baggage", "Carbon offset", "Extras"];
const CAT_TAG = { Hotels: "8 nights", "Cars & transfers": "", Insurance: "× 2", "Lounge & services": "", Experiences: "" };
const CAT_ICON = { Hotels: "home", "Cars & transfers": "arrow", Insurance: "shield", "Lounge & services": "star", Onboard: "bag", Experiences: "star", "Seats & baggage": "seat", "Carbon offset": "leaf", Extras: "cart" };
const CAT_SUB = { Hotels: "8 nights · 2 adults", "Cars & transfers": "Private sedan · 1-way", Insurance: "2 travelers", "Lounge & services": "Pre-flight · 2 adults", Onboard: "Both flights", Experiences: "2 travelers", "Seats & baggage": "Both flights", "Carbon offset": "This trip" };
const CAT_QTY = { Insurance: true, "Lounge & services": true, Experiences: true };

/* seed the default extras so the basket reads like the Figma. Each carries a source so the
   basket can classify them: system-recommended add-ons for Daniel's stopover + one auto-added
   default (insurance). Anything the member adds themselves comes in as source "user". */
function seedExtras() {
  if (trip.extras.length) return;
  [["hotel-memmo", "Hotel — Memmo Príncipe Real", 640, "Hotels", "recommended"], ["car-lis", "Airport transfer · LIS → hotel", 25, "Cars & transfers", "recommended"],
   ["ins-plus", "Travel Insurance · Plus × 2", 76, "Insurance", "auto"], ["lounge-opo", "TAP Lounge · OPO", 90, "Lounge & services", "recommended"],
   ["exp-belem", "Belém food walking tour", 130, "Experiences", "recommended"]].forEach(([code, name, price, cat, source]) => trip.extras.push({ code, name, price, qty: 1, cat, source }));
  pingBasket();
}

/* ── stepper ── */
const STEPS = ["Select flights", "View & customize cart", "My Trip Basket", "Passenger details", "Payment"];
const eur2 = (n) => n == null ? "—" : `€${Number(n).toFixed(2)}`;
const eurC = (n) => `€${Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Stepper({ active }) {
  return (
    <div className="bg-surface border-b border-line">
      <div className="mx-auto max-w-page px-6 py-4 flex items-center gap-2 overflow-x-auto v2-track text-[13px] font-semibold whitespace-nowrap">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <span className={cx("shrink-0 flex items-center gap-1.5", i < active ? "text-tap-greenDeep" : i === active ? "text-ink font-bold" : "text-ink-faint")}>
              <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]", i < active ? "bg-tap-green text-white" : i === active ? "bg-lime-tint text-tap-greenDeep ring-1 ring-lime" : "bg-surface-mute text-ink-faint")}>{i < active ? "✓" : i + 1}</span>{s}
            </span>
            {i < STEPS.length - 1 && <span className={cx("flex-1 min-w-[14px] h-0.5 rounded-full", i < active ? "bg-ink-700" : "bg-line-strong")} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
const Chip = ({ children, dot }) => <span className="px-3 py-1.5 rounded-full bg-surface border border-line text-[12px] font-semibold inline-flex items-center gap-1.5">{dot && <span className="w-1.5 h-1.5 rounded-full bg-lime" />}{children}</span>;
const Req = () => <span className="text-tap-red">*</span>;

/* ── basket summary (right rail) — grouped by category like the Figma ── */
function BasketSummary({ step, cta, onCta, disabled, secondary, onSecondary, note, milesSwitch, onMilesSwitch, basket, user, onClear }) {
  const t = tripTotals();
  const u = milesSwitch || {};
  const tier = u.tier || user?.tier || "Gold";
  const firstName = user?.first_name || (user?.name || "").split(" ")[0] || "there";
  const milesNeeded = Math.round(t.total * 0.9 / MILES_RATE);
  const milesTax = Math.round(t.total * 0.1);
  const showMiles = !basket && (!!user || !!milesSwitch);
  const groups = extrasBySource();
  const lastCode = trip.extras[trip.extras.length - 1]?.code;
  return (
    <aside className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="text-[17px] font-bold">{basket ? "Basket summary" : "My trip basket"}</div><span className="w-5 h-5 rounded-full bg-tap-red text-white text-[11px] font-bold inline-flex items-center justify-center">{trip.extras.length + 1}</span></div>{basket ? <Pill tone="slate">EUR</Pill> : <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-tap-red text-white">Step {step}/5</span>}</div>
        <div className="text-[11px] text-ink-faint mt-0.5">{trip.origin}–{trip.dest} · {trip.pax} adult{trip.pax > 1 ? "s" : ""} · {fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</div>

        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint mt-3 mb-0.5">Anchor · Locked in from Step 1</div>
          <SummaryItem icon="plane" name={`Flights · ${trip.origin}–${trip.dest}`} sub={`${trip.outbound?.flight?.flight_no || ""}${trip.inbound ? " / " + trip.inbound.flight.flight_no : ""} · ${trip.outbound?.fare || "Classic"}`} price={t.flights} qty={`${trip.pax} traveler${trip.pax > 1 ? "s" : ""}`} />
          {SOURCE_ORDER.filter(s => groups[s] && groups[s].length).map(s => (
            <div key={s} className="mt-3">
              <div className="flex items-center justify-between mb-0.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{SOURCE_META[s].label} · {groups[s].length}</div>
                <span className={cx("inline-flex items-center text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full", s === "user" ? "bg-lime text-ink" : s === "recommended" ? "bg-tap-green/10 text-tap-greenDeep" : "bg-surface-mute text-ink-muted")}>{SOURCE_META[s].tag}</span>
              </div>
              {groups[s].map(e => <SummaryItem key={e.code} icon={CAT_ICON[e.cat] || "cart"} name={e.name} sub={CAT_SUB[e.cat] || e.cat} price={e.price} qty={CAT_QTY[e.cat] ? `× ${trip.pax}` : ""} isNew={e.code === lastCode && e.source === "user"} />)}
            </div>
          ))}
          {onClear && trip.extras.length > 0 && <button onClick={onClear} className="mt-2 text-[11px] font-semibold text-ink-muted hover:text-tap-red inline-flex items-center gap-1"><Icon name="x" size={11} /> Clear basket</button>}
          <div className="mt-2.5 space-y-1 text-[12px]">
            <div className="flex items-center justify-between"><span className="text-ink-muted">Subtotal extras</span><span className="font-semibold v2-num text-ink">{eur2(t.extras)}</span></div>
            <div className="flex items-center justify-between"><span className="text-ink-muted">Taxes & fees</span><span className="font-semibold v2-num text-ink">{eur2(t.taxes)}</span></div>
            {t.bundle > 0 && <div className="flex items-center justify-between"><span className="text-tap-greenDeep font-semibold flex items-center gap-1"><Icon name="spark" size={12} /> Bundle savings</span><span className="font-semibold v2-num text-tap-greenDeep">−{eur2(t.bundle)}</span></div>}
          </div>
        </div>

        <Divider className="my-3.5" />
        <div className="flex items-end justify-between"><div><div className="text-[13px] text-ink font-bold">{step === 2 ? "Subtotal" : "Total"} <span className="text-ink-muted font-medium">(in EUR)</span></div><div className="text-[10px] text-ink-muted">{step === 2 ? "No charge yet" : "One-time charge · taxes included"}</div></div><div className="text-right"><div className="text-[24px] font-black v2-num text-ink">{eurC(t.total)}</div><div className="text-[10px] text-ink-faint v2-num">≈ {BRL(t.total)}</div></div></div>
        <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Icon name="plane" size={12} /> You'll earn</span><span className="v2-num">{miles(EARN(t.total))} tap.miles</span></div>

        <Btn size="lg" className="w-full mt-4" disabled={disabled} onClick={onCta}>{cta}</Btn>
        {step === 2 && <div className="text-[11px] text-ink-muted text-center mt-2 flex items-center justify-center gap-1"><Icon name="globe" size={11} className="text-ink-faint" /> You'll be able to adjust all items on the next step.</div>}
        {note && <div className="text-[11px] text-ink-faint text-center mt-2">{note}</div>}
        {secondary && <button onClick={onSecondary} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:border-tap-green inline-flex items-center justify-center gap-1.5">{secondary} <Icon name="arrow" size={13} /></button>}
      </Card>

      {showMiles && (
        <div className="rounded-2xl p-4 text-white shadow-card" style={{ background: "linear-gradient(135deg, #14331a, #2e7d33)" }}>
          <div className="flex items-center gap-2"><Pill tone="gold">{tier}</Pill> <span className="text-[14px] font-bold">Hi {firstName} — pay with miles?</span></div>
          <div className="text-[12px] text-white/85 mt-1.5">Cover this trip with <span className="font-bold text-white v2-num">{miles(milesNeeded)} TAP miles</span> + <span className="font-bold text-white v2-num">{EUR(milesTax)}</span> in taxes.</div>
          <button onClick={onMilesSwitch || (() => { })} className="mt-3 w-full rounded-xl bg-white/10 border border-white/20 py-2.5 text-[13px] font-semibold inline-flex items-center justify-between px-4 hover:bg-white/15"><span>Compare cash vs miles</span><Icon name="arrow" size={14} /></button>
        </div>
      )}

      <Card className="p-4 space-y-2.5 text-[12px]">
        {[["lock", "PCI-DSS Level 1", "Stripe encrypts & tokenises every card."], ["clock", "Free 24h cancellation", "Full refund on flights & most extras."], ["star", "24/7 voa Care", "WhatsApp · phone · live chat."], ["check", "Confirmation in seconds", "E-ticket sent to your inbox."]].map(([ic, a, b]) => (
          <div key={a} className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name={ic} size={15} /></span><div><div className="font-semibold">{a}</div><div className="text-ink-faint">{b}</div></div></div>
        ))}
      </Card>
      <div className="rounded-xl bg-surface-dark text-white p-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-md bg-[#635bff] inline-flex items-center justify-center text-[11px] font-bold">S</span><div><div className="text-[12px] font-semibold">Verified by Stripe</div><div className="text-[10px] text-white/50">Trusted by millions of businesses.</div></div></div><span className="text-[11px] text-lime font-semibold">Learn more →</span></div>
    </aside>
  );
}
const SummaryItem = ({ icon, name, sub, price, qty, isNew }) => (
  <div className={cx("flex items-center gap-3 py-2.5 border-b border-line last:border-0", isNew && "bg-lime-tint/50 -mx-2 px-2 rounded-lg border-0")}>
    <span className="w-8 h-8 rounded-lg bg-surface-mute inline-flex items-center justify-center shrink-0 text-ink-muted"><Icon name={icon} size={16} /></span>
    <div className="flex-1 min-w-0"><div className="text-[12.5px] font-semibold flex items-center gap-1.5 truncate">{name}{isNew && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded bg-lime text-ink shrink-0">New</span>}</div><div className="text-[10px] text-ink-faint truncate">{sub}</div></div>
    <div className="text-right shrink-0"><div className="text-[12.5px] font-bold v2-num">{eur2(price)}</div>{qty && <div className="text-[9px] text-ink-faint v2-num">{qty}</div>}</div>
  </div>
);

const noTrip = (go) => <div className="mx-auto max-w-content px-6 py-16"><Card className="p-10 text-center"><div className="text-[18px] font-bold">Your cart is empty</div><div className="text-[13px] text-ink-muted mt-2">Search and pick a flight to start a booking.</div><Btn className="mt-4" onClick={() => go("home")}>Start a search →</Btn></Card></div>;

/* ── flight summary ── */
function FlightSummary({ go }) {
  const o = trip.outbound, i = trip.inbound; if (!o) return null;
  const Leg = ({ label, c, date }) => c && (
    <div className="py-2"><div className="flex items-center gap-3 mb-1"><span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{label} · {fmtDate(date).replace(/(\w+) (\d+) \d+/, "$1 $2")}</span><span className="text-[11px] text-ink-faint">{c.flight.flight_no} · {c.flight.aircraft}</span></div>
      <div className="flex flex-wrap items-center gap-4"><div><div className="text-[20px] font-bold v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin}</div></div><div className="flex-1 min-w-[120px] text-center text-[11px] text-ink-muted">{c.flight.duration} · Nonstop · Direct<div className="h-px bg-line-strong my-1" /></div><div className="text-right"><div className="text-[20px] font-bold v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div></div>
    </div>
  );
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2"><span className="text-tap-green font-black">TAP</span><Pill tone="slate">{o.fare} · Economy</Pill><Pill tone="lime">Stopover included</Pill></div><button className="text-[12px] font-semibold text-tap-greenDeep" onClick={() => go("results", { origin: trip.origin, dest: trip.dest, date: trip.date, ret: trip.ret, type: trip.type })}>Change flight</button></div>
      <Leg label="Outbound" c={o} date={trip.date} /><Divider /><Leg label="Inbound" c={i} date={trip.ret} />
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-3 text-[11px] text-ink-muted"><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> 1× carry-on (8kg)</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> 1× checked bag (23kg)</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> Seat selection</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> Changes for fee</span><span className="ml-auto text-ink-faint">BOOKING REF · PENDING</span></div>
    </Card>
  );
}

/* ── module shell ── */
function Module({ n, kicker, title, sub, right, badge, children, icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3"><span className="shrink-0 w-9 h-9 rounded-lg bg-surface-mute text-ink-faint inline-flex items-center justify-center text-[12px] font-bold">{icon ? <Icon name={icon} size={18} className="text-tap-greenDeep" /> : n}</span>
          <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{icon ? `${n} · ${kicker}` : kicker}</div><div className="font-bold text-[16px] flex items-center gap-2">{title}{badge && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-lime text-ink"><Icon name="check" size={10} /> {badge}</span>}</div>{sub && <div className="text-[12px] text-ink-muted mt-0.5">{sub}</div>}</div>
        </div>{right}
      </div>
      <div className="h-px bg-line -mx-5 mb-4" />
      {children}
    </Card>
  );
}

/* ═══════════ CART · View & customize (8 modules) ═══════════ */
function CartView({ go, mode = "cart", shared }) {
  const isBasket = mode === "basket";
  const [, force] = useState(0); const r = () => force(x => x + 1);
  const [carbonOn, setCarbonOn] = useState(true);
  // Don't re-seed a recommended basket if the member explicitly cleared it last time; an open
  // saved basket has already been restored on login, so seedExtras() is a no-op in that case.
  useEffect(() => { if (trip.outbound && shared?.basket?.status !== "cleared") seedExtras(); r(); }, []);
  if (!trip.outbound) return noTrip(go);
  const save = () => api.post("/basket", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code), snapshot: tripSnapshot() }).catch(() => {});
  const add = (code, name, price, cat) => { toggleExtra({ code, name, price, cat }); save(); r(); };
  const clear = () => { clearBasket(); api.post("/basket/clear", { flight_no: trip.outbound?.flight?.flight_no }).catch(() => {}); r(); };
  const seat = trip.extras.find(e => e.cat === "Seats & baggage");

  const SeatType = ({ code, name, sub, price }) => {
    const on = code === "std" ? !seat : hasExtra(code);
    return <button onClick={() => { if (seat) toggleExtra(seat); if (code !== "std") toggleExtra({ code, name, price, cat: "Seats & baggage" }); r(); }} className={cx("flex-1 text-left rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line")}>
      <div className="rounded-xl border border-line bg-surface p-3 mb-3 flex justify-center gap-1.5">{[0, 1, 2, 3, 4].map(i => { const yours = on && i === 2; const free = on && code !== "std" && i === 3; return <span key={i} className={cx("w-6 h-6 rounded", yours ? "bg-lime" : free ? "bg-lime/40" : "bg-surface-mute")} />; })}</div>
      <div className="flex items-center gap-2">
        <span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span>
        <span className="text-[13px] font-semibold flex-1">{name}</span>
        {price ? <span className="text-[13px] font-bold v2-num">{eur2(price)}</span> : <span className="text-[13px] font-semibold text-tap-greenDeep">Included</span>}
      </div>
      <div className="text-[11px] text-ink-faint mt-1 pl-6">{sub}</div>
    </button>;
  };
  const Bag = ({ code, name, sub, price, locked }) => { const on = locked || hasExtra(code); return (
    <label className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line", locked && "opacity-90")}>
      <input type="checkbox" checked={on} disabled={locked} onChange={() => !locked && add(code, name, price, "Seats & baggage")} className="accent-[#46a41a]" />
      <div className="flex-1"><div className="text-[13px] font-semibold">{name} {locked && <Pill tone="green">Included</Pill>}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
      <div className="text-right"><div className="text-[13px] font-bold v2-num">{locked ? "Included" : eur2(price)}</div>{!locked && <div className="text-[10px] text-ink-faint">per bag · per flight</div>}</div>
    </label>
  ); };
  const HotelRow = ({ code, name, stars, tags, rating, reviews, pn, total, rec }) => { const on = hasExtra(code); return (
    <div className={cx("flex gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
      <Img seed={"hotel-" + code} src={imageFor("hotel-" + code)} alt={name} className="w-20 h-16 rounded-lg shrink-0" />
      <div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-[14px] font-bold">{name}</span><span className="text-[#E8C75A]">{"★".repeat(stars)}</span>{rec && <Pill tone="lime">Recommended</Pill>}</div>
        <div className="flex flex-wrap gap-1 mt-1">{tags.map(t => <Pill key={t} tone="slate">{t}</Pill>)}</div>
        <div className="text-[11px] text-ink-muted mt-1">★ {rating} Excellent · {reviews} reviews</div></div>
      <div className="text-right"><div className="text-[13px] font-bold v2-num">From {EUR(pn)}<span className="text-[11px] font-medium text-ink-faint">/night</span></div><div className="text-[11px] text-ink-faint v2-num">{EUR(total)} total</div><Btn size="sm" variant={on ? "outline" : "primary"} className="mt-1.5" onClick={() => add(code, name, total, "Hotels")}>{on ? "✓ Added" : "Add to cart"}</Btn></div>
    </div>
  ); };
  const Row = ({ code, name, sub, price, unit, cat, tag }) => { const on = hasExtra(code); return (
    <div className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
      <Toggle on={on} set={() => add(code, name, price, cat)} />
      <div className="flex-1"><div className="text-[13px] font-semibold flex items-center gap-2">{name}{tag && <Pill tone="slate">{tag}</Pill>}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
      <div className="text-right"><div className="text-[13px] font-bold v2-num">{eur2(price)}</div>{unit && <div className="text-[10px] text-ink-faint">{unit}</div>}</div>
    </div>
  ); };
  const Plan = ({ code, name, kicker, price, total, points, sel, badge, proceed }) => {
    const isPlus = code === "ins-plus";
    const on = isPlus ? hasExtra("ins-plus") : !hasExtra("ins-plus");
    const handle = () => {
      if (isPlus) { if (!hasExtra("ins-plus")) add("ins-plus", "Travel Insurance · Plus × 2", 76, "Insurance"); }
      else { const e = trip.extras.find(x => x.code === "ins-plus"); if (e) { toggleExtra(e); api.post("/basket", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(x => x.code) }).catch(() => {}); r(); } }
    };
    return (
      <div className={cx("flex-1 rounded-xl border p-4 flex flex-col", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line")}>
        <button onClick={handle} className="flex items-start gap-2.5 text-left w-full">
          <span className={cx("mt-0.5 w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2"><div className="text-[15px] font-bold leading-tight">{name}</div>{badge && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-surface-dark text-white">{badge}</span>}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint mt-0.5">{kicker}</div>
          </div>
        </button>
        <ul className="mt-3 space-y-1.5 text-[12px] flex-1">{points.map(([ok, p]) => <li key={p} className={cx("flex items-center gap-2", !ok && "text-ink-faint")}><Icon name={ok ? "check" : "x"} size={13} className={ok ? "text-tap-green" : "text-ink-faint"} /> {p}</li>)}</ul>
        {price != null
          ? <><div className="h-px bg-line my-3" /><div className="flex items-end justify-between"><div className="text-[18px] font-bold v2-num">{eur2(price)}<span className="text-[10px] font-medium text-ink-faint"> per traveler</span></div>{total != null && <div className="text-right"><div className="text-[14px] font-bold v2-num text-tap-greenDeep">{eur2(total)}</div><div className="text-[9px] uppercase tracking-wide text-ink-faint">Total · {trip.pax || 2} adults</div></div>}</div></>
          : proceed && <><div className="h-px bg-line my-3" /><button onClick={handle} className={cx("w-full rounded-full border py-2 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5", on ? "border-tap-green text-tap-greenDeep bg-surface" : "border-line text-ink-muted hover:border-tap-green")}><span className="text-[15px] leading-none">+</span> Proceed without insurance</button></>}
      </div>
    );
  };

  return (
    <div className="bg-surface-soft min-h-screen">
      {isBasket
        ? <div className="mx-auto max-w-page px-6 pt-5 text-[12px] text-ink-faint"><button onClick={() => go("home")} className="hover:text-ink">Homepage</button> › <span className="text-ink-muted">My trip basket</span></div>
        : <Stepper active={1} />}
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">{isBasket ? "My trip basket" : "View & customize cart"}</h1><Pill tone="slate">{isBasket ? `${trip.extras.length + 1} items` : "8 modules"}</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">{isBasket ? "Review and customize everything you've added to your trip before checkout." : "Choose hotels, transfers, protection and experiences to complete your trip. Everything you add flows into your cart."}</p>
        <div className="flex flex-wrap gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adult{trip.pax > 1 ? "s" : ""}</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>All extras optional</Chip></div>
        {isBasket && <div className="mt-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-[12px] flex items-center gap-2 flex-wrap"><Pill tone="lime">Pinned</Pill><span className="font-semibold">Your core flight stays in the basket</span><span className="text-ink-faint">— extras below are optional and can be removed.</span></div>}

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            <Module n="01" icon="seat" kicker="Seats & baggage" title="Seats & baggage" sub="Pick where you sit and what you bring.">
              <div className="flex items-center justify-between mb-2"><Eyebrow>Choose your seat type · per passenger · both flights</Eyebrow><button className="text-[12px] font-semibold text-tap-greenDeep shrink-0">Full Cabin View</button></div>
              <div className="flex flex-col sm:flex-row gap-3"><SeatType code="std" name="Standard" sub="Standard 78cm pitch · auto-assigned" /><SeatType code="seat-nsf" name="Next Seat Free" sub="+10cm legroom · exit-row seats" price={48} /><SeatType code="seat-win" name="Window+" sub="Window + free middle + legroom" price={68} /></div>
              <Eyebrow className="mt-4 mb-2">Baggage · what's included with Classic fare</Eyebrow>
              <div className="space-y-2"><Bag name="Carry-on bag · 8kg" sub="1 piece per traveller · 55×40×20 cm" locked /><Bag name="Checked bag · 23kg" sub="1 piece per traveller · Classic fare" locked /><Bag code="bag-extra" name="Extra checked bag · 23kg" sub="Add a 2nd bag · saves €15 vs airport" price={55} /></div>
            </Module>

            <Module n="02" icon="leaf" kicker="Carbon offset" title="Carbon offset" sub="Auto-checked · uncheck if you wish" right={<div className="text-right"><span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[#fff4d6] text-[#9a6b00]">Opt-out</span><div className="text-[10px] text-tap-greenDeep font-semibold mt-1">Default ON in EU (climate)</div></div>}>
              <label className={cx("flex items-center gap-3 rounded-xl border p-3", carbonOn ? "border-tap-green bg-lime-tint/40" : "border-line")}>
                <span className={cx("w-5 h-5 rounded-md border-2 inline-flex items-center justify-center shrink-0 cursor-pointer", carbonOn ? "bg-tap-green border-tap-green text-white" : "bg-surface border-line-strong text-transparent")} onClick={() => setCarbonOn(v => !v)}><Icon name="check" size={13} className="stroke-[3]" /></span>
                <div className="flex-1 text-[13px] font-semibold">{carbonOn ? "Auto-added" : "Offset this trip's emissions"}</div>
                <div className="text-[13px] font-bold v2-num">{eur2(10)}</div>
              </label>
            </Module>

            <Module n="03" kicker="Hotels" title="Stay in Lisbon" badge="1 added" sub="Recommended hotels for your dates." right={<button className="text-[12px] font-semibold text-tap-greenDeep">View all hotels →</button>}>
              <div className="space-y-2">
                <HotelRow code="hotel-memmo" name="Memmo Príncipe Real" stars={4} tags={["Near city centre", "Free cancellation", "Breakfast"]} rating="9.2" reviews="1,284" pn={80} total={640} rec />
                <HotelRow code="hotel-bairro" name="Bairro Alto Suites" stars={4} tags={["City centre", "Free cancellation"]} rating="8.7" reviews="962" pn={68} total={544} />
                <HotelRow code="hotel-quinta" name="Quinta da Marinha · Cascais" stars={4} tags={["Beach", "Pool", "Resort"]} rating="9.0" reviews="538" pn={120} total={960} />
              </div>
            </Module>

            <Module n="04" kicker="Cars & transfers" title="Getting to and from the airport" badge="1 added" sub="Pick how you move between LIS and your hotel.">
              <div className="space-y-2">
                <Row code="car-lis" name="Private transfer · LIS → hotel" sub="Sedan · meet & greet · up to 3 bags" price={25} unit="per car" cat="Cars & transfers" tag="1-way" />
                <Row code="car-shuttle" name="Shared shuttle" sub="8-seat van · scheduled · 30 min wait max" price={30} unit="2 × €15" cat="Cars & transfers" tag="per person" />
                <Row code="car-rental" name="Car rental from LIS" sub="Compact, automatic · free 24h cancellation" price={320} unit="8 days × €40" cat="Cars & transfers" tag="per day" />
              </div>
            </Module>

            <Module n="05" icon="shield" kicker="Insurance" title="Protect your trip" badge="Plus · 2 pax" sub="Choose a plan that covers cancellation, medical, and baggage.">
              <div className="flex flex-col sm:flex-row gap-3"><Plan code="ins-none" name="I already have coverage" kicker="My travel insurance is sorted" proceed points={[[true, "Health coverage"], [true, "Trip cancellation protection"], [true, "Baggage loss"], [false, "COVID-19 protection"], [false, "24/7 support service"]]} /><Plan code="ins-plus" name="Plus" kicker="Comprehensive cover" badge="Recommended" price={38} total={76} sel points={[[true, "Medical · €50K"], [true, "Trip cancellation"], [true, "Lost baggage"], [true, "COVID-19 cover"], [true, "24/7 concierge"]]} /></div>
            </Module>

            <Module n="06" kicker="Lounge & priority" title="Relax and skip the queues" badge="TAP Lounge +2" sub="Quality time before the flight — drinks, food, fast-track lanes.">
              <div className="space-y-2">
                <Row code="lounge-opo" name="TAP Lounge · OPO" sub="Hot meals · drinks · showers · Wi-Fi · up to 3h pre-flight" price={90} cat="Lounge & services" tag="OPO outbound" />
                <Row code="priority" name="Priority boarding" sub="Skip the queue · board first · stow your bag first" price={16} cat="Lounge & services" tag="both flights" />
                <Row code="fasttrack" name="Fast-track security · LIS arrival" sub="Dedicated immigration lane on arrival in Lisbon" price={18} cat="Lounge & services" tag="LIS arrival" />
              </div>
            </Module>

            <Module n="07" kicker="Meals" title="Meals & onboard extras" sub="Pick a meal for each traveller. We confirm 24h before departure.">
              <div className="grid sm:grid-cols-4 gap-3">
                {[["Standard meal", "Chef-curated 3-course", true, 0], ["Vegetarian", "Plant-based · seasonal", false, 0], ["Premium meal", "Tasting menu", false, 28], ["Skip meal", "No meal · sleep", false, 0]].map(([n, s, sel, p], i) => {
                  const on = p ? hasExtra("meal-prem") : (i === 0 ? !hasExtra("meal-prem") : false);
                  return <button key={n} onClick={() => p && add("meal-prem", "Premium meal × 2", 56, "Onboard")} className={cx("text-left rounded-xl border p-3 flex flex-col", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line")}><div className="flex items-start justify-between gap-2"><div className="text-[13px] font-bold">{n}</div><span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span></div><div className="text-[10px] text-ink-faint flex-1 mt-0.5">{s}</div><div className="h-px bg-line my-2" /><div className="text-[11px] font-semibold">{p ? <span className="v2-num">{eur2(p)} <span className="text-[10px] text-ink-faint font-normal">per pax</span></span> : <span className="text-tap-greenDeep">Included</span>}</div></button>;
                })}
              </div>
            </Module>

            <Module n="08" kicker="Experiences" title="Experiences in Portugal" badge="1 added" sub="Curated tours and tastings for your dates. Skip the lines.">
              <div className="grid sm:grid-cols-3 gap-3">
                {[["exp-belem", "Belém food walking tour", "3h · pastéis de Belém · small group · English guide", 65, "Experience"], ["exp-sintra", "Sintra full-day", "Pena Palace · Quinta da Regaleira · Cabo da Roca", 89, "Day trip · popular"], ["exp-douro", "Douro Valley wine tour", "Vineyards · tastings · river cruise · full day", 120, "Wine"], ["exp-fado", "Fado night experience", "Traditional Portuguese music · 3-course dinner · port wine", 75, "Night out"], ["exp-surf", "Surf lesson · Cascais", "2h · gear included · beginners welcome", 55, "Outdoor"], ["exp-train", "Lisbon–Porto train", "2h45 · 1st class · day-trip ready", 39, "Excursion"]].map(([code, name, sub, price, tag]) => {
                  const on = hasExtra(code); const tot = price * (trip.pax || 2);
                  const parts = String(tag).split("·").map(s => s.trim()); const popular = parts.some(p => /popular/i.test(p)); const catLabel = parts.filter(p => !/popular/i.test(p)).join(" · ") || parts[0];
                  return <div key={code} className={cx("rounded-xl border overflow-hidden", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line")}><Img seed={"exp-" + code} src={imageFor(code)} alt={name} className="h-20 w-full" /><div className="p-3"><div className="flex items-center gap-1.5"><Pill tone="slate">{catLabel}</Pill>{popular && <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-surface-dark text-lime">Popular</span>}</div><div className="text-[13px] font-bold mt-1">{name}</div><div className="text-[10px] text-ink-faint">{sub}</div><div className="flex items-end justify-between mt-2 gap-2"><div><div className="text-[14px] font-bold v2-num">{eur2(price)}</div><div className="text-[10px] text-ink-faint">per person</div>{on && <div className="text-[10px] text-ink-faint v2-num">× {trip.pax || 2} = {eur2(tot)}</div>}</div><Btn size="sm" variant="outline" className="shrink-0" onClick={() => add(code, name, price * (trip.pax || 2), "Experiences")}>{on ? "✓ Added" : "+ Add to cart"}</Btn></div></div></div>;
                })}
              </div>
            </Module>
          </div>
          {isBasket
            ? <BasketSummary basket onClear={clear} cta={`Checkout and pay ${EUR(tripTotals().total)}`} onCta={() => go("payment")} secondary="Continue browsing flights" onSecondary={() => go("home")} note="Price locked for 15 min · free 24h cancellation" />
            : <BasketSummary step={2} user={shared?.profile?.user} onClear={clear} onMilesSwitch={() => go("payment")} cta="Review my trip basket →" onCta={() => go("passenger")} secondary="Skip extras & continue with flights only" onSecondary={() => go("passenger")} />}
        </div>
      </div>
    </div>
  );
}

// Two journeys share the same trip + modules:
//  • Cart   — step 3 of the linear booking flow → continues to passenger details.
//  • Basket — the persistent basket opened from the nav → checks out & pays directly.
export function Cart(props) { return <CartView {...props} mode="cart" />; }
export function Basket(props) { return <CartView {...props} mode="basket" />; }

/* ═══════════ PASSENGER DETAILS ═══════════ */
function PaxCard({ idx, lead, prefill }) {
  const [p, setP] = useState(prefill || {});
  const [saveDoc, setSaveDoc] = useState(true);
  const f = (k) => ({ value: p[k] || "", onChange: e => { const v = { ...p, [k]: e.target.value }; setP(v); trip.passengers[idx] = v; } });
  useEffect(() => { trip.passengers[idx] = p; }, []);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{(p.first || "P")[0]}{(p.last || String(idx + 1))[0]}</span>
          <div><div className="font-bold text-[15px] flex items-center gap-2">Passenger {idx + 1}{p.first ? " · " + p.first + " " + (p.last || "") : " · Add details"}<Pill tone="slate">Adult</Pill>{lead && <Pill tone="gold">{prefill.tier}</Pill>}</div><div className="text-[11px] text-ink-faint">{lead ? "Lead traveler · contact for this booking" : "Required to issue ticket"}</div></div></div>
        <div className="flex items-center gap-2"><button className="text-[12px] font-semibold text-tap-greenDeep flex items-center gap-1"><Icon name="refresh" size={12} /> Prefill from profile</button><button className="text-[12px] text-ink-faint">Remove</button></div>
      </div>
      <Eyebrow className="mb-2">Identity · as shown on passport</Eyebrow>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={<>Title <Req /></>}><Input {...f("title")} placeholder="Ms" /></Field>
        <Field label={<>First / middle names <Req /></>}><Input {...f("first")} /></Field>
        <Field label={<>Last name <Req /></>}><Input {...f("last")} /></Field>
        <Field label={<>Date of birth <Req /></>}><Input {...f("dob")} placeholder="DD / MM / YYYY" /></Field>
        <Field label={<>Gender <Req /></>}><Input {...f("gender")} placeholder="Female" /></Field>
        <Field label={<>Nationality <Req /></>}><Input {...f("nat")} /></Field>
      </div>
      <div className="flex items-center gap-1.5 mt-4 mb-2"><Eyebrow>Travel document</Eyebrow><Icon name="info" size={12} className="text-ink-faint" /><span className="text-[11px] text-ink-faint">Required to issue your boarding pass</span></div>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={<>Document type <Req /></>}><Input {...f("doctype")} placeholder="Passport" /></Field>
        <Field label={<>Document number <Req /></>}><Input {...f("doc")} /></Field>
        <Field label={<>Country of issue <Req /></>}><Input {...f("docctry")} placeholder="Brazil" /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-4 mt-3">
        <Field label={<>Expiry date <Req /></>} className="w-44"><Input {...f("docexp")} placeholder="DD / MM / YYYY" /></Field>
        <label className="flex items-center gap-2 text-[12px] text-ink-muted pb-2.5"><input type="checkbox" checked={saveDoc} onChange={e => setSaveDoc(e.target.checked)} className="accent-[#46a41a]" /> Save this document to my voa profile <span className="text-ink-faint">· encrypted</span></label>
      </div>
      <Eyebrow className="mt-4 mb-2">Loyalty · optional — earn miles on this trip</Eyebrow>
      {lead
        ? <div className="rounded-lg bg-lime-tint text-tap-greenDark px-3 py-2.5 flex items-center justify-between text-[12px]"><span className="flex items-center gap-2"><Icon name="plane" size={13} /> <b>TAP.miles applied</b> · {prefill.member} · {prefill.tier} tier — you'll earn {miles(prefill.earn || 2416)} tap.miles on this trip.</span><button className="font-semibold">Edit</button></div>
        : <div className="grid sm:grid-cols-[160px_1fr_auto] gap-3 items-end"><Field label="Program"><Input defaultValue="TAP.miles" /></Field><Field label="Membership number"><Input placeholder="Add Miles&Go number (optional)" /></Field><Btn variant="outline" size="sm">Apply membership</Btn></div>}
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-line"><div><div className="text-[13px] font-semibold">Special requests <span className="text-ink-faint font-normal">· optional</span></div><div className="text-[11px] text-ink-faint">Wheelchair, special meals, dietary preferences, traveling with a pet…</div></div><button className="text-[12px] font-semibold text-tap-greenDeep">Add request ▾</button></div>
    </Card>
  );
}
const Toggle = ({ on, set }) => <button onClick={() => set(!on)} className={cx("w-11 h-6 rounded-full relative transition-colors", on ? "bg-lime" : "bg-surface-mute")}><span className={cx("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", on ? "right-0.5" : "left-0.5")} /></button>;

export function Passenger({ shared, go }) {
  if (!trip.outbound) return noTrip(go);
  seedExtras();
  const u = shared.profile?.user || {};
  const last = (u.full_name || "").replace(u.first_name || "", "").trim() || "Silva";
  const p1 = { title: u.gender === "Female" ? "Ms" : "Mr", first: u.first_name, last, dob: u.dob, gender: u.gender, nat: u.nationality, doctype: "Passport", doc: u.doc_id, docctry: u.nationality === "Portuguese" ? "Portugal" : "Brazil", docexp: "22 / 11 / 2028", member: u.member_no, tier: u.tier, earn: 2416 };
  const [contact, setContact] = useState({ email: u.email || "daniel.silva@email.com", phone: u.phone || "(11) 99812-4471", country: "Brazil", city: "Porto", lang: "Português (BR)" });
  const [tab, setTab] = useState("p1");
  const [cons, setCons] = useState({ fare: true, hotel: true, stopover: false, analytics: true, ads: false });
  useEffect(() => { trip.contact = contact; }, [contact]);
  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={3} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">Passenger details</h1><Pill tone="slate">{trip.pax} traveler{trip.pax > 1 ? "s" : ""}</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1 max-w-xl">Enter passenger information exactly as it appears on travel documents. We'll use this to issue tickets and send trip updates.</p>
        <div className="flex flex-wrap gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adults</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>{u.first_name} {last}{trip.pax > 1 ? " + " + (trip.pax - 1) : ""}</Chip></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-5 items-start">
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              {[["all", "All"], ["p1", `Passenger 1 · ${u.first_name}`], ...(trip.pax > 1 ? [["p2", "Passenger 2"]] : [])].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cx("px-3 py-1.5 rounded-full", tab === k ? "bg-surface-dark text-white" : "bg-surface border border-line text-ink-muted")}>{tab === k && k !== "all" && <span className="text-tap-green mr-1">●</span>}{l}</button>
              ))}
              <span className="ml-auto text-[11px] text-ink-faint">0 of {trip.pax} complete · <span className="text-tap-greenDeep font-semibold">Autosaved</span></span>
            </div>
            {(tab === "all" || tab === "p1") && <PaxCard idx={0} lead prefill={p1} />}
            {(tab === "all" || tab === "p2") && Array.from({ length: Math.max(0, trip.pax - 1) }).map((_, i) => <PaxCard key={i} idx={i + 1} />)}

            <Card className="p-5">
              <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-2"><Icon name="mail" size={15} className="text-ink-faint" /><div className="font-bold text-[15px]">Contact details for this booking</div></div><button className="text-[12px] font-semibold text-tap-greenDeep">Using your account · Change</button></div>
              <p className="text-[11px] text-ink-muted mb-3">We'll send confirmation and important trip updates to this contact.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={<>Email address <Req /></>}><Input value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></Field>
                <Field label={<>Mobile phone <Req /></>}><Input value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></Field>
                <Field label={<>Country <Req /></>}><Input value={contact.country} onChange={e => setContact({ ...contact, country: e.target.value })} /></Field>
                <Field label={<>City <Req /></>}><Input value={contact.city} onChange={e => setContact({ ...contact, city: e.target.value })} /></Field>
                <Field label="Preferred language"><Input value={contact.lang} onChange={e => setContact({ ...contact, lang: e.target.value })} /></Field>
              </div>
              <label className="flex items-center gap-2 mt-3 text-[12px] text-ink-muted"><input type="checkbox" className="accent-[#46a41a]" /> Email me fare alerts and travel inspiration (optional)</label>
            </Card>

            <Card className="p-5">
              <div className="flex items-center gap-2 mb-1"><Icon name="lock" size={15} className="text-tap-green" /><div className="font-bold text-[15px]">Your data, your choice</div></div>
              <p className="text-[11px] text-ink-muted mb-4">GDPR-compliant · TAP only shares what you explicitly allow below.</p>
              <Eyebrow className="mb-3">Marketing & partner consents</Eyebrow>
              <div className="divide-y divide-line">
                {[["fare", "TAP fare alerts", "Personalised deals based on your routes"], ["hotel", "Hotel & car partners", "Booking.com & Hertz can email you matched offers"], ["stopover", "Stopover Portugal", "Destination guides & limited-time experiences"], ["analytics", "Anonymised analytics", "Helps TAP improve product (no personal data shared)"], ["ads", "Third-party advertising", "Personalised ads on social platforms"]].map(([k, t, s]) => (
                  <div key={k} className="flex items-center justify-between py-3"><div><div className="text-[13px] font-semibold">{t}</div><div className="text-[11px] text-ink-faint">{s}</div></div><Toggle on={cons[k]} set={v => setCons({ ...cons, [k]: v })} /></div>
                ))}
              </div>
            </Card>
            <div className="rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2.5 flex items-center gap-2"><Icon name="lock" size={13} /> Encrypted & GDPR-safe</div>
          </div>
          <BasketSummary step={4} cta="Continue to payment →" onCta={() => go("payment")} note="Final review again on Step 4." secondary="← Back to My Trip Cart" onSecondary={() => go("cart")} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ PAYMENT ═══════════ */
const METHODS = ["Card", "Digital Wallet", "Miles & Go", "Bank transfer", "Split Payment", "Mix Method"];
export function Payment({ shared, go }) {
  if (!trip.outbound) return noTrip(go);
  seedExtras();
  const u = shared.profile?.user || {};
  const voucher = (shared.profile?.vouchers || []).find(v => v.status === "active")?.amount || 0;
  const t = tripTotals();
  const [method, setMethod] = useState("Card");
  const [agree, setAgree] = useState(true);
  const [useV, setUseV] = useState(false);
  const [milesUsed, setMilesUsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [seat, setSeat] = useState(null);                 // recommended seat from history (DB)
  const [splitTab, setSplitTab] = useState("Split Equally");
  const [mix, setMix] = useState({ card: null, miles: 0, voucher: false, cashback: 0 }); // Payment Composer amounts
  useEffect(() => { api.get("/seat-recommendation").then(setSeat).catch(() => {}); }, []);
  const cashbackBal = 38;
  let voucher_amt = 0, miles_used = 0, miles_amt = 0, cashback_amt = 0;
  if (method === "Miles & Go") { miles_used = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE)); miles_amt = Math.round(miles_used * MILES_RATE); voucher_amt = Math.min(voucher, Math.max(0, t.total - miles_amt)); }
  else if (method === "Mix Method") {
    voucher_amt = mix.voucher ? Math.min(voucher, t.total) : 0;
    miles_used = mix.miles; miles_amt = Math.round(miles_used * MILES_RATE);
    cashback_amt = Math.min(cashbackBal, mix.cashback || 0);
  }
  const card_amt = Math.max(0, t.total - voucher_amt - miles_amt - cashback_amt);
  const seatNo = seat?.seat || "12A";

  async function pay() {
    setBusy(true);
    try {
      const r = await api.post("/pay", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code || e.name), total: t.total, voucher_amt, miles_used, miles_amt, card_amt, seat: seatNo, date: trip.date });
      if (r.ok) { trip.pnr = r.pnr; trip.seat = seatNo; trip.payment = { total: t.total, voucher_amt, miles_used, miles_amt, cashback_amt, card_amt, method, email: r.email?.to }; go("confirmation"); }
      else alert("Payment could not be completed: " + (r.error || "unknown"));
    } catch (e) { alert("Payment error: " + e.message); } finally { setBusy(false); }
  }
  const billing = (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3"><div className="flex items-center gap-2"><Icon name="doc" size={15} className="text-ink-faint" /><div><div className="font-bold text-[15px]">Billing details</div><div className="text-[11px] text-ink-muted">We use these only for payment authorisation and invoicing.</div></div></div><span className="text-[12px] font-semibold text-tap-greenDeep flex items-center gap-1 rounded-full bg-lime-tint px-2.5 py-1"><Icon name="check" size={11} /> Use contact details</span></div>
      <div className="grid sm:grid-cols-2 gap-3"><Field label={<>Country <Req /></>}><Input defaultValue={trip.contact?.country || "Brazil"} /></Field><Field label={<>Street address <Req /></>}><Input defaultValue="Av. Paulista, 1842 · Apt 71" /></Field><Field label={<>City <Req /></>}><Input defaultValue={trip.contact?.city || "Porto"} /></Field><Field label="State / province"><Input defaultValue="SP" /></Field><Field label={<>Postal code <Req /></>}><Input defaultValue="01310-100" /></Field><Field label="CPF / Tax ID (optional)"><Input placeholder="000.000.000-00" /></Field></div>
    </Card>
  );
  const terms = (
    <Card className="p-4 space-y-3">
      <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="accent-[#46a41a] mt-0.5" /><span>I've read and accept the <b>fare conditions</b> · <b>baggage rules</b> · <b>privacy policy</b>. {!agree && <Pill tone="red">Required</Pill>}<div className="text-ink-faint font-normal">You'll receive your booking confirmation and e-ticket after successful payment.</div></span></label>
      <label className="flex items-start gap-2.5 text-[12px] text-ink-muted"><input type="checkbox" className="accent-[#46a41a] mt-0.5" /><span>Send me deals and offers from voa and partners (optional). You can unsubscribe any time.</span></label>
    </Card>
  );

  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={4} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">Payment</h1><Pill tone="slate"><Icon name="lock" size={11} /> Secure checkout · powered by Stripe</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">Review your total and pay securely to confirm your trip. No charge has been made until you click Pay.</p>
        <div className="flex flex-wrap items-center gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adults</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>{u.first_name} {trip.pax > 1 ? "+ " + (trip.pax - 1) : ""}</Chip><span className="ml-auto text-[11px] text-ink-faint rounded-lg bg-surface-mute px-3 py-1.5"><span className="font-bold text-ink">●</span> Price locked · 14:32</span></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-5 items-start">
          <div className="space-y-5">
            <div className="rounded-2xl p-4 text-white flex items-center justify-between flex-wrap gap-3" style={{ background: "linear-gradient(100deg,#1f5e23,#46a41a)" }}>
              <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-white/15 inline-flex items-center justify-center"><Icon name="lock" size={16} /></span><div><div className="text-[14px] font-bold">Secure payment</div><div className="text-[11px] text-white/70">All card data is encrypted and tokenised. We never see your full card number.</div></div></div>
              <div className="flex flex-wrap gap-1.5">{["VISA", "MASTERCARD", "AMEX", "TAP MILES", "APPLE PAY"].map(b => <span key={b} className="text-[9px] font-bold bg-white/15 rounded px-1.5 py-1">{b}</span>)}<span className="text-[9px] font-bold bg-[#635bff] rounded px-1.5 py-1">stripe</span></div>
            </div>
            <Card className="p-1.5 flex gap-1 overflow-x-auto v2-track">{METHODS.map(m => <button key={m} onClick={() => setMethod(m)} className={cx("shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-semibold", method === m ? "bg-tap-green text-white" : "text-ink-muted hover:bg-surface-mute")}>{m}</button>)}</Card>

            <Card className="p-5">
              {method === "Card" && <>
                <div className="flex items-center justify-between mb-3"><div className="font-bold text-[15px] flex items-center gap-2"><Icon name="lock" size={14} className="text-ink-faint" /> Pay by card</div><span className="text-[11px] text-ink-faint flex items-center gap-1">Powered by <span className="text-[9px] font-bold bg-[#635bff] text-white rounded px-1.5 py-0.5">stripe</span></span></div>
                <div className="text-[11px] text-ink-faint mb-3">Visa · Mastercard · American Express · Maestro · Elo</div>
                <div className="grid gap-3">
                  <Field label={<>Cardholder name <Req /></>}><Input defaultValue={(u.full_name || "Daniel Silva").toUpperCase()} /></Field>
                  <Field label={<>Card number <Req /></>}><Input defaultValue={`XXXX XXXX XXXX ${u.card_last4 || "4242"}`} /></Field>
                  <div className="grid grid-cols-2 gap-3"><Field label={<>Expiry (MM / YY) <Req /></>}><Input defaultValue={u.card_exp || "09 / 28"} /></Field><Field label={<>CVC / CVV <Req /></>}><Input defaultValue="•••" /></Field></div>
                </div>
                <label className="flex items-center gap-2 mt-3 text-[12px] text-ink-muted"><input type="checkbox" defaultChecked className="accent-[#46a41a]" /> Save card securely for faster checkout next time <span className="ml-auto"><Pill tone="green"><Icon name="lock" size={10} /> Encrypted</Pill></span></label>
              </>}
              {method === "Miles & Go" && <div className="text-[13px]"><div className="font-bold text-[15px] mb-2 flex items-center gap-2"><Icon name="spark" size={14} className="text-tap-green" /> Pay with Miles &amp; Go</div><div className="rounded-xl border border-tap-green bg-lime-tint/40 p-4"><div className="flex items-center justify-between"><span>Balance</span><span className="font-bold v2-num">{miles(u.miles)} miles</span></div><div className="flex items-center justify-between mt-1.5"><span>Using for this trip</span><span className="font-bold v2-num">{miles(miles_used)} mi ({EUR(miles_amt)})</span></div>{voucher_amt > 0 && <div className="flex items-center justify-between mt-1.5"><span>Voucher applied</span><span className="font-bold v2-num text-tap-greenDeep">−{EUR(voucher_amt)}</span></div>}<Divider className="my-2" /><div className="flex items-center justify-between font-bold"><span>Remaining on saved card</span><span className="v2-num">{EUR(card_amt)}</span></div></div></div>}
              {method === "Mix Method" && (() => {
                const milesMax = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE));
                const Comp = ({ on, title, sub, right, onToggle }) => (
                  <div className={cx("rounded-xl border p-3.5", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
                    <div className="flex items-center gap-3"><button onClick={onToggle} className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-white text-[11px]", on ? "bg-tap-green" : "bg-surface-mute text-ink-faint")}>{on ? "✓" : ""}</button><div className="flex-1"><div className="text-[13px] font-bold">{title}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>{right}</div>
                  </div>
                );
                return <div className="space-y-3"><div className="font-bold text-[15px] flex items-center gap-2"><Icon name="lock" size={14} className="text-ink-faint" /> Payment Composer</div><p className="text-[12px] text-ink-muted">Mix card · miles · voucher · cashback. Live total updates as you adjust.</p>
                  <Comp on={card_amt > 0} title={`Card · Visa ····${u.card_last4 || "4242"}`} sub="Available: unlimited" right={<span className="text-[13px] font-bold v2-num">{EUR(card_amt)}</span>} onToggle={() => { }} />
                  <Comp on={mix.miles > 0} title="TAP miles" sub={`Balance ${miles(u.miles)} · 1mi=${EUR(MILES_RATE)}`} onToggle={() => setMix(m => ({ ...m, miles: m.miles > 0 ? 0 : milesMax }))} right={<span className="text-[13px] font-bold v2-num">{miles(miles_used)} mi ({EUR(miles_amt)})</span>} />
                  <div className="px-3 -mt-1"><input type="range" min="0" max={milesMax} step="500" value={mix.miles} onChange={e => setMix(m => ({ ...m, miles: +e.target.value }))} className="w-full accent-[#46a41a]" /></div>
                  <Comp on={mix.voucher && voucher > 0} title={`Voucher${voucher ? " TAP-" + (shared.profile?.vouchers?.[0]?.code || "XYZ") : ""}`} sub={voucher ? `Eligible: ${EUR(voucher)}` : "No active voucher"} onToggle={() => voucher && setMix(m => ({ ...m, voucher: !m.voucher }))} right={<span className="text-[13px] font-bold v2-num">{EUR(voucher_amt)}</span>} />
                  <Comp on={cashback_amt > 0} title="Cashback wallet" sub={`Balance: ${EUR(cashbackBal)}`} onToggle={() => setMix(m => ({ ...m, cashback: m.cashback > 0 ? 0 : cashbackBal }))} right={<span className="text-[13px] font-bold v2-num">{EUR(cashback_amt)}</span>} />
                  <div className="rounded-xl bg-surface-soft border border-line p-3 text-[12px] space-y-1"><div className="font-bold text-ink mb-1">Payment breakdown</div><Row label="Card payment" v={EUR(card_amt)} /><Row label={`Miles (${miles(miles_used)})`} v={"−" + EUR(miles_amt)} green /><Row label="Voucher" v={"−" + EUR(voucher_amt)} green /><Row label="Cashback wallet" v={"−" + EUR(cashback_amt)} green /><Divider className="my-1.5" /><div className="flex items-center justify-between font-bold text-[13px]"><span>Total (in EUR)</span><span className="v2-num">{EUR(t.total)}</span></div></div>
                </div>;
              })()}
              {(method === "Digital Wallet" || method === "Bank transfer") && <div className="text-[13px] text-ink-muted">{method} selected — you'll be redirected to complete payment. (Demo charges your saved card for {EUR(t.total)}.)</div>}
              {method === "Split Payment" && (() => {
                const payers = [{ name: (trip.passengers?.[0]?.first ? trip.passengers[0].first + " (you)" : (u.first_name || "You") + " (you)"), email: trip.contact?.email || u.email || "you@email.com", card: u.card_last4 || "4242", status: "Pay now", lead: true }, ...Array.from({ length: Math.max(0, trip.pax - 1) }).map((_, i) => { const p = trip.passengers?.[i + 1]; return { name: p?.first ? `${p.first} ${p.last || ""}` : `Guest ${i + 1}`, email: "guest" + (i + 1) + "@email.com", card: ["1881", "1234", "5079"][i] || "0000", status: i === 0 ? "Link sent" : "Link pending" }; })];
                const equal = +(t.total / payers.length).toFixed(2);
                return <div className="text-[13px]">
                  <div className="flex gap-4 text-[12px] font-semibold mb-3">{["Single Payer", "Split Equally", "Custom Split"].map(s => <button key={s} onClick={() => setSplitTab(s)} className={cx("pb-0.5 border-b-2", splitTab === s ? "border-tap-green text-tap-greenDeep" : "border-transparent text-ink-faint")}>{s}</button>)}</div>
                  {payers.map((p, i) => (
                    <div key={i} className={cx("rounded-xl border p-3.5 mb-2.5", p.lead ? "border-tap-green bg-lime-tint/30" : "border-line")}>
                      <div className="flex items-center justify-between"><div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{p.name[0]}</span><div><div className="font-bold">{p.name}</div><div className="text-[11px] text-ink-faint">{p.email}</div></div></div><div className="text-right"><div className="font-bold v2-num">{EUR(equal)} ({Math.round(100 / payers.length)}%)</div><div className={cx("text-[11px] font-semibold", p.status === "Pay now" ? "text-tap-greenDeep" : "text-ink-faint")}>{p.status === "Pay now" ? "● Ready to charge" : p.status}</div></div></div>
                      {p.lead
                        ? <div className="grid sm:grid-cols-3 gap-2 mt-3"><Input defaultValue={`···· ···· ···· ${p.card}`} className="sm:col-span-3 text-[13px]" /><Input defaultValue={u.card_exp || "12 / 28"} placeholder="MM/YY" className="text-[13px]" /><Input defaultValue="•••" placeholder="CVC" className="text-[13px]" /><Input defaultValue={p.name.replace(" (you)", "")} placeholder="Name" className="text-[13px]" /></div>
                        : <div className="flex items-center justify-between mt-3 rounded-lg bg-surface-soft border border-line px-3 py-2 text-[12px]"><span className="text-ink-muted">Secure payment link · card ····{p.card}</span><button className="font-semibold text-tap-greenDeep">{p.status === "Link pending" ? "Send link" : "Resend"}</button></div>}
                    </div>
                  ))}
                  <div className="rounded-xl bg-surface-dark text-white p-3 text-[12px] flex items-start gap-2"><Icon name="info" size={14} className="mt-0.5 text-lime" /><div><b>Both charges happen at the same time.</b> If either card fails, the booking is cancelled and a full refund is issued. The demo confirms once the lead payer pays {EUR(t.total)}.</div></div>
                </div>;
              })()}
              <div className="mt-4 rounded-xl border border-dashed border-line p-3 flex items-center gap-3 text-[12px]"><span className="w-9 h-9 rounded-lg bg-surface-mute inline-flex items-center justify-center"><Icon name="lock" size={14} className="text-ink-faint" /></span><div className="flex-1"><div className="font-semibold">Bank verification (3-D Secure) appears here when required</div><div className="text-ink-faint">Your bank may ask you to confirm with a code, push notification, or biometric.</div></div><Pill tone="slate"><Icon name="lock" size={10} /> 3-D Secure 2.0</Pill></div>
            </Card>
            {billing}{terms}
            <Card className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-muted">
              {[["lock", "PCI-DSS Level 1 · Stripe"], ["lock", "3-D Secure 2.0"], ["clock", "Free 24h cancellation"], ["star", "24/7 voa Care"]].map(([ic, t2]) => <span key={t2} className="flex items-center gap-1.5"><Icon name={ic} size={13} className="text-tap-green" /> {t2}</span>)}
            </Card>
          </div>
          <BasketSummary step={4} cta={busy ? "Processing…" : `Pay ${EUR(t.total)} & complete booking`} disabled={!agree || busy} onCta={pay} note="By paying you confirm fare conditions & privacy policy." secondary="← Back to passenger details" onSecondary={() => go("passenger")} user={u} milesSwitch={{ tier: u.tier }} onMilesSwitch={() => setMethod("Miles & Go")} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ CONFIRMATION ═══════════ */
export function Confirmation({ shared, go }) {
  const [recs, setRecs] = useState([]);
  useEffect(() => { api.get("/destinations").then(d => setRecs((d || []).slice(0, 4))).catch(() => {}); }, []);
  if (!trip.pnr) return noTrip(go);
  const pay = trip.payment || {}, o = trip.outbound, i = trip.inbound, u = shared.profile?.user || {}, t = tripTotals();
  const pax = trip.passengers.filter(p => p && p.first).length ? trip.passengers.filter(p => p && p.first) : [{ first: u.first_name, last: "" }];
  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="mx-auto max-w-page px-6 py-8">
        <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-tap-green text-white inline-flex items-center justify-center"><Icon name="check" size={22} /></span><div><h1 className="text-[30px] font-black">Booking confirmed</h1><div className="text-[13px] text-ink-muted">PNR {trip.pnr} · receipt sent to {pay.email || u.email}</div></div></div>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3"><div className="font-bold text-[16px]">Your itinerary</div><Pill tone="red">PNR {trip.pnr}</Pill></div>
              {[o, i].filter(Boolean).map((c, idx) => (
                <div key={idx} className="rounded-2xl p-5 mb-2 flex flex-wrap items-center gap-4" style={{ background: "#f2ffdb" }}>
                  <div><div className="text-[26px] font-black v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin} · Terminal 1</div></div>
                  <div className="flex-1 min-w-[150px] text-center text-[11px] text-ink-muted">{c.flight.duration} · nonstop<div className="font-semibold text-ink mt-0.5">{fmtDate(idx === 0 ? trip.date : trip.ret).replace(/(\w+) (\d+) \d+/, "$1 $2")} · {c.flight.flight_no} · {c.flight.aircraft}</div><div className="h-px bg-tap-green/40 my-1.5" />Seat 14A · gate info 90 min before</div>
                  <div className="text-right"><div className="text-[26px] font-black v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 mt-3">{pax.map((p, n) => <Pill key={n} tone="slate"><Icon name="user" size={10} /> {p.first} {p.last} · {n === 0 ? (trip.seat || "14A") : (["14B", "14C", "14D"][n - 1] || "14A")}</Pill>)}<Pill tone="slate">Carry-on × {pax.length}</Pill><Pill tone="slate">Standard seat</Pill></div>
              <div className="flex flex-wrap gap-5 mt-4 text-[13px] font-semibold text-tap-greenDeep"><button>Add to Wallet</button><button>Add to Calendar</button><button>Download e-ticket</button></div>
              <div className="text-[11px] text-ink-faint mt-3 pt-3 border-t border-line">Manage booking · check-in opens 24h before</div>
            </Card>
            <section>
              <h2 className="text-[20px] font-bold">Useful for your trip</h2>
              <p className="text-[12px] text-ink-faint mb-3">Limited · helpful · not pushy. Max 3 cards.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {recs.slice(0, 4).map(d => (
                  <Card key={d.code} className="overflow-hidden"><Img seed={"dest-" + d.code} src={d.image_url || imageFor(d.code, d.city)} alt={d.city} className="h-28 w-full" /><div className="p-4"><div className="font-bold text-[14px]">{d.city}</div><div className="text-[11px] text-ink-muted mt-0.5 line-clamp-2 min-h-[28px]">{d.reason || d.tag}</div>{(d.reason || d.signals) && <WhyChip reason={d.reason} signals={d.signals} className="mt-1" />}<div className="flex items-center justify-between mt-2"><div><div className="text-[15px] font-bold v2-num">{EUR(d.price)}</div><div className="text-[10px] text-ink-faint">per person</div></div><Btn size="sm" variant="outline" onClick={() => go("results", { origin: d.origin, dest: d.code })}>+ Add</Btn></div></div></Card>
                ))}
              </div>
            </section>
          </div>
          <aside className="space-y-4">
            <Card className="p-5">
              <div className="font-bold text-[16px] mb-3">Payment receipt</div>
              <div className="space-y-1.5 text-[13px]"><Row label={`Fare x${trip.pax}`} v={EUR(t.flights)} /><Row label="Taxes & fees" v={EUR(t.taxes)} />{t.extras ? <Row label="Extras" v={EUR(t.extras)} /> : null}{t.bundle ? <Row label="Bundle savings" v={"−" + EUR(t.bundle)} green /> : null}{pay.voucher_amt ? <Row label="Voucher" v={"−" + EUR(pay.voucher_amt)} green /> : null}{pay.miles_amt ? <Row label={`Miles (${miles(pay.miles_used)})`} v={"−" + EUR(pay.miles_amt)} green /> : null}</div>
              <Divider className="my-3" />
              <div className="flex items-center justify-between"><div className="text-[12px] text-ink-faint">Paid · {pay.method || "Card"} {u.card_last4 ? "••" + u.card_last4 : ""}</div><div className="text-[24px] font-black text-tap-green v2-num">{EUR(pay.card_amt ?? t.total)}</div></div>
              <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark px-3 py-2.5 text-[12px]"><div className="font-semibold flex items-center gap-1.5"><Icon name="spark" size={12} /> You earned {miles(EARN(t.total))} miles</div><div className="text-[11px] mt-0.5">+ {Math.round(EARN(t.total) * 0.2)} status miles · 2 trips to next tier</div></div>
              <Btn variant="outline" className="w-full mt-3" onClick={() => go("basket")}>Download invoice (PDF) →</Btn>
            </Card>
            <Card className="p-4 text-[12px] space-y-2.5"><div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="clock" size={15} /></span><div><div className="font-semibold">Free 24h cancellation</div><div className="text-ink-faint">Full refund on flights & most extras.</div></div></div><div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="star" size={15} /></span><div><div className="font-semibold">24/7 TAP Care</div><div className="text-ink-faint">Need help? Chat with us 24/7.</div></div></div></Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
const Row = ({ label, v, green }) => <div className="flex items-center justify-between"><span className="text-ink-muted">{label}</span><span className={cx("font-semibold v2-num", green && "text-tap-greenDeep")}>{v}</span></div>;

/* ═══════════ EXPRESS CHECKOUT (CH1·B4) — book your usual in two taps ═══════════ */
export function ExpressCheckout({ shared, go }) {
  const u = shared?.profile?.user || {};
  const pat = shared?.profile?.pattern || {};
  const airports = shared?.airports || [];
  const cityOf = (c) => airports.find(a => a.code === c)?.city || c;
  const origin = pat.origin || u.home_airport || "OPO", dest = pat.dest || "LIS";
  const date = pat.recommendedDate || trip.date || "";
  const retDate = (() => { if (!date) return ""; const d = new Date(date); d.setDate(d.getDate() + 2); return d.toISOString().slice(0, 10); })();
  const [, force] = useState(0);
  const [seat, setSeat] = useState(null);
  const [bag, setBag] = useState(true), [carbon, setCarbon] = useState(true), [seatUp, setSeatUp] = useState(true), [agree, setAgree] = useState(true), [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/seat-recommendation").then(setSeat).catch(() => {});
    if (!trip.outbound) {
      Object.assign(trip, { origin, dest, date, ret: retDate, pax: 1, cabin: "Economy" });
      api.get(`/search?origin=${origin}&dest=${dest}&date=${date}`).then(r => {
        const f = (r.flights || []).find(x => x.flight_no === pat.usualOutNo) || (r.flights || []).find(x => x.recommended) || (r.flights || [])[0];
        if (f) setLeg("outbound", { flight: f, fare: "Classic", price: f.price, origin, dest, date });
        force(x => x + 1);
      }).catch(() => {});
      api.get(`/search?origin=${dest}&dest=${origin}&date=${retDate}`).then(r => {
        const f = (r.flights || []).find(x => x.flight_no === pat.usualBackNo) || (r.flights || []).find(x => x.recommended) || (r.flights || [])[0];
        if (f) setLeg("inbound", { flight: f, fare: "Classic", price: f.price });
        force(x => x + 1);
      }).catch(() => {});
    }
  }, []);

  const o = trip.outbound, i = trip.inbound;
  const base = o?.price || 0;
  const seatNo = seat?.seat || "12A";
  const seatCost = seatUp ? 18 : 0, bagCost = bag ? 25 : 0, carbonCost = carbon ? 2 : 0;
  const taxes = Math.round((base + seatCost + bagCost + carbonCost) * 0.12);
  const total = base + seatCost + bagCost + carbonCost + taxes;
  const earn = Math.round(total * 2.88);

  async function pay() {
    if (!o) return; setBusy(true);
    try {
      const items = ["seat-" + seatNo, bag && "checked-bag", carbon && "carbon"].filter(Boolean);
      const r = await api.post("/pay", { flight_no: o.flight.flight_no, items, total, voucher_amt: 0, miles_used: 0, miles_amt: 0, card_amt: total, seat: seatNo, date });
      if (r.ok) { trip.pnr = r.pnr; trip.seat = seatNo; trip.payment = { total, card_amt: total, method: "Card", email: r.email?.to }; go("confirmation"); }
      else alert("Payment could not be completed: " + (r.error || "unknown"));
    } catch (e) { alert("Payment error: " + e.message); } finally { setBusy(false); }
  }

  const Sec = ({ title, action, onAction, children }) => <Card className="p-5"><div className="flex items-center justify-between mb-2"><div className="font-bold text-[15px]">{title}</div>{action && <button onClick={onAction} className="text-[12px] font-semibold text-tap-greenDeep">{action}</button>}</div>{children}</Card>;

  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="bg-surface border-b border-line"><div className="mx-auto max-w-page px-6 py-4 flex items-center gap-3 text-[13px] font-semibold"><span className="flex items-center gap-1.5 text-ink"><span className="w-5 h-5 rounded-full bg-lime text-ink inline-flex items-center justify-center text-[11px]">1</span> Review &amp; Pay</span><span className="flex-1 h-px bg-line-strong" /><span className="flex items-center gap-1.5 text-ink-faint"><span className="w-5 h-5 rounded-full bg-surface-mute text-ink-faint inline-flex items-center justify-center text-[11px]">2</span> Confirmation</span></div></div>
      <div className="mx-auto max-w-page px-6 py-6">
        <h1 className="text-[26px] font-bold">Express checkout</h1>
        <p className="text-[13px] text-ink-muted mt-1">Review your total and pay securely to confirm your trip. No charge has been made until you click Pay.</p>
        {!o ? <Card className="p-10 text-center mt-6"><div className="text-[14px] text-ink-muted">Loading your usual {cityOf(origin)} ⇄ {cityOf(dest)} trip…</div></Card> : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
            <div className="space-y-4">
              <Sec title={`Your trip · ${cityOf(origin)} ⇄ ${cityOf(dest)}`} action="Change flight" onAction={() => go("results", { origin, dest, date, ret: retDate, type: "round" })}>
                {[o, i].filter(Boolean).map((c, idx) => (
                  <div key={idx} className="py-2 border-t border-line first:border-0"><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint mb-1">{idx === 0 ? "Outbound" : "Return"} · {fmtDate(idx === 0 ? date : retDate).replace(/(\w+) (\d+) \d+/, "$1 $2")} · {c.flight.flight_no} · {c.flight.aircraft}</div><div className="flex items-center gap-3"><div><div className="text-[18px] font-bold v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin}</div></div><div className="flex-1 text-center text-[11px] text-ink-muted">{c.flight.duration} · Direct<div className="h-px bg-line-strong my-1" /></div><div className="text-right"><div className="text-[18px] font-bold v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div></div></div>
                ))}
                <div className="mt-2 pt-2 border-t border-line text-[12px] text-ink-muted">Fare: Classic · 23kg bag · seat select · 50% refund · changes for fee</div>
              </Sec>
              <Sec title="Passenger" action="Edit">
                <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{(u.first_name || "D")[0]}</span><div><div className="font-bold text-[14px] flex items-center gap-2">{u.full_name || u.first_name} <Pill tone="gold">{u.tier} · {u.member_no}</Pill></div><div className="text-[11px] text-ink-faint">DOB {u.dob || "—"} · Passport ••••{(u.doc_id || "0000").slice(-4)} · Nationality {u.nationality || "PT"}</div><div className="text-[11px] text-tap-greenDeep font-semibold mt-0.5">Frequent flyer benefits applied: priority boarding, lounge</div></div></div>
              </Sec>
              <Sec title="Baggage" action="+ Add bag">
                <div className="flex items-center justify-between text-[13px] py-1"><div><div className="font-semibold">Cabin bag · 8kg</div><div className="text-[11px] text-ink-faint">Included in fare</div></div><Pill tone="slate">Included</Pill></div>
                <label className="flex items-center justify-between text-[13px] py-1 mt-1"><div><div className="font-semibold">Checked bag · 23kg ×1</div><div className="text-[11px] text-ink-faint">Outbound + return</div></div><span className="flex items-center gap-2"><span className="v2-num font-bold">{EUR(25)}</span><input type="checkbox" checked={bag} onChange={e => setBag(e.target.checked)} className="accent-[#46a41a]" /></span></label>
              </Sec>
              <Sec title="Payment method" action="+ Change">
                <div className="flex items-center justify-between"><div className="text-[14px] font-semibold flex items-center gap-2">{u.first_name}'s Card <Pill tone="slate">VISA</Pill></div><Pill tone="green"><Icon name="lock" size={10} /> Encrypted</Pill></div>
                <div className="text-[13px] v2-num mt-1">XXXX XXXX XXXX {u.card_last4 || "4242"}</div>
                <div className="mt-3 rounded-xl border border-dashed border-line p-3 flex items-center gap-3 text-[12px]"><span className="w-8 h-8 rounded-lg bg-surface-mute inline-flex items-center justify-center"><Icon name="lock" size={13} className="text-ink-faint" /></span><div className="flex-1"><div className="font-semibold">Bank verification (3-D Secure) appears here when required</div></div><Pill tone="slate">3-D Secure 2.0</Pill></div>
              </Sec>
              <Sec title="Seat selection" action="Change seat">
                <div className="flex items-center justify-between text-[13px] py-1"><div><div className="font-semibold">Outbound · {seatNo} (Window, extra legroom)</div><div className="text-[11px] text-ink-faint">{o.flight.flight_no} · {seat?.reason || "your usual"}</div></div><span className="flex items-center gap-2"><span className="v2-num font-bold">{EUR(18)}</span><input type="checkbox" checked={seatUp} onChange={e => setSeatUp(e.target.checked)} className="accent-[#46a41a]" /></span></div>
                <div className="flex items-center justify-between text-[13px] py-1 mt-1"><div><div className="font-semibold">Return · 14C (Aisle, standard)</div><div className="text-[11px] text-ink-faint">{i?.flight?.flight_no || ""}</div></div><Pill tone="lime">Free · {u.tier}</Pill></div>
              </Sec>
              <Sec title="Contact details" action="Edit">
                <div className="text-[13px]">{(u.email || "d•••@gmail.com").replace(/(.).+(@.+)/, "$1•••••$2")} · {u.phone || "+351 ••• 482"}</div>
                <div className="text-[11px] text-ink-faint mt-0.5">Boarding pass, receipt and IROPS alerts go here.</div>
              </Sec>
              <Card className="p-4"><label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="accent-[#46a41a] mt-0.5" /><span>I've read and accept the <b>fare conditions</b> · <b>baggage rules</b> · <b>privacy policy</b>. {!agree && <Pill tone="red">Required</Pill>}</span></label></Card>
            </div>
            <aside className="space-y-4">
              <Card className="p-5">
                <div className="text-[17px] font-bold mb-3">My trip basket</div>
                <div className="space-y-2 text-[13px]"><Row label="Base fare · 1 adult" v={EUR(base)} /><Row label="Taxes & fees" v={EUR(taxes)} />{seatUp && <Row label={`Seat ${seatNo} · extra legroom`} v={EUR(seatCost)} />}{bag && <Row label="Checked bag 23kg" v={EUR(bagCost)} />}{carbon && <Row label="Carbon offset" v={EUR(carbonCost)} />}</div>
                <Divider className="my-3" />
                <div className="flex items-end justify-between"><div className="text-[12px] text-ink-muted">Total to pay</div><div className="text-[26px] font-black v2-num">{EUR(total)}</div></div>
                <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2">Earn {miles(earn)} miles · or pay {miles(Math.round(total * 0.9 / MILES_RATE))} mi + {EUR(Math.round(total * 0.1))}</div>
                <div className="mt-3 flex gap-2"><input placeholder="Promo code" className="flex-1 bg-surface border border-line rounded-lg px-3 py-2 text-[12px] outline-none" /><Btn size="sm" variant="outline">Apply</Btn></div>
                <div className="mt-3 rounded-lg bg-surface-mute text-ink-muted text-[12px] px-3 py-2 flex items-center gap-1.5"><span className="text-ink font-bold">●</span> Price held for 14:32 · won't change if you pay now</div>
                <Btn size="lg" className="w-full mt-3" disabled={!agree || busy} onClick={pay}>{busy ? "Processing…" : `Pay ${EUR(total)} securely`}</Btn>
                <div className="flex items-center justify-center gap-4 mt-2 text-[12px] font-semibold text-ink-muted"><button>Save & pay later</button><button onClick={() => go("payment")}>Use miles instead</button></div>
                <div className="text-[10px] text-ink-faint text-center mt-2">PCI · Visa · Mastercard · Amex · MB WAY · Apple Pay · PayPal · Free 24h cancel</div>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
