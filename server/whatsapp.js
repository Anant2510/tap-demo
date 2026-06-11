/* ──────────────────────────────────────────────────────────────
   TAP Demo — WhatsApp integration via TWILIO Sandbox
   • With TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM
     set, messages really send via Twilio's API (free sandbox, to
     any number that has joined your sandbox with the join code).
   • Without credentials, every outbound message is still logged to
     the wa_messages table (visible in the Demo Console), so the
     conversation logic is fully testable offline.
   • The Twilio sandbox reliably sends TEXT. True tappable buttons
     need approved templates (not available in sandbox), so the menu
     is a numbered text menu: the user replies 1/2/3… It always works.
   • Replies arrive on the webhook (POST x-www-form-urlencoded from
     Twilio) and trigger the SAME backend endpoints the portal uses —
     bookings, rebooking, ancillaries, cancellations all hit the same
     database and feed the same personalization.
   ────────────────────────────────────────────────────────────── */
const { db, now } = require("./db");
const { AIRPORTS } = require("./routes-data");

const cityName = (c) => (AIRPORTS[c] && AIRPORTS[c].city) || c;
const SID = () => process.env.TWILIO_ACCOUNT_SID;
const AUTH = () => process.env.TWILIO_AUTH_TOKEN;
const FROM = () => process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886"; // default sandbox number
const CONFIGURED = () => !!(SID() && AUTH());
const PORT = () => process.env.PORT || 3000;

// Normalise any number to Twilio's "whatsapp:+E164" form
const waAddr = (n) => {
  if (!n) return n;
  let s = String(n).trim();
  if (s.startsWith("whatsapp:")) return s;
  if (!s.startsWith("+")) s = "+" + s.replace(/[^\d]/g, "");
  return "whatsapp:" + s;
};
const bareNumber = (n) => String(n || "").replace(/^whatsapp:/, "");

const logWA = (direction, wa_id, type, body, payload, status) =>
  db.prepare(`INSERT INTO wa_messages (direction,wa_id,msg_type,body,payload_json,status,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(direction, bareNumber(wa_id) || "", type, body || "", JSON.stringify(payload || {}), status, now());

/* ── Outbound send (Twilio REST API) ─────────────────────────── */
async function sendText(to, text) {
  let status = "logged (Twilio not configured)";
  if (CONFIGURED()) {
    try {
      const params = new URLSearchParams();
      params.append("From", FROM());
      params.append("To", waAddr(to));
      params.append("Body", text);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID()}/Messages.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${SID()}:${AUTH()}`).toString("base64"),
        },
        body: params.toString(),
      });
      const data = await res.json();
      status = res.ok ? "delivered via Twilio" : "send failed: " + JSON.stringify(data.message || data).slice(0, 140);
    } catch (e) { status = "send failed: " + e.message.slice(0, 120); }
  }
  logWA("out", to, "text", text, { body: text }, status);
  return status;
}

/* ── Internal API helper — reuses the portal's own endpoints ─── */
const apiCall = (method, p, body) =>
  fetch(`http://localhost:${PORT()}/api${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json());

const latestBooking = () =>
  db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status != 'cancelled' ORDER BY id DESC LIMIT 1").get();
const flightByNo = (no) => db.prepare("SELECT * FROM flights WHERE flight_no=?").get(no);

/* ── Per-sender menu context: maps the number the user just typed
      (1,2,3…) back to an action id, based on the last menu we sent.
      Kept in memory; fine for a demo. ───────────────────────────── */
const menuContext = {};   // { "<bareNumber>": { "1": "BOOK_USUAL", ... } }
function setMenu(to, map) { menuContext[bareNumber(to)] = map; }
function resolveChoice(to, text) {
  const map = menuContext[bareNumber(to)] || {};
  const key = (text || "").trim();
  return map[key] || null;
}

/* ── Conversation logic ──────────────────────────────────────── */
async function sendMainMenu(to) {
  const u = db.prepare("SELECT first_name, miles, tier FROM users WHERE id=1").get();
  setMenu(to, { "1": "BOOK_USUAL", "2": "MY_BOOKING", "3": "EXTRAS", "4": "STATUS", "5": "CANCEL" });
  await sendText(to,
`Olá ${u.first_name} 👋 This is TAP on WhatsApp — linked to your Miles&Go account (${u.tier}, ${u.miles.toLocaleString()} miles).

Reply with a number:
1️⃣  Book my usual flight  (TP1927 Porto→Lisbon, Mon 07:05)
2️⃣  My booking
3️⃣  Add extras
4️⃣  Flight status
5️⃣  Cancel booking

Every action updates the same TAP database as the app.`);
}

async function handleAction(to, id) {
  if (id === "BOOK_USUAL") {
    const flights = await apiCall("GET", "/flights?dest=LIS&origin=OPO");
    const f = flights.find(x => x.flight_no === "TP1927") || flights[0];
    setMenu(to, { "1": `PAY_${f.flight_no}`, "2": `HOLD_${f.flight_no}`, "0": "MENU" });
    await sendText(to,
`✈️ ${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)}
Mon 15 Jun · ${f.dep}–${f.arr} · Seat 4C
Cabin bag + espresso pre-selected (your usuals)

Total €90.50 — €35 voucher + 6,000 miles applied, €37.50 to Visa ••4417.

Reply:  1 to Pay now   ·   2 to Hold 48h free   ·   0 for menu`);
    return;
  }
  if (id.startsWith("PAY_")) {
    const fno = id.slice(4);
    const r = await apiCall("POST", "/pay", { flight_no: fno, items: ["seat","bag","meal"], total: 90.5, voucher_amt: 35, miles_used: 6000, miles_amt: 18, card_amt: 37.5 });
    await sendText(to, `✅ Booked! Confirmation ${r.pnr}.

Payment split: voucher −€35 · 6,000 miles −€18 · Visa ••4417 €37.50.
Confirmation email sent. Auto check-in is ON — your boarding pass appears 24h before departure.`);
    await sendMainMenu(to);
    return;
  }
  if (id.startsWith("HOLD_")) {
    const fno = id.slice(5);
    const r = await apiCall("POST", "/hold", { flight_no: fno, items: ["seat","bag","meal"], total: 90.5 });
    await sendText(to, `⏳ Held until ${r.expires} — price, seat 4C and extras frozen, free as a Gold benefit. Hold confirmation emailed. Reply 1 anytime to complete the booking.`);
    setMenu(to, { "1": `PAY_${fno}`, "0": "MENU" });
    return;
  }

  if (id === "MY_BOOKING") {
    const b = latestBooking();
    if (!b) { await sendText(to, "You have no active booking yet."); return sendMainMenu(to); }
    const f = flightByNo(b.flight_no) || {};
    setMenu(to, { "1": "CHECKIN", "2": "EXTRAS", "0": "MENU" });
    await sendText(to,
`📄 ${b.pnr} — ${b.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)}
Mon 15 Jun · ${f.dep}–${f.arr} · Seat ${b.seat}
Status: ${f.status === "delayed" ? `⚠️ delayed, new departure ${f.new_dep}` : "on time"} · ${b.checked_in ? "Checked in ✓" : "Auto check-in 24h before"}

Reply:  1 to Check in now   ·   2 to Add extras   ·   0 for menu`);
    return;
  }
  if (id === "CHECKIN") {
    const b = latestBooking();
    if (b) db.prepare("UPDATE bookings SET checked_in=1 WHERE id=?").run(b.id);
    db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('wa_checkin',?,?)").run(JSON.stringify({ pnr: b?.pnr }), now());
    await sendText(to, `🎫 Checked in! Boarding pass issued — Group A (Gold), seat ${b?.seat || "4C"}. It updates live if anything changes.`);
    return;
  }

  if (id === "EXTRAS") {
    const anc = db.prepare("SELECT * FROM ancillaries WHERE price > 0").all();
    const map = { "0": "MENU" }; const lines = [];
    anc.forEach((a, i) => { const n = String(i + 1); map[n] = `ANC_${a.code}`; lines.push(`${n}️⃣  ${a.name} — €${a.price}`); });
    setMenu(to, map);
    await sendText(to, `Add to your trip — charged to your saved Visa, instantly on your booking:\n\n${lines.join("\n")}\n\n0 for menu`);
    return;
  }
  if (id.startsWith("ANC_")) {
    const code = id.slice(4);
    const r = await apiCall("POST", "/bookings/ancillary", { code });
    if (r.ok) await sendText(to, `✅ Added ${r.name} (€${r.price}) to ${r.pnr} — charged to Visa ••4417. Updated itinerary emailed.`);
    else await sendText(to, "You need an active booking first — reply 1 to book your usual flight.");
    return;
  }

  if (id === "STATUS") {
    const b = latestBooking();
    const f = b ? flightByNo(b.flight_no) : null;
    if (!f) { await sendText(to, "No upcoming flight on file. Reply 1 to book one!"); return; }
    await sendText(to, f.status === "delayed"
      ? `⚠️ ${f.flight_no} is delayed — new departure ${f.new_dep}, landing ${f.new_arr}. We've emailed your options; reply here and I can rebook you.`
      : `🟢 ${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)} is on time. Departure ${f.dep}, gate closes 20 min before. Live tracking on — I'll message you if anything changes.`);
    return;
  }

  if (id === "CANCEL") {
    const b = latestBooking();
    if (!b) { await sendText(to, "Nothing to cancel — you have no active booking."); return; }
    setMenu(to, { "1": `CONFIRM_CANCEL_${b.id}`, "0": "MENU" });
    await sendText(to,
`You're about to cancel ${b.pnr} (${b.flight_no}, Mon 15 Jun).
Refund goes back instantly to the original split — voucher, miles and card.

Reply:  1 to confirm cancel   ·   0 to keep my booking`);
    return;
  }
  if (id.startsWith("CONFIRM_CANCEL_")) {
    const r = await apiCall("POST", "/bookings/cancel", {});
    if (r.ok) await sendText(to, `✅ ${r.pnr} cancelled. Refund issued instantly: miles restored, voucher reactivated, card amount returned to Visa ••4417. Confirmation emailed — no forms, no queue.`);
    else await sendText(to, "No active booking found to cancel.");
    await sendMainMenu(to);
    return;
  }

  /* Disruption rebooking (pushed proactively by the portal's disrupt action) */
  if (id.startsWith("REBOOK_")) {
    const optId = id.slice(7);
    const label = optId === "KEEP" ? "Keep my original flight" : `Move to ${optId}`;
    await apiCall("POST", "/rebook", { option: { id: optId === "KEEP" ? (latestBooking()?.flight_no || "TP1927") : optId, label } });
    await sendText(to, `✅ Done — ${label.toLowerCase()}. New boarding pass issued, seat 4C kept, confirmation emailed. Nothing else to do.`);
    return;
  }

  if (id === "MENU") return sendMainMenu(to);

  await sendText(to, "Here's the menu:");
  await sendMainMenu(to);
}

/* ── Inbound webhook processing ──────────────────────────────────
   Twilio posts application/x-www-form-urlencoded with fields like
   From="whatsapp:+91...", Body="1". server.js parses the form and
   passes { from, text } here. ─────────────────────────────────── */
async function handleIncoming({ from, text }) {
  if (!from) return;
  const bare = bareNumber(from);
  logWA("in", from, "text", text, { from, text }, "received");
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('wa_inbound',?,?)").run(JSON.stringify({ from: bare, text }), now());
  db.prepare("UPDATE users SET wa_id=? WHERE id=1").run(bare);   // remember partner for proactive push

  const t = (text || "").trim().toLowerCase();

  // 1) If the reply is a number that maps to the menu we last sent → run it
  const choice = resolveChoice(from, text);
  if (choice) return handleAction(from, choice);

  // 2) Keyword intents (also covers "hi"/"menu"/"hello")
  if (/^(hi|hello|hey|menu|start|olá|ola)\b/.test(t) || t === "") return sendMainMenu(from);
  if (/book/.test(t)) return handleAction(from, "BOOK_USUAL");
  if (/cancel/.test(t)) return handleAction(from, "CANCEL");
  if (/status|delay/.test(t)) return handleAction(from, "STATUS");
  if (/extra|wifi|meal|bag|lounge|transfer/.test(t)) return handleAction(from, "EXTRAS");

  // 3) Anything else → menu
  return sendMainMenu(from);
}

/* ── Proactive push: portal disruption → WhatsApp text ───────── */
async function pushDisruption(f, recovery) {
  const to = process.env.WHATSAPP_DEFAULT_TO || db.prepare("SELECT wa_id FROM users WHERE id=1").get()?.wa_id;
  if (!to) { logWA("out", "", "skipped", "Disruption push skipped — no WhatsApp recipient known yet", {}, "no recipient"); return "no recipient"; }
  const opts = (recovery.options || []).slice(0, 2);
  const keep = opts[0]?.label || "Keep my flight";
  const move = opts[1]?.label || "Move me to the next flight";
  const moveId = opts[1]?.id || "TP1931";
  setMenu(to, { "1": "REBOOK_KEEP", "2": `REBOOK_${moveId}` });
  return sendText(to,
`⚠️ ${recovery.headline}

${recovery.message}

🛡 ${recovery.compensation}

Reply:  1 to ${keep}   ·   2 to ${move}`);
}

module.exports = { handleIncoming, pushDisruption, sendMainMenu, CONFIGURED };
