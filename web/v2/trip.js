// FlyTAP v2 — shared trip state across the booking spine (results → cart →
// passenger → payment → confirmation). Module-scoped so it persists across SPA
// navigation within a session. The server stays the source of truth on /api/pay.
export const trip = {
  type: "round", pax: 1, cabin: "Economy",
  origin: null, dest: null, date: null, ret: null,
  outbound: null, inbound: null,   // { flight, fare, price }
  extras: [],                       // [{ code, name, price, qty, cat, source }]  source: recommended | auto | user
  passengers: [], contact: null, payment: null, pnr: null,
};

// Lightweight pub/sub so anything outside a screen (e.g. the top-nav basket badge)
// re-renders the moment the in-memory basket changes — keeps the count in the nav,
// the right-rail summary and the basket window in lock-step.
const _listeners = new Set();
export function onTripChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function notify() { _listeners.forEach(fn => { try { fn(); } catch { } }); saveTrip(); }
export function pingBasket() { notify(); }

export function setLeg(leg, choice) { trip[leg] = choice; notify(); }
// Clear the basket back to its initial state (called on login / persona switch / logout,
// so a new context never inherits a previous session's in-progress cart).
export function resetTrip() {
  _resetting = true;
  Object.assign(trip, {
    type: "round", pax: 1, cabin: "Economy",
    origin: null, dest: null, date: null, ret: null,
    outbound: null, inbound: null, extras: [],
    passengers: [], contact: null, payment: null, pnr: null,
  });
  try { localStorage.removeItem(TKEY); } catch {}
  _resetting = false;
  notify();
}
export function hasExtra(code) { return trip.extras.some(x => x.code === code); }
// Per-traveller categories. The cart shows a "× pax" hint for these (CAT_QTY) and item
// cards pre-multiply price by pax before storing, so qty stays 1 — see seedExtras / Row.
export const PER_PAX_CATS = new Set(["Insurance", "Lounge & services", "Experiences"]);
export function toggleExtra(item) {
  const i = trip.extras.findIndex(x => x.code === item.code);
  if (i >= 0) trip.extras.splice(i, 1); else trip.extras.push({ ...item, qty: item.qty || 1, cat: item.cat || "Extras", source: item.source || "user" });
  notify();
}
// Empty just the add-ons (keep the chosen flight) — the user's explicit "clear basket".
export function clearBasket() { trip.extras = []; notify(); }
// A serializable snapshot persisted to the server so the basket survives an abandoned
// session: flight context + every add-on with its source (user / recommended / auto).
export function tripSnapshot() {
  return {
    type: trip.type, pax: trip.pax, cabin: trip.cabin,
    origin: trip.origin, dest: trip.dest, date: trip.date, ret: trip.ret,
    outbound: trip.outbound, inbound: trip.inbound,
    extras: trip.extras.map(e => ({ code: e.code, name: e.name, price: e.price, qty: e.qty || 1, cat: e.cat, source: e.source || "user", ...(e.rate != null ? { rate: e.rate } : {}), ...(e.nights != null ? { nights: e.nights } : {}) })),
  };
}
// ── Local session persistence (Important #4) ────────────────────────────────
// Keep the in-progress trip across a hard refresh: the in-memory `trip` is the
// source of truth during a session, but a reload wipes module state, so we mirror
// it to localStorage and rehydrate on boot. Cleared on login/logout/persona switch
// (resetTrip) so a new member context never inherits a previous session's cart.
const TKEY = "flytap_trip";
let _resetting = false;
export function saveTrip() {
  if (_resetting) return;
  if (trip.pnr) { try { localStorage.removeItem(TKEY); } catch {} return; }  // #18 — a confirmed booking is not a resumable in-progress cart
  try {
    const snap = {
      type: trip.type, pax: trip.pax, cabin: trip.cabin,
      origin: trip.origin, dest: trip.dest, date: trip.date, ret: trip.ret,
      outbound: trip.outbound, inbound: trip.inbound,
      extras: trip.extras, passengers: trip.passengers, contact: trip.contact,
    };
    if (!snap.outbound && !snap.extras.length && !snap.passengers.length) localStorage.removeItem(TKEY);
    else localStorage.setItem(TKEY, JSON.stringify(snap));
  } catch {}
}
export function loadTrip() {
  try {
    const raw = localStorage.getItem(TKEY);
    if (!raw) return false;
    const s = JSON.parse(raw) || {};
    if (!s.outbound && !(s.extras || []).length && !(s.passengers || []).length) return false;
    Object.assign(trip, {
      type: s.type || "round", pax: s.pax || 1, cabin: s.cabin || "Economy",
      origin: s.origin ?? null, dest: s.dest ?? null, date: s.date ?? null, ret: s.ret ?? null,
      outbound: s.outbound || null, inbound: s.inbound || null,
      extras: Array.isArray(s.extras) ? s.extras : [],
      passengers: Array.isArray(s.passengers) ? s.passengers : [],
      contact: s.contact || null,
    });
    notify();
    return true;
  } catch { return false; }
}

// Rebuild an abandoned basket from the server snapshot so a returning member resumes
// exactly where they left off (flight + add-ons), with the count showing in the nav.
export function restoreFromSaved(saved) {
  if (!saved) return false;
  const snap = saved.snapshot || {};
  const extras = Array.isArray(snap.extras) ? snap.extras : [];
  if (!extras.length && !snap.outbound) return false;
  Object.assign(trip, {
    type: snap.type || "round", pax: snap.pax || 1, cabin: snap.cabin || "Economy",
    origin: snap.origin ?? null, dest: snap.dest ?? null, date: snap.date ?? null, ret: snap.ret ?? null,
    outbound: snap.outbound || null, inbound: snap.inbound || null,
    extras: extras.map(e => ({ ...e, qty: e.qty || 1, cat: e.cat || "Extras", source: e.source || "recommended" })),
  });
  notify();
  return true;
}
// Source labels for the basket classification (recommended by system / auto-added / added by you).
export const SOURCE_META = {
  recommended: { label: "Recommended for you", tag: "Recommended", tone: "green" },
  auto: { label: "Auto-added", tag: "Auto-added", tone: "slate" },
  user: { label: "Extras you added", tag: "Added by you", tone: "lime" },
};
export const SOURCE_ORDER = ["user", "recommended", "auto"];
export function extrasBySource() {
  const g = { user: [], recommended: [], auto: [] };
  for (const e of trip.extras) (g[e.source] || g.recommended).push(e);
  return g;
}
// group added extras by category for the basket summary (Hotels / Cars / Insurance / …)
export function extrasByCategory() {
  const g = {};
  for (const e of trip.extras) { g[e.cat || "Extras"] = (g[e.cat || "Extras"] || 0) + (e.price || 0) * (e.qty || 1); }
  return g;
}
export function bundleSavings() {
  // Cross-sell bundle discount: 15% off when a stay (Hotels) and Lounge & services
  // are booked together. Proportional to the actual extras, not a fixed amount.
  const g = extrasByCategory();
  if (!(g["Hotels"] > 0 && g["Lounge & services"] > 0)) return 0;
  const base = (g["Hotels"] || 0) + (g["Lounge & services"] || 0);
  return Math.round(base * 0.15 * 100) / 100;
}
export function tripTotals() {
  const legPrice = (trip.outbound?.price || 0) + (trip.inbound?.price || 0);
  const flights = legPrice * (trip.pax || 1);
  const extras = trip.extras.reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
  const taxes = Math.round((flights + extras) * 0.085);
  const bundle = bundleSavings();
  const total = flights + extras + taxes - bundle;
  return { flights, extras, taxes, bundle, total };
}
