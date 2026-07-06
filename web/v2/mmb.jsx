// FlyTAP v2 — Manage My Booking (MMB). Seven flows wired to the live (unchanged)
// backend: Retrieve/hub (J1), Cabin upgrade (A9), Seat change (A10), Rebook on
// disruption (C2), Online check-in (J3), Add extras (J4), Cancel & refund (C4).
// Each screen reads the same "current booking" the server acts on (mirror of the
// server's currentBooking()), so the card you see is the booking the action mutates.
import React, { useState, useEffect, useMemo } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE, downloadFile, buildICS, money, t } from "./lib.js";
import { trip } from "./trip.js";
import { Btn, Card, Pill, Eyebrow, Field, Input, Icon, Divider, Img, imageFor, WhyChip, cx } from "./ui.jsx";
import { Page } from "./shell.jsx";

/* ── shared helpers ───────────────────────────────────────────── */
// Mirror server currentBooking(): the just-completed PNR this session wins, else nearest upcoming
// confirmed booking, else latest confirmed. Preferring trip.pnr keeps My Trip on the flight the
// user actually just booked rather than a nearer seeded booking (#15).
function pickActive(list, preferPnr) {
  const confirmed = (list || []).filter(b => b.status === "confirmed");
  if (preferPnr) { const just = confirmed.find(b => b.pnr === preferPnr); if (just) return just; }
  const upcoming = confirmed
    .filter(b => (b.days_to_go ?? 0) >= 0)
    .sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date)));
  if (upcoming[0]) return upcoming[0];
  const latest = [...confirmed].sort((a, b) => String(b.flight_date).localeCompare(String(a.flight_date)));
  return latest[0] || null;   // #10 — if only cancelled bookings remain, surface nothing (don't resurface a cancelled one)
}

function useActiveBooking() {
  const [state, setState] = useState({ booking: null, all: [], loading: true, err: null });
  useEffect(() => {
    let alive = true;
    const load = () => api.get("/bookings")
      .then(rows => { if (alive) setState({ booking: pickActive(rows, trip.pnr), all: rows || [], loading: false, err: null }); })
      .catch(e => { if (alive) setState(s => ({ ...s, loading: false, err: e?.message || "Couldn't load your bookings" })); });
    load();
    // #36/#38 — re-pull the booking when a seat/cabin/extras change is committed elsewhere, or when the
    // window regains focus, so My Trip, check-in and the boarding pass always show the latest record.
    const onChange = () => load();
    window.addEventListener("tap:booking-changed", onChange);
    window.addEventListener("focus", onChange);
    return () => { alive = false; window.removeEventListener("tap:booking-changed", onChange); window.removeEventListener("focus", onChange); };
  }, []);
  return state;
}
// Fired after any booking mutation (seat change, cabin upgrade, extras purchase) so open views refresh.
const notifyBookingChanged = () => { try { window.dispatchEvent(new Event("tap:booking-changed")); } catch { /* noop */ } };

const cityOf = (airports, code) => (airports || []).find(a => a.code === code)?.city || code || "—";
const eur2 = (n) => money(n, { dp: 2 });
const lastName = (u) => u.last_name || (u.full_name ? u.full_name.split(" ").slice(-1)[0] : "");
// Friendly labels for the seeded extra codes stored on a booking's items_json.
const EXTRA_LABEL = { seat: "Seat", bag: "Checked bag", meal: "Meal", wifi: "Wi-Fi", transfer: "Transfer", car: "Transfer", lounge: "Lounge", upgrade: "Cabin upgrade", carbon: "Carbon offset", "checked-bag": "Checked bag", "bag-extra": "Extra checked bag", insurance: "Insurance", "ins-plus": "Insurance", priority: "Priority boarding", "xsell-sintra": "Sintra day trip", "xsell-douro": "Douro wine tour", "xsell-xfer-return": "Return transfer", "xsell-late-checkout": "Late checkout" };
const extraLabel = (c) => EXTRA_LABEL[c] || String(c).replace(/^(xsell|cabin)-/i, "").replace(/-/g, " ").replace(/\b\w/g, m => m.toUpperCase());

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
        Seat {seatOverride || booking.seat || "—"}{booking.checked_in ? " · checked in" : ""}
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

// #2 — derive an adjacent seat per traveller from the booking's assigned seat, so
// multi-passenger bookings show a seat for every traveller (grouped by passenger).
function seatForPax(base, i) {
  const m = String(base || "14F").match(/^(\d+)\s*([A-F])$/i);
  if (!m) return base || "—";
  const row = +m[1], cols = "ABCDEF", col = cols.indexOf(m[2].toUpperCase());
  const nc = ((col - i) % 6 + 6) % 6;                 // step left through the row, wrapping
  const rowAdj = row + Math.floor((i - col) / 6 > 0 ? Math.floor((i - col) / 6) : 0);
  return `${col - i >= 0 ? row : rowAdj}${cols[nc]}`;
}
const Crumb = ({ go, label = "Manage booking", trail }) => {
  if (trail && trail.length) return (
    <nav className="flex items-center gap-1.5 text-[12px] text-ink-muted mb-3 flex-wrap">
      {trail.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <Icon name="chevR" size={12} className="text-ink-faint" />}
          {t.page && i < trail.length - 1
            ? <button onClick={() => go(t.page)} className="hover:text-ink transition-colors">{t.label}</button>
            : <span className={i === trail.length - 1 ? "font-medium" : ""} style={i === trail.length - 1 ? { color: "#0A0A0A" } : undefined}>{t.label}</span>}
        </span>
      ))}
    </nav>
  );
  return (
    <button onClick={() => go("manage")} className="text-[12px] font-semibold text-tap-greenDeep mb-3 inline-flex items-center gap-1">
      <Icon name="arrow" size={13} className="rotate-180" /> {label}
    </button>
  );
};

/* ═══════════ J1 · RETRIEVE + MANAGE HUB ═══════════ */
// G1 · a purchased fare brand is a bundle; surface each service item with a granular
// delivery status so the same bundle renders consistently in post-booking and at check-in.
function bundleServices(b, meta) {
  const fare = meta.fare || meta.cabin || "Classic";
  const ci = b.checked_in;
  const items = [...new Set(b.items || [])];
  const svc = [{ label: `${(b.flight_no || "").replace(/([A-Za-z]+)\s*(\d+)/, "$1 $2")}`, status: "Confirmed", tone: "green" }];
  svc.push({ label: `${t("seat")} ${b.seat || "—"}`, status: b.seat && b.seat !== "—" ? "Assigned" : "Auto at check-in", tone: b.seat && b.seat !== "—" ? "green" : "slate" });
  items.filter(c => c !== "seat").forEach(c => {
    let status = "Confirmed", label = extraLabel(c);
    if (c === "meal") status = "Pre-ordered";
    else if (c === "lounge") { status = "Access ready"; label = t("lounge"); }
    else if (c === "wifi") { status = "Voucher issued"; label = t("wifi"); }
    else if (/bag/i.test(c)) { status = ci ? "Tagged" : "Confirmed"; label = t("checkedBag"); }
    svc.push({ label, status, tone: "green" });
  });
  svc.push({ label: t("boardingPass"), status: ci ? "Issued" : "Available 24h before", tone: ci ? "green" : "slate" });
  return { fare, svc };
}

export function ManageBooking({ shared, go }) {
  const { booking, all, loading, err } = useActiveBooking();
  const airports = shared.airports;
  const u = shared.profile?.user || {};
  if (loading) return <Loading />;
  if (err) return <Empty go={go} title="Couldn't reach your bookings" msg={err} />;
  if (!booking) return <Empty go={go} />;
  // Every upcoming trip (not cancelled, not departed) — the basket lists them all.
  // Sort soonest-first (by date, then departure time) so the list order matches the
  // "next flight" the upsell and primary pick key to — otherwise raw DB order can put a
  // later flight above today's, making the wrong trip look like the next one.
  const trips = (all || [])
    .filter(b => (b.status || "confirmed") !== "cancelled" && (b.days_to_go ?? 0) >= 0)
    .sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date))
      || String(a.flight?.dep || "").localeCompare(String(b.flight?.dep || "")));
  const list = trips.length ? trips : [booking];
  const ACTIONS = [
    ["Upgrade cabin", "upgrade", "star"],
    ["Change seat", "seatchange", "seat"],
    ["Check in", "checkin", "doc"],
    ["Add extras", "addextras", "bag"],
    ["Cancel & refund", "refund", "info"],
  ];
  const priceOf = b => Math.round(b.flight?.price || 180);
  const subtotal = list.reduce((s, b) => s + priceOf(b), 0);
  const taxes = Math.round(subtotal * 0.055);
  const savings = 42;
  const total = subtotal + taxes - savings;
  const earn = Math.round(total * 2.77);
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "Home", page: "home" }, { label: "My trips" }]} />
      <h1 className="text-[30px] font-black">My trips</h1>
      <div className="text-[13px] text-ink-muted mt-1">{list.length} upcoming flight{list.length !== 1 ? "s" : ""} · manage seats, check-in, extras and more</div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 mt-6 items-start">
        <div className="space-y-4">
          {list.map((b, idx) => {
            const f = b.flight || {};
            const meta = b.meta || {};
            const cabin = meta.cabin || b.cabin || "Economy";
            const fareName = meta.fare || cabin;                         // e.g. "Plus" / "Executive"; falls back to cabin
            const paxN = meta.pax || (meta.passengers || []).length || 1;
            const paxNames = (meta.passengers || []).map(p => [p.title, p.first, p.last].filter(Boolean).join(" ").trim()).filter(Boolean);
            const inb = b.inboundFlight;
            return (
              <Card key={b.pnr || idx} className="p-5 v2-in">
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="w-6 h-6 rounded-md bg-lime text-ink inline-flex items-center justify-center shrink-0 mt-0.5"><Icon name="check" size={13} /></span>
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[16px] font-black">{f.origin || "OPO"} <span className="text-ink-faint">→</span> {f.dest || "LIS"}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded px-2 py-0.5">{fareName}</span>
                      <span className="text-[15px] font-bold v2-num ml-1">{f.dep || "—"} <span className="text-ink-faint">→</span> {f.arr || "—"}</span>
                    </div>
                    <div className="text-[12px] text-ink-muted mt-1">{cityOf(airports, f.origin)}–{cityOf(airports, f.dest)} · {fmtDate(b.flight_date)} · {f.duration || "1h05"} · Direct</div>
                    <div className="text-[12px] text-ink-muted mt-0.5">{paxN} traveller{paxN > 1 ? "s" : ""} · {f.flight_no || b.flight_no} · {fareName}</div>
                    {paxNames.length > 0 && <div className="mt-1.5 flex flex-col gap-1">{paxNames.map((nm, i) => <span key={i} className="text-[12px] text-ink inline-flex items-center gap-1.5"><Icon name="user" size={11} className="text-ink-faint" /><span className="font-medium">{nm}</span><span className="text-ink-faint">·</span><span className="inline-flex items-center gap-1 text-tap-greenDeep font-semibold"><Icon name="seat" size={10} /> {(paxNames.length > 1) ? seatForPax(b.seat, i) : (b.seat || "—")}</span></span>)}</div>}
                    {inb && <div className="text-[12px] text-ink-muted mt-0.5">Return · {inb.origin}<span className="text-ink-faint"> → </span>{inb.dest} · {fmtDate(meta.inbound?.date || inb.flight_date)} · {inb.flight_no}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded-full px-2.5 py-1"><Icon name="check" size={10} /> Confirmed</span>
                    <div className="text-[11px] text-ink-faint mt-1">{(b.days_to_go ?? 0) > 0 ? `In ${b.days_to_go} day${b.days_to_go !== 1 ? "s" : ""}` : "Today"} · {b.pnr || b.flight_no}</div>
                    {b.payment && (() => { const p = b.payment; const mode = [p.miles_used > 0 && "Miles", p.voucher_amt > 0 && "Voucher", (p.card_amt || 0) > 0 && "Card"].filter(Boolean).join(" + "); return mode ? <div className="text-[10px] font-semibold text-tap-greenDeep mt-1 inline-flex items-center gap-1 justify-end"><Icon name="spark" size={10} /> Paid: {mode}</div> : null; })()}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap text-[12px] text-ink-muted">
                  <span>Includes:</span>
                  {paxN <= 1 && <span className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink"><Icon name="seat" size={11} /> Seat {b.seat || "—"}</span>}
                  {(() => { const xs = (b.items || []).filter(c => c !== "seat"); return <>
                    {xs.slice(0, 8).map((c, i) => <span key={i} className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink">{extraLabel(c)}</span>)}
                    {xs.length > 8 && <span className="inline-flex items-center border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-muted">+{xs.length - 8} more</span>}
                  </>; })()}
                  {!(b.items || []).length && <span className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink"><Icon name="bag" size={11} /> Carry-on</span>}
                </div>
                {(() => {
                  const { fare: bf, svc } = bundleServices(b, meta);
                  return (
                    <div className="mt-3 rounded-xl border border-line bg-surface-soft/60 p-3">
                      <div className="flex items-center gap-2 mb-2"><Icon name="spark" size={12} className="text-tap-greenDeep" /><span className="text-[11px] font-bold text-ink">{bf} bundle</span><span className="text-[10px] text-ink-faint">· {svc.length} services · granular delivery status</span></div>
                      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                        {svc.map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 text-[11.5px]">
                            <span className="text-ink-muted truncate">{s.label}</span>
                            <span className={cx("shrink-0 inline-flex items-center gap-1 font-semibold", s.tone === "green" ? "text-tap-greenDeep" : "text-ink-faint")}>{s.tone === "green" && <Icon name="check" size={11} />}{s.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line">
                  <button onClick={() => go("rebook", { pnr: b.pnr })} className="inline-flex items-center gap-1.5 rounded-full bg-tap-green text-white px-3.5 py-1.5 text-[12px] font-bold hover:bg-tap-greenDeep transition-colors"><Icon name="refresh" size={12} /> Update flight</button>
                  {ACTIONS.map(([lbl, page, ic]) => (
                    <button key={lbl} onClick={() => go(page, { pnr: b.pnr })} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-tap-green hover:text-tap-greenDeep transition-colors"><Icon name={ic} size={12} /> {lbl}</button>
                  ))}
                  {paxN > 1 && <button onClick={() => go("split", { pnr: b.pnr })} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-tap-green hover:text-tap-greenDeep transition-colors"><Icon name="swap" size={12} /> Change / split travellers</button>}
                </div>
              </Card>
            );
          })}
          <button onClick={() => go("home")} className="w-full rounded-2xl border border-dashed border-line-strong py-3.5 px-5 text-[13px] font-semibold text-ink hover:border-tap-green hover:text-tap-greenDeep transition-colors flex items-center justify-between">
            <span>+ Book another trip</span>
            <span className="text-[11px] text-ink-faint">Search flights & add to your trips</span>
          </button>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="font-bold text-[17px] mb-1">Trip overview</div>
            <div className="text-[12px] text-ink-muted pb-3 border-b border-line">{list.length} upcoming flight{list.length !== 1 ? "s" : ""} on this profile</div>
            <div className="space-y-2 text-[13px] mt-3">
              {list.map((b, i) => (
                <div key={i} className="flex justify-between gap-3"><span className="text-ink-muted">{cityOf(airports, b.flight?.origin)}–{cityOf(airports, b.flight?.dest)}</span><span className="font-semibold v2-num text-ink-faint">{fmtDate(b.flight_date)}</span></div>
              ))}
            </div>
            <Divider className="my-3" />
            <div className="grid grid-cols-2 gap-2">
              <Btn variant="outline" size="sm" onClick={() => go("checkin")}><Icon name="doc" size={13} /> Check in</Btn>
              <Btn variant="outline" size="sm" onClick={() => go("addextras")}><Icon name="bag" size={13} /> Add extras</Btn>
            </div>
            <Btn size="lg" className="w-full mt-2" onClick={() => go("home")}>Book another trip →</Btn>
          </Card>
          <Card className="p-5">
            <div className="font-bold text-[15px]">Retrieve your booking</div>
            <div className="text-[11px] text-ink-muted mt-0.5 mb-3">Find any booking — direct, agent, or partner. Then check in, add extras, or change seats.</div>
            <div className="space-y-2.5">
              <Field label="Booking reference"><Input defaultValue={booking.pnr} /></Field>
              <Field label="Last name"><Input defaultValue={lastName(u)} placeholder="Surname" /></Field>
              <Btn variant="outline" className="w-full" onClick={() => go("retrieve")}>Retrieve booking</Btn>
            </div>
          </Card>
          <Card className="p-4 text-[12px] space-y-2.5">
            <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="refresh" size={15} /></span><div><div className="font-semibold">24h free cancellation</div><div className="text-ink-faint">On flights & most extras.</div></div></div>
            <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="doc" size={15} /></span><div><div className="font-semibold">Boarding passes</div><div className="text-ink-faint">Available 24h before departure.</div></div></div>
            <div className="flex items-start gap-2.5"><span className="text-tap-green mt-0.5"><Icon name="heart" size={15} /></span><div><div className="font-semibold">24/7 {u.tier || "Gold"} care</div><div className="text-ink-faint">WhatsApp · phone · live chat.</div></div></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ J1 · RETRIEVE BOOKING ═══════════ */
export function Retrieve({ shared, go }) {
  const [mode, setMode] = useState("pnr");          // pnr | eticket | miles (#2)
  const [pnr, setPnr] = useState("6ZK4PD");
  const [last, setLast] = useState("Pinto");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState(false);        // booking-found panel (#8)
  const recent = [                                  // recent on this device (#7)
    { pnr: "6ZK4PD", name: "Silva", route: "Lisbon–Porto", date: "12 Jun" },
    { pnr: "A23JQM", name: "Costa", route: "Lisbon–Porto", date: "04 Aug" },
  ];
  const find = (ref) => { if (ref) setPnr(ref); setFound(true); window.scrollTo({ top: 0 }); };
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: "Retrieve booking" }]} />
      <h1 className="text-[26px] font-black">Retrieve your booking</h1>
      {/* supporting description (#1) */}
      <p className="text-[13px] text-ink-muted mt-1 max-w-xl">Find any booking — direct, agent, or partner. Then check in, add extras, or change seats.</p>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 mt-6 items-start">
        <div>
          <Card className="p-5">
            {/* retrieval options (#2) */}
            <div className="flex flex-wrap gap-2">
              {[["pnr", "By PNR"], ["eticket", "By eTicket"], ["miles", "Sign in to Miles & Go"]].map(([k, l]) => (
                <button key={k} onClick={() => setMode(k)} className={cx("rounded-full px-4 py-2 text-[13px] font-bold transition-colors", mode === k ? "bg-tap-green text-white" : "border border-line-strong text-ink hover:border-tap-green")}>{l}</button>
              ))}
            </div>
            {/* styled booking-reference field with spaced characters (#3) */}
            <label className="block rounded-2xl border border-line bg-surface-soft px-4 py-3 mt-4 cursor-text focus-within:border-tap-green transition-colors">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{mode === "eticket" ? "eTicket number" : "Booking reference / PNR"}</div>
              <input value={pnr} onChange={e => setPnr(e.target.value.toUpperCase())} className="w-full bg-transparent outline-none text-[18px] font-black text-ink mt-0.5 tracking-[0.35em] uppercase v2-num" />
            </label>
            {/* styled last-name field (#4) */}
            <label className="block rounded-2xl border border-line bg-surface-soft px-4 py-3 mt-3 cursor-text focus-within:border-tap-green transition-colors">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Last name</div>
              <input value={last} onChange={e => setLast(e.target.value)} placeholder="Surname" className="w-full bg-transparent outline-none text-[16px] font-semibold text-ink mt-0.5" />
            </label>
            {/* email (optional) field (#5) */}
            <label className="block rounded-2xl border border-line bg-surface-soft px-4 py-3 mt-3 cursor-text focus-within:border-tap-green transition-colors">
              <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Email <span className="text-ink-faint font-medium normal-case">(optional)</span></div>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" className="w-full bg-transparent outline-none text-[16px] font-semibold text-ink mt-0.5" />
            </label>
            {/* solid green CTA with arrow (#6) */}
            <Btn size="lg" className="w-full mt-4" onClick={() => find()}>Retrieve booking <Icon name="arrow" size={15} /></Btn>
          </Card>

          {/* recent on this device (#7) */}
          <div className="mt-6">
            <div className="font-bold text-[15px] mb-2.5">Recent on this device</div>
            <div className="space-y-2.5">
              {recent.map(r => (
                <button key={r.pnr} onClick={() => find(r.pnr)} className="w-full flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 hover:border-tap-green transition-colors text-left">
                  <span className="text-[11px] font-bold rounded-md bg-surface-dark text-white px-2.5 py-1 v2-num shrink-0">{r.pnr}</span>
                  <span className="text-[13px] text-ink-muted flex-1 min-w-0 truncate">{r.name} · {r.route} · {r.date}</span>
                  <span className="text-[13px] font-bold text-tap-greenDeep inline-flex items-center gap-1 shrink-0">Open <Icon name="arrow" size={13} /></span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* booking-found panel (#8) */}
        <aside className="lg:sticky lg:top-6">
          {found ? (
            <Card className="p-5 ring-2 ring-tap-green/40 bg-lime-tint/20 v2-in">
              <div className="text-[12px] font-bold text-tap-greenDeep flex items-center gap-1.5"><Icon name="check" size={13} /> Booking found</div>
              <div className="text-[22px] font-black mt-1">PNR {pnr.toUpperCase()}</div>
              <div className="text-[13px] text-ink-muted mt-1">{last || "Pinto"}, Carlos +1 · Lisbon–Porto</div>
              <div className="text-[12px] text-ink-faint mt-0.5">Wed 22 Jul · TP 73 · 16:45</div>
              <div className="mt-3 rounded-lg border border-[#f5d9a8] bg-[#fffaf0] text-[#7a5a10] text-[12px] px-3 py-2 flex items-center gap-1.5"><Icon name="info" size={12} /> Booked via Despegar.com</div>
              <div className="mt-4">
                <div className="text-[12px] font-bold mb-1.5">Available online:</div>
                <ul className="text-[12px] text-ink-muted space-y-1">
                  <li className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green" /> Check in online</li>
                  <li className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green" /> Add bag · seat · lounge</li>
                  <li className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green" /> View receipt</li>
                  <li className="flex items-center gap-1.5 text-ink-faint"><Icon name="info" size={12} /> Cabin upgrade (agent only)</li>
                </ul>
              </div>
              <Btn size="lg" className="w-full mt-4" onClick={() => go("manage")}>Open My Trip</Btn>
            </Card>
          ) : (
            <Card className="p-6 text-center">
              <span className="w-10 h-10 rounded-full bg-surface-soft inline-flex items-center justify-center mb-2"><Icon name="search" size={18} className="text-ink-faint" /></span>
              <div className="text-[13px] text-ink-muted">Enter your booking reference and last name, or pick a recent booking, to find your trip.</div>
            </Card>
          )}
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
  const [sel, setSel] = useState("exec");   // chosen upgrade option (#4)
  if (loading) return <Loading label="Loading upgrade options…" />;
  if (err || !booking) return <Empty go={go} />;
  // Upgrade prices derived from the booking's own fare so the demo numbers track the real
  // booking. Executive ≈60% of fare (min €60); Premium Economy ≈55% of the Executive step.
  const baseFare = booking.flight?.price || 180;
  const curCabin = booking.meta?.cabin || "Economy";   // #26 — actual booked cabin, not hardcoded
  const execDiff = Math.max(60, Math.round(baseFare * 0.6 / 5) * 5);
  const premDiff = Math.max(40, Math.round(execDiff * 0.55 / 5) * 5);
  const UPGRADE_BENEFITS = ["Lie-flat seat (Executive)", "Priority boarding", "Lounge access included", "2 bags 32kg free", "Premium meal & wine"];
  const REISSUE = ["New boarding pass pushed to Apple Wallet & Google Pay", "Confirmation email & push notification sent", "Old BP invalidated · gate/seat updates continue on new BP"];
  const OPTS = {
    prem: { name: "Premium Economy", diff: premDiff, seats: 8, rec: false },
    exec: { name: "Executive", diff: execDiff, seats: 3, rec: true },
  };
  const chosen = OPTS[sel];
  const fareDiff = chosen.diff;                 // selected upgrade cost
  const newTotal = baseFare + fareDiff;
  const milesPrice = Math.round(fareDiff / MILES_RATE / 500) * 500;
  const confirm = async () => {
    setBusy(true);
    // The cabin code isn't seeded in the ancillaries table (demo): the endpoint returns
    // {ok:false}; we still advance to success so the journey is demoable.
    await api.post("/bookings/ancillary", { code: "cabin-" + sel, pnr: booking.pnr }).catch(() => ({ ok: false }));
    notifyBookingChanged();   // #36/#38 — refresh My Trip / check-in / boarding pass
    setBusy(false); setDone(true); window.scrollTo({ top: 0 });
  };
  if (done) return (
    <div className="bg-white min-h-screen"><div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title={`Upgraded to ${chosen.name}`} sub={`PNR ${booking.pnr} · confirmation on its way`} />
      <Card className="p-5 mt-6 v2-in">
        <BookingBand booking={booking} airports={shared.airports} />
        <div className="flex flex-wrap gap-2 mt-3"><Pill tone="gold">{chosen.name} cabin</Pill><Pill tone="lime">Lie-flat seat</Pill><Pill tone="slate">Lounge access</Pill><Pill tone="slate">2× checked bags</Pill></div>
        <Divider className="my-4" />
        <div className="flex items-center justify-between"><span className="text-[13px] text-ink-muted">Upgrade charged</span><span className="text-[20px] font-black text-tap-green v2-num">{EUR(fareDiff)}</span></div>
      </Card>
      <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
    </div>
    </div>
  );
  return (
    <div className="bg-white min-h-screen"><div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${booking.pnr} — ${cityOf(shared.airports, booking.flight?.origin)}–${cityOf(shared.airports, booking.flight?.dest)} · ${fmtDate(booking.flight_date)}`, page: "manage" }, { label: "Cabin upgrade" }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[36px] font-bold">Upgrade your cabin</h1>
          <p className="text-[16px] leading-6 text-ink-muted mt-1">You're checked in. Pick a fixed price — your new boarding pass is auto-reissued.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold shrink-0" style={{ borderRadius: "14px", padding: "8px 16px", background: "#F2FCD9", color: "#2E7D33" }}><Icon name="check" size={12} /> Checked in</span>
      </div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div>
          <div className="rounded-xl text-[13px] flex items-center gap-2 flex-wrap" style={{ background: "#FAFAF7", border: "1px solid #DCDCD8", padding: "18px" }}>
            <span className="text-ink-muted">Current:</span><span className="font-semibold">{curCabin} · Seat {booking.seat || "—"}</span><Icon name="arrow" size={14} className="text-ink-faint" /><span className="text-ink-muted">Upgrade to:</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {["prem", "exec"].map(k => { const o = OPTS[k]; const on = sel === k; return (
              <Card key={k} onClick={() => setSel(k)} className={cx("cursor-pointer transition-all v2-in", on ? "border-2" : "hover:border-line-strong")} style={{ padding: "24px", borderRadius: "16px", ...(on ? { borderColor: "#9EFD38", background: "#F2FFDB" } : {}) }}>
                <div className="flex items-start justify-between gap-2"><div className="text-[20px] font-bold">{o.name}</div>{o.rec && <span className="text-[9px] font-bold uppercase tracking-wide inline-flex items-center" style={{ background: "#FAD633", color: "#1A1F29", borderRadius: "10px", padding: "3px 8px" }}>Recommended</span>}</div>
                <div className="mt-1.5"><span className="text-[22px] font-bold v2-num">{k === "exec" ? "+" : ""}{eur2(o.diff)}</span><span className="text-[12px] text-ink-faint"> {k === "exec" ? "to upgrade" : "currently"}</span></div>
                <div className="h-px w-full my-3" style={{ background: "#E0E3E8" }} />
                <div className="text-[11px] font-semibold text-tap-greenDeep">Fixed price · instant</div>
                <div className="text-[11px] font-semibold mt-0.5" style={{ color: "#2E7D33" }}>{o.seats > 5 ? `Available · ${o.seats} seats` : `${o.seats} seats left`}</div>
                <ul className="text-[13px] font-medium text-ink-muted mt-3 space-y-1.5">{UPGRADE_BENEFITS.map(b => <li key={b} className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green shrink-0" /> {b}</li>)}</ul>
                <Btn variant={on ? "primary" : "outline"} className="w-full mt-4" style={{ height: "48px", borderRadius: "24px", padding: "0 16px", ...(k === "prem" ? { opacity: 0.2 } : {}) }} disabled={busy || k === "prem"} onClick={e => { e.stopPropagation(); if (k !== "prem") { setSel(k); confirm(); } }}>Upgrade for {eur2(baseFare + o.diff)}</Btn>
              </Card>
            ); })}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {[`Save ${eur2(120)} vs. buying at gate`, `Lounge value alone ≈ ${eur2(38)}`, `+${miles(1240)} bonus miles`].map(b => <span key={b} className="text-[11px] font-semibold" style={{ borderRadius: "14px", border: "1px solid #A6D926", background: "#F2FFDB", color: "#1A1F29", padding: "6px 12px" }}>{b}</span>)}
          </div>
          <Card className="p-5 mt-4" style={{ background: "#FAFAF7", borderColor: "#DCDCD8" }}>
            <div className="font-bold text-[14px] mb-2.5">After upgrade — auto-reissue</div>
            <ul className="text-[13px] font-medium text-ink-muted space-y-1.5">{REISSUE.map(b => <li key={b} className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green shrink-0" /> {b}</li>)}</ul>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 space-y-3">
          <Card className="p-5" style={{ borderRadius: "18px" }}>
            <div className="font-bold text-[16px] mb-3">Upgrade summary</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Current {curCabin} fare</span><span className="v2-num">{eur2(baseFare)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Cabin upgrade · {chosen.name}</span><span className="v2-num">+{eur2(fareDiff)}</span></div>
            </div>
            <Divider className="my-3" />
            <div className="flex items-end justify-between"><span className="font-bold">New total</span><span className="text-[28px] font-bold v2-num">{eur2(newTotal)}</span></div>
            <div className="text-[11px] text-ink-faint mt-1">or {miles(milesPrice)} miles</div>
            <Btn size="lg" className="w-full mt-3" style={{ height: "42px", borderRadius: "9999px" }} disabled={busy} onClick={confirm}>{busy ? "Confirming…" : `Upgrade for ${eur2(newTotal)} →`}</Btn>
            <Btn variant="outline" className="w-full mt-2" style={{ borderColor: "#E8E8E5", color: "#0A0A0A", fontWeight: 600, fontSize: "13px" }} onClick={() => go("manage")}>No thanks, keep {curCabin}</Btn>
          </Card>
          <div className="rounded-xl px-4 py-3" style={{ background: "#FFF0D6", border: "1px solid #FAA824" }}>
            <div className="text-[13px] font-bold flex items-center gap-1.5" style={{ color: "#1A1F29" }}><Icon name="info" size={14} className="text-[#FAA824]" />{chosen.seats} {chosen.name} seats remaining</div>
            <div className="text-[11px] mt-0.5" style={{ color: "#667080" }}>Window closes 4 h before departure</div>
          </div>
        </aside>
      </div>
    </div></div>
  );
}

/* ═══════════ A10 · SEAT CHANGE ═══════════ */
export function SeatChange({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
  const [rec, setRec] = useState(null);
  const [seatByPax, setSeatByPax] = useState({});
  const [activePax, setActivePax] = useState(0);
  const [cabin, setCabin] = useState(null);
  const [eligOk, setEligOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { api.get("/seat-recommendation").then(setRec).catch(() => {}); }, []);
  if (loading) return <Loading label="Loading the seat map…" />;
  if (err || !booking) return <Empty go={go} />;

  const paxCount = (booking.meta?.passengers?.length) || Number(booking.meta?.pax) || 1;
  const paxList = (booking.meta?.passengers && booking.meta.passengers.length)
    ? booking.meta.passengers
    : Array.from({ length: Math.max(1, paxCount) }, (_, i) => ({ first: i === 0 ? (booking.meta?.first_name || "Passenger 1") : `Passenger ${i + 1}` }));
  const adjSeatFor = (base, i) => { const m = String(base || "").match(/^(\d+)([A-F])$/); if (!m || !i) return base; const r = +m[1], c = "ABCDEF".indexOf(m[2]); return `${r}${"ABCDEF"[((c + i) % 6 + 6) % 6]}`; };
  const sel = seatByPax[activePax] || null;
  const setSel = (s) => setSeatByPax(p => ({ ...p, [activePax]: (typeof s === "function" ? s(p[activePax]) : s) }));

  const aircraft = booking.flight?.aircraft || "A330-900neo";
  const baseSeat = booking.seat || rec?.seat || "8A";
  const curSeat = adjSeatFor(baseSeat, activePax);
  const curRow = parseInt(curSeat, 10) || 8;
  const cabinOfRow = (r) => (r <= 5 ? "Business" : r <= 11 ? "Premium" : "Economy");

  // Cabin tabs match the booking flow (Economy / Premium / Business), not First/Executive.
  // Each zone is physically distinct: Business 1-1 lie-flat · Premium 2-2 · Economy 3-3.
  const CABINS = {
    Economy: { cols: ["A", "B", "C", "D", "E", "F"], rows: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], config: "3 – 3", desc: "Standard Economy", extraRows: [20, 26], exitRows: [20, 26], aisleAfter: [2] },
    Premium: { cols: ["A", "C", "D", "F"], rows: [6, 7, 8, 9, 10, 11], config: "2 – 2", desc: "Premium cabin · wider seat", extraRows: [6], exitRows: [6], aisleAfter: [1] },
    Business: { cols: ["A", "C", "D", "F"], rows: [1, 2, 3, 4, 5], config: "2 – 2", desc: "Executive cabin · lie-flat recline", extraRows: [1], exitRows: [], aisleAfter: [1] },
  };
  // Default to the cabin actually booked (normalise any legacy First/Executive labels), else infer from the seat row.
  const bookingCabin = ({ First: "Business", Executive: "Business", "Premium Economy": "Premium" }[booking.meta?.cabin] || booking.meta?.cabin);
  const cabinKey = cabin || (CABINS[bookingCabin] ? bookingCabin : cabinOfRow(curRow));
  const C = CABINS[cabinKey];
  // #35 — validate the assigned seat against the ACTIVE cabin layout; if it doesn't exist there
  // (e.g. a legacy 4C on a Business A/D map), remap to the first valid seat so the map, the
  // "current" badge and the confirm button all reference a seat that actually exists.
  const seatInCabin = (s) => { const m = String(s || "").match(/^(\d+)([A-Z])$/); return !!(m && C.cols.includes(m[2]) && C.rows.includes(+m[1])); };
  const safeSeat = seatInCabin(curSeat) ? curSeat : `${C.rows[0]}${C.cols[0]}`;
  const safeRow = parseInt(safeSeat, 10) || C.rows[0];
  const taken = new Set();
  C.rows.forEach((r, i) => C.cols.forEach((col, j) => { if (((r * 7 + j * 3 + i * 2) % 5) === 0) taken.add(`${r}${col}`); }));

  const feeOf = (id) => (C.extraRows.includes(parseInt(id, 10)) ? 18 : 0);
  const isExit = (id) => C.exitRows.includes(parseInt(id, 10));
  const selFee = sel ? feeOf(sel) : 0;
  const selExit = sel ? isExit(sel) : false;
  const canConfirm = Object.values(seatByPax).some(s => s && s !== safeSeat) && (!selExit || eligOk);

  const confirm = async () => {
    if (!canConfirm) return;   // #31 — CTA stays visually active, but a valid new seat is required
    setBusy(true);
    for (const s of Object.values(seatByPax)) { if (s) await api.post("/bookings/ancillary", { code: "seat-" + s, pnr: booking.pnr }).catch(() => ({ ok: false })); }
    notifyBookingChanged();   // #36 — seat change must reflect in My Trip immediately · FT-1 applies every passenger's seat
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
      <div className="mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn></div>
    </div>
  );

  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[12px] text-ink-faint">
          <button onClick={() => go("manage")} className="hover:text-ink">My Trip</button> › {booking.pnr} — {cityOf(shared.airports, booking.flight?.origin)}–{cityOf(shared.airports, booking.flight?.dest)} · {fmtDate(booking.flight_date)} › <span className="text-ink-muted">Change seat</span>
        </div>
        <span className="inline-flex items-center gap-1.5 font-bold" style={{ background: "#F2FCD9", borderRadius: "14px", padding: "8px 16px", color: "#2E7D33", fontSize: "11px" }}><Icon name="check" size={11} /> Checked in</span>
      </div>
      <h1 className="text-[36px] font-bold mt-3">Change your seat</h1>
      <p className="text-[16px] leading-6 mt-1" style={{ color: "#6B6B6B" }}>Pick a new seat; we recalculate the fare difference and reissue your boarding pass.</p>

      {paxList.length > 1 && (
        <div className="mt-4 inline-flex items-center gap-1 rounded-full border flex-wrap" style={{ borderColor: "#E8E8E5", padding: "6px" }}>
          {paxList.map((p, i) => (
            <button key={i} onClick={() => setActivePax(i)} className="px-3 py-1.5 rounded-full text-[13px] font-semibold transition-colors inline-flex items-center gap-1.5" style={activePax === i ? { background: "#0A0A0A", color: "#FFFFFF" } : { background: "#FFFFFF", color: "#0A0A0A" }}>
              {seatByPax[i] ? <Icon name="check" size={12} className={activePax === i ? "text-tap-green" : "text-tap-greenDeep"} /> : <span className={cx("w-1.5 h-1.5 rounded-full inline-block shrink-0", activePax === i ? "bg-white/50" : "bg-ink-faint")} />}
              {(p.first || `Passenger ${i + 1}`)} · {seatByPax[i] || adjSeatFor(baseSeat, i)}
            </button>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-6 mt-6 items-start">
        <Card className="p-6 v2-in" style={{ borderRadius: "18px", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-[18px] font-bold" style={{ color: "#1A1F29" }}>{aircraft} · {cabinKey === "Business" ? "Executive" : cabinKey} cabin</div>
            <div className="text-[11px] text-ink-faint">{C.config} · {C.desc}</div>
          </div>
          <div className="text-center mt-4 mb-3" style={{ color: "#667080", fontSize: "11px", fontWeight: 700 }}>Front</div>
          <div className="mx-auto w-fit overflow-x-auto">
            <div className="flex items-center mb-2 justify-center" style={{ gap: 0 }}>
              <span className="w-5 shrink-0" /><span className="shrink-0" style={{ width: "18px" }} />
              {C.cols.map((col, ci) => <React.Fragment key={col}><span className="text-center text-[10px] text-ink-faint" style={{ width: "60px" }}>{col}</span>{ci < C.cols.length - 1 && <span className="shrink-0" style={{ width: C.aisleAfter?.includes(ci) ? "64px" : "48px" }} />}</React.Fragment>)}
            </div>
            <div className="space-y-2.5">
              {C.rows.map(r => (
                <div key={r} className="flex items-center justify-center" style={{ gap: 0 }}>
                  <span className="w-5 text-[10px] text-ink-faint text-right shrink-0">{r}</span><span className="shrink-0" style={{ width: "18px" }} />
                  {C.cols.map((col, ci) => {
                    const id = `${r}${col}`, isCur = id === safeSeat, isTaken = taken.has(id) && !isCur, isSel = sel === id, extra = feeOf(id) > 0, isRec = rec?.seat === id && !isCur;
                    return (
                      <React.Fragment key={id}>
                      <button disabled={isTaken} title={isExit(id) ? "Exit row · extra legroom" : extra ? "Extra legroom" : ""} onClick={() => { setSel(id); setEligOk(false); }}
                        style={isSel ? { width: 60, height: 60, background: "#D4F25E", border: "2px solid #2E7D33", color: "#111111" } : isCur ? { width: 60, height: 60, background: "#F5FCD9", border: "1px solid #E0E3E8" } : { width: 60, height: 60 }}
                        className={cx("shrink-0 rounded-lg text-[10px] font-bold leading-none flex flex-col items-center justify-center transition-colors",
                          isSel ? "" : isCur ? "text-ink" : isTaken ? "bg-surface-mute text-ink-faint cursor-not-allowed" : extra ? "bg-[#F4B740] text-ink" : isRec ? "bg-lime text-ink" : "bg-white border border-line-strong text-ink hover:border-tap-green")}>
                        <span>{id}</span>{isCur && <span className="text-[7px] font-medium">Your seat</span>}
                      </button>
                      {ci < C.cols.length - 1 && <span className="shrink-0" style={{ width: C.aisleAfter?.includes(ci) ? "64px" : "48px" }} />}
                      </React.Fragment>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center flex-wrap gap-3 mt-5 text-[10px] text-ink-faint">
            {[["bg-white border border-line-strong", "Available", null], ["bg-surface-mute", "Taken", null], ["bg-[#F4B740]", "Extra €18", null], ["", "Your seat", "#F5FCD9"], ["", "Selected", "#D4F25E"]].map(([c, t, bg]) => (
              <span key={t} className="inline-flex items-center gap-1"><span className={cx("w-3.5 h-3.5 rounded inline-block", c)} style={bg ? { background: bg, border: "1px solid #E0E3E8" } : undefined} /> {t}</span>
            ))}
          </div>
        </Card>

        <aside className="space-y-4">
          <Card className="p-5 v2-in" style={{ borderRadius: "18px" }}>
            <div className="font-semibold text-[20px] mb-3" style={{ color: "#1A1F29" }}>Seat change summary</div>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl" style={{ background: "#F7FAFC", border: "1px solid #E0E3E8", padding: "16px" }}><div className="text-[10px] uppercase tracking-wide text-ink-faint">Current</div><div className="text-[22px] font-bold v2-num" style={{ color: "#1A1F29" }}>{safeSeat}</div><div className="text-[10px] text-ink-faint">{cabinKey} · row {safeRow}</div></div>
              <span className="shrink-0 font-bold" style={{ fontSize: "22px", color: "#1A1F29" }}>→</span>
              <div className="flex-1 rounded-xl" style={{ background: "#F5FCD9", border: "1px solid #E0E3E8", padding: "16px" }}><div className="text-[10px] uppercase tracking-wide text-ink-faint">New</div><div className="text-[22px] font-bold v2-num" style={{ color: "#1A1F29" }}>{sel || "—"}</div><div className="text-[10px] text-ink-faint">{sel ? (selFee ? "Extra legroom" + (selExit ? " · exit row" : "") : "Standard · row " + parseInt(sel, 10)) : "Pick a seat"}</div></div>
            </div>
            <div style={{ height: "1px", background: "#E8E8E5", margin: "16px 0", width: "100%" }} />
            <div className="flex items-center justify-between mb-3" style={{ height: "76px", borderRadius: "14px", border: "1px solid #E0E3E8", padding: "0 18px" }}><div><div className="text-[13px] font-semibold">Extra-legroom fee</div><div className="text-[11px] text-ink-faint">{selFee > 0 ? "One-time · added to this booking" : "Applies to exit & extra-legroom rows"}</div></div><span className="v2-num font-bold" style={{ fontSize: "22px", color: "#1A1F29" }}>{eur2(selFee)}</span></div>
            <div className="mb-1" style={{ background: "#FFF5E0", border: "1px solid #FAA824", padding: "16px 22px", borderRadius: "12px" }}>
                <div className="text-[12px] font-bold flex items-center gap-1.5"><Icon name="info" size={13} className="shrink-0" /> Exit-row eligibility</div>
                <div className="text-[11px] text-ink-muted mt-1">You must be 16+, able-bodied, speak Portuguese or English, and willing to assist in an emergency.</div>
                <button onClick={() => setEligOk(v => !v)} className="flex items-center gap-2 text-[12px] font-semibold mt-2.5 text-left w-full"><span className="inline-flex items-center justify-center shrink-0" style={{ width: "20px", height: "20px", borderRadius: "6px", background: eligOk ? "#1A1F29" : "#fff", border: eligOk ? "none" : "1px solid #C9CDD3" }}>{eligOk && <Icon name="check" size={12} className="stroke-[3]" style={{ color: "#D4F25E" }} />}</span> I confirm I meet the exit-row requirements</button>
              </div>
            <button onClick={confirm} disabled={busy} style={{ height: "42px", borderRadius: "9999px", background: "#46A41A", color: "#fff" }} className="w-full mt-4 font-semibold text-[14px] inline-flex items-center justify-center disabled:opacity-60 transition-opacity">{busy ? "Reissuing…" : canConfirm ? `Confirm seat ${sel}${selFee ? " · " + eur2(selFee) : ""} →` : (sel && sel === safeSeat ? "This is your current seat" : "Select a seat to confirm")}</button>
            <button onClick={() => go("manage")} className="w-full mt-2 rounded-full bg-surface py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors" style={{ border: "1px solid #E8E8E5" }}>Keep current seat</button>
          </Card>
          <div className="rounded-2xl p-4" style={{ background: "#F2FCD9", border: "1px solid #2E7D33" }}>
            <div className="text-[12px] font-bold mb-2">After confirming</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              {["New BP issued in 5s", "Old BP invalidated", "Wallet & email updated", "Gate updates continue"].map(t => (
                <div key={t} className="flex items-center gap-1.5"><span className="font-bold shrink-0" style={{ color: "#2E7D33" }}>✓</span> {t}</div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ C2 · REBOOK ON DISRUPTION ═══════════ */
// C5 · Disruption center — a disrupted multi-passenger booking where each traveller
// can independently rebook, take a full refund, or take a travel voucher (+20% bonus),
// followed by proactive multi-channel comms (push · SMS · email).
export function DisruptionCenter({ shared, go }) {
  const [rows, setRows] = useState(null);
  const [dis, setDis] = useState({ recovery: null, loading: true });
  const [res, setRes] = useState({});
  const [rebookFlight, setRebookFlight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { api.get("/bookings").then(setRows).catch(() => setRows([])); }, []);
  const booking = useMemo(() => {
    const list = rows || [];
    return list.find(b => (b.status === "confirmed" || b.status === "rebooked") && (b.meta?.passengers?.length > 1))
      || list.find(b => b.status === "confirmed") || list[0];
  }, [rows]);
  useEffect(() => {
    if (!booking) return;
    api.post("/disrupt", { flight_no: booking.flight_no, flight_date: booking.flight_date }).then(r => setDis({ recovery: r.recovery, loading: false })).catch(() => setDis({ recovery: null, loading: false }));
  }, [booking?.flight_no]);
  const pax = booking?.meta?.passengers || [];
  useEffect(() => { if (pax.length && !Object.keys(res).length) { const d = {}; pax.forEach((_, i) => d[i] = "rebook"); setRes(d); } }, [pax.length]); // eslint-disable-line
  const alts = (dis.recovery?.options || []).filter(o => o.id !== booking?.flight_no && !/^keep/i.test(o.label || ""));
  useEffect(() => { if (alts.length && !rebookFlight) setRebookFlight(alts[0].id); }, [dis]); // eslint-disable-line
  if (rows === null || dis.loading) return <Loading label="Checking your group's flight status…" />;
  if (!booking) return <Empty go={go} title="Nothing to resolve" msg="No active booking found." />;
  const flight = booking.flight || {};
  // Disruptions are now triggered only by the operator (Admin Console). If none is active on
  // this flight, the traveller sees an all-clear rather than a self-triggered disruption.
  if (!dis.recovery) return <Empty go={go} title="No active disruptions" msg={`${booking.flight_no}${flight.origin ? ` (${flight.origin}→${flight.dest})` : ""} is on schedule. If your flight is delayed or cancelled, your personalized rebooking options appear here automatically.`} />;
  const farePer = Math.round(flight.price || 189);
  const voucherAmt = Math.round(farePer * 1.2);
  const anyRebook = pax.some((_, i) => (res[i] || "rebook") === "rebook");
  const cityO = cityOf(shared.airports, flight.origin), cityD = cityOf(shared.airports, flight.dest);
  const apply = async () => {
    setBusy(true);
    const resolutions = pax.map((_, i) => ({ paxIndex: i, type: res[i] || "rebook", ...(((res[i] || "rebook") === "rebook") ? { flight_no: rebookFlight } : {}) }));
    const r = await api.post("/bookings/disruption-resolve", { pnr: booking.pnr, resolutions }).catch(() => ({ ok: false }));
    setBusy(false);
    if (r.ok) { setDone(r); notifyBookingChanged(); window.scrollTo({ top: 0 }); }
  };

  if (done) {
    const ICON = { rebook: "plane", refund: "refresh", voucher: "spark" };
    return (
      <div className="mx-auto max-w-content px-6 py-8">
        <SuccessHead title="Everyone's sorted" sub={`PNR ${booking.pnr} · each traveller resolved individually`} />
        <Card className="p-5 mt-6 v2-in">
          <div className="text-[13px] font-bold mb-3">Per-passenger resolution</div>
          <div className="space-y-2.5">
            {done.summary.map((s, i) => (
              <div key={i} className="flex items-start justify-between gap-3 border border-line rounded-xl px-3.5 py-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className={cx("w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0", s.type === "refund" ? "bg-[#fff4d6] text-[#9a6b00]" : s.type === "voucher" ? "bg-lime-tint text-tap-greenDeep" : "bg-surface-mute text-ink")}><Icon name={ICON[s.type]} size={15} /></span>
                  <div className="min-w-0"><div className="text-[13px] font-semibold">{s.name}</div><div className="text-[11px] text-ink-faint">{s.note}{s.code ? ` · ${s.code}` : ""}{s.flight_no ? ` · ${s.flight_no}` : ""}</div></div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">{s.type}</div>
                  {s.amount ? <div className="text-[14px] font-black v2-num">{s.type === "refund" ? "−" : "+"}{eur2(s.amount)}</div> : <div className="text-[12px] font-semibold text-tap-greenDeep">Rebooked</div>}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5 mt-4">
          <div className="flex items-center gap-2"><Icon name="send" size={14} className="text-tap-green" /><div className="text-[13px] font-bold">Proactive notifications sent</div></div>
          <div className="text-[12px] text-ink-muted mt-1">{done.comms}.</div>
          <div className="flex flex-wrap gap-2 mt-3">
            {(done.channels || []).map(c => <span key={c} className="inline-flex items-center gap-1.5 rounded-full bg-lime-tint text-tap-greenDeep px-3 py-1 text-[11px] font-bold uppercase tracking-wide"><Icon name="check" size={11} /> {c}</span>)}
          </div>
        </Card>
        <div className="flex gap-3 mt-5"><Btn onClick={() => go("manage")}>Back to booking</Btn><Btn variant="outline" onClick={() => go("trips")}>My trips</Btn></div>
      </div>
    );
  }

  const OPTS = [
    { k: "rebook", label: "Rebook", sub: "Next available flight", amt: null },
    { k: "refund", label: "Refund", sub: "Back to original card", amt: -farePer },
    { k: "voucher", label: "Voucher", sub: "+20% travel credit", amt: voucherAmt },
  ];
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: booking.pnr, page: "manage" }, { label: "Disruption" }]} />
      <h1 className="text-[28px] font-black">Your flight was disrupted</h1>
      <p className="text-[13px] text-ink-muted mt-1">{dis.recovery?.message || `Flight ${booking.flight_no} is affected.`} Choose how each traveller in this booking would like to be handled — they don't all have to do the same thing.</p>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div className="space-y-5">
          <div className="rounded-2xl border border-tap-red/30 p-5" style={{ background: "#fff1f1" }}>
            <span className="inline-block text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded-md px-2.5 py-1 mb-3">Disrupted</span>
            <div className="flex flex-wrap items-center gap-4 line-through decoration-ink/30 decoration-1">
              <div><div className="text-[24px] font-black v2-num">{flight.dep || "—"}</div><div className="text-[11px] text-ink-faint no-underline">{cityO}</div></div>
              <div className="flex-1 min-w-[150px] text-center text-[11px] text-ink-muted">{flight.duration || ""} · nonstop<div className="h-px bg-ink/25 my-1.5" /><div className="font-bold text-ink/70">{fmtDate(booking.flight_date)} · {booking.flight_no} · {flight.aircraft}</div></div>
              <div className="text-right"><div className="text-[24px] font-black v2-num">{flight.arr || "—"}</div><div className="text-[11px] text-ink-faint no-underline">{cityD}</div></div>
            </div>
          </div>

          <div>
            <div className="text-[13px] font-bold mb-2">Resolve per traveller ({pax.length})</div>
            <div className="space-y-3">
              {pax.map((p, i) => (
                <Card key={i} className="p-4">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <div className="text-[14px] font-bold">{p.first} {p.last || ""}</div>
                    <div className="text-[11px] text-ink-faint">Fare paid {eur2(farePer)}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {OPTS.map(o => {
                      const on = (res[i] || "rebook") === o.k;
                      return (
                        <button key={o.k} onClick={() => setRes(r => ({ ...r, [i]: o.k }))} className={cx("rounded-xl border p-2.5 text-left transition-colors", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                          <div className="text-[12px] font-bold flex items-center gap-1">{o.label}{on && <Icon name="check" size={12} className="text-tap-green" />}</div>
                          <div className="text-[10px] text-ink-faint mt-0.5">{o.sub}</div>
                          <div className={cx("text-[12px] font-black v2-num mt-1", o.k === "refund" ? "text-[#9a6b00]" : o.k === "voucher" ? "text-tap-greenDeep" : "text-ink")}>{o.amt == null ? "No charge" : (o.amt < 0 ? "−" : "+") + eur2(Math.abs(o.amt))}</div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              ))}
            </div>
          </div>

          {anyRebook && alts.length > 0 && (
            <Card className="p-4">
              <div className="text-[13px] font-bold mb-2">Rebooked travellers move to</div>
              <div className="space-y-2">
                {alts.slice(0, 3).map(o => (
                  <button key={o.id} onClick={() => setRebookFlight(o.id)} className={cx("w-full flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors", rebookFlight === o.id ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green" : "border-line")}>
                    <div><div className="text-[13px] font-semibold">{o.label}</div><div className="text-[11px] text-ink-faint">{o.sub || o.detail || "Next available"}</div></div>
                    {rebookFlight === o.id && <Icon name="check" size={16} className="text-tap-green" />}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 space-y-3">
          <Card className="p-5">
            <div className="text-[13px] font-bold mb-3">Summary</div>
            <div className="space-y-1.5 text-[12px]">
              {["rebook", "refund", "voucher"].map(t => {
                const n = pax.filter((_, i) => (res[i] || "rebook") === t).length;
                if (!n) return null;
                return <div key={t} className="flex justify-between"><span className="text-ink-muted capitalize">{t} × {n}</span><span className="font-semibold">{t === "rebook" ? "no charge" : t === "refund" ? "−" + eur2(farePer * n) : "+" + eur2(voucherAmt * n)}</span></div>;
              })}
            </div>
            <Divider className="my-3" />
            <div className="rounded-xl bg-surface-soft p-2.5 text-[11px] text-ink-muted flex items-start gap-1.5"><Icon name="send" size={12} className="text-tap-green mt-0.5 shrink-0" /> We'll proactively confirm each outcome by push, SMS and email.</div>
            <Btn className="w-full mt-3" disabled={busy || (anyRebook && !rebookFlight)} onClick={apply}>{busy ? "Applying…" : "Confirm resolutions"}</Btn>
          </Card>
        </aside>
      </div>
    </div>
  );
}

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
    const opt = [...shownAlts, ...(keep ? [keep] : [])].find(o => o.id === sel) || shownAlts[0];   // #40 — keep is selectable too
    setBusy(true);
    const r = await api.post("/rebook", { option: { id: opt.id } }).catch(() => ({ ok: false }));
    setBusy(false); setDone({ id: opt.id, label: opt.label, email: r?.email?.to }); window.scrollTo({ top: 0 });
  };
  if (done) {
    // C2 · reassociate purchased ancillaries onto the new itinerary, with per-item status.
    const raw = [...new Set(active?.items || [])];
    const reassoc = [{ label: `Seat ${active?.seat || "—"}`, status: "retained", note: "Reassigned to the equivalent seat on the new flight — no charge." }];
    raw.filter(c => c !== "seat").forEach(c => {
      if (/nsf|window|seat-/i.test(c)) reassoc.push({ label: extraLabel(c), status: "repriced", note: "Seat product re-priced for the new aircraft.", delta: 6 });
      else reassoc.push({ label: extraLabel(c), status: "retained", note: "Carried to the new flight." });
    });
    const repriceTotal = reassoc.reduce((s, r) => s + (r.delta || 0), 0);
    return (
      <div className="mx-auto max-w-content px-6 py-8">
        <SuccessHead title="You're rebooked" sub={`PNR ${active?.pnr || ""}${done.email ? " · confirmation sent to " + done.email : ""}`} />
        <Card className="p-5 mt-6 v2-in">
          <div className="text-[14px] font-bold">{done.label}</div>
          <div className="text-[12px] text-ink-muted mt-1">Your booking now shows flight {done.id}.</div>
          <div className="flex flex-wrap gap-2 mt-3"><Pill tone="green">Rebooked</Pill><Pill tone="slate">Flight {done.id}</Pill>{repriceTotal > 0 ? <Pill tone="gold">Ancillary re-price +{eur2(repriceTotal)}</Pill> : <Pill tone="lime">No fare difference</Pill>}</div>
        </Card>
        <Card className="p-5 mt-4">
          <div className="font-bold text-[15px] mb-1">Your extras on the new flight</div>
          <div className="text-[12px] text-ink-muted mb-3">We automatically moved your purchased ancillaries to the new itinerary.</div>
          <div className="space-y-2">
            {reassoc.map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-3 border border-line rounded-xl px-3.5 py-2.5">
                <div className="min-w-0"><div className="text-[13px] font-semibold">{r.label}</div><div className="text-[11px] text-ink-faint">{r.note}</div></div>
                <span className={cx("shrink-0 text-[10px] font-bold uppercase tracking-wide rounded-full px-2 py-1", r.status === "retained" ? "bg-lime-tint text-tap-greenDeep" : r.status === "repriced" ? "bg-[#fff4d6] text-[#9a6b00]" : "bg-tap-red/10 text-tap-red")}>{r.status === "retained" ? "Retained" : r.status === "repriced" ? `Re-priced +${eur2(r.delta)}` : "Refunded"}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded-xl bg-lime-tint/50 border border-tap-green/30 px-3 py-2 flex items-center gap-2 text-[12px] text-tap-greenDark"><Icon name="check" size={14} className="text-tap-green shrink-0" /> {repriceTotal > 0 ? `A small re-price of ${eur2(repriceTotal)} was applied to your card.` : "Everything transferred with no price change."} Anything that can't move is refunded to your original payment.</div>
        </Card>
        <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
      </div>
    );
  }
  const cur = active?.flight || {};
  const blob = `${rec.headline || ""} ${rec.message || ""}`;
  const status = /cancel/i.test(blob) ? "Cancelled" : /delay/i.test(blob) ? "Delayed" : "Schedule change";
  const cityO = cityOf(shared.airports, cur.origin), cityD = cityOf(shared.airports, cur.dest);
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${active?.pnr || "Booking"}${curFlight ? " — " + curFlight : ""}`, page: "manage" }, { label: "Change flight", page: "manage" }, { label: "Review & rebook" }]} />
      <h1 className="text-[28px] font-black">Rebook your flight</h1>
      <p className="text-[13px] text-ink-muted mt-1">{rec.message}</p>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 mt-6 items-start">
        <div className="space-y-5">
          {/* Disruption card — struck flight in a tinted container (#3) */}
          <div className="rounded-2xl border border-tap-red/30 p-5" style={{ background: "#fff1f1" }}>
            <span className="inline-block text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded-md px-2.5 py-1 mb-3">{status}</span>
            <div className="flex flex-wrap items-center gap-4 line-through decoration-ink/30 decoration-1">
              <div><div className="text-[24px] font-black v2-num">{cur.dep || "—"}</div><div className="text-[11px] text-ink-faint no-underline">{cityO} · Terminal 1</div></div>
              <div className="flex-1 min-w-[160px] text-center text-[11px] text-ink-muted">{cur.duration || ""} · nonstop<div className="h-px bg-ink/25 my-1.5" /><div className="font-bold text-ink/70">{fmtDate(active?.flight_date)} · {curFlight} · {cur.aircraft}</div><div className="mt-0.5">Seat {active?.seat || "—"} · Gate info 90 min before</div></div>
              <div className="text-right"><div className="text-[24px] font-black v2-num">{cur.arr || "—"}</div><div className="text-[11px] text-ink-faint no-underline">{cityD} · Terminal 1</div></div>
            </div>
          </div>

          {/* Rebooking options — structured flight cards (#4) */}
          <div>
            <div className="text-[13px] font-bold mb-2">Select options:</div>
            <div className="space-y-3">
              {shownAlts.map((o, idx) => {
                const on = sel === o.id; const hasTimes = o.dep && o.arr;
                return (
                  <button key={o.id} onClick={() => setSel(o.id)} className="w-full text-left">
                    <Card className={cx("p-4 transition-colors", on ? "ring-2 ring-tap-green" : "hover:border-tap-green/40")}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green bg-tap-green" : "border-line-strong")}>{on && <span className="w-1.5 h-1.5 bg-white rounded-full" />}</span>
                        <span className="text-tap-green font-black text-[13px]">TAP</span><span className="text-[12px] font-semibold v2-num">{o.id}</span>
                        <span className="text-[11px] text-ink-muted">· {o.detail || o.label}</span>
                        {idx === 0 && <span className="text-[9px] font-bold uppercase tracking-wide bg-tap-greenDeep text-white rounded-full px-2 py-0.5">Best</span>}
                        <span className="ml-auto text-[13px] font-bold text-tap-greenDeep">+€0</span>
                      </div>
                      {hasTimes && (
                        <div className="flex items-center gap-3 mt-3 pl-6">
                          <div><div className="text-[18px] font-bold v2-num">{o.dep}</div><div className="text-[10px] text-ink-faint">{cityO}</div></div>
                          <div className="flex-1 text-center text-[10px] text-ink-muted">{o.duration || cur.duration} · nonstop<div className="h-px bg-line-strong my-1" /><div className="font-semibold">{o.aircraft || cur.aircraft}</div></div>
                          <div className="text-right"><div className="text-[18px] font-bold v2-num">{o.arr}</div><div className="text-[10px] text-ink-faint">{cityD}</div></div>
                        </div>
                      )}
                    </Card>
                  </button>
                );
              })}
              {keep && (() => {
                const on = sel === keep.id;
                return (
                  <button key={keep.id} onClick={() => setSel(keep.id)} className="w-full text-left">
                    <Card className={cx("p-4 transition-colors", on ? "ring-2 ring-tap-green" : "opacity-90 hover:border-tap-green/40")}>
                      <div className="flex items-center gap-3">
                        <span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green bg-tap-green" : "border-line-strong")}>{on && <span className="w-1.5 h-1.5 bg-white rounded-full" />}</span>
                        <div><div className="font-bold text-[14px]">{keep.label}</div><div className="text-[12px] text-ink-muted mt-0.5">{keep.detail}</div></div>
                        <span className="ml-auto text-[10px] font-bold uppercase tracking-wide bg-surface-mute text-ink-muted rounded px-2 py-0.5 shrink-0">No change</span>
                      </div>
                    </Card>
                  </button>
                );
              })()}
            </div>
          </div>

          {/* Reassociate extras to new flight (#5) */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-2"><div className="font-bold text-[15px]">Reassociate extras to new flight</div><button className="text-[12px] font-semibold text-tap-greenDeep hover:underline underline-offset-2">View Detail</button></div>
            <div className="divide-y divide-line">
              {[
                ["seat", `Seats ${active?.seat || "22A"} · 22B · 22C`, `Available on ${sel || curFlight} — auto-assign equiv row`, "Transferred"],
                ["bag", "Hot meal × 3", `${sel || curFlight} catering not loaded — refunded €42`, "Refunded"],
                ["bag", "Carry-on × 3", "Auto-transferred", "Transferred"],
                ["star", "1 240 status miles", "Recredited at original tier", "Transferred"],
              ].map(([ic, nm, sub, st], n) => (
                <div key={n} className="flex items-center gap-3 py-2.5">
                  <Icon name={ic} size={16} className="text-ink-faint shrink-0" />
                  <div className="flex-1"><div className="text-[13px] font-semibold">{nm}</div><div className="text-[11px] text-ink-faint">{sub}</div></div>
                  <span className={cx("text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 text-white shrink-0", st === "Refunded" ? "bg-[#d97706]" : "bg-tap-greenDeep")}>{st}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Sticky cost-impact summary panel (#6) */}
        <aside className="lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="font-bold text-[16px] mb-3">Cost impact</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">{sel || curFlight} fare diff</span><span className="font-semibold v2-num">€0,00</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Meal refund</span><span className="font-semibold v2-num text-tap-greenDeep">−€42,00</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Goodwill voucher</span><span className="font-semibold v2-num text-tap-greenDeep">€50,00</span></div>
            </div>
            <Divider className="my-3" />
            <div className="flex justify-between items-center"><span className="font-bold">Net to passenger</span><span className="font-black v2-num text-tap-greenDeep text-[16px]">+€92,00</span></div>
            <Btn size="lg" className="w-full mt-4" disabled={busy || !shownAlts.length} onClick={confirm}>{busy ? "Rebooking…" : `Confirm rebook ${sel || ""} →`}</Btn>
            <button onClick={() => go("results", { origin: cur.origin, dest: cur.dest })} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors">Find more options</button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ J3 · ONLINE CHECK-IN ═══════════ */
const CHECKIN_PAX = [
  { id: "carlos", avatar: "P", name: "Pinto, Carlos", type: "Adult", doc: "Passport PT2438211", verified: true, seat: "22A · Window", on: true },
  { id: "sofia", avatar: "P", name: "Pinto, Sofia", type: "Adult", doc: "Passport PT2438217", verified: true, seat: "22B · Middle", on: true },
  { id: "tomas", avatar: "T", name: "Tomás Silva (CHD 8)", type: "Child", doc: "PT Cédula · 999111 · DOB 2017", verified: false, seat: "22C · Middle", needsDocs: true, on: false },
];
/* UI-5/UI-6 — seat position derivation + adjacent-seat allocation + distinct per-passenger passports */
const CI_SEAT_POS = { A: "Window", B: "Middle", C: "Aisle", D: "Aisle", E: "Middle", F: "Window" };
const ciSeatLabel = (s) => { const m = String(s || "").match(/^(\d+)\s*([A-Fa-f])/); if (!m) return s || "—"; const L = m[2].toUpperCase(); const pos = CI_SEAT_POS[L]; return `${m[1]}${L}${pos ? " · " + pos : ""}`; };
const ciAdjSeat = (base, n) => { const m = String(base || "22A").match(/^(\d+)\s*([A-Fa-f])/); if (!m) return base || "—"; const letters = ["A", "B", "C", "D", "E", "F"]; const start = Math.max(0, letters.indexOf(m[2].toUpperCase())); return `${m[1]}${letters[Math.min(start + n, 5)]}`; };
const ciPaxDoc = (p, i, baseDoc) => {
  if (p.doc || p.passport) return p.doc || p.passport;
  if (/child|chd|infant/i.test(p.type || "")) return "ID document pending";
  if (i === 0 && baseDoc) return "Passport " + baseDoc;                // lead keeps the profile passport
  const seed = String(p.first || p.last || p.name || ("P" + i)).toUpperCase().split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return "Passport PT" + (2438200 + (seed * 7 + i * 131) % 9000);      // co-passengers get a distinct, deterministic number
};
export function CheckInIndirect({ shared, go, params }) {
  const { booking, loading, err } = useActiveBooking(params?.pnr);
  const [doc, setDoc] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [picks, setPicks] = useState({});   // #37 — keyed by real passenger id; default handled via isOn()
  const u = shared.profile?.user || {};
  if (loading) return <Loading label="Loading check-in…" />;
  if (err || !booking) return <Empty go={go} title="Nothing to check in" msg="Online check-in opens 24 hours before departure." />;
  // #37 — passengers come from the booking/PNR (meta.passengers when a party was booked), otherwise the
  // single profile traveller. Seat, name and document all follow the actual booking record.
  const meta = booking.meta || {};
  const bookedSeat = booking.seat || "—";
  const bookedPax = (Array.isArray(meta.passengers) && meta.passengers.length)
    ? meta.passengers.map((p, i) => {
        const first = p.first || p.firstName || "", last = p.last || p.lastName || "";
        const nm = (last && first) ? `${last}, ${first}` : (p.name || `${first} ${last}`.trim() || `Passenger ${i + 1}`);
        const child = /child|chd|infant/i.test(p.type || "");
        const seatCode = i === 0 ? bookedSeat : (p.seat || ciAdjSeat(bookedSeat, i));   // UI-5 — co-passengers get an adjacent seat
        return { id: "p" + i, avatar: (last || first || "P")[0].toUpperCase(), name: nm, type: child ? "Child" : "Adult", doc: ciPaxDoc(p, i, u.doc_id), verified: !child, seat: ciSeatLabel(seatCode), needsDocs: child && !p.doc, on: true };
      })
    : Array.from({ length: Math.max(1, Number(meta.pax) || 1) }, (_, i) => (i === 0
        ? { id: "self", avatar: (u.first_name || "D")[0].toUpperCase(), name: u.full_name ? `${u.full_name.split(" ").slice(-1)[0]}, ${u.first_name || u.full_name.split(" ")[0]}` : "Ferreira, Daniel", type: "Adult", doc: u.doc_id ? "Passport " + u.doc_id : "Passport", verified: true, seat: ciSeatLabel(bookedSeat), on: true }
        : { id: "p" + i, avatar: "P", name: `Passenger ${i + 1}`, type: "Adult", doc: "Passport", verified: true, seat: ciSeatLabel(ciAdjSeat(bookedSeat, i)), on: true }));
  const isOn = (p) => picks[p.id] ?? p.on;
  const checkin = async () => {
    setBusy(true);
    const r = await api.post("/bookings/checkin", { doc_id: doc || null }).catch(() => ({ ok: false, state: "error" }));
    setBusy(false); setRes(r); window.scrollTo({ top: 0 });
  };
  if (res && res.ok) {
    const already = res.state === "already_checked_in";
    const passes = bookedPax.filter(isOn).length ? bookedPax.filter(isOn) : bookedPax;
    const bpText = `TAP AIR PORTUGAL — BOARDING PASS\nPNR: ${res.pnr}\nPassenger: ${u.first_name || ""}\nRoute: ${res.route}\nSeat: ${res.seat} · Group ${res.group}\nDate: ${fmtDate(res.date)}\n\nGate closes 20 minutes before departure.`;
    return (
      <div className="mx-auto max-w-content px-6 py-8">
        <SuccessHead title={already ? "Already checked in" : "Checked in"} sub={`PNR ${res.pnr} · boarding pass ready`} />
        {passes.map((p, bi) => (
        <Card key={p.id} className="p-0 mt-4 overflow-hidden v2-in">
          <div className="bg-surface-dark text-white p-5 flex items-center justify-between">
            <div><div className="text-[10px] uppercase tracking-widest text-white/50">Boarding pass{passes.length > 1 ? ` · ${bi + 1} of ${passes.length}` : ""}</div><div className="text-[20px] font-black mt-1">{res.route}</div></div>
            <div className="text-right"><div className="text-[10px] uppercase tracking-widest text-white/50">Group</div><div className="text-[28px] font-black text-lime">{res.group}</div></div>
          </div>
          <div className="p-5 grid grid-cols-3 gap-4 text-center">
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Passenger</div><div className="font-bold text-[14px] mt-0.5">{p.name}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Seat</div><div className="font-bold text-[14px] mt-0.5 v2-num">{p.seat || res.seat}</div></div>
            <div><div className="text-[10px] uppercase tracking-wide text-ink-faint">Date</div><div className="font-bold text-[14px] mt-0.5">{fmtDate(res.date)}</div></div>
          </div>
          <div className="px-5 pb-5"><div className="rounded-lg bg-lime-tint text-tap-greenDark px-3 py-2.5 text-[12px] flex items-center gap-1.5"><Icon name="info" size={13} className="shrink-0" /> Gate closes 20 minutes before departure. Have your ID ready.</div></div>
        </Card>
        ))}
        <div className="flex flex-wrap gap-5 mt-5 text-[13px] font-semibold text-tap-greenDeep"><button onClick={() => downloadFile(`boarding-pass-${res.pnr}.txt`, bpText)}>Add to Wallet</button><button onClick={() => downloadFile(`boarding-pass-${res.pnr}.txt`, bpText)}>Download boarding pass</button></div>
        <div className="mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn></div>
      </div>
    );
  }
  const selCount = bookedPax.filter(isOn).length;
  const total = bookedPax.length;
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${booking.pnr}${booking.flight_no ? " — " + booking.flight_no : ""}`, page: "manage" }, { label: "Online check-in" }]} />
      <h1 className="text-[26px] font-black">Check in for your flight</h1>
      <p className="text-[13px] text-ink-muted mt-1 flex items-center gap-1.5 flex-wrap"><Icon name="check" size={13} className="text-tap-green" /> Open · {booking.flight_no || "TP1042"} {cityOf(shared.airports, booking.flight?.origin)}–{cityOf(shared.airports, booking.flight?.dest)} · {fmtDate(booking.flight_date)} · Booked via Booking.com agency</p>

      <div className="grid lg:grid-cols-[1fr_422px] gap-8 mt-6 items-start">
        <div className="space-y-4">
          {/* Passenger cards (#4) */}
          {bookedPax.map(p => (
            <Card key={p.id} style={{ padding: "18px", borderRadius: "12px", borderColor: "#E0E3E8" }}>
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-full bg-lime-tint inline-flex items-center justify-center text-[20px] font-bold shrink-0" style={{ color: "#2E7D33" }}>{p.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[17px] leading-[22px]" style={{ color: "#1A1F29" }}>{p.name}</div>
                  <div className="text-[11px] text-ink-faint mt-0.5">{p.type} · {p.doc} {p.verified && <Icon name="check" size={11} className="inline text-tap-green" />}</div>
                  <div className="text-[12px] font-semibold mt-1">Seat: {p.seat}</div>
                </div>
                <div className="text-right shrink-0 flex items-center gap-2">
                  <button onClick={() => go("seatchange")} className="text-[12px] font-bold text-tap-greenDeep hover:underline">Change seat</button>
                  {p.needsDocs && <span className="text-[9px] font-bold uppercase tracking-wide bg-[#d97706] text-white rounded-full px-2 py-0.5">Needs docs</span>}
                </div>
              </div>
              {p.needsDocs
                ? <div className="mt-3 rounded-lg border border-tap-green/20 px-3 py-2.5 flex items-center justify-between gap-2" style={{ background: "#f2ffdb88" }}><div className="text-[12px]"><div className="font-semibold">Travel-with-minor docs required</div><div className="text-[11px] text-ink-faint">Upload parental authorisation (PDF / image) — required by SEF before boarding</div></div><Btn size="sm" className="shrink-0">Upload PDF</Btn></div>
                : <label className="flex items-center gap-2 mt-3 text-[12px] font-semibold cursor-pointer" onClick={e => { e.preventDefault(); setPicks(s => ({ ...s, [p.id]: !(s[p.id] ?? p.on) })); }}><span className="inline-flex items-center justify-center shrink-0" style={{ width: "20px", height: "20px", borderRadius: "5px", background: isOn(p) ? "#D4F25E" : "#FFFFFF", border: isOn(p) ? "none" : "1px solid #DCDCD8" }}>{isOn(p) && <Icon name="check" size={13} className="stroke-[3]" style={{ color: "#1A1F29" }} />}</span> Check in this passenger</label>}
            </Card>
          ))}

          {/* Travel documents (APIS) (#5) */}
          <div className="p-[18px]" style={{ borderRadius: "12px", border: "1px solid #C7F21F", background: "#F2FCD9" }}>
            <div className="font-bold text-[14px] mb-2">Travel documents (APIS)</div>
            <div className="text-[12px] flex items-start gap-1.5"><Icon name="check" size={13} className="text-tap-green mt-0.5 shrink-0" /> Passport PT2438211 · expires 2029-08-12 · all pax verified</div>
            <div className="text-[12px] text-[#b45309] font-semibold flex items-start gap-1.5 mt-1.5"><Icon name="info" size={13} className="mt-0.5 shrink-0" /> US ESTA pending — required for stopover OPO → re-check before boarding</div>
            <button className="hover:underline mt-2" style={{ color: "#E00A0A", fontSize: "13px", fontWeight: 700 }}>Update documents →</button>
          </div>
        </div>

        {/* Sticky check-in summary panel (#6) */}
        <aside className="lg:sticky lg:top-6">
          <Card style={{ padding: "24px", borderRadius: "18px", borderColor: "#E8E8E5" }}>
            <div className="text-[20px] mb-3" style={{ fontWeight: 600, letterSpacing: "-0.01em", color: "#0A0A0A" }}>Check-in summary</div>
            <div className="space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Flight</span><span className="font-bold text-right">{booking.flight_no || "TP 73"} · {fmtDate(booking.flight_date)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Passengers</span><span className="font-bold">{selCount} of {total} selected</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Seats</span><span className="font-bold v2-num">22A · 22B (together)</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Bag</span><span className="font-bold">1 × 23kg (included)</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Boarding</span><span className="font-bold v2-num">16:00 · Gate B12</span></div>
            </div>
            <div className="h-px w-full mt-3" style={{ background: "#E0E3E8" }} />
            <div className="mt-3 text-[12px]" style={{ padding: "14px 18px", borderRadius: "12px", border: "1px solid #C7F21F", background: "#F2FCD9" }}><div className="font-bold">Add to your trip</div><div className="text-ink-muted mt-0.5">+ Extra bag €38 · + Lounge access €42</div><div className="text-[11px] text-ink-faint mt-0.5">Restricted by fare rule: cabin upgrade</div></div>
            <Btn size="lg" className="w-full mt-4" style={{ height: "42px", borderRadius: "9999px", fontSize: "15px", fontWeight: 700 }} disabled={busy} onClick={checkin}>{busy ? "Checking in…" : "Upload & check in all →"}</Btn>
            <button onClick={checkin} disabled={busy} className="w-full mt-2 bg-surface text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors inline-flex items-center justify-center" style={{ height: "42px", borderRadius: "9999px", border: "1px solid #E8E8E5" }}>Check in {selCount} of {total} now (resolve Tomás later)</button>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ J4 · ADD EXTRAS ═══════════ */
export function AddExtras({ shared, go, params }) {
  const { all, loading, err } = useActiveBooking();
  const u = shared.profile?.user || {};
  const airports = shared.airports;
  const [anc, setAnc] = useState(null);
  const [step, setStep] = useState("pick");      // pick → extras → pay → done
  const [sel, setSel] = useState(null);          // chosen booking
  const [staged, setStaged] = useState([]);      // [{code,name,price}] — committed only at pay
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [enhanceCat, setEnhanceCat] = useState("all");   // #3 — Enhance-your-trip category filter
  // #8 — when arriving from a specific flight card ("Add extras"/"Update flight"),
  // the flight is already chosen. Deep-link via ?pnr= so we skip the trip-picker and
  // open extras for that booking directly. The ?intent= ("update") just tunes copy.
  const deepPnr = params?.pnr || null;
  const intent = params?.intent || null;
  useEffect(() => { api.get("/ancillaries").then(setAnc).catch(() => setAnc([])); }, []);
  // #8 — deep-link: when a pnr is passed (from a My Trip flight card), pre-select that
  // booking and skip straight to the extras step, so the user isn't asked to pick a trip
  // they already chose. Falls back to the picker if the pnr doesn't match.
  useEffect(() => {
    if (!deepPnr || !all) return;
    const match = all.find(b => b.pnr === deepPnr && b.status === "confirmed");
    if (match) { setSel(match); setStaged([]); setStep("extras"); }
  }, [deepPnr, all]);
  // Home "Worth your while" → Add: pre-stage the recommended extra and open the soonest
  // upcoming trip's extras step, so the Add button lands on a ready-to-review item.
  useEffect(() => {
    if (!params?.add || !all) return;
    const up = all.filter(b => b.status === "confirmed" && (b.days_to_go ?? 0) >= 0).sort((a, b) => String(a.flight_date).localeCompare(String(b.flight_date)));
    if (!up.length) return;
    setStaged(s => s.some(x => x.code === params.add) ? s : [...s, { code: params.add, name: params.addName || "Extra", price: +params.addPrice || 0 }]);
    if (!deepPnr) { setSel(up[0]); setStep("extras"); }
  }, [params?.add, all]); // eslint-disable-line
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
    notifyBookingChanged();   // #38 — purchased extras must appear on the booking / My Trip
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
                  <div className="text-[12px] text-ink-muted mt-3">{fmtDate(b.flight_date)} · {f.flight_no || b.flight_no} · Seat {b.seat || "—"}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(() => { const xs = (b.items || []).filter(c => c !== "seat"); return <>
                      {xs.slice(0, 8).map((c, i) => <Pill key={i} tone="slate">{extraLabel(c)}</Pill>)}
                      {xs.length > 8 && <Pill tone="slate">+{xs.length - 8} more</Pill>}
                    </>; })()}
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
        <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to my trip →</Btn><Btn variant="outline" onClick={() => { setStaged([]); setStep("pick"); setResult(null); }}>Add to another trip</Btn></div>
      </div>
    );
  }

  /* ── STEP 2 · add extras to the chosen trip ───────────────────── */
  const f = sel?.flight || {};
  const routeLabel = `${f.origin || sel?.origin || "—"} → ${f.dest || sel?.dest || "—"}`;
  // #2 — group the flat ancillary list into 3 bundles. We pick representative items by
  // icon/keyword so the bundles stay meaningful even as the catalog changes, and fall
  // back gracefully when a category is absent.
  const byKind = (kw) => anc.filter(a => {
    const s = `${a.code} ${a.name} ${a.icon}`.toLowerCase();
    return kw.some(k => s.includes(k));
  });
  const seatItems = byKind(["seat"]);
  const bagItems = byKind(["bag", "luggage", "baggage"]);
  const mealItems = byKind(["meal", "food", "cater"]);
  const loungeItems = byKind(["lounge"]);
  const wifiItems = byKind(["wifi", "wi-fi", "internet"]);
  const flexItems = byKind(["flex", "refund", "change", "insur", "protect"]);
  const uniq = (arr) => { const seen = new Set(); return arr.filter(a => a && !seen.has(a.code) && seen.add(a.code)); };
  const bundleDefs = [
    { id: "comfort", name: "Comfort bundle", tag: "Most popular", desc: "Seat + bag + a hot meal — the essentials, bundled and discounted.",
      items: uniq([seatItems[0], bagItems[0], mealItems[0]]).filter(Boolean) },
    { id: "seat", name: "Just the seat", tag: "", desc: "Reserve your preferred seat — nothing else.",
      items: uniq([seatItems[0]]).filter(Boolean) },
    { id: "premium", name: "Premium bundle", tag: "Best value", desc: "Everything in Comfort, plus lounge access, Wi-Fi and flexibility.",
      items: uniq([seatItems[0], bagItems[0], mealItems[0], loungeItems[0], wifiItems[0], flexItems[0]]).filter(Boolean) },
  ].filter(b => b.items.length);
  const bundlePrice = (b) => b.items.reduce((s, a) => s + (a.price || 0), 0);
  const bundleSaving = (b) => b.id === "seat" ? 0 : Math.round(bundlePrice(b) * 0.12); // bundle discount
  const bundleNet = (b) => Math.max(0, bundlePrice(b) - bundleSaving(b));
  const bundleStaged = (b) => b.items.every(a => staged.some(x => x.code === a.code));
  const addBundle = (b) => setStaged(s => {
    const next = [...s];
    b.items.forEach(a => { if (!next.some(x => x.code === a.code) && !onBooking.has(a.code)) next.push({ code: a.code, name: a.name, price: a.price || 0 }); });
    return next;
  });
  // #3 — "Enhance your trip": the remaining à-la-carte items, filterable by category.
  const CATS = [
    { id: "all", label: "All" },
    { id: "seat", label: "Seats", match: ["seat"] },
    { id: "lounge", label: "Lounge", match: ["lounge"] },
    { id: "meal", label: "Dining", match: ["meal", "food", "cater"] },
    { id: "flex", label: "Insurance", match: ["insur", "flex", "protect", "refund"] },
  ];
  const enhanceItems = anc; // full à-la-carte catalog
  const catMatch = (a, cat) => {
    if (cat === "all") return true;
    const def = CATS.find(c => c.id === cat); if (!def?.match) return true;
    const s = `${a.code} ${a.name} ${a.icon}`.toLowerCase();
    return def.match.some(k => s.includes(k));
  };

  // Figma "My trip cart" template — group the post-booking catalogue into categorized sections,
  // each rendered as a section card with item rows (name · desc · price · Add/Remove).
  const SECTIONS = [
    { id: "seats", title: "Seats & baggage", icon: "seat", match: ["seat", "bag", "luggage", "baggage"] },
    { id: "lounge", title: "Lounge & services", icon: "star", match: ["lounge", "wifi", "wi-fi", "internet", "priority", "fast"] },
    { id: "dining", title: "Onboard & dining", icon: "bag", match: ["meal", "food", "cater", "drink", "snack"] },
    { id: "protect", title: "Protection & flexibility", icon: "shield", match: ["insur", "flex", "protect", "refund", "change"] },
  ];
  const sectionOf = (a) => (SECTIONS.find(sec => sec.match.some(k => `${a.code} ${a.name} ${a.icon}`.toLowerCase().includes(k))) || SECTIONS[0]).id;
  const sectioned = SECTIONS.map(sec => ({ ...sec, items: anc.filter(a => sectionOf(a) === sec.id) })).filter(sec => sec.items.length);
  // Enhance · cross-sell — destination-aware experiences/transfers that stage into the add-ons basket.
  const xCity = cityOf(airports, f.dest) || "your destination";
  const xSlug = String(xCity).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const xCode = f.dest || "airport";
  const XSELL = [
    [`xsell-${xSlug}-tour`, `${xCity} highlights full-day`, "Top sights · skip-the-line · guided.", 89, "per person", "Day trip", `${String(xCity).toLowerCase()},city`, null],
    [`xsell-${xSlug}-food`, `${xCity} food & flavours tour`, "Local tastings & market visit. Half day.", 65, "per person", "Food", `${String(xCity).toLowerCase()},food`, null],
    ["xsell-xfer-return", `Return transfer hotel → ${xCode}`, "Private sedan · save 10% when paired.", 25, "per car", "Transfer", "car,sedan", "Bundle −10%"],
    ["xsell-late-checkout", "Guaranteed late checkout", "Stay until 16:00 on departure day.", 40, "one-time", "Hotel add-on", "hotel,room", null],
  ];

  return (
    <div className="mx-auto max-w-page px-6 py-8">
      {/* #1 — breadcrumb now carries flight context (route) so the user always sees which flight */}
      <Crumb go={go} trail={[
        { label: "My Trip", page: "manage" },
        { label: `${sel.pnr}${sel.flight_no || f.flight_no ? " · " + (f.flight_no || sel.flight_no) : ""}`, page: "manage" },
        { label: `Add extras · ${routeLabel}` },
      ]} />
      {upcoming.length > 1 && !deepPnr && <button onClick={() => { setStaged([]); setStep("pick"); }} className="text-[12px] font-semibold text-tap-greenDeep mb-3 inline-flex items-center gap-1"><Icon name="arrow" size={12} className="rotate-180" /> Choose a different trip</button>}
      <h1 className="text-[26px] font-black">{intent === "update" ? "Update your trip" : "Upgrade your trip"}</h1>
      <p className="text-[13px] text-ink-muted mt-1">Add bags, seats, meals &amp; lounge — paid direct to TAP. Agency does not need to be involved.</p>
      <div className="mt-4"><BookingBand booking={sel} airports={airports} /></div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 mt-6 items-start">
        <div className="space-y-6">
          {/* #25 — bundle-based add-ons: 3 packages with grouped benefits, savings & a single CTA each (replaces the individual category cards). */}
          <section>
            <div className="flex items-center gap-2 mb-3"><h2 className="text-[18px] font-black">Choose a bundle</h2><span className="text-[11px] font-bold uppercase tracking-wide text-tap-greenDeep bg-lime-tint rounded-full px-2 py-0.5">Save vs à la carte</span></div>
            <div className="grid sm:grid-cols-3 gap-4 items-stretch">
              {bundleDefs.map(b => {
                const best = b.id === "comfort";
                const saving = bundleSaving(b);
                const on = bundleStaged(b);
                return (
                  <div key={b.id} className={cx("rounded-2xl border p-4 flex flex-col transition-all", best ? "border-tap-green bg-lime-tint/40 ring-1 ring-tap-green shadow-md" : "border-line bg-surface shadow-sm hover:shadow-md")}>
                    {b.tag && <span className={cx("self-start text-[9px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5 mb-2", best ? "bg-tap-greenDeep text-white" : "bg-surface-mute text-ink-muted")}>{best ? "Best value" : b.tag}</span>}
                    <div className="text-[16px] font-black">{b.name}</div>
                    <div className="flex items-baseline gap-2 mt-1">
                      <span className="text-[24px] font-black v2-num">{EUR(bundleNet(b))}</span>
                      {saving > 0 && <span className="text-[12px] font-bold text-tap-greenDeep">save {EUR(saving)}</span>}
                    </div>
                    <div className="h-px bg-line my-3" />
                    <ul className="space-y-1.5 flex-1">
                      {b.items.map(a => <li key={a.code} className="flex items-start gap-1.5 text-[12px] text-ink"><Icon name="check" size={13} className="text-tap-green mt-0.5 shrink-0" /> <span>{a.name}{a.price > 0 ? "" : " · included"}</span></li>)}
                    </ul>
                    {best
                      ? <Btn size="sm" className="w-full mt-4" disabled={on} onClick={() => addBundle(b)}>{on ? <><Icon name="check" size={13} /> Added</> : "Add bundle"}</Btn>
                      : <Btn variant="outline" size="sm" className="w-full mt-4" disabled={on} onClick={() => addBundle(b)}>{on ? <><Icon name="check" size={13} /> Added</> : "+ Add"}</Btn>}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Enhance your trip — cross-sell, image-on-top cards (matches the My-trip-cart template) */}
          <section>
            <div className="flex items-center gap-2 mb-1"><h2 className="text-[16px] font-black">Enhance your trip</h2><span className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep bg-lime-tint rounded-full px-2 py-0.5">Cross-sell</span></div>
            <p className="text-[12px] text-ink-muted mb-3">Hand-picked extras that pair well with your trip. Each adds to your basket instantly.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {XSELL.map(([code, name, sub, price, unit, badge, imgkey, accent]) => {
                const isStaged = staged.some(x => x.code === code);
                return (
                  <div key={code} className={cx("rounded-xl border overflow-hidden flex flex-col bg-surface shadow-sm transition-all", isStaged ? "border-tap-green ring-1 ring-tap-green shadow-md" : "border-line hover:border-tap-green/50 hover:shadow-md")}>
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
                        <div className="leading-tight"><span className="text-[15px] font-bold v2-num">{EUR(price)}</span> <span className="text-[10px] text-ink-faint">{unit}</span></div>
                        <Btn size="sm" variant="outline" className="shrink-0" onClick={() => isStaged ? unstage(code) : stage({ code, name, price })}>{isStaged ? "✓ Added" : "+ Add to cart"}</Btn>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Basket summary — matches the My-trip-cart right panel */}
        <aside>
          <Card className="p-5 lg:sticky lg:top-20">
            <div className="flex items-start justify-between">
              <div><h2 className="text-[16px] font-bold">My add-ons</h2><div className="text-[11px] text-ink-muted">All amounts in EUR (€)</div></div>
              <span className="text-[10px] font-bold uppercase tracking-wide bg-tap-red text-white rounded px-2 py-1">PNR {sel.pnr}</span>
            </div>
            <div className="rounded-lg bg-surface-soft px-3 py-2 mt-3">
              <div className="text-[12px] font-semibold">{cityOf(airports, f.origin)}–{cityOf(airports, f.dest)} · {fmtDate(sel.flight_date)}</div>
              <div className="text-[11px] text-ink-faint mt-0.5">{staged.length} add-on{staged.length !== 1 ? "s" : ""} in your basket</div>
            </div>
            {staged.length === 0
              ? <div className="rounded-xl border border-dashed border-line-strong px-3 py-5 text-center text-[12px] text-ink-faint mt-3">Nothing added yet.<br />Tap “+ Add” on any extra to build your trip.</div>
              : <div className="space-y-1.5 text-[13px] mt-3">{staged.map(x => <div key={x.code} className="flex items-center justify-between gap-2"><span className="text-ink-muted flex-1 truncate">{x.name}</span><span className="font-semibold v2-num">{x.price > 0 ? EUR(x.price) : "Free"}</span><button onClick={() => unstage(x.code)} className="text-ink-faint hover:text-tap-red shrink-0" aria-label={"Remove " + x.name} title="Remove"><Icon name="x" size={13} /></button></div>)}</div>}
            <Divider className="my-3" />
            <div className="flex items-center justify-between"><span className="text-[14px] font-bold">Total add-ons</span><span className="text-[22px] font-black text-tap-green v2-num">{EUR(total)}</span></div>
            {total > 0 && <div className="mt-2 rounded-lg bg-lime-tint/60 px-3 py-2 text-[12px] flex items-center justify-between"><span className="inline-flex items-center gap-1.5 font-semibold text-tap-greenDark"><Icon name="spark" size={13} /> You'll earn</span><span className="font-bold v2-num">{miles(Math.round(total * 2.77))} miles</span></div>}
            <Btn className="w-full mt-3" disabled={staged.length === 0 || busy} onClick={() => total > 0 ? setStep("pay") : commit()}>
              {staged.length === 0 ? "Add extras to continue" : total > 0 ? <>Continue · {EUR(total)} →</> : busy ? "Adding…" : "Add to booking →"}
            </Btn>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
              <span className="inline-flex items-center gap-1"><Icon name="lock" size={11} /> Secure · Stripe</span>
              <span className="inline-flex items-center gap-1"><Icon name="clock" size={11} /> Free 24h cancel</span>
              <span className="inline-flex items-center gap-1"><Icon name="star" size={11} /> 24/7 Care</span>
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ═══════════ C4 · CANCEL & REFUND ═══════════ */
const REFUND_ITEMS = [
  { id: "fl-d", name: "Outbound flight · Daniel", paid: 128, refund: 0, status: "non-refundable", kind: "fare", on: false },
  { id: "fl-m", name: "Outbound flight · Mariana", paid: 128, refund: 102.40, status: "80% policy", kind: "fare", on: true },
  { id: "meal", name: "Hot meal × 2", paid: 28, refund: 28, status: "full", kind: "extras", on: true },
  { id: "seat", name: "Seat 22A · 22B", paid: 22, refund: 22, status: "unused", kind: "extras", on: true },
  { id: "ins", name: "Travel insurance", paid: 18, refund: 0, status: "used", kind: "extras", on: false },
  { id: "tax", name: "Taxes & fees · refundable portion", paid: 42, refund: 36, status: "", kind: "taxes", on: true },
];
const REFUND_DESTS = [
  { id: "Visa", name: "Visa ••4242", sub: "3–5 working days · no fee" },
  { id: "wallet", name: "TAP wallet", sub: "Instant · +5% bonus" },
  { id: "miles", name: "TAP Miles", sub: "+8 800 miles · instant" },
  { id: "bank", name: "Bank Transfer", sub: "3–5 working days · no fee" },
];
/* ═══════════ C1 · CHANGE / SPLIT TRAVELLERS (PNR / order split) ═══════════ */
export function SplitBooking({ shared, params, go }) {
  const { all, loading, err } = useActiveBooking();
  const airports = shared?.airports || [];
  const booking = (all || []).find(b => b.pnr === params?.pnr) || pickActive(all || [], params?.pnr);
  const meta = booking?.meta || {};
  const pax = Array.isArray(meta.passengers) ? meta.passengers : [];
  const f = booking?.flight || {};
  const [picked, setPicked] = useState(() => new Set());
  const [mode, setMode] = useState("change");
  const [newDate, setNewDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  if (loading) return <Loading label="Loading your booking…" />;
  if (err || !booking) return <Empty go={go} title="Booking not found" msg={err || "We couldn't find that booking."} />;
  if (pax.length < 2) return <Empty go={go} title="Single traveller" msg="This booking has one traveller — there's nothing to split. Use Update flight or Cancel & refund instead." />;

  const nm = (p, i) => [p.title, p.first || p.firstName, p.last || p.lastName].filter(Boolean).join(" ").trim() || p.name || `Passenger ${i + 1}`;
  const toggle = (i) => setPicked(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const canSubmit = picked.size >= 1 && picked.size < pax.length;

  async function submit() {
    setBusy(true);
    try {
      const r = await api.post("/bookings/split", { pnr: booking.pnr, splitIdx: [...picked], action: mode, newDate: mode === "change" ? (newDate || null) : null });
      if (r.ok) { setResult(r); notifyBookingChanged(); } else alert(r.error || "Could not split the booking");
    } catch (e) { alert("Split error: " + e.message); } finally { setBusy(false); }
  }

  if (result) {
    const s = result.summary || {}, rec = result.original || {}, spl = result.split || {};
    const cancelled = result.action === "cancel";
    return (
      <div className="mx-auto max-w-page px-6 py-8">
        <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: "Change / split" }]} />
        <SuccessHead title="Your booking was split into two records" sub={`${rec.pnr} stays as booked · ${spl.pnr} ${cancelled ? "cancelled with refund" : "moved to a new flight"}`} />
        <div className="grid md:grid-cols-2 gap-4 mt-5">
          <Card className="p-5">
            <div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep">Record 1 · unchanged</div><Pill tone="green">{rec.pnr}</Pill></div>
            <div className="text-[16px] font-black mt-2">{cityOf(airports, rec.origin)} <span className="text-ink-faint">→</span> {cityOf(airports, rec.dest)}</div>
            <div className="text-[12px] text-ink-muted">{fmtDate(rec.date)} · {rec.flight_no} · {rec.pax} traveller{rec.pax !== 1 ? "s" : ""}</div>
            <div className="mt-2 text-[12px] text-ink flex flex-wrap gap-1.5">{rec.passengers.map((n, i) => <span key={i} className="border border-line rounded-full px-2.5 py-1 font-medium">{n}</span>)}</div>
            <div className="text-[13px] font-bold mt-3 v2-num">{eur2(rec.price)}</div>
          </Card>
          <Card className={cx("p-5", cancelled ? "border-tap-red/30" : "border-tap-green/30")}>
            <div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-wide text-tap-greenDeep">Record 2 · {cancelled ? "cancelled" : "changed"}</div><Pill tone={cancelled ? "red" : "gold"}>{spl.pnr}</Pill></div>
            <div className="text-[16px] font-black mt-2">{cityOf(airports, spl.origin)} <span className="text-ink-faint">→</span> {cityOf(airports, spl.dest)}</div>
            <div className="text-[12px] text-ink-muted">{fmtDate(spl.date)} · {spl.flight_no} · {spl.pax} traveller{spl.pax !== 1 ? "s" : ""} · <span className={cancelled ? "text-tap-red font-semibold" : "text-tap-greenDeep font-semibold"}>{cancelled ? "Cancelled" : "Confirmed"}</span></div>
            <div className="mt-2 text-[12px] text-ink flex flex-wrap gap-1.5">{spl.passengers.map((n, i) => <span key={i} className="border border-line rounded-full px-2.5 py-1 font-medium">{n}</span>)}</div>
            <div className="text-[13px] font-bold mt-3 v2-num">{cancelled ? "Refunded" : eur2(spl.price)}</div>
          </Card>
        </div>
        <Card className="p-5 mt-4">
          <div className="font-bold text-[15px] mb-3">Ancillaries &amp; fare recalculation</div>
          <div className="space-y-1.5 text-[13px]">
            <div className="flex items-center justify-between"><span className="text-ink-muted">Ancillaries carried to {spl.pnr}</span><span className="font-semibold">{(s.retained || []).length ? (s.retained || []).map(extraLabel).join(" · ") : "—"}</span></div>
            {(s.notTransferable || []).length > 0 && <div className="flex items-center justify-between"><span className="text-ink-muted">Stayed on {rec.pnr} (party item)</span><span className="font-semibold text-[#9a6b00]">{(s.notTransferable || []).map(extraLabel).join(" · ")}</span></div>}
            {!cancelled && <div className="flex items-center justify-between"><span className="text-ink-muted">Change fee</span><span className="font-semibold v2-num">{eur2(s.changeFee)}</span></div>}
            {!cancelled && s.fareDiff > 0 && <div className="flex items-center justify-between"><span className="text-ink-muted">Fare difference (new flight)</span><span className="font-semibold v2-num">+{eur2(s.fareDiff)}</span></div>}
            {cancelled && <div className="flex items-center justify-between"><span className="text-ink-muted">Refund to original payment</span><span className="font-semibold v2-num text-tap-greenDeep">{eur2(s.refund)}</span></div>}
          </div>
          <div className="mt-3 rounded-xl bg-lime-tint/50 border border-tap-green/30 px-3 py-2 flex items-center gap-2 text-[12px] text-tap-greenDark"><Icon name="check" size={14} className="text-tap-green shrink-0" /> Summary emailed to you. Both records are now managed separately in My Trips.</div>
        </Card>
        <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to My Trips</Btn></div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: "Change / split travellers" }]} />
      <h1 className="text-[26px] font-black">Change or split travellers</h1>
      <p className="text-[13px] text-ink-muted mt-1">Move one or more travellers to a different flight, or cancel just their seats — the rest of the party keeps their booking. This creates a second record (PNR split).</p>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-ink-faint">Current booking · {booking.pnr}</div>
            <div className="text-[16px] font-black mt-1">{cityOf(airports, f.origin)} <span className="text-ink-faint">→</span> {cityOf(airports, f.dest)}</div>
            <div className="text-[12px] text-ink-muted">{fmtDate(booking.flight_date)} · {f.flight_no || booking.flight_no} · {pax.length} travellers · {meta.cabin || "Economy"}</div>
          </Card>
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-1">Who is changing?</div>
            <div className="text-[12px] text-ink-muted mb-3">Select the traveller(s) to move onto a new record. At least one must stay on {booking.pnr}.</div>
            <div className="space-y-2">
              {pax.map((p, i) => {
                const on = picked.has(i);
                return (
                  <button key={i} onClick={() => toggle(i)} className={cx("w-full flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors", on ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                    <span className={cx("w-5 h-5 rounded-md border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green bg-tap-green text-white" : "border-line-strong")}>{on && <Icon name="check" size={12} />}</span>
                    <span className="flex-1"><span className="text-[14px] font-semibold">{nm(p, i)}</span><span className="block text-[11px] text-ink-faint">Seat {booking.seat || "—"} · {(booking.items || []).filter(c => c !== "seat").map(extraLabel).join(" · ") || "no extras"}</span></span>
                  </button>
                );
              })}
            </div>
          </Card>
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-3">What should happen to them?</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {[["change", "Move to a different flight", "Rebook the selected travellers"], ["cancel", "Cancel just their seats", "Refund per fare rules"]].map(([k, t, sub]) => (
                <button key={k} onClick={() => setMode(k)} className={cx("rounded-xl border p-3.5 text-left transition-colors", mode === k ? "border-tap-green bg-lime-tint/50 ring-1 ring-tap-green" : "border-line hover:border-line-strong")}>
                  <div className="flex items-center gap-2"><span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", mode === k ? "border-tap-green" : "border-line-strong")}>{mode === k && <span className="w-2 h-2 rounded-full bg-tap-green" />}</span><span className="text-[13px] font-bold">{t}</span></div>
                  <div className="text-[11px] text-ink-faint mt-1 ml-6">{sub}</div>
                </button>
              ))}
            </div>
            {mode === "change" && <div className="mt-3"><div className="text-[11px] font-semibold text-ink mb-1">New flight date</div><input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="rounded-xl border border-line px-3 py-2 text-[13px] w-full sm:w-auto" /><div className="text-[10px] text-ink-faint mt-1">Leave blank to keep the same date on the new record (demo).</div></div>}
          </Card>
        </div>
        <div className="lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-2">Split summary</div>
            <div className="text-[12px] text-ink-muted space-y-1.5">
              <div className="flex justify-between"><span>Staying on {booking.pnr}</span><span className="font-semibold text-ink">{pax.length - picked.size} traveller{pax.length - picked.size !== 1 ? "s" : ""}</span></div>
              <div className="flex justify-between"><span>Moving to a new record</span><span className="font-semibold text-ink">{picked.size} traveller{picked.size !== 1 ? "s" : ""}</span></div>
              <div className="flex justify-between"><span>Action</span><span className="font-semibold text-ink">{mode === "cancel" ? "Cancel + refund" : "Change flight"}</span></div>
            </div>
            <Btn className="w-full mt-4" disabled={!canSubmit || busy} onClick={submit}>{busy ? "Processing…" : mode === "cancel" ? "Split & cancel their seats" : "Split & rebook them"} <Icon name="arrow" size={14} /></Btn>
            {!canSubmit && <div className="text-[11px] text-ink-faint mt-2 text-center">Select at least one traveller, leaving at least one on the original.</div>}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function Refund({ shared, go, params }) {
  const { booking, loading, err } = useActiveBooking(params?.pnr);   // #1 — cancel the trip the user selected, not the soonest
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [picks, setPicks] = useState({});   // #39 — keyed by derived refund-item id; default via isOn()
  const [dest, setDest] = useState("Visa");
  if (loading) return <Loading label="Loading cancellation…" />;
  if (err || !booking) return <Empty go={go} title="No booking to cancel" msg="You don't have an active booking right now." />;
  const cancel = async () => {
    setBusy(true);
    const r = await api.post("/bookings/cancel", { pnr: booking.pnr }).catch(() => ({ ok: false }));   // #10 — cancel THIS booking
    setBusy(false);
    if (r && r.ok) { notifyBookingChanged(); setDone({ pnr: r.pnr || booking.pnr, email: r.email?.to, already: r.alreadyCancelled }); window.scrollTo({ top: 0 }); }
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
  // #39 — refundable items come from the actual booking/PNR: one fare line per booked passenger, the
  // real seat, each purchased extra, and taxes. Airline-cancelled fares refund in full.
  const meta = booking.meta || {};
  const u = shared.profile?.user || {};
  const farePrice = booking.flight?.price || booking.price || meta.price || 128;
  const paxNames = (Array.isArray(meta.passengers) && meta.passengers.length)
    ? meta.passengers.map(p => ([p.first || p.firstName, p.last || p.lastName].filter(Boolean).join(" ") || p.name || "Passenger"))
    : [[u.first_name, lastName(u)].filter(Boolean).join(" ") || "Daniel Ferreira"];
  const bookedCodes = (() => { try { return booking.items || JSON.parse(booking.items_json || "[]"); } catch { return []; } })();
  // #7 — refund eligibility follows the FARE purchased, not a flat 100%. Voluntary cancellation:
  const fareLabel = meta.fare || meta.cabin || "Classic";
  const REFUND_PCT = /exec|premium/i.test(fareLabel) ? 1 : /plus/i.test(fareLabel) ? 0.75 : /basic/i.test(fareLabel) ? 0 : 0.5;
  const farePctLabel = REFUND_PCT === 0 ? `${fareLabel} fare · non-refundable` : `${fareLabel} fare · ${Math.round(REFUND_PCT * 100)}% refundable`;
  const EXTRA_REFUND = { meal: { name: "Hot meal", paid: 14 }, bag: { name: "Checked bag · 23kg", paid: 25 }, "bag-extra": { name: "Extra checked bag · 23kg", paid: 55 }, wifi: { name: "Wi-Fi Full Pass", paid: 6 }, lounge: { name: "Lounge access", paid: 24 }, transfer: { name: "Airport transfer", paid: 32 }, car: { name: "Airport transfer", paid: 32 } };
  const refundItems = [
    ...paxNames.map((nm, i) => ({ id: "fl-" + i, name: `Outbound flight · ${nm}`, paid: farePrice, refund: +(farePrice * REFUND_PCT).toFixed(2), status: farePctLabel, kind: "fare", on: REFUND_PCT > 0 })),
    { id: "seat", name: `Seat ${booking.seat || "—"}`, paid: 22, refund: 22, status: "unused", kind: "extras", on: true },
    ...bookedCodes.filter(c => EXTRA_REFUND[c]).map(c => ({ id: "x-" + c, name: EXTRA_REFUND[c].name, paid: EXTRA_REFUND[c].paid, refund: EXTRA_REFUND[c].paid, status: "unused", kind: "extras", on: true })),
    { id: "tax", name: "Taxes & fees · refundable portion", paid: 42, refund: 36, status: "", kind: "taxes", on: true },
  ];
  const isOn = (it) => picks[it.id] ?? it.on;
  const selItems = refundItems.filter(isOn);
  const totalPaid = refundItems.reduce((s, it) => s + it.paid, 0);
  const sub = (kind) => selItems.filter(it => it.kind === kind).reduce((s, it) => s + it.refund, 0);
  const fareRef = sub("fare"), extrasRef = sub("extras"), taxRef = sub("taxes");
  const refundTotal = fareRef + extrasRef + taxRef;
  const destName = (REFUND_DESTS.find(d => d.id === dest)?.name || "Visa").split(" ")[0];
  // #7 — when the refund method is TAP Miles, express the refund value in miles
  // (with the euro equivalent shown alongside), so the summary matches the selection.
  const isMiles = dest === "miles";
  const milesFor = (e) => Math.round(e / MILES_RATE);            // €→miles via the shared rate
  const eurC = (n) => eur2(n).replace(".", ",");                 // #20 — European format (€592,00)
  const fmtRefund = (e) => isMiles ? `${miles(milesFor(e))} mi` : eurC(e);  // miles when miles is selected
  const refundTotalMi = milesFor(refundTotal);
  return (
    <div className="bg-white min-h-full">
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${booking.pnr}${booking.flight_no ? " — " + booking.flight_no : ""}`, page: "manage" }, { label: "Refund request" }]} />
      <h1 className="text-[36px] font-bold" style={{ color: "#0A0A0A" }}>Refund request</h1>
      <p className="text-[16px] leading-6 mt-1" style={{ color: "#6B6B6B" }}>Flight cancelled by airline. Choose how to receive each item refund. Travel-bank gets +10% bonus.</p>

      <div className="grid lg:grid-cols-[1fr_420px] gap-6 mt-6 items-start">
        <div className="space-y-5">
          {/* Refundable items (#4) */}
          <Card className="p-6" style={{ borderRadius: "18px" }}>
            <div className="font-bold text-[18px] mb-3">Refundable items</div>
            <div className="divide-y divide-line">
              {refundItems.map(it => {
                const on = isOn(it), can = it.refund > 0;
                return (
                  <label key={it.id} className="flex items-center gap-3 py-3 cursor-pointer">
                    <button type="button" disabled={!can} onClick={() => setPicks(p => ({ ...p, [it.id]: !(p[it.id] ?? it.on) }))} className="inline-flex items-center justify-center shrink-0" style={{ width: "22px", height: "22px", borderRadius: "5px", background: on && can ? "#1A1F29" : "#fff", border: on && can ? "none" : `1px solid ${can ? "#C9CDD3" : "#E0E3E8"}` }}>{on && can && <Icon name="check" size={13} className="stroke-[3]" style={{ color: "#C7F21F" }} />}</button>
                    <div className="flex-1"><div className="text-[13px] font-semibold" style={{ color: can ? undefined : "#667080" }}>{it.name}</div><div className="text-[11px]" style={{ color: can ? "#9AA0A6" : "#667080" }}>Paid {eurC(it.paid)}</div></div>
                    <div className="text-[13px] font-bold v2-num shrink-0" style={{ color: can ? "#1A7333" : "#667080" }}>{eurC(it.refund)}{it.status && <span className="font-medium" style={{ color: "#667080" }}> ({it.status})</span>}</div>
                  </label>
                );
              })}
            </div>
          </Card>

          {/* Refund destination selector (#5) */}
          <Card className="p-6" style={{ borderRadius: "18px" }}>
            <div className="font-bold text-[18px] mb-3">Refund destination</div>
            <div className="flex gap-2.5">
              {REFUND_DESTS.map(d => {
                const on = dest === d.id;
                return (
                  <button key={d.id} onClick={() => setDest(d.id)} className="text-left rounded-xl px-[18px] py-3 flex items-center gap-2.5 transition-colors shrink-0 w-fit" style={{ border: on ? "2px solid #A6D926" : "1px solid #E0E3E8", background: on ? "#F5FCD9" : "#fff" }}>
                    <span className="inline-flex items-center justify-center shrink-0" style={{ width: "20px", height: "20px", borderRadius: "10px", border: "2px solid #1A1F29" }}>{on && <span style={{ width: "10px", height: "10px", borderRadius: "5px", background: "#1A1F29" }} />}</span>
                    <div><div className="text-[13px] font-bold">{d.name}</div><div className="text-[10px] text-ink-faint">{d.sub}</div></div>
                  </button>
                );
              })}
            </div>
          </Card>
          {done?.failed && <div className="text-[12px] text-tap-red">Something went wrong — please try again.</div>}
        </div>

        {/* Sticky refund summary panel (#6) */}
        <aside className="lg:sticky lg:top-6">
          <Card className="p-5" style={{ borderRadius: "18px", boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}>
            <div className="font-semibold text-[20px] mb-3">Refund summary</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Original paid</span><span className="font-semibold v2-num">{eurC(totalPaid)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Items selected</span><span className="font-semibold v2-num">{selItems.length} of {refundItems.length}</span></div>
            </div>
            <div style={{ height: "1px", background: "#E0E3E8" }} className="my-3" />
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · fare</span><span className="font-semibold v2-num">{fmtRefund(fareRef)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · extras</span><span className="font-semibold v2-num">{fmtRefund(extrasRef)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · taxes</span><span className="font-semibold v2-num">{fmtRefund(taxRef)}</span></div>
            </div>
            <div style={{ height: "1px", background: "#E0E3E8" }} className="my-3" />
            <div className="flex justify-between items-center"><span className="font-bold">Refund to {destName}</span><span className="font-black v2-num text-[16px]" style={{ color: "#1A7333" }}>{isMiles ? `${miles(refundTotalMi)} mi` : eurC(refundTotal)}</span></div>
            {isMiles && refundTotal > 0 && <div className="text-[11px] text-ink-faint text-right mt-0.5 v2-num">≈ {eurC(refundTotal)} value</div>}
            <div className="mt-3 px-3 py-2.5 text-[12px]" style={{ background: "#F5FAFF", border: "1px solid #C7D6F5", borderRadius: "12px" }}><div className="font-bold flex items-center gap-1.5"><Icon name="info" size={16} className="text-[#2563EB]" /> Why these amounts?</div><div className="text-ink-muted mt-0.5">Discount fare: non-refundable. 20% admin fee on refundable items. See full policy.</div></div>
            <button disabled={busy || refundTotal <= 0} onClick={cancel} style={{ height: "42px", borderRadius: "9999px", background: "#46A41A", color: "#fff" }} className="w-full mt-4 font-semibold text-[14px] inline-flex items-center justify-center disabled:opacity-60 transition-opacity">{busy ? "Processing…" : `Process refund · ${isMiles ? miles(refundTotalMi) + " mi" : eurC(refundTotal)}`}</button>
            <button onClick={() => go("manage")} className="w-full mt-2 rounded-full bg-surface text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors inline-flex items-center justify-center" style={{ height: "42px", border: "1px solid #E8E8E5" }}>Cancel request</button>
          </Card>
        </aside>
      </div>
    </div>
    </div>
  );
}
