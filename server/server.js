/* ──────────────────────────────────────────────────────────────
   TAP Demo — Express backend
   Run:  node server/server.js          (default port 3000)
   ────────────────────────────────────────────────────────────── */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { db, now, DB_PATH } = require("./db");
const { sendEmail, SMTP_READY } = require("./email");
const { callClaude, FALLBACKS, hasKey } = require("./claude");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const log = (type, payload) =>
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES (?,?,?)").run(type, JSON.stringify(payload || {}), now());
const flightByNo = (no) => db.prepare("SELECT * FROM flights WHERE flight_no=?").get(no);

/* ── Profile / personalization data ─────────────────────────── */
app.get("/api/profile", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=1").get();
  const prefs = db.prepare("SELECT * FROM preferences WHERE user_id=1").get();
  const vouchers = db.prepare("SELECT * FROM vouchers WHERE user_id=1 AND status='active'").all();
  const history = db.prepare("SELECT * FROM travel_history WHERE user_id=1 ORDER BY trip_date DESC").all();
  const search = db.prepare("SELECT * FROM synced_searches WHERE user_id=1 ORDER BY id DESC LIMIT 1").get();
  const outbound = history.filter(h => h.route === "OPO→LIS");
  const pattern = {
    route: "OPO ⇄ LIS",
    last: outbound.length,
    matching: outbound.filter(h => h.flight_no === "TP1927").length,
    usualOut: "Mondays · 07:05 (TP1927)", usualBack: "Thursdays · 18:35 (TP1943)",
  };
  log("api_profile_fetch", { source: "users, preferences, vouchers, travel_history, synced_searches" });
  res.json({ user, prefs, vouchers, history, pattern, syncedSearch: search });
});

app.get("/api/flights", (req, res) => res.json(db.prepare("SELECT * FROM flights ORDER BY dep").all()));
app.get("/api/ancillaries", (req, res) => res.json(db.prepare("SELECT * FROM ancillaries").all()));
app.get("/api/destinations", (req, res) => res.json(db.prepare("SELECT * FROM destinations").all()));

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
  const b = db.prepare(`INSERT INTO bookings (pnr,user_id,flight_no,flight_date,seat,items_json,created_at)
    VALUES (?,1,?,?,'4C',?,?)`).run(pnr, flight_no, f.flight_date, JSON.stringify(items || []), now());
  db.prepare(`INSERT INTO payments (booking_id,total,voucher_amt,miles_used,miles_amt,card_amt,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(Number(b.lastInsertRowid), total, voucher_amt, miles_used, miles_amt, card_amt, now());
  if (miles_used > 0) db.prepare("UPDATE users SET miles = miles - ? WHERE id=1").run(miles_used);
  if (voucher_amt > 0) db.prepare("UPDATE vouchers SET status='redeemed' WHERE user_id=1 AND status='active'").run();
  db.prepare("UPDATE baskets SET status='purchased' WHERE user_id=1 AND status='open'").run();
  log("payment_captured", { pnr, total, split: { voucher_amt, miles_used, card_amt } });
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
  res.json({ recovery, email, ai });
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
const SHOW_TABLES = ["users","preferences","travel_history","vouchers","synced_searches","flights","ancillaries","destinations","baskets","fare_locks","holds","bookings","payments","events"];
app.get("/api/admin/db", (req, res) => {
  const out = {};
  for (const t of SHOW_TABLES) {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid DESC LIMIT 30`).all();
    out[t] = rows.map(r => { const { html, ...rest } = r; return rest; });
  }
  res.json({ dbPath: DB_PATH, tables: out });
});
app.get("/api/admin/emails", (req, res) =>
  res.json(db.prepare("SELECT id,to_addr,subject,email_type,status,created_at FROM emails ORDER BY id DESC LIMIT 50").all()));
app.get("/api/admin/emails/:id", (req, res) =>
  res.json(db.prepare("SELECT * FROM emails WHERE id=?").get(req.params.id) || {}));
app.get("/api/health", (req, res) =>
  res.json({ ok: true, db: DB_PATH, smtp: SMTP_READY ? "configured" : "not configured (emails logged to DB)", claude: hasKey() ? "live" : "fallback mode" }));

/* Reset for repeated demos */
app.post("/api/admin/reset", (req, res) => {
  for (const t of ["baskets","fare_locks","holds","bookings","payments","emails"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM events WHERE type != 'db_seeded'");
  db.prepare("UPDATE users SET miles=48230 WHERE id=1").run();
  db.prepare("UPDATE vouchers SET status='active' WHERE user_id=1").run();
  db.prepare("UPDATE flights SET status='scheduled', new_dep=NULL, new_arr=NULL").run();
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
