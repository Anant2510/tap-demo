// FlyTAP v2 — Manage My Booking (MMB). Seven flows wired to the live (unchanged)
// backend: Retrieve/hub (J1), Cabin upgrade (A9), Seat change (A10), Rebook on
// disruption (C2), Online check-in (J3), Add extras (J4), Cancel & refund (C4).
// Each screen reads the same "current booking" the server acts on (mirror of the
// server's currentBooking()), so the card you see is the booking the action mutates.
import React, { useState, useEffect } from "react";
import { api, EUR, miles, fmtDate, MILES_RATE, downloadFile, buildICS } from "./lib.js";
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
const eur2 = (n) => n == null ? "—" : `€${Number(n).toFixed(2)}`;
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

const Crumb = ({ go, label = "Manage booking", trail }) => {
  if (trail && trail.length) return (
    <nav className="flex items-center gap-1.5 text-[12px] text-ink-muted mb-3 flex-wrap">
      {trail.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <Icon name="chevR" size={12} className="text-ink-faint" />}
          {t.page && i < trail.length - 1
            ? <button onClick={() => go(t.page)} className="hover:text-ink transition-colors">{t.label}</button>
            : <span className={i === trail.length - 1 ? "font-bold text-ink" : ""}>{t.label}</span>}
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
                    {paxNames.length > 0 && <div className="text-[12px] text-ink mt-0.5 flex items-center gap-1.5 flex-wrap"><Icon name="user" size={11} className="text-ink-faint" />{paxNames.map((nm, i) => <span key={i} className="font-medium">{nm}{i < paxNames.length - 1 ? "," : ""}</span>)}</div>}
                    {inb && <div className="text-[12px] text-ink-muted mt-0.5">Return · {inb.origin}<span className="text-ink-faint"> → </span>{inb.dest} · {fmtDate(meta.inbound?.date || inb.flight_date)} · {inb.flight_no}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide bg-lime-tint text-tap-greenDeep rounded-full px-2.5 py-1"><Icon name="check" size={10} /> Confirmed</span>
                    <div className="text-[11px] text-ink-faint mt-1">{(b.days_to_go ?? 0) > 0 ? `In ${b.days_to_go} day${b.days_to_go !== 1 ? "s" : ""}` : "Today"} · {b.pnr || b.flight_no}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3 flex-wrap text-[12px] text-ink-muted">
                  <span>Includes:</span>
                  <span className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink"><Icon name="seat" size={11} /> Seat {b.seat || "—"}</span>
                  {(() => { const xs = (b.items || []).filter(c => c !== "seat"); return <>
                    {xs.slice(0, 8).map((c, i) => <span key={i} className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink">{extraLabel(c)}</span>)}
                    {xs.length > 8 && <span className="inline-flex items-center border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink-muted">+{xs.length - 8} more</span>}
                  </>; })()}
                  {!(b.items || []).length && <span className="inline-flex items-center gap-1 border border-line rounded-full px-2.5 py-1 text-[11px] font-semibold text-ink"><Icon name="bag" size={11} /> Carry-on</span>}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line">
                  <button onClick={() => go("rebook", { pnr: b.pnr })} className="inline-flex items-center gap-1.5 rounded-full bg-tap-green text-white px-3.5 py-1.5 text-[12px] font-bold hover:bg-tap-greenDeep transition-colors"><Icon name="refresh" size={12} /> Update flight</button>
                  {ACTIONS.map(([lbl, page, ic]) => (
                    <button key={lbl} onClick={() => go(page, page === "addextras" ? { pnr: b.pnr } : undefined)} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[12px] font-semibold text-ink hover:border-tap-green hover:text-tap-greenDeep transition-colors"><Icon name={ic} size={12} /> {lbl}</button>
                  ))}
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
    <div className="mx-auto max-w-content px-6 py-8">
      <SuccessHead title={`Upgraded to ${chosen.name}`} sub={`PNR ${booking.pnr} · confirmation on its way`} />
      <Card className="p-5 mt-6 v2-in">
        <BookingBand booking={booking} airports={shared.airports} />
        <div className="flex flex-wrap gap-2 mt-3"><Pill tone="gold">{chosen.name} cabin</Pill><Pill tone="lime">Lie-flat seat</Pill><Pill tone="slate">Lounge access</Pill><Pill tone="slate">2× checked bags</Pill></div>
        <Divider className="my-4" />
        <div className="flex items-center justify-between"><span className="text-[13px] text-ink-muted">Upgrade charged</span><span className="text-[20px] font-black text-tap-green v2-num">{EUR(fareDiff)}</span></div>
      </Card>
      <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
    </div>
  );
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${booking.pnr} — ${cityOf(shared.airports, booking.flight?.origin)}–${cityOf(shared.airports, booking.flight?.dest)} · ${fmtDate(booking.flight_date)}`, page: "manage" }, { label: "Cabin upgrade" }]} />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[26px] font-black">Upgrade your cabin</h1>
          <p className="text-[13px] text-ink-muted mt-1">You're checked in. Pick a fixed price — your new boarding pass is auto-reissued.</p>
        </div>
        <Pill tone="green"><Icon name="check" size={11} /> Checked in</Pill>
      </div>
      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div>
          <div className="rounded-xl bg-surface-soft border border-line px-4 py-2.5 text-[13px] flex items-center gap-2 flex-wrap">
            <span className="text-ink-muted">Current:</span><span className="font-semibold">{curCabin} · Seat {booking.seat || "—"}</span><Icon name="arrow" size={14} className="text-ink-faint" /><span className="text-ink-muted">Upgrade to:</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {["prem", "exec"].map(k => { const o = OPTS[k]; const on = sel === k; return (
              <Card key={k} onClick={() => setSel(k)} className={cx("p-5 cursor-pointer transition-all v2-in", on ? "ring-2 ring-tap-green bg-lime-tint/25" : "hover:border-line-strong")}>
                <div className="flex items-start justify-between gap-2"><div className="text-[16px] font-black">{o.name}</div>{o.rec && <Pill tone="gold">Recommended</Pill>}</div>
                <div className="mt-1.5"><span className="text-[20px] font-black v2-num">{k === "exec" ? "+" : ""}{EUR(o.diff)}</span><span className="text-[12px] text-ink-faint"> {k === "exec" ? "to upgrade" : "currently"}</span></div>
                <div className="text-[11px] font-semibold text-tap-greenDeep mt-2">Fixed price · instant</div>
                <div className="text-[11px] text-ink-muted mt-0.5">{o.seats > 5 ? `Available · ${o.seats} seats` : `${o.seats} seats left`}</div>
                <ul className="text-[12px] text-ink-muted mt-3 space-y-1.5">{UPGRADE_BENEFITS.map(b => <li key={b} className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green shrink-0" /> {b}</li>)}</ul>
                <Btn variant={on ? "primary" : "outline"} className="w-full mt-4" disabled={busy} onClick={e => { e.stopPropagation(); setSel(k); confirm(); }}>Upgrade for {EUR(baseFare + o.diff)}</Btn>
              </Card>
            ); })}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {[`Save ${EUR(120)} vs. buying at gate`, `Lounge value alone ≈ ${EUR(38)}`, `+${miles(1240)} bonus miles`].map(b => <span key={b} className="text-[11px] font-semibold rounded-full border border-tap-green/40 bg-lime-tint/50 text-tap-greenDeep px-3 py-1.5">{b}</span>)}
          </div>
          <Card className="p-5 mt-4">
            <div className="font-bold text-[14px] mb-2.5">After upgrade — auto-reissue</div>
            <ul className="text-[12px] text-ink-muted space-y-1.5">{REISSUE.map(b => <li key={b} className="flex items-center gap-1.5"><Icon name="check" size={12} className="text-tap-green shrink-0" /> {b}</li>)}</ul>
          </Card>
        </div>

        <aside className="lg:sticky lg:top-6 space-y-3">
          <Card className="p-5">
            <div className="font-bold text-[16px] mb-3">Upgrade summary</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Current {curCabin} fare</span><span className="v2-num">{EUR(baseFare)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Cabin upgrade · {chosen.name}</span><span className="v2-num">+{EUR(fareDiff)}</span></div>
            </div>
            <Divider className="my-3" />
            <div className="flex items-end justify-between"><span className="font-bold">New total</span><span className="text-[22px] font-black v2-num">{EUR(newTotal)}</span></div>
            <div className="text-[11px] text-ink-faint mt-1">or {miles(milesPrice)} miles</div>
            <Btn size="lg" className="w-full mt-3" disabled={busy} onClick={confirm}>{busy ? "Confirming…" : `Upgrade for ${EUR(newTotal)} →`}</Btn>
            <Btn variant="outline" className="w-full mt-2" onClick={() => go("manage")}>No thanks, keep {curCabin}</Btn>
          </Card>
          <div className="rounded-xl border border-[#f5d9a8] bg-[#fffaf0] px-4 py-3 text-[12px]">
            <div className="font-bold text-[#b45309]">{chosen.seats} {chosen.name} seats remaining</div>
            <div className="text-ink-muted">Window closes 4 h before departure</div>
          </div>
        </aside>
      </div>
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
  const cabinOfRow = (r) => (r <= 5 ? "Business" : r <= 11 ? "Premium" : "Economy");

  // Cabin tabs match the booking flow (Economy / Premium / Business), not First/Executive.
  // Each zone is physically distinct: Business 1-1 lie-flat · Premium 2-2 · Economy 3-3.
  const CABINS = {
    Economy: { cols: ["A", "B", "C", "D", "E", "F"], rows: [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32], config: "3 – 3", desc: "Standard Economy", extraRows: [20, 26], exitRows: [20, 26], aisleAfter: [2] },
    Premium: { cols: ["A", "C", "D", "F"], rows: [6, 7, 8, 9, 10, 11], config: "2 – 2", desc: "Premium cabin · wider seat", extraRows: [6], exitRows: [6], aisleAfter: [1] },
    Business: { cols: ["A", "D"], rows: [1, 2, 3, 4, 5], config: "1 – 1", desc: "Lie-flat Business suite", extraRows: [1], exitRows: [], aisleAfter: [0] },
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
  const canConfirm = sel && sel !== safeSeat && (!selExit || eligOk);

  const confirm = async () => {
    setBusy(true);
    await api.post("/bookings/ancillary", { code: "seat-" + sel, pnr: booking.pnr }).catch(() => ({ ok: false }));
    notifyBookingChanged();   // #36 — seat change must reflect in My Trip immediately
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
          <div className="max-w-[400px] mx-auto">
            <div className="flex items-center gap-2 mb-2"><span className="w-5 shrink-0" />{C.cols.map((col, ci) => <React.Fragment key={col}><span className="flex-1 text-center text-[10px] text-ink-faint">{col}</span>{C.aisleAfter?.includes(ci) && <span className="w-4 shrink-0" />}</React.Fragment>)}</div>
            <div className="space-y-2.5">
              {C.rows.map(r => (
                <div key={r} className="flex items-center gap-2">
                  <span className="w-5 text-[10px] text-ink-faint text-right shrink-0">{r}</span>
                  {C.cols.map((col, ci) => {
                    const id = `${r}${col}`, isCur = id === safeSeat, isTaken = taken.has(id) && !isCur, isSel = sel === id, extra = feeOf(id) > 0, isRec = rec?.seat === id && !isCur;
                    return (
                      <React.Fragment key={id}>
                      <button disabled={isTaken} title={isExit(id) ? "Exit row · extra legroom" : extra ? "Extra legroom" : ""} onClick={() => { setSel(id); setEligOk(false); }}
                        className={cx("flex-1 h-10 rounded-lg text-[10px] font-bold leading-none flex flex-col items-center justify-center transition-colors",
                          isSel ? "bg-tap-green text-white"
                            : isCur ? "bg-lime-tint text-ink border border-tap-green/50"
                              : isTaken ? "bg-surface-mute text-ink-faint cursor-not-allowed"
                                : extra ? "bg-[#F4B740] text-ink"
                                  : isRec ? "bg-lime text-ink"
                                    : "bg-white border border-line-strong text-ink hover:border-tap-green")}>
                        <span>{id}</span>{isCur && <span className="text-[7px] font-medium">Your seat</span>}
                      </button>
                      {C.aisleAfter?.includes(ci) && <span className="w-4 shrink-0" />}
                      </React.Fragment>
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
              <div className="flex-1 rounded-xl border border-line p-3"><div className="text-[10px] uppercase tracking-wide text-ink-faint">Current</div><div className="text-[18px] font-black v2-num">{safeSeat}</div><div className="text-[10px] text-ink-faint">{cabinKey} · row {safeRow}</div></div>
              <Icon name="arrow" size={16} className="text-ink-faint shrink-0" />
              <div className={cx("flex-1 rounded-xl border p-3", sel ? "border-tap-green/50 bg-lime-tint/40" : "border-line border-dashed")}><div className="text-[10px] uppercase tracking-wide text-ink-faint">New</div><div className="text-[18px] font-black v2-num">{sel || "—"}</div><div className="text-[10px] text-ink-faint">{sel ? (selFee ? "Extra legroom" + (selExit ? " · exit row" : "") : "Standard · row " + parseInt(sel, 10)) : "Pick a seat"}</div></div>
            </div>
            {selFee > 0 && <div className="mt-3.5 rounded-xl border border-line bg-surface-soft p-3 flex items-center justify-between"><span className="text-[13px] font-semibold">Extra-legroom fee</span><span className="text-[18px] font-black v2-num">{eur2(selFee)}</span></div>}
            {selExit && (
              <div className="mt-3 rounded-xl border border-[#F4B740]/60 p-3" style={{ background: "#FFF7E6" }}>
                <div className="text-[12px] font-bold flex items-center gap-1.5"><Icon name="info" size={13} className="shrink-0" /> Exit-row eligibility</div>
                <div className="text-[11px] text-ink-muted mt-1">You must be 16+, able-bodied, speak Portuguese or English, and assist in an emergency.</div>
                <label className="flex items-center gap-2 text-[12px] font-semibold mt-2"><input type="checkbox" checked={eligOk} onChange={e => setEligOk(e.target.checked)} className="accent-tap-green" /> I confirm I meet exit-row requirements</label>
              </div>
            )}
            <Btn size="lg" className="w-full mt-4" disabled={busy || !canConfirm} onClick={confirm}>{busy ? "Reissuing…" : (sel && sel !== safeSeat) ? `Confirm seat ${sel}${selFee ? " · " + eur2(selFee) : ""} →` : "Pick a new seat"}</Btn>
            <button onClick={() => go("manage")} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors">Keep current seat</button>
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
    const opt = [...shownAlts, ...(keep ? [keep] : [])].find(o => o.id === sel) || shownAlts[0];   // #40 — keep is selectable too
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
      <div className="flex gap-3 mt-5"><Btn onClick={() => { notifyBookingChanged(); go("manage"); }}>Back to booking</Btn><Btn variant="outline" onClick={() => go("checkin")}>Check in →</Btn></div>
    </div>
  );
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
export function CheckInIndirect({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
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
        return { id: "p" + i, avatar: (last || first || "P")[0].toUpperCase(), name: nm, type: child ? "Child" : "Adult", doc: p.doc || p.passport || (child ? "ID document pending" : (u.doc_id ? "Passport " + u.doc_id : "Passport")), verified: !child, seat: i === 0 ? bookedSeat : (p.seat || "—"), needsDocs: child && !p.doc, on: true };
      })
    : [{ id: "self", avatar: (u.first_name || "D")[0].toUpperCase(), name: u.full_name ? `${u.full_name.split(" ").slice(-1)[0]}, ${u.first_name || u.full_name.split(" ")[0]}` : "Ferreira, Daniel", type: "Adult", doc: u.doc_id ? "Passport " + u.doc_id : "Passport", verified: true, seat: bookedSeat, on: true }];
  const isOn = (p) => picks[p.id] ?? p.on;
  const checkin = async () => {
    setBusy(true);
    const r = await api.post("/bookings/checkin", { doc_id: doc || null }).catch(() => ({ ok: false, state: "error" }));
    setBusy(false); setRes(r); window.scrollTo({ top: 0 });
  };
  if (res && res.ok) {
    const already = res.state === "already_checked_in";
    const bpText = `TAP AIR PORTUGAL — BOARDING PASS\nPNR: ${res.pnr}\nPassenger: ${u.first_name || ""}\nRoute: ${res.route}\nSeat: ${res.seat} · Group ${res.group}\nDate: ${fmtDate(res.date)}\n\nGate closes 20 minutes before departure.`;
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

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div className="space-y-4">
          {/* Passenger cards (#4) */}
          {bookedPax.map(p => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-full bg-lime-tint text-tap-greenDeep inline-flex items-center justify-center text-[14px] font-bold shrink-0">{p.avatar}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[14px]">{p.name}</div>
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
                : <label className="flex items-center gap-2 mt-3 text-[12px] font-semibold cursor-pointer"><input type="checkbox" checked={isOn(p)} onChange={() => setPicks(s => ({ ...s, [p.id]: !(s[p.id] ?? p.on) }))} className="accent-ink w-4 h-4" /> Check in this passenger</label>}
            </Card>
          ))}

          {/* Travel documents (APIS) (#5) */}
          <div className="rounded-2xl border border-tap-green/30 p-4" style={{ background: "#f2ffdb88" }}>
            <div className="font-bold text-[14px] mb-2">Travel documents (APIS)</div>
            <div className="text-[12px] flex items-start gap-1.5"><Icon name="check" size={13} className="text-tap-green mt-0.5 shrink-0" /> Passport PT2438211 · expires 2029-08-12 · all pax verified</div>
            <div className="text-[12px] text-[#b45309] font-semibold flex items-start gap-1.5 mt-1.5"><Icon name="info" size={13} className="mt-0.5 shrink-0" /> US ESTA pending — required for stopover OPO → re-check before boarding</div>
            <button className="text-[12px] font-bold text-tap-greenDeep hover:underline mt-2">Update documents →</button>
          </div>
        </div>

        {/* Sticky check-in summary panel (#6) */}
        <aside className="lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="font-bold text-[16px] mb-3">Check-in summary</div>
            <div className="space-y-2.5 text-[13px]">
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Flight</span><span className="font-bold text-right">{booking.flight_no || "TP 73"} · {fmtDate(booking.flight_date)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Passengers</span><span className="font-bold">{selCount} of {total} selected</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Seats</span><span className="font-bold v2-num">22A · 22B (together)</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Bag</span><span className="font-bold">1 × 23kg (included)</span></div>
              <div className="flex justify-between gap-3"><span className="text-ink-muted">Boarding</span><span className="font-bold v2-num">16:00 · Gate B12</span></div>
            </div>
            <div className="mt-3 rounded-xl bg-lime-tint border border-tap-green/30 px-3 py-2.5 text-[12px]"><div className="font-bold">Add to your trip</div><div className="text-ink-muted mt-0.5">+ Extra bag €38 · + Lounge access €42</div><div className="text-[11px] text-ink-faint mt-0.5">Restricted by fare rule: cabin upgrade</div></div>
            <Btn size="lg" className="w-full mt-4" disabled={busy} onClick={checkin}>{busy ? "Checking in…" : "Upload & check in all →"}</Btn>
            <button onClick={checkin} disabled={busy} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors">Check in {selCount} of {total} now (resolve Tomás later)</button>
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
  // Enhance · cross-sell — curated experiences/transfers that stage straight into the add-ons basket.
  const XSELL = [
    ["xsell-sintra", "Sintra full-day from Lisbon", "Pena Palace, Quinta da Regaleira & Cabo da Roca.", 89, "per person", "Day trip", "sintra,portugal", null],
    ["xsell-douro", "Douro Valley wine tour", "Vineyards, tastings & a river cruise. Full day.", 120, "per person", "Wine", "douro,vineyard", null],
    ["xsell-xfer-return", "Return transfer hotel → airport", "Private sedan · save 10% when paired.", 25, "per car", "Transfer", "car,sedan", "Bundle −10%"],
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
export function Refund({ shared, go }) {
  const { booking, loading, err } = useActiveBooking();
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
  const fmtRefund = (e) => isMiles ? `${miles(milesFor(e))} mi` : eur2(e);  // miles when miles is selected
  const refundTotalMi = milesFor(refundTotal);
  return (
    <div className="mx-auto max-w-page px-6 py-8">
      <Crumb go={go} trail={[{ label: "My Trip", page: "manage" }, { label: `${booking.pnr}${booking.flight_no ? " — " + booking.flight_no : ""}`, page: "manage" }, { label: "Refund request" }]} />
      <h1 className="text-[26px] font-black">Refund request</h1>
      <p className="text-[13px] text-ink-muted mt-1">Flight cancelled by airline. Choose how to receive each item refund. Travel-bank gets +10% bonus.</p>

      <div className="grid lg:grid-cols-[1fr_320px] gap-6 mt-6 items-start">
        <div className="space-y-5">
          {/* Refundable items (#4) */}
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-3">Refundable items</div>
            <div className="divide-y divide-line">
              {refundItems.map(it => {
                const on = isOn(it), can = it.refund > 0;
                return (
                  <label key={it.id} className={cx("flex items-center gap-3 py-3 cursor-pointer", !can && "opacity-55")}>
                    <input type="checkbox" checked={on} disabled={!can} onChange={() => setPicks(p => ({ ...p, [it.id]: !(p[it.id] ?? it.on) }))} className="accent-ink w-4 h-4 shrink-0" />
                    <div className="flex-1"><div className="text-[13px] font-semibold">{it.name}</div><div className="text-[11px] text-ink-faint">Paid {eur2(it.paid)}</div></div>
                    <div className={cx("text-[13px] font-bold v2-num shrink-0", can ? "text-tap-greenDeep" : "text-ink-faint")}>{eur2(it.refund)}{it.status && <span className="font-medium text-ink-faint"> ({it.status})</span>}</div>
                  </label>
                );
              })}
            </div>
          </Card>

          {/* Refund destination selector (#5) */}
          <Card className="p-5">
            <div className="font-bold text-[15px] mb-3">Refund destination</div>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {REFUND_DESTS.map(d => {
                const on = dest === d.id;
                return (
                  <button key={d.id} onClick={() => setDest(d.id)} className={cx("text-left rounded-xl border p-3 flex items-center gap-2.5 transition-colors", on ? "border-tap-green bg-lime-tint/40" : "border-line hover:border-tap-green/40")}>
                    <span className={cx("w-4 h-4 rounded-full border-2 inline-flex items-center justify-center shrink-0", on ? "border-tap-green" : "border-line-strong")}>{on && <span className="w-2 h-2 bg-tap-green rounded-full" />}</span>
                    <div><div className="text-[13px] font-bold">{d.name}</div><div className="text-[11px] text-ink-faint">{d.sub}</div></div>
                  </button>
                );
              })}
            </div>
          </Card>
          {done?.failed && <div className="text-[12px] text-tap-red">Something went wrong — please try again.</div>}
        </div>

        {/* Sticky refund summary panel (#6) */}
        <aside className="lg:sticky lg:top-6">
          <Card className="p-5">
            <div className="font-bold text-[16px] mb-3">Refund summary</div>
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Original paid</span><span className="font-semibold v2-num">{eur2(totalPaid)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Items selected</span><span className="font-semibold v2-num">{selItems.length} of {refundItems.length}</span></div>
            </div>
            <Divider className="my-3" />
            <div className="space-y-2 text-[13px]">
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · fare</span><span className="font-semibold v2-num">{fmtRefund(fareRef)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · extras</span><span className="font-semibold v2-num">{fmtRefund(extrasRef)}</span></div>
              <div className="flex justify-between"><span className="text-ink-muted">Sub-refund · taxes</span><span className="font-semibold v2-num">{fmtRefund(taxRef)}</span></div>
            </div>
            <Divider className="my-3" />
            <div className="flex justify-between items-center"><span className="font-bold">Refund to {destName}</span><span className="font-black v2-num text-tap-greenDeep text-[16px]">{isMiles ? `${miles(refundTotalMi)} mi` : eur2(refundTotal)}</span></div>
            {isMiles && refundTotal > 0 && <div className="text-[11px] text-ink-faint text-right mt-0.5 v2-num">≈ {eur2(refundTotal)} value</div>}
            <div className="mt-3 rounded-lg bg-[#eef4ff] border border-[#d6e3ff] px-3 py-2.5 text-[12px]"><div className="font-bold flex items-center gap-1.5"><Icon name="info" size={13} className="text-[#3b6fd6]" /> Why these amounts?</div><div className="text-ink-muted mt-0.5">Discount fare: non-refundable. 20% admin fee on refundable items. See full policy.</div></div>
            <Btn size="lg" className="w-full mt-4" disabled={busy || refundTotal <= 0} onClick={cancel}>{busy ? "Processing…" : `Process refund · ${isMiles ? miles(refundTotalMi) + " mi" : eur2(refundTotal)} →`}</Btn>
            <button onClick={() => go("manage")} className="w-full mt-2 rounded-full border border-line bg-surface py-2.5 text-[13px] font-semibold text-ink hover:bg-surface-mute transition-colors">Cancel request</button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
