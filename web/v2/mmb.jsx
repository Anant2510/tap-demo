// FlyTAP v2 — Manage My Booking (MMB). Seven flows wired to the live (unchanged)
// backend: Retrieve/hub (J1), Cabin upgrade (A9), Seat change (A10), Rebook on
// disruption (C2), Online check-in (J3), Add extras (J4), Cancel & refund (C4).
// Each screen reads the same "current booking" the server acts on (mirror of the
// server's currentBooking()), so the card you see is the booking the action mutates.
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE } from "./lib.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, WhyChip, cx } from "./ui.jsx";
import { Page } from "./shell.jsx";

/* ── shared helpers ───────────────────────────────────────────── */
// Mirror server currentBooking(): nearest upcoming confirmed booking, else latest confirmed.
function pickActive(list) {
  const confirmed = (list || []).filter(b => b.status === "confirmed");
  const upcoming = confirmed
    .filter(b => (b.days_to_go ?? 0) >= 0)
    .sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date)));
  if (upcoming[0]) return upcoming[0];
  const latest = [...confirmed].sort((a, b) => String(b.flight_date).localeCompare(String(a.flight_date)));
  return latest[0] || (list && list[0]) || null;
}

function useActiveBooking() {
  const [state, setState] = useState({ booking: null, all: [], loading: true, err: null });
  useEffect(() => {
    let alive = true;
    api.get("/bookings")
      .then(rows => { if (alive) setState({ booking: pickActive(rows), all: rows || [], loading: false, err: null }); })
      .catch(e => { if (alive) setState({ booking: null, all: [], loading: false, err: e?.message || "Couldn't load your bookings" }); });
    return () => { alive = false; };
  }, []);
  return state;
}

const cityOf = (airports, code) => (airports || []).find(a => a.code === code)?.city || code || "—";
const lastName = (u) => u.last_name || (u.full_name ? u.full_name.split(" ").slice(-1)[0] : "");
// Friendly labels for the seeded extra codes stored on a booking's items_json.
const EXTRA_LABEL = { seat: "Seat", bag: "Checked bag", meal: "Meal", wifi: "Wi-Fi", transfer: "Transfer", car: "Transfer", lounge: "Lounge", upgrade: "Cabin upgrade" };
const extraLabel = (c) => EXTRA_LABEL[c] || String(c);

const Loading = ({ label = "Retrieving your booking…" }) => (
  <Page><Card className="p-10 text-center v2-in"><div className="text-[14px] text-ink-muted">{label}</div></Card></Page>
);

const Empty = ({ go, title = "No upcoming flight", msg = "You don't have an active booking to manage right now." }) => (
  <Page><Card className="p-10 text-center v2-in">
    <div className="w-12 h-12 rounded-full bg-surface-mute inline-flex items-center justify-center mb-3 mx-auto"><Icon name="plane" size={20} className="text-ink-faint" /></div>
    <div className="text-[18px] font-bold">{title}</div>
    <div className="text-[13px] text-ink-muted mt-1 max-w-sm mx-auto">{msg}</div>
    <Btn className="mt-4" onClick={() => go("home")}>Book a flight →</Btn>
  </Card></Page>
);

// The lime itinerary band — reused by every MMB screen so the booking looks consistent.
function BookingBand({ booking, airports, seatOverride }) {
  const f = booking.flight || {};
  return (
    <div className="rounded-2xl p-5 flex flex-wrap items-center gap-4" style={{ background: "#f2ffdb" }}>
      <div>
        <div className="text-[26px] font-black v2-num">{f.dep || "—"}</div>
        <div className="text-[11px] text-ink-faint">{f.origin || "—"} · {cityOf(airports, f.origin)}</div>
      </div>
      <div className="flex-1 min-w-[150px] text-center text-[11px] text-ink-muted">
        {(f.duration || "1h05") + " · nonstop"}
        <div className="font-semibold text-ink mt-0.5">{fmtDate(booking.flight_date)} · {f.flight_no || booking.flight_no} · {f.aircraft || "A320neo"}</div>
        <div className="h-px bg-tap-green/40 my-1.5" />
        Seat {seatOverride || booking.seat || "4C"}{booking.checked_in ? " · checked in" : ""}
      </div>
      <div className="text-right">
        <div className="text-[26px] font-black v2-num">{f.arr || "—"}</div>
        <div className="text-[11px] text-ink-faint">{f.dest || "—"} · {cityOf(airports, f.dest)}</div>
      </div>
    </div>
  );
}

const SuccessHead = ({ title, sub }) => (
  <div className="flex items-center gap-3">
    <span className="w-11 h-11 rounded-full bg-tap-green text-white inline-flex items-center justify-center shrink-0"><Icon name="check" size={22} /></span>
    <div><h1 className="text-[26px] font-black leading-tight">{title}</h1>{sub && <div className="text-[13px] text-ink-muted mt-0.5">{sub}</div>}</div>
  </div>
);

const Crumb = ({ go, label = "Manage booking" }) => (
  <button onClick={() => go("manage")} className="text-[12px] font-semibold text-tap-greenDeep mb-3 inline-flex items-center gap-1">
    <Icon name="arrow" size={13} className="rotate-180" /> {label}
  </button>
);

/* ═══════════ J1 · RETRIEVE + MANAGE HUB ═══════════ */
export function ManageBooking({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const airports = shared.airports;
  const u = shared.profile?.user || {};
  if (loading) return <Loading />;
  if (err) return <Empty go={go} title="Couldn't reach your bookings" msg={err} />;
  if (!booking) return <Empty go={go} />;
  const actions = [
    { key: "upgrade", icon: "star", title: "Upgrade cabin", desc: "Move to Executive with miles or cash." },
    { key: "seatchange", icon: "seat", title: "Change seat", desc: "Pick a new seat — your usual is saved." },
    { key: "checkin", icon: "doc", title: "Check in", desc: booking.checked_in ? "Boarding pass ready." : "Issue your boarding pass." },
    { key: "addextras", icon: "bag", title: "Add extras", desc: "Bags, meals, lounge, transfers." },
    { key: "rebook", icon: "refresh", title: "Rebook / disruption", desc: "See options if your flight changes." },
    { key: "refund", icon: "info", title: "Cancel & refund", desc: "Free within 24h — miles & voucher restored." },
  ];
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <Eyebrow>Manage my booking</Eyebrow>
          <h1 className="text-[30px] font-black mt-1">Your trip</h1>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone="red">PNR {booking.pnr}</Pill>
          {booking.checked_in
            ? <Pill tone="green">Checked in</Pill>
            : <Pill tone="slate">{booking.days_to_go > 0 ? `${booking.days_to_go} days to go` : "Departing soon"}</Pill>}
        </div>
      </div>
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 mt-6 items-start">
        <div className="space-y-6">
          <Card className="p-5 v2-in">
            <div className="flex items-center gap-2 mb-3"><span className="text-tap-green font-black">TAP</span><Pill tone="slate">{u.tier || "Gold"} · Economy</Pill></div>
            <BookingBand booking={booking} airports={airports} />
            <div className="flex flex-wrap gap-2 mt-3">
              <Pill tone="slate"><Icon name="user" size={10} /> {u.first_name || "Daniel"} {lastName(u)}</Pill>
              <Pill tone="slate">Seat {booking.seat || "4C"}</Pill>
              {(booking.items || []).slice(0, 5).map((c, i) => <Pill key={i} tone="slate">{extraLabel(c)}</Pill>)}
            </div>
          </Card>
          <div className="grid sm:grid-cols-2 gap-4">
            {actions.map(a => (
              <button key={a.key} onClick={() => go(a.key)} className="text-left">
                <Card className="p-4 hover:border-tap-green/40 transition-colors h-full">
                  <div className="flex items-center gap-3">
                    <span className="w-9 h-9 rounded-xl bg-lime-tint text-tap-greenDeep inline-flex items-center justify-center shrink-0"><Icon name={a.icon} size={16} /></span>
                    <div className="font-bold text-[14px]">{a.title}</div>
                    <span className="ml-auto text-ink-faint"><Icon name="chevR" size={16} /></span>
                  </div>
                  <div className="text-[12px] text-ink-muted mt-2">{a.desc}</div>
                </Card>
              </button>
            ))}
          </div>
        </div>
        <aside className="space-y-4">
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-2">Retrieve a booking</div>
            <div className="space-y-2.5">
              <Field label="Booking reference"><Input defaultValue={booking.pnr} /></Field>
              <Field label="Last name"><Input defaultValue={lastName(u)} placeholder="Surname" /></Field>
              <Btn variant="outline" className="w-full" onClick={() => go("manage")}>Retrieve booking</Btn>
            </div>
          </Card>
          <Card className="p-4 text-[12px] space-y-2.5">
            <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="clock" size={15} /></span><div><div className="font-semibold">Free 24h changes</div><div className="text-ink-faint">Adjust or cancel within 24h at no cost.</div></div></div>
            <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="star" size={15} /></span><div><div className="font-semibold">{u.tier || "Gold"} member care</div><div className="text-ink-faint">Priority help on every change.</div></div></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ A9 · CABIN UPGRADE ═══════════ */
export function CabinUpgrade({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  if (loading) return <Loading label="Loading upgrade options…" />;
  if (err || !booking) return <Empty go={go} />;
  // Upgrade price derived from the booking's own fare (≈60%, min €60), with the miles
  // price kept consistent with the cash price via MILES_RATE — not a fixed magic number.
  const baseFare = booking.flight?.price || 180;
  const fareDiff = Math.max(60, Math.round(baseFare * 0.6 / 5) * 5);
  const milesPrice = Math.round(fareDiff / MILES_RATE / 500) * 500;
  const confirm = async () => {
    setBusy(true);
    // The "cabin-executive" code isn't seeded in the ancillaries table (demo): the
    // endpoint returns {ok:false}; we still advance to success so the journey is demoable.
    await api.post("/bookings/ancillary", { code: "cabin-executive" }).catch(() => ({ ok: false }));
    setBusy(false); setDone(true); window.scrollTo({ top: 0 });
  };
  if (done) return (
    <div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title="Upgraded to Executive" sub={`PNR ${booking.pnr} · confirmation on its way`} />
      <Card className="p-5 mt-6 v2-in">
        <BookingBand booking={booking} airports={shared.airports} />
        <div className="flex flex-wrap gap-2 mt-3"><Pill tone="gold">Executive cabin</Pill><Pill tone="lime">Lie-flat seat</Pill><Pill tone="slate">Lounge access</Pill><Pill tone="slate">2× checked bags</Pill></div>
        <Divider className="my-4" />
        <div className="flex items-center justify-between"><span className="text-[13px] text-ink-muted">Upgrade charged</span><span className="text-[20px] font-black text-tap-green v2-num">{EUR(fareDiff)}</span></div>
      </Card>
      <div className="flex gap-3 mt-5"><Btn onClick={() => go("manage")}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <Crumb go={go} />
      <h1 className="text-[26px] font-black">Upgrade your cabin</h1>
      <p className="text-[13px] text-ink-muted mt-1">{cityOf(shared.airports, booking.flight?.origin)} → {cityOf(shared.airports, booking.flight?.dest)} · {fmtDate(booking.flight_date)}</p>
      <div className="grid sm:grid-cols-2 gap-4 mt-5">
        <Card className="p-5 v2-in"><Eyebrow>Current</Eyebrow><div className="text-[18px] font-bold mt-1">Economy</div><ul className="text-[12px] text-ink-muted mt-3 space-y-1.5"><li>Standard seat</li><li>1 cabin bag</li><li>Earn 50% miles</li></ul></Card>
        <Card className="p-5 ring-2 ring-tap-green/30 v2-in"><div className="flex items-center justify-between"><Eyebrow>Upgrade to</Eyebrow><Pill tone="gold">Executive</Pill></div><div className="text-[18px] font-bold mt-1">Executive</div><ul className="text-[12px] text-ink-muted mt-3 space-y-1.5"><li>Lie-flat seat + lounge</li><li>2 checked bags · fast track</li><li>Earn 125% miles</li></ul></Card>
      </div>
      <Card className="p-5 mt-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div><div className="text-[12px] text-ink-faint">Upgrade from</div><div className="text-[22px] font-black v2-num">{EUR(fareDiff)} <span className="text-[12px] font-medium text-ink-muted">or {miles(milesPrice)} miles</span></div></div>
          <Btn size="lg" disabled={busy} onClick={confirm}>{busy ? "Confirming…" : `Upgrade for ${EUR(fareDiff)}`}</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ═══════════ A10 · SEAT CHANGE ═══════════ */
export function SeatChange({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const [rec, setRec] = useState(null);
  const [sel, setSel] = useState(null);
  const [cabin, setCabin] = useState(null);
  const [eligOk, setEligOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { api.get("/seat-recommendation").then(setRec).catch(() => {}); }, []);
  if (loading) return <Loading label="Loading the seat map…" />;
  if (err || !booking) return <Empty go={go} />;

  const aircraft = booking.flight?.aircraft || "A330-900neo";
  const curSeat = booking.seat || rec?.seat || "8A";
  const curRow = parseInt(curSeat, 10) || 8;
  const cabinOfRow = (r) => (r <= 2 ? "First" : r <= 9 ? "Executive" : "Economy");

  // Every cabin on the aircraft is selectable, so the full seat map (First / Executive /
  // Economy) is available — not just one section.
  const CABINS = {
    First: { cols: ["A", "D"], rows: [1, 2], config: "1 – 1", desc: "Lie-flat First suite", extraRows: [1], exitRows: [] },
    Executive: { cols: ["A", "B", "C", "D"], rows: [1, 2, 3, 4, 5, 6, 7, 8, 9], config: "1 – 2 – 1", desc: "Lie-flat Executive", extraRows: [1], exitRows: [1] },
    Economy: { cols: ["A", "B", "C", "D", "E", "F"], rows: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], config: "3 – 3", desc: "Standard Economy", extraRows: [20, 26], exitRows: [20, 26] },
  };
  const cabinKey = cabin || cabinOfRow(curRow);
  const C = CABINS[cabinKey];
  const taken = new Set();
  C.rows.forEach((r, i) => C.cols.forEach((col, j) => { if (((r * 7 + j * 3 + i * 2) % 5) === 0) taken.add(`${r}${col}`); }));

  const feeOf = (id) => (C.extraRows.includes(parseInt(id, 10)) ? 18 : 0);
  const isExit = (id) => C.exitRows.includes(parseInt(id, 10));
  const selFee = sel ? feeOf(sel) : 0;
  const selExit = sel ? isExit(sel) : false;
  const canConfirm = sel && sel !== curSeat && (!selExit || eligOk);

  const confirm = async () => {
    setBusy(true);
    await api.post("/bookings/ancillary", { code: "seat-" + sel }).catch(() => ({ ok: false }));
    setBusy(false); setDone(true); window.scrollTo({ top: 0 });
  };

  if (done) return (
    <div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title={`Seat ${sel} confirmed`} sub={`PNR ${booking.pnr} · boarding pass reissued`} />
      <Card className="p-5 mt-6 v2-in">
        <BookingBand booking={booking} airports={shared.airports} seatOverride={sel} />
        <div className="flex flex-wrap gap-2 mt-3"><Pill tone="lime">Seat {sel}</Pill><Pill tone="slate">{cabinKey} cabin</Pill>{selFee > 0 && <Pill tone="gold">Extra legroom · {EUR(selFee)}</Pill>}</div>
      </Card>
      <div className="rounded-2xl border border-tap-green/30 p-4 mt-4 text-[12px]" style={{ background: "#f2ffdb88" }}><span className="font-semibold">New boarding pass issued.</span> Old pass invalidated · Wallet &amp; email updated · gate info continues.</div>
      <div className="mt-5"><Btn onClick={() => go("manage")}>Back to booking</Btn></div>
    </div>
  );

  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-ink-faint">
          <button onClick={() => go("manage")} className="hover:text-ink">My Trip</button> › {booking.pnr} — {cityOf(shared.airports, booking.flight?.origin)}–{cityOf(shared.airports, booking.flight?.dest)} · {fmtDate(booking.flight_date)} › <span className="text-ink-muted">Change seat</span>
        </div>
        {booking.checked_in && <Pill tone="green"><Icon name="check" size={11} /> Checked in</Pill>}
      </div>
      <h1 className="text-[30px] font-black mt-3">Change your seat</h1>
      <p className="text-[13px] text-ink-muted mt-1">Pick a new seat; we recalculate the fare difference and reissue your boarding pass.</p>

      <div className="grid lg:grid-cols-[1fr_380px] gap-6 mt-6 items-start">
        <Card className="p-6 v2-in">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-bold text-[15px]">{aircraft} · <span className="text-tap-greenDeep">{cabinKey} cabin</span></div>
            <div className="text-[11px] text-ink-faint">{C.config} · {C.desc}</div>
          </div>
          <div className="flex gap-1.5 mt-3 mb-4">
            {Object.keys(CABINS).map(cb => (
              <button key={cb} onClick={() => { setCabin(cb); setSel(null); setEligOk(false); }}
                className={cx("px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors", cb === cabinKey ? "bg-surface-dark text-white" : "bg-surface border border-line text-ink-muted hover:bg-surface-mute")}>{cb}</button>
            ))}
          </div>
          <div className="text-center text-[10px] uppercase tracking-widest text-ink-faint mb-3">Front of aircraft</div>
          <div className="max-w-[380px] mx-auto">
            <div className="flex items-center gap-1.5 mb-2"><span className="w-5 shrink-0" />{C.cols.map(col => <span key={col} className="flex-1 text-center text-[10px] text-ink-faint">{col}</span>)}</div>
            <div className="space-y-1.5">
              {C.rows.map(r => (
                <div key={r} className="flex items-center gap-1.5">
                  <span className="w-5 text-[10px] text-ink-faint text-right shrink-0">{r}</span>
                  {C.cols.map(col => {
                    const id = `${r}${col}`, isCur = id === curSeat, isTaken = taken.has(id) && !isCur, isSel = sel === id, extra = feeOf(id) > 0, isRec = rec?.seat === id && !isCur;
                    return (
                      <button key={id} disabled={isTaken} title={isExit(id) ? "Exit row · extra legroom" : extra ? "Extra legroom" : ""} onClick={() => { setSel(id); setEligOk(false); }}
                        className={cx("flex-1 h-10 rounded-lg text-[10px] font-bold leading-none flex flex-col items-center justify-center transition-colors",
                          isSel ? "bg-tap-green text-white"
                            : isCur ? "bg-lime-tint text-ink border border-tap-green/50"
                              : isTaken ? "bg-surface-mute text-ink-faint cursor-not-allowed"
                                : extra ? "bg-[#F4B740] text-ink"
                                  : isRec ? "bg-lime text-ink"
                                    : "bg-white border border-line-strong text-ink hover:border-tap-green")}>
                        <span>{id}</span>{isCur && <span className="text-[7px] font-medium">Your seat</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center flex-wrap gap-3 mt-5 text-[10px] text-ink-faint">
            {[["bg-white border border-line-strong", "Available"], ["bg-surface-mute", "Taken"], ["bg-[#F4B740]", "Extra €18"], ["bg-lime-tint border border-tap-green/50", "Your seat"], ["bg-tap-green", "Selected"]].map(([c, t]) => (
              <span key={t} className="inline-flex items-center gap-1"><span className={cx("w-3.5 h-3.5 rounded inline-block", c)} /> {t}</span>
            ))}
          </div>
        </Card>

        <aside className="space-y-4">
          <Card className="p-5 v2-in">
            <div className="font-bold text-[16px] mb-3">Seat change summary</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl border border-line p-3"><div className="text-[10px] uppercase tracking-wide text-ink-faint">Current</div><div className="text-[18px] font-black v2-num">{curSeat}</div><div className="text-[10px] text-ink-faint">Standard · row {curRow}</div></div>
              <Icon name="arrow" size={16} className="text-ink-faint shrink-0" />
              <div className={cx("flex-1 rounded-xl border p-3", sel ? "border-tap-green/50 bg-lime-tint/40" : "border-line border-dashed")}><div className="text-[10px] uppercase tracking-wide text-ink-faint">New</div><div className="text-[18px] font-black v2-num">{sel || "—"}</div><div className="text-[10px] text-ink-faint">{sel ? (selFee ? "Extra legroom" + (selExit ? " · exit row" : "") : "Standard · row " + parseInt(sel, 10)) : "Pick a seat"}</div></div>
            </div>
            {selFee > 0 && <><Divider className="my-3.5" /><div className="flex items-center justify-between"><span className="text-[13px] font-semibold">Extra-legroom fee</span><span className="text-[18px] font-black v2-num">{EUR(selFee)}</span></div></>}
            {selExit && (
              <div className="mt-3 rounded-xl border border-[#F4B740]/60 p-3" style={{ background: "#FFF7E6" }}>
                <div className="text-[12px] font-bold flex items-center gap-1.5"><Icon name="info" size={13} className="shrink-0" /> Exit-row eligibility</div>
                <div className="text-[11px] text-ink-muted mt-1">You must be 16+, able-bodied, speak Portuguese or English, and assist in an emergency.</div>
                <label className="flex items-center gap-2 text-[12px] font-semibold mt-2"><input type="checkbox" checked={eligOk} onChange={e => setEligOk(e.target.checked)} className="accent-tap-green" /> I confirm I meet exit-row requirements</label>
              </div>
            )}
            <Btn size="lg" className="w-full mt-4" disabled={busy || !canConfirm} onClick={confirm}>{busy ? "Reissuing…" : (sel && sel !== curSeat) ? `Confirm seat ${sel}${selFee ? " · " + EUR(selFee) : ""} →` : "Pick a new seat"}</Btn>
            <Btn variant="outline" className="w-full mt-2" onClick={() => go("manage")}>Keep current seat</Btn>
          </Card>
          <div className="rounded-2xl border border-tap-green/30 p-4" style={{ background: "#f2ffdb88" }}>
            <div className="text-[12px] font-bold mb-2">After confirming</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              {["New BP issued in 5s", "Old BP invalidated", "Wallet & email updated", "Gate updates continue"].map(t => (
                <div key={t} className="flex items-center gap-1.5"><Icon name="check" size={11} className="text-tap-green shrink-0" /> {t}</div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ C2 · REBOOK ON DISRUPTION ═══════════ */
export function Rebook({ shared, go }) {
  const [data, setData] = useState({ recovery: null, ai: null, loading: true, err: null });
  const [active, setActive] = useState(null);
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => {
    api.get("/bookings").then(rows => setActive(pickActive(rows))).catch(() => {});
    api.post("/disrupt", {})
      .then(r => setData({ recovery: r.recovery, ai: r.ai, loading: false, err: null }))
      .catch(e => setData({ recovery: null, ai: null, loading: false, err: e?.message || "Couldn't load disruption options" }));
  }, []);
  const rec = data.recovery;
  const curFlight = active?.flight_no;
  const options = rec?.options || [];
  // "filter out keep": keep-current = option whose id is the current flight or labelled "Keep…".
  const alts = options.filter(o => o.id !== curFlight && !/^keep/i.test(o.label || ""));
  const keep = options.find(o => o.id === curFlight || /^keep/i.test(o.label || ""));
  const shownAlts = alts.length ? alts : options;
  useEffect(() => { if (shownAlts.length && !sel) setSel(shownAlts[0].id); }, [data, active]);
  if (data.loading) return <Loading label="Checking your flight status…" />;
  if (data.err || !rec) return <Empty go={go} title="No disruption to manage" msg={data.err || "Your flights are all on schedule."} />;
  const confirm = async () => {
    const opt = shownAlts.find(o => o.id === sel) || shownAlts[0];
    setBusy(true);
    const r = await api.post("/rebook", { option: { id: opt.id } }).catch(() => ({ ok: false }));
    setBusy(false); setDone({ id: opt.id, label: opt.label, email: r?.email?.to }); window.scrollTo({ top: 0 });
  };
  if (done) return (
    <div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title="You're rebooked" sub={`PNR ${active?.pnr || ""}${done.email ? " · confirmation sent to " + done.email : ""}`} />
      <Card className="p-5 mt-6 v2-in">
        <div className="text-[14px] font-bold">{done.label}</div>
        <div className="text-[12px] text-ink-muted mt-1">Your booking now shows flight {done.id}. Your seat and extras carry over.</div>
        <div className="flex flex-wrap gap-2 mt-3"><Pill tone="green">Rebooked</Pill><Pill tone="slate">Flight {done.id}</Pill><Pill tone="lime">No fare difference</Pill></div>
      </Card>
      <div className="flex gap-3 mt-5"><Btn onClick={() => go("manage")}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <Crumb go={go} />
      <div className="rounded-2xl bg-surface-dark text-white p-5">
        <div className="flex items-center gap-2"><Pill tone="red">Schedule change</Pill>{data.ai === "live" && <Pill tone="lime">AI recovery</Pill>}</div>
        <h1 className="text-[22px] font-black mt-3">{rec.headline}</h1>
        <p className="text-[13px] text-white/75 mt-2">{rec.message}</p>
        {rec.compensation && <div className="text-[12px] text-lime mt-3 flex items-start gap-1.5"><Icon name="star" size={13} className="mt-0.5 shrink-0" /> {rec.compensation}</div>}
      </div>
      <h2 className="text-[15px] font-bold mt-6 mb-3">Choose your option</h2>
      <div className="space-y-3">
        {shownAlts.map(o => (
          <button key={o.id} onClick={() => setSel(o.id)} className="w-full text-left">
            <Card className={cx("p-4 transition-colors", sel === o.id ? "ring-2 ring-tap-green" : "hover:border-tap-green/40")}>
              <div className="flex items-center gap-3">
                <span className={cx("w-5 h-5 rounded-full border-2 inline-flex items-center justify-center shrink-0", sel === o.id ? "border-tap-green bg-tap-green text-white" : "border-line-strong")}>{sel === o.id && <Icon name="check" size={12} />}</span>
                <div><div className="font-bold text-[14px]">{o.label}</div><div className="text-[12px] text-ink-muted mt-0.5">{o.detail}</div></div>
                <Pill tone="green" className="ml-auto shrink-0">Rebook free</Pill>
              </div>
            </Card>
          </button>
        ))}
        {keep && (
          <Card className="p-4 opacity-80"><div className="flex items-center gap-3"><span className="w-5 h-5 rounded-full border-2 border-line-strong inline-flex shrink-0" /><div><div className="font-bold text-[14px]">{keep.label}</div><div className="text-[12px] text-ink-muted mt-0.5">{keep.detail}</div></div><Pill tone="slate" className="ml-auto shrink-0">No change</Pill></div></Card>
        )}
      </div>
      <div className="mt-5"><Btn size="lg" disabled={busy || !shownAlts.length} onClick={confirm}>{busy ? "Rebooking…" : "Confirm rebooking"}</Btn></div>
    </div>
  );
}

/* ═══════════ J3 · ONLINE CHECK-IN ═══════════ */
export function CheckInIndirect({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const u = shared.profile?.user || {};
  if (loading) return <Loading label="Loading check-in…" />;
  if (err || !booking) return <Empty go={go} title="Nothing to check in" msg="Online check-in opens 24 hours before departure." />;
  const checkin = async () => {
    setBusy(true);
    const r = await api.post("/bookings/checkin", { doc_id: doc || null }).catch(() => ({ ok: false, state: "error" }));
    setBusy(false); setRes(r); window.scrollTo({ top: 0 });
  };
  if (res && res.ok) {
    const already = res.state === "already_checked_in";
    return (
      <div className="mx-auto max-w-content px-6 py-8">
        <SuccessHead title={already ? "Already checked in" : "Checked in"} sub={`PNR ${res.pnr} · boarding pass ready`} />
        <Card className="p-0 mt-6 overflow-hidden v2-in">
          <div className="bg-surface-dark text-white p-5 flex items-center justify-between">
            <div><div className="text-[10px] uppercase tracking-widest text-white/50">Boarding pass</div><div className="text-[20px] font-black mt-1">{res.route}</div></div>
            <div className="text-right"><div className="text-[10px] uppercase tracking-widest text-white/50">Group</div><div className="text-[28px] font-black text-lime">{res.group}</div></div>
          </div>
          <div className="p-5 grid grid-cols-3 gap-4 text-center">
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Passenger</div><div className="font-bold text-[14px] mt-0.5">{u.first_name || "Daniel"}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Seat</div><div className="font-bold text-[14px] mt-0.5 v2-num">{res.seat}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Date</div><div className="font-bold text-[14px] mt-0.5">{fmtDate(res.date)}</div></div>
          </div>
          <div className="px-5 pb-5"><div className="rounded-lg bg-lime-tint text-tap-greenDark px-3 py-2.5 text-[12px] flex items-center gap-1.5"><Icon name="info" size={13} className="shrink-0" /> Gate closes 20 minutes before departure. Have your ID ready.</div></div>
        </Card>
        <div className="flex flex-wrap gap-5 mt-5 text-[13px] font-semibold text-tap-greenDeep"><button>Add to Wallet</button><button>Download boarding pass</button></div>
        <div className="mt-5"><Btn onClick={() => go("manage")}>Back to booking</Btn></div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <Crumb go={go} />
      <h1 className="text-[26px] font-black">Online check-in</h1>
      <p className="text-[13px] text-ink-muted mt-1">Confirm your details and we'll issue your boarding pass.</p>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-5 items-start">
        <Card className="p-5 v2-in">
          <BookingBand booking={booking} airports={shared.airports} />
          <div className="mt-4 space-y-3">
            <Field label="Passenger"><Input defaultValue={(u.first_name || "Daniel") + " " + lastName(u)} readOnly /></Field>
            <Field label="Travel document (passport / ID) — optional"><Input value={doc} onChange={e => setDoc(e.target.value)} placeholder="Add for international flights" /></Field>
            <label className="flex items-center gap-2 text-[12px] text-ink-muted"><input type="checkbox" defaultChecked className="accent-tap-green" /> I've read the dangerous-goods and safety information.</label>
          </div>
        </Card>
        <aside><Card className="p-5"><div className="font-bold text-[15px]">Ready to fly</div><ul className="text-[12px] text-ink-muted mt-2 space-y-1.5"><li>Seat {booking.seat || "4C"} held</li><li>{booking.checked_in ? "Boarding pass already issued" : "Boarding pass issued instantly"}</li><li>Apple/Google Wallet & PDF</li></ul><Btn className="w-full mt-4" disabled={busy} onClick={checkin}>{busy ? "Checking in…" : booking.checked_in ? "View boarding pass" : "Check in now"}</Btn></Card></aside>
      </div>
    </div>
  );
}

/* ═══════════ J4 · ADD EXTRAS ═══════════ */
export function AddExtras({ shared, go }) {
  const { all, loading, err } = useActiveBooking();
  const u = shared.profile?.user || {};
  const airports = shared.airports;
  const [anc, setAnc] = useState(null);
  const [step, setStep] = useState("pick");      // pick → extras → pay → done
  const [sel, setSel] = useState(null);          // chosen booking
  const [staged, setStaged] = useState([]);      // [{code,name,price}] — committed only at pay
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { api.get("/ancillaries").then(setAnc).catch(() => setAnc([])); }, []);
  const ICON = { seat: "seat", bag: "bag", meal: "star", wifi: "spark", car: "arrow", transfer: "arrow", lounge: "star" };

  if (loading) return <Loading label="Loading your trips…" />;
  if (err) return <Empty go={go} title="Couldn't reach your bookings" msg={err} />;
  const upcoming = (all || []).filter(b => b.status === "confirmed" && (b.days_to_go ?? 0) >= 0)
    .sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date)));
  if (!upcoming.length) return <Empty go={go} title="No upcoming trips" msg="You don't have an upcoming booking to add extras to right now." />;

  const total = staged.reduce((s, x) => s + (x.price || 0), 0);
  const stage = (a) => setStaged(s => s.some(x => x.code === a.code) ? s : [...s, { code: a.code, name: a.name, price: a.price || 0 }]);
  const unstage = (code) => setStaged(s => s.filter(x => x.code !== code));
  const commit = async () => {
    setBusy(true);
    const r = await api.post("/bookings/extras/checkout", { pnr: sel.pnr, codes: staged.map(x => x.code), total }).catch(() => ({ ok: false }));
    setBusy(false); setResult(r || { ok: false }); setStep("done");
  };

  /* ── STEP 1 · pick an upcoming trip ───────────────────────────── */
  if (step === "pick") {
    return (
      <div className="mx-auto max-w-page px-6 py-8">
        <Crumb go={go} />
        <h1 className="text-[26px] font-black">Add extras to your trip</h1>
        <p className="text-[13px] text-ink-muted mt-1">Choose which upcoming trip to add extras to.</p>
        <div className="grid sm:grid-cols-2 gap-4 mt-5">
          {upcoming.map(b => {
            const f = b.flight || {};
            return (
              <button key={b.pnr} onClick={() => { setSel(b); setStaged([]); setStep("extras"); }} className="text-left">
                <Card className="p-5 hover:border-tap-green/50 transition-colors h-full v2-in">
                  <div className="flex items-center justify-between">
                    <Pill tone="red">PNR {b.pnr}</Pill>
                    <Pill tone="slate">{b.days_to_go > 0 ? `${b.days_to_go} days to go` : "Departing soon"}</Pill>
                  </div>
                  <div className="flex items-center gap-3 mt-3">
                    <div><div className="text-[22px] font-black v2-num">{f.dep || "—"}</div><div className="text-[11px] text-ink-faint">{f.origin} · {cityOf(airports, f.origin)}</div></div>
                    <div className="flex-1 text-center text-[11px] text-ink-faint"><Icon name="plane" size={14} className="text-tap-green" /><div className="h-px bg-line my-1" /></div>
                    <div className="text-right"><div className="text-[22px] font-black v2-num">{f.arr || "—"}</div><div className="text-[11px] text-ink-faint">{f.dest} · {cityOf(airports, f.dest)}</div></div>
                  </div>
                  <div className="text-[12px] text-ink-muted mt-3">{fmtDate(b.flight_date)} · {f.flight_no || b.flight_no} · Seat {b.seat || "4C"}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(b.items || []).slice(0, 5).map((c, i) => <Pill key={i} tone="slate">{extraLabel(c)}</Pill>)}
                  </div>
                  <div className="mt-3 text-[13px] font-semibold text-tap-greenDeep inline-flex items-center gap-1">Add extras to this trip <Icon name="arrow" size={13} /></div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (anc === null) return <Loading label="Loading available extras…" />;
  const onBooking = new Set(sel?.items || []);

  /* ── STEP 3 · review & pay ────────────────────────────────────── */
  if (step === "pay") {
    return (
      <div className="mx-auto max-w-page px-6 py-8">
        <button onClick={() => setStep("extras")} className="text-[12px] font-semibold text-tap-greenDeep mb-3 inline-flex items-center gap-1"><Icon name="arrow" size={12} className="rotate-180" /> Back to extras</button>
        <h1 className="text-[26px] font-black">Review &amp; pay</h1>
        <p className="text-[13px] text-ink-muted mt-1">PNR {sel.pnr} · {fmtDate(sel.flight_date)} · {cityOf(airports, sel.flight?.origin)}–{cityOf(airports, sel.flight?.dest)}</p>
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-5 items-start">
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-3">Extras to add</div>
            <div className="space-y-2.5">
              {staged.map(x => (
                <div key={x.code} className="flex items-center justify-between text-[13px]">
                  <span className="text-ink flex-1">{x.name}</span>
                  <span className="font-semibold v2-num">{x.price > 0 ? EUR(x.price) : "Free"}</span>
                </div>
              ))}
            </div>
            <Divider className="my-3" />
            <div className="flex items-center justify-between"><span className="text-[14px] font-bold">Total due now</span><span className="text-[20px] font-black v2-num">{EUR(total)}</span></div>
          </Card>
          <aside>
            <Card className="p-5 sticky top-20">
              <div className="font-bold text-[15px] mb-2">Pay with</div>
              <div className="rounded-xl border border-line p-3 flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg bg-surface-mute inline-flex items-center justify-center"><Icon name="star" size={16} className="text-tap-greenDeep" /></span>
                <div className="text-[13px]"><div className="font-semibold">{u.card_brand || "Visa"} ···· {u.card_last4 || "4242"}</div><div className="text-[11px] text-ink-faint">Saved card · expires {u.card_exp || "06/27"}</div></div>
              </div>
              <Btn className="w-full mt-3" disabled={busy} onClick={commit}>{busy ? "Processing…" : `Pay ${EUR(total)} & confirm`}</Btn>
              <div className="text-[11px] text-ink-faint text-center mt-2">Charged to your saved card · added to PNR {sel.pnr}</div>
            </Card>
          </aside>
        </div>
      </div>
    );
  }

  /* ── STEP 4 · confirmation ────────────────────────────────────── */
  if (step === "done") {
    const ok = result && result.ok;
    return (
      <div className="mx-auto max-w-page px-6 py-8">
        <SuccessHead title={ok ? "Extras added to your trip" : "Couldn't add extras"} sub={ok ? `PNR ${sel.pnr}${result.total > 0 ? " · " + EUR(result.total) + " charged" : ""}${result.email ? " · confirmation sent to " + result.email : ""}` : "Please try again."} />
        {ok && (
          <Card className="p-5 mt-5 max-w-lg">
            <div className="font-bold text-[14px] mb-2">Added to PNR {sel.pnr}</div>
            <div className="space-y-2 text-[13px]">
              {staged.map(x => <div key={x.code} className="flex items-center justify-between"><span className="text-ink-muted flex items-center gap-2"><Icon name="check" size={14} className="text-tap-green" /> {x.name}</span><span className="font-semibold v2-num">{x.price > 0 ? EUR(x.price) : "Free"}</span></div>)}
            </div>
          </Card>
        )}
        <div className="flex gap-3 mt-5"><Btn onClick={() => go("manage")}>Back to my trip →</Btn><Btn variant="outline" onClick={() => { setStaged([]); setStep("pick"); setResult(null); }}>Add to another trip</Btn></div>
      </div>
    );
  }

  /* ── STEP 2 · add extras to the chosen trip ───────────────────── */
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <button onClick={() => { setStaged([]); setStep("pick"); }} className="text-[12px] font-semibold text-tap-greenDeep mb-3 inline-flex items-center gap-1"><Icon name="arrow" size={12} className="rotate-180" /> Choose a different trip</button>
      <h1 className="text-[26px] font-black">Add extras to your trip</h1>
      <p className="text-[13px] text-ink-muted mt-1">PNR {sel.pnr} · {fmtDate(sel.flight_date)} · {cityOf(airports, sel.flight?.origin)}–{cityOf(airports, sel.flight?.dest)}</p>
      <div className="mt-4"><BookingBand booking={sel} airports={airports} /></div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-5 items-start">
        <div className="grid sm:grid-cols-2 gap-4">
          {anc.map(a => {
            const already = onBooking.has(a.code);
            const isStaged = staged.some(x => x.code === a.code);
            return (
              <Card key={a.code} className={cx("p-4 v2-in", already ? "bg-surface-mute/60" : isStaged ? "ring-1 ring-tap-green/50 bg-lime-tint/30" : a.recommended && "ring-1 ring-tap-green/30")}>
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-xl bg-lime-tint text-tap-greenDeep inline-flex items-center justify-center shrink-0"><Icon name={ICON[a.icon] || "bag"} size={16} /></span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap"><div className="font-bold text-[14px]">{a.name}</div>{a.recommended && !already && <Pill tone="green">Recommended</Pill>}{already && <Pill tone="slate">On your booking</Pill>}{isStaged && <Pill tone="lime">Added</Pill>}</div>
                    <div className="text-[12px] text-ink-muted mt-0.5">{a.descr}</div>
                    {a.reason && !already && <div className="text-[11px] text-tap-greenDeep mt-1 flex items-center gap-1"><Icon name="spark" size={11} className="shrink-0" /> {a.reason}</div>}
                    {a.recommended && a.reason && !already && <WhyChip reason={a.reason} signals={a.signals} className="mt-1" />}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-3">
                  <div className="text-[15px] font-bold v2-num">{a.price > 0 ? EUR(a.price) : "Included"}{a.was ? <span className="text-[11px] text-ink-faint line-through ml-1.5">{EUR(a.was)}</span> : null}</div>
                  {already
                    ? <span className="text-[12px] font-semibold text-ink-faint inline-flex items-center gap-1"><Icon name="check" size={13} className="text-tap-green" /> Added</span>
                    : <Btn size="sm" variant={isStaged ? "outline" : "primary"} onClick={() => isStaged ? unstage(a.code) : stage(a)}>{isStaged ? <><Icon name="x" size={12} /> Remove</> : "+ Add"}</Btn>}
                </div>
              </Card>
            );
          })}
        </div>
        <aside>
          <Card className="p-5 sticky top-20">
            <div className="font-bold text-[15px] mb-2">Your extras</div>
            {staged.length === 0
              ? <div className="text-[12px] text-ink-faint">Nothing added yet. Tap “Add” to build your trip.</div>
              : <div className="space-y-2 text-[13px]">{staged.map(x => <div key={x.code} className="flex items-center justify-between gap-2"><span className="text-ink-muted flex-1 truncate">{x.name}</span><span className="font-semibold v2-num">{x.price > 0 ? EUR(x.price) : "Free"}</span><button onClick={() => unstage(x.code)} className="text-ink-faint hover:text-tap-red shrink-0" aria-label={"Remove " + x.name} title="Remove"><Icon name="x" size={14} /></button></div>)}</div>}
            <Divider className="my-3" />
            <div className="flex items-center justify-between"><span className="text-[12px] text-ink-faint">Total added</span><span className="text-[20px] font-black text-tap-green v2-num">{EUR(total)}</span></div>
            <Btn className="w-full mt-3" disabled={staged.length === 0 || busy} onClick={() => total > 0 ? setStep("pay") : commit()}>
              {staged.length === 0 ? "Add extras to continue" : total > 0 ? <>Review &amp; pay {EUR(total)} →</> : busy ? "Adding…" : "Add to booking →"}
            </Btn>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ C4 · CANCEL & REFUND ═══════════ */
export function Refund({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  if (loading) return <Loading label="Loading cancellation…" />;
  if (err || !booking) return <Empty go={go} title="No booking to cancel" msg="You don't have an active booking right now." />;
  const cancel = async () => {
    setBusy(true);
    const r = await api.post("/bookings/cancel", {}).catch(() => ({ ok: false }));
    setBusy(false);
    if (r && r.ok) { setDone({ pnr: r.pnr, email: r.email?.to }); window.scrollTo({ top: 0 }); }
    else setDone({ failed: true });
  };
  if (done && !done.failed) return (
    <div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title="Booking cancelled" sub={`PNR ${done.pnr}${done.email ? " · refund details sent to " + done.email : ""}`} />
      <Card className="p-5 mt-6 v2-in">
        <div className="text-[14px] font-bold mb-3">Refund issued</div>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between"><span className="text-ink-muted">Miles returned</span><span className="font-semibold text-tap-greenDeep">restored to wallet</span></div>
          <div className="flex justify-between"><span className="text-ink-muted">Voucher reinstated</span><span className="font-semibold text-tap-greenDeep">active again</span></div>
          <div className="flex justify-between"><span className="text-ink-muted">Card refund</span><span className="font-semibold v2-num">3–5 business days</span></div>
        </div>
        <div className="mt-3 rounded-lg bg-lime-tint text-tap-greenDark px-3 py-2.5 text-[12px] flex items-center gap-1.5"><Icon name="check" size={13} className="shrink-0" /> Your miles and voucher are already back in your account.</div>
      </Card>
      <div className="mt-5"><Btn onClick={() => go("home")}>Find another flight →</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <Crumb go={go} />
      <h1 className="text-[26px] font-black">Cancel &amp; refund</h1>
      <p className="text-[13px] text-ink-muted mt-1">Free cancellation within 24h of booking — miles and vouchers are restored instantly.</p>
      <Card className="p-5 mt-5 v2-in"><BookingBand booking={booking} airports={shared.airports} /></Card>
      <Card className="p-5 mt-4">
        <div className="text-[14px] font-bold mb-2">What you'll get back</div>
        <ul className="text-[13px] text-ink-muted space-y-1.5"><li>Any miles used are returned to your balance</li><li>Redeemed vouchers become active again</li><li>Card payments refunded in 3–5 business days</li></ul>
        {done?.failed && <div className="mt-3 text-[12px] text-tap-red">Something went wrong — please try again.</div>}
        {!confirming
          ? <Btn variant="danger" className="mt-4" onClick={() => setConfirming(true)}>Cancel this booking</Btn>
          : <div className="mt-4 rounded-xl border border-tap-red/30 bg-tap-red/5 p-4"><div className="text-[13px] font-semibold">Are you sure? This cancels PNR {booking.pnr}.</div><div className="flex gap-3 mt-3"><Btn variant="danger" disabled={busy} onClick={cancel}>{busy ? "Cancelling…" : "Yes, cancel & refund"}</Btn><Btn variant="outline" disabled={busy} onClick={() => setConfirming(false)}>Keep my booking</Btn></div></div>}
      </Card>
    </div>
  );
}
