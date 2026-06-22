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
  if (i >= 0) trip.extras.splice(i, 1); else trip.extras.push({ ...item, qty: item.qty || 1 });
}
export function tripTotals() {
  const legPrice = (trip.outbound?.price || 0) + (trip.inbound?.price || 0);
  const flights = legPrice * (trip.pax || 1);
  const extras = trip.extras.reduce((s, x) => s + (x.price || 0) * (x.qty || 1), 0);
  const taxes = Math.round((flights + extras) * 0.085);
  const total = flights + extras + taxes;
  return { flights, extras, taxes, total };
}
