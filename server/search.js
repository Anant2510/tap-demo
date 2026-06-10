/* ──────────────────────────────────────────────────────────────
   TAP Demo — flight search engine
   Generates realistic, deterministic flights for any route in the
   network. Same route + date always yields the same flights, so the
   demo is stable, but we never seed tens of thousands of rows.
   Recommendations are personalized from the customer's own history.
   ────────────────────────────────────────────────────────────── */
const { db } = require("./db");
const { AIRPORTS } = require("./routes-data");

// Small seeded PRNG so generated flights are stable per route+date
function rng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h = Math.imul(h ^ (h >>> 15), h | 1); h ^= h + Math.imul(h ^ (h >>> 7), h | 61); return ((h ^ (h >>> 14)) >>> 0) / 4294967296; };
}

const AIRCRAFT_SHORT = ["A319", "A320neo", "A321neo", "Embraer E195"];
const AIRCRAFT_LONG = ["A330neo", "A321LR", "Boeing 787-9", "A330-900"];
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (mins) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
const durLabel = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ""}` : `${m}m`;

function getRoute(origin, dest) {
  return db.prepare("SELECT * FROM routes WHERE origin=? AND dest=?").get(origin, dest);
}

// Daniel's home shuttle has fixed, real flight numbers so his history lines up
const PINNED = {
  "OPO-LIS": [
    { flight_no: "TP1921", dep: "06:35", arr: "07:30", aircraft: "A320neo", price: 74, seats_left: 31 },
    { flight_no: "TP1927", dep: "07:05", arr: "08:00", aircraft: "A321neo", price: 86, seats_left: 18, recommended: 1 },
    { flight_no: "TP1931", dep: "09:10", arr: "10:05", aircraft: "A320neo", price: 62, seats_left: 44, lowest: 1 },
    { flight_no: "TP1937", dep: "12:40", arr: "13:35", aircraft: "A319",    price: 69, seats_left: 52 },
    { flight_no: "TP1943", dep: "18:35", arr: "19:30", aircraft: "A321neo", price: 91, seats_left: 12 },
  ],
};

// Generate the day's flights for a route. Count & spread scale with haul length.
function generateFlights(origin, dest, date) {
  const route = getRoute(origin, dest);
  if (!route) return [];

  // Pinned routes (Daniel's commute) return stable, named flights
  const pin = PINNED[`${origin}-${dest}`];
  if (pin) {
    return pin.map(p => ({
      flight_no: p.flight_no, origin, dest, dep: p.dep, arr: p.arr,
      duration: durLabel(route.duration_min), aircraft: p.aircraft,
      price: p.price, seats_left: p.seats_left, flight_date: date,
      recommended: p.recommended ? 1 : 0, lowest: p.lowest ? 1 : 0,
      status: "scheduled", new_dep: null, new_arr: null,
    }));
  }

  const long = route.duration_min >= 240;
  const rand = rng(`${origin}-${dest}-${date}`);
  const count = long ? 2 + Math.floor(rand() * 2) : 4 + Math.floor(rand() * 3); // long-haul 2-3, short 4-6
  const firstDep = long ? 7 * 60 + Math.floor(rand() * 180) : 6 * 60 + Math.floor(rand() * 60);
  const gap = long ? 240 + Math.floor(rand() * 240) : 120 + Math.floor(rand() * 120);

  const flights = [];
  for (let i = 0; i < count; i++) {
    const depMin = firstDep + i * gap + Math.floor(rand() * 25);
    const arrMin = depMin + route.duration_min;
    const priceJitter = 0.8 + rand() * 0.6;          // ±
    const price = Math.round(route.base_fare * priceJitter);
    const ac = (long ? AIRCRAFT_LONG : AIRCRAFT_SHORT)[Math.floor(rand() * 4)];
    const seats = 6 + Math.floor(rand() * 60);
    const flightNo = "TP" + (100 + Math.floor(rand() * 1899));
    flights.push({
      flight_no: flightNo, origin, dest,
      dep: hhmm(depMin), arr: hhmm(arrMin), _depMin: depMin,
      duration: durLabel(route.duration_min), aircraft: ac,
      price, seats_left: seats, flight_date: date,
      recommended: 0, lowest: 0, status: "scheduled", new_dep: null, new_arr: null,
    });
  }
  flights.sort((a, b) => a._depMin - b._depMin);

  // Lowest fare flag
  const minPrice = Math.min(...flights.map(f => f.price));
  flights.forEach(f => { if (f.price === minPrice) f.lowest = 1; });

  // Personalized recommendation from the customer's own history on this route
  const route_str = `${origin}→${dest}`;
  const hist = db.prepare("SELECT flight_no, dep_time, COUNT(*) c FROM travel_history WHERE user_id=1 AND route=? GROUP BY flight_no ORDER BY c DESC").all(route_str);
  let recIdx = -1;
  if (hist.length) {
    // Prefer a generated flight near the customer's usual departure time
    const usualMin = (() => { const t = hist[0].dep_time?.split(":"); return t ? (+t[0]) * 60 + (+t[1]) : null; })();
    if (usualMin != null) {
      let best = Infinity;
      flights.forEach((f, idx) => { const d = Math.abs(f._depMin - usualMin); if (d < best) { best = d; recIdx = idx; } });
    }
  }
  if (recIdx === -1) recIdx = 0; // default: earliest departure (good for business)
  flights[recIdx].recommended = 1;

  flights.forEach(f => delete f._depMin);
  return flights;
}

module.exports = { generateFlights, getRoute };
