// FlyTAP v2 — booking spine: Cart → Passenger details → Payment → Confirmation.
// Built to the approved Figma and wired so a booking actually completes via /api/pay
// (DB row + confirmation email + CDP "booked" event), then lands on Confirmation.
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE } from "./lib.js";
import { trip, tripTotals, toggleExtra, hasExtra } from "./trip.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, cx } from "./ui.jsx";

const EARN = (total) => Math.round(total * 2.9);

/* ── shared: stepper ── */
const STEPS = ["Select flights", "Trip extras", "My Trip Cart", "Passenger details", "Payment"];
function Stepper({ active }) {
  return (
    <div className="bg-surface border-b border-line">
      <div className="mx-auto max-w-page px-6 py-4 flex items-center gap-2 overflow-x-auto v2-track text-[13px] font-semibold">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <span className={cx("shrink-0 flex items-center gap-1.5", i < active ? "text-tap-greenDeep" : i === active ? "text-ink" : "text-ink-faint")}>
              <span className={cx("w-5 h-5 rounded-full inline-flex items-center justify-center text-[11px]", i < active ? "bg-tap-green text-white" : i === active ? "bg-lime text-ink" : "bg-surface-mute text-ink-faint")}>{i < active ? "✓" : i + 1}</span>
              {s}
            </span>
            {i < STEPS.length - 1 && <span className={cx("flex-1 min-w-[16px] h-px", i < active ? "bg-tap-green" : "bg-line-strong")} />}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
const Chip = ({ children }) => <span className="px-3 py-1.5 rounded-full bg-surface border border-line text-[12px] font-semibold">{children}</span>;

/* ── shared: basket summary (right rail) ── */
function BasketSummary({ step, cta, onCta, disabled, secondary, onSecondary, note }) {
  const t = tripTotals();
  const lines = [["Flights", t.flights, `${trip.pax} pax`], ...trip.extras.map(e => [e.name, (e.price || 0) * (e.qty || 1)]), ["Taxes & fees", t.taxes]];
  return (
    <aside className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between"><div className="text-[18px] font-bold">My trip basket</div><Pill tone="red">Step {step}/5</Pill></div>
        <div className="text-[11px] text-ink-faint mt-0.5">{trip.origin}–{trip.dest} · {trip.pax} adult{trip.pax > 1 ? "s" : ""} · {trip.extras.length} extras</div>
        <div className="mt-4 space-y-2">
          {lines.map(([label, amt, tag], i) => (
            <div key={i} className="flex items-center justify-between text-[13px]"><span className="text-ink-muted flex items-center gap-1.5">{label}{tag && <Pill tone="slate">{tag}</Pill>}</span><span className="font-semibold v2-num">{EUR(amt)}</span></div>
          ))}
        </div>
        <Divider className="my-4" />
        <div className="flex items-end justify-between"><div><div className="text-[12px] text-ink-muted">Total to pay</div><div className="text-[10px] text-ink-faint">incl. taxes · in EUR</div></div><div className="text-[26px] font-black v2-num">{EUR(t.total)}</div></div>
        <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center justify-between"><span className="flex items-center gap-1.5"><Icon name="spark" size={12} /> You'll earn</span><span className="v2-num">{miles(EARN(t.total))} tap.miles</span></div>
        <Btn size="lg" className="w-full mt-4" disabled={disabled} onClick={onCta}>{cta}</Btn>
        {secondary && <Btn variant="outline" className="w-full mt-2" onClick={onSecondary}>{secondary}</Btn>}
        {note && <div className="text-[11px] text-ink-faint text-center mt-2">{note}</div>}
      </Card>
      <Card className="p-4 space-y-2.5 text-[12px]">
        {[["check", "Price locked for 15 min", "Complete checkout to keep this rate"], ["clock", "24h free cancellation", "On flights & most extras"], ["star", "24/7 customer care", "WhatsApp · phone · live chat"]].map(([ic, t2, s]) => (
          <div key={t2} className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name={ic} size={15} /></span><div><div className="font-semibold">{t2}</div><div className="text-ink-faint">{s}</div></div></div>
        ))}
      </Card>
    </aside>
  );
}

const noTrip = (go) => (
  <div className="mx-auto max-w-content px-6 py-16 text-center">
    <Card className="p-10"><div className="text-[18px] font-bold">Your cart is empty</div><div className="text-[13px] text-ink-muted mt-2">Search and pick a flight to start a booking.</div><Btn className="mt-4" onClick={() => go("home")}>Start a search →</Btn></Card>
  </div>
);

/* ── flight summary card (shared) ── */
function FlightSummary({ go }) {
  const o = trip.outbound, i = trip.inbound;
  if (!o) return null;
  const Leg = ({ label, c }) => c && (
    <div className="flex flex-wrap items-center gap-4 py-2">
      <Pill tone="slate">{label}</Pill>
      <div className="flex items-center gap-3"><div><div className="text-[20px] font-bold v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin}</div></div><Icon name="plane" size={15} className="text-tap-green" /><div><div className="text-[20px] font-bold v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div></div>
      <div className="text-[12px] text-ink-muted">{c.flight.duration} · Direct · {c.flight.flight_no} · {c.flight.aircraft}</div>
      <div className="ml-auto text-[13px] font-bold v2-num">{EUR(c.price)}</div>
    </div>
  );
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1"><div className="flex items-center gap-2"><Pill tone="lime">Class W · {o.fare}</Pill><span className="text-[12px] text-ink-muted">{trip.origin} ⇄ {trip.dest}</span></div><button className="text-[12px] font-semibold text-tap-greenDeep" onClick={() => go("results", { origin: trip.origin, dest: trip.dest, date: trip.date, ret: trip.ret, type: trip.type })}>Change flight</button></div>
      <Leg label="Outbound" c={o} /><Divider /><Leg label="Return" c={i} />
    </Card>
  );
}

/* ═══════════ CART ═══════════ */
export function Cart({ go }) {
  const [anc, setAnc] = useState([]);
  const [, force] = useState(0);
  useEffect(() => { api.get("/ancillaries").then(setAnc).catch(() => {}); }, []);
  if (!trip.outbound) return noTrip(go);
  const groups = {
    "Seats & baggage": anc.filter(a => /seat|bag|legroom/i.test(a.name)),
    "Lounge & priority": anc.filter(a => /lounge|priority|fast.?track/i.test(a.name)),
    "Protection & comfort": anc.filter(a => /insurance|protect|flex|cancel/i.test(a.name)),
    "Onboard": anc.filter(a => /meal|wifi|espresso|snack|drink|pastel/i.test(a.name)),
  };
  const used = new Set(Object.values(groups).flat().map(a => a.code));
  groups["More extras"] = anc.filter(a => !used.has(a.code));
  const toggle = (a) => { toggleExtra({ code: a.code, name: a.name, price: a.price }); api.post("/basket", { flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code) }).catch(() => {}); force(x => x + 1); };

  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={1} />
      <div className="mx-auto max-w-page px-6 py-6">
        <h1 className="text-[26px] font-bold">View &amp; customize cart</h1>
        <p className="text-[13px] text-ink-muted mt-1">Choose seats, baggage, protection and experiences. Everything you add flows into your trip.</p>
        <div className="flex flex-wrap gap-2 mt-3"><Chip>{trip.origin}–{trip.dest}</Chip><Chip>{trip.pax} adult{trip.pax > 1 ? "s" : ""}</Chip><Chip>{fmtDate(trip.date).replace(/ \d{4}/, "")}{trip.ret ? " – " + fmtDate(trip.ret).replace(/ \d{4}/, "") : ""}</Chip><Chip>All extras optional</Chip></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            <FlightSummary go={go} />
            {Object.entries(groups).filter(([, list]) => list.length).map(([title, list], gi) => (
              <Card key={title} className="p-5">
                <div className="flex items-center gap-2 mb-3"><span className="text-[10px] font-bold text-ink-faint">0{gi + 1}</span><div className="font-bold text-[15px]">{title}</div></div>
                <div className="space-y-2">
                  {list.map(a => {
                    const on = hasExtra(a.code);
                    return (
                      <div key={a.code} className={cx("flex items-center gap-3 rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}>
                        <div className="flex-1"><div className="text-[13px] font-semibold flex items-center gap-2">{a.name}{a.recommended && <Pill tone="lime">Recommended</Pill>}</div><div className="text-[11px] text-ink-muted">{a.reason || a.desc || "Add before you fly"}</div></div>
                        <div className="text-[13px] font-bold v2-num">{a.price ? EUR(a.price) : "Included"}</div>
                        <Btn size="sm" variant={on ? "outline" : "primary"} onClick={() => toggle(a)}>{on ? "Remove" : "Add"}</Btn>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-1"><div className="font-bold text-[15px]">Stay &amp; experiences</div><Pill tone="slate">via voa</Pill></div>
              <p className="text-[11px] text-ink-muted mb-3">Hotels, transfers and experiences are coming from AEM (offers-headless, Phase 3). Add demo bundles for now.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                {[{ code: "hotel-lis", name: "Hotel — Memmo Príncipe Real", price: 640 }, { code: "exp-belem", name: "Belém food walking tour", price: 130 }].map(m => {
                  const on = hasExtra(m.code);
                  return <div key={m.code} className={cx("rounded-xl border p-3", on ? "border-tap-green bg-lime-tint/40" : "border-line")}><div className="text-[13px] font-semibold">{m.name}</div><div className="flex items-center justify-between mt-2"><span className="text-[13px] font-bold v2-num">{EUR(m.price)}</span><Btn size="sm" variant={on ? "outline" : "primary"} onClick={() => { toggleExtra({ ...m }); force(x => x + 1); }}>{on ? "Remove" : "Add"}</Btn></div></div>;
                })}
              </div>
            </Card>
          </div>
          <BasketSummary step={3} cta="Continue to passenger details →" onCta={() => go("passenger")} secondary="Skip extras & continue" onSecondary={() => go("passenger")} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ PASSENGER DETAILS ═══════════ */
function PaxForm({ idx, prefill }) {
  const [p, setP] = useState(prefill || {});
  const f = (k) => ({ value: p[k] || "", onChange: e => setP({ ...p, [k]: e.target.value }) });
  useEffect(() => { trip.passengers[idx] = p; }, [p]);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><span className="w-8 h-8 rounded-full bg-surface-dark text-white inline-flex items-center justify-center text-[12px] font-bold">{(p.first || "P")[0]}{idx + 1}</span><div className="font-bold text-[15px]">Passenger {idx + 1}{p.first ? " · " + p.first + " " + (p.last || "") : " · Add details"}</div>{prefill && <Pill tone="lime">{prefill.tier || "GOLD"}</Pill>}</div>
        {prefill && <span className="text-[12px] text-ink-faint">contact for this booking</span>}
      </div>
      <Eyebrow className="mb-2">Identity · as shown on passport</Eyebrow>
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Title"><Input {...f("title")} placeholder="Mr/Ms" /></Field>
        <Field label="First / middle names"><Input {...f("first")} /></Field>
        <Field label="Last name"><Input {...f("last")} /></Field>
        <Field label="Date of birth"><Input {...f("dob")} placeholder="DD/MM/YYYY" /></Field>
        <Field label="Nationality"><Input {...f("nat")} /></Field>
        <Field label="Passport number"><Input {...f("doc")} /></Field>
      </div>
      {prefill && <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2 flex items-center gap-2"><Icon name="spark" size={13} /> TAP.miles applied · {prefill.member} · {prefill.tier} tier — you'll earn miles on this trip.</div>}
    </Card>
  );
}
export function Passenger({ shared, go }) {
  if (!trip.outbound) return noTrip(go);
  const u = shared.profile?.user || {};
  const last = (u.full_name || "").replace(u.first_name || "", "").trim();
  const p1 = { title: u.gender === "Female" ? "Ms" : "Mr", first: u.first_name, last, dob: u.dob, nat: u.nationality, doc: u.doc_id, member: u.member_no, tier: u.tier };
  const [contact, setContact] = useState({ email: u.email || "", phone: u.phone || "" });
  useEffect(() => { trip.contact = contact; }, [contact]);
  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={3} />
      <div className="mx-auto max-w-page px-6 py-6">
        <h1 className="text-[26px] font-bold">Passenger details</h1>
        <p className="text-[13px] text-ink-muted mt-1">Enter passenger information exactly as it appears on travel documents.</p>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            <PaxForm idx={0} prefill={p1} />
            {Array.from({ length: Math.max(0, trip.pax - 1) }).map((_, i) => <PaxForm key={i} idx={i + 1} />)}
            <Card className="p-5">
              <div className="font-bold text-[15px] mb-1">Contact details for this booking</div>
              <p className="text-[11px] text-ink-muted mb-3">Confirmation, boarding pass and IROPS alerts go here.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Email"><Input value={contact.email} onChange={e => setContact({ ...contact, email: e.target.value })} /></Field>
                <Field label="Mobile phone"><Input value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })} /></Field>
              </div>
            </Card>
          </div>
          <BasketSummary step={4} cta="Continue to payment →" onCta={() => go("payment")} secondary="← Back to cart" onSecondary={() => go("cart")} />
        </div>
      </div>
    </div>
  );
}

/* ═══════════ PAYMENT ═══════════ */
const METHODS = ["Card", "Digital Wallet", "Miles & Go", "Bank transfer", "Split Payment", "Mix Method"];
export function Payment({ shared, go }) {
  if (!trip.outbound) return noTrip(go);
  const u = shared.profile?.user || {};
  const voucher = (shared.profile?.vouchers || []).find(v => v.status === "active")?.amount || 0;
  const t = tripTotals();
  const [method, setMethod] = useState("Card");
  const [agree, setAgree] = useState(true);
  const [useV, setUseV] = useState(false);
  const [milesUsed, setMilesUsed] = useState(0);
  const [busy, setBusy] = useState(false);

  // compute split
  let voucher_amt = 0, miles_used = 0, miles_amt = 0;
  if (method === "Miles & Go") { miles_used = Math.min(u.miles || 0, Math.round(t.total / MILES_RATE)); miles_amt = Math.round(miles_used * MILES_RATE); voucher_amt = Math.min(voucher, Math.max(0, t.total - miles_amt)); }
  else if (method === "Mix Method") { voucher_amt = useV ? Math.min(voucher, t.total) : 0; miles_used = milesUsed; miles_amt = Math.round(miles_used * MILES_RATE); }
  const card_amt = Math.max(0, t.total - voucher_amt - miles_amt);

  async function pay() {
    setBusy(true);
    try {
      const r = await api.post("/pay", {
        flight_no: trip.outbound.flight.flight_no, items: trip.extras.map(e => e.code || e.name),
        total: t.total, voucher_amt, miles_used, miles_amt, card_amt,
        seat: trip.outbound.flight.seat || "4C", date: trip.date,
      });
      if (r.ok) { trip.pnr = r.pnr; trip.payment = { total: t.total, voucher_amt, miles_used, miles_amt, card_amt, method, email: r.email?.to }; go("confirmation"); }
      else alert("Payment could not be completed: " + (r.error || "unknown"));
    } catch (e) { alert("Payment error: " + e.message); } finally { setBusy(false); }
  }

  return (
    <div className="bg-surface-soft min-h-screen">
      <Stepper active={4} />
      <div className="mx-auto max-w-page px-6 py-6">
        <div className="flex items-center gap-3"><h1 className="text-[26px] font-bold">Payment</h1><Pill tone="slate"><Icon name="check" size={11} /> Secure checkout · powered by Stripe</Pill></div>
        <p className="text-[13px] text-ink-muted mt-1">Review your total and pay securely. No charge is made until you click Pay.</p>
        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            {/* method tabs */}
            <Card className="p-1.5 flex gap-1 overflow-x-auto v2-track">
              {METHODS.map(m => <button key={m} onClick={() => setMethod(m)} className={cx("shrink-0 px-3.5 py-2 rounded-lg text-[13px] font-semibold", method === m ? "bg-tap-green text-white" : "text-ink-muted hover:bg-surface-mute")}>{m}</button>)}
            </Card>

            <Card className="p-5">
              {method === "Card" && <>
                <div className="font-bold text-[15px] mb-3 flex items-center gap-2"><Icon name="check" size={14} className="text-tap-green" /> Pay by card</div>
                <div className="grid gap-3">
                  <Field label="Cardholder name"><Input defaultValue={(u.full_name || "").toUpperCase()} /></Field>
                  <Field label="Card number"><Input defaultValue={`XXXX XXXX XXXX ${u.card_last4 || "4242"}`} /></Field>
                  <div className="grid grid-cols-2 gap-3"><Field label="Expiry (MM/YY)"><Input defaultValue={u.card_exp || "09/28"} /></Field><Field label="CVC"><Input defaultValue="•••" /></Field></div>
                </div>
              </>}
              {(method === "Miles & Go") && <div className="text-[13px]"><div className="font-bold text-[15px] mb-2">Pay with Miles &amp; Go</div><p className="text-ink-muted">Using {miles(miles_used)} miles ({EUR(miles_amt)}){voucher_amt ? ` + €${voucher_amt} voucher` : ""}; the remaining {EUR(card_amt)} goes to your saved card.</p></div>}
              {(method === "Mix Method") && <div className="space-y-3"><div className="font-bold text-[15px]">Payment composer</div>
                <label className="flex items-center justify-between text-[13px] rounded-xl border border-line p-3"><span>Voucher {voucher ? `(€${voucher} available)` : "(none)"}</span><input type="checkbox" disabled={!voucher} checked={useV} onChange={e => setUseV(e.target.checked)} className="accent-[#46a41a]" /></label>
                <div className="rounded-xl border border-line p-3"><div className="flex items-center justify-between text-[13px]"><span>TAP miles ({miles(u.miles)} avail)</span><span className="font-semibold v2-num">{miles(milesUsed)} mi · {EUR(miles_amt)}</span></div><input type="range" min="0" max={Math.min(u.miles || 0, Math.round((t.total - voucher_amt) / MILES_RATE))} step="500" value={milesUsed} onChange={e => setMilesUsed(+e.target.value)} className="w-full accent-[#46a41a] mt-2" /></div>
                <div className="text-[12px] text-ink-muted">Card pays the remainder: <b className="text-ink">{EUR(card_amt)}</b></div></div>}
              {(method === "Digital Wallet" || method === "Bank transfer") && <div className="text-[13px] text-ink-muted">{method} selected — you'll be redirected to complete payment. (Demo charges your saved card for {EUR(t.total)}.)</div>}
              {(method === "Split Payment") && <div className="text-[13px] text-ink-muted"><div className="font-bold text-[15px] text-ink mb-2">Split equally</div>{Array.from({ length: trip.pax }).map((_, i) => <div key={i} className="flex items-center justify-between rounded-xl border border-line p-3 mb-2"><span>Payer {i + 1}{i === 0 ? " · you" : ""}</span><span className="font-semibold v2-num">{EUR(t.total / trip.pax)} ({Math.round(100 / trip.pax)}%)</span></div>)}<p className="text-ink-faint">Per-passenger secure links (A17) come next — the demo charges the lead payer for {EUR(t.total)}.</p></div>}
            </Card>

            <Card className="p-4">
              <label className="flex items-start gap-2.5 text-[13px]"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="accent-[#46a41a] mt-0.5" /><span>I've read and accept the <b>fare conditions</b>, <b>baggage rules</b> and <b>privacy policy</b>. {!agree && <span className="text-tap-red font-semibold">Required</span>}</span></label>
            </Card>
          </div>
          <BasketSummary step={4} cta={busy ? "Processing…" : `Pay ${EUR(t.total)} & complete booking`} disabled={!agree || busy} onCta={pay} secondary="← Back to passenger details" onSecondary={() => go("passenger")} note="By paying you confirm fare conditions & privacy policy." />
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
  const pay = trip.payment || {}, o = trip.outbound, i = trip.inbound, u = shared.profile?.user || {};
  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="mx-auto max-w-page px-6 py-8">
        <div className="flex items-center gap-3"><span className="w-10 h-10 rounded-full bg-tap-green text-white inline-flex items-center justify-center"><Icon name="check" size={20} /></span><div><h1 className="text-[30px] font-black">Booking confirmed</h1><div className="text-[13px] text-ink-muted">PNR {trip.pnr} · receipt sent to {pay.email || u.email}</div></div></div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
          <div className="space-y-5">
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3"><div className="font-bold text-[15px]">Your itinerary</div><Pill tone="red">PNR {trip.pnr}</Pill></div>
              {[o, i].filter(Boolean).map((c, idx) => (
                <div key={idx} className="rounded-xl bg-lime-tint/50 p-4 mb-2 flex flex-wrap items-center gap-4">
                  <div><div className="text-[22px] font-bold v2-num">{c.flight.dep}</div><div className="text-[11px] text-ink-faint">{c.flight.origin}</div></div>
                  <div className="text-center text-[11px] text-ink-muted flex-1 min-w-[120px]">{fmtDate(idx === 0 ? trip.date : trip.ret).replace(/ \d{4}/, "")} · {c.flight.flight_no} · {c.flight.aircraft}<div className="h-px bg-line-strong my-1" />{c.flight.duration} · Direct</div>
                  <div className="text-right"><div className="text-[22px] font-bold v2-num">{c.flight.arr}</div><div className="text-[11px] text-ink-faint">{c.flight.dest}</div></div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 mt-2">{(trip.passengers.length ? trip.passengers : [{ first: u.first_name, last: "" }]).map((p, n) => <Pill key={n} tone="slate">{p.first} {p.last}</Pill>)}{trip.extras.map(e => <Pill key={e.code} tone="slate">{e.name}</Pill>)}</div>
              <div className="flex gap-4 mt-4 text-[13px] font-semibold text-tap-greenDeep"><button>Add to Wallet</button><button>Add to Calendar</button><button>Download e-ticket</button></div>
            </Card>

            <section>
              <h2 className="text-[20px] font-bold mb-1">Useful for your trip</h2>
              <p className="text-[12px] text-ink-faint mb-3">Limited · helpful · not pushy.</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {recs.map(d => (
                  <Card key={d.code} className="overflow-hidden"><div className="h-24 flex items-center justify-center text-3xl bg-gradient-to-br from-surface-navy to-surface-navy2 text-white">{d.emoji || "✈️"}</div><div className="p-3.5"><div className="font-bold text-[14px]">{d.city}</div><div className="text-[11px] text-ink-muted mt-0.5 line-clamp-2 min-h-[28px]">{d.reason || d.tag}</div><div className="flex items-center justify-between mt-2"><span className="text-[13px] font-bold">from {EUR(d.price)}</span><Btn size="sm" variant="outline" onClick={() => go("results", { origin: d.origin, dest: d.code })}>+ Add</Btn></div></div></Card>
                ))}
              </div>
            </section>
          </div>

          <aside className="space-y-4">
            <Card className="p-5">
              <div className="font-bold text-[16px] mb-3">Payment receipt</div>
              <div className="space-y-1.5 text-[13px]">
                <Row label="Fare" v={EUR(tripTotals().flights)} /><Row label="Taxes & fees" v={EUR(tripTotals().taxes)} />{trip.extras.length ? <Row label="Extras" v={EUR(tripTotals().extras)} /> : null}
                {pay.voucher_amt ? <Row label="Voucher" v={"−" + EUR(pay.voucher_amt)} green /> : null}{pay.miles_amt ? <Row label={`Miles (${miles(pay.miles_used)})`} v={"−" + EUR(pay.miles_amt)} green /> : null}
              </div>
              <Divider className="my-3" />
              <div className="flex items-center justify-between"><div><div className="text-[11px] text-ink-faint">Paid · {pay.method || "Card"} {u.card_last4 ? "••" + u.card_last4 : ""}</div></div><div className="text-[24px] font-black text-tap-green v2-num">{EUR(pay.card_amt ?? tripTotals().total)}</div></div>
              <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark text-[12px] font-semibold px-3 py-2"><Icon name="spark" size={12} className="inline" /> You earned {miles(EARN(tripTotals().total))} miles</div>
              <Btn variant="outline" className="w-full mt-3" onClick={() => go("basket")}>Download invoice (PDF) →</Btn>
            </Card>
            <Card className="p-4 text-[12px] space-y-2.5">
              <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="clock" size={15} /></span><div><div className="font-semibold">Free 24h cancellation</div><div className="text-ink-faint">Full refund on flights & most extras.</div></div></div>
              <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="star" size={15} /></span><div><div className="font-semibold">24/7 TAP Care</div><div className="text-ink-faint">Chat with us anytime.</div></div></div>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
const Row = ({ label, v, green }) => <div className="flex items-center justify-between"><span className="text-ink-muted">{label}</span><span className={cx("font-semibold v2-num", green && "text-tap-greenDeep")}>{v}</span></div>;
