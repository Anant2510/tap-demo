// FlyTAP v2 — shared trip state across the booking spine (results → cart →
// passenger → payment → confirmation). Module-scoped so it persists across SPA
// navigation within a session. The server stays the source of truth on /api/pay.
export const trip = {
  type: "round", pax: 1, cabin: "Economy",
  origin: null, dest: null, date: null, ret: null,
  outbound: null, inbound: null,   // { flight, fare, price }
  extras: [],                       // [{ code, name, price, qty }]
  passengers: [], contact: null, payment: null, pnr: null,
};

export function setLeg(leg, choice) { trip[leg] = choice; }
export function hasExtra(code) { return trip.extras.some(x => x.code === code); }
export function toggleExtra(item) {
  const i = trip.extras.findIndex(x => x.code === item.code);
  if (i >= 0) trip.extras.splice(i, 1); else trip.extras.push({ ...item, qty: item.qty || 1, cat: item.cat || "Extras" });
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
