/* ──────────────────────────────────────────────────────────────
   TAP Demo — Express backend
   Run:  node server/server.js          (default port 3000)
   ────────────────────────────────────────────────────────────── */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { db, now, DB_PATH, seedSearches, seedBookings, seedPersonaData, PERSONAS, DEFAULT_PERSONA } = require("./db");
const { sendEmail, SMTP_READY } = require("./email");
const { callClaude, callClaudeAgent, FALLBACKS, hasKey } = require("./claude");
const { generateFlights, getRoute } = require("./search");
const { AIRPORTS } = require("./routes-data");
const { packageFor } = require("./packages");
const whatsapp = require("./whatsapp");
const cityName = (c) => (AIRPORTS[c] && AIRPORTS[c].city) || c;

const app = express();

// Optional sub-path mounting (e.g. BASE_PATH=/tapportal → app served at /tapportal/).
// We strip the prefix from incoming requests so all existing routes still match,
// and serve static assets both at the prefix and at root for safety.
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/$/, "");   // "" or "/tapportal"
if (BASE_PATH) {
  app.use((req, res, next) => {
    if (req.url === BASE_PATH) return res.redirect(BASE_PATH + "/");   // /tapportal → /tapportal/
    if (req.url.startsWith(BASE_PATH + "/") || req.url.startsWith(BASE_PATH + "?")) {
      req.url = req.url.slice(BASE_PATH.length) || "/";
    }
    next();
  });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));   // Twilio posts x-www-form-urlencoded
app.use(express.static(path.join(__dirname, "..", "public")));

const log = (type, payload) =>
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES (?,?,?)").run(type, JSON.stringify(payload || {}), now());
const flightByNo = (no) => db.prepare("SELECT * FROM flights WHERE flight_no=?").get(no);
// Live loyalty tier + boarding group for the active persona (never hardcode "Gold").
const userTier = () => (db.prepare("SELECT tier FROM users WHERE id=1").get() || {}).tier || "Gold";
const boardingGroup = (tier) => `${(tier || "Gold") === "Silver" ? "B" : "A"} (${tier || "Gold"})`;

// Persist generated flights so basket / pay / disrupt all keep working on real rows
function persistFlights(list) {
  const ins = db.prepare(`INSERT INTO flights (flight_no,origin,dest,dep,arr,duration,aircraft,price,seats_left,flight_date,recommended,lowest,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'scheduled')`);
  for (const f of list) {
    const exists = db.prepare("SELECT id FROM flights WHERE flight_no=? AND flight_date=? AND origin=? AND dest=?").get(f.flight_no, f.flight_date, f.origin, f.dest);
    if (exists) {
      db.prepare("UPDATE flights SET dep=?,arr=?,duration=?,aircraft=?,price=?,seats_left=?,recommended=?,lowest=? WHERE id=?")
        .run(f.dep, f.arr, f.duration, f.aircraft, f.price, f.seats_left, f.recommended, f.lowest, exists.id);
    } else {
      ins.run(f.flight_no, f.origin, f.dest, f.dep, f.arr, f.duration, f.aircraft, f.price, f.seats_left, f.flight_date, f.recommended, f.lowest);
    }
  }
}

const REGIONS_ORDER = ["Europe", "North America", "South America", "Africa", "Middle East", "Asia"];

/* ── Airports (autocomplete) & route network ─────────────────── */
app.get("/api/airports", (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  let rows = db.prepare("SELECT * FROM airports ORDER BY city").all();
  if (q) rows = rows.filter(a =>
    a.code.toLowerCase().includes(q) || a.city.toLowerCase().includes(q) || a.country.toLowerCase().includes(q));
  res.json(q ? rows.slice(0, 30) : rows);
});

app.get("/api/routes", (req, res) => {
  const region = req.query.region;
  let rows = db.prepare("SELECT * FROM routes ORDER BY base_fare").all();
  if (region) rows = rows.filter(r => r.region === region);
  // attach city labels
  const ap = (c) => db.prepare("SELECT city,country,region FROM airports WHERE code=?").get(c) || {};
  res.json(rows.map(r => ({ ...r, originCity: ap(r.origin).city, destCity: ap(r.dest).city, destCountry: ap(r.dest).country, destRegion: ap(r.dest).region })));
});

/* Personalized route suggestions — scored from THIS user's real activity:
   flown routes (travel_history), booked destinations, and recent searches. */
app.get("/api/routes/suggested", (req, res) => {
  const ap = (c) => db.prepare("SELECT city,country,region FROM airports WHERE code=?").get(c) || {};
  const allRoutes = db.prepare("SELECT * FROM routes").all();

  // Signals
  const flown = db.prepare("SELECT route, COUNT(*) c, MAX(trip_date) last FROM travel_history WHERE user_id=1 AND route LIKE '%→%' GROUP BY route").all();
  const flownMap = {}; flown.forEach(f => { flownMap[f.route] = { c: f.c, last: f.last }; });
  const bookedDest = {}; db.prepare("SELECT flight_no FROM bookings WHERE user_id=1 AND status != 'cancelled'").all()
    .forEach(b => { const f = db.prepare("SELECT dest FROM flights WHERE flight_no=?").get(b.flight_no); if (f) bookedDest[f.dest] = (bookedDest[f.dest] || 0) + 1; });
  const searchedPair = {}; const searchedDest = {};
  db.prepare("SELECT origin, dest, COUNT(*) c FROM searches WHERE user_id=1 GROUP BY origin, dest").all()
    .forEach(s => { searchedPair[`${s.origin}→${s.dest}`] = s.c; searchedDest[s.dest] = (searchedDest[s.dest] || 0) + s.c; });

  const scored = allRoutes.map(r => {
    const key = `${r.origin}→${r.dest}`;
    let score = 0; const reasons = [];
    if (flownMap[key]) { score += 50 + flownMap[key].c * 8; reasons.push(`Flown ${flownMap[key].c}×`); }
    if (bookedDest[r.dest]) { score += 30 + bookedDest[r.dest] * 5; reasons.push(`Booked recently`); }
    if (searchedPair[key]) { score += 25 + searchedPair[key] * 6; reasons.push(`You searched this ${searchedPair[key]}×`); }
    else if (searchedDest[r.dest]) { score += 12; reasons.push(`Searched ${cityName(r.dest)} ${searchedDest[r.dest]}×`); }
    // Home-airport affinity: routes from Porto (his base) get a nudge
    if (r.origin === "OPO") { score += 6; if (!reasons.length) reasons.push("From your home airport"); }
    if (r.origin === "LIS") { score += 3; }
    return { ...r, originCity: ap(r.origin).city, destCity: ap(r.dest).city, destCountry: ap(r.dest).country, destRegion: ap(r.dest).region, score, reason: reasons.slice(0, 2).join(" · ") || null, reasons };
  });

  const personalized = scored.filter(r => r.score > 9).sort((a, b) => b.score - a.score);
  // Fill out with popular Portugal/Europe routes if the user has little history yet
  const filler = scored.filter(r => r.score <= 9)
    .sort((a, b) => (a.destCountry === "Portugal" ? -1 : 0) - (b.destCountry === "Portugal" ? -1 : 0) || a.base_fare - b.base_fare);

  log("routes_suggested", { personalized: personalized.length });
  res.json({ personalized, filler, hasHistory: personalized.length > 0 });
});

/* ── Flight search: any origin → dest in the network ─────────── */
app.get("/api/search", (req, res) => {
  const origin = (req.query.origin || "OPO").toUpperCase();
  const dest = (req.query.dest || "LIS").toUpperCase();
  const date = req.query.date || "2026-06-15";
  const route = getRoute(origin, dest);
  if (!route) {
    log("search_no_route", { origin, dest });
    return res.json({ ok: false, origin, dest, flights: [], reason: "no_route",
      message: `TAP doesn't fly ${origin} → ${dest} directly in this network. Try another pairing.` });
  }
  const flights = generateFlights(origin, dest, date);
  persistFlights(flights);
  // Re-read from DB so ids are attached (and any disruption state persists)
  const stored = db.prepare("SELECT * FROM flights WHERE origin=? AND dest=? AND flight_date=? ORDER BY dep").all(origin, dest, date);
  // Log the search itself — this is behavioural data the CDP would use
  db.prepare(`INSERT INTO searches (user_id,origin,dest,travel_date,pax,results,device,created_at)
    VALUES (1,?,?,?,?,?,?,?)`).run(origin, dest, date, 1, stored.length, "Web app", now());
  // Keep the cross-channel journey LIVE at the RESULTS stage for this real search.
  const pax = Number(req.query.pax) || 1;
  saveJourney({ origin, dest, date, device: "Web app", stage: "results" });
  // Search-abandonment journey: queue a follow-up. If no booking on this route
  // follows shortly, an offer email goes out too. (Demo timings are compressed.)
  scheduleSearchFollowup(origin, dest, date, stored);
  log("flight_search", { origin, dest, date, results: stored.length });
  res.json({ ok: true, origin, dest, date, route, flights: stored });
});

/* Search-abandonment automation. In production this would be a CDP journey with
   real delays; here the follow-up email is created right away (so it's visible in
   the demo), and an offer email is scheduled a short time later UNLESS a booking
   for the same destination appears first. */
const followupTimers = {};
function scheduleSearchFollowup(origin, dest, date, flights) {
  const low = flights.length ? Math.min(...flights.map(f => f.price)) : 0;
  const originCity = cityName(origin), destCity = cityName(dest);
  // 1) immediate follow-up ("your search is saved")
  sendEmail("search_followup", { origin, dest, originCity, destCity, date, low }).catch(() => {});
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('search_followup_sent',?,?)")
    .run(JSON.stringify({ origin, dest, date, low }), now());
  // 2) offer follow-up after a short delay, only if still no booking to this dest
  const key = `${origin}-${dest}`;
  if (followupTimers[key]) clearTimeout(followupTimers[key]);
  followupTimers[key] = setTimeout(async () => {
    const booked = db.prepare(`SELECT COUNT(*) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no
      WHERE b.user_id=1 AND b.status='confirmed' AND f.dest=? AND b.created_at > ?`).get(dest, date + " 00:00:00").c;
    const recentBooked = db.prepare(`SELECT COUNT(*) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no
      WHERE b.user_id=1 AND b.status!='cancelled' AND f.dest=?`).get(dest).c;
    if (recentBooked > 0) return;   // they booked — no need to chase
    const discount = 15;
    await sendEmail("search_offer", { origin, dest, originCity, destCity, date, low, discount }).catch(() => {});
    db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('search_offer_sent',?,?)")
      .run(JSON.stringify({ origin, dest, date, discount }), now());
  }, 45000);   // 45s in the demo; would be hours/days in production
}

/* ── Profile / personalization data ─────────────────────────── */
app.get("/api/profile", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=1").get();
  const prefs = db.prepare("SELECT * FROM preferences WHERE user_id=1").get();
  const vouchers = db.prepare("SELECT * FROM vouchers WHERE user_id=1 AND status='active'").all();
  const history = db.prepare("SELECT * FROM travel_history WHERE user_id=1 ORDER BY trip_date DESC").all();
  const search = db.prepare("SELECT * FROM synced_searches WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();

  // Most-flown outbound route from the user's HOME airport, computed live
  // (so it adapts to whichever persona is active, and shifts as they book).
  const home = user.home_airport || "OPO";
  const outboundAll = history.filter(h => h.route && h.route.startsWith(home + "→"));
  const routeCounts = {};
  outboundAll.forEach(h => { routeCounts[h.route] = (routeCounts[h.route] || 0) + 1; });
  // Fallback: if no home-airport outbound exists, use the most-flown route overall.
  let topRoute = Object.entries(routeCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topRoute) {
    const allCounts = {};
    history.forEach(h => { if (h.route) allCounts[h.route] = (allCounts[h.route] || 0) + 1; });
    topRoute = Object.entries(allCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || `${home}→LIS`;
  }
  const onTopRoute = history.filter(h => h.route === topRoute);
  const flightCounts = {};
  onTopRoute.forEach(h => { flightCounts[h.flight_no] = (flightCounts[h.flight_no] || 0) + 1; });
  const topFlight = Object.entries(flightCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || onTopRoute[0]?.flight_no || "";

  // Per-destination booking tally across all routes — drives card ranking
  const destCounts = {};
  history.forEach(h => { if (h.route && h.route.includes("→")) { const d = h.route.split("→")[1]; destCounts[d] = (destCounts[d] || 0) + 1; } });

  // Recent searches are behavioural signals too — surface the most-searched destinations
  const searchRows = db.prepare("SELECT dest, COUNT(*) c FROM searches WHERE user_id=1 GROUP BY dest ORDER BY c DESC, MAX(id) DESC").all();
  const searchedDests = searchRows.map(r => ({ code: r.dest, count: r.c }));
  const recentSearches = db.prepare("SELECT origin,dest,travel_date,created_at FROM searches WHERE user_id=1 ORDER BY id DESC LIMIT 5").all();

  // Build a human "usual outbound / usual back" string from real history, and
  // surface the next bookable instance of the usual flight (number + price).
  const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = (d) => { try { return dows[new Date(d).getUTCDay()]; } catch { return ""; } };
  const topOut = onTopRoute.find(h => h.flight_no === topFlight) || onTopRoute[0];
  const reverseRoute = topRoute.split("→").reverse().join("→");
  const backRows = history.filter(h => h.route === reverseRoute);
  const backCounts = {};
  backRows.forEach(h => { backCounts[h.flight_no] = (backCounts[h.flight_no] || 0) + 1; });
  const backFlight = Object.entries(backCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const backRow = backRows.find(h => h.flight_no === backFlight) || backRows[0];
  const usualOut = topOut ? `${dayName(topOut.trip_date)}s · ${topOut.dep_time} (${topOut.flight_no})` : "";
  const usualBack = backRow ? `${dayName(backRow.trip_date)}s · ${backRow.dep_time} (${backRow.flight_no})` : "";
  // Price for the usual flight — from a seeded flights row if present.
  let usualPrice = null;
  try { usualPrice = db.prepare("SELECT price FROM flights WHERE flight_no=? ORDER BY id DESC LIMIT 1").get(topFlight)?.price ?? null; } catch {}
  const [usualOrigin, usualDest] = topRoute.split("→");

  // Recommended next date for the usual flight = the next occurrence of the weekday
  // the customer usually flies it (relative to today, 2026-06-15). Surfaced wherever
  // we offer express checkout of the usual flight (home, web chat, WhatsApp).
  const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let recommendedDate = null, recommendedLabel = "";
  {
    const TODAY = new Date("2026-06-15T00:00:00Z");
    const dow = topOut ? new Date(topOut.trip_date).getUTCDay() : NaN;
    const d = new Date(TODAY);
    if (Number.isNaN(dow)) d.setUTCDate(d.getUTCDate() + 7);
    else { const days = (dow - TODAY.getUTCDay() + 7) % 7 || 7; d.setUTCDate(d.getUTCDate() + days); }
    recommendedDate = d.toISOString().slice(0, 10);
    recommendedLabel = `${dows[d.getUTCDay()]} ${d.getUTCDate()} ${MONS[d.getUTCMonth()]}`;
  }

  const pattern = {
    route: topRoute.replace("→", " ⇄ "),
    topRoute, topFlight,
    origin: usualOrigin, dest: usualDest,
    last: onTopRoute.length,
    matching: flightCounts[topFlight] || 0,
    usualOut, usualBack,
    usualOutNo: topFlight || "", usualBackNo: backFlight || "",
    usualDep: topOut?.dep_time || "",
    usualPrice,
    recommendedDate, recommendedLabel,
    destCounts,
    searchedDests,
  };
  log("api_profile_fetch", { source: "users, preferences, vouchers, travel_history, searches", topRoute, topFlight });
  res.json({ user, prefs, vouchers, history, pattern, syncedSearch: search, recentSearches });
});

/* ── Cross-channel journey state ───────────────────────────────────────────
   One shared, unpaid in-progress journey per customer. Every channel (web, AI
   chat, WhatsApp) writes its current STAGE + selections here as the customer
   progresses, so "Resume" on any channel drops them back at the exact step.
   Stages: search → results → seat → extras → review.  Cleared on payment or
   explicit start-over.                                                        */
const STAGE_ORDER = ["search", "results", "seat", "extras", "review"];
function saveJourney({ origin, dest, date, device, stage, flight_no, seat, items, cabin }) {
  const prev = db.prepare("SELECT * FROM synced_searches WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
  // If this update is for the same route, keep the furthest stage reached (don't regress
  // the badge when a later channel just re-opens an earlier screen) unless selections advance.
  const sameRoute = prev && prev.origin === origin && prev.dest === dest;
  const prevRank = sameRoute ? STAGE_ORDER.indexOf(prev.stage || "results") : -1;
  const newRank = STAGE_ORDER.indexOf(stage || "results");
  const keptStage = newRank >= prevRank ? (stage || "results") : prev.stage;
  const merged = {
    origin, dest,
    date: date || prev?.travel_date || null,
    device: device || prev?.device || "Web app",
    stage: keptStage,
    flight_no: flight_no !== undefined ? flight_no : (sameRoute ? prev?.flight_no : null),
    seat: seat !== undefined ? seat : (sameRoute ? prev?.seat : null),
    items: items !== undefined ? items : (sameRoute && prev?.items_json ? JSON.parse(prev.items_json) : []),
    cabin: cabin || (sameRoute ? prev?.cabin : null) || "Economy",
  };
  db.prepare("DELETE FROM synced_searches WHERE user_id=1").run();
  db.prepare(`INSERT INTO synced_searches (user_id,origin,dest,travel_date,pax,device,created_at,stage,flight_no,seat,items_json,cabin,updated_at)
    VALUES (1,?,?,?,1,?,?,?,?,?,?,?,?)`).run(
      merged.origin, merged.dest, merged.date, merged.device, now(),
      merged.stage, merged.flight_no || null, merged.seat || null,
      JSON.stringify(merged.items || []), merged.cabin, now());
  return merged;
}
function getJourney() {
  const j = db.prepare("SELECT * FROM synced_searches WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
  if (!j) return null;
  return {
    origin: j.origin, dest: j.dest, date: j.travel_date, device: j.device,
    stage: j.stage || "results", flight_no: j.flight_no, seat: j.seat,
    items: j.items_json ? JSON.parse(j.items_json) : [], cabin: j.cabin || "Economy",
    updated_at: j.updated_at || j.created_at,
  };
}
// Read the current journey (web/AI/WhatsApp all poll this to resume).
app.get("/api/journey", (req, res) => { res.json(getJourney() || { stage: null }); });
// Save/advance the journey stage from any channel.
app.post("/api/journey", (req, res) => {
  const { origin, dest, date, device, stage, flight_no, seat, items, cabin } = req.body || {};
  if (!origin || !dest) return res.status(400).json({ ok: false, message: "origin and dest required" });
  const saved = saveJourney({ origin, dest, date, device, stage, flight_no, seat, items, cabin });
  log("journey_saved", { stage: saved.stage, route: `${origin}→${dest}`, flight: saved.flight_no, seat: saved.seat });
  res.json({ ok: true, journey: getJourney() });
});
// Explicit start-over: clear the saved journey.
app.post("/api/journey/clear", (req, res) => {
  db.prepare("DELETE FROM synced_searches WHERE user_id=1").run();
  log("journey_cleared", {});
  res.json({ ok: true });
});

/* Affinity-driven package recommendation. We read the persona's co-branded card
   spend categories from the customer DB, derive the dominant interest, and return
   a matching event+hotel+flight bundle. This mirrors how a CDP turns card-spend
   signals into an experiential offer. */
app.get("/api/recommendation", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=1").get();
  let categories = [];
  try { categories = JSON.parse(user.card_categories || "[]"); } catch {}
  const pkg = packageFor(user.affinity, user.home_airport);
  const topCategory = categories[0]?.name || null;
  log("api_recommendation_fetch", { affinity: user.affinity, derived_from: topCategory, package: pkg?.id });
  res.json({
    affinity: user.affinity,
    affinity_label: user.affinity_label,
    card: { product: user.card_product, brand: user.card_brand, last4: user.card_last4 },
    categories,
    // a short explanation of the derivation, for the UI + Demo Console
    rationale: topCategory
      ? `Your ${user.card_product} shows ${categories[0].share}% of spend in ${topCategory} — so VOYAGER.AI flags you as a ${user.affinity_label}.`
      : `Derived from your ${user.card_product} spend profile.`,
    package: pkg,
  });
});

app.get("/api/flights", (req, res) => {
  const dest = (req.query.dest || "LIS").toUpperCase();
  const origin = (req.query.origin || "OPO").toUpperCase();
  const date = req.query.date || "2026-06-15";
  if (!getRoute(origin, dest)) { log("api_flights_noroute", { origin, dest }); return res.json([]); }
  const flights = generateFlights(origin, dest, date);
  persistFlights(flights);
  const rows = db.prepare("SELECT * FROM flights WHERE origin=? AND dest=? AND flight_date=? ORDER BY dep").all(origin, dest, date);
  log("api_flights_fetch", { origin, dest, count: rows.length });
  res.json(rows);
});
app.get("/api/ancillaries", (req, res) => {
  const anc = db.prepare("SELECT * FROM ancillaries").all();
  // Personalization: how often did the customer buy each ancillary on PAST (completed) trips?
  const past = db.prepare("SELECT items_json FROM bookings WHERE user_id=1 AND status='completed'").all();
  const totalTrips = past.length || 1;
  const counts = {};
  past.forEach(b => { (JSON.parse(b.items_json || "[]")).forEach(code => { counts[code] = (counts[code] || 0) + 1; }); });
  res.json(anc.map(a => {
    const bought = counts[a.code] || 0;
    let reason = null, recommended = false;
    if (bought >= Math.ceil(totalTrips * 0.6)) { recommended = true; reason = `You added this on ${bought} of your last ${totalTrips} trips`; }
    else if (bought > 0) { reason = `Added on ${bought} past trip${bought > 1 ? "s" : ""}`; }
    return { ...a, bought, trips: totalTrips, reason, recommended };
  }));
});

/* Recommended seat from history: the customer's most-used seat on past bookings. */
app.get("/api/seat-recommendation", (req, res) => {
  const past = db.prepare("SELECT seat, COUNT(*) c FROM bookings WHERE user_id=1 AND seat IS NOT NULL GROUP BY seat ORDER BY c DESC").all();
  const top = past[0];
  res.json({
    seat: top ? top.seat : "4C",
    count: top ? top.c : 0,
    total: db.prepare("SELECT COUNT(*) c FROM bookings WHERE user_id=1").get().c,
    reason: top ? `Your usual — seat ${top.seat} on ${top.c} of your trips` : "Front aisle, quick exit",
  });
});
app.get("/api/destinations", (req, res) => {
  const dests = db.prepare("SELECT * FROM destinations").all();
  res.json(dests.map(d => {
    const flownRows = db.prepare("SELECT trip_date, purpose FROM travel_history WHERE user_id=1 AND route LIKE ? ORDER BY trip_date DESC").all(`%→${d.code}`);
    const flown = flownRows.length;
    const booked = db.prepare(`SELECT COUNT(DISTINCT b.id) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no WHERE b.user_id=1 AND b.status!='cancelled' AND f.dest=?`).get(d.code).c;
    const searched = db.prepare("SELECT COUNT(*) c FROM searches WHERE user_id=1 AND dest=?").get(d.code).c;
    const purposes = [...new Set(flownRows.map(r => r.purpose))];
    const leisure = purposes.includes("Leisure");
    let reason;
    if (flown > 0 && searched > 0)
      reason = `You've flown to ${d.city} ${flown}× (${purposes.join("/").toLowerCase()}) and searched it ${searched}× recently — clearly on your mind.`;
    else if (flown > 1)
      reason = `${d.city} is a recurring ${leisure ? "getaway" : "work"} destination for you — ${flown} trips on record${leisure ? ", last one with the family" : ""}.`;
    else if (flown === 1)
      reason = `You flew to ${d.city} once before (${purposes[0]?.toLowerCase()}); we're keeping it within reach.`;
    else if (booked > 0)
      reason = `You recently booked ${d.city}, so we've kept it handy.`;
    else if (searched > 0)
      reason = `You searched ${d.city} ${searched}× in the last week — still comparing options?`;
    else if (d.tag) reason = `Suggested because: ${d.tag.toLowerCase()}.`;
    else reason = `A popular route from your home airport.`;
    return { ...d, origin: "OPO", flown, booked, searched, purposes, reason };
  }));
});

/* ── Persistent basket ───────────────────────────────────────── */
app.get("/api/basket", (req, res) => {
  const b = db.prepare("SELECT * FROM baskets WHERE user_id=1 AND status='open' ORDER BY id DESC LIMIT 1").get();
  res.json(b ? { ...b, items: JSON.parse(b.items_json) } : null);
});
app.post("/api/basket", (req, res) => {
  const { flight_no, items } = req.body;
  db.prepare("UPDATE baskets SET status='superseded' WHERE user_id=1 AND status='open'").run();
  const r = db.prepare("INSERT INTO baskets (user_id,flight_no,items_json,updated_at) VALUES (1,?,?,?)")
    .run(flight_no, JSON.stringify(items || []), now());
  log("basket_saved", { flight_no, items });
  res.json({ id: Number(r.lastInsertRowid), ok: true });
});

/* ── Fare lock & Time-to-Think hold ──────────────────────────── */
app.post("/api/fare-lock", (req, res) => {
  const { flight_no, active } = req.body;
  const f = flightByNo(flight_no);
  if (active) {
    const exp = new Date(Date.now() + 24 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    db.prepare("INSERT INTO fare_locks (user_id,flight_no,locked_price,expires_at) VALUES (1,?,?,?)").run(flight_no, f.price, exp);
    log("fare_locked", { flight_no, price: f.price, expires: exp });
    res.json({ ok: true, expires: exp, price: f.price });
  } else {
    db.prepare("UPDATE fare_locks SET status='released' WHERE flight_no=? AND status='active'").run(flight_no);
    res.json({ ok: true });
  }
});

app.post("/api/hold", async (req, res) => {
  const { flight_no, items, total } = req.body;
  const exp = "Fri 12 Jun, 09:00";
  db.prepare("INSERT INTO holds (user_id,flight_no,items_json,total,expires_at,created_at) VALUES (1,?,?,?,?,?)")
    .run(flight_no, JSON.stringify(items || []), total, exp, now());
  log("hold_created", { flight_no, total, expires: exp });
  const email = await sendEmail("hold_confirmation", { f: flightByNo(flight_no), total, expires: exp });
  res.json({ ok: true, expires: exp, email });
});

/* ── Payment → booking + confirmation email ──────────────────── */
app.post("/api/pay", async (req, res) => {
  const { flight_no, items, total, voucher_amt, miles_used, miles_amt, card_amt, seat } = req.body;
  const pnr = "TP" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const f = flightByNo(flight_no);
  if (!f) { log("pay_unknown_flight", { flight_no }); return res.status(400).json({ ok: false, error: "unknown flight — search the route first" }); }
  const b = db.prepare(`INSERT INTO bookings (pnr,user_id,flight_no,flight_date,seat,items_json,created_at)
    VALUES (?,1,?,?,?,?,?)`).run(pnr, flight_no, f.flight_date, seat || "4C", JSON.stringify(items || []), now());
  db.prepare(`INSERT INTO payments (booking_id,total,voucher_amt,miles_used,miles_amt,card_amt,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(Number(b.lastInsertRowid), total, voucher_amt, miles_used, miles_amt, card_amt, now());
  if (miles_used > 0) db.prepare("UPDATE users SET miles = miles - ? WHERE id=1").run(miles_used);
  if (voucher_amt > 0) db.prepare("UPDATE vouchers SET status='redeemed' WHERE user_id=1 AND status='active'").run();
  db.prepare("UPDATE baskets SET status='purchased' WHERE user_id=1 AND status='open'").run();
  // Booking completed → clear the "resume your search" banner for this destination
  db.prepare("DELETE FROM synced_searches WHERE user_id=1").run();
  // Feed the booking back into travel history → future recommendations learn from it
  db.prepare(`INSERT INTO travel_history (user_id,flight_no,route,trip_date,dep_time,purpose)
    VALUES (1,?,?,?,?,'Business')`).run(flight_no, `${f.origin}→${f.dest}`, f.flight_date, f.dep);
  log("payment_captured", { pnr, total, split: { voucher_amt, miles_used, card_amt }, history_updated: true });
  const email = await sendEmail("booking_confirmation", { f, pnr, pay: { voucher_amt, miles_used, miles_amt, card_amt } });
  res.json({ ok: true, pnr, email });
});

app.get("/api/bookings", (req, res) => {
  const rows = db.prepare("SELECT * FROM bookings WHERE user_id=1 ORDER BY id DESC").all();
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items_json || "[]"), flight: flightByNo(r.flight_no) })));
});

/* ── Disruption: live ops event → AI recovery → email ────────── */
app.post("/api/disrupt", async (req, res) => {
  // Default to the active persona's usual outbound flight, not a hardcoded one.
  const u = db.prepare("SELECT first_name, tier, home_airport FROM users WHERE id=1").get() || {};
  const usual = db.prepare("SELECT flight_no, route FROM travel_history WHERE user_id=1 AND route LIKE ? ORDER BY trip_date DESC LIMIT 1").get((u.home_airport || "OPO") + "→%");
  const flight_no = req.body.flight_no || usual?.flight_no || "TP1927";
  db.prepare("UPDATE flights SET status='delayed', new_dep='08:55', new_arr='09:50' WHERE flight_no=?").run(flight_no);
  let f = flightByNo(flight_no);
  // If that flight isn't in the flights table yet, synthesize a row from history/route.
  if (!f) { const r = (usual?.route || `${u.home_airport||"OPO"}→LIS`).split("→"); f = { flight_no, origin: r[0], dest: r[1], dep: "07:05", new_dep: "08:55", new_arr: "09:50" }; }
  const routeStr = `${cityName(f.origin)}→${cityName(f.dest)}`;
  // pick an alternative flight on the same route from the flights table
  const alt = db.prepare("SELECT flight_no, dep, arr FROM flights WHERE origin=? AND dest=? AND flight_no!=? ORDER BY dep LIMIT 1").get(f.origin, f.dest, flight_no) || { flight_no: "TP1931", dep: "09:10", arr: "10:05" };
  log("ops_disruption", { flight_no, cause: "late inbound aircraft", new_dep: f.new_dep });

  let recovery, ai = "live";
  try {
    recovery = await callClaude([{ role: "user", content:
      `LIVE OPS EVENT: ${flight_no} ${f.origin}→${f.dest} (${routeStr}) is delayed ~1h50, late inbound aircraft. New estimate ${f.new_dep}, landing ${f.new_arr}. The traveller is ${u.first_name} (${u.tier}).
Write their proactive disruption notification. Return JSON exactly:
{"headline": string, "message": string (2-3 sentences, personal, transparent about the cause, reassuring, no fluff), "options":[{"id":"${flight_no}","label": string,"detail": string},{"id":"${alt.flight_no}","label": string,"detail": string}], "compensation": string (one line, ${u.tier} + EU261 entitlements)}.
Alternative ${alt.flight_no} departs ${alt.dep} arrives ${alt.arr}; keeping ${flight_no} lands ${f.new_arr}.` }],
      { json: true });
  } catch { recovery = FALLBACKS.recovery; ai = "cached"; }

  const email = await sendEmail("disruption", { f, recovery });
  const wa = await whatsapp.pushDisruption(f, recovery);   // proactive WhatsApp with one-tap rebook buttons
  res.json({ recovery, email, ai });
});

/* ── Booking management (used by portal + WhatsApp) ──────────── */
app.post("/api/bookings/ancillary", async (req, res) => {
  const { code } = req.body;
  const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
  const a = db.prepare("SELECT * FROM ancillaries WHERE code=?").get(code);
  if (!b || !a) return res.json({ ok: false });
  const items = JSON.parse(b.items_json || "[]");
  if (!items.includes(code)) items.push(code);
  db.prepare("UPDATE bookings SET items_json=? WHERE id=?").run(JSON.stringify(items), b.id);
  log("ancillary_added", { pnr: b.pnr, code, price: a.price, channel: "whatsapp/portal" });
  res.json({ ok: true, pnr: b.pnr, name: a.name, price: a.price });
});

app.post("/api/bookings/cancel", async (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
  if (!b) return res.json({ ok: false });
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
  // Instant refund: restore miles + voucher from the payment record
  const pay = db.prepare("SELECT * FROM payments WHERE booking_id=?").get(b.id);
  if (pay) {
    if (pay.miles_used > 0) db.prepare("UPDATE users SET miles = miles + ? WHERE id=1").run(pay.miles_used);
    if (pay.voucher_amt > 0) db.prepare("UPDATE vouchers SET status='active' WHERE user_id=1").run();
  }
  log("booking_cancelled", { pnr: b.pnr, refund: pay ? { miles: pay.miles_used, voucher: pay.voucher_amt, card: pay.card_amt } : null });
  const email = await sendEmail("cancelled", { b, pay });
  res.json({ ok: true, pnr: b.pnr, email });
});

/* ── WhatsApp webhook (Twilio Sandbox) ───────────────────────────
   Twilio POSTs application/x-www-form-urlencoded with fields incl.
   From="whatsapp:+91...", Body="1". We ack immediately with empty
   TwiML (200) and process the message; our reply is sent via the
   Twilio REST API inside handleIncoming, not via TwiML. A GET on the
   same path just returns OK so you can sanity-check it in a browser. */
app.get("/api/whatsapp/webhook", (_req, res) => res.status(200).send("TAP WhatsApp webhook OK"));
app.post("/api/whatsapp/webhook", async (req, res) => {
  res.set("Content-Type", "text/xml").status(200).send("<Response></Response>");  // ack fast, no TwiML reply
  try { await whatsapp.handleIncoming({ from: req.body.From, text: req.body.Body }); }
  catch (e) { log("wa_webhook_error", { error: e.message }); }
});

app.post("/api/rebook", async (req, res) => {
  const { option } = req.body;
  const bk = db.prepare("SELECT * FROM bookings WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
  const pnr = bk ? bk.pnr : "TPX9D4";
  if (bk && option.id !== bk.flight_no) db.prepare("UPDATE bookings SET flight_no=?, status='rebooked' WHERE id=?").run(option.id, bk.id);
  log("rebooked", { pnr, option });
  const email = await sendEmail("rebooked", { option, pnr });
  res.json({ ok: true, email });
});

app.post("/api/checkin", (req, res) => {
  const { auto } = req.body;
  db.prepare("UPDATE preferences SET auto_checkin=? WHERE user_id=1").run(auto ? 1 : 0);
  log("auto_checkin_toggled", { auto });
  res.json({ ok: true });
});

/* Check in the current active booking (issues boarding pass). Verifies real state. */
app.post("/api/bookings/checkin", (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
  if (!b) return res.json({ ok: false, state: "no_booking", message: "No upcoming flight to check in for." });
  const f = flightByNo(b.flight_no) || {};
  if (b.checked_in) return res.json({ ok: true, state: "already_checked_in", pnr: b.pnr, seat: b.seat, group: boardingGroup(userTier()), route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: b.flight_date });
  db.prepare("UPDATE bookings SET checked_in=1 WHERE id=?").run(b.id);
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('checkin',?,?)").run(JSON.stringify({ pnr: b.pnr, channel: "web", doc: req.body?.doc_id || null }), now());
  log("booking_checkin", { pnr: b.pnr });
  res.json({ ok: true, state: "checked_in_now", pnr: b.pnr, seat: b.seat || "4C", group: boardingGroup(userTier()), route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: b.flight_date });
});

/* ── AI endpoints ────────────────────────────────────────────── */
app.post("/api/ai/plan", async (req, res) => {
  const q = (req.body.prompt || "").slice(0, 500);
  const u = db.prepare("SELECT first_name, home_airport, affinity, affinity_label, card_product FROM users WHERE id=1").get() || {};
  let categories = []; try { categories = JSON.parse((db.prepare("SELECT card_categories FROM users WHERE id=1").get()||{}).card_categories || "[]"); } catch {}
  const pkg = packageFor(u.affinity, u.home_airport);
  log("ai_planner_query", { q, affinity: u.affinity });
  try {
    const plan = await callClaude([{ role: "user", content:
      `${u.first_name} (home airport ${u.home_airport}) asks the AI itinerary planner: "${q}".
${u.affinity_label ? `Context: ${u.first_name}'s co-branded TAP card spend marks them a ${u.affinity_label}${categories[0] ? ` (${categories[0].share}% ${categories[0].name})` : ""}. If the request is open-ended ("what should I do", "ideas", "this weekend", "surprise me") or matches that interest, weave in the relevant experience${pkg ? ` — e.g. ${pkg.event} in ${pkg.city} (${pkg.badge})` : ""} and note it pairs ticket + hotel + return flight.` : ""}
Build a concrete plan using realistic TAP flights from ${u.home_airport} (short-haul shuttles run frequently ~55–90min, €60–120; long-haul where relevant; other routes plausible).
Return JSON exactly: {"title": string, "summary": string (1 sentence, personal, use their first name), "legs":[{"day": string, "flight": string, "route": string, "times": string, "why": string (tie to their pattern/interest)}], "tip": string} with 2-4 legs.` }],
      { json: true });
    res.json({ plan, ai: "live" });
  } catch { res.json({ plan: FALLBACKS.plan, ai: "cached" }); }
});

app.post("/api/ai/chat", async (req, res) => {
  const messages = (req.body.messages || []).slice(-12);
  log("ai_chat_message", { last: messages[messages.length - 1]?.content?.slice(0, 120) });
  try { res.json({ reply: await callClaude(messages), ai: "live" }); }
  catch { res.json({ reply: FALLBACKS.chat, ai: "cached" }); }
});

/* ── Agentic chat: Claude calls real tools that read/write the same
   DB and emit UI directives. Returns { reply, cards, command, ai }.
   `cards` render inline in the chat; `command` tells the main screen
   what to do (chat is primary, screen follows). ─────────────────── */
const AGENT_TOOLS = [
  { name: "search_flights", description: "Search TAP flights for a SPECIFIC route (origin + destination) and date. Only call this when you know BOTH the origin and the destination. If the customer hasn't said where they want to go, do NOT call this — call list_destinations or ask them first. Never assume or default the destination. Dates like 'next Friday' resolve to YYYY-MM-DD (today is 2026-06-15).",
    input_schema: { type: "object", properties: {
      origin: { type: "string", description: "Origin IATA code, e.g. OPO. If the customer didn't specify an origin, use the customer's home airport." },
      dest: { type: "string", description: "Destination IATA code, e.g. LIS, MAD, CDG. REQUIRED — never guess this. If unknown, call list_destinations instead." },
      date: { type: "string", description: "Travel date YYYY-MM-DD. Use 2026-06-15 (next Monday) only if the customer gave no date." },
    }, required: ["origin", "dest"] } },
  { name: "list_destinations", description: "List the real cities TAP flies to FROM a given origin airport. Use this whenever the customer asks where they can fly from a city, asks for 'options from <city>' without naming a destination, or asks a factual question like 'do we only fly to X from Y?'. Returns the actual route network from the database.",
    input_schema: { type: "object", properties: {
      origin: { type: "string", description: "Origin IATA code, e.g. LIS, OPO, MAD." },
    }, required: ["origin"] } },
  { name: "get_suggestions", description: "Get the customer's personalized suggested destinations, computed from their real flown/booked/searched history. Use when they ask 'where should I go' or for ideas (NOT for factual 'where do we fly from X' questions — use list_destinations for those).",
    input_schema: { type: "object", properties: {} } },
  { name: "select_flight", description: "Select a specific flight by its flight number (from a prior search) and put it in the basket. Use when the customer picks one.",
    input_schema: { type: "object", properties: { flight_no: { type: "string" } }, required: ["flight_no"] } },
  { name: "get_flight_info", description: "Look up details and seat availability for a SPECIFIC flight number the customer mentions (e.g. 'does TP1481 have availability tomorrow', 'tell me about TP501'). Use this instead of asking the customer which destination — the flight number already identifies the route. Returns the flight's route, times, price, cabin classes and seat availability.",
    input_schema: { type: "object", properties: {
      flight_no: { type: "string", description: "The flight number, e.g. TP1481." },
      date: { type: "string", description: "Optional travel date YYYY-MM-DD; 'tomorrow' relative to today (2026-06-15) is 2026-06-16." },
    }, required: ["flight_no"] } },
  { name: "add_extras", description: "Add ancillary extras to the current basket/booking by their codes (e.g. wifi, meal, lounge, xbag, transfer). Returns the updated item list AND the recomputed basket total.",
    input_schema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } }, required: ["codes"] } },
  { name: "remove_extras", description: "Remove ancillary extras from the current basket by their codes (e.g. meal, wifi, bag). Use whenever the customer says they don't want something, e.g. 'remove the meal', 'I don't want wifi', 'drop the bag'. Returns the updated item list AND the recomputed basket total — ALWAYS quote the new total from this result, never the old one.",
    input_schema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } }, required: ["codes"] } },
  { name: "list_seats", description: "List available seats and cabin classes (Business, Premium Economy, Economy) for the currently selected flight or the customer's current booking. Use when the customer asks what seating options are available or wants to see the seat map.",
    input_schema: { type: "object", properties: { cabin: { type: "string", description: "Optional filter: 'business', 'premium', or 'economy'." } } } },
  { name: "change_seat", description: "Change the customer's seat on the currently selected flight or their current booking — you CAN do this in chat. Use when they say 'change my seat', 'move me to a window', 'I want 12A', etc. Validates the seat exists and is free, updates it, and reports the new cabin and any fare difference. Only fall back to the website if the seat is taken or invalid after offering alternatives.",
    input_schema: { type: "object", properties: {
      seat: { type: "string", description: "Specific seat like '12A'. Omit if the customer only gave a preference." },
      preference: { type: "string", description: "If no specific seat: 'window', 'aisle', 'business', 'premium', 'extra legroom', 'front'." },
    } } },
  { name: "checkout", description: "Pay for the currently selected flight using the customer's saved profile (voucher + miles + card). Creates a real booking and sends a confirmation email. Only call after a flight is selected and the customer confirms they want to pay.",
    input_schema: { type: "object", properties: { use_voucher: { type: "boolean" }, use_miles: { type: "boolean" } } } },
  { name: "get_booking", description: "Get the customer's current/latest active booking with status. Use for 'my booking', 'am I checked in', 'is my flight on time'.",
    input_schema: { type: "object", properties: {} } },
  { name: "get_wallet", description: "Get the customer's LIVE Miles&Go balance and voucher status from the database. Use whenever they ask about miles, points, voucher, balance, or 'what can I pay with' / 'how much are my miles worth'. Always call this rather than answering from memory — balances change after bookings and cancellations.",
    input_schema: { type: "object", properties: {} } },
  { name: "get_recommendation", description: "Get the customer's personalized experiential PACKAGE — derived from their co-branded TAP credit-card spend. Each customer has an affinity (football / golf / music) and a matching bundle of event ticket + hotel + return flight. Use when they ask 'any packages for me', 'what should I do this weekend', 'recommend something', 'anything fun in <city>', or react to their interest. Returns the affinity, the rationale (which card-spend category drove it), and the full package with prices (and any add-on like a golf-bag).",
    input_schema: { type: "object", properties: {} } },
  { name: "get_journey", description: "Get the customer's UNFINISHED booking journey shared across web, this chat, and WhatsApp. Use when they say 'where was I', 'continue/resume my booking', 'pick up where I left off', 'did I have something going', or otherwise reference an in-progress booking. Returns the stage they left at (results/seat/extras/review), the route, and their selections (flight, seat, add-ons). After calling it, re-select that flight with select_flight if one was chosen, then guide them from that exact step — do NOT restart from scratch.",
    input_schema: { type: "object", properties: {} } },
  { name: "express_usual", description: "Open the 2-step Express Checkout for the customer's USUAL flight — their recurring route with seat, bags, saved card and tier perks pre-filled. Use when they say 'book my usual', 'express checkout my usual flight', 'rebook my regular route'. Returns the route, the usual flight number and the recommended next date; the app then opens Express Checkout.",
    input_schema: { type: "object", properties: {} } },
  { name: "check_in", description: "Check the customer in for their current active booking. Issues the boarding pass. Use when they say 'check me in' or 'check in'.",
    input_schema: { type: "object", properties: {} } },
  { name: "cancel_booking", description: "Cancel the customer's current active booking with an instant refund (miles restored, voucher reactivated, card amount returned). Only call after the customer clearly confirms they want to cancel.",
    input_schema: { type: "object", properties: { confirm: { type: "boolean", description: "Must be true — the customer has confirmed the cancellation." } }, required: ["confirm"] } },
];

// tiny per-process agent memory (single demo user)
// Per-session agent state so concurrent users / channels don't clobber each
// other's "last search" and "selected flight". Keyed by a sessionId the client
// passes (web uses a per-tab id, WhatsApp uses the phone number).
const agentSessions = {};
const getSession = (id) => (agentSessions[id || "default"] = agentSessions[id || "default"] || { lastSearch: null, selected: null });

// ── Cabin layout shared by the seat tools (mirrors the web SeatMap) ──
const SEAT_CABINS = [
  { id: "business", label: "Business", rows: [1, 2, 3], cols: ["A", "C", "D", "F"], basePrice: 90, freeFor: ["Platinum"] },
  { id: "premium", label: "Premium Economy", rows: [4, 5, 6, 7], cols: ["A", "B", "C", "D", "E", "F"], basePrice: 18, freeFor: ["Platinum", "Gold"] },
  { id: "economy", label: "Economy", rows: Array.from({ length: 23 }, (_, i) => i + 8), cols: ["A", "B", "C", "D", "E", "F"], basePrice: 0, frontRows: { min: 8, max: 10, price: 8 } },
];
const OCCUPIED = ["1C","2D","3A","4F","5B","6C","7E","9A","10C","11F","12B","14A","16C","18D","20A","22F","24B","26C","28E"];
function cabinForRow(row) { return SEAT_CABINS.find(c => c.rows.includes(row)); }
function seatExists(seat) {
  const m = (seat || "").toUpperCase().match(/^(\d{1,2})([A-F])$/); if (!m) return false;
  const row = parseInt(m[1]), col = m[2]; const c = cabinForRow(row);
  return !!(c && c.cols.includes(col));
}
function seatPrice(seat, tier) {
  const row = parseInt(seat); const c = cabinForRow(row); if (!c) return 0;
  if (c.freeFor && c.freeFor.includes(tier)) return 0;
  if (c.id === "economy" && c.frontRows && row >= c.frontRows.min && row <= c.frontRows.max) return c.frontRows.price;
  return c.basePrice || 0;
}
function seatCabinLabel(seat) { const c = cabinForRow(parseInt(seat)); return c ? c.label : "Economy"; }
function prefSeat() { return (db.prepare("SELECT seat FROM bookings WHERE user_id=1 AND seat IS NOT NULL GROUP BY seat ORDER BY COUNT(*) DESC").get() || {}).seat || "4C"; }
// Compute a basket's live total: flight fare + sum of paid ancillaries currently in the basket.
function basketTotal(sel) {
  const f = flightByNo(sel.flight_no) || {};
  const fare = f.price || 0;
  const anc = db.prepare("SELECT code,name,price FROM ancillaries").all();
  const named = anc.filter(a => (sel.items || []).includes(a.code));
  const extras = named.reduce((s, a) => s + (a.price || 0), 0);
  return { fare, extras: +extras.toFixed(2), total: +(fare + extras).toFixed(2), named };
}
function firstFreeSeat(pref, tier) {
  // pref: 'window'(A/F), 'aisle'(C/D), 'business', 'premium', 'extra legroom'/'front'
  let cabins = SEAT_CABINS;
  if (/business/.test(pref)) cabins = SEAT_CABINS.filter(c => c.id === "business");
  else if (/premium/.test(pref)) cabins = SEAT_CABINS.filter(c => c.id === "premium");
  const wantCols = /window/.test(pref) ? ["A", "F"] : /aisle/.test(pref) ? ["C", "D"] : null;
  const frontFirst = /front|legroom/.test(pref);
  for (const c of cabins) {
    const rows = frontFirst ? c.rows : c.rows;
    for (const row of rows) {
      const cols = wantCols ? c.cols.filter(x => wantCols.includes(x)) : c.cols;
      for (const col of cols) { const s = `${row}${col}`; if (!OCCUPIED.includes(s)) return s; }
    }
  }
  return null;
}

function agentRunTool(name, input, session) {
  session = session || getSession("default");
  if (name === "search_flights") {
    const origin = (input.origin || "OPO").toUpperCase();
    const dest = (input.dest || "").toUpperCase();
    // Never guess a destination — tell the agent to ask or list instead.
    if (!dest) return { ok: false, need: "destination", message: "No destination was given. Ask the customer where they want to go, or call list_destinations to show the options from their origin. Do not assume a destination." };
    const date = input.date || "2026-06-15";
    const route = getRoute(origin, dest);
    if (!route) {
      const dests = (db.prepare("SELECT dest FROM routes WHERE origin=?").all(origin) || []).map(r => r.dest);
      return { ok: false, message: `TAP doesn't fly ${cityName(origin)}→${cityName(dest)} in this network.`, available_destinations: dests.map(c => ({ code: c, city: cityName(c) })) };
    }
    const flights = generateFlights(origin, dest, date);
    persistFlights(flights);
    const stored = db.prepare("SELECT * FROM flights WHERE origin=? AND dest=? AND flight_date=? ORDER BY dep").all(origin, dest, date);
    db.prepare(`INSERT INTO searches (user_id,origin,dest,travel_date,pax,results,device,created_at) VALUES (1,?,?,?,?,?,?,?)`)
      .run(origin, dest, date, 1, stored.length, "Chat agent", now());
    // Live "continue your last search" banner — record journey at the RESULTS stage
    saveJourney({ origin, dest, date, device: "Chat agent", stage: "results" });
    scheduleSearchFollowup(origin, dest, date, stored);
    log("agent_search", { origin, dest, date, results: stored.length });
    session.lastSearch = { origin, dest, date, flights: stored };
    return { ok: true, origin, dest, date, city: cityName(dest),
      flights: stored.map(f => ({ flight_no: f.flight_no, dep: f.dep, arr: f.arr, price: f.price, status: f.status, recommended: !!f.recommended })) };
  }
  if (name === "list_destinations") {
    const origin = (input.origin || "OPO").toUpperCase();
    const rows = db.prepare("SELECT dest FROM routes WHERE origin=?").all(origin);
    if (!rows.length) return { ok: false, message: `No routes found from ${cityName(origin)} (${origin}). Check the airport code.` };
    const dests = rows.map(r => ({ code: r.dest, city: cityName(r.dest) }))
      .sort((a, b) => a.city.localeCompare(b.city));
    // mark which ones the customer has flown, for a personal touch
    dests.forEach(d => {
      d.flown = db.prepare("SELECT COUNT(*) c FROM travel_history WHERE user_id=1 AND route LIKE ?").get(`%→${d.code}`).c;
    });
    log("agent_list_destinations", { origin, count: dests.length });
    return { ok: true, origin, originCity: cityName(origin), count: dests.length, destinations: dests };
  }
  if (name === "get_suggestions") {
    const sug = db.prepare("SELECT * FROM destinations").all().slice(0, 6).map(d => {
      const flown = db.prepare("SELECT COUNT(*) c FROM travel_history WHERE user_id=1 AND route LIKE ?").get(`%→${d.code}`).c;
      const searched = db.prepare("SELECT COUNT(*) c FROM searches WHERE user_id=1 AND dest=?").get(d.code).c;
      return { code: d.code, city: d.city, flown, searched };
    });
    return { ok: true, suggestions: sug };
  }
  if (name === "select_flight") {
    const f = flightByNo((input.flight_no || "").toUpperCase());
    if (!f) return { ok: false, message: "That flight number isn't in the latest results — search the route first." };
    const auto = db.prepare("SELECT code FROM ancillaries WHERE auto=1").all().map(a => a.code);
    db.prepare("UPDATE baskets SET status='superseded' WHERE user_id=1 AND status='open'").run();
    db.prepare("INSERT INTO baskets (user_id,flight_no,items_json,updated_at) VALUES (1,?,?,?)").run(f.flight_no, JSON.stringify(auto), now());
    session.selected = { flight_no: f.flight_no, items: auto, seat: prefSeat() };
    saveJourney({ origin: f.origin, dest: f.dest, date: f.flight_date, device: "Chat agent", stage: "seat", flight_no: f.flight_no, items: auto });
    log("agent_select", { flight_no: f.flight_no });
    return { ok: true, flight_no: f.flight_no, route: `${cityName(f.origin)}→${cityName(f.dest)}`, dep: f.dep, arr: f.arr, price: f.price, seat: session.selected.seat, auto_extras: auto };
  }
  if (name === "get_flight_info") {
    const no = (input.flight_no || "").toUpperCase().replace(/\s+/g, "");
    // Look up the flight in any prior search results (the flights table).
    let f = db.prepare("SELECT * FROM flights WHERE UPPER(flight_no)=? ORDER BY id DESC LIMIT 1").get(no);
    if (!f) return { ok: false, flight_no: no, message: `I don't have ${no} in the current results. Tell me the route or search it and I'll pull live availability.` };
    // Deterministic-but-realistic seat availability per cabin for this flight.
    const seed = [...no].reduce((s, c) => s + c.charCodeAt(0), 0);
    const business = 2 + (seed % 6), premium = 5 + (seed % 12), economy = 20 + (seed % 90);
    const total = business + premium + economy;
    return { ok: true, flight_no: f.flight_no, origin: f.origin, dest: f.dest,
      route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: f.flight_date, dep: f.dep, arr: f.arr,
      price: f.price, aircraft: f.aircraft, status: f.status || "scheduled",
      availability: { total_seats_left: total, business, premium_economy: premium, economy },
      note: total > 0 ? `Yes — ${total} seats available across Business (${business}), Premium (${premium}) and Economy (${economy}).` : "This flight is full." };
  }
  if (name === "add_extras") {
    const sel = session.selected;
    if (!sel) return { ok: false, message: "No flight selected yet." };
    const codes = (input.codes || []).map(c => c.toLowerCase());
    sel.items = [...new Set([...sel.items, ...codes])];
    db.prepare("UPDATE baskets SET items_json=? WHERE user_id=1 AND status='open'").run(JSON.stringify(sel.items));
    const basket = basketTotal(sel);
    const af = flightByNo(sel.flight_no) || {};
    saveJourney({ origin: af.origin, dest: af.dest, date: af.flight_date, device: "Chat agent", stage: "extras", flight_no: sel.flight_no, seat: sel.seat, items: sel.items });
    log("agent_extras", { flight_no: sel.flight_no, items: sel.items, total: basket.total });
    return { ok: true, items: basket.named, fare: basket.fare, extras_total: basket.extras, total: basket.total,
      note: `Basket total is now €${basket.total.toFixed(2)} (fare €${basket.fare} + extras €${basket.extras.toFixed(2)}). Quote this total.` };
  }
  if (name === "remove_extras") {
    const sel = session.selected;
    if (!sel) return { ok: false, message: "No flight selected yet." };
    const codes = (input.codes || []).map(c => c.toLowerCase());
    // Don't allow removing the seat itself via this tool; seat is managed separately.
    const removable = codes.filter(c => c !== "seat");
    const before = sel.items.slice();
    sel.items = sel.items.filter(c => !removable.includes(c));
    const removed = before.filter(c => !sel.items.includes(c));
    db.prepare("UPDATE baskets SET items_json=? WHERE user_id=1 AND status='open'").run(JSON.stringify(sel.items));
    const basket = basketTotal(sel);
    const rf = flightByNo(sel.flight_no) || {};
    saveJourney({ origin: rf.origin, dest: rf.dest, date: rf.flight_date, device: "Chat agent", stage: "extras", flight_no: sel.flight_no, seat: sel.seat, items: sel.items });
    log("agent_extras_removed", { flight_no: sel.flight_no, removed, items: sel.items, total: basket.total });
    return { ok: true, removed, items: basket.named, fare: basket.fare, extras_total: basket.extras, total: basket.total,
      note: removed.length
        ? `Removed ${removed.join(", ")}. New basket total is €${basket.total.toFixed(2)} (fare €${basket.fare} + extras €${basket.extras.toFixed(2)}). ALWAYS quote this new total.`
        : `Nothing matched to remove; basket total stays €${basket.total.toFixed(2)}.` };
  }
  if (name === "list_seats") {
    const tier = (db.prepare("SELECT tier FROM users WHERE id=1").get() || {}).tier || "Gold";
    const cur = session.selected?.seat || prefSeat();
    const want = (input.cabin || "").toLowerCase();
    const cabins = SEAT_CABINS
      .filter(c => !want || c.id.startsWith(want) || c.label.toLowerCase().includes(want))
      .map(c => {
        const free = c.rows.flatMap(r => c.cols.map(col => `${r}${col}`)).filter(s => !OCCUPIED.includes(s));
        const price = seatPrice(`${c.rows[0]}${c.cols[0]}`, tier);
        return { cabin: c.label, price_from: price, included: price === 0, examples: free.slice(0, 6), seats_available: free.length };
      });
    return { ok: true, current_seat: cur, current_cabin: seatCabinLabel(cur), tier, cabins,
      note: `You're in ${cur} (${seatCabinLabel(cur)}). Business and Premium Economy are included with ${tier}; Economy front rows are €8. Tell me a seat (e.g. 12A) or a preference (window, aisle, business) and I'll move you.` };
  }
  if (name === "change_seat") {
    const tier = (db.prepare("SELECT tier FROM users WHERE id=1").get() || {}).tier || "Gold";
    const cur = session.selected?.seat || prefSeat();
    let target = (input.seat || "").toUpperCase().replace(/\s+/g, "");
    if (!target && input.preference) target = firstFreeSeat(input.preference.toLowerCase(), tier);
    if (!target) return { ok: false, message: "Tell me a specific seat (like 12A) or a preference (window, aisle, business) and I'll move you." };
    if (!seatExists(target)) return { ok: false, message: `${target} isn't a seat on this aircraft. Seats run rows 1–30, columns A–F.` };
    if (OCCUPIED.includes(target)) {
      const alt = firstFreeSeat(/[AF]$/.test(target) ? "window" : /[CD]$/.test(target) ? "aisle" : "", tier);
      return { ok: false, seat: target, taken: true, suggestion: alt, message: `${target} is taken. ${alt ? `${alt} is free and similar — want that instead?` : "Try another seat."}` };
    }
    const oldPrice = seatPrice(cur, tier), newPrice = seatPrice(target, tier), diff = +(newPrice - oldPrice).toFixed(2);
    // Persist: update the basket seat (pre-purchase) and/or the active booking seat.
    if (session.selected) session.selected.seat = target;
    db.prepare("UPDATE bookings SET seat=? WHERE user_id=1 AND status='confirmed'").run(target);
    if (session.selected) { const cf = flightByNo(session.selected.flight_no) || {}; saveJourney({ origin: cf.origin, dest: cf.dest, date: cf.flight_date, device: "Chat agent", stage: "extras", flight_no: session.selected.flight_no, seat: target, items: session.selected.items }); }
    log("agent_change_seat", { from: cur, to: target, cabin: seatCabinLabel(target), diff });
    return { ok: true, from: cur, seat: target, cabin: seatCabinLabel(target),
      price: newPrice, included: newPrice === 0, fare_diff: diff,
      note: `Moved you to ${target} (${seatCabinLabel(target)})${newPrice === 0 ? ", included with " + tier : ", €" + newPrice}${diff > 0 ? ` (+€${diff})` : diff < 0 ? ` (−€${-diff})` : ""}.` };
  }
  if (name === "checkout") {
    let sel = session.selected;
    if (!sel) {
      // Fall back to the open basket (e.g. express started from a chip/home didn't run
      // select_flight in this chat session), then to the customer's usual flight.
      const b = db.prepare("SELECT flight_no, items_json FROM baskets WHERE user_id=1 AND status='open' ORDER BY id DESC LIMIT 1").get();
      if (b && b.flight_no) { let it = []; try { it = JSON.parse(b.items_json || "[]"); } catch {} sel = { flight_no: b.flight_no, items: it, seat: prefSeat() }; }
    }
    if (!sel) {
      const home = (db.prepare("SELECT home_airport FROM users WHERE id=1").get() || {}).home_airport || "OPO";
      const row = db.prepare("SELECT route FROM travel_history WHERE user_id=1 AND route LIKE ? GROUP BY route ORDER BY COUNT(*) DESC LIMIT 1").get(home + "→%")
        || db.prepare("SELECT route FROM travel_history WHERE user_id=1 GROUP BY route ORDER BY COUNT(*) DESC LIMIT 1").get();
      const fr = row ? db.prepare("SELECT flight_no FROM travel_history WHERE user_id=1 AND route=? GROUP BY flight_no ORDER BY COUNT(*) DESC LIMIT 1").get(row.route) : null;
      const uf = fr ? flightByNo((fr.flight_no || "").toUpperCase()) : null;
      if (uf) { const auto = db.prepare("SELECT code FROM ancillaries WHERE auto=1").all().map(a => a.code); sel = { flight_no: uf.flight_no, items: auto, seat: prefSeat() }; }
    }
    if (!sel) return { ok: false, message: "No flight selected to pay for. Tell me where you'd like to fly, or tap Express checkout for your usual flight." };
    const f = flightByNo(sel.flight_no);
    const basket = basketTotal(sel);
    const gross = basket.total;
    const seat = sel.seat || prefSeat();
    const activeVoucher = db.prepare("SELECT amount FROM vouchers WHERE user_id=1 AND status='active' ORDER BY id DESC LIMIT 1").get();
    const voucher_amt = input.use_voucher === false ? 0 : Math.min(activeVoucher?.amount || 0, gross);
    const miles_used = input.use_miles === false ? 0 : 6000;
    const miles_amt = miles_used / 1000 * 3;  // 6000 miles ≈ €18
    const card_amt = Math.max(0, +(gross - voucher_amt - miles_amt).toFixed(2));
    const pnr = "TP" + Math.random().toString(36).slice(2, 6).toUpperCase();
    const b = db.prepare(`INSERT INTO bookings (pnr,user_id,flight_no,flight_date,seat,items_json,created_at) VALUES (?,1,?,?,?,?,?)`)
      .run(pnr, f.flight_no, f.flight_date, seat, JSON.stringify(sel.items), now());
    db.prepare(`INSERT INTO payments (booking_id,total,voucher_amt,miles_used,miles_amt,card_amt,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(Number(b.lastInsertRowid), gross, voucher_amt, miles_used, miles_amt, card_amt, now());
    if (miles_used > 0) db.prepare("UPDATE users SET miles = miles - ? WHERE id=1").run(miles_used);
    if (voucher_amt > 0) db.prepare("UPDATE vouchers SET status='redeemed' WHERE user_id=1 AND status='active'").run();
    db.prepare("UPDATE baskets SET status='purchased' WHERE user_id=1 AND status='open'").run();
    db.prepare("DELETE FROM synced_searches WHERE user_id=1").run();
    db.prepare(`INSERT INTO travel_history (user_id,flight_no,route,trip_date,dep_time,purpose) VALUES (1,?,?,?,?,'Business')`)
      .run(f.flight_no, `${f.origin}→${f.dest}`, f.flight_date, f.dep);
    log("agent_checkout", { pnr, gross, split: { voucher_amt, miles_used, card_amt } });
    sendEmail("booking_confirmation", { f, pnr, pay: { voucher_amt, miles_used, miles_amt, card_amt } });
    session.selected = null;
    return { ok: true, pnr, total: gross, split: { voucher: voucher_amt, miles: miles_used, miles_eur: miles_amt, card: card_amt }, route: `${cityName(f.origin)}→${cityName(f.dest)}`, dep: f.dep };
  }
  if (name === "get_wallet") {
    const u = db.prepare("SELECT miles, card_brand, card_last4 FROM users WHERE id=1").get();
    const v = db.prepare("SELECT code, amount, status, expiry FROM vouchers WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
    const milesValue = +(u.miles * 0.003).toFixed(2);   // €0.003/mile, same rate as checkout
    return { ok: true,
      miles: u.miles,
      miles_value_eur: milesValue,
      miles_rate: "1,000 miles ≈ €3",
      voucher: v ? { code: v.code, amount: v.amount, status: v.status, expiry: v.expiry, available: v.status === "active" } : null,
      card: `${u.card_brand} ••${u.card_last4}`,
      note: "You can split any booking across voucher, miles and card on the payment page or right here in chat.",
    };
  }
  if (name === "get_recommendation") {
    const u = db.prepare("SELECT card_product, card_categories, card_brand, card_last4, affinity, affinity_label, home_airport, first_name FROM users WHERE id=1").get();
    let categories = []; try { categories = JSON.parse(u.card_categories || "[]"); } catch {}
    const pkg = packageFor(u.affinity, u.home_airport);
    const top = categories[0];
    return { ok: true,
      affinity: u.affinity, affinity_label: u.affinity_label,
      card: `${u.card_product} (${u.card_brand} ••${u.card_last4})`,
      derived_from: top ? `${top.share}% of card spend in ${top.name}` : null,
      package: pkg ? {
        event: pkg.event, venue: pkg.venue, city: pkg.city, date: pkg.date, badge: pkg.badge,
        event_price: pkg.eventPrice, hotel: pkg.hotel, hotel_nights: pkg.hotelNights, hotel_price: pkg.hotelPrice,
        flight: pkg.flightDesc, flight_price: pkg.flightPrice, total: pkg.total,
        addon: pkg.addon ? { label: pkg.addon.label, price: pkg.addon.price, normal: pkg.addon.normal, note: pkg.addon.note } : null,
      } : null,
      note: `This is a personalized package for ${u.first_name}, derived from their card spend. Offer it warmly, mention WHY (the card-spend signal), and that it bundles event + hotel + return flight in one tap.`,
    };
  }
  if (name === "get_journey") {
    const j = getJourney();
    if (!j || !j.stage) return { ok: true, in_progress: false, note: "No unfinished booking in progress. Offer to start a new search." };
    const f = j.flight_no ? flightByNo(j.flight_no) : null;
    // If a flight was chosen, hydrate the agent session so change_seat/add_extras/checkout work right away.
    if (f) {
      const auto = db.prepare("SELECT code FROM ancillaries WHERE auto=1").all().map(a => a.code);
      const items = [...new Set([...(j.items || []), ...auto])];
      session.selected = { flight_no: f.flight_no, items, seat: j.seat || prefSeat() };
      db.prepare("UPDATE baskets SET status='superseded' WHERE user_id=1 AND status='open'").run();
      db.prepare("INSERT INTO baskets (user_id,flight_no,items_json,updated_at) VALUES (1,?,?,?)").run(f.flight_no, JSON.stringify(items), now());
    }
    const stageNext = {
      results: "They were still choosing a flight — search the route and show options.",
      seat: "They had selected the flight and were choosing a seat — confirm the seat (their saved one, if any) or offer to change it, then continue to extras.",
      extras: "They were adding extras — show what's in the basket and the current total, ask if they want anything else, then offer checkout.",
      review: "They were at review & payment — summarise the basket + total and offer to complete payment.",
    };
    return { ok: true, in_progress: true,
      stage: j.stage, route: `${cityName(j.origin)}→${cityName(j.dest)}`, origin: j.origin, dest: j.dest, date: j.date,
      flight_no: j.flight_no, seat: j.seat, items: j.items, cabin: j.cabin, last_channel: j.device,
      note: `Resume HERE — do not restart. ${stageNext[j.stage] || "Continue from where they left off."}${f ? " I've reloaded their selection into context." : ""}` };
  }
  if (name === "get_booking") {
    const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
    if (!b) return { ok: true, booking: null };
    const f = flightByNo(b.flight_no) || {};
    return { ok: true, booking: { pnr: b.pnr, flight_no: b.flight_no, route: `${cityName(f.origin)}→${cityName(f.dest)}`, dep: f.dep, seat: b.seat, status: f.status, checked_in: !!b.checked_in } };
  }
  if (name === "express_usual") {
    // The customer's recurring route + the recommended next date for it. Mirrors the
    // /api/profile pattern logic so chat, home and WhatsApp agree. Emits an "express"
    // command (see buildUI) that opens the 2-step Express Checkout on the web screen.
    const home = (db.prepare("SELECT home_airport FROM users WHERE id=1").get() || {}).home_airport || "OPO";
    const row = db.prepare("SELECT route, COUNT(*) c FROM travel_history WHERE user_id=1 AND route LIKE ? GROUP BY route ORDER BY c DESC LIMIT 1").get(home + "→%")
      || db.prepare("SELECT route, COUNT(*) c FROM travel_history WHERE user_id=1 GROUP BY route ORDER BY c DESC LIMIT 1").get();
    const topRoute = row?.route || `${home}→LIS`;
    const [o, dst] = topRoute.split("→");
    const fr = db.prepare("SELECT flight_no, trip_date FROM travel_history WHERE user_id=1 AND route=? GROUP BY flight_no ORDER BY COUNT(*) DESC LIMIT 1").get(topRoute);
    const TODAY = new Date("2026-06-15T00:00:00Z");
    const dow = fr?.trip_date ? new Date(fr.trip_date).getUTCDay() : NaN;
    const d = new Date(TODAY);
    if (Number.isNaN(dow)) d.setUTCDate(d.getUTCDate() + 7);
    else { const days = (dow - TODAY.getUTCDay() + 7) % 7 || 7; d.setUTCDate(d.getUTCDate() + days); }
    const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const recommendedDate = d.toISOString().slice(0, 10);
    const recommendedLabel = `${DOWS[d.getUTCDay()]} ${d.getUTCDate()} ${MONS[d.getUTCMonth()]}`;
    // Queue the usual flight into the basket + session so a follow-up "pay" in chat
    // (or after tapping the Express chip) has something to check out.
    const uf = flightByNo((fr?.flight_no || "").toUpperCase());
    if (uf) {
      const auto = db.prepare("SELECT code FROM ancillaries WHERE auto=1").all().map(a => a.code);
      db.prepare("UPDATE baskets SET status='superseded' WHERE user_id=1 AND status='open'").run();
      db.prepare("INSERT INTO baskets (user_id,flight_no,items_json,updated_at) VALUES (1,?,?,?)").run(uf.flight_no, JSON.stringify(auto), now());
      session.selected = { flight_no: uf.flight_no, items: auto, seat: prefSeat() };
    }
    return { ok: true, route: `${cityName(o)}→${cityName(dst)}`, origin: o, dest: dst, flight_no: fr?.flight_no || "", recommendedDate, recommendedLabel };
  }
  if (name === "check_in") {
    const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
    if (!b) return { ok: false, state: "no_booking", message: "You have no upcoming flight to check in for." };
    const f = flightByNo(b.flight_no) || {};
    if (b.checked_in) return { ok: true, state: "already_checked_in", pnr: b.pnr, flight_no: b.flight_no, route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: b.flight_date, seat: b.seat, group: boardingGroup(userTier()), message: "You're already checked in for this flight." };
    db.prepare("UPDATE bookings SET checked_in=1 WHERE id=?").run(b.id);
    db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('agent_checkin',?,?)").run(JSON.stringify({ pnr: b.pnr }), now());
    log("agent_checkin", { pnr: b.pnr });
    return { ok: true, state: "checked_in_now", pnr: b.pnr, flight_no: b.flight_no, route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: b.flight_date, seat: b.seat || "4C", group: boardingGroup(userTier()) };
  }
  if (name === "cancel_booking") {
    const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
    if (!b) return { ok: false, state: "no_booking", message: "You have no active booking to cancel." };
    const f = flightByNo(b.flight_no) || {};
    if (input.confirm !== true) return { ok: false, state: "needs_confirm", pnr: b.pnr, route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: b.flight_date, message: `Confirm before cancelling ${b.pnr} (${b.flight_no} ${cityName(f.origin)}→${cityName(f.dest)}, ${b.flight_date}). Ask the customer to confirm.` };
    db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(b.id);
    const pay = db.prepare("SELECT * FROM payments WHERE booking_id=?").get(b.id);
    if (pay) {
      if (pay.miles_used > 0) db.prepare("UPDATE users SET miles = miles + ? WHERE id=1").run(pay.miles_used);
      if (pay.voucher_amt > 0) db.prepare("UPDATE vouchers SET status='active' WHERE user_id=1").run();
    }
    log("agent_cancel", { pnr: b.pnr, refund: pay ? { miles: pay.miles_used, voucher: pay.voucher_amt, card: pay.card_amt } : null });
    sendEmail("cancelled", { b, pay });
    return { ok: true, state: "cancelled", pnr: b.pnr, route: `${cityName(f.origin)}→${cityName(f.dest)}`, refund: pay ? { miles: pay.miles_used, voucher: pay.voucher_amt, card: pay.card_amt } : { miles: 0, voucher: 0, card: 0 } };
  }
  return { ok: false, message: "unknown tool" };
}

// Turn the ordered tool calls into UI cards + one screen command for the main app.
function buildUI(toolCalls) {
  let cards = [], command = null;
  for (const tc of toolCalls) {
    if (tc.name === "search_flights" && tc.result?.ok) {
      cards = [{ type: "flights", origin: tc.result.origin, dest: tc.result.dest, city: tc.result.city, date: tc.result.date, flights: tc.result.flights }];
      command = { action: "show_search", origin: tc.result.origin, dest: tc.result.dest, date: tc.result.date };
    } else if (tc.name === "get_suggestions" && tc.result?.ok) {
      cards = [{ type: "suggestions", suggestions: tc.result.suggestions }];
      command = { action: "navigate", screen: "search" };
    } else if (tc.name === "list_destinations" && tc.result?.ok) {
      cards = [{ type: "destinations", origin: tc.result.origin, originCity: tc.result.originCity, count: tc.result.count, destinations: tc.result.destinations }];
    } else if (tc.name === "select_flight" && tc.result?.ok) {
      cards = [{ type: "selected", ...tc.result }];
      command = { action: "select_flight", flight_no: tc.result.flight_no };
    } else if (tc.name === "checkout" && tc.result?.ok) {
      cards = [{ type: "confirmation", ...tc.result }];
      command = { action: "show_confirmation", pnr: tc.result.pnr };
    } else if (tc.name === "change_seat" && tc.result?.ok) {
      cards = [{ type: "seat", seat: tc.result.seat, cabin: tc.result.cabin, price: tc.result.price, included: tc.result.included, from: tc.result.from }];
      command = { action: "navigate", screen: "seatmap" };
    } else if (tc.name === "get_recommendation" && tc.result?.ok && tc.result.package) {
      const p = tc.result.package;
      cards = [{ type: "package", affinity: tc.result.affinity, affinity_label: tc.result.affinity_label, derived_from: tc.result.derived_from,
        event: p.event, venue: p.venue, city: p.city, date: p.date, badge: p.badge,
        eventPrice: p.event_price, hotel: p.hotel, hotelNights: p.hotel_nights, hotelPrice: p.hotel_price,
        flight: p.flight, flightPrice: p.flight_price, total: p.total, addon: p.addon }];
    } else if (tc.name === "get_wallet" && tc.result?.ok) {
      cards = [{ type: "wallet", miles: tc.result.miles, miles_value_eur: tc.result.miles_value_eur, voucher: tc.result.voucher, card: tc.result.card }];
      command = { action: "navigate", screen: "miles" };
    } else if (tc.name === "get_booking" && tc.result?.ok && tc.result.booking) {
      cards = [{ type: "booking", ...tc.result.booking }];
      command = { action: "navigate", screen: "manage" };
    } else if (tc.name === "check_in" && tc.result?.ok && tc.result.state === "checked_in_now") {
      cards = [{ type: "checkin", ...tc.result }];
      command = { action: "navigate", screen: "manage" };
    } else if (tc.name === "check_in" && tc.result?.ok && tc.result.state === "already_checked_in") {
      cards = [{ type: "booking", pnr: tc.result.pnr, flight_no: tc.result.flight_no, route: tc.result.route, dep: tc.result.date, seat: tc.result.seat, checked_in: true }];
      command = { action: "navigate", screen: "manage" };
    } else if (tc.name === "cancel_booking" && tc.result?.ok && tc.result.state === "cancelled") {
      cards = [{ type: "cancelled", ...tc.result }];
      command = { action: "navigate", screen: "manage" };
    } else if (tc.name === "express_usual" && tc.result?.ok) {
      command = { action: "express" };   // opens the 2-step Express Checkout on the web screen
    }
  }
  return { cards, command };
}

// ── Deterministic agent fallback ──────────────────────────────────
// When no ANTHROPIC_API_KEY is set (or the live call fails), the chat STILL
// works: we parse the customer's message, run the SAME tools the live agent
// uses, and return a real reply + cards + screen command via buildUI(). Every
// fact comes from the live database — identical truth with or without the LLM.
let _airportIndex = null;
function airportIndex() {
  if (_airportIndex) return _airportIndex;
  const rows = db.prepare("SELECT code, city FROM airports").all();
  const byCity = rows.map(r => ({ code: r.code.toUpperCase(), lc: (r.city || "").toLowerCase() }))
    .filter(a => a.lc.length >= 4).sort((a, b) => b.lc.length - a.lc.length); // longest first
  const codes = new Set(rows.map(r => r.code.toUpperCase()));
  _airportIndex = { byCity, codes };
  return _airportIndex;
}
function resolveAirport(text) {
  if (!text) return null;
  const { byCity, codes } = airportIndex();
  const lc = text.toLowerCase();
  for (const a of byCity) if (lc.includes(a.lc)) return a.code;       // city name
  const m = text.toUpperCase().match(/\b([A-Z]{3})\b/g);              // explicit IATA
  if (m) for (const c of m) if (codes.has(c)) return c;
  return null;
}
function parseRoute(text, home) {
  const t = (text || "").toLowerCase();
  let origin = null, dest = null, m;
  if ((m = t.match(/from\s+(.+?)\s+to\s+([a-z .'-]+)/))) { origin = resolveAirport(m[1]); dest = resolveAirport(m[2]); }
  if (!dest && (m = t.match(/\bto\s+([a-z .'-]+)/))) dest = resolveAirport(m[1]);
  if (!origin && (m = t.match(/\bfrom\s+([a-z .'-]+)/))) origin = resolveAirport(m[1]);
  if (!origin && !dest) {                                             // bare "lisbon madrid"
    const { byCity } = airportIndex(), found = [];
    for (const a of byCity) { const i = t.indexOf(a.lc); if (i >= 0) found.push({ code: a.code, i }); }
    found.sort((a, b) => a.i - b.i);
    if (found.length >= 2) { origin = found[0].code; dest = found[1].code; }
    else if (found.length === 1) dest = found[0].code;
  }
  return { origin: origin || home, dest };
}
function deterministicAgent(text, session) {
  const q = (text || "").toLowerCase();
  const calls = [];
  const run = (name, input = {}) => {
    let result; try { result = agentRunTool(name, input, session); } catch (e) { result = { ok: false, error: e.message }; }
    calls.push({ name, input, result }); return result;
  };
  const me = db.prepare("SELECT home_airport, first_name FROM users WHERE id=1").get() || {};
  const homeCode = me.home_airport || "OPO";
  const has = (...ws) => ws.some(w => q.includes(w));
  const done = (reply) => ({ reply, toolCalls: calls });
  const EXTRAS = ["wifi", "meal", "lounge", "xbag", "bag", "transfer", "carbon"];

  // resume / continue an unfinished booking
  if (has("where was i", "resume", "pick up", "continue my", "where did i", "left off", "in progress")) {
    const j = run("get_journey");
    if (j.in_progress) { if (j.flight_no) run("select_flight", { flight_no: j.flight_no });
      return done(`You left off at the "${j.stage}" step on ${j.route} (${j.date}). I've reloaded your selections — want to keep going from there?`); }
    return done("You don't have an unfinished booking right now. Tell me where you'd like to fly and I'll search.");
  }
  // express checkout of the USUAL flight — "book my usual", "express checkout my usual",
  // "my regular flight". Opens the 2-step Express Checkout (command from express_usual).
  if ((has("express") || has("book", "checkout", "complete", "rebook")) && has("usual", "regular", "same as always", "same flight")) {
    const r = run("express_usual");
    return done(r.ok
      ? `Opening Express checkout for your usual ${r.route}${r.recommendedLabel ? ` · recommended ${r.recommendedLabel}` : ""} — your seat, bags, saved card and tier perks are already pre-filled. Say "pay" here to confirm, or use the on-screen sheet.`
      : (r.message || "I couldn't load your usual flight just now — try the menu."));
  }
  // cancel
  if (has("cancel")) {
    const confirm = has("yes", "confirm", "go ahead", "do it", "please cancel");
    const r = run("cancel_booking", { confirm });
    if (r.state === "needs_confirm") return done(`Just to confirm — cancel ${r.pnr} (${r.route}, ${r.date})? Say "yes, cancel" and I'll refund it.`);
    if (r.state === "cancelled") return done(`Done — ${r.pnr} is cancelled and refunded (${r.refund.miles} miles, voucher €${r.refund.voucher}, card €${r.refund.card}).`);
    return done(r.message || "There's nothing to cancel.");
  }
  // check in
  if (has("check in", "check-in", "checkin", "boarding pass")) {
    const r = run("check_in");
    if (r.state === "checked_in_now") return done(`Checked in ✅ ${r.route}, seat ${r.seat}, boarding group ${r.group}. PNR ${r.pnr}.`);
    if (r.state === "already_checked_in") return done(`You're already checked in for ${r.route} — seat ${r.seat}, group ${r.group}.`);
    return done(r.message || "You have no upcoming flight to check in for.");
  }
  // wallet / miles / voucher
  if (has("miles", "voucher", "balance", "points", "wallet") || (/\bpay with\b/.test(q) && has("miles", "voucher", "card", "points")) || has("what can i pay", "how can i pay", "how do i pay", "payment method")) {
    const r = run("get_wallet");
    const v = r.voucher && r.voucher.available ? ` Your voucher ${r.voucher.code} is worth €${r.voucher.amount}.` : "";
    return done(`You have ${r.miles.toLocaleString()} miles (≈ €${r.miles_value_eur}).${v} Any booking can be split across miles, voucher and your ${r.card}.`);
  }
  // personalized package / what to do
  if (has("package", "recommend", "what should i do", "things to do", "weekend", "anything fun", "what to do")) {
    const r = run("get_recommendation");
    if (r.package) { const p = r.package; return done(`Because of your ${r.affinity_label} card spend, I'd suggest the ${p.event} at ${p.venue} — ticket + ${p.hotel_nights} nights at ${p.hotel} + return flight, €${p.total} all-in.`); }
    return done("Let me pull a package tailored to you.");
  }
  // seat (change or list)
  if (has("seat")) {
    const seatM = (text.toUpperCase().match(/\b(\d{1,2}[A-F])\b/) || [])[1];
    if (seatM || has("change", "move", "window", "aisle", "business", "premium", "legroom", "front")) {
      const pref = ["window", "aisle", "business", "premium", "extra legroom", "front"].find(p => q.includes(p.split(" ")[0]));
      const r = run("change_seat", seatM ? { seat: seatM } : { preference: pref || "window" });
      return done(r.ok ? r.note : (r.message || "Tell me a seat like 12A or a preference."));
    }
    return done(run("list_seats").note);
  }
  // my booking / status
  if (has("my booking", "my flight", "am i checked", "on time", "my trip", "my reservation", "booking status")) {
    const r = run("get_booking");
    if (r.booking) return done(`Your booking ${r.booking.pnr}: ${r.booking.route}, seat ${r.booking.seat}, ${r.booking.checked_in ? "checked in" : "not checked in yet"}.`);
    return done("You don't have an active booking yet. Want to book your usual flight or search a route?");
  }
  // specific flight number (info or select)
  const fno = (text.toUpperCase().match(/\bTP\s?(\d{2,4})\b/) || [])[1];
  if (fno && !/ to | from /.test(q)) {
    if (has("book", "select", "choose", "take", "pick", "add")) {
      const r = run("select_flight", { flight_no: "TP" + fno });
      return done(r.ok ? `Added ${r.flight_no} (${r.route}, ${r.dep}–${r.arr}, €${r.price}) to your basket, seat ${r.seat}. Say "check out" to pay.` : (r.message || "Search the route first."));
    }
    const r = run("get_flight_info", { flight_no: "TP" + fno });
    return done(r.ok ? `${r.flight_no} ${r.route} departs ${r.dep}, arrives ${r.arr}, €${r.price}. ${r.note}` : (r.message || "I don't have that flight yet."));
  }
  // checkout / pay — confirm payment for the queued flight (express, search, or usual)
  const queued = !!(session.selected || db.prepare("SELECT 1 FROM baskets WHERE user_id=1 AND status='open' LIMIT 1").get());
  const payConfirm = has("check out", "checkout", "pay now", "book it", "complete booking", "confirm booking", "purchase",
    "proceed with payment", "proceed to payment", "proceed to pay", "proceed with the payment", "confirm payment", "confirm the payment",
    "complete payment", "complete the payment", "make payment", "make the payment", "pay & confirm", "pay and confirm",
    "confirm and pay", "confirm & pay", "finalize payment", "finalise payment", "pay for it", "just pay");
  const shortYes = queued && /^(yes|yep|yeah|sure|ok|okay|confirm|go ahead|do it|proceed|pay|please pay|pay it|let'?s do it|sounds good|confirm it)[\s.!]*$/i.test(q.trim());
  if (payConfirm || shortYes) {
    const r = run("checkout", {});
    if (r.ok) return done(`✅ Payment confirmed — booking ${r.pnr}. ${r.route}, departing ${r.dep}. €${r.total} settled (voucher €${r.split.voucher} · ${r.split.miles.toLocaleString()} miles · card €${r.split.card}). Your confirmation is on screen now.`);
    return done(r.message || "Pick a flight first and I'll check you out.");
  }
  // add / remove extras
  if (has("add", "want", "include") && EXTRAS.some(c => q.includes(c))) {
    const codes = EXTRAS.filter(c => q.includes(c));
    const r = run("add_extras", { codes });
    return done(r.ok ? r.note : (r.message || "Select a flight first."));
  }
  if (has("remove", "drop", "don't want", "dont want", "without", "no ") && EXTRAS.some(c => q.includes(c))) {
    const codes = EXTRAS.filter(c => q.includes(c));
    const r = run("remove_extras", { codes });
    return done(r.ok ? r.note : (r.message || "Select a flight first."));
  }
  // where can I fly (factual) / destinations from
  if (has("where can i fly", "where do we fly", "destinations from", "options from", "fly from", "where can i go")) {
    const m = q.match(/from\s+([a-z .'-]+)/); const o = (m && resolveAirport(m[1])) || homeCode;
    const r = run("list_destinations", { origin: o });
    return done(r.ok ? `From ${r.originCity} you can fly to ${r.count} cities — including ${r.destinations.slice(0, 6).map(d => d.city).join(", ")} and more. Which one?` : (r.message || "Tell me an origin."));
  }
  // suggestions / inspiration
  if (has("where should i go", "ideas", "inspire", "somewhere", "suggest a", "surprise me")) {
    const r = run("get_suggestions");
    return done(`Based on how you fly, you might like ${(r.suggestions || []).slice(0, 4).map(s => s.city).join(", ")}. Want me to search any of these?`);
  }
  // date-only follow-up on an active route — "for the 20th", "how about June 20",
  // "what about tomorrow", "make it the 20th". Re-runs the SAME route for the new
  // date (mirrors WhatsApp) instead of falling through to the generic menu.
  {
    const followDate = whatsapp.parseDate(q);
    const ls = session.lastSearch;
    const namesNewCity = !!parseRoute(text, homeCode).dest;
    const looksLikeFollowup = followDate && (/\b(how about|what about|and|same|that route|those|again|instead|make it|change.*date|different date|for the|on the)\b/.test(q) || q.trim().split(/\s+/).length <= 6);
    if (ls && ls.dest && followDate && !namesNewCity && looksLikeFollowup) {
      const r = run("search_flights", { origin: ls.origin, dest: ls.dest, date: followDate });
      if (r.ok) { const lo = Math.min(...r.flights.map(f => f.price)); return done(`Found ${r.flights.length} flights ${cityName(r.origin)}→${r.city} on ${r.date}, from €${lo}. Pick one below, or say a flight number to add it.`); }
      return done(r.message || "I couldn't find that route on that date — want to try another date?");
    }
  }
  // flight search (route)
  if (has("flight", "fly", "search", "go to", "travel", "trip", "book") || / to /.test(q)) {
    let { origin, dest } = parseRoute(text, homeCode);
    const ls = session.lastSearch;
    if (!dest && ls && ls.dest) { origin = ls.origin; dest = ls.dest; } // keep active route when only the date changed
    const date = whatsapp.parseDate(q) || "2026-06-15";
    if (!dest) {
      const r = run("list_destinations", { origin });
      return done(r.ok ? `From ${r.originCity} you can fly to ${r.count} cities — ${r.destinations.slice(0, 6).map(d => d.city).join(", ")} and more. Which destination?` : "Where would you like to fly to?");
    }
    const r = run("search_flights", { origin, dest, date });
    if (r.ok) { const lo = Math.min(...r.flights.map(f => f.price)); return done(`Found ${r.flights.length} flights ${cityName(r.origin)}→${r.city} on ${r.date}, from €${lo}. Pick one below, or say a flight number to add it.`); }
    if (r.available_destinations) return done(`${r.message} From ${cityName(origin)} you can fly to ${r.available_destinations.slice(0, 6).map(d => d.city).join(", ")} and more.`);
    return done(r.message || "Tell me the route (e.g. 'Lisbon to Madrid') and I'll search.");
  }
  // default — genuinely helpful menu (only when nothing matched)
  return done(`Hi ${me.first_name || "there"} — I can search flights ("flights to Madrid"), show your miles & voucher, change your seat, pull up your booking, check you in, or recommend a trip tailored to you. What would you like to do?`);
}

app.post("/api/ai/agent", async (req, res) => {
  const messages = (req.body.messages || []).slice(-12);
  const screen = req.body.screen || "home";
  const sessionId = req.body.sessionId || "web-default";
  const session = getSession(sessionId);
  log("ai_agent_message", { screen, last: typeof messages[messages.length - 1]?.content === "string" ? messages[messages.length - 1].content.slice(0, 120) : "" });
  // Prepend a small situational note so Claude knows where the customer is AND what
  // the active route/flights are (from this session's last search), so follow-ups
  // like "how about tomorrow" or "does TP1481 have seats" stay on-route.
  const me = db.prepare("SELECT first_name, affinity, affinity_label FROM users WHERE id=1").get() || {};
  const who = me.first_name || "the customer";
  let situ = `(${who} is on the "${screen}" screen.`;
  if (me.affinity_label) situ += ` Card-derived affinity: ${me.affinity_label} (${me.affinity}) — a matching event+hotel+flight package is available via get_recommendation; offer it if they ask what to do, want ideas, or mention their interest.`;
  if (session.lastSearch) {
    const ls = session.lastSearch;
    situ += ` Active search: ${cityName(ls.origin)}→${cityName(ls.dest)} on ${ls.date}, flights ${ls.flights.map(f => f.flight_no).join(", ")}.`;
  }
  if (session.selected) situ += ` Currently selected flight: ${session.selected.flight_no}.`;
  situ += ")";
  const withContext = messages.length
    ? [...messages.slice(0, -1), { role: "user", content: `${situ} ${typeof messages[messages.length - 1].content === "string" ? messages[messages.length - 1].content : ""}` }]
    : messages;
  try {
    const { reply, toolCalls } = await callClaudeAgent(withContext, AGENT_TOOLS, async (n, i) => agentRunTool(n, i, session));
    const { cards, command } = buildUI(toolCalls);
    res.json({ reply: reply || "Done.", cards, command, ai: "live", tools: toolCalls.map(t => t.name) });
  } catch (e) {
    log("ai_agent_error", { error: e.message });
    // No API key (or the live call failed) → deterministic agent. The chat still
    // runs real tools and returns real cards/commands, so it never goes dead.
    try {
      const lastUser = [...messages].reverse().find(m => m.role === "user" && typeof m.content === "string");
      const { reply, toolCalls } = deterministicAgent(lastUser ? lastUser.content : "", session);
      const { cards, command } = buildUI(toolCalls);
      res.json({ reply, cards, command, ai: "offline", tools: toolCalls.map(t => t.name) });
    } catch (e2) {
      log("ai_agent_fallback_error", { error: e2.message });
      res.json({ reply: FALLBACKS.chat, cards: [], command: null, ai: "cached" });
    }
  }
});

/* Personalized marketing offer — generated from DB history, then emailed */
// Portugal Stopover — TAP's signature story: break your journey in Lisbon/Porto for
// up to 10 days at no extra airfare. Personalized by the traveller's affinity, and
// shared by the home screen + WhatsApp so the story is identical across channels.
app.get("/api/stopover", (req, res) => {
  const u = db.prepare("SELECT first_name, tier, home_airport, affinity, affinity_label FROM users WHERE id=1").get() || {};
  const home = u.home_airport || "OPO";
  const hub = home === "LIS" ? "OPO" : "LIS";        // stop in the Portugal hub you're not based at
  const nights = 3;
  const HOTELS = {
    LIS: { name: "Hotel Avenida Palace", area: "Avenida da Liberdade", price: 80 },
    OPO: { name: "Hotel Infante Sagres", area: "Ribeira", price: 72 },
  };
  const hotel = { ...(HOTELS[hub] || HOTELS.LIS) };
  hotel.nights = nights; hotel.total = nights * hotel.price;
  const EXP = {
    LIS: {
      football: { title: "Matchday at Estádio da Luz", tag: "Football", price: 70 },
      golf: { title: "Round at Penha Longa Resort", tag: "Golf", price: 120 },
      music: { title: "Fado night in Alfama", tag: "Live music", price: 45 },
      general: [
        { title: "Time Out Market food crawl", tag: "Food", price: 35 },
        { title: "Belém & Jerónimos Monastery", tag: "Culture", price: 25 },
        { title: "Sintra palaces day trip", tag: "Day trip", price: 60 },
      ],
    },
    OPO: {
      football: { title: "Matchday at Estádio do Dragão", tag: "Football", price: 65 },
      golf: { title: "Round at Oporto Golf Club", tag: "Golf", price: 110 },
      music: { title: "Live session at Casa da Música", tag: "Live music", price: 40 },
      general: [
        { title: "Port wine cellar tasting", tag: "Wine", price: 30 },
        { title: "Douro river cruise", tag: "River", price: 28 },
        { title: "Ribeira & Livraria Lello walk", tag: "Culture", price: 20 },
      ],
    },
  };
  const hubExp = EXP[hub] || EXP.LIS;
  const hero = hubExp[u.affinity] || null;
  const experiences = [hero, ...hubExp.general].filter(Boolean).slice(0, 3);
  res.json({
    hub, hubCity: cityName(hub), nights, maxDays: 10,
    headline: `Add a free stopover in ${cityName(hub)}`,
    subline: "Break your journey for up to 10 days — your TAP airfare stays exactly the same.",
    hotel, experiences,
    affinity: u.affinity, affinityLabel: u.affinity_label,
    why: hero ? `Hand-picked for a ${(u.affinity_label || "traveller").toLowerCase()} like you.` : `Highlights of ${cityName(hub)}.`,
    heroExperience: hero ? hero.title : null,
    fromPrice: hotel.total,
    airfareNote: "Flights stay the same price — you only pay for your stay & experiences.",
  });
});

// Offer of the week — deterministic + personalized from travel history, so the SAME
// offer shows on the home screen and on WhatsApp. Rotates weekly (stable within a week).
app.get("/api/offers/today", (req, res) => {
  const u = db.prepare("SELECT first_name, tier, home_airport, miles FROM users WHERE id=1").get() || {};
  const home = u.home_airport || "OPO";
  const ranked = db.prepare(
    "SELECT f.dest d, COUNT(*) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no WHERE b.user_id=1 AND b.status!='cancelled' AND f.dest!=? GROUP BY f.dest ORDER BY c DESC, f.dest"
  ).all(home).map(r => r.d);
  let cands = ranked.length ? ranked
    : db.prepare("SELECT dest FROM routes WHERE origin=? ORDER BY base_fare ASC, dest LIMIT 4").all(home).map(r => r.dest);
  if (!cands.length) cands = ["LIS"];
  const weekIdx = Math.floor(Date.now() / (7 * 86400e3));     // rotates each week
  const dest = cands[weekIdx % cands.length];
  const route = db.prepare("SELECT base_fare FROM routes WHERE origin=? AND dest=?").get(home, dest) || {};
  const base = Math.round(route.base_fare || 99);
  const discountPct = 20;
  const price = Math.max(29, Math.round(base * (1 - discountPct / 100)));
  const tier = u.tier || "Gold";
  const milesPerk = tier === "Platinum" ? "Triple miles" : tier === "Silver" ? "25% bonus miles" : "Double miles";
  const past = db.prepare("SELECT items_json FROM bookings WHERE user_id=1 AND status='completed'").all();
  const counts = {};
  past.forEach(b => { try { JSON.parse(b.items_json || "[]").forEach(x => counts[x] = (counts[x] || 0) + 1); } catch {} });
  let perkAnc = null, best = 0;
  db.prepare("SELECT code,name FROM ancillaries WHERE auto=0 AND price>0").all()
    .forEach(a => { if ((counts[a.code] || 0) > best) { best = counts[a.code]; perkAnc = a; } });
  const perk = perkAnc ? `${milesPerk} + half-price ${perkAnc.name}` : `${milesPerk} + free seat selection`;
  const reason = ranked.length ? `Because ${cityName(dest)} is one of your most-booked routes.` : `A popular getaway from ${cityName(home)}.`;
  res.json({
    badge: "Offer of the week",
    origin: home, dest, originCity: cityName(home), destCity: cityName(dest),
    price, was: base, discountPct, tier, milesPerk, perk, reason,
    title: `${cityName(dest)} from €${price}`,
    detail: `${cityName(home)} → ${cityName(dest)} · was €${base}, now €${price}. ${perk}.`,
  });
});

app.post("/api/offers/send", async (req, res) => {
  let offer, ai = "live";
  const u = db.prepare("SELECT first_name, tier, miles, home_airport, affinity_label FROM users WHERE id=1").get() || {};
  try {
    offer = await callClaude([{ role: "user", content:
      `Create ONE personalized commercial offer email for ${u.first_name} (${u.tier}, ${u.miles} miles, home ${u.home_airport}${u.affinity_label ? ", interests: " + u.affinity_label : ""}) using their actual travel history in your context (their recurring route/flight pattern, miles balance, tier). Make it concrete with numbers and address them by first name.
Return JSON exactly: {"subject": string (no emoji spam, one allowed), "title": string, "preheader": string, "body_html": string (2-4 sentences, may use <b>), "cta": string}.` }],
      { json: true });
  } catch {
    // Generic, persona-correct fallback built from live data (no hardcoded Daniel).
    offer = {
      subject: `${u.first_name} — a smarter way to fly your favourite route`,
      title: "Your travel pattern, rewarded",
      preheader: `Tailored to your ${u.tier} membership.`,
      body_html: `Based on your recent trips and your ${u.miles?.toLocaleString()} ${u.tier} miles balance, we've put together offers tuned to how you fly from ${u.home_airport}. Book ahead this month to lock in fares and earn bonus miles.`,
      cta: "See my offers",
    };
    ai = "cached";
  }
  const email = await sendEmail("personal_offer", { offer });
  res.json({ offer, email, ai });
});

/* ── Demo Console: live DB inspector + email center ──────────── */
const SHOW_TABLES = ["users","preferences","travel_history","searches","wa_messages","vouchers","synced_searches","flights","bookings","payments","baskets","fare_locks","holds","routes","airports","ancillaries","destinations","events"];
app.get("/api/admin/db", (req, res) => {
  const out = {};
  for (const t of SHOW_TABLES) {
    const cap = (t === "routes" || t === "airports") ? 200 : 40;
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid DESC LIMIT ${cap}`).all();
    out[t] = rows.map(r => { const { html, ...rest } = r; return rest; });
  }
  res.json({ dbPath: DB_PATH, tables: out });
});
app.get("/api/admin/emails", (req, res) =>
  res.json(db.prepare("SELECT id,to_addr,subject,email_type,status,created_at FROM emails ORDER BY id DESC LIMIT 50").all()));
app.get("/api/admin/emails/:id", (req, res) =>
  res.json(db.prepare("SELECT * FROM emails WHERE id=?").get(req.params.id) || {}));

/* ── Live DB + CDP proof for the demo ──────────────────────────────
   Returns (1) the real DB file + engine, (2) live row counts, (3) the
   recent event stream (the exact behavioural payloads a CDP ingests),
   and (4) a mapping from our SQLite store to standard CDP objects so a
   client can see how this plugs into Segment / Adobe / Salesforce CDP. */
app.get("/api/admin/cdp", (req, res) => {
  const counts = {};
  for (const t of SHOW_TABLES) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c; } catch { counts[t] = 0; }
  }
  const events = db.prepare("SELECT id,type,payload_json,created_at FROM events ORDER BY id DESC LIMIT 40")
    .all().map(e => {
      const payload = safeJson(e.payload_json);
      return { id: e.id, type: e.type, at: e.created_at, payload, cdpPayload: toCdpTrack(e.type, payload, e.created_at) };
    });

  // How each behaviour becomes a standard CDP entity (the integration story)
  const cdpMapping = [
    { cdp: "Identity / Profile", standard: "Profile + Identifiers", source: "users, preferences", example: "userId, email, loyaltyTier, seatPref, savedCard" },
    { cdp: "Traits", standard: "Computed traits / attributes", source: "travel_history, bookings", example: "lifetimeFlights, topRoute=OPO→LIS, homeAirport=OPO" },
    { cdp: "Track Events", standard: "Behavioural events", source: "events, searches", example: "Flight Searched, Booking Completed, Checked In, Search Abandoned" },
    { cdp: "Audiences / Segments", standard: "Real-time audiences", source: "derived from events", example: "Abandoned-search, Gold-commuter, Lapsing-flyer" },
    { cdp: "Journeys", standard: "Orchestration", source: "email outbox + events", example: "Search → follow-up → offer (45s demo / hours in prod)" },
    { cdp: "Consent", standard: "Consent & governance", source: "users (consent fields)", example: "marketingConsent, dataRetention — gates activation" },
  ];

  res.json({
    db: { path: DB_PATH, engine: "SQLite (node:sqlite)", writeMode: "live — every action commits a row" },
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    events,
    cdpMapping,
    ranAt: new Date().toISOString(),
  });
});
function safeJson(s) { try { return JSON.parse(s || "{}"); } catch { return {}; } }

// Convert an internal event into a standard Segment-style track() call — the
// exact JSON a production CDP would receive. This is the integration artifact.
const CDP_EVENT_NAMES = {
  flight_search: "Flight Searched", agent_search: "Flight Searched",
  payment_captured: "Booking Completed", agent_checkout: "Booking Completed",
  booking_cancelled: "Booking Cancelled", agent_cancel: "Booking Cancelled",
  checkin: "Checked In", agent_checkin: "Checked In", wa_checkin: "Checked In",
  basket_saved: "Cart Updated", search_followup_sent: "Lifecycle Email Sent",
  search_offer_sent: "Offer Sent", hold_created: "Booking Held",
  wa_inbound: "Message Received", routes_suggested: "Recommendations Served",
};
function toCdpTrack(type, payload, at) {
  const u = db.prepare("SELECT email, tier FROM users WHERE id=1").get();
  return {
    type: "track",
    userId: "user_1",
    event: CDP_EVENT_NAMES[type] || type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    properties: payload || {},
    context: { traits: { email: u?.email, loyaltyTier: u?.tier || "Gold" }, channel: (payload && payload.channel) || "web", app: "TAP Pre-Travel" },
    timestamp: (at || "").replace(" ", "T") + "Z",
  };
}

app.get("/api/health", (req, res) =>
  res.json({ ok: true, db: DB_PATH, smtp: SMTP_READY ? "configured" : "not configured (emails logged to DB)", ai: hasKey() ? "live" : "fallback mode", whatsapp: whatsapp.CONFIGURED() ? "configured — messages really send" : "not configured (messages logged to DB)" }));

/* ── Self-test: live system-health checks for the demo console ──
   Runs read-only validations against the real DB + search engine so the
   presenter can show an all-green health panel during the client demo.   */
app.get("/api/admin/selftest", (req, res) => {
  const checks = [];
  const add = (name, group, fn) => {
    try {
      const r = fn();
      checks.push({ name, group, ok: !!(r && r.ok), detail: (r && r.detail) || "" });
    } catch (e) {
      checks.push({ name, group, ok: false, detail: "error: " + e.message });
    }
  };
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const count = (sql, ...p) => one(sql, ...p).c;

  // — Data integrity —
  add("Customer profile loaded", "Data", () => { const u = one("SELECT full_name,tier,miles FROM users WHERE id=1"); return { ok: !!u?.full_name, detail: u ? `${u.full_name} · ${u.tier} · ${u.miles.toLocaleString()} miles` : "missing" }; });
  add("Route network present", "Data", () => { const c = count("SELECT COUNT(*) c FROM routes"); return { ok: c >= 100, detail: `${c} routes` }; });
  add("Airports loaded", "Data", () => { const c = count("SELECT COUNT(*) c FROM airports"); return { ok: c >= 50, detail: `${c} airports` }; });
  add("Ancillaries catalog", "Data", () => { const c = count("SELECT COUNT(*) c FROM ancillaries"); return { ok: c === 6, detail: `${c} extras` }; });

  // — Booking history & personalization —
  add("Bookings seeded", "Personalization", () => { const seedN = (PERSONAS[currentPersona()]?.bookings || []).length; const c = count("SELECT COUNT(*) c FROM bookings WHERE user_id=1"); return { ok: seedN > 0 && c >= seedN, detail: `${c} bookings (seed ${seedN})` }; });
  add("Upcoming + past split", "Personalization", () => { const up = count("SELECT COUNT(*) c FROM bookings WHERE user_id=1 AND status='confirmed'"); const pa = count("SELECT COUNT(*) c FROM bookings WHERE user_id=1 AND status='completed'"); return { ok: up >= 1 && pa >= 1, detail: `${up} upcoming · ${pa} past` }; });
  add("Seat preference from history", "Personalization", () => { const pref = ((one("SELECT seat FROM preferences WHERE user_id=1") || {}).seat || "").split(" ")[0]; const top = one("SELECT seat, COUNT(*) c FROM bookings WHERE user_id=1 AND seat IS NOT NULL GROUP BY seat ORDER BY c DESC"); return { ok: !!(top && top.seat) && (!pref || top.seat === pref), detail: top ? `${top.seat} on ${top.c} trips${pref ? ` (pref ${pref})` : ""}` : "none" }; });
  add("Ancillary upsell from history", "Personalization", () => { const past = db.prepare("SELECT items_json FROM bookings WHERE user_id=1 AND status='completed'").all(); const trips = past.length || 1; const counts = {}; past.forEach(b => JSON.parse(b.items_json || "[]").forEach(x => counts[x] = (counts[x] || 0) + 1)); const recN = Object.values(counts).filter(n => n >= Math.ceil(trips * 0.6)).length; const topAnc = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; return { ok: recN >= 1, detail: topAnc ? `${recN} repeat extras · top ${topAnc[0]} ${topAnc[1]}/${past.length}` : "none" }; });
  add("Top destination signal", "Personalization", () => { const rows = db.prepare("SELECT f.dest d, COUNT(*) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no WHERE b.user_id=1 AND b.status!='cancelled' GROUP BY f.dest ORDER BY c DESC").all(); const top = rows[0]; return { ok: !!top && top.c >= 2, detail: top ? `${cityName(top.d)} booked ${top.c}×` : "none" }; });

  // — Search engine —
  add("Search: route generation", "Search", () => { const f = getRoute("OPO", "LIS") ? generateFlights("OPO", "LIS", "2026-06-15") : []; return { ok: f.length > 0, detail: `${f.length} flights` }; });
  add("Search: any network route (OPO→AMS)", "Search", () => { const f = getRoute("OPO", "AMS") ? generateFlights("OPO", "AMS", "2026-06-15") : []; return { ok: f.length > 0, detail: `${f.length} flights` }; });
  add("List destinations from Lisbon", "Search", () => { const c = count("SELECT COUNT(*) c FROM routes WHERE origin='LIS'"); return { ok: c > 10, detail: `${c} cities from LIS` }; });

  // — Integrations —
  add("AI (TAP AI) connectivity", "Integrations", () => ({ ok: hasKey(), detail: hasKey() ? "live (API key found)" : "fallback mode — set ANTHROPIC_API_KEY" }));
  add("Email channel", "Integrations", () => ({ ok: true, detail: SMTP_READY ? "SMTP configured — really sends" : "logged to DB outbox" }));
  add("WhatsApp channel", "Integrations", () => ({ ok: true, detail: whatsapp.CONFIGURED() ? "Twilio configured — really sends" : "logged to DB" }));

  // — Persistence —
  add("Payments recorded", "Persistence", () => { const c = count("SELECT COUNT(*) c FROM payments"); return { ok: c >= 10, detail: `${c} payment rows` }; });
  add("Event log writing", "Persistence", () => { const c = count("SELECT COUNT(*) c FROM events"); return { ok: c >= 1, detail: `${c} events` }; });

  const total = checks.length, passed = checks.filter(c => c.ok).length;
  // Integrations that are "configured-or-logged" are healthy either way; only AI-live is advisory
  const critical = checks.filter(c => !c.ok && c.name !== "AI (TAP AI) connectivity");
  res.json({
    ok: critical.length === 0,
    passed, total,
    advisory: checks.filter(c => !c.ok && c.name === "AI (TAP AI) connectivity").length,
    ranAt: new Date().toISOString(),
    checks,
  });
});

/* Reset for repeated demos */
// Wipe ALL per-user data (keep shared airports/routes) and re-seed one persona.
function reseedPersona(personaId) {
  for (const t of ["baskets","fare_locks","holds","bookings","payments","emails","searches","wa_messages","travel_history","vouchers","preferences","destinations","ancillaries","synced_searches","flights","users"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch {}
  }
  db.exec("DELETE FROM events WHERE type != 'db_seeded'");
  seedPersonaData(personaId);
}

function currentPersona() {
  const row = db.prepare("SELECT v FROM app_state WHERE k='persona'").get();
  return (row && row.v) || DEFAULT_PERSONA;
}

app.get("/api/personas", (req, res) => {
  res.json({
    active: currentPersona(),
    personas: Object.values(PERSONAS).map(p => ({ id: p.id, label: p.label, blurb: p.blurb, archetype: p.archetype, tier: p.user.tier, home: p.user.home_airport, miles: p.user.miles })),
  });
});

// Switch the live customer record to a different persona (re-seeds the DB).
app.post("/api/persona", (req, res) => {
  const id = (req.body && req.body.persona) || DEFAULT_PERSONA;
  if (!PERSONAS[id]) return res.status(400).json({ ok: false, error: "unknown persona" });
  reseedPersona(id);
  const u = db.prepare("SELECT first_name, full_name, tier, miles FROM users WHERE id=1").get();
  res.json({ ok: true, persona: id, user: u });
});

app.post("/api/admin/reset", (req, res) => {
  // Reset restores the CURRENT persona's pristine data (or one named in the body).
  const id = (req.body && req.body.persona) || currentPersona();
  reseedPersona(id);
  res.json({ ok: true, persona: id });
});

app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

const PORT = process.env.PORT || 3000;   // set PORT in .env (e.g. 7801 on the Azure VM)
const HOST = process.env.HOST || "0.0.0.0";   // 0.0.0.0 = reachable from the network, not just localhost
app.listen(PORT, HOST, () => {
  const suffix = BASE_PATH ? BASE_PATH + "/" : "/";
  console.log(`\n✈  TAP demo running`);
  console.log(`   Local:   http://localhost:${PORT}${suffix}`);
  console.log(`   Network: http://0.0.0.0:${PORT}${suffix}  (reachable via the VM's public host if the firewall/NSG allow ${PORT})`);
  console.log(`   DB:      ${DB_PATH}`);
  console.log(`   SMTP:    ${SMTP_READY ? "configured — emails will really send" : "not configured — emails stored in DB outbox"}`);
  console.log(`   AI:      ${hasKey() ? "live (API key found)" : "fallback responses (set ANTHROPIC_API_KEY for live AI)"}\n`);
});
