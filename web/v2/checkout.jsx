// FlyTAP v2 — booking spine rebuilt to the approved Figma: Cart (View & customize,
// 8 modules) → Passenger details (identity + travel doc + loyalty + GDPR consents)
// → Payment (card + secure banner + billing + grouped basket) → Confirmation.
// A booking completes for real via /api/pay (DB row + email + CDP "booked").
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE } from "./lib.js";
import { trip, tripTotals, toggleExtra, hasExtra, extrasByCategory, bundleSavings } from "./trip.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, cx } from "./ui.jsx";

const EARN = (t) => Math.round(t * 2.88);
const BRL = (eur) => "R$ " + (eur * 5.39).toLocaleString("en-US", { maximumFractionDigits: 0 });
const CAT_ORDER = ["Hotels", "Cars & transfers", "Insurance", "Lounge & services", "Onboard", "Experiences", "Seats & baggage", "Carbon offset", "Extras"];
const CAT_TAG = { Hotels: "8 nights", "Cars & transfers": "", Insurance: "× 2", "Lounge & services": "", Experiences: "" };

/* seed the default extras so the basket reads like the Figma (hotel + transfer + insurance + lounge + experience) */
function seedExtras() {
  if (trip.extras.length) return;
  [["hotel-memmo", "Hotel — Memmo Príncipe Real", 640, "Hotels"], ["car-lis", "Airport transfer · LIS → hotel", 25, "Cars & transfers"],
   ["ins-plus", "Travel Insurance · Plus × 2", 76, "Insurance"], ["lounge-opo", "TAP Lounge · OPO", 90, "Lounge & services"],
   ["exp-belem", "Belém food walking tour", 130, "Experiences"]].forEach(([code, name, price, cat]) => trip.extras.push({ code, name, price, qty: 1, cat }));
}

/* ── stepper ── */
const STEPS = ["Select flights", "Trip extras", "My Trip Cart", "Passenger details", "Payment"];
function Stepper({ active }) {
  return (
    <div className="bg-surface border-b border-line">
      <div className="mx-auto max-w-page px-6 py-4 flex items-center gap-2 overflow-x-auto v2-track text-[13px] font-semibold whitespace-nowrap">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <span className={cx("shrink-0 flex items-center gap-1.5", i < active ? "text-tap-greenDeep" : i === active ? "text-ink" : "text-ink-faint")}>
              <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]", i < active ? "bg-tap-green text-white" : i === active ? "bg-lime text-ink" : "bg-surface-mute text-ink-faint")}>{i < active ? "✓" : i + 1}</span>{s}
            </span>
            {i < STEPS.length - 1 && <span className={cx("flex-1 min-w-[14px] h-px", i < active ? "bg-tap-green" : "bg-line-strong")} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
const Chip = ({ children, dot }) => <span className="px-3 py-1.5 rounded-full bg-surface border border-line text-[12px] font-semibold inline-flex items-center gap-1.5">{dot && <span className="w-1.5 h-1.5 rounded-full bg-tap-green" />}{children}</span>;
const Req = () => <span className="text-tap-red">*</span>;

/* ── basket summary (right rail) — grouped by category like the Figma ── */
function BasketSummary({ step, cta, onCta, disabled, secondary, onSecondary, note, milesSwitch, onMilesSwitch }) {
  const t = tripTotals(), byCat = extrasByCategory();
  const u = milesSwitch || {};
  return (
    <aside className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="text-[17px] font-bold">My trip basket</div><span className="w-5 h-5 rounded-full bg-tap-red text-white text-[11px] font-bold inline-flex items-center justify-center">{trip.extras.length + 1}</span></div><Pill tone="red">Step {step}/5</Pill></div>
        <div className="text-[11px] text-ink-faint mt-0.5">{trip.origin}–{trip.dest} · {trip.pax} adult{trip.pax > 1 ? "s" : ""} · {fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</div>
        <div className="mt-4 space-y-2 text-[13px]">
          <Line label="Flights" tag={`${trip.pax} pax`} v={t.flights} icon="plane" />
          {CAT_ORDER.filter(c => byCat[c]).map(c => <Line key={c} label={c} tag={CAT_TAG[c]} v={byCat[c]} />)}
          <Line label="Taxes & fees" v={t.taxes} />
          {t.bundle > 0 && <Line label="Bundle savings" v={-t.bundle} green icon="spark" />}
        </div>
        <Divider className="my-3.5" />
        <div className="flex items-end justify-between"><div><div className="text-[12px] text-ink-muted">Total <span className="text-ink-faint">(in EUR)</span></div><div className="text-[10px] text-ink-faint">One-time charge · taxes included</div></div><div className="text-right"><div className="text-[24px] font-black v2-num">{EUR(t.total)}</div><div className="text-[10px] text-ink-faint v2-num">≈ {BRL(t.total)}</div></div></div>
        <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Icon name="plane" size={12} /> You'll earn</span><span className="v2-num">{miles(EARN(t.total))} tap.miles</span></div>
        {milesSwitch && <button onClick={onMilesSwitch} className="mt-2 w-full rounded-lg bg-surface-dark text-white text-[12px] font-semibold px-3 py-2.5 flex items-center justify-between"><span className="flex items-center gap-2"><Pill tone="gold">{u.tier}</Pill> Pay with {miles(Math.round(t.total * 0.9 / MILES_RATE))} mi + {EUR(Math.round(t.total * 0.1))}</span><span className="text-lime">Switch →</span></button>}
        <Btn size="lg" className="w-full mt-4" disabled={disabled} onClick={onCta}>{cta}</Btn>
        {note && <div className="text-[11px] text-ink-faint text-center mt-2">{note}</div>}
        {secondary && <Btn variant="outline" className="w-full mt-2" onClick={onSecondary}>{secondary}</Btn>}
      </Card>
      <Card className="p-4 space-y-2.5 text-[12px]">
        {[["lock", "PCI-DSS Level 1", "Stripe encrypts & tokenises every card."], ["clock", "Free 24h cancellation", "Full refund on flights & most extras."], ["star", "24/7 voa Care", "WhatsApp · phone · live chat."], ["check", "Confirmation in seconds", "E-ticket sent to your inbox."]].map(([ic, a, b]) => (
          <div key={a} className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name={ic} size={15} /></span><div><div className="font-semibold">{a}</div><div className="text-ink-faint">{b}</div></div></div>
        ))}
      </Card>
      <div className="rounded-xl bg-surface-dark text-white p-4 flex items-center justify-between"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-md bg-[#635bff] inline-flex items-center justify-center text-[11px] font-bold">S</span><div><div className="text-[12px] font-semibold">Verified by Stripe</div><div className="text-[10px] text-white/50">Trusted by millions of businesses.</div></div></div><span className="text-[11px] text-lime font-semibold">Learn more →</span></div>
    </aside>
  );
}
const Line = ({ label, tag, v, green, icon }) => <div className="flex items-center justify-between"><span className="text-ink-muted flex items-center gap-1.5">{icon && <Icon name={icon} size={12} className={green ? "text-tap-green" : "text-ink-faint"} />}{label}{tag ? <Pill tone="slate">{tag}</Pill> : null}</span><span className={cx("font-semibold v2-num", green && "text-tap-greenDeep")}>{EUR(v)}</span></div>;

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
function Module({ n, kicker, title, sub, right, badge, children }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3"><span className="shrink-0 w-9 h-9 rounded-lg bg-surface-mute text-ink-faint inline-flex items-center justify-center text-[12px] font-bold">{n}</span>
          <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{kicker}</div><div className="font-bold text-[16px] flex items-center gap-2">{title}{badge && <Pill tone="lime"><Icon name="check" size={10} /> {badge}</Pill>}</div>{sub && <div className="text-[12px] text-ink-muted mt-0.5">{sub}</div>}</div>
        </div>{right}
      </div>{children}
    </Card>
  );
}

/* ═══════════ CART · View & customize (8 modules) ═══════════ */
export function Cart({ go }) {
  const [, force] = useState(0); const r = () => force(x => x + 1);
  useEffect(() => { seedExtras(); r(); }, []);
  if (!trip.outbound) return noTrip(go);
  const add = (code, name, price, cat) => { toggleExtra({ code, name, price, cat }); api.post("/basket", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code) }).catch(() => {}); r(); };
  const seat = trip.extras.find(e => e.cat === "Seats & baggage");

  const SeatType = ({ code, name, sub, price }) => {
    const on = code === "std" ? !seat : hasExtra(code);
    return <button onClick={() => { if (seat) toggleExtra(seat); if (code !== "std") toggleExtra({ code, name, price, cat: "Seats & baggage" }); r(); }} className={cx("flex-1 text-left rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/50" : "border-line")}>
      <div className="flex gap-1 mb-2">{[0, 1, 2, 3, 4].map(i => <span key={i} className={cx("w-5 h-5 rounded", (on && i === 2) || (on && code !== "std" && i === 3) ? "bg-lime" : "bg-surface-mute")} />)}</div>
      <div className="text-[13px] font-semibold flex items-center justify-between">{name}{price ? <span className="v2-num">{EUR(price)}</span> : <Pill tone="green">Included</Pill>}</div><div className="text-[11px] text-ink-faint">{sub}</div>
    </button>;
  };
  const Bag = ({ code, name, sub, price, locked }) => { const on = locked || hasExtra(code); return (
    <label className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line", locked && "opacity-90")}>
      <input type="checkbox" checked={on} disabled={locked} onChange={() => !locked && add(code, name, price, "Seats & baggage")} className="accent-[#46a41a]" />
      <div className="flex-1"><div className="text-[13px] font-semibold">{name} {locked && <Pill tone="green">Included</Pill>}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
      <div className="text-[13px] font-bold v2-num">{locked ? "Included" : EUR(price)}</div>
    </label>
  ); };
  const HotelRow = ({ code, name, stars, tags, rating, reviews, pn, total, rec }) => { const on = hasExtra(code); return (
    <div className={cx("flex gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
      <div className="w-20 h-16 rounded-lg shrink-0" style={{ background: "linear-gradient(135deg,#2e7d33,#9efd38)" }} />
      <div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-[14px] font-bold">{name}</span><span className="text-[#E8C75A]">{"★".repeat(stars)}</span>{rec && <Pill tone="lime">Recommended</Pill>}</div>
        <div className="flex flex-wrap gap-1 mt-1">{tags.map(t => <Pill key={t} tone="slate">{t}</Pill>)}</div>
        <div className="text-[11px] text-ink-muted mt-1">★ {rating} Excellent · {reviews} reviews</div></div>
      <div className="text-right"><div className="text-[13px] font-bold v2-num">From {EUR(pn)}<span className="text-[11px] font-medium text-ink-faint">/night</span></div><div className="text-[11px] text-ink-faint v2-num">{EUR(total)} total</div><Btn size="sm" variant={on ? "outline" : "primary"} className="mt-1.5" onClick={() => add(code, name, total, "Hotels")}>{on ? "✓ Added" : "Add to cart"}</Btn></div>
    </div>
  ); };
  const Row = ({ code, name, sub, price, unit, cat, tag }) => { const on = hasExtra(code); return (
    <div className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
      <div className="flex-1"><div className="text-[13px] font-semibold flex items-center gap-2">{name}{tag && <Pill tone="slate">{tag}</Pill>}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
      <div className="text-right"><div className="text-[13px] font-bold v2-num">{EUR(price)}</div>{unit && <div className="text-[10px] text-ink-faint">{unit}</div>}</div>
      <Btn size="sm" variant={on ? "outline" : "primary"} onClick={() => add(code, name, price, cat)}>{on ? "✓ Added" : "+ Add"}</Btn>
    </div>
  ); };
  const Plan = ({ code, name, kicker, price, total, points, sel }) => { const on = code === "ins-plus" ? hasExtra("ins-plus") : false; const active = sel ? on : false; return (
    <button onClick={() => add("ins-plus", "Travel Insurance · Plus × 2", 76, "Insurance")} className={cx("flex-1 text-left rounded-xl border p-4", active ? "border-tap-green bg-lime-tint/50" : "border-line")}>
      <div className="text-[14px] font-bold">{name}</div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{kicker}</div>
      <ul className="mt-2 space-y-1 text-[11px]">{points.map(([ok, p]) => <li key={p} className={cx("flex items-center gap-1.5", !ok && "text-ink-faint line-through")}><Icon name={ok ? "check" : "x"} size={11} className={ok ? "text-tap-green" : "text-ink-faint"} /> {p}</li>)}</ul>
      {price != null && <div className="mt-3 text-[13px] font-bold v2-num">{EUR(price)}<span className="text-[10px] font-medium text-ink-faint"> per traveller</span></div>}{total != null && <div className="text-[10px] text-ink-faint v2-num">TOTAL · {EUR(total)}</div>}
    </button>
  ); };

  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={1} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">View &amp; customize cart</h1><Pill tone="slate">8 modules</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">Choose hotels, transfers, protection and experiences to complete your trip. Everything you add flows into your cart.</p>
        <div className="flex flex-wrap gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adult{trip.pax > 1 ? "s" : ""}</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>All extras optional</Chip></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            <Module n="01" kicker="Seats & baggage" title="Seats & baggage" sub="Pick where you sit and what you bring." right={<button className="text-[12px] font-semibold text-tap-greenDeep">Full Cabin View</button>}>
              <Eyebrow className="mb-2">Choose your seat type · per passenger · both flights</Eyebrow>
              <div className="flex flex-col sm:flex-row gap-3"><SeatType code="std" name="Standard" sub="Standard 78cm pitch · auto-assigned" /><SeatType code="seat-nsf" name="Next Seat Free" sub="+10cm legroom · exit-row seats" price={48} /><SeatType code="seat-win" name="Window+" sub="Window + free middle + legroom" price={68} /></div>
              <Eyebrow className="mt-4 mb-2">Baggage · what's included with Classic fare</Eyebrow>
              <div className="space-y-2"><Bag name="Carry-on bag · 8kg" sub="1 piece per traveller · 55×40×20 cm" locked /><Bag name="Checked bag · 23kg" sub="1 piece per traveller · Classic fare" locked /><Bag code="bag-extra" name="Extra checked bag · 23kg" sub="Add a 2nd bag · saves €15 vs airport" price={55} /></div>
            </Module>

            <Module n="02" kicker="Carbon offset" title="Carbon offset" sub="Auto-checked · uncheck if you wish" right={<Pill tone="slate">Default ON in EU</Pill>}>
              <label className={cx("flex items-center gap-3 rounded-xl border p-3", hasExtra("carbon") ? "border-tap-green bg-lime-tint/40" : "border-line")}><input type="checkbox" checked={hasExtra("carbon")} onChange={() => add("carbon", "Carbon offset", 10, "Carbon offset")} className="accent-[#46a41a]" /><div className="flex-1 text-[13px] font-semibold">Offset this trip's emissions</div><div className="text-[13px] font-bold v2-num">€10.00</div></label>
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

            <Module n="05" kicker="Insurance" title="Protect your trip" badge="Plus · 2 pax" right={<Pill tone="red">Mandatory · EU rules</Pill>}>
              <div className="flex flex-col sm:flex-row gap-3"><Plan name="I already have cover" kicker="My insurance is sorted" points={[[true, "Health coverage"], [true, "Trip cancellation"], [false, "COVID-19 protection"]]} /><Plan name="Standard" kicker="Basic protection" price={18} total={36} points={[[true, "Medical · €20K"], [true, "Trip cancellation"], [false, "24/7 concierge"]]} /><Plan code="ins-plus" name="Plus" kicker="Recommended · comprehensive" price={38} total={76} sel points={[[true, "Medical · €50K"], [true, "Trip cancellation"], [true, "24/7 concierge"]]} /></div>
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
                  return <button key={n} onClick={() => p && add("meal-prem", "Premium meal × 2", 56, "Onboard")} className={cx("text-left rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/50" : "border-line")}><div className="text-[13px] font-bold">{n}</div><div className="text-[10px] text-ink-faint">{s}</div><div className="mt-2 text-[11px] font-semibold">{p ? EUR(p) : <Pill tone="green">Included</Pill>}</div></button>;
                })}
              </div>
            </Module>

            <Module n="08" kicker="Experiences" title="Experiences in Portugal" badge="1 added" sub="Curated tours and tastings for your dates. Skip the lines.">
              <div className="grid sm:grid-cols-3 gap-3">
                {[["exp-belem", "Belém food walking tour", "3h · pastéis · small group", 65, "Experience"], ["exp-sintra", "Sintra full-day", "Pena Palace · Cabo da Roca", 89, "Day trip · popular"], ["exp-douro", "Douro Valley wine tour", "Vineyards · tastings · river", 120, "Wine"], ["exp-fado", "Fado night experience", "Music · 3-course dinner · port", 75, "Night out"], ["exp-surf", "Surf lesson · Cascais", "2h · gear included · beginners", 55, "Outdoor"], ["exp-train", "Lisbon–Porto train", "2h45 · 1st class · day-trip", 39, "Excursion"]].map(([code, name, sub, price, tag]) => {
                  const on = hasExtra(code); return <div key={code} className={cx("rounded-xl border overflow-hidden", on ? "border-tap-green" : "border-line")}><div className="h-20" style={{ background: "linear-gradient(135deg,#1a1f29,#46a41a)" }} /><div className="p-3"><Pill tone="slate">{tag}</Pill><div className="text-[13px] font-bold mt-1">{name}</div><div className="text-[10px] text-ink-faint">{sub}</div><div className="flex items-center justify-between mt-2"><span className="text-[12px] font-bold v2-num">{EUR(price)}<span className="text-[10px] font-medium text-ink-faint"> pp</span></span><Btn size="sm" variant={on ? "outline" : "primary"} onClick={() => add(code, name, price * (trip.pax || 2), "Experiences")}>{on ? "✓ Added" : "+ Add"}</Btn></div></div></div>;
                })}
              </div>
            </Module>
          </div>
          <BasketSummary step={2} cta="Review my trip basket →" onCta={() => go("passenger")} secondary="Skip extras & continue with flights only" onSecondary={() => go("passenger")} />
        </div>
      </div>
    </div>
  );
}

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
  let voucher_amt = 0, miles_used = 0, miles_amt = 0;
  if (method === "Miles & Go") { miles_used = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE)); miles_amt = Math.round(miles_used * MILES_RATE); voucher_amt = Math.min(voucher, Math.max(0, t.total - miles_amt)); }
  else if (method === "Mix Method") { voucher_amt = useV ? Math.min(voucher, t.total) : 0; miles_used = milesUsed; miles_amt = Math.round(miles_used * MILES_RATE); }
  const card_amt = Math.max(0, t.total - voucher_amt - miles_amt);

  async function pay() {
    setBusy(true);
    try {
      const r = await api.post("/pay", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code || e.name), total: t.total, voucher_amt, miles_used, miles_amt, card_amt, seat: "12A", date: trip.date });
      if (r.ok) { trip.pnr = r.pnr; trip.payment = { total: t.total, voucher_amt, miles_used, miles_amt, card_amt, method, email: r.email?.to }; go("confirmation"); }
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
              {method === "Miles & Go" && <div className="text-[13px]"><div className="font-bold text-[15px] mb-2">Pay with Miles &amp; Go</div><p className="text-ink-muted">Using {miles(miles_used)} miles ({EUR(miles_amt)}){voucher_amt ? ` + ${EUR(voucher_amt)} voucher` : ""}; the remaining {EUR(card_amt)} goes to your saved card.</p></div>}
              {method === "Mix Method" && <div className="space-y-3"><div className="font-bold text-[15px]">Payment composer</div><p className="text-[12px] text-ink-muted">Mix card · miles · voucher. Live total updates as you adjust.</p>
                <label className="flex items-center justify-between text-[13px] rounded-xl border border-line p-3"><span>Voucher {voucher ? `(€${voucher} available)` : "(none)"}</span><input type="checkbox" disabled={!voucher} checked={useV} onChange={e => setUseV(e.target.checked)} className="accent-[#46a41a]" /></label>
                <div className="rounded-xl border border-line p-3"><div className="flex items-center justify-between text-[13px]"><span>TAP miles ({miles(u.miles)} avail)</span><span className="font-semibold v2-num">{miles(milesUsed)} mi · {EUR(miles_amt)}</span></div><input type="range" min="0" max={Math.min(u.miles || 0, Math.round((t.total - voucher_amt) / MILES_RATE))} step="500" value={milesUsed} onChange={e => setMilesUsed(+e.target.value)} className="w-full accent-[#46a41a] mt-2" /></div>
                <div className="rounded-xl border border-tap-green bg-lime-tint/40 p-3 text-[13px] flex items-center justify-between"><span>Card pays the remainder</span><b className="v2-num">{EUR(card_amt)}</b></div></div>}
              {(method === "Digital Wallet" || method === "Bank transfer") && <div className="text-[13px] text-ink-muted">{method} selected — you'll be redirected to complete payment. (Demo charges your saved card for {EUR(t.total)}.)</div>}
              {method === "Split Payment" && <div className="text-[13px]"><div className="flex gap-4 text-[12px] font-semibold mb-3"><span className="text-tap-greenDeep border-b-2 border-tap-green pb-0.5">Split Equally</span><span className="text-ink-faint">Single Payer</span><span className="text-ink-faint">Custom Split</span></div>{Array.from({ length: trip.pax }).map((_, i) => <div key={i} className="flex items-center justify-between rounded-xl border border-line p-3 mb-2"><div><div className="font-semibold">Payer {i + 1}{i === 0 ? " · you" : ""}</div><div className="text-[11px] text-ink-faint">{i === 0 ? (trip.contact?.email || "you") : "guest@email.com"}</div></div><div className="text-right"><div className="font-bold v2-num">{EUR(t.total / trip.pax)} ({Math.round(100 / trip.pax)}%)</div><div className="text-[11px] text-tap-greenDeep">{i === 0 ? "Pay now" : "Link sent"}</div></div></div>)}<p className="text-ink-faint">Per-passenger secure links (A17) come next — the demo charges the lead payer for {EUR(t.total)}.</p></div>}
              <div className="mt-4 rounded-xl border border-dashed border-line p-3 flex items-center gap-3 text-[12px]"><span className="w-9 h-9 rounded-lg bg-surface-mute inline-flex items-center justify-center"><Icon name="lock" size={14} className="text-ink-faint" /></span><div className="flex-1"><div className="font-semibold">Bank verification (3-D Secure) appears here when required</div><div className="text-ink-faint">Your bank may ask you to confirm with a code, push notification, or biometric.</div></div><Pill tone="slate"><Icon name="lock" size={10} /> 3-D Secure 2.0</Pill></div>
            </Card>
            {billing}{terms}
            <Card className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-muted">
              {[["lock", "PCI-DSS Level 1 · Stripe"], ["lock", "3-D Secure 2.0"], ["clock", "Free 24h cancellation"], ["star", "24/7 voa Care"]].map(([ic, t2]) => <span key={t2} className="flex items-center gap-1.5"><Icon name={ic} size={13} className="text-tap-green" /> {t2}</span>)}
            </Card>
          </div>
          <BasketSummary step={4} cta={busy ? "Processing…" : `Pay ${EUR(t.total)} & complete booking`} disabled={!agree || busy} onCta={pay} note="By paying you confirm fare conditions & privacy policy." secondary="← Back to passenger details" onSecondary={() => go("passenger")} milesSwitch={{ tier: u.tier }} onMilesSwitch={() => setMethod("Miles & Go")} />
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
              <div className="flex flex-wrap gap-2 mt-3">{pax.map((p, n) => <Pill key={n} tone="slate"><Icon name="user" size={10} /> {p.first} {p.last} · 14{["A", "B", "C"][n] || "A"}</Pill>)}<Pill tone="slate">Carry-on × {pax.length}</Pill><Pill tone="slate">Standard seat</Pill></div>
              <div className="flex flex-wrap gap-5 mt-4 text-[13px] font-semibold text-tap-greenDeep"><button>Add to Wallet</button><button>Add to Calendar</button><button>Download e-ticket</button></div>
              <div className="text-[11px] text-ink-faint mt-3 pt-3 border-t border-line">Manage booking · check-in opens 24h before</div>
            </Card>
            <section>
              <h2 className="text-[20px] font-bold">Useful for your trip</h2>
              <p className="text-[12px] text-ink-faint mb-3">Limited · helpful · not pushy. Max 3 cards.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {recs.slice(0, 4).map(d => (
                  <Card key={d.code} className="overflow-hidden"><div className="h-28" style={{ background: "linear-gradient(135deg,#1a1f29,#46a41a)" }} /><div className="p-4"><div className="font-bold text-[14px]">{d.city}</div><div className="text-[11px] text-ink-muted mt-0.5 line-clamp-2 min-h-[28px]">{d.reason || d.tag}</div><div className="flex items-center justify-between mt-2"><div><div className="text-[15px] font-bold v2-num">{EUR(d.price)}</div><div className="text-[10px] text-ink-faint">per person</div></div><Btn size="sm" variant="outline" onClick={() => go("results", { origin: d.origin, dest: d.code })}>+ Add</Btn></div></div></Card>
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
