// FlyTAP v2 — booking spine rebuilt to the approved Figma: Cart (View & customize,
// 8 modules) → Passenger details (identity + travel doc + loyalty + GDPR consents)
// → Payment (card + secure banner + billing + grouped basket) → Confirmation.
// A booking completes for real via /api/pay (DB row + email + CDP "booked").
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE, downloadFile, buildICS, money, eurRef, getCurrency } from "./lib.js";
import { trip, tripTotals, toggleExtra, hasExtra, extrasByCategory, bundleSavings, setLeg, pingBasket, clearBasket, resetTrip, tripSnapshot, extrasBySource, SOURCE_META, SOURCE_ORDER, PER_PAX_CATS } from "./trip.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, Img, imageFor, WhyChip, cx } from "./ui.jsx";

const EARN = (t) => Math.round(t * 2.88);
const BRL = (eur) => eurRef(eur);   // A7 — secondary line now shows the EUR reference when a non-EUR currency is active
const CAT_ORDER = ["Hotels", "Cars & transfers", "Insurance", "Lounge & services", "Onboard", "Experiences", "Seats & baggage", "Carbon offset", "Extras"];
const CAT_ICON = { Hotels: "home", "Cars & transfers": "arrow", Insurance: "shield", "Lounge & services": "star", Onboard: "bag", Experiences: "star", "Seats & baggage": "seat", "Carbon offset": "leaf", Extras: "cart" };
const CAT_SUB = (pax = 1, nights = 8) => ({ Hotels: `${nights} night${nights !== 1 ? "s" : ""} · ${pax} adult${pax > 1 ? "s" : ""}`, "Cars & transfers": "Private sedan · 1-way", Insurance: `${pax} traveler${pax > 1 ? "s" : ""}`, "Lounge & services": `Pre-flight · ${pax} adult${pax > 1 ? "s" : ""}`, Onboard: "Both flights", Experiences: `${pax} traveler${pax > 1 ? "s" : ""}`, "Seats & baggage": "Both flights", "Carbon offset": "This trip" });
const CAT_QTY = { Insurance: true, "Lounge & services": true, Experiences: true };

// Live session countdown — ticks every second so "price locked" reflects real remaining time (Split #4).
function SessionTimer({ minutes = 15, prefix = "price locked", suffix = "", className }) {
  const [s, setS] = useState(minutes * 60);
  useEffect(() => { const id = setInterval(() => setS(x => (x > 0 ? x - 1 : 0)), 1000); return () => clearInterval(id); }, []);
  const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  return <span className={className}>{prefix ? prefix + " " : ""}<span className="v2-num font-semibold">{mm}:{ss}</span>{suffix}</span>;
}

/* seed the default extras so the basket reads like the Figma. Each carries a source so the
   basket can classify them: system-recommended add-ons for Daniel's stopover + one auto-added
   default (insurance). Anything the member adds themselves comes in as source "user". */
function seedExtras() {
  if (trip.pnr || trip.seeded || trip.extras.length) return;   // #18 — once per fresh trip; never re-seed a confirmed booking, a cleared basket, or on re-render
  const px = trip.pax || 1;
  // [code, name, per-unit price, category, source]. Per-traveller categories (Insurance,
  // Lounge, Experiences) are multiplied by pax so the stored total matches the cart's
  // "× pax" hint — at 1 pax these are unchanged; at 3 pax lounge €90 → €270 (#2).
  [["hotel-memmo", "Hotel — Memmo Príncipe Real", 640, "Hotels", "recommended"], ["car-lis", "Airport transfer · LIS → hotel", 25, "Cars & transfers", "recommended"],
   ["ins-plus", "Travel Insurance · Plus", 38, "Insurance", "auto"], ["lounge-opo", "TAP Lounge · OPO", 90, "Lounge & services", "recommended"],
   ["exp-belem", "Belém food walking tour", 130, "Experiences", "recommended"]].forEach(([code, name, price, cat, source]) =>
     trip.extras.push({ code, name, price: PER_PAX_CATS.has(cat) ? price * px : price, qty: 1, cat, source }));
  trip.seeded = true;
  pingBasket();
}

/* ── stepper ── */
const STEPS = ["Select flights", "View & customize cart", "My Trip Basket", "Passenger details", "Payment"];
const eur2 = (n) => money(n, { dp: 2 });
const eurC = (n) => money(n, { dp: 2 });
// #9 — when no seat was explicitly chosen, the default follows the fare/cabin entitlement:
// Executive → front business zone, Premium → premium cabin, Plus → extra-legroom row, else economy standard.
const seatForFare = (fare) => /exec/i.test(fare || "") ? "1A" : /premium/i.test(fare || "") ? "6A" : /plus/i.test(fare || "") ? "22D" : "22C";
// Cabin/zone label that matches the fare entitlement (paired with seatForFare for #9).
const seatZone = (fare) => /exec/i.test(fare || "") ? "Business cabin" : /premium/i.test(fare || "") ? "Premium cabin" : /plus/i.test(fare || "") ? "Extra-legroom row" : "Standard · window";
// Seat-class chip label and adjacent-seat assignment for extra passengers on the same booking.
const seatClassLabel = (fare) => /exec/i.test(fare || "") ? "Business seat" : /premium/i.test(fare || "") ? "Premium seat" : /plus/i.test(fare || "") ? "Extra-legroom seat" : "Standard seat";
// Cabin name from the fare brand (Economy / Premium / Business) — used for the seat module, seat map, and the booking record.
const fareCabin = (fare) => /exec/i.test(fare || "") ? "Business" : /premium/i.test(fare || "") ? "Premium" : "Economy";
// An explicitly chosen seat from the seat-map ("Seats · 8A") always wins over the fare default / recommendation.
const chosenSeat = () => { const sm = (trip.extras || []).find(e => e.code === "seat-map"); const m = sm && String(sm.name).match(/\b(\d{1,2}[A-K])\b/); return m ? m[1] : null; };
const SEAT_LETTERS = ["A", "B", "C", "D", "E", "F"];
const adjSeat = (lead, n = 0) => { const m = String(lead || "22A").match(/^(\d+)\s*([A-Fa-f])/); if (!m) return lead || "22A"; const li = SEAT_LETTERS.indexOf(m[2].toUpperCase()); return m[1] + SEAT_LETTERS[((li < 0 ? 0 : li) + n) % 6]; };
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
function BasketSummary({ step, cta, onCta, disabled, secondary, onSecondary, note, milesSwitch, onMilesSwitch, basket, user, onClear, breakdown, hideMiles, grouped, footer }) {
  const t = tripTotals();
  const u = milesSwitch || {};
  const tier = u.tier || user?.tier || "Gold";
  const firstName = user?.first_name || (user?.name || "").split(" ")[0] || "there";
  const milesNeeded = Math.round(t.total * 0.9 / MILES_RATE);
  const milesTax = Math.round(t.total * 0.1);
  const showMiles = !basket && !hideMiles && (!!user || !!milesSwitch);
  const groups = extrasBySource();
  const lastCode = trip.extras[trip.extras.length - 1]?.code;
  // Category-grouped basket (Passenger + Payment pages) — one line per category, per Figma.
  const catTotals = {};
  trip.extras.forEach(e => { catTotals[e.cat] = (catTotals[e.cat] || 0) + (e.price || 0); });
  const gnights = (() => { try { const d = Math.round((new Date(trip.ret) - new Date(trip.date)) / 864e5); return d > 0 ? d : 8; } catch { return 8; } })();
  const GTag = { Hotels: `${gnights} nights`, Flights: `${trip.pax} pax` };
  const GRow = ({ icon, label, tag, amt, green, muted }) => (
    <div className="flex items-center justify-between">
      <span className={cx("inline-flex items-center gap-2 text-[13px]", muted ? "text-ink-muted" : green ? "text-tap-greenDeep font-semibold" : "text-ink")}>
        <Icon name={icon} size={15} className={muted ? "text-ink-faint" : "text-tap-greenDeep"} />
        {label}{tag ? <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-surface-mute text-ink-muted">{tag}</span> : null}
      </span>
      <span className={cx("font-bold v2-num text-[13px]", green ? "text-tap-greenDeep" : muted ? "text-ink-muted" : "text-ink")}>{amt < 0 ? "−" : ""}{eur2(Math.abs(amt))}</span>
    </div>
  );
  return (
    <aside className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="text-[17px] font-bold">{basket ? "Basket summary" : "My trip basket"}</div><span className="w-5 h-5 rounded-full bg-tap-red text-white text-[11px] font-bold inline-flex items-center justify-center">{trip.extras.length + 1}</span></div>{basket ? <Pill tone="slate">EUR</Pill> : <span className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full bg-tap-red text-white">Step {step}/5</span>}</div>
        <div className="text-[11px] text-ink-faint mt-0.5">{trip.origin}–{trip.dest} · {trip.pax} adult{trip.pax > 1 ? "s" : ""} · {fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</div>

        <div className="mt-4">
          {grouped ? (
            <div className="space-y-2.5">
              <GRow icon="plane" label="Flights" tag={GTag.Flights} amt={t.flights} />
              {CAT_ORDER.filter(c => catTotals[c]).map(c => <GRow key={c} icon={CAT_ICON[c] || "cart"} label={c} tag={GTag[c]} amt={catTotals[c]} />)}
              <GRow icon="doc" label="Taxes & fees" amt={t.taxes} muted />
              {t.bundle > 0 && <GRow icon="spark" label="Bundle savings" amt={-t.bundle} green />}
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-line overflow-hidden mt-3">
                <div className="bg-surface-soft px-3 py-2 flex items-baseline gap-1.5"><span className="text-[10px] font-bold uppercase tracking-wide text-ink">Anchor</span><span className="text-[11px] text-ink-faint">· Locked in from Step 1</span></div>
                <div className="px-3 py-1.5">
                  <SummaryItem icon="plane" name={`Flights · ${trip.origin}–${trip.dest}`} sub={`${trip.outbound?.flight?.flight_no || ""}${trip.inbound ? " / " + trip.inbound.flight.flight_no : ""} · ${trip.outbound?.fare || "Classic"}`} price={t.flights} qty={`${trip.pax} traveler${trip.pax > 1 ? "s" : ""}`} />
                </div>
              </div>
              {SOURCE_ORDER.filter(s => groups[s] && groups[s].length).map(s => (
                <div key={s} className="mt-3">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{SOURCE_META[s].label} · {groups[s].length}</div>
                    <span className={cx("inline-flex items-center text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full", s === "user" ? "bg-lime text-ink" : s === "recommended" ? "bg-tap-green/10 text-tap-greenDeep" : "bg-surface-mute text-ink-muted")}>{SOURCE_META[s].tag}</span>
                  </div>
                  {groups[s].map(e => <SummaryItem key={e.code} icon={CAT_ICON[e.cat] || "cart"} name={e.name} sub={CAT_SUB(trip.pax, gnights)[e.cat] || e.cat} price={e.price} qty={CAT_QTY[e.cat] ? `× ${trip.pax}` : ""} isNew={e.code === lastCode && e.source === "user"} />)}
                </div>
              ))}
              {onClear && trip.extras.length > 0 && <button onClick={onClear} className="mt-3 w-full rounded-full border border-line-strong py-2 text-[12px] font-semibold text-ink-muted hover:text-tap-red hover:border-tap-red inline-flex items-center justify-center gap-1.5"><Icon name="x" size={12} /> Clear basket</button>}
              <div className="mt-2.5 space-y-1 text-[12px]">
                <div className="flex items-center justify-between"><span className="text-ink-muted">Subtotal extras</span><span className="font-semibold v2-num text-ink">{eur2(t.extras)}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink-muted">Taxes & fees</span><span className="font-semibold v2-num text-ink">{eur2(t.taxes)}</span></div>
                {t.bundle > 0 && <div className="flex items-center justify-between"><span className="text-tap-greenDeep font-semibold flex items-center gap-1"><Icon name="spark" size={12} /> Bundle savings</span><span className="font-semibold v2-num text-tap-greenDeep">−{eur2(t.bundle)}</span></div>}
              </div>
            </>
          )}
          {breakdown && breakdown.length > 0 && <div className="mt-3 pt-3 border-t border-line space-y-1 text-[12px]"><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint mb-1">Payment breakdown</div>{breakdown.map(b => <div key={b.label} className="flex items-center justify-between"><span className="text-ink-muted">{b.label}</span><span className={cx("font-semibold v2-num", b.green ? "text-tap-greenDeep" : b.red ? "text-tap-red" : b.muted ? "text-ink-faint" : "text-ink")}>{b.text}</span></div>)}</div>}
        </div>

        <Divider className="my-3.5" />
        <div className="flex items-end justify-between"><div><div className="text-[13px] text-ink font-bold">{step === 2 ? "Subtotal" : "Total"} <span className="text-ink-muted font-medium">(in {getCurrency().label})</span></div><div className="text-[10px] text-ink-muted">{getCurrency().code !== "EUR" ? "Charged in EUR · rate applied at checkout (MCP)" : (step === 2 ? "No charge yet" : "One-time charge · taxes included")}</div></div><div className="text-right"><div className="text-[24px] font-black v2-num text-ink">{eurC(t.total)}</div><div className="text-[10px] text-ink-faint v2-num">{BRL(t.total)}</div></div></div>
        <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Icon name="plane" size={12} /> You'll earn</span><span className="v2-num">{miles(EARN(t.total))} tap.miles</span></div>
        {breakdown && <div className="mt-3 rounded-lg bg-surface-soft border border-line px-3 py-2.5 flex items-center justify-between gap-2"><div><div className="text-[12px] font-semibold">Save this mix as default?</div><div className="text-[10px] text-ink-faint">Auto-apply for future bookings · editable any time</div></div><button className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-tap-greenDeep hover:border-tap-green">Save mix</button></div>}

        <Btn size="lg" className="w-full mt-4" disabled={disabled} onClick={onCta}>{cta}</Btn>
        {step === 2 && <div className="text-[11px] text-ink-muted text-center mt-2 flex items-center justify-center gap-1"><Icon name="globe" size={11} className="text-ink-faint" /> You'll be able to adjust all items on the next step.</div>}
        {note && <div className="text-[11px] text-ink-faint text-center mt-2">{note}</div>}
        {secondary && <button onClick={onSecondary} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:border-tap-green inline-flex items-center justify-center gap-1.5">{secondary}{!/^[←]/.test(String(secondary)) && <Icon name="arrow" size={13} />}</button>}
        {footer}
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
      <Leg label={trip.type === "multi" ? "Flight 1" : "Outbound"} c={o} date={trip.date} /><Divider /><Leg label={trip.type === "multi" ? "Flight 2" : "Inbound"} c={i} date={trip.ret} />
      <div className="mt-3 pt-3 border-t border-line flex flex-wrap items-center gap-3 text-[11px] text-ink-muted"><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> 1× carry-on (8kg)</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> 1× checked bag (23kg)</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> Seat selection</span><span className="flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> Changes for fee</span><span className="ml-auto text-ink-faint">BOOKING REF · PENDING</span></div>
    </Card>
  );
}

/* ── module shell ── */
function Module({ n, kicker, title, sub, right, badge, children, icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3"><span className={cx("shrink-0 w-9 h-9 rounded-lg inline-flex items-center justify-center text-[12px] font-bold", icon ? "bg-lime-tint text-tap-greenDeep" : "bg-surface-mute text-ink-faint")}>{icon ? <Icon name={icon} size={18} className="text-tap-greenDeep" /> : n}</span>
          <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{icon ? `${n} · ${kicker}` : kicker}</div><div className="font-bold text-[16px] flex items-center gap-2">{title}{badge && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-lime text-ink"><Icon name="check" size={10} /> {badge}</span>}</div>{sub && <div className="text-[12px] text-ink-muted mt-0.5">{sub}</div>}</div>
        </div>{right}
      </div>
      <div className="h-px bg-line -mx-5 mb-4" />
      {children}
    </Card>
  );
}

/* ── Full Cabin View · seat-map modal — physically distinct layout & pricing per cabin ── */
// Each cabin has its own layout (abreast count), seat sizing, pricing chips and legend:
// Economy 3-3 · Premium 2-2 (wider) · Business 1-1 lie-flat suites.
const SEAT_CABINS = {
  Economy: {
    aircraftFallback: "A320neo", blocks: [["A", "B", "C"], ["D", "E", "F"]],
    startRow: 20, rows: 13,
    seatW: "w-9 h-9", colW: "w-9", colGap: "gap-1.5", rowGap: "space-y-1.5", blockGap: "gap-6",
    fee: (row) => (row === 20 || row === 31) ? { price: 18, tag: "Exit row · extra leg" } : { price: 0, tag: "Standard seat" },
    taken: ["22C-0", "23A-0", "25B-0", "26D-1", "28E-1", "30A-0", "31F-1"],
    window: ["20A-0", "24A-0", "29A-0"], legroom: ["20D-1", "31A-0"],
    types: [
      { code: "std", name: "Standard", price: 0, sub: "Pick any available seat", note: "Free for Star members" },
      { code: "nsf", name: "Next Seat Free", price: 48, sub: "Adjacent seat blocked", note: "Privacy & space" },
      { code: "couple", name: "Couple seat", price: 36, sub: "Auto-paired window+aisle", note: "Travel together" },
      { code: "win", name: "Window+", price: 68, sub: "Window + free middle + legroom", note: "Premium experience" },
    ],
    legend: [["bg-surface border border-line", "Pick"], ["bg-lime", "Selected"], ["bg-[#E8C75A]/60", "Window"], ["bg-tap-green/50", "Extra legroom"], ["bg-surface-mute", "Taken"]],
    upsell: true,
  },
  Premium: {
    aircraftFallback: "A330neo", blocks: [["A", "C"], ["D", "F"]],
    startRow: 6, rows: 6,
    seatW: "w-12 h-11", colW: "w-12", colGap: "gap-2.5", rowGap: "space-y-2.5", blockGap: "gap-12",
    fee: (row) => row === 6 ? { price: 25, tag: "Bulkhead · extra legroom" } : { price: 0, tag: "Premium seat · included" },
    taken: ["7C-0", "8D-1", "9A-0", "10F-1"],
    window: ["6A-0", "8A-0", "11A-0"], legroom: ["6D-1"],
    types: [
      { code: "std", name: "Premium seat", price: 0, sub: "Wider seat · recline · included", note: "Included with Premium" },
      { code: "legroom", name: "Extra legroom", price: 0, sub: "Bulkhead & front rows", note: "Included with Premium" },
      { code: "solo", name: "Solo · no neighbour", price: 40, sub: "Block the seat beside you", note: "Space to work & rest" },
      { code: "front", name: "Front row · priority", price: 25, sub: "First off the aircraft", note: "Priority deplane" },
    ],
    legend: [["bg-surface border border-line", "Pick"], ["bg-lime", "Selected"], ["bg-[#E8C75A]/60", "Window"], ["bg-tap-green/50", "Bulkhead"], ["bg-surface-mute", "Taken"]],
    upsell: false,
  },
  Business: {
    aircraftFallback: "A330neo", blocks: [["A"], ["D"]],
    startRow: 1, rows: 5,
    seatW: "w-16 h-12", colW: "w-16", colGap: "gap-3", rowGap: "space-y-3", blockGap: "gap-16",
    fee: (row) => ({ price: 0, tag: row === 1 ? "Front suite · first served" : "Business suite · lie-flat" }),
    taken: ["2A-0", "4D-1"],
    window: ["1A-0", "2A-0", "3A-0", "5A-0"], legroom: ["1D-1"],
    types: [
      { code: "std", name: "Business seat", price: 0, sub: "Lie-flat suite · direct aisle · lounge · included", note: "Included with Business — no other seat types" },
    ],
    legend: [["bg-surface border border-line", "Pick"], ["bg-lime", "Selected"], ["bg-[#E8C75A]/60", "Window suite"], ["bg-tap-green/50", "Front row"], ["bg-surface-mute", "Taken"]],
    upsell: false,
  },
};
const SEAT_PAX_NAMES = ["Daniel", "Mariana", "Sofia", "Lars", "Guest"];

function SeatMapModal({ pax = 1, cabin = "Economy", aircraft, onClose, onConfirm }) {
  const cfg = SEAT_CABINS[cabin] || SEAT_CABINS.Economy;
  const rowsArr = Array.from({ length: cfg.rows }, (_, i) => cfg.startRow + i);
  const takenSet = new Set(cfg.taken), winSet = new Set(cfg.window || []), legSet = new Set(cfg.legroom || []);
  const firstFree = (() => { const out = []; for (const row of rowsArr) for (let b = 0; b < cfg.blocks.length; b++) for (const c of cfg.blocks[b]) { const id = row + c + "-" + b; if (!takenSet.has(id)) { out.push(id); if (out.length >= Math.max(1, pax)) return out; } } return out; })();
  const [type, setType] = useState(cfg.types[0].code);
  const [picks, setPicks] = useState(() => firstFree.slice(0, Math.max(1, pax)));
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const seatLabel = (id) => id.split("-")[0];
  const seatRow = (id) => parseInt(id, 10);
  const feeInfo = (id) => cfg.fee(seatRow(id));
  const feeOf = (id) => feeInfo(id).price;
  const toggle = (id) => {
    if (takenSet.has(id)) return;
    setPicks((cur) => cur.includes(id) ? cur.filter(s => s !== id) : (cur.length >= pax ? [...cur.slice(1), id] : [...cur, id]));
  };
  const total = picks.reduce((s, id) => s + feeOf(id), 0);
  const label = picks.map(seatLabel).join(", ");
  const seatClass = (id) => {
    if (picks.includes(id)) return "bg-lime text-ink ring-2 ring-tap-green";
    if (takenSet.has(id)) return "bg-surface-mute text-ink-faint cursor-not-allowed";
    if (winSet.has(id)) return "bg-[#E8C75A]/60 text-ink";
    if (legSet.has(id)) return "bg-tap-green/50 text-white";
    return "bg-surface border border-line hover:border-tap-green text-ink";
  };
  const abreast = cfg.blocks.reduce((s, b) => s + b.length, 0);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-[1080px] my-6 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[22px] font-bold">Choose your seat</h2>
            <p className="text-[13px] text-ink-muted mt-0.5">Pick seats for every traveller — we confirm the fare difference before you pay.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 w-9 h-9 rounded-full hover:bg-surface-mute inline-flex items-center justify-center"><Icon name="x" size={18} /></button>
        </div>

        <div className={cx("grid gap-3 mt-4", cfg.types.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-4")}>
          {cfg.types.map((s) => {
            const on = type === s.code;
            return (
              <button key={s.code} onClick={() => setType(s.code)} className={cx("text-left rounded-xl border p-3 relative", on ? "border-tap-green ring-1 ring-tap-green bg-surface" : "border-line")}>
                {on && <span className="absolute top-2.5 right-2.5 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-tap-green text-white">Selected</span>}
                <div className="text-[13px] font-bold">{s.name}</div>
                <div className="text-[20px] font-black v2-num mt-0.5">{s.price ? eur2(s.price) : "Included"}</div>
                <div className="text-[11px] text-ink-faint mt-1">{s.sub}</div>
                <div className="text-[11px] text-tap-greenDeep font-semibold mt-2">{s.note}</div>
                <span className={cx("mt-2 inline-flex items-center justify-center w-full rounded-full py-1.5 text-[12px] font-semibold", on ? "bg-tap-green text-white" : "border border-line-strong text-ink")}>{on ? "Active" : "Switch"}</span>
              </button>
            );
          })}
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-5 mt-5 items-start">
          <div className="rounded-2xl border border-line p-4">
            <div className="text-center text-[15px] font-bold">{aircraft || cfg.aircraftFallback} · {cabin} cabin</div>
            <div className="text-center text-[11px] font-semibold text-ink-faint mt-1">{cfg.blocks.map(b => b.length).join("-")} layout · {abreast} across</div>
            <div className="text-center text-[11px] font-semibold text-ink-faint mb-3">Front</div>
            <div className={cx("flex justify-center", cfg.blockGap)}>
              {cfg.blocks.map((cols, b) => (
                <div key={b} className={cfg.rowGap}>
                  <div className={cx("flex justify-center text-[11px] font-bold text-ink-faint", cfg.colGap)}>{cols.map((c, i) => <span key={i} className={cx(cfg.colW, "text-center")}>{c}</span>)}</div>
                  {rowsArr.map((row) => (
                    <div key={row} className={cx("flex items-center relative", cfg.colGap)}>
                      {b === 0 && <span className="absolute -left-5 text-[10px] text-ink-faint w-3 text-right">{row}</span>}
                      {cols.map((c, ci) => {
                        const id = row + c + "-" + b;
                        return <button key={ci} disabled={takenSet.has(id)} onClick={() => toggle(id)} className={cx(cfg.seatW, "rounded-lg text-[10px] font-bold inline-flex items-center justify-center", seatClass(id))}>{row}{c}</button>;
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="h-px bg-line my-3" />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-muted justify-center">
              {cfg.legend.map(([cl, lb]) => <span key={lb} className="inline-flex items-center gap-1.5"><span className={cx("w-3.5 h-3.5 rounded", cl)} />{lb}</span>)}
            </div>
          </div>

          <div className="space-y-4">
            {cfg.upsell
              ? <div className="rounded-2xl border-2 border-lime bg-lime-tint/60 p-4">
                  <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-surface-dark text-lime">New · Non-status flyer</span>
                  <div className="text-[16px] font-bold mt-2">Buy premium without status</div>
                  <p className="text-[11px] text-ink-muted mt-1">Get every status-only perk for one flight — front cabin, priority boarding, lounge, hot meal, +2× miles.</p>
                  <div className="mt-2"><span className="text-[22px] font-black v2-num">€89</span> <span className="text-[11px] text-ink-faint">per passenger · vs €189 cabin</span></div>
                  <button className="mt-3 w-full rounded-full bg-tap-greenDeep text-white py-2.5 text-[13px] font-semibold">Unlock NSF · {eur2(89 * pax)} for {pax}</button>
                </div>
              : <div className="rounded-2xl border border-tap-green/40 bg-lime-tint/40 p-4">
                  <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-tap-greenDeep text-white">{cabin} cabin</span>
                  <div className="text-[15px] font-bold mt-2">{cabin === "Business" ? "Lie-flat suites · all included" : "Wider seats · all included"}</div>
                  <p className="text-[11px] text-ink-muted mt-1">{cabin === "Business" ? "Every seat is a lie-flat suite with direct aisle access — lounge & priority included, no extra seat fee." : "Premium seats include extra legroom and recline. Pick any open seat at no extra charge."}</p>
                </div>}
            <div className="rounded-2xl border border-line p-4">
              <div className="text-[14px] font-bold">Your selection</div>
              <div className="mt-2 space-y-2">
                {picks.length === 0 && <div className="text-[12px] text-ink-faint">Tap a seat to assign it.</div>}
                {picks.map((id, i) => (
                  <div key={id} className="flex items-center justify-between text-[12px]">
                    <span className="inline-flex items-center gap-2"><span className="w-6 h-6 rounded-full bg-lime text-ink text-[10px] font-bold inline-flex items-center justify-center">{seatLabel(id)}</span><span>{SEAT_PAX_NAMES[i] || `Passenger ${i + 1}`} · {feeInfo(id).tag}</span></span>
                    <span className="font-semibold v2-num">{feeOf(id) ? eur2(feeOf(id)) : "Free"}</span>
                  </div>
                ))}
              </div>
              <div className="h-px bg-line my-3" />
              <div className="flex items-center justify-between"><span className="text-[13px] font-bold">Seats total</span><span className="text-[16px] font-black v2-num">{eurC(total)}</span></div>
              <Btn size="lg" className="w-full mt-3" disabled={picks.length === 0} onClick={() => onConfirm(label, total)}>Confirm seats →</Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ CART · View & customize (8 modules) ═══════════ */
/* #22 — basket line-item editors: every modification link opens a real, functional editor. */
const EDIT_CONFIG = {
  "Change room": { title: "Change room · Memmo Príncipe Real", kind: "select", opts: [
    { name: "Hotel — Memmo Príncipe Real · Classic Double", sub: "City view · 22m² · breakfast", delta: -90 },
    { name: "Hotel — Memmo Príncipe Real", sub: "Deluxe · garden view · 28m² · breakfast", delta: 0 },
    { name: "Hotel — Memmo Príncipe Real · Junior Suite", sub: "Terrace · 40m² · breakfast + minibar", delta: 150 },
  ] },
  "Change vehicle": { title: "Change vehicle", kind: "select", opts: [
    { name: "Airport transfer · Private sedan", sub: "Up to 3 pax · 3 bags", delta: 0 },
    { name: "Airport transfer · Premium SUV", sub: "Up to 5 pax · 5 bags", delta: 22 },
    { name: "Airport transfer · Minivan", sub: "Up to 7 pax · 7 bags", delta: 38 },
  ] },
  "Change plan": { title: "Change insurance plan", kind: "select", opts: [
    { name: "Travel Insurance · Standard", sub: "Medical €25K · baggage", delta: -12 },
    { name: "Travel Insurance · Plus", sub: "Medical €50K · cancellation · 24/7", delta: 0 },
    { name: "Travel Insurance · Premium", sub: "Medical €150K · cancel for any reason", delta: 24 },
  ] },
  "Change lounge": { title: "Change lounge", kind: "select", opts: [
    { name: "TAP Lounge · OPO", sub: "Hot meals · showers · Wi-Fi", delta: 0 },
    { name: "ANA Premium Lounge · OPO", sub: "À la carte · quiet zone · spa chairs", delta: 16 },
  ] },
  "Edit time": { title: "Edit pickup time", kind: "time", field: "time", def: "14:15" },
  "Change date": { title: "Change activity date", kind: "date", field: "date" },
  "View hotel": { title: "Memmo Príncipe Real · Lisbon", kind: "info", body: [
    "5★ boutique hotel in Príncipe Real with a rooftop pool, spa and fine-dining restaurant.",
    "9.2 Excellent · 1,240 reviews · Free cancellation up to 48h before check-in.",
    "Walking distance to Bairro Alto, the botanical gardens and the best restaurants in town.",
  ] },
  "Compare plans": { title: "Compare insurance plans", kind: "compare", cols: ["Standard", "Plus", "Premium"], rows: [
    ["Medical cover", "€25K", "€50K", "€150K"],
    ["Trip cancellation", "—", "✓", "✓ any reason"],
    ["Baggage protection", "✓", "✓", "✓"],
    ["24/7 assistance", "—", "✓", "✓"],
  ] },
  "Compare plans ": null,
};
function ItemEditModal({ item, link, onClose, onApply }) {
  const cfg = EDIT_CONFIG[link] || { title: link, kind: "info", body: ["This option isn't editable in the demo."] };
  const [val, setVal] = useState(item[cfg.field] || cfg.def || "");
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-[460px] p-6" onClick={ev => ev.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 className="text-[18px] font-bold leading-tight">{cfg.title}</h2>
          <button onClick={onClose} aria-label="Close" className="shrink-0 w-8 h-8 rounded-full hover:bg-surface-mute inline-flex items-center justify-center"><Icon name="x" size={16} /></button>
        </div>
        {cfg.kind === "select" && <div className="space-y-2">
          {cfg.opts.map((o, i) => {
            const cur = item.name === o.name;
            return (
              <button key={i} onClick={() => { onApply(item, { name: o.name, price: Math.max(0, +(item.price + o.delta).toFixed(2)) }); onClose(); }} className={cx("w-full text-left rounded-xl border p-3 flex items-center justify-between gap-3 transition-colors hover:border-tap-green", cur ? "border-tap-green bg-lime-tint/30 ring-1 ring-tap-green" : "border-line")}>
                <div className="min-w-0"><div className="text-[14px] font-bold truncate">{o.name.replace(/^[^·]+· /, "")}</div><div className="text-[11px] text-ink-faint mt-0.5">{o.sub}</div></div>
                <span className="text-[13px] font-bold v2-num shrink-0">{o.delta === 0 ? (cur ? "Current" : "Included") : (o.delta > 0 ? "+" : "−") + eur2(Math.abs(o.delta))}</span>
              </button>
            );
          })}
        </div>}
        {(cfg.kind === "time" || cfg.kind === "date") && <div>
          <input type={cfg.kind} value={val} onChange={ev => setVal(ev.target.value)} className="w-full bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-tap-green" />
          <Btn className="w-full mt-3" disabled={!val} onClick={() => { onApply(item, { [cfg.field]: val }); onClose(); }}>Save</Btn>
        </div>}
        {cfg.kind === "info" && <div className="space-y-2 text-[13px] text-ink-muted">{cfg.body.map((b, i) => <p key={i}>{b}</p>)}<Btn variant="outline" className="w-full mt-3" onClick={onClose}>Close</Btn></div>}
        {cfg.kind === "compare" && <div>
          <div className="overflow-hidden rounded-xl border border-line"><table className="w-full text-[12px]"><thead><tr className="bg-surface-mute"><th className="text-left p-2 font-semibold" /> {cfg.cols.map(c => <th key={c} className="p-2 font-bold text-center">{c}</th>)}</tr></thead><tbody>{cfg.rows.map((row, i) => <tr key={i} className="border-t border-line"><td className="p-2 font-semibold text-ink-muted">{row[0]}</td>{row.slice(1).map((v, j) => <td key={j} className="p-2 text-center">{v}</td>)}</tr>)}</tbody></table></div>
          <Btn variant="outline" className="w-full mt-3" onClick={onClose}>Close</Btn>
        </div>}
      </div>
    </div>
  );
}

function CartView({ go, mode = "cart", shared }) {
  const isBasket = mode === "basket";
  const [, force] = useState(0); const r = () => force(x => x + 1);
  const [carbonOn, setCarbonOn] = useState(() => hasExtra("carbon"));
  // Don't re-seed a recommended basket if the member explicitly cleared it last time; an open
  // saved basket has already been restored on login, so seedExtras() is a no-op in that case.
  useEffect(() => { if (trip.outbound && shared?.basket?.status !== "cleared") seedExtras(); r(); }, []);
  // #23 — Carbon offset is auto-added (default ON): mirror it as a real cart line so it shows in the basket and counts toward the total.
  useEffect(() => { if (!hasExtra("carbon")) { toggleExtra({ code: "carbon", name: "Carbon offset", price: 10, cat: "Carbon offset", source: "auto" }); setCarbonOn(true); r(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Insurance is mandatory and pre-selected to the recommended Plus plan. Reflect that pre-selection
  // in the basket/total from first render (not only after the user re-picks a plan) so any extra
  // that is pre-selected for the user is counted in the summary from the start.
  useEffect(() => { if (trip.outbound && !hasExtra("ins-plus") && !hasExtra("ins-std")) { const px = trip.pax || 1; toggleExtra({ code: "ins-plus", name: `Travel Insurance · Plus × ${px}`, price: 38 * px, cat: "Insurance", source: "auto" }); r(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!trip.outbound) return noTrip(go);
  const save = () => api.post("/basket", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code), snapshot: tripSnapshot() }).catch(() => {});
  const add = (code, name, price, cat, meta) => { toggleExtra({ code, name, price, cat, ...(meta || {}) }); save(); r(); };
  const clear = () => { clearBasket(); api.post("/basket/clear", { flight_no: trip.outbound?.flight?.flight_no }).catch(() => {}); r(); };
  const seat = trip.extras.find(e => e.cat === "Seats & baggage");
  const pax = trip.pax || 1;
  const cab = fareCabin(trip.outbound?.fare);                 // Economy / Premium / Business
  const fareLabel = trip.outbound?.fare || "Classic";
  const seatIncluded = { Economy: { name: "Standard", sub: "Standard 78cm pitch · auto-assigned" }, Premium: { name: "Premium seat", sub: "Wider seat · recline · priority · included" }, Business: { name: "Business seat", sub: "Lie-flat · lounge access · included" } }[cab] || { name: "Standard", sub: "Standard 78cm pitch · auto-assigned" };
  // #33 — within the selected cabin, keep the included seat AND still offer cabin-appropriate upgrades.
  const SEAT_TYPE_OPTS = {
    Economy: [{ code: "seat-nsf", name: "Next Seat Free", sub: "+10cm legroom · exit-row seats", price: 48 }, { code: "seat-win", name: "Window+", sub: "Window + free middle + legroom", price: 68 }],
    Premium: [{ code: "seat-legroom", name: "Extra legroom", sub: "Bulkhead & front rows · more recline", price: 20 }, { code: "seat-solo", name: "Solo · no neighbour", sub: "Block the seat beside you", price: 40 }],
    Business: [{ code: "seat-throne", name: "Throne seat", sub: "Extra-wide solo suite · single aisle", price: 45 }, { code: "seat-winsuite", name: "Window suite", sub: "Window · do-not-disturb divider", price: 30 }],
  }[cab] || [];
  // #34 — baggage entitlement follows the FARE, not just the cabin: Basic = 0 checked, Classic/Plus = 1, Premium/Executive = 2.
  const fareBags = /exec|premium/i.test(fareLabel) ? 2 : /basic/i.test(fareLabel) ? 0 : 1;
  const tripDays = (() => { try { if (trip.date && trip.ret) { const d = Math.round((new Date(trip.ret) - new Date(trip.date)) / 864e5); if (d > 0) return d; } } catch { } return 5; })();
  const catCount = (cat) => trip.extras.filter(e => e.cat === cat).length;
  const catBadge = (cat) => { const n = catCount(cat); return n ? `${n} added` : null; };
  const [meal, setMeal] = useState("Standard meal");
  const [allHotels, setAllHotels] = useState(false);
  const [ins, setIns] = useState(() => hasExtra("ins-std") ? "standard" : hasExtra("ins-plus") ? "plus" : "plus");
  const [seatMapOpen, setSeatMapOpen] = useState(false);
  const confirmSeats = (lbl, tot) => {
    const ex = trip.extras.find(e => e.code === "seat-map");
    if (ex) toggleExtra(ex);
    toggleExtra({ code: "seat-map", name: `Seats · ${lbl}`, price: tot, cat: "Seats & baggage" });
    save(); r(); setSeatMapOpen(false);
  };

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
  const HotelRow = ({ code, name, stars, tags, rating, reviews, pn, total, rec }) => { const on = hasExtra(code); const nn = tripDays; const tot = pn > 0 ? pn * nn : total; return (
    <div className={cx("flex gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
      <Img seed={"hotel-" + code} src={imageFor("hotel-" + code)} alt={name} className="w-28 h-20 rounded-lg shrink-0 object-cover" />
      <div className="flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-[14px] font-bold">{name}</span><span className="text-[#E8C75A]">{"★".repeat(stars)}</span>{rec && <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-surface-dark text-lime">Recommended</span>}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">{tags.map(t => <span key={t} className="text-[10px] uppercase tracking-wide text-ink-faint">{t}</span>)}</div>
        <div className="text-[11px] text-ink-muted mt-1">★ {rating} Excellent · {reviews} reviews</div></div>
      <div className="text-right shrink-0"><div className="v2-num"><span className="text-[11px] font-bold text-ink">From </span><span className="text-[16px] font-bold text-ink">{eur2(pn)}</span><span className="text-[11px] font-medium text-ink-faint"> / night</span></div><div className="text-[11px] text-ink-faint v2-num">{eur2(tot)} total for {nn} night{nn !== 1 ? "s" : ""}</div><Btn size="sm" variant={on ? "outline" : "primary"} className="mt-1.5" onClick={() => add(code, name, tot, "Hotels", { rate: pn, nights: nn })}>{on ? "✓ Added" : "Add to cart"}</Btn></div>
    </div>
  ); };
  const Row = ({ code, name, sub, rate, unit, cat, tag }) => {
    const on = hasExtra(code);
    const mult = unit === "per person" ? pax : unit === "per day" ? tripDays : 1;
    const total = rate * mult;
    const multLabel = unit === "per person" ? `× ${pax} = ${eur2(total)}` : unit === "per day" ? `${tripDays} days = ${eur2(total)}` : unit === "per car" ? "per car" : "";
    return (
      <div className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
        <Img seed={"xfer-" + code} src={imageFor(code)} alt={name} className="w-20 h-16 rounded-lg shrink-0 object-cover" />
        <div className="flex-1"><div className="text-[13px] font-semibold flex items-center gap-2">{name}{tag && <span className="text-[9px] font-bold uppercase tracking-wide text-ink-faint bg-surface-mute rounded px-1.5 py-0.5">{tag}</span>}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
        <div className="text-right shrink-0">
          <div className="text-[14px] font-bold v2-num">{eur2(rate)}</div>
          {multLabel && <div className="text-[10px] text-ink-faint v2-num">{multLabel}</div>}
          <Btn size="sm" variant="outline" className="mt-1" onClick={() => add(code, name, total, cat)}>{on ? "✓ Added" : "+ Add to cart"}</Btn>
        </div>
      </div>
    );
  };
  const Plan = ({ v, name, kicker, price, total, points, badge }) => {
    const on = ins === v;
    const select = () => {
      setIns(v);
      const cur = trip.extras.find(x => x.code === "ins-plus" || x.code === "ins-std");
      if (cur) toggleExtra(cur);
      if (v === "plus") toggleExtra({ code: "ins-plus", name: `Travel Insurance · Plus × ${pax}`, price: 38 * pax, cat: "Insurance" });
      else if (v === "standard") toggleExtra({ code: "ins-std", name: `Travel Insurance · Standard × ${pax}`, price: 19 * pax, cat: "Insurance" });
      save(); r();
    };
    return (
      <div className={cx("flex-1 rounded-xl border p-4 flex flex-col", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line")}>
        <button onClick={select} className="flex items-start gap-2.5 text-left w-full">
          <span className={cx("mt-0.5 w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2"><div className="text-[15px] font-bold leading-tight">{name}</div>{badge && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded bg-surface-dark text-lime">{badge}</span>}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint mt-0.5">{kicker}</div>
          </div>
        </button>
        <ul className="mt-3 space-y-1.5 text-[12px] flex-1">{points.map(([ok, p]) => <li key={p} className={cx("flex items-center gap-2", !ok && "text-ink-faint")}><Icon name={ok ? "check" : "x"} size={13} className={ok ? "text-tap-green" : "text-ink-faint"} /> {p}</li>)}</ul>
        <div className="h-px bg-line my-3" />
        {price != null
          ? <div className="flex items-end justify-between"><div className="text-[18px] font-bold v2-num">{eur2(price)}<span className="text-[10px] font-medium text-ink-faint"> per traveler</span></div>{total != null && <div className="text-right"><div className="text-[14px] font-bold v2-num text-tap-greenDeep">{eur2(total)}</div><div className="text-[9px] uppercase tracking-wide text-ink-faint">Total · {pax} {pax > 1 ? "adults" : "adult"}</div></div>}</div>
          : <div className="text-[12px] text-ink-muted">No charge — you confirm you're covered elsewhere.</div>}
      </div>
    );
  };

  return (
    <div className="bg-surface-soft min-h-screen">
      {seatMapOpen && <SeatMapModal pax={pax} cabin={cab} aircraft={trip.outbound?.flight?.aircraft} onClose={() => setSeatMapOpen(false)} onConfirm={confirmSeats} />}
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
              <div className="flex items-center justify-between mb-2"><Eyebrow>Choose your seat type · per passenger · both flights</Eyebrow><button onClick={() => setSeatMapOpen(true)} className="text-[12px] font-semibold text-tap-greenDeep shrink-0 hover:underline">Full Cabin View</button></div>
              <div className="flex flex-col sm:flex-row gap-3"><SeatType code="std" name={seatIncluded.name} sub={seatIncluded.sub} />{SEAT_TYPE_OPTS.map(o => <SeatType key={o.code} code={o.code} name={o.name} sub={o.sub} price={o.price} />)}</div>
              <Eyebrow className="mt-4 mb-2">Baggage · what's included with {fareLabel} fare</Eyebrow>
              <div className="space-y-2"><Bag name="Carry-on bag · 8kg" sub="1 piece per traveller · 55×40×20 cm" locked />{fareBags >= 1 ? <Bag name={fareBags === 2 ? "2× Checked bags · 23kg" : "Checked bag · 23kg"} sub={`${fareBags} piece${fareBags > 1 ? "s" : ""} per traveller · included with ${fareLabel} fare`} locked /> : <Bag code="bag-checked" name="Checked bag · 23kg" sub={`Not included in ${fareLabel} · add one`} price={30} />}<Bag code="bag-extra" name={fareBags >= 1 ? "Extra checked bag · 23kg" : "Second checked bag · 23kg"} sub="Add another bag · saves €15 vs airport" price={55} /></div>
            </Module>

            <Module n="02" icon="leaf" kicker="Carbon offset" title="Carbon offset" sub="Auto-checked · uncheck if you wish" right={<div className="text-right"><span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-[#fff4d6] text-[#9a6b00]">Opt-out</span><div className="text-[10px] text-tap-greenDeep font-semibold mt-1">Default ON in EU (climate)</div></div>}>
              <label className={cx("flex items-center gap-3 rounded-xl border p-3", carbonOn ? "border-tap-green bg-lime-tint/40" : "border-line")}>
                <span className={cx("w-5 h-5 rounded-md border-2 inline-flex items-center justify-center shrink-0 cursor-pointer", carbonOn ? "bg-tap-green border-tap-green text-white" : "bg-surface border-line-strong text-transparent")} onClick={() => { const next = !carbonOn; setCarbonOn(next); if (next !== hasExtra("carbon")) toggleExtra({ code: "carbon", name: "Carbon offset", price: 10, cat: "Carbon offset", source: "auto" }); save(); r(); }}><Icon name="check" size={13} className="stroke-[3]" /></span>
                <div className="flex-1 text-[13px] font-semibold">{carbonOn ? "Auto-added" : "Offset this trip's emissions"}</div>
                <div className="text-[13px] font-bold v2-num">{eur2(10)}</div>
              </label>
            </Module>

            <Module n="03" icon="home" kicker="Hotels" title="Stay in Lisbon" badge={catBadge("Hotels")} sub="Recommended hotels for your dates." right={<button onClick={() => setAllHotels(v => !v)} className="text-[12px] font-semibold text-tap-greenDeep">{allHotels ? "Show less ↑" : "View all hotels →"}</button>}>
              <div className="space-y-2">
                <HotelRow code="hotel-memmo" name="Memmo Príncipe Real" stars={4} tags={["Near city centre", "Free cancellation", "Breakfast"]} rating="9.2" reviews="1,284" pn={80} total={640} rec />
                <HotelRow code="hotel-bairro" name="Bairro Alto Suites" stars={4} tags={["City centre", "Free cancellation"]} rating="8.7" reviews="962" pn={68} total={544} />
                <HotelRow code="hotel-quinta" name="Quinta da Marinha · Cascais" stars={4} tags={["Beach", "Pool", "Resort"]} rating="9.0" reviews="538" pn={120} total={960} />
                {allHotels && <>
                  <HotelRow code="hotel-tivoli" name="Tivoli Avenida Liberdade" stars={5} tags={["Avenida", "Spa", "Free cancellation"]} rating="9.4" reviews="2,015" pn={210} total={1680} />
                  <HotelRow code="hotel-lx" name="LX Boutique Hotel" stars={4} tags={["Cais do Sodré", "River view"]} rating="8.5" reviews="744" pn={72} total={576} />
                </>}
              </div>
            </Module>

            <Module n="04" icon="swap" kicker="Cars & transfers" title="Getting to and from the airport" badge={catBadge("Cars & transfers")} sub="Pick how you move between LIS and your hotel.">
              <div className="space-y-2">
                <Row code="car-lis" name="Private transfer · LIS → hotel" sub="Sedan · meet & greet · up to 3 bags" rate={25} unit="per car" cat="Cars & transfers" tag="1-way" />
                <Row code="car-shuttle" name="Shared shuttle" sub="8-seat van · scheduled · 30 min wait max" rate={15} unit="per person" cat="Cars & transfers" tag="per person" />
                <Row code="car-rental" name="Car rental from LIS" sub="Compact, automatic · free 24h cancellation" rate={40} unit="per day" cat="Cars & transfers" tag="per day" />
              </div>
            </Module>

            <Module n="05" icon="shield" kicker="Insurance" title="Protect your trip" badge="Mandatory" sub="Choose a plan that covers cancellation, medical, and baggage.">
              <div className="grid sm:grid-cols-3 gap-3">
                <Plan v="none" name="I already have coverage" kicker="My travel insurance is sorted" points={[[true, "Health coverage"], [true, "Trip cancellation protection"], [true, "Baggage loss"], [false, "COVID-19 protection"], [false, "24/7 support service"]]} />
                <Plan v="standard" name="Standard" kicker="Essential cover" price={19} total={19 * pax} points={[[true, "Medical · €25K"], [true, "Trip cancellation"], [true, "Lost baggage"], [false, "COVID-19 cover"], [false, "24/7 concierge"]]} />
                <Plan v="plus" name="Plus" kicker="Comprehensive cover" badge="Recommended" price={38} total={38 * pax} points={[[true, "Medical · €50K"], [true, "Trip cancellation"], [true, "Lost baggage"], [true, "COVID-19 cover"], [true, "24/7 concierge"]]} />
              </div>
              {ins !== "none"
                ? <button onClick={() => { setIns("none"); const cur = trip.extras.find(x => x.code === "ins-plus" || x.code === "ins-std"); if (cur) { toggleExtra(cur); save(); } r(); }} className="mt-3 w-full rounded-full border border-line-strong py-2.5 text-[13px] font-semibold text-ink-muted hover:border-tap-green hover:text-tap-greenDeep inline-flex items-center justify-center gap-1.5">Proceed without insurance</button>
                : <div className="mt-3 text-[12px] text-tap-greenDeep font-semibold inline-flex items-center gap-1.5"><Icon name="check" size={14} /> Proceeding without TAP insurance — you confirm you're covered elsewhere.</div>}
            </Module>

            <Module n="06" icon="star" kicker="Lounge & priority" title="Relax and skip the queues" badge={catBadge("Lounge & services")} sub="Quality time before the flight — drinks, food, fast-track lanes.">
              <div className="space-y-2">
                <Row code="lounge-opo" name="TAP Lounge · OPO" sub="Hot meals · drinks · showers · Wi-Fi · up to 3h pre-flight" rate={90} cat="Lounge & services" tag="OPO outbound" />
                <Row code="priority" name="Priority boarding" sub="Skip the queue · board first · stow your bag first" rate={16} cat="Lounge & services" tag="both flights" />
                <Row code="fasttrack" name="Fast-track security · LIS arrival" sub="Dedicated immigration lane on arrival in Lisbon" rate={18} cat="Lounge & services" tag="LIS arrival" />
              </div>
            </Module>

            <Module n="07" icon="bag" kicker="Meals" title="Meals & onboard extras" badge={catCount("Onboard") ? catBadge("Onboard") : null} sub="Pick a meal for each traveller. We confirm 24h before departure.">
              <div className="grid sm:grid-cols-4 gap-3">
                {[["Standard meal", "Chef-curated 3-course", 0], ["Vegetarian", "Plant-based · seasonal", 0], ["Premium meal", "Tasting menu", 28], ["Skip meal", "No meal · sleep", 0]].map(([n, s, p]) => {
                  const on = meal === n;
                  const select = () => {
                    setMeal(n);
                    const e = trip.extras.find(x => x.code === "meal-prem");
                    if (n === "Premium meal") { if (!hasExtra("meal-prem")) { toggleExtra({ code: "meal-prem", name: `Premium meal × ${pax}`, price: 28 * pax, cat: "Onboard" }); save(); } }
                    else if (e) { toggleExtra(e); save(); }
                    r();
                  };
                  return <button key={n} onClick={select} className={cx("text-left rounded-xl border p-3 flex flex-col", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line")}><div className="flex items-start justify-between gap-2"><div className="text-[13px] font-bold">{n}</div><span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span></div><div className="text-[10px] text-ink-faint flex-1 mt-0.5">{s}</div><div className="h-px bg-line my-2" /><div className="text-[11px] font-semibold">{p ? <span className="v2-num">{eur2(p)} <span className="text-[10px] text-ink-faint font-normal">per pax</span></span> : on ? <span className="text-tap-greenDeep">Included</span> : <span className="text-ink-faint font-normal">{n === "Skip meal" ? "No meal" : "Free"}</span>}</div></button>;
                })}
              </div>
            </Module>

            <Module n="08" icon="globe" kicker="Experiences" title="Experiences in Portugal" badge={catBadge("Experiences")} sub="Curated tours and tastings for your dates. Skip the lines.">
              <div className="grid sm:grid-cols-3 gap-3">
                {[["exp-belem", "Belém food walking tour", "3h · pastéis de Belém · small group · English guide", 65, "Experience"], ["exp-sintra", "Sintra full-day", "Pena Palace · Quinta da Regaleira · Cabo da Roca", 89, "Day trip · popular"], ["exp-douro", "Douro Valley wine tour", "Vineyards · tastings · river cruise · full day", 120, "Wine"], ["exp-fado", "Fado night experience", "Traditional Portuguese music · 3-course dinner · port wine", 75, "Night out"], ["exp-surf", "Surf lesson · Cascais", "2h · gear included · beginners welcome", 55, "Outdoor"], ["exp-train", "Lisbon–Porto train", "2h45 · 1st class · day-trip ready", 39, "Excursion"]].map(([code, name, sub, price, tag]) => {
                  const on = hasExtra(code); const tot = price * (trip.pax || 2);
                  const parts = String(tag).split("·").map(s => s.trim()); const popular = parts.some(p => /popular/i.test(p)); const catLabel = parts.filter(p => !/popular/i.test(p)).join(" · ") || parts[0];
                  return <div key={code} className={cx("rounded-xl border overflow-hidden", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line")}><Img seed={"exp-" + code} src={imageFor(code)} alt={name} className="h-28 w-full object-cover" /><div className="p-3"><div className="flex items-center gap-1.5"><Pill tone="slate">{catLabel}</Pill>{popular && <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-surface-dark text-lime">Popular</span>}</div><div className="text-[13px] font-bold mt-1">{name}</div><div className="text-[10px] text-ink-faint">{sub}</div><div className="flex items-end justify-between mt-2 gap-2"><div><div className="text-[14px] font-bold v2-num">{eur2(price)}</div><div className="text-[10px] text-ink-faint">per person</div>{on && <div className="text-[10px] text-ink-faint v2-num">× {trip.pax || 2} = {eur2(tot)}</div>}</div><Btn size="sm" variant="outline" className="shrink-0" onClick={() => add(code, name, price * (trip.pax || 2), "Experiences")}>{on ? "✓ Added" : "+ Add to cart"}</Btn></div></div></div>;
                })}
              </div>
            </Module>
          </div>
          {isBasket
            ? <BasketSummary basket onClear={clear} cta={`Checkout and pay ${EUR(tripTotals().total)}`} onCta={() => go("payment")} secondary="Continue browsing flights" onSecondary={() => go("home")} note="Price locked for 15 min · free 24h cancellation" />
            : <BasketSummary step={2} user={shared?.profile?.user} onClear={clear} onMilesSwitch={() => go("payment")} cta="Review my trip basket →" onCta={() => go("basket")} secondary="Skip review & continue to passenger" onSecondary={() => go("passenger")} />}
        </div>
      </div>
    </div>
  );
}

// Two journeys share the same trip + modules:
//  • Cart   — step 3 of the linear booking flow → continues to passenger details.
//  • Basket — the persistent basket opened from the nav → checks out & pays directly.
export function Cart(props) { return <CartView {...props} mode="cart" />; }
// My Trip Basket — a read-only review of the whole trip (flights anchor + extras grouped by
// section), step 3 of the linear flow and the page the nav cart opens. Continues to passenger.
export function Basket({ shared, go }) {
  const [, force] = useState(0); const r = () => force(x => x + 1);
  const [editItem, setEditItem] = useState(null);   // #22 — { item, link } for the active line-item editor (hook must precede any early return)
  useEffect(() => { if (trip.pnr) resetTrip(); }, []);   // #32 — a confirmed booking must not linger as a stale basket on a direct revisit
  if (!trip.outbound) return noTrip(go);
  const t = tripTotals();
  const ob = trip.outbound, ib = trip.inbound;
  const obf = ob?.flight || {}, ibf = ib?.flight || {};
  const nights = (() => { try { if (trip.date && trip.ret) { const d = Math.round((new Date(trip.ret) - new Date(trip.date)) / 864e5); if (d > 0) return d; } } catch { } return 8; })();
  const itemCount = trip.extras.length + 1;
  const clear = () => { clearBasket(); api.post("/basket/clear", { flight_no: trip.outbound?.flight?.flight_no }).catch(() => {}); r(); };
  const SECTIONS = [
    ["Hotels", "Stay & accommodation", "home"],
    ["Cars & transfers", "Transfers & car hire", "swap"],
    ["Lounge & services", "Lounge & priority", "star"],
    ["Onboard", "Meals & onboard", "bag"],
    ["Seats & baggage", "Seats & baggage", "seat"],
    ["Experiences", "Experiences in Portugal", "globe"],
    ["Insurance", "Travel protection", "shield"],
    ["Carbon offset", "Carbon offset", "leaf"],
    ["Extras", "Other extras", "cart"],
  ];
  const byCat = (c) => trip.extras.filter(e => e.cat === c);
  const cityOf = (c) => shared?.airports?.find(a => a.code === c)?.city || c;
  const persist = () => api.post("/basket", { flight_no: trip.outbound?.flight?.flight_no, items: trip.extras.map(e => e.code), snapshot: tripSnapshot() }).catch(() => {});
  const remove = (e) => { toggleExtra(e); persist(); r(); };
  const setQty = (e, d) => { e.qty = Math.max(1, (e.qty || 1) + d); pingBasket(); persist(); r(); };
  const applyEdit = (item, changes) => { Object.assign(item, changes); pingBasket(); persist(); r(); };   // #22 — mutate the basket line in place
  const dateRange = `${fmtDate(trip.date).replace(/ \d{4}/, "")} – ${fmtDate(trip.ret).replace(/ \d{4}/, "")}`;
  const dateOne = fmtDate(trip.date).replace(/ \d{4}/, "");
  // per-category card detail (sub, chips, action links, per-unit price, quantity-editable) — Tab 6 #3/#5
  const cardMeta = (e, cat) => {
    const px = trip.pax || 1, plural = px > 1 ? "s" : "";
    switch (cat) {
      case "Hotels": { const nn = e.nights || nights, rt = e.rate || (nn > 0 ? Math.round(e.price / nn) : e.price);
        return { sub: `Deluxe room · ${px} adult${plural} · Breakfast included · Free cancellation`, chips: [dateRange, `${nn} nights`, "★ 9.2 Excellent"], links: ["Change room", "View hotel"], perUnit: `${eur2(rt)} × ${nn} nights`, qty: false }; }
      case "Cars & transfers":
        return { sub: "Private sedan · Meet & greet · Up to 3 bags · English-speaking driver", chips: [`${dateOne} · ${e.time || "14:15"}`, "One-way", `${px} pax`], links: ["Change vehicle", "Edit time"], perUnit: `${eur2(e.price)} per car`, qty: true };
      case "Insurance":
        return { sub: "Medical up to €50K · Baggage protection · Trip cancellation · 24/7 assistance", chips: [dateRange, `${px} traveler${plural}`, "Recommended"], links: ["Change plan", "Compare plans"], perUnit: `${eur2(Math.round(e.price / px))} × ${px} traveler${plural}`, qty: true };
      case "Lounge & services":
        return { sub: "Pre-flight access · Hot meals · Showers · Wi-Fi · 3-hour stay", chips: [dateOne, `${px} adult${plural}`], links: ["Change lounge"], perUnit: `${eur2(Math.round(e.price / px))} × ${px} traveler${plural}`, qty: true };
      case "Experiences":
        return { sub: "Small group · English guide · Local tastings included", chips: [`${e.date ? fmtDate(e.date).replace(/ \d{4}/, "") : dateOne} · 10:00`, `${px} traveler${plural}`], links: ["Change date"], perUnit: `${eur2(Math.round(e.price / px))} × ${px} traveler${plural}`, qty: true };
      default:
        return { sub: CAT_SUB(px, nights)[cat] || cat, chips: [], links: ["Edit"], perUnit: "", qty: false };
    }
  };

  const Leg = ({ label, f, date }) => (
    <div className="py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{label} · {fmtDate(date)} <span className="text-ink-muted font-semibold">{f.flight_no}</span> · {f.aircraft || "A330neo"}</div>
      <div className="flex items-center justify-between mt-1.5 gap-3">
        <div><div className="text-[24px] font-bold leading-none v2-num">{f.dep || "—"}</div><div className="text-[11px] text-ink-faint mt-1">{f.origin}</div></div>
        <div className="flex-1 px-2 text-center text-ink-faint"><div className="text-[11px]">{f.duration || ""}</div><div className="h-px bg-line-strong my-1.5 relative"><span className="absolute right-0 -top-[3px] w-1.5 h-1.5 rounded-full border border-line-strong bg-surface" /></div><div className="text-[11px]">Nonstop · Direct</div></div>
        <div className="text-right"><div className="text-[24px] font-bold leading-none v2-num">{f.arr || "—"}</div><div className="text-[11px] text-ink-faint mt-1">{f.dest}</div></div>
      </div>
    </div>
  );

  return (
    <div className="bg-surface-soft min-h-screen">
      {editItem && <ItemEditModal item={editItem.item} link={editItem.link} onClose={() => setEditItem(null)} onApply={applyEdit} />}
      <Stepper active={2} />
      <div className="mx-auto max-w-content px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[28px] font-bold">My trip cart</h1><Pill tone="slate">{itemCount} items</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">Review and customize everything in your basket before continuing.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Chip dot>{trip.dest ? `${cityOf(trip.dest)} trip` : "Your trip"}</Chip>
          <Chip>{cityOf(trip.origin)}–{cityOf(trip.dest)}</Chip>
          <Chip>{trip.pax} adult{trip.pax > 1 ? "s" : ""}</Chip>
          <Chip>{dateRange}</Chip>
        </div>

        {/* two-column: scrollable content + right-side sticky basket panel (Tab 6 #6) */}
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-6 min-w-0">
            {/* flights anchor — tinted header (#1) + zebra benefits row (#2) */}
            <div>
              <div className="flex items-center gap-2 mb-2"><h2 className="text-[15px] font-bold">Your flights</h2><span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">1 item · Anchor</span></div>
              <Card className="overflow-hidden">
                <div className="bg-surface-soft px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-[12px]"><span className="font-black text-tap-green">TAP</span><span className="text-ink-muted">· {ob?.fare || "Classic"} · Economy</span><span className="inline-flex items-center gap-1 text-[11px] text-ink-muted px-2 py-1 rounded-full bg-surface"><Icon name="globe" size={11} /> Stopover included</span></div>
                  <button onClick={() => go("cart")} className="text-[12px] font-semibold text-tap-greenDeep inline-flex items-center gap-1 hover:underline"><Icon name="search" size={12} /> Change flight</button>
                </div>
                <div className="px-5 pt-1 pb-2">
                  <Leg label={trip.type === "multi" ? "Flight 1" : "Outbound"} f={obf} date={trip.date} />
                  {ib && <><Divider className="my-1" /><Leg label={trip.type === "multi" ? "Flight 2" : "Inbound"} f={ibf} date={trip.ret} /></>}
                </div>
                <div className="bg-surface-2 border-t border-line px-5 py-2.5 flex items-center justify-between flex-wrap gap-2 text-[11px] text-ink-muted">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {["1× carry-on (8kg)", "1× checked bag (23kg)", "Seat selection", "Changes for fee"].map(x => <span key={x} className="inline-flex items-center gap-1"><Icon name="check" size={12} className="text-tap-green" /> {x}</span>)}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Booking ref · Pending</span>
                </div>
              </Card>
            </div>

            {/* extras grouped by section — detailed cards w/ links, qty, Remove (#3,#5) */}
            {SECTIONS.map(([cat, title, icon]) => {
              const items = byCat(cat);
              if (!items.length) return null;
              return (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-2"><h2 className="text-[15px] font-bold">{title}</h2><span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{items.length} item{items.length > 1 ? "s" : ""}</span></div>
                  <div className="space-y-3">
                    {items.map(e => {
                      const meta = cardMeta(e, cat);
                      return (
                        <Card key={e.code} className="p-4">
                          <div className="flex items-start gap-3">
                            {cat === "Hotels"
                              ? <Img seed={e.code} src={imageFor(e.code)} alt={e.name} className="w-14 h-14 rounded-lg shrink-0 object-cover" />
                              : <span className="w-11 h-11 rounded-lg bg-lime-tint inline-flex items-center justify-center shrink-0"><Icon name={icon} size={18} className="text-tap-greenDeep" /></span>}
                            <div className="flex-1 min-w-0">
                              <div className="text-[14px] font-bold">{e.name}</div>
                              <div className="text-[11px] text-ink-faint mt-0.5">{meta.sub}</div>
                              {meta.chips.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{meta.chips.map((c, i) => <span key={i} className="text-[10px] font-medium text-ink-muted bg-surface-mute rounded px-2 py-0.5">{c}</span>)}</div>}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[16px] font-bold v2-num">{eurC(e.price * (e.qty || 1))}</div>
                              {meta.perUnit && <div className="text-[10px] text-ink-faint v2-num">{meta.perUnit}</div>}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 flex-wrap mt-3 pt-3 border-t border-line">
                            <div className="flex gap-4 text-[12px] font-semibold text-tap-greenDeep">{meta.links.map(l => <button key={l} className="hover:underline" onClick={() => setEditItem({ item: e, link: l })}>{l}</button>)}</div>
                            <div className="flex items-center gap-2.5">
                              {meta.qty && <div className="inline-flex items-center rounded-full border border-line"><button onClick={() => setQty(e, -1)} className="w-7 h-7 inline-flex items-center justify-center text-ink-muted hover:text-ink text-[15px] leading-none">−</button><span className="w-7 text-center text-[13px] font-semibold v2-num">{e.qty || 1}</span><button onClick={() => setQty(e, 1)} className="w-7 h-7 inline-flex items-center justify-center text-ink-muted hover:text-ink text-[15px] leading-none">+</button></div>}
                              <button onClick={() => remove(e)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-muted hover:text-tap-red hover:border-tap-red"><Icon name="x" size={12} /> Remove</button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Enhance your trip — curated cross-sell, image-on-top vertical cards: image → badges → title → desc → price/CTA (#4) */}
            <div>
              <div className="flex items-center gap-2 mb-1"><h2 className="text-[15px] font-bold">Enhance your trip</h2><span className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep bg-lime-tint rounded-full px-2 py-0.5">Cross-sell</span></div>
              <p className="text-[12px] text-ink-muted mb-3">Hand-picked extras that pair well with your trip. Each adds to your cart instantly.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  ["xsell-sintra", "Sintra full-day from Lisbon", "Pena Palace, Quinta da Regaleira & Cabo da Roca.", 89, "per person", "Day trip", "Experiences", "sintra,portugal", null],
                  ["xsell-douro", "Douro Valley wine tour", "Vineyards, tastings & a river cruise. Full day.", 120, "per person", "Wine", "Experiences", "douro,vineyard", null],
                  ["xsell-xfer-return", "Return transfer hotel → LIS", "Private sedan · save 10% when paired.", 25, "per car", "Transfer", "Cars & transfers", "car,sedan", "Bundle −10%"],
                  ["xsell-late-checkout", "Guaranteed late checkout", "Stay until 16:00 on departure day.", 40, "one-time", "Hotel add-on", "Extras", "hotel,room", null],
                ].map(([code, name, sub, base, unit, badge, cat, imgkey, accent]) => {
                  const on = hasExtra(code);
                  const px = trip.pax || 1;
                  const addX = () => { toggleExtra({ code, name, price: unit === "per person" ? base * px : base, cat }); persist(); r(); };
                  return (
                    <div key={code} className={cx("rounded-xl border overflow-hidden flex flex-col transition-colors", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line hover:border-tap-green/50")}>
                      <div className="relative h-32 w-full overflow-hidden bg-surface-mute">
                        <Img seed={code} src={imageFor(imgkey)} alt={name} className="w-full h-full object-cover" />
                        <div className="absolute top-2 left-2 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-ink bg-white/90 backdrop-blur-sm rounded px-2 py-0.5 shadow-sm">{badge}</span>
                          {accent && <span className="text-[10px] font-bold uppercase tracking-wide text-white bg-tap-green rounded px-2 py-0.5 shadow-sm">{accent}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col flex-1 p-3">
                        <div className="text-[14px] font-bold leading-tight">{name}</div>
                        <div className="text-[11px] text-ink-faint mt-1 flex-1">{sub}</div>
                        <div className="flex items-end justify-between gap-2 mt-3">
                          <div className="leading-tight"><span className="text-[15px] font-bold v2-num">{eurC(base)}</span> <span className="text-[10px] text-ink-faint">{unit}</span></div>
                          <Btn size="sm" variant="outline" className="shrink-0" onClick={addX}>{on ? "✓ Added" : "+ Add to cart"}</Btn>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 rounded-xl bg-lime-tint/60 text-tap-greenDark text-[12px] font-semibold px-4 py-2.5 inline-flex items-center gap-2"><Icon name="clock" size={13} /> Price locked for 15 min</div>
            </div>
          </div>

          {/* RIGHT — sticky basket summary (#6) */}
          <div className="lg:sticky lg:top-6">
            <Card className="p-5">
              <div className="flex items-start justify-between">
                <div><h2 className="text-[16px] font-bold">My trip basket</h2><div className="text-[11px] text-ink-muted">All amounts in EUR (€)</div></div>
                <span className="text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded px-2 py-1">Step 3/5</span>
              </div>
              <div className="rounded-lg bg-surface-soft px-3 py-2 mt-3">
                <div className="text-[12px] font-semibold">{cityOf(trip.origin)}–{cityOf(trip.dest)} · {trip.pax} adult{trip.pax > 1 ? "s" : ""} · {dateRange}</div>
                <div className="text-[11px] text-ink-faint mt-0.5">{itemCount} items in your trip cart</div>
              </div>
              <div className="space-y-1.5 text-[13px] mt-3">
                <div className="flex items-center justify-between"><span className="text-ink-muted inline-flex items-center gap-1.5">Flights <span className="text-[9px] font-bold uppercase tracking-wide bg-surface-mute text-ink-faint rounded px-1.5 py-0.5">{trip.pax} pax</span></span><span className="font-semibold v2-num">{eur2(t.flights)}</span></div>
                {Object.entries(extrasByCategory()).map(([c, v]) => (
                  <div key={c} className="flex items-center justify-between"><span className="text-ink-muted inline-flex items-center gap-1.5">{c}{c === "Hotels" && <span className="text-[9px] font-bold uppercase tracking-wide bg-surface-mute text-ink-faint rounded px-1.5 py-0.5">{nights} nights</span>}</span><span className="font-semibold v2-num">{eur2(v)}</span></div>
                ))}
                <div className="flex items-center justify-between"><span className="text-ink-muted">Taxes & fees</span><span className="font-semibold v2-num">{eur2(t.taxes)}</span></div>
                {t.bundle > 0 && <div className="flex items-center justify-between"><span className="text-tap-greenDeep font-semibold inline-flex items-center gap-1"><Icon name="spark" size={12} /> Bundle savings</span><span className="font-semibold v2-num text-tap-greenDeep">−{eur2(t.bundle)}</span></div>}
              </div>
              <Divider className="my-3" />
              <div className="flex items-end justify-between">
                <div><div className="text-[14px] font-bold">Total <span className="text-ink-muted font-medium">(in EUR)</span></div><div className="text-[11px] text-ink-muted">No charge yet</div></div>
                <div className="text-right"><div className="text-[26px] font-black v2-num">{eurC(t.total)}</div><div className="text-[10px] text-ink-faint v2-num">{BRL(t.total)}</div></div>
              </div>
              <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Icon name="plane" size={12} /> You'll earn</span><span className="v2-num">{miles(EARN(t.total))} tap.miles</span></div>
              <div className="text-[11px] text-ink-faint mt-3 flex items-center gap-1.5"><Icon name="lock" size={12} /> Secure checkout · Payments by Stripe · Encrypted card data</div>
              <Btn size="lg" className="w-full mt-3" onClick={() => go("passenger")}>Continue to passenger details →</Btn>
              <div className="text-[11px] text-ink-faint text-center mt-2">We won't charge you anything yet · <SessionTimer prefix="price locked" /></div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => go("cart")} className="flex-1 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:border-tap-green inline-flex items-center justify-center gap-1.5">Continue browsing flights →</button>
                {trip.extras.length > 0 && <button onClick={clear} title="Clear all extras" className="rounded-full border border-line-strong px-3 py-2.5 text-[13px] font-semibold text-ink-muted hover:text-tap-red hover:border-tap-red inline-flex items-center justify-center"><Icon name="x" size={13} /></button>}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════ PASSENGER DETAILS ═══════════ */
const FLAG_CTRY = { Portugal: "🇵🇹", Brazil: "🇧🇷", Spain: "🇪🇸", France: "🇫🇷", Germany: "🇩🇪", "United Kingdom": "🇬🇧", Italy: "🇮🇹", "United States": "🇺🇸" };
const FLAG_NAT = { Portuguese: "🇵🇹", Brazilian: "🇧🇷", Spanish: "🇪🇸", French: "🇫🇷", German: "🇩🇪", British: "🇬🇧", Italian: "🇮🇹", American: "🇺🇸" };
const PHONE_CODES = [["+351", "🇵🇹"], ["+55", "🇧🇷"], ["+34", "🇪🇸"], ["+33", "🇫🇷"], ["+49", "🇩🇪"], ["+44", "🇬🇧"]];
function FlagSelect({ value, onChange, options, err }) {
  return <div className={cx("relative w-full bg-surface border rounded-xl", err ? "border-tap-red" : "border-line-strong")}>
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none">{options[value] || "🌐"}</span>
    <select value={value || ""} onChange={e => onChange(e.target.value)} className="w-full bg-transparent pl-9 pr-7 py-2.5 text-[14px] text-ink outline-none appearance-none cursor-pointer">
      <option value="" disabled>Select…</option>{Object.keys(options).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-[11px]">▾</span>
  </div>;
}
// Input with valid (green check) / error (red border) feedback
const VInput = ({ value, onChange, placeholder, err }) => (
  <div className="relative">
    <input value={value || ""} onChange={onChange} placeholder={placeholder} className={cx("w-full bg-surface border rounded-xl px-3 py-2.5 pr-8 text-[14px] text-ink placeholder:text-ink-faint outline-none focus:border-tap-green", err ? "border-tap-red" : value ? "border-tap-green/60" : "border-line-strong")} />
    {err ? <Icon name="x" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tap-red" /> : null}
  </div>
);
// Native date picker with the same valid/error treatment (#8)
const DateInput = ({ value, onChange, err, max, min }) => (
  <input type="date" value={value || ""} max={max} min={min} onChange={onChange} className={cx("w-full bg-surface border rounded-xl px-3 py-2.5 text-[14px] text-ink outline-none focus:border-tap-green cursor-pointer", err ? "border-tap-red" : value ? "border-tap-green/60" : "border-line-strong")} />
);
// Generic dropdown with a visible ▾ affordance so selectable fields don't read as static
// inputs (#7, #8). Mirrors FlagSelect styling minus the flag glyph.
const Select = ({ value, onChange, options, placeholder = "Select…", err }) => (
  <div className={cx("relative w-full bg-surface border rounded-xl", err ? "border-tap-red" : value ? "border-tap-green/60" : "border-line-strong")}>
    <select value={value || ""} onChange={onChange} className="w-full bg-transparent pl-3 pr-8 py-2.5 text-[14px] text-ink outline-none appearance-none cursor-pointer">
      <option value="" disabled>{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-[11px]">▾</span>
  </div>
);
const TITLES = ["Mr", "Ms", "Mrs", "Mx", "Dr"];
const GENDERS = ["Female", "Male", "Non-binary", "Prefer not to say"];
const DOCTYPES = ["Passport", "National ID card", "Residence permit", "Driving licence"];
const LANGS = ["Português (PT)", "Português (BR)", "English", "Español", "Français", "Deutsch", "Italiano"];

// Passenger-page section heading — bold dark title + muted descriptor + lime accent (#4),
// giving the IDENTITY / TRAVEL DOCUMENT / LOYALTY sections real typographic hierarchy.
const PaxSectionTitle = ({ title, sub, info, className }) => (
  <div className={cx("mb-3", className)}>
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[12px] font-black uppercase tracking-[0.12em] text-tap-greenDeep leading-none">{title}</span>
      {info && <Icon name="info" size={12} className="text-ink-faint" />}
      {sub && <span className="text-[11px] text-ink-faint leading-none normal-case tracking-normal font-medium">· {sub}</span>}
    </div>
    <div className="h-[3px] w-9 rounded-full bg-tap-green mt-2" />
  </div>
);

// Mix-method payment row. Defined at module scope (NOT inside Payment's render) so the
// slider input it wraps keeps a stable identity across re-renders — re-creating this
// component on every keystroke remounted the <input type=range> and broke drag (#11).
const MixComp = ({ on, title, sub, right, onToggle, onEdit, children }) => (
  <div className={cx("rounded-xl border p-3.5", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
    <div className="flex items-center gap-3"><button onClick={onToggle} className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-white text-[11px]", on ? "bg-tap-green" : "bg-surface-mute text-ink-faint")}>{on ? "✓" : ""}</button><div className="flex-1"><div className="text-[13px] font-bold">{title}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>{right}<button onClick={onEdit || onToggle} className="text-[12px] font-bold text-tap-greenDeep ml-1 shrink-0 hover:underline">Edit</button></div>
    {children}
  </div>
);

// #19 — Split-payment cart variant: participant-wise allocation, Paid/Pending status, a
// progress bar, outstanding balance and a contextual "Pay my share" CTA (vs the standard summary).
function SplitSummary({ payers, amtFor, total, allocated, leadAmt, paid, onPayShare, onMarkPaid, disabled, busy, onCta, onBack }) {
  const paidCount = paid.size;
  const pct = payers.length ? Math.round((paidCount / payers.length) * 100) : 0;
  const settled = payers.reduce((s, _, i) => s + (paid.has(i) ? (amtFor(i) || 0) : 0), 0);
  const outstanding = +(total - settled).toFixed(2);
  const mismatch = Math.abs(allocated - total) > 0.01;
  const leadPaid = paid.has(0);
  const allPaid = paidCount >= payers.length;
  const pending = payers.length - paidCount;
  const statusOf = (i, p) => paid.has(i) ? "Paid" : p.lead ? "Your share" : "Pending";
  return (
    <aside>
      <Card className="p-5 lg:sticky lg:top-20">
        <div className="flex items-start justify-between">
          <div><div className="font-bold text-[16px]">Split payment</div><div className="text-[11px] text-ink-muted">{payers.length} traveller{payers.length !== 1 ? "s" : ""} · in EUR (€)</div></div>
          <span className="text-[10px] font-bold uppercase tracking-wide bg-[#3b6fd6] text-white rounded px-2 py-1">Step 4/5</span>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-muted"><span>{paidCount} of {payers.length} paid</span><span className="v2-num font-semibold">{eurC(outstanding)} outstanding</span></div>
          <div className="h-2 rounded-full bg-surface-mute mt-1 overflow-hidden"><div className="h-full bg-tap-green rounded-full transition-all" style={{ width: pct + "%" }} /></div>
        </div>
        <div className="mt-3 space-y-2">
          {payers.map((p, i) => {
            const isPaid = paid.has(i);
            return (
              <div key={i} className={cx("flex items-center justify-between gap-2 rounded-lg border px-3 py-2", isPaid ? "border-tap-green/50 bg-lime-tint/30" : "border-line")}>
                <div className="min-w-0"><div className="text-[13px] font-semibold truncate">{p.name}</div><div className="text-[10px] text-ink-faint truncate">{p.lead ? `Card •••• ${p.card}` : p.email}</div></div>
                <div className="text-right shrink-0">
                  <div className="text-[14px] font-bold v2-num">{eurC(amtFor(i))}</div>
                  {isPaid
                    ? <span className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep inline-flex items-center gap-1"><Icon name="check" size={10} /> Paid</span>
                    : p.lead
                      ? <span className="text-[10px] font-bold uppercase tracking-wide text-[#9a6b00]">Your share</span>
                      : <button onClick={() => onMarkPaid(i)} className="text-[10px] font-bold uppercase tracking-wide text-[#9a6b00] hover:text-tap-greenDeep hover:underline">Pending · mark paid</button>}
                </div>
              </div>
            );
          })}
        </div>
        <Divider className="my-3" />
        <div className="flex items-center justify-between"><span className="text-[13px] font-bold">Total charged</span><span className="text-[20px] font-black v2-num">{eurC(total)}</span></div>
        {mismatch && <div className="mt-2 rounded-lg bg-[#fff4d6] text-[#9a6b00] text-[11px] font-semibold px-3 py-2">Allocated {eurC(allocated)} of {eurC(total)} — adjust the shares to match before paying.</div>}
        {!leadPaid
          ? <Btn size="lg" className="w-full mt-4" disabled={disabled || mismatch} onClick={onPayShare}>{`Pay my share · ${eurC(leadAmt)} →`}</Btn>
          : <Btn size="lg" className="w-full mt-4" disabled={disabled} onClick={onCta}>{busy ? "Processing…" : "Complete booking →"}</Btn>}
        {leadPaid && !allPaid && <div className="mt-2 text-center text-[11px] text-ink-muted">Your share is paid. {pending} traveller{pending !== 1 ? "s" : ""} still paying via their link — you can complete now; they settle to their link.</div>}
        {allPaid && <div className="mt-2 text-center text-[11px] font-semibold text-tap-greenDeep">All travellers have paid · ready to confirm</div>}
        <button onClick={onBack} className="w-full text-center text-[12px] font-semibold text-ink-muted mt-3 hover:text-ink">← Back to passenger details</button>
        <div className="mt-3 rounded-xl bg-[#eef4ff] border border-[#d6e3ff] px-3 py-2.5 text-[11px] text-ink-muted">Each traveller pays their own share via their link. You're only charged {eurC(leadAmt)} now; others stay <span className="font-semibold">Pending</span> until they pay.</div>
      </Card>
    </aside>
  );
}

function PaxCard({ idx, lead, prefill, profile, onRemove, showErr, onChange }) {
  const [p, setP] = useState(lead && prefill ? prefill : {});
  const [saveDoc, setSaveDoc] = useState(true);
  const [reqs, setReqs] = useState([]);
  const [reqOpen, setReqOpen] = useState(false);
  const REQ_OPTS = ["Wheelchair assistance", "Special meal — vegetarian", "Special meal — kosher", "Extra legroom", "Travelling with an infant", "Travelling with a pet", "Visual / hearing assistance"];
  const f = (k) => ({ value: p[k] || "", onChange: e => { const v = { ...p, [k]: e.target.value }; setP(v); trip.passengers[idx] = v; onChange && onChange(); } });
  const set = (k, val) => { const v = { ...p, [k]: val }; setP(v); trip.passengers[idx] = v; onChange && onChange(); };
  const err = (k) => showErr && !(p[k] && String(p[k]).trim());
  const src = prefill || profile || {};
  const doPrefill = () => { const v = { ...p, title: src.title || (src.gender === "Female" ? "Ms" : "Mr"), first: src.first, last: src.last, dob: src.dob, gender: src.gender, nat: src.nat, doctype: "Passport", doc: src.doc, docctry: src.docctry, docexp: src.docexp || "2028-11-22" }; setP(v); trip.passengers[idx] = v; onChange && onChange(); };
  useEffect(() => { trip.passengers[idx] = p; onChange && onChange(); }, []);
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 -mx-5 -mt-5 mb-4 px-5 py-4 bg-surface-soft rounded-t-2xl border-b border-line">
        <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{(p.first || "P")[0]}{(p.last || String(idx + 1))[0]}</span>
          <div><div className="font-bold text-[15px] flex items-center gap-2">Passenger {idx + 1}{p.first ? " · " + p.first + " " + (p.last || "") : " · Add details"}<Pill tone="slate">Adult</Pill>{lead && <Pill tone="gold">{src.tier}</Pill>}</div><div className="text-[11px] text-ink-faint">{lead ? "Lead traveler · contact for this booking" : "Required to issue ticket"}</div></div></div>
        <div className="flex items-center gap-2">
          <button onClick={doPrefill} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-tap-green"><Icon name="refresh" size={12} /> Prefill from profile</button>
          {!lead && <button onClick={() => onRemove && onRemove(idx)} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink-muted hover:border-tap-red hover:text-tap-red"><Icon name="x" size={12} /> Remove</button>}
        </div>
      </div>
      <PaxSectionTitle title="Identity" sub="as shown on passport" />
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={<>Title <Req /></>}><Select {...f("title")} options={TITLES} placeholder="Title" err={err("title")} /></Field>
        <Field label={<>First / middle names <Req /></>}><VInput {...f("first")} err={err("first")} /></Field>
        <Field label={<>Last name <Req /></>}><VInput {...f("last")} err={err("last")} /></Field>
        <Field label={<>Date of birth <Req /></>}><DateInput value={p.dob} onChange={e => set("dob", e.target.value)} err={err("dob")} max="2024-12-31" /></Field>
        <Field label={<>Gender <Req /></>}><Select {...f("gender")} options={GENDERS} placeholder="Gender" err={err("gender")} /></Field>
        <Field label={<>Nationality <Req /></>}><FlagSelect value={p.nat} onChange={v => set("nat", v)} options={FLAG_NAT} err={err("nat")} /></Field>
      </div>
      <PaxSectionTitle title="Travel document" sub="Required to issue your boarding pass" info className="mt-4" />
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label={<>Document type <Req /></>}><Select {...f("doctype")} options={DOCTYPES} placeholder="Document type" err={err("doctype")} /></Field>
        <Field label={<>Document number <Req /></>}><VInput {...f("doc")} err={err("doc")} /></Field>
        <Field label={<>Country of issue <Req /></>}><FlagSelect value={p.docctry} onChange={v => set("docctry", v)} options={FLAG_CTRY} err={err("docctry")} /></Field>
      </div>
      <div className="flex flex-wrap items-end gap-4 mt-3">
        <Field label={<>Expiry date <Req /></>} className="w-44"><DateInput value={p.docexp} onChange={e => set("docexp", e.target.value)} err={err("docexp")} min="2025-01-01" /></Field>
        <label className="flex items-center gap-2 text-[12px] text-ink-muted pb-2.5"><input type="checkbox" checked={saveDoc} onChange={e => setSaveDoc(e.target.checked)} className="accent-[#46a41a]" /> Save this document to my TAP profile <span className="text-ink-faint">· Reuse for future trips — we'll encrypt it</span></label>
      </div>
      <PaxSectionTitle title="Loyalty" sub="Optional — earn miles on this trip" className="mt-4" />
      {lead
        ? <div className="rounded-xl border border-tap-green/30 bg-lime-tint text-tap-greenDark px-4 py-3 flex items-center gap-3"><Icon name="plane" size={16} /><div className="flex-1"><div className="text-[13px] font-bold">TAP.miles applied</div><div className="text-[11px]">{src.member} · {src.tier} tier — you'll earn {miles(src.earn || 2416)} tap.miles on this trip.</div></div><button className="text-[12px] font-semibold shrink-0">Edit</button></div>
        : <div className="grid sm:grid-cols-[160px_1fr_auto] gap-3 items-end"><Field label="Program"><Input defaultValue="TAP.miles" /></Field><Field label="Membership number"><Input placeholder="Add Miles&Go number (optional)" /></Field><Btn variant="outline" size="sm">Apply membership</Btn></div>}
      <div className="mt-4 pt-3 border-t border-line">
        <div className="flex items-center justify-between"><div><div className="text-[13px] font-semibold">Special requests <span className="text-ink-faint font-normal">· optional</span></div><div className="text-[11px] text-ink-faint">Wheelchair, special meals, dietary preferences, traveling with a pet…</div></div><button onClick={() => setReqOpen(o => !o)} className="text-[12px] font-semibold text-tap-greenDeep shrink-0">{reqOpen ? "Close ▴" : "Add request ▾"}</button></div>
        {(reqs.length > 0 || reqOpen) && <div className="mt-3 rounded-xl border border-line bg-surface-soft p-3">
          {reqs.length > 0 && <div className="flex flex-wrap gap-1.5 mb-2">{reqs.map(rq => <span key={rq} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-lime-tint text-tap-greenDeep rounded-full px-2.5 py-1">{rq}<button onClick={() => setReqs(reqs.filter(x => x !== rq))} className="text-tap-greenDeep/70 hover:text-tap-red"><Icon name="x" size={11} /></button></span>)}</div>}
          {reqOpen && <div className="flex flex-wrap gap-1.5">{REQ_OPTS.filter(o => !reqs.includes(o)).map(o => <button key={o} onClick={() => { setReqs([...reqs, o]); setReqOpen(false); }} className="text-[11px] font-medium border border-line-strong rounded-full px-2.5 py-1 hover:border-tap-green hover:text-tap-greenDeep"><span className="text-[13px] leading-none mr-0.5">+</span> {o}</button>)}</div>}
        </div>}
      </div>
    </Card>
  );
}
const Toggle = ({ on, set }) => <button onClick={() => set(!on)} className={cx("w-11 h-6 rounded-full relative transition-colors", on ? "bg-lime" : "bg-surface-mute")}><span className={cx("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", on ? "right-0.5" : "left-0.5")} /></button>;

export function Passenger({ shared, go }) {
  if (!trip.outbound) return noTrip(go);
  seedExtras();
  const u = shared.profile?.user || {};
  const last = (u.full_name || "").replace(u.first_name || "", "").trim() || "Silva";
  const natName = u.nationality === "Brazilian" ? "Brazilian" : "Portuguese";
  const ctryName = natName === "Brazilian" ? "Brazil" : "Portugal";
  const p1 = { title: u.gender === "Female" ? "Ms" : "Mr", first: u.first_name || "Daniel", last, dob: /^\d{4}-\d{2}-\d{2}/.test(u.dob || "") ? u.dob : "1985-03-14", gender: u.gender || "Male", nat: natName, doctype: "Passport", doc: u.doc_id || "PT 4821190", docctry: ctryName, docexp: "2028-11-22", member: u.member_no, tier: u.tier, earn: 2416 };
  const [paxCount, setPaxCount] = useState(trip.pax || 1);
  const [contact, setContact] = useState({ email: u.email || "daniel.silva@email.com", phoneCode: "+351", phone: u.phone ? String(u.phone).replace(/^\s*\+?\d{1,3}\s*/, "") : "91 442 7781", country: ctryName, city: "Porto", lang: "Português (BR)", fare: false });
  const [tab, setTab] = useState("all");
  const [cons, setCons] = useState({ fare: true, hotel: true, stopover: false, analytics: true, ads: false });
  const [, force] = useState(0); const bump = () => force(x => x + 1);
  useEffect(() => { trip.contact = contact; trip.pax = paxCount; }, [contact, paxCount]);

  const REQ = ["title", "first", "last", "dob", "gender", "nat", "doctype", "doc", "docctry", "docexp"];
  const paxComplete = (i) => { const d = trip.passengers[i] || {}; return REQ.every(k => d[k] && String(d[k]).trim()); };
  const contactComplete = !!(contact.email && contact.phone && contact.country && contact.city);
  const completeN = Array.from({ length: paxCount }).filter((_, i) => paxComplete(i)).length;
  const allComplete = completeN === paxCount && contactComplete;
  const firstIncomplete = Array.from({ length: paxCount }).findIndex((_, i) => !paxComplete(i));
  const missingCount = (() => { let n = 0; for (let i = 0; i < paxCount; i++) { const d = trip.passengers[i] || {}; n += REQ.filter(k => !(d[k] && String(d[k]).trim())).length; } if (!contactComplete) n += 1; return n; })();
  const showErr = !allComplete;
  const addPax = () => { setPaxCount(c => c + 1); setTab("all"); };
  const removePax = (i) => { trip.passengers.splice(i, 1); setPaxCount(c => Math.max(1, c - 1)); setTab("all"); };

  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={3} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">Passenger details</h1><Pill tone="slate">{paxCount} traveler{paxCount > 1 ? "s" : ""}</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1 max-w-xl">Enter passenger information exactly as it appears on travel documents. We'll use this to issue tickets and send trip updates.</p>
        <div className="flex flex-wrap gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{paxCount} adult{paxCount > 1 ? "s" : ""}</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>{u.first_name} {last}{paxCount > 1 ? " + " + (paxCount - 1) : ""}</Chip></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-5 items-start">
          <div className="space-y-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold flex-wrap">
              {[["all", "All"], ...Array.from({ length: paxCount }).map((_, i) => ["p" + (i + 1), `Passenger ${i + 1}` + (i === 0 ? ` · ${u.first_name}` : "")])].map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cx("px-3 py-1.5 rounded-full", tab === k ? "bg-surface-dark text-white" : "bg-surface border border-line text-ink-muted")}>{tab === k && k !== "all" && <span className="text-tap-green mr-1">●</span>}{l}</button>
              ))}
              <span className="ml-auto text-[11px] text-ink-faint">{completeN} of {paxCount} complete · <span className="text-tap-greenDeep font-semibold">Autosaved</span></span>
            </div>

            {showErr && <div className="rounded-xl border border-tap-red/40 bg-tap-red/5 px-4 py-3 flex items-start gap-3"><span className="w-5 h-5 rounded-full bg-tap-red text-white inline-flex items-center justify-center text-[12px] font-bold shrink-0">!</span><div><div className="text-[13px] font-bold text-tap-red">Please complete required passenger and contact details</div><div className="text-[12px] text-ink-muted">{missingCount} field{missingCount !== 1 ? "s" : ""} need attention — required fields are highlighted below.</div></div></div>}

            {Array.from({ length: paxCount }).map((_, i) => ((tab === "all" || tab === "p" + (i + 1)) &&
              <PaxCard key={i} idx={i} lead={i === 0} prefill={i === 0 ? p1 : undefined} profile={p1} onRemove={removePax} showErr={showErr} onChange={bump} />))}

            {tab === "all" && <button onClick={addPax} className="w-full rounded-xl border border-dashed border-line-strong py-3 text-[13px] font-semibold text-tap-greenDeep hover:border-tap-green hover:bg-lime-tint/30 inline-flex items-center justify-center gap-1.5"><span className="text-[15px] leading-none">+</span> Add another passenger</button>}

            <Card className="p-5">
              <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-2"><Icon name="mail" size={15} className="text-ink-faint" /><div className="font-bold text-[15px]">Contact details for this booking</div></div><button className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-tap-green"><Icon name="refresh" size={12} /> Using your account · Change</button></div>
              <p className="text-[11px] text-ink-muted mb-3">We'll send confirmation and important trip updates to this contact.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label={<>Email address <Req /></>}><VInput value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} err={showErr && !contact.email} /></Field>
                <Field label={<>Mobile phone <Req /></>}>
                  <div className="flex gap-2">
                    <div className="relative w-[96px] shrink-0"><span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] pointer-events-none">{(PHONE_CODES.find(c => c[0] === contact.phoneCode) || PHONE_CODES[0])[1]}</span><select value={contact.phoneCode} onChange={e => setContact({ ...contact, phoneCode: e.target.value })} className="w-full bg-surface border border-line-strong rounded-xl pl-8 pr-6 py-2.5 text-[13px] outline-none appearance-none cursor-pointer">{PHONE_CODES.map(([c]) => <option key={c} value={c}>{c}</option>)}</select><span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none text-[10px]">▾</span></div>
                    <input value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} className={cx("flex-1 bg-surface border rounded-xl px-3 py-2.5 text-[14px] outline-none focus:border-tap-green", showErr && !contact.phone ? "border-tap-red" : "border-line-strong")} />
                  </div>
                </Field>
                <Field label={<>Country <Req /></>}><FlagSelect value={contact.country} onChange={v => setContact({ ...contact, country: v })} options={FLAG_CTRY} err={showErr && !contact.country} /></Field>
                <Field label={<>City <Req /></>}><VInput value={contact.city} onChange={e => setContact({ ...contact, city: e.target.value })} err={showErr && !contact.city} /></Field>
                <Field label="Preferred language"><Select value={contact.lang} onChange={e => setContact({ ...contact, lang: e.target.value })} options={LANGS} placeholder="Select language" /></Field>
              </div>
              <div className="h-px bg-line my-4" />
              <label className="flex items-start gap-2.5 text-[13px] text-ink-700"><input type="checkbox" checked={contact.fare} onChange={e => setContact({ ...contact, fare: e.target.checked })} className="accent-[#46a41a] mt-0.5" /><span>Email me fare alerts and travel inspiration <span className="text-ink-faint">(optional)</span><span className="block text-[11px] text-ink-faint">You can unsubscribe any time. We'll always send essential trip emails.</span></span></label>
            </Card>

            <div className="rounded-2xl border border-tap-green/30 bg-lime-tint/40 p-4 flex items-start gap-3"><Icon name="lock" size={16} className="text-tap-greenDeep shrink-0 mt-0.5" /><div><div className="font-bold text-[14px] text-tap-greenDark">Your data, your choice</div><div className="text-[11px] text-ink-muted">GDPR-compliant · TAP only shares what you explicitly allow below. Encrypted end-to-end.</div></div></div>
            <Card className="p-5">
              <Eyebrow className="mb-3">Marketing &amp; partner consents</Eyebrow>
              <div className="divide-y divide-line">
                {[["fare", "TAP fare alerts", "Personalised deals based on your routes"], ["hotel", "Hotel & car partners", "Booking.com & Hertz can email you matched offers"], ["stopover", "Stopover Portugal", "Destination guides & limited-time experiences"], ["analytics", "Anonymised analytics", "Helps TAP improve product (no personal data shared)"], ["ads", "Third-party advertising", "Personalised ads on social platforms"]].map(([k, t, s]) => (
                  <div key={k} className="flex items-center justify-between py-3"><div><div className="text-[13px] font-semibold">{t}</div><div className="text-[11px] text-ink-faint">{s}</div></div><Toggle on={cons[k]} set={v => setCons({ ...cons, [k]: v })} /></div>
                ))}
              </div>
            </Card>
          </div>
          <BasketSummary step={4} grouped cta="Continue to payment →" onCta={() => go("payment")} disabled={!allComplete} note={allComplete ? "Final review again on Step 4." : (firstIncomplete >= 0 ? `Complete Passenger ${firstIncomplete + 1} details to continue.` : "Complete contact details to continue.")} secondary="← Back to My Trip Cart" onSecondary={() => go("cart")} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ PAYMENT ═══════════ */
const METHODS = ["Card", "Digital Wallet", "Miles & Go", "Bank transfer", "Split Payment", "Mix Method"];

/* H2 · Real-time availability / price change during booking. Revalidation runs when the
   passenger reaches payment (before confirmation). It fires once per selected outbound so
   a fresh selection re-arms it; the passenger can accept the new price or return to the
   basket — their seat, extras and details are preserved either way. Presenter can silence
   it from the Demo Console (window.__tapNoRevalidate). */
let _h2ArmedFor = null;
function computeRevalidation(t) {
  const o = trip.outbound;
  const delta = Math.max(12, Math.round((o?.price || 130) * 0.08));   // ~8% of the outbound fare, min €12
  const fno = String(o?.flight?.flight_no || "your flight").replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2");
  return {
    oldTotal: t.total, newTotal: t.total + delta, delta, flight: fno,
    reason: `The fare class you selected on ${fno} just sold its last seat at that price. The next available fare in the same cabin is €${delta} higher.`,
  };
}
function PriceChangeModal({ info, onAccept, onExit }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onExit}>
      <div className="bg-white rounded-2xl max-w-md w-full shadow-pop overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-line flex items-center gap-2.5">
          <span className="w-8 h-8 rounded-full bg-[#fff4d6] text-[#9a6b00] inline-flex items-center justify-center shrink-0"><Icon name="clock" size={16} /></span>
          <div><div className="text-[10px] font-bold uppercase tracking-wide text-[#9a6b00]">Availability updated</div><div className="font-bold text-[16px] leading-tight">Price changed while you were booking</div></div>
        </div>
        <div className="p-5">
          <p className="text-[13px] text-ink-muted">{info.reason}</p>
          <div className="mt-4 rounded-xl border border-line bg-surface-soft p-4 flex items-center justify-between">
            <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Previous total</div><div className="text-[18px] font-bold v2-num text-ink-faint line-through">{EUR(info.oldTotal)}</div></div>
            <Icon name="arrow" size={16} className="text-ink-faint" />
            <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep">New total</div><div className="text-[22px] font-black v2-num text-ink">{EUR(info.newTotal)}</div><div className="text-[10px] text-tap-red font-semibold">+{EUR(info.delta)}</div></div>
          </div>
          <div className="mt-3 rounded-xl bg-lime-tint/50 border border-tap-green/30 px-3 py-2 flex items-center gap-2 text-[12px] text-tap-greenDark"><Icon name="check" size={14} className="text-tap-green shrink-0" /> Your seat, extras and passenger details are saved — nothing was lost.</div>
          <div className="flex flex-col gap-2 mt-4">
            <Btn variant="primary" className="w-full" onClick={onAccept}>Continue at {EUR(info.newTotal)} <Icon name="arrow" size={14} /></Btn>
            <Btn variant="outline" className="w-full" onClick={onExit}>Go back to my basket</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [splitAmts, setSplitAmts] = useState({});   // #16 — per-payer custom amounts (index → €)
  const [splitPaid, setSplitPaid] = useState(() => new Set());   // #19 — indices of payers who've settled
  const payMyShare = () => setSplitPaid(s => new Set(s).add(0));                 // lead pays their own share
  const markPaid = (i) => setSplitPaid(s => { const n = new Set(s); n.add(i); return n; });   // demo: invitee settles via their link
  const [mix, setMix] = useState({ card: null, miles: 0, voucher: 0, cashback: 0 }); // Payment Composer amounts (€ per source)
  const [editMiles, setEditMiles] = useState(false); // #7: Edit reveals an exact-amount field
  const [editVoucher, setEditVoucher] = useState(false), [editCash, setEditCash] = useState(false); // #21: Edit reveals partial-amount fields
  useEffect(() => { api.get("/seat-recommendation").then(setSeat).catch(() => {}); }, []);
  // H2 — revalidate availability/price on reaching payment; fire once per selected outbound.
  const [reval, setReval] = useState(null);
  useEffect(() => {
    const fno = trip.outbound?.flight?.flight_no || null;
    if (typeof window !== "undefined" && window.__tapNoRevalidate) return;   // presenter silenced it
    if (trip.pnr || _h2ArmedFor === fno) return;                             // already booked / already shown for this flight
    setReval(computeRevalidation(tripTotals()));
  }, []);
  const cashbackBal = 38;
  let voucher_amt = 0, miles_used = 0, miles_amt = 0, cashback_amt = 0;
  if (method === "Miles & Go") { miles_used = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE)); miles_amt = Math.round(miles_used * MILES_RATE); voucher_amt = Math.min(voucher, Math.max(0, t.total - miles_amt)); }
  else if (method === "Mix Method") {
    voucher_amt = Math.min(voucher, mix.voucher || 0);
    miles_used = mix.miles; miles_amt = Math.round(miles_used * MILES_RATE);
    cashback_amt = Math.min(cashbackBal, mix.cashback || 0);
  }
  const card_amt = Math.max(0, t.total - voucher_amt - miles_amt - cashback_amt);
  const seatNo = chosenSeat() || (/exec|plus|premium/i.test(trip.outbound?.fare || "") ? seatForFare(trip.outbound?.fare) : (seat?.seat || seatForFare(trip.outbound?.fare)));
  const mixBreakdown = method === "Mix Method" ? [
    { label: "Card payment", text: EUR(card_amt) },
    { label: `Miles (${miles(miles_used)})`, text: miles_amt > 0 ? "−" + EUR(miles_amt) : EUR(0), green: miles_amt > 0 },
    { label: voucher ? `Voucher TAP-${shared.profile?.vouchers?.[0]?.code || "XYZ"}` : "Voucher", text: voucher_amt > 0 ? "−" + EUR(voucher_amt) : EUR(0), red: voucher_amt > 0 },
    { label: "Cashback wallet", text: cashback_amt > 0 ? "−" + EUR(cashback_amt) : EUR(0) + " (unused)", muted: cashback_amt === 0 },
  ] : null;
  // #19 — split-payment participant model (shared by the left allocation editor and the right summary panel).
  const splitPayers = method === "Split Payment"
    ? [{ name: (trip.passengers?.[0]?.first ? trip.passengers[0].first + " (you)" : (u.first_name || "You") + " (you)"), email: trip.contact?.email || u.email || "you@email.com", card: u.card_last4 || "4242", lead: true },
       ...Array.from({ length: Math.max(0, (trip.pax || 1) - 1) }).map((_, i) => { const p = trip.passengers?.[i + 1]; return { name: p?.first ? `${p.first} ${p.last || ""}`.trim() : `Guest ${i + 1}`, email: "guest" + (i + 1) + "@email.com", card: ["1881", "1234", "5079"][i] || "0000", status: i === 0 ? "Link sent" : "Link pending" }; })]
    : [];
  const splitEqual = splitPayers.length ? +(t.total / splitPayers.length).toFixed(2) : 0;
  const splitAmtFor = (i) => splitTab === "Single Payer" ? (i === 0 ? t.total : 0) : splitTab === "Custom Split" ? (splitAmts[i] != null ? splitAmts[i] : splitEqual) : splitEqual;
  const splitAllocated = +splitPayers.reduce((s, _, i) => s + (splitAmtFor(i) || 0), 0).toFixed(2);
  const splitLeadAmt = splitPayers.length ? (splitAmtFor(0) || 0) : 0;

  async function pay() {
    setBusy(true);
    try {
      const r = await api.post("/pay", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code || e.name), total: t.total, voucher_amt, miles_used, miles_amt, card_amt, seat: seatNo, date: trip.date, fare: trip.outbound?.fare, cabin: fareCabin(trip.outbound?.fare), pax: trip.pax, passengers: (trip.passengers || []).filter(p => p && p.first).map(p => ({ title: p.title, first: p.first, last: p.last })), inbound: trip.inbound?.flight?.flight_no ? { flight_no: trip.inbound.flight.flight_no, date: trip.ret } : null, contact: trip.contact || null });
      if (r.ok) { trip.pnr = r.pnr; trip.seat = seatNo; trip.payment = { total: t.total, voucher_amt, miles_used, miles_amt, cashback_amt, card_amt, method, email: r.email?.to }; go("confirmation"); }
      else alert("Payment could not be completed: " + (r.error || "unknown"));
    } catch (e) { alert("Payment error: " + e.message); } finally { setBusy(false); }
  }
  const [billCtry, setBillCtry] = useState(trip.contact?.country || "Portugal");
  const billing = (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-3"><div className="flex items-center gap-2"><Icon name="doc" size={15} className="text-ink-faint" /><div><div className="font-bold text-[15px]">Billing details</div><div className="text-[11px] text-ink-muted">We use these only for payment authorisation and invoicing.</div></div></div></div>
      <label className="flex items-center gap-2.5 rounded-xl border border-tap-green bg-lime-tint/50 px-3.5 py-2.5 mb-3 cursor-pointer w-fit"><span className="w-5 h-5 rounded-md bg-tap-green inline-flex items-center justify-center text-white"><Icon name="check" size={13} /></span><span className="text-[13px] font-semibold">Use contact details from this booking</span></label>
      <div className="grid sm:grid-cols-2 gap-3"><Field label={<>Country <Req /></>}><FlagSelect value={billCtry} onChange={setBillCtry} options={FLAG_CTRY} /></Field><Field label={<>Street address <Req /></>}><Input defaultValue="Av. Paulista, 1842 · Apt 71" /></Field><Field label={<>City <Req /></>}><Input defaultValue={trip.contact?.city || "Porto"} /></Field><Field label="State / province"><Input defaultValue="SP" /></Field><Field label={<>Postal code <Req /></>}><Input defaultValue="01310-100" /></Field><Field label="CPF / Tax ID (optional)"><Input placeholder="000.000.000-00" /></Field></div>
      <div className="h-px bg-line my-4" />
      <div className="flex items-center gap-2 text-[12px] text-ink-muted"><Icon name="doc" size={13} className="text-ink-faint shrink-0" /> Invoice will be issued to this address. You can edit it before requesting a refund.</div>
    </Card>
  );
  const terms = (
    <Card className="p-5 space-y-3">
      <div className="font-bold text-[15px] flex items-center gap-2"><Icon name="doc" size={15} className="text-ink-faint" /> Terms and consent</div>
      <label className={cx("flex items-start gap-2.5 text-[13px] rounded-xl border px-4 py-3", agree ? "border-tap-green bg-lime-tint/40" : "border-tap-red/40 bg-tap-red/5")}>
        <span className={cx("mt-0.5 w-5 h-5 rounded-md inline-flex items-center justify-center shrink-0 cursor-pointer", agree ? "bg-tap-green text-white" : "border-2 border-line-strong")} onClick={() => setAgree(!agree)}>{agree && <Icon name="check" size={13} />}</span>
        <span className="flex-1">I've read and accept the <b>fare conditions</b> · <b>baggage rules</b> · <b>privacy policy</b>.<div className="text-ink-faint font-normal">You'll receive your booking confirmation and e-ticket after successful payment.</div></span>
        <span className="shrink-0"><span className="text-[10px] font-bold uppercase tracking-wide rounded-full bg-tap-red text-white px-2.5 py-1">Required</span></span>
      </label>
      <label className="flex items-start gap-2.5 text-[13px] text-ink-700 px-1"><input type="checkbox" className="accent-[#46a41a] mt-0.5" /><span>Send me deals and offers from TAP and partners <span className="text-ink-faint">(optional)</span><div className="text-[11px] text-ink-faint">You can unsubscribe any time. We'll always send essential trip emails.</div></span></label>
    </Card>
  );

  return (
    <div className="bg-surface-soft min-h-screen">
      {reval && <PriceChangeModal info={reval}
        onAccept={() => { trip.repriceDelta = (trip.repriceDelta || 0) + reval.delta; _h2ArmedFor = trip.outbound?.flight?.flight_no || null; pingBasket(); setReval(null); }}
        onExit={() => { _h2ArmedFor = trip.outbound?.flight?.flight_no || null; setReval(null); go("cart"); }} />}
      <Stepper active={4} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">Payment</h1><Pill tone="slate"><Icon name="lock" size={11} /> Secure checkout · powered by Stripe</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">Review your total and pay securely to confirm your trip. No charge has been made until you click Pay.</p>
        <div className="flex flex-wrap items-center gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adults</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")} – {fmtDate(trip.ret).replace(/ \d{4}/, "")}</Chip><Chip dot>{u.first_name} {trip.pax > 1 ? "+ " + (trip.pax - 1) : ""}</Chip><span className="ml-auto inline-flex items-center gap-2 rounded-lg bg-surface-mute px-3 py-1.5"><span className="w-2 h-2 rounded-full bg-tap-red inline-block" /><span className="leading-tight"><span className="block text-[9px] font-bold uppercase tracking-wide text-ink-faint">Price locked</span><SessionTimer prefix="" suffix=" remaining" className="block text-[12px] font-bold text-ink v2-num" /></span></span></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-5 items-start">
          <div className="space-y-5">
            <div className="rounded-2xl p-4 text-white flex items-center justify-between flex-wrap gap-3" style={{ background: "linear-gradient(100deg,#1f5e23,#46a41a)" }}>
              <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-white/15 inline-flex items-center justify-center"><Icon name="lock" size={16} /></span><div><div className="text-[14px] font-bold">Secure payment</div><div className="text-[11px] text-white/70">All card data is encrypted and tokenised. We never see your full card number.</div></div></div>
              <div className="flex flex-wrap gap-1.5">{["VISA", "MASTERCARD", "AMEX", "TAP MILES", "APPLE PAY"].map(b => <span key={b} className="text-[9px] font-bold bg-white/15 rounded px-1.5 py-1">{b}</span>)}<span className="text-[9px] font-bold bg-[#635bff] rounded px-1.5 py-1">stripe</span></div>
            </div>
            <Card className="overflow-hidden">
            <div className="p-1.5 flex gap-1 overflow-x-auto v2-track border-b border-line">{METHODS.map(m => { const on = method === m; return <button key={m} onClick={() => setMethod(m)} className={cx("shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-semibold inline-flex items-center gap-1.5", on ? "bg-tap-green text-white" : "text-ink-muted hover:bg-surface-mute")}>{m}{m === "Card" && on && <span className="flex gap-1 ml-0.5">{["VISA", "MC", "AMEX"].map(b => <span key={b} className="text-[8px] font-bold bg-white/25 rounded px-1 py-0.5 leading-none">{b}</span>)}</span>}</button>; })}</div>
            <div className="p-5">
              {method === "Card" && <>
                <div className="flex items-center justify-between mb-3"><div className="font-bold text-[15px] flex items-center gap-2"><Icon name="lock" size={14} className="text-ink-faint" /> Pay by card</div><span className="text-[11px] text-ink-faint flex items-center gap-1">Powered by <span className="text-[9px] font-bold bg-[#635bff] text-white rounded px-1.5 py-0.5">stripe</span></span></div>
                <div className="text-[11px] text-ink-faint mb-3">Visa · Mastercard · American Express · Maestro · Elo</div>
                <div className="grid gap-3">
                  <Field label={<>Cardholder name <Req /></>}><Input defaultValue={(u.full_name || "Daniel Silva").toUpperCase()} /></Field>
                  <Field label={<>Card number <Req /></>}>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"><svg width="22" height="14" viewBox="0 0 22 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="21" height="13" rx="2.5" fill="#fff" stroke="#dcdcd8"/><rect x="0" y="3" width="22" height="3" fill="#ed1c24"/><rect x="3" y="9.5" width="7" height="1.8" rx="0.9" fill="#9a9a9a"/></svg></span>
                      <Input defaultValue={`XXXX XXXX XXXX ${u.card_last4 || "4242"}`} className="pl-11 v2-num tracking-wide" />
                    </div>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={<>Expiry date (MM / YY) <Req /></>}><div className="relative"><Input defaultValue={u.card_exp || "09 / 28"} placeholder="MM / YY" className="pr-8 v2-num" /><Icon name="check" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tap-green" /></div></Field>
                    <Field label={<span className="inline-flex items-center gap-1">CVC / CVV <Req /> <Icon name="info" size={11} className="text-ink-faint" /></span>}>
                      <div className="relative"><Input defaultValue="•••" className="pr-8" /><Icon name="check" size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tap-green" /></div>
                      <div className="text-[10px] text-ink-faint mt-1">3 digits on back of card</div>
                    </Field>
                  </div>
                </div>
                <label className="flex items-center gap-2 mt-3 text-[12px] text-ink-muted"><input type="checkbox" defaultChecked className="accent-[#46a41a]" /> Save card securely for faster checkout next time <span className="ml-auto"><span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide rounded bg-lime-tint text-tap-greenDeep px-2 py-0.5"><Icon name="lock" size={10} /> Encrypted</span></span></label>
              </>}
              {method === "Miles & Go" && <div className="text-[13px]"><div className="font-bold text-[15px] mb-2 flex items-center gap-2"><Icon name="spark" size={14} className="text-tap-green" /> Pay with Miles &amp; Go</div><div className="rounded-xl border border-tap-green bg-lime-tint/40 p-4"><div className="flex items-center justify-between"><span>Balance</span><span className="font-bold v2-num">{miles(u.miles)} miles</span></div><div className="flex items-center justify-between mt-1.5"><span>Using for this trip</span><span className="font-bold v2-num">{miles(miles_used)} mi ({EUR(miles_amt)})</span></div>{voucher_amt > 0 && <div className="flex items-center justify-between mt-1.5"><span>Voucher applied</span><span className="font-bold v2-num text-tap-greenDeep">−{EUR(voucher_amt)}</span></div>}<Divider className="my-2" /><div className="flex items-center justify-between font-bold"><span>Remaining on saved card</span><span className="v2-num">{EUR(card_amt)}</span></div></div></div>}
              {method === "Mix Method" && (() => {
                const milesMax = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE));
                const clampMiles = v => Math.max(0, Math.min(milesMax, Math.round((+v || 0) / 100) * 100));
                return <div className="space-y-3"><div className="font-bold text-[15px] flex items-center gap-2"><Icon name="lock" size={14} className="text-ink-faint" /> Payment Composer</div><p className="text-[12px] text-ink-muted">Mix card · miles · voucher · cashback. Live total updates as you adjust.</p>
                  <MixComp on={card_amt > 0} title={`Card · Visa •••• ${u.card_last4 || "4242"}`} sub="Available: unlimited" right={<span className="text-[13px] font-bold v2-num">{EUR(card_amt)}</span>} onToggle={() => { }} onEdit={() => setMethod("Card")} />
                  <MixComp on={mix.miles > 0} title="TAP miles" sub={`Balance ${miles(u.miles)} · 1mi=${EUR(MILES_RATE)}`} onToggle={() => setMix(m => ({ ...m, miles: m.miles > 0 ? 0 : milesMax }))} onEdit={() => setEditMiles(v => !v)} right={<span className="text-[13px] font-bold v2-num">{miles(miles_used)} mi ({EUR(miles_amt)})</span>}>
                    <div className="px-1 mt-3"><input type="range" min="0" max={milesMax} step="100" value={mix.miles} onChange={e => setMix(m => ({ ...m, miles: +e.target.value }))} className="w-full accent-[#46a41a]" /></div>
                    {editMiles && <div className="px-1 mt-2.5 flex items-center gap-2 text-[12px]"><span className="text-ink-muted">Use exactly</span><input type="number" min="0" max={milesMax} step="100" value={mix.miles} onChange={e => setMix(m => ({ ...m, miles: clampMiles(e.target.value) }))} className="w-28 rounded-lg border border-line-strong px-2 py-1 text-[13px] font-bold v2-num" /><span className="text-ink-faint">miles = {EUR(miles_amt)}</span><button onClick={() => setMix(m => ({ ...m, miles: milesMax }))} className="ml-auto text-[11px] font-bold text-tap-greenDeep hover:underline">Max</button></div>}
                  </MixComp>
                  <MixComp on={(mix.voucher || 0) > 0 && voucher > 0} title={`Voucher${voucher ? " TAP-" + (shared.profile?.vouchers?.[0]?.code || "XYZ") : ""}`} sub={voucher ? `Eligible: ${EUR(voucher)}` : "No active voucher"} onToggle={() => voucher && setMix(m => ({ ...m, voucher: (m.voucher || 0) > 0 ? 0 : voucher }))} onEdit={() => voucher && setEditVoucher(v => !v)} right={<span className="text-[13px] font-bold v2-num">{EUR(voucher_amt)}</span>}>
                    {editVoucher && voucher > 0 && <div className="px-1 mt-2.5 flex items-center gap-2 text-[12px]"><span className="text-ink-muted">Apply €</span><input type="number" min="0" max={voucher} step="1" value={mix.voucher || 0} onChange={e => setMix(m => ({ ...m, voucher: Math.max(0, Math.min(voucher, +(+e.target.value).toFixed(2))) }))} className="w-24 rounded-lg border border-line-strong px-2 py-1 text-[13px] font-bold v2-num" /><span className="text-ink-faint">of {EUR(voucher)}</span><button onClick={() => setMix(m => ({ ...m, voucher }))} className="ml-auto text-[11px] font-bold text-tap-greenDeep hover:underline">Max</button></div>}
                  </MixComp>
                  <MixComp on={cashback_amt > 0} title="Cashback wallet" sub={`Balance: ${EUR(cashbackBal)}`} onToggle={() => setMix(m => ({ ...m, cashback: m.cashback > 0 ? 0 : cashbackBal }))} onEdit={() => setEditCash(v => !v)} right={<span className="text-[13px] font-bold v2-num">{EUR(cashback_amt)}</span>}>
                    {editCash && <div className="px-1 mt-2.5 flex items-center gap-2 text-[12px]"><span className="text-ink-muted">Apply €</span><input type="number" min="0" max={cashbackBal} step="1" value={mix.cashback || 0} onChange={e => setMix(m => ({ ...m, cashback: Math.max(0, Math.min(cashbackBal, +(+e.target.value).toFixed(2))) }))} className="w-24 rounded-lg border border-line-strong px-2 py-1 text-[13px] font-bold v2-num" /><span className="text-ink-faint">of {EUR(cashbackBal)}</span><button onClick={() => setMix(m => ({ ...m, cashback: cashbackBal }))} className="ml-auto text-[11px] font-bold text-tap-greenDeep hover:underline">Max</button></div>}
                  </MixComp>
                  <p className="text-[11px] text-ink-faint">Your live payment breakdown is shown in My trip basket on the right.</p>
                </div>;
              })()}
              {(method === "Digital Wallet" || method === "Bank transfer") && <div className="text-[13px] text-ink-muted">{method} selected — you'll be redirected to complete payment. (Demo charges your saved card for {EUR(t.total)}.)</div>}
              {method === "Split Payment" && (() => {
                const payers = [{ name: (trip.passengers?.[0]?.first ? trip.passengers[0].first + " (you)" : (u.first_name || "You") + " (you)"), email: trip.contact?.email || u.email || "you@email.com", card: u.card_last4 || "4242", status: "Pay now", lead: true }, ...Array.from({ length: Math.max(0, trip.pax - 1) }).map((_, i) => { const p = trip.passengers?.[i + 1]; return { name: p?.first ? `${p.first} ${p.last || ""}` : `Guest ${i + 1}`, email: "guest" + (i + 1) + "@email.com", card: ["1881", "1234", "5079"][i] || "0000", status: i === 0 ? "Link sent" : "Link pending" }; })];
                const equal = +(t.total / payers.length).toFixed(2);
                // Amount each payer owes, by mode. Custom Split reads the editable splitAmts map.
                const amtFor = (i) => splitTab === "Single Payer" ? (i === 0 ? t.total : 0) : splitTab === "Custom Split" ? (splitAmts[i] != null ? splitAmts[i] : equal) : equal;
                const custom = splitTab === "Custom Split";
                const allocated = +payers.reduce((s, _, i) => s + (amtFor(i) || 0), 0).toFixed(2);
                const balanced = Math.abs(allocated - t.total) < 0.01;
                return <div className="text-[13px]">
                  <div className="flex gap-4 text-[12px] font-semibold mb-3">{["Single Payer", "Split Equally", "Custom Split"].map(s => <button key={s} onClick={() => setSplitTab(s)} className={cx("pb-0.5 border-b-2", splitTab === s ? "border-tap-green text-tap-greenDeep" : "border-transparent text-ink-faint")}>{s}</button>)}</div>
                  {payers.map((p, i) => (
                    <div key={i} className={cx("rounded-xl border p-3 mb-2.5 flex items-center gap-3 flex-wrap", p.lead ? "border-tap-green bg-lime-tint/20" : "border-line")}>
                      <span className="w-9 h-9 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[13px] font-bold shrink-0">{p.name[0]}</span>
                      <div className="min-w-0"><div className="font-bold leading-tight text-[13px]">{p.name}</div><div className="text-[11px] text-ink-faint truncate">{p.email}</div></div>
                      <button className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-[11px] font-semibold text-ink-muted hover:text-tap-red hover:border-tap-red shrink-0"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg> Remove</button>
                      <div className={cx("inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ml-auto", custom ? "border-tap-green bg-surface" : "border-line-strong")}>
                        <span className="text-[13px] text-ink-faint">€</span>
                        {custom
                          ? <input type="number" min="0" step="0.01" value={amtFor(i)} onChange={e => setSplitAmts(a => ({ ...a, [i]: Math.max(0, +(+e.target.value).toFixed(2)) }))} className="w-20 bg-transparent font-bold v2-num text-[15px] outline-none" aria-label={`Amount for ${p.name}`} />
                          : <span className="font-bold v2-num text-[15px]">{amtFor(i).toFixed(2)}</span>}
                        <button type="button" onClick={() => { setSplitTab("Custom Split"); setSplitAmts(a => (a[i] != null ? a : { ...a, [i]: equal })); }} title={custom ? "Edit amount" : "Edit amounts — switch to a custom split"} aria-label="Edit amount" className="inline-flex items-center justify-center rounded hover:bg-surface-mute -mr-1 p-0.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={custom ? "var(--tap-green)" : "#9a9a9a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                        </button>
                      </div>
                      <div className="text-[12px] text-ink-muted shrink-0">{p.lead ? `Card •••• ${p.card}` : p.status}</div>
                      <button className="text-[12px] font-bold text-tap-red shrink-0 hover:underline">{p.lead ? "Pay now" : p.status === "Link pending" ? "Send link" : "Resend"}</button>
                    </div>
                  ))}
                  <div className={cx("flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold", balanced ? "bg-lime-tint/60 text-tap-greenDeep" : "bg-[#fdecec] text-tap-red")}>
                    <span>{custom ? "Allocated" : "Total split"}: {EUR(allocated)} of {EUR(t.total)}</span>
                    <span>{balanced ? "✓ Balanced" : allocated > t.total ? `Over by ${EUR(allocated - t.total)}` : `${EUR(t.total - allocated)} unallocated`}</span>
                  </div>
                  {custom && <button onClick={() => setSplitAmts({})} className="mt-2 text-[11px] font-semibold text-ink-muted hover:text-tap-greenDeep">Reset to equal split</button>}
                </div>;
              })()}
              <div className="mt-4 rounded-xl border border-dashed border-line p-3 flex items-center gap-3 text-[12px]"><span className="w-9 h-9 rounded-lg bg-surface-mute inline-flex items-center justify-center"><Icon name="lock" size={14} className="text-ink-faint" /></span><div className="flex-1"><div className="font-semibold">Bank verification (3-D Secure) appears here when required</div><div className="text-ink-faint">Your bank may ask you to confirm with a code, push notification, or biometric.</div></div><Pill tone="slate"><Icon name="lock" size={10} /> 3-D Secure 2.0</Pill></div>
            </div>
            </Card>
            {billing}{terms}
            <Card className="p-3.5 flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink font-medium">
              {[["lock", "PCI-DSS Level 1 · Stripe", "text-[#caa53d]"], ["shield", "3-D Secure 2.0", "text-tap-red"], ["clock", "Free 24h cancellation", "text-ink-muted"], ["star", "24/7 TAP Care", "text-tap-greenDeep"]].map(([ic, t2, col]) => <span key={t2} className="flex items-center gap-1.5"><Icon name={ic} size={14} className={col} /> {t2}</span>)}
            </Card>
          </div>
          {method === "Split Payment"
            ? <SplitSummary payers={splitPayers} amtFor={splitAmtFor} total={t.total} allocated={splitAllocated} leadAmt={splitLeadAmt} paid={splitPaid} onPayShare={payMyShare} onMarkPaid={markPaid} disabled={!agree || busy} busy={busy} onCta={pay} onBack={() => go("passenger")} />
            : <BasketSummary step={4} grouped cta={busy ? "Processing…" : method === "Mix Method" ? `Pay ${EUR(card_amt)} by card →` : `Pay ${EUR(t.total)} & complete booking`} disabled={!agree || busy} onCta={pay} note={method === "Mix Method" ? `Card covers the ${EUR(card_amt)} balance after miles, voucher & wallet.` : "By paying you confirm fare conditions & privacy policy."} secondary="← Back to passenger details" onSecondary={() => go("passenger")} user={u} breakdown={mixBreakdown} hideMiles={method === "Mix Method"} milesSwitch={method === "Mix Method" ? undefined : { tier: u.tier }} onMilesSwitch={() => setMethod("Miles & Go")}
            footer={<>
              <div className="mt-2 rounded-xl bg-surface-soft border border-line px-3 py-2.5 flex items-start gap-2 text-[12px]"><Icon name="lock" size={13} className="text-tap-greenDeep mt-0.5 shrink-0" /><div><div className="font-bold">PCI-DSS Level 1</div><div className="text-ink-faint">Stripe encrypts and tokenises every card.</div></div></div>
              <div className="text-[11px] text-ink-faint text-center mt-2"><SessionTimer prefix="No charge yet · price locked" /></div>
            </>} />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════ CONFIRMATION ═══════════ */
// D1 · Portugal Stopover builder — a personalized Lisbon stopover (boutique vs budget
// hotels + curated experiences) with fully transparent per-component pricing, added to
// the itinerary as individual line items. Hotel tier is personalized to the member.
// B3 · Miles & Go redemption shopping — a dedicated space to spend miles: cash+miles
// combinations on a fare, a miles-price calendar (off-peak vs peak), and miles-for-
// ancillaries. Uses the same MILES_RATE as the server so values reconcile at checkout.
export function MilesShop({ shared, go }) {
  const u = shared.profile?.user || {};
  const balance = u.miles || 42000;
  const route = { o: u.home_airport || "LIS", d: "GRU", cash: 489, label: `${u.home_airport || "LIS"} → São Paulo` };
  const [pct, setPct] = useState(40);
  const [dayIdx, setDayIdx] = useState(2);
  const [ancRedeemed, setAncRedeemed] = useState(() => new Set());
  const [done, setDone] = useState(false);
  const milesToEur = (m) => m * MILES_RATE;
  const eurToMiles = (e) => Math.round(e / MILES_RATE);
  // Cash + miles split on the fare, capped by the member's balance.
  const wantMilesEur = route.cash * (pct / 100);
  const milesUsed = Math.min(balance, eurToMiles(wantMilesEur));
  const cashPart = Math.max(0, route.cash - milesToEur(milesUsed));
  // Miles-price calendar — a week of dates, off-peak cheaper in miles.
  const days = useMemo(() => {
    const base = new Date("2026-07-10T00:00:00");
    return Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(base); dt.setDate(base.getDate() + i);
      const wd = dt.getDay(); const peak = wd === 5 || wd === 0; // Fri/Sun peak
      return { iso: dt.toISOString().slice(0, 10), label: dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }), miles: peak ? 58000 : 41500, peak };
    });
  }, []);
  const ANC = [
    { k: "bag", name: "Extra checked bag", miles: 6000 },
    { k: "seat", name: "Extra-legroom seat", miles: 4500 },
    { k: "lounge", name: "Lisbon lounge access", miles: 7500 },
    { k: "wifi", name: "Full-flight Wi-Fi", miles: 3000 },
  ];
  const toggleAnc = (k) => setAncRedeemed(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const ancMiles = ANC.filter(a => ancRedeemed.has(a.k)).reduce((s, a) => s + a.miles, 0);
  if (done) return (
    <div className="mx-auto max-w-content px-6 py-10">
      <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-tap-green text-white inline-flex items-center justify-center"><Icon name="spark" size={22} /></span><div><h1 className="text-[26px] font-black">Redemption confirmed</h1><div className="text-[13px] text-ink-muted">{route.label} · paid with Miles & Go</div></div></div>
      <Card className="p-5 mt-6">
        <div className="space-y-1.5 text-[13px]">
          <Row label={`Fare · ${miles(milesUsed)} miles + cash`} v={eurC(cashPart)} />
          {ANC.filter(a => ancRedeemed.has(a.k)).map(a => <Row key={a.k} label={`${a.name} · ${miles(a.miles)} miles`} v={"—"} />)}
        </div>
        <Divider className="my-3" />
        <div className="flex justify-between text-[14px] font-black"><span>Miles redeemed</span><span className="v2-num">{miles(milesUsed + ancMiles)}</span></div>
        <div className="flex justify-between text-[13px] mt-1"><span className="text-ink-muted">Remaining balance</span><span className="v2-num font-semibold">{miles(Math.max(0, balance - milesUsed - ancMiles))}</span></div>
      </Card>
      <div className="flex gap-3 mt-5"><Btn onClick={() => go("home")}>Done</Btn><Btn variant="outline" onClick={() => setDone(false)}>Redeem more</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Eyebrow>Miles &amp; Go · redemption</Eyebrow>
          <h1 className="text-[30px] font-black mt-1">Shop with your miles</h1>
          <p className="text-[13px] text-ink-muted mt-1">Combine cash and miles, find the cheapest dates in miles, or spend miles on extras.</p>
        </div>
        <div className="rounded-2xl bg-surface-dark text-white px-5 py-3 text-right"><div className="text-[10px] uppercase tracking-widest text-white/50">Your balance</div><div className="text-[24px] font-black v2-num text-lime">{miles(balance)}</div><div className="text-[10px] text-white/60">≈ {EUR(milesToEur(balance))} value</div></div>
      </div>
      <div className="grid lg:grid-cols-2 gap-5 mt-6 items-start">
        <Card className="p-5">
          <div className="text-[13px] font-bold">Cash + Miles · {route.label}</div>
          <div className="text-[11px] text-ink-faint mb-3">Slide to choose how much of the {EUR(route.cash)} fare to cover with miles.</div>
          <input type="range" min="0" max="100" value={pct} onChange={e => setPct(+e.target.value)} className="w-full accent-tap-green" />
          <div className="flex justify-between text-[10px] text-ink-faint"><span>All cash</span><span>{pct}% miles</span><span>Max miles</span></div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-xl bg-lime-tint/50 p-3 text-center"><div className="text-[10px] font-bold uppercase text-tap-greenDeep">Miles used</div><div className="text-[20px] font-black v2-num">{miles(milesUsed)}</div></div>
            <div className="rounded-xl bg-surface-soft p-3 text-center"><div className="text-[10px] font-bold uppercase text-ink-muted">Cash to pay</div><div className="text-[20px] font-black v2-num">{EUR(cashPart)}</div></div>
          </div>
          {milesUsed >= balance && pct > 0 && <div className="text-[11px] text-[#9a6b00] mt-2">Capped at your available balance.</div>}
          <Btn className="w-full mt-4" onClick={() => setDone(true)}>Redeem {miles(milesUsed)} miles + {EUR(cashPart)}</Btn>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <div className="text-[13px] font-bold">Miles calendar</div>
            <div className="text-[11px] text-ink-faint mb-3">Miles price per departure date — off-peak is cheaper.</div>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d, i) => (
                <button key={d.iso} onClick={() => setDayIdx(i)} className={cx("rounded-lg border p-1.5 text-center transition-colors", dayIdx === i ? "border-tap-green bg-lime-tint ring-1 ring-tap-green" : d.peak ? "border-line bg-surface-soft" : "border-line")}>
                  <div className="text-[10px] font-semibold">{d.label}</div>
                  <div className="text-[10px] font-black v2-num mt-0.5">{Math.round(d.miles / 1000)}k</div>
                  {!d.peak && <div className="text-[8px] font-bold text-tap-greenDeep uppercase">off-peak</div>}
                  {d.peak && <div className="text-[8px] font-bold text-ink-faint uppercase">peak</div>}
                </button>
              ))}
            </div>
            <div className="text-[11px] text-ink-muted mt-2.5">Selected: <span className="font-semibold text-ink">{days[dayIdx].label}</span> · {miles(days[dayIdx].miles)} miles one-way</div>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] font-bold">Spend miles on extras</div>
            <div className="text-[11px] text-ink-faint mb-3">Redeem miles for ancillaries instead of cash.</div>
            <div className="space-y-2">
              {ANC.map(a => {
                const on = ancRedeemed.has(a.k);
                return (
                  <button key={a.k} onClick={() => toggleAnc(a.k)} className={cx("w-full flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-colors", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                    <span className="text-[13px] font-semibold">{a.name}</span>
                    <span className="text-[12px] font-black v2-num inline-flex items-center gap-1">{miles(a.miles)} mi {on && <Icon name="check" size={13} className="text-tap-green" />}</span>
                  </button>
                );
              })}
            </div>
            {ancMiles > 0 && <div className="flex justify-between text-[13px] font-bold mt-3 pt-3 border-t border-line"><span>Extras total</span><span className="v2-num">{miles(ancMiles)} miles</span></div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function StopoverBuilder({ shared, go }) {
  const u = shared.profile?.user || {};
  const premium = /gold|platin|business|executive/i.test(`${u.tier || ""} ${trip.outbound?.fare || ""}`);
  const [nights, setNights] = useState(2);
  const [hotel, setHotel] = useState(premium ? "boutique" : "smart");
  const [exps, setExps] = useState(() => new Set(["sintra"]));
  const [transfer, setTransfer] = useState(true);
  const [added, setAdded] = useState(false);
  const HOTELS = [
    { k: "boutique", name: "Boutique · Chiado heritage", area: "Chiado", rate: 145, tag: premium ? "Recommended for you" : "Premium", note: "Design hotel in the historic centre" },
    { k: "smart", name: "Smart · Baixa central", area: "Baixa", rate: 95, tag: premium ? "Great value" : "Recommended for you", note: "Modern rooms steps from the river" },
    { k: "budget", name: "Budget · Alfama guesthouse", area: "Alfama", rate: 62, tag: "Lowest price", note: "Simple, characterful, central" },
  ];
  const EXPS = [
    { k: "sintra", name: "Sintra & Pena Palace", dur: "Full day", price: 89 },
    { k: "tram", name: "Tram 28 & Alfama walk", dur: "3 hours", price: 35 },
    { k: "fado", name: "Fado dinner in Bairro Alto", dur: "Evening", price: 68 },
    { k: "food", name: "Time Out Market food tour", dur: "3 hours", price: 55 },
  ];
  const hotelObj = HOTELS.find(h => h.k === hotel) || HOTELS[1];
  const hotelCost = hotelObj.rate * nights;
  const expList = EXPS.filter(e => exps.has(e.k));
  const expCost = expList.reduce((s, e) => s + e.price, 0);
  const transferCost = transfer ? 28 : 0;
  const total = hotelCost + expCost + transferCost;
  const toggleExp = (k) => setExps(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const addToTrip = () => {
    if (trip.outbound) {
      trip.extras = (trip.extras || []).filter(x => !/^stopover-/.test(x.code));
      toggleExtra({ code: "stopover-hotel", name: `Lisbon stopover · ${hotelObj.name} × ${nights}n`, price: hotelCost, cat: "Stopover" });
      expList.forEach(e => toggleExtra({ code: "stopover-exp-" + e.k, name: `Stopover · ${e.name}`, price: e.price, cat: "Stopover" }));
      if (transfer) toggleExtra({ code: "stopover-transfer", name: "Stopover · airport transfer", price: transferCost, cat: "Stopover" });
      trip.stopover = { nights, hotel: hotelObj.name, experiences: expList.map(e => e.name), total };
      pingBasket();
    }
    setAdded(true); window.scrollTo({ top: 0 });
  };
  if (added) return (
    <div className="mx-auto max-w-content px-6 py-10">
      <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-tap-green text-white inline-flex items-center justify-center"><Icon name="check" size={22} /></span><div><h1 className="text-[26px] font-black">Stopover added</h1><div className="text-[13px] text-ink-muted">{nights} nights in Lisbon · {hotelObj.name}</div></div></div>
      <Card className="p-5 mt-6">
        <div className="text-[13px] font-bold mb-2">Your Lisbon stopover</div>
        <div className="space-y-1.5 text-[13px]">
          <Row label={`${hotelObj.name} × ${nights} nights`} v={eurC(hotelCost)} />
          {expList.map(e => <Row key={e.k} label={e.name} v={eurC(e.price)} />)}
          {transfer && <Row label="Airport transfer" v={eurC(transferCost)} />}
        </div>
        <Divider className="my-3" />
        <div className="flex justify-between text-[15px] font-black"><span>Stopover total</span><span className="v2-num">{eurC(total)}</span></div>
      </Card>
      <div className="flex gap-3 mt-5">{trip.outbound ? <Btn onClick={() => go("cart")}>Review in cart →</Btn> : <Btn onClick={() => go("home")}>Book a flight via Lisbon →</Btn>}<Btn variant="outline" onClick={() => setAdded(false)}>Edit stopover</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Eyebrow>Portugal Stopover · free on TAP long-haul via Lisbon</Eyebrow>
      <h1 className="text-[30px] font-black mt-1">Break your trip in Lisbon</h1>
      <p className="text-[13px] text-ink-muted mt-1 max-w-2xl">Stop over for up to a few nights at no extra airfare. We've tailored the picks to your profile{premium ? " — boutique stays first, as a " + (u.tier || "premium") + " member." : "."} Every component is priced separately — add only what you want.</p>
      <div className="grid lg:grid-cols-[1fr_330px] gap-6 mt-6 items-start">
        <div className="space-y-5">
          <Card className="p-5">
            <div className="text-[13px] font-bold mb-2.5">How many nights?</div>
            <div className="flex gap-2">{[1, 2, 3].map(n => <button key={n} onClick={() => setNights(n)} className={cx("flex-1 rounded-xl border py-2.5 text-[14px] font-bold transition-colors", nights === n ? "border-tap-green bg-lime-tint text-tap-greenDeep ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>{n} night{n > 1 ? "s" : ""}</button>)}</div>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] font-bold mb-2.5">Where to stay</div>
            <div className="space-y-2.5">
              {HOTELS.map(h => {
                const on = hotel === h.k;
                return (
                  <button key={h.k} onClick={() => setHotel(h.k)} className={cx("w-full text-left rounded-xl border p-3.5 transition-colors flex items-center justify-between gap-3", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="text-[14px] font-bold">{h.name}</span><span className={cx("text-[9px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5", h.tag.includes("you") ? "bg-tap-green text-white" : "bg-surface-mute text-ink-muted")}>{h.tag}</span></div>
                      <div className="text-[11px] text-ink-faint mt-0.5">{h.note}</div>
                    </div>
                    <div className="text-right shrink-0"><div className="text-[15px] font-black v2-num">{eurC(h.rate)}</div><div className="text-[10px] text-ink-faint">/ night</div></div>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="p-5">
            <div className="text-[13px] font-bold mb-2.5">Add experiences</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {EXPS.map(e => {
                const on = exps.has(e.k);
                return (
                  <button key={e.k} onClick={() => toggleExp(e.k)} className={cx("text-left rounded-xl border p-3 transition-colors", on ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                    <div className="flex items-center justify-between"><span className="text-[13px] font-bold">{e.name}</span><span className={cx("w-4 h-4 rounded inline-flex items-center justify-center shrink-0", on ? "bg-tap-green text-white" : "border border-line-strong")}>{on && <Icon name="check" size={10} />}</span></div>
                    <div className="text-[11px] text-ink-faint mt-0.5">{e.dur}</div>
                    <div className="text-[13px] font-black v2-num mt-1">{eurC(e.price)}</div>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
        <aside className="lg:sticky lg:top-24 space-y-3">
          <Card className="p-5">
            <div className="text-[13px] font-bold mb-3">Stopover summary</div>
            <div className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-ink-muted">{hotelObj.name.split(" · ")[0]} × {nights}n</span><span className="font-semibold v2-num">{eurC(hotelCost)}</span></div>
              {expList.map(e => <div key={e.k} className="flex justify-between"><span className="text-ink-muted truncate pr-2">{e.name}</span><span className="font-semibold v2-num">{eurC(e.price)}</span></div>)}
              <label className="flex justify-between items-center cursor-pointer"><span className="text-ink-muted inline-flex items-center gap-1.5"><input type="checkbox" checked={transfer} onChange={() => setTransfer(v => !v)} className="accent-tap-green" /> Airport transfer</span><span className="font-semibold v2-num">{eurC(28)}</span></label>
            </div>
            <Divider className="my-3" />
            <div className="flex justify-between text-[16px] font-black"><span>Total</span><span className="v2-num">{eurC(total)}</span></div>
            <div className="text-[10px] text-ink-faint mt-1">Airfare unchanged · stopover billed as add-ons</div>
            <Btn className="w-full mt-3" onClick={addToTrip}>{trip.outbound ? "Add to my trip" : "Build stopover"}</Btn>
            {!trip.outbound && <div className="text-[11px] text-ink-faint mt-2 text-center">Tip: search a long-haul via Lisbon to attach this to a booking.</div>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

export function Confirmation({ shared, go }) {
  const [recs, setRecs] = useState([]);
  useEffect(() => { api.get("/destinations").then(d => setRecs((d || []).slice(0, 4))).catch(() => {}); }, []);
  // A14 · contextual ancillary recommendations for THIS booking — derived from route,
  // trip length, party size and what was NOT already purchased. Limited to 3, added to the PNR.
  const [addedRecs, setAddedRecs] = useState(() => new Set());
  const ancRecs = (() => {
    const ob = trip.outbound; const dst = ob?.flight?.dest;
    const hasBag = (trip.extras || []).some(e => /bag/i.test(e.code || "") || /bag|luggage/i.test(e.name || ""));
    const days = (trip.date && trip.ret) ? Math.max(1, Math.round((new Date(trip.ret) - new Date(trip.date)) / 864e5)) : null;
    const px = trip.pax || 1;
    const CITY = { JFK: "New York", EWR: "New York", BOS: "Boston", GRU: "São Paulo", GIG: "Rio de Janeiro", FCO: "Rome", CDG: "Paris", BCN: "Barcelona", FNC: "Funchal", LIS: "Lisbon", OPO: "Porto", MAD: "Madrid", LHR: "London" };
    const city = CITY[dst] || dst || "your destination";
    const out = [];
    if (!hasBag) out.push({ code: "bag", name: "Add a checked bag", sub: `You booked with cabin bag only${days && days >= 7 ? ` — handy for a ${days}-day trip` : ""}.`, price: 30, tag: "Most added after booking" });
    if (days && days <= 2) out.push({ code: "transfer", name: `Airport parking at ${ob?.flight?.origin || "departure"}`, sub: `A quick ${days}-day trip — park & fly, skip transfers.`, price: 24, tag: "For short trips" });
    else out.push({ code: "transfer", name: `Airport transfer in ${city}`, sub: "Private car, airport → your hotel.", price: 28, tag: "Skip the taxi queue" });
    if (px >= 3) out.push({ code: "lounge", name: "Family lounge access", sub: `${px} travellers · relax together before boarding.`, price: 22, tag: "For your group" });
    else out.push({ code: "xsell-sintra", name: `A day out near ${city}`, sub: "Hand-picked local experience · small group.", price: 89, tag: "Make the most of it" });
    return out.slice(0, 3);
  })();
  const addRec = async (code) => { setAddedRecs(s => new Set(s).add(code)); try { await api.post("/bookings/ancillary", { pnr: trip.pnr, code }); } catch { } };
  if (!trip.pnr) return noTrip(go);
  const pay = trip.payment || {}, o = trip.outbound, i = trip.inbound, u = shared.profile?.user || {}, t = tripTotals();
  const pax = trip.passengers.filter(p => p && p.first).length ? trip.passengers.filter(p => p && p.first) : [{ first: u.first_name, last: "" }];
  // Seat display driven by the booked fare so Executive/Plus never show an economy seat (e.g. Daniel's 4C).
  const leadSeat = chosenSeat() || trip.seat || seatForFare(o?.fare);
  const inSeat = i ? seatForFare(i.fare) : null;
  const seatClass = seatClassLabel(o?.fare);
  // #13 — quick actions now produce real downloads (e-ticket / boarding pass text, .ics calendar).
  const ticketText = () => {
    const seg = (c, d, seat) => c ? `${c.flight.origin} -> ${c.flight.dest}  ${c.flight.flight_no}\n  ${fmtDate(d)} · dep ${c.flight.dep} · arr ${c.flight.arr} · seat ${seat}` : "";
    return [`TAP AIR PORTUGAL — E-TICKET`, `PNR: ${trip.pnr}`, `Passenger(s): ${pax.map(p => `${p.first} ${p.last || ""}`.trim()).join(", ")}`, ``, seg(o, trip.date, leadSeat), i ? seg(i, trip.ret, inSeat || "22B") : "", ``, `Total paid: ${EUR(t.total)}`].filter(Boolean).join("\n");
  };
  const addCalendar = () => { const ics = [o, i].filter(Boolean).map(c => buildICS({ title: `TAP ${c.flight.flight_no} ${c.flight.origin}→${c.flight.dest}`, start: `${c === o ? trip.date : trip.ret}T${c.flight.dep || "08:00"}:00`, location: `${c.flight.origin} Airport`, description: `PNR ${trip.pnr} · seat ${c === o ? leadSeat : (inSeat || "22B")}` })).join("\r\n"); downloadFile(`TAP-${trip.pnr}.ics`, ics, "text/calendar"); };
  const downloadTicket = () => downloadFile(`eticket-${trip.pnr}.txt`, ticketText(), "text/plain");
  const addWallet = () => downloadFile(`boarding-pass-${trip.pnr}.txt`, ticketText(), "text/plain");
  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="mx-auto max-w-page px-6 py-8">
        <div className="flex items-center gap-3"><span className="w-11 h-11 rounded-full bg-tap-green text-white inline-flex items-center justify-center shrink-0"><Icon name="check" size={22} /></span><div><h1 className="text-[30px] font-black leading-tight">Booking Confirmed</h1><div className="text-[13px] text-ink-muted">PNR {trip.pnr} · Receipt sent to {pay.email || u.email}</div></div></div>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-6">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3"><div className="font-bold text-[16px]">Your itinerary</div><span className="text-[11px] font-bold uppercase tracking-wide bg-tap-red text-white rounded-md px-2.5 py-1">PNR {trip.pnr}</span></div>
              {[o, i].filter(Boolean).map((c, idx) => (
                <div key={idx} className="rounded-2xl p-5 mb-2 flex flex-wrap items-center gap-4" style={{ background: "#f2ffdb" }}>
                  <div><div className="text-[26px] font-bold v2-num leading-none">{c.flight.dep}</div><div className="text-[11px] text-ink-faint mt-1">{c.flight.origin} · Terminal 1</div></div>
                  <div className="flex-1 min-w-[170px] text-center text-[11px] text-ink-muted">{c.flight.duration} · nonstop<div className="h-px bg-ink/80 my-2" /><div className="font-bold text-ink">{fmtDate(idx === 0 ? trip.date : trip.ret).replace(/(\w+) (\d+) \d+/, "$1 $2")} · {c.flight.flight_no} · {c.flight.aircraft}</div><div className="mt-0.5">Seat {idx === 0 ? leadSeat : (inSeat || "22B")} · Gate info 90 min before</div></div>
                  <div className="text-right"><div className="text-[26px] font-bold v2-num leading-none">{c.flight.arr}</div><div className="text-[11px] text-ink-faint mt-1">{c.flight.dest} · Terminal 1</div></div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 mt-3">{pax.map((p, n) => <span key={n} className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-surface border border-line text-ink rounded-full px-3 py-1.5 shadow-sm"><Icon name="user" size={11} className="text-ink-muted" /> {p.first} {p.last} · {adjSeat(leadSeat, n)}</span>)}<span className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-surface border border-line text-ink rounded-full px-3 py-1.5 shadow-sm"><Icon name="bag" size={11} className="text-ink-muted" /> Carry-on × {pax.length}</span><span className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-surface border border-line text-ink rounded-full px-3 py-1.5 shadow-sm"><Icon name="seat" size={11} className="text-ink-muted" /> {seatClass}</span>{/exec/i.test(o?.fare || "") && <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold bg-surface border border-line text-ink rounded-full px-3 py-1.5 shadow-sm"><Icon name="star" size={11} className="text-ink-muted" /> Lounge access</span>}</div>
              <div className="flex flex-wrap gap-5 mt-4 text-[13px] font-semibold text-tap-greenDeep"><button onClick={addWallet} className="hover:underline">Add to Wallet</button><button onClick={addCalendar} className="hover:underline">Add to Calendar</button><button onClick={downloadTicket} className="hover:underline">Download e-ticket</button></div>
              <div className="text-[12px] text-ink-faint mt-3">Manage booking · check-in opens 24h before</div>
            </Card>
            <section>
              <h2 className="text-[20px] font-bold">Recommended for this trip</h2>
              <p className="text-[12px] text-ink-faint mb-3">Tailored to your route, trip length and party · added straight to PNR {trip.pnr} · max 3.</p>
              <div className="grid sm:grid-cols-3 gap-4">
                {ancRecs.map(r => {
                  const on = addedRecs.has(r.code);
                  return (
                    <Card key={r.code} className={cx("p-4 flex flex-col", on && "ring-1 ring-tap-green bg-lime-tint/30")}>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep bg-lime-tint rounded-full px-2 py-0.5 w-fit">{r.tag}</span>
                      <div className="font-bold text-[14px] mt-2">{r.name}</div>
                      <div className="text-[11px] text-ink-muted mt-1 flex-1">{r.sub}</div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="text-[16px] font-bold v2-num">{EUR(r.price)}</div>
                        <Btn size="sm" variant={on ? "primary" : "outline"} className="rounded-full" disabled={on} onClick={() => addRec(r.code)}>{on ? "Added ✓" : "+ Add to trip"}</Btn>
                      </div>
                    </Card>
                  );
                })}
              </div>
              {recs.length > 0 && <>
                <h2 className="text-[16px] font-bold mt-6">Where to next</h2>
                <p className="text-[12px] text-ink-faint mb-3">Ideas for your next trip based on where you go.</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  {recs.slice(0, 2).map(d => (
                    <Card key={d.code} className="overflow-hidden flex flex-col">
                      <div className="relative">
                        <Img seed={"dest-" + d.code} src={d.image_url || imageFor(d.code, d.city)} alt={d.city} className="h-32 w-full object-cover" />
                        <span className="absolute top-3 left-3 text-[10px] font-bold uppercase tracking-wide bg-white/90 text-ink rounded-md px-2 py-1 shadow-sm">{d.tag || "Experience"}</span>
                      </div>
                      <div className="p-4 flex flex-col flex-1">
                        <div className="font-bold text-[15px]">{d.city}</div>
                        <div className="text-[12px] text-ink-muted mt-1 flex-1">{d.reason || d.tag}</div>
                        <div className="flex items-center justify-between mt-3">
                          <div><div className="text-[18px] font-bold v2-num">{EUR(d.price)}</div><div className="text-[10px] text-ink-faint">per person</div></div>
                          <Btn size="sm" variant="outline" className="rounded-full" onClick={() => go("results", { origin: d.origin, dest: d.code })}>+ Add</Btn>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>}
            </section>
          </div>
          <aside className="space-y-4">
            <Card className="p-5">
              <div className="font-bold text-[16px]">Payment Receipt</div>
              <Divider className="my-3" />
              <div className="space-y-1.5 text-[13px]"><Row label={`Fare x${trip.pax}`} v={EUR(t.flights)} /><Row label="Taxes & fees" v={EUR(t.taxes)} />{t.extras ? <Row label="Extras" v={EUR(t.extras)} /> : null}{t.bundle ? <Row label="Bundle savings" v={"−" + EUR(t.bundle)} green /> : null}{pay.voucher_amt ? <Row label="Voucher" v={"−" + EUR(pay.voucher_amt)} green /> : null}{pay.miles_amt ? <Row label={`Miles (${miles(pay.miles_used)})`} v={"−" + EUR(pay.miles_amt)} green /> : null}</div>
              <Divider className="my-3" />
              <div className="rounded-lg bg-surface-soft border border-line px-3 py-2.5 flex items-center justify-between gap-2"><div className="text-[12px] font-semibold text-ink">Paid · {pay.method || "Card"} {u.card_last4 ? "••" + u.card_last4 : ""}</div><div className="text-[24px] font-black text-tap-green v2-num">{EUR(pay.card_amt ?? t.total)}</div></div>
              <div className="mt-3 rounded-xl bg-lime-tint border border-tap-green/30 px-3 py-2.5"><div className="text-[13px] font-bold text-ink flex items-center gap-1.5"><Icon name="spark" size={13} className="text-tap-green" /> You earned {miles(EARN(t.total))} miles</div><div className="text-[11px] text-ink-muted mt-0.5">+ {Math.round(EARN(t.total) * 0.2)} status miles · 2 trips to next tier</div></div>
              <Btn variant="outline" className="w-full mt-3 rounded-full" onClick={() => go("basket")}>Download invoice (PDF) →</Btn>
            </Card>
            <Card className="p-4 text-[12px] space-y-2.5"><div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="shield" size={15} /></span><div><div className="font-semibold">Free 24h cancellation</div><div className="text-ink-faint">Full refund on flights & most extras.</div></div></div><div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="heart" size={15} /></span><div><div className="font-semibold">24/7 TAP Care</div><div className="text-ink-faint">Need help? Chat with us 24/7.</div></div></div></Card>
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
  const [showFare, setShowFare] = useState(false); // #22: See fare rules toggle

  useEffect(() => {
    api.get("/seat-recommendation").then(setSeat).catch(() => {});
    if (trip.pnr) resetTrip();   // #18 — a completed booking must not seed a new Express Checkout session
    // #29 — a stale in-progress trip on a DIFFERENT route must not be reused, or the header (the usual
    // route) and the flight segments (the stale route, e.g. DEL/DXB) disagree. Rebuild to the usual route.
    if (trip.outbound && (trip.outbound.flight?.origin !== origin || trip.outbound.flight?.dest !== dest)) resetTrip();
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
  const seatNo = chosenSeat() || (/exec|plus|premium/i.test(o?.fare || "") ? seatForFare(o?.fare) : (seat?.seat || seatForFare(o?.fare)));
  const seatCost = seatUp ? 18 : 0, bagCost = bag ? 25 : 0, carbonCost = carbon ? 2 : 0;
  const taxes = Math.round((base + seatCost + bagCost + carbonCost) * 0.12);
  const total = base + seatCost + bagCost + carbonCost + taxes;
  const earn = Math.round(total * 2.88);

  async function pay() {
    if (!o) return; setBusy(true);
    try {
      const items = ["seat-" + seatNo, bag && "checked-bag", carbon && "carbon"].filter(Boolean);
      const r = await api.post("/pay", { flight_no: o.flight.flight_no, items, total, voucher_amt: 0, miles_used: 0, miles_amt: 0, card_amt: total, seat: seatNo, date, fare: o?.fare, cabin: fareCabin(o?.fare), pax: trip.pax, passengers: (trip.passengers || []).filter(p => p && p.first).map(p => ({ title: p.title, first: p.first, last: p.last })) });
      if (r.ok) { trip.pnr = r.pnr; trip.seat = seatNo; trip.payment = { total, card_amt: total, method: "Card", email: r.email?.to }; go("confirmation"); }
      else alert("Payment could not be completed: " + (r.error || "unknown"));
    } catch (e) { alert("Payment error: " + e.message); } finally { setBusy(false); }
  }

  const Sec = ({ title, action, onAction, children }) => <Card className="p-5"><div className="flex items-center justify-between mb-2"><div className="font-bold text-[15px]">{title}</div>{action && <button onClick={onAction} className="text-[12px] font-bold text-tap-greenDeep underline underline-offset-2 hover:text-tap-green">{action}</button>}</div>{children}</Card>;

  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="bg-surface border-b border-line"><div className="mx-auto max-w-page px-6 py-4 flex items-center gap-3 text-[13px] font-semibold"><span className="flex items-center gap-1.5 text-ink"><span className="w-5 h-5 rounded-full bg-lime text-ink inline-flex items-center justify-center text-[11px]">1</span> Review &amp; Pay</span><span className="flex-1 h-px bg-line-strong" /><span className="flex items-center gap-1.5 text-ink-faint"><span className="w-5 h-5 rounded-full bg-surface-mute text-ink-faint inline-flex items-center justify-center text-[11px]">2</span> Confirmation</span></div></div>
      <div className="mx-auto max-w-page px-6 py-6">
        <h1 className="text-[26px] font-bold">Express checkout</h1>
        <p className="text-[13px] text-ink-muted mt-1">Review your total and pay securely to confirm your trip. No charge has been made until you click Pay.</p>
        {!o ? <Card className="p-10 text-center mt-6"><div className="text-[14px] text-ink-muted">Loading your usual {cityOf(origin)} ⇄ {cityOf(dest)} trip…</div></Card> : (
          <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
            <div className="space-y-4">
              <Sec title={`Your trip · ${cityOf(o?.flight?.origin || origin)} ⇄ ${cityOf(o?.flight?.dest || dest)}`} action="Change flight" onAction={() => go("results", { origin, dest, date, ret: retDate, type: "round" })}>
                {[o, i].filter(Boolean).map((c, idx) => (
                  <div key={idx} className="py-2.5 border-t border-line first:border-0">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wide bg-surface-soft text-ink rounded-md px-2 py-0.5 mb-1.5">{idx === 0 ? "Outbound" : "Return"} · {fmtDate(idx === 0 ? date : retDate).replace(/(\w+) (\d+) \d+/, "$1 $2")}</span>
                    <div className="flex items-center gap-3"><div><div className="text-[18px] font-bold v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin}</div></div><div className="flex-1 text-center text-[11px] text-ink-muted">{c.flight.duration} · Direct<div className="h-px bg-line-strong my-1" /><div className="font-semibold text-ink-muted">{c.flight.flight_no} · {c.flight.aircraft}</div></div><div className="text-right"><div className="text-[18px] font-bold v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div></div>
                  </div>
                ))}
                <div className="mt-2 pt-3 border-t border-line flex items-start justify-between gap-3"><div><div className="text-[13px] font-bold">Fare: Classic</div><div className="text-[11px] text-ink-muted mt-0.5">23kg bag · seat select · 50% refund · changes for fee</div></div><button onClick={() => setShowFare(v => !v)} className="text-[12px] font-bold text-tap-greenDeep underline underline-offset-2 hover:text-tap-green shrink-0">{showFare ? "Hide fare rules" : "See fare rules"}</button></div>
                {showFare && <div className="mt-2 rounded-xl border border-line bg-surface-soft p-3 text-[12px] text-ink-muted space-y-1.5 v2-in">
                  <div className="flex justify-between"><span>Cabin bag (8kg) + checked bag (23kg)</span><span className="font-semibold text-ink">Included</span></div>
                  <div className="flex justify-between"><span>Seat selection</span><span className="font-semibold text-ink">Included</span></div>
                  <div className="flex justify-between"><span>Date / time change</span><span className="font-semibold text-ink">Fee + fare difference</span></div>
                  <div className="flex justify-between"><span>Cancellation refund</span><span className="font-semibold text-ink">50% of fare</span></div>
                  <div className="flex justify-between"><span>Miles earned</span><span className="font-semibold text-ink">100% (Classic)</span></div>
                </div>}
              </Sec>
              <Sec title="Passenger" action="Edit" onAction={() => go("passenger")}>
                <div className="flex items-center gap-3"><span className="w-9 h-9 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{(u.first_name || "D")[0]}</span><div><div className="font-bold text-[14px] flex items-center gap-2">{u.full_name || u.first_name} <Pill tone="gold">{u.tier} · {u.member_no}</Pill></div><div className="text-[11px] text-ink-faint">DOB {u.dob || "—"} · Passport ••••{(u.doc_id || "0000").slice(-4)} · Nationality {u.nationality || "PT"}</div><div className="text-[11px] text-tap-greenDeep font-semibold mt-0.5">Frequent flyer benefits applied: priority boarding, lounge</div></div></div>
              </Sec>
              <Sec title="Baggage" action="+ Add bag" onAction={() => go("cart")}>
                <div className="flex items-center justify-between text-[13px] py-1"><div><div className="font-semibold">Cabin bag · 8kg</div><div className="text-[11px] text-ink-faint">Included in fare</div></div><span className="text-[10px] font-bold uppercase tracking-wide bg-surface-mute text-ink rounded px-2 py-0.5">Included</span></div>
                <div className="flex items-center justify-between text-[13px] py-1 mt-1"><div><div className="font-semibold">Checked bag · 23kg ×1</div><div className="text-[11px] text-ink-faint">Outbound + return</div></div><span className="flex items-center gap-2"><span className="v2-num font-bold">{eur2(25)}</span><span className="text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded px-2 py-0.5">Added</span></span></div>
              </Sec>
              <Sec title="Payment method" action="+ Change" onAction={() => go("payment")}>
                <div className="flex items-center justify-between"><div className="text-[14px] font-semibold flex items-center gap-2">{u.first_name}'s Card <span className="text-[10px] font-bold tracking-wide bg-lime-tint text-tap-greenDeep rounded px-1.5 py-0.5">VISA</span></div><span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded px-2 py-0.5"><Icon name="lock" size={10} /> Encrypted</span></div>
                <div className="text-[13px] v2-num mt-1 tracking-wide">XXXX XXXX XXXX {u.card_last4 || "4242"}</div>
                <div className="mt-3 rounded-xl border border-dashed border-line bg-surface-soft p-3 flex items-center gap-3 text-[12px]"><span className="w-8 h-8 rounded-lg bg-surface-mute inline-flex items-center justify-center shrink-0"><Icon name="lock" size={13} className="text-ink-faint" /></span><div className="flex-1"><div className="font-semibold">Bank verification (3-D Secure) appears here when required</div><div className="text-ink-faint">Your bank may ask for a code, push, or biometric.</div></div><span className="text-[10px] font-bold uppercase tracking-wide bg-surface-mute text-ink-muted rounded px-2 py-0.5 shrink-0">3-D Secure 2.0</span></div>
              </Sec>
              <Sec title="Seat selection" action="Change seat" onAction={() => go("seatchange")}>
                <div className="flex items-center justify-between text-[13px] py-1"><div><div className="font-semibold">Outbound · {seatNo} ({seatZone(o?.fare)})</div><div className="text-[11px] text-ink-faint">{o.flight.flight_no} · {o.flight.aircraft} · Seat {seatNo}</div></div><span className="flex items-center gap-2"><span className="v2-num font-bold">{eur2(18)}</span><span className="text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded px-2 py-0.5">Added</span></span></div>
                <div className="flex items-center justify-between text-[13px] py-1 mt-1"><div><div className="font-semibold">Return · {seatForFare(i?.fare)} ({seatZone(i?.fare)})</div><div className="text-[11px] text-ink-faint">{i?.flight?.flight_no || ""}{i ? ` · ${i.flight.aircraft} · Seat ${seatForFare(i?.fare)}` : ""}</div></div><span className="text-[10px] font-bold uppercase tracking-wide bg-surface-mute text-ink rounded px-2 py-0.5">Free · {u.tier}</span></div>
              </Sec>
              <Sec title="Contact details" action="Edit" onAction={() => go("passenger")}>
                <div className="text-[13px]">{(u.email || "d•••@gmail.com").replace(/(.).+(@.+)/, "$1•••••$2")} · {u.phone || "+351 ••• 482"}</div>
                <div className="text-[11px] text-ink-faint mt-0.5">Boarding pass, receipt and IROPS alerts go here.</div>
              </Sec>
              <Card className="p-4"><label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="accent-ink mt-0.5 w-4 h-4" /><span className="flex-1"><span className="flex items-center gap-2 font-semibold">I accept the fare conditions {!agree && <span className="text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded px-1.5 py-0.5">Required</span>}</span><span className="block text-[11px] text-ink-muted mt-0.5">By continuing you agree to the <button className="text-tap-greenDeep hover:underline font-semibold">fare conditions</button> · <button className="text-tap-greenDeep hover:underline font-semibold">baggage rules</button> · <button className="text-tap-greenDeep hover:underline font-semibold">privacy policy</button>.</span></span></label></Card>
            </div>
            <aside className="space-y-4">
              <Card className="p-5">
                <div className="text-[17px] font-bold mb-3">My trip basket</div>
                <div className="space-y-2 text-[13px]"><Row label="Base fare · 1 adult" v={eur2(base)} /><Row label="Taxes & fees" v={eur2(taxes)} />{seatUp && <Row label={`Seat ${seatNo} · extra legroom`} v={eur2(seatCost)} />}{bag && <Row label="Checked bag 23kg" v={eur2(bagCost)} />}{carbon && <Row label="Carbon offset" v={eur2(carbonCost)} />}</div>
                <Divider className="my-3" />
                <div className="flex items-center justify-between"><div className="text-[13px] font-bold text-ink">Total to pay</div><div className="text-[26px] font-black v2-num text-ink">{eur2(total)}</div></div>
                <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2">Earn {miles(earn)} miles · or pay {miles(Math.round(total * 0.9 / MILES_RATE))} mi + {eur2(Math.round(total * 0.1))}</div>
                <div className="mt-3 flex items-stretch rounded-lg border border-line-strong overflow-hidden focus-within:border-tap-green"><input placeholder="Promo code" className="flex-1 bg-surface px-3 py-2 text-[12px] outline-none" /><button className="px-4 text-[12px] font-bold text-tap-greenDeep border-l border-line-strong hover:bg-lime-tint">Apply</button></div>
                <div className="mt-3 rounded-lg bg-[#fff4e0] border border-[#f5d98e] text-[#7a5a10] text-[12px] px-3 py-2 flex items-center gap-1.5"><span className="text-[#e8920a] text-[8px]">●</span> <SessionTimer minutes={15} prefix="Price held for" /> · won't change if you pay now</div>
                <Btn size="lg" className="w-full mt-3" disabled={!agree || busy} onClick={pay}>{busy ? "Processing…" : `Pay ${eur2(total)} securely`}</Btn>
                <div className="flex items-center justify-center gap-4 mt-2 text-[12px] font-semibold text-ink"><button className="hover:underline">Save &amp; pay later</button><button onClick={() => go("payment")} className="hover:underline">Use miles instead</button></div>
                <div className="text-[10px] text-ink-faint text-center mt-2 leading-relaxed">PCI · Visa · Mastercard · Amex · MB WAY · Apple Pay · PayPal<br />Free 24h cancellation · Refundable taxes · 24/7 support</div>
              </Card>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
