/* ──────────────────────────────────────────────────────────────
   TAP Demo — Express backend
   Run:  node server/server.js          (default port 3000)
   ────────────────────────────────────────────────────────────── */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { db, now, DB_PATH, seedSearches } = require("./db");
const { sendEmail, SMTP_READY } = require("./email");
const { callClaude, FALLBACKS, hasKey } = require("./claude");
const { generateFlights, getRoute } = require("./search");
const { AIRPORTS } = require("./routes-data");
const whatsapp = require("./whatsapp");
const cityName = (c) => (AIRPORTS[c] && AIRPORTS[c].city) || c;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const log = (type, payload) =>
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES (?,?,?)").run(type, JSON.stringify(payload || {}), now());
const flightByNo = (no) => db.prepare("SELECT * FROM flights WHERE flight_no=?").get(no);

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
  res.json(rows.slice(0, 30));
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
  log("flight_search", { origin, dest, date, results: stored.length });
  res.json({ ok: true, origin, dest, date, route, flights: stored });
});

/* ── Profile / personalization data ─────────────────────────── */
app.get("/api/profile", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=1").get();
  const prefs = db.prepare("SELECT * FROM preferences WHERE user_id=1").get();
  const vouchers = db.prepare("SELECT * FROM vouchers WHERE user_id=1 AND status='active'").all();
  const history = db.prepare("SELECT * FROM travel_history WHERE user_id=1 ORDER BY trip_date DESC").all();
  const search = db.prepare("SELECT * FROM synced_searches WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();

  // Most-flown outbound route from Porto, computed live (so new bookings shift it)
  const outboundAll = history.filter(h => h.route && h.route.startsWith("OPO→"));
  const routeCounts = {};
  outboundAll.forEach(h => { routeCounts[h.route] = (routeCounts[h.route] || 0) + 1; });
  const topRoute = Object.entries(routeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "OPO→LIS";
  const onTopRoute = history.filter(h => h.route === topRoute);
  const flightCounts = {};
  onTopRoute.forEach(h => { flightCounts[h.flight_no] = (flightCounts[h.flight_no] || 0) + 1; });
  const topFlight = Object.entries(flightCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "TP1927";

  // Per-destination booking tally across all routes — drives card ranking
  const destCounts = {};
  history.forEach(h => { if (h.route && h.route.includes("→")) { const d = h.route.split("→")[1]; destCounts[d] = (destCounts[d] || 0) + 1; } });

  // Recent searches are behavioural signals too — surface the most-searched destinations
  const searchRows = db.prepare("SELECT dest, COUNT(*) c FROM searches WHERE user_id=1 GROUP BY dest ORDER BY c DESC, MAX(id) DESC").all();
  const searchedDests = searchRows.map(r => ({ code: r.dest, count: r.c }));
  const recentSearches = db.prepare("SELECT origin,dest,travel_date,created_at FROM searches WHERE user_id=1 ORDER BY id DESC LIMIT 5").all();

  const pattern = {
    route: topRoute.replace("→", " ⇄ "),
    topRoute,
    topFlight,
    last: onTopRoute.length,
    matching: flightCounts[topFlight] || 0,
    usualOut: "Mondays · 07:05 (TP1927)", usualBack: "Thursdays · 18:35 (TP1943)",
    destCounts,
    searchedDests,
  };
  log("api_profile_fetch", { source: "users, preferences, vouchers, travel_history, searches", topRoute, topFlight });
  res.json({ user, prefs, vouchers, history, pattern, syncedSearch: search, recentSearches });
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
app.get("/api/ancillaries", (req, res) => res.json(db.prepare("SELECT * FROM ancillaries").all()));
app.get("/api/destinations", (req, res) => {
  const dests = db.prepare("SELECT * FROM destinations").all();
  res.json(dests.map(d => {
    const flownRows = db.prepare("SELECT trip_date, purpose FROM travel_history WHERE user_id=1 AND route LIKE ? ORDER BY trip_date DESC").all(`%→${d.code}`);
    const flown = flownRows.length;
    const booked = db.prepare(`SELECT COUNT(*) c FROM bookings b JOIN flights f ON b.flight_no=f.flight_no WHERE b.user_id=1 AND b.status!='cancelled' AND f.dest=?`).get(d.code).c;
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
  const { flight_no, items, total, voucher_amt, miles_used, miles_amt, card_amt } = req.body;
  const pnr = "TP" + Math.random().toString(36).slice(2, 6).toUpperCase();
  const f = flightByNo(flight_no);
  if (!f) { log("pay_unknown_flight", { flight_no }); return res.status(400).json({ ok: false, error: "unknown flight — search the route first" }); }
  const b = db.prepare(`INSERT INTO bookings (pnr,user_id,flight_no,flight_date,seat,items_json,created_at)
    VALUES (?,1,?,?,'4C',?,?)`).run(pnr, flight_no, f.flight_date, JSON.stringify(items || []), now());
  db.prepare(`INSERT INTO payments (booking_id,total,voucher_amt,miles_used,miles_amt,card_amt,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(Number(b.lastInsertRowid), total, voucher_amt, miles_used, miles_amt, card_amt, now());
  if (miles_used > 0) db.prepare("UPDATE users SET miles = miles - ? WHERE id=1").run(miles_used);
  if (voucher_amt > 0) db.prepare("UPDATE vouchers SET status='redeemed' WHERE user_id=1 AND status='active'").run();
  db.prepare("UPDATE baskets SET status='purchased' WHERE user_id=1 AND status='open'").run();
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
  const flight_no = req.body.flight_no || "TP1927";
  db.prepare("UPDATE flights SET status='delayed', new_dep='08:55', new_arr='09:50' WHERE flight_no=?").run(flight_no);
  const f = flightByNo(flight_no);
  log("ops_disruption", { flight_no, cause: "late inbound aircraft", new_dep: f.new_dep });

  let recovery, ai = "live";
  try {
    recovery = await callClaude([{ role: "user", content:
      `LIVE OPS EVENT: ${flight_no} OPO→LIS on Mon 15 Jun (sched ${f.dep}) is delayed ~1h50, late inbound aircraft. New estimate ${f.new_dep}, landing ${f.new_arr}. Daniel has a client meeting in Lisbon at 10:00.
Write his proactive disruption notification. Return JSON exactly:
{"headline": string, "message": string (2-3 sentences, personal, transparent about cause and the 10:00 meeting impact, reassuring, no fluff), "options":[{"id":"${flight_no}","label": string,"detail": string},{"id":"TP1931","label": string,"detail": string}], "compensation": string (one line, Gold + EU261 entitlements)}.
TP1931 departs 09:10 arrives 10:05 — be honest it lands after 10:00; keeping ${flight_no} lands ${f.new_arr}, tight but possible.` }],
      { json: true });
  } catch { recovery = FALLBACKS.recovery; ai = "cached"; }

  const email = await sendEmail("disruption", { f, recovery });
  const wa = await whatsapp.pushDisruption(f, recovery);   // proactive WhatsApp with one-tap rebook buttons
  res.json({ recovery, email, ai });
});

/* ── Booking management (used by portal + WhatsApp) ──────────── */
app.post("/api/bookings/ancillary", async (req, res) => {
  const { code } = req.body;
  const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status != 'cancelled' ORDER BY id DESC LIMIT 1").get();
  const a = db.prepare("SELECT * FROM ancillaries WHERE code=?").get(code);
  if (!b || !a) return res.json({ ok: false });
  const items = JSON.parse(b.items_json || "[]");
  if (!items.includes(code)) items.push(code);
  db.prepare("UPDATE bookings SET items_json=? WHERE id=?").run(JSON.stringify(items), b.id);
  log("ancillary_added", { pnr: b.pnr, code, price: a.price, channel: "whatsapp/portal" });
  res.json({ ok: true, pnr: b.pnr, name: a.name, price: a.price });
});

app.post("/api/bookings/cancel", async (req, res) => {
  const b = db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status != 'cancelled' ORDER BY id DESC LIMIT 1").get();
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

/* ── WhatsApp webhook (Meta Cloud API) ───────────────────────── */
app.get("/api/whatsapp/webhook", (req, res) => {
  const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === (process.env.WHATSAPP_VERIFY_TOKEN || "tap-demo-verify")) {
    log("wa_webhook_verified", {});
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});
app.post("/api/whatsapp/webhook", async (req, res) => {
  res.sendStatus(200);                           // ack immediately (Meta requires fast 200)
  try { await whatsapp.handleIncoming(req.body); }
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

/* ── AI endpoints ────────────────────────────────────────────── */
app.post("/api/ai/plan", async (req, res) => {
  const q = (req.body.prompt || "").slice(0, 500);
  log("ai_planner_query", { q });
  try {
    const plan = await callClaude([{ role: "user", content:
      `Daniel asks the AI itinerary planner: "${q}".
Build a concrete plan using realistic TAP short-haul flights (OPO⇄LIS shuttle TP19xx hourly 06:35–21:00, ~55min, €60–95; other European routes plausible).
Return JSON exactly: {"title": string, "summary": string (1 sentence, personal), "legs":[{"day": string, "flight": string, "route": string, "times": string, "why": string (tie to his pattern/meetings)}], "tip": string} with 2-4 legs.` }],
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

/* Personalized marketing offer — generated from DB history, then emailed */
app.post("/api/offers/send", async (req, res) => {
  let offer, ai = "live";
  try {
    offer = await callClaude([{ role: "user", content:
      `Create ONE personalized commercial offer email for Daniel using his actual travel history in your context (the Monday TP1927 pattern, his miles balance, Gold tier). Make it concrete with numbers.
Return JSON exactly: {"subject": string (no emoji spam, one allowed), "title": string, "preheader": string, "body_html": string (2-4 sentences, may use <b>), "cta": string}.` }],
      { json: true });
  } catch { offer = FALLBACKS.offer; ai = "cached"; }
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
app.get("/api/health", (req, res) =>
  res.json({ ok: true, db: DB_PATH, smtp: SMTP_READY ? "configured" : "not configured (emails logged to DB)", claude: hasKey() ? "live" : "fallback mode", whatsapp: whatsapp.CONFIGURED() ? "configured — messages really send" : "not configured (messages logged to DB)" }));

/* Reset for repeated demos */
app.post("/api/admin/reset", (req, res) => {
  for (const t of ["baskets","fare_locks","holds","bookings","payments","emails","searches","wa_messages"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM events WHERE type != 'db_seeded'");
  // Remove dynamically-generated flight rows (search created these); leave table empty — search regenerates on demand
  db.exec("DELETE FROM flights");
  // Trim travel_history back to the 15 originally-seeded rows (booking-appended rows have higher ids)
  const SEED_HISTORY_ROWS = 28;   // matches the seed in db.js
  const seedRows = db.prepare("SELECT id FROM travel_history WHERE user_id=1 ORDER BY id LIMIT ?").all(SEED_HISTORY_ROWS).map(r => r.id);
  if (seedRows.length) db.prepare(`DELETE FROM travel_history WHERE user_id=1 AND id > ?`).run(seedRows[seedRows.length - 1]);
  db.prepare("UPDATE users SET miles=48230 WHERE id=1").run();
  db.prepare("UPDATE vouchers SET status='active' WHERE user_id=1").run();
  db.prepare("UPDATE flights SET status='scheduled', new_dep=NULL, new_arr=NULL").run();
  seedSearches();   // restore the pre-demo behavioural signals
  res.json({ ok: true });
});

app.get("/{*splat}", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

const PORT = process.env.PORT || 3000;   // set PORT in .env (e.g. 7801 on the Azure VM)
app.listen(PORT, () => {
  console.log(`\n✈  TAP demo running  →  http://localhost:${PORT}`);
  console.log(`   DB:      ${DB_PATH}`);
  console.log(`   SMTP:    ${SMTP_READY ? "configured — emails will really send" : "not configured — emails stored in DB outbox"}`);
  console.log(`   Claude:  ${hasKey() ? "live (ANTHROPIC_API_KEY found)" : "fallback responses (set ANTHROPIC_API_KEY for live AI)"}\n`);
});
