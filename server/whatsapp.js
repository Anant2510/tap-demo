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
const { phraseFromFacts } = require("./claude");

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
  db.prepare("SELECT * FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY id DESC LIMIT 1").get();
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

// Per-sender booking draft, carries flight + seat + extras through the WhatsApp flow
const draft = {};   // { "<bareNumber>": { flight_no, seat, items:[] } }
const getDraft = (to) => (draft[bareNumber(to)] = draft[bareNumber(to)] || { flight_no: null, seat: "4C", items: ["seat","bag","meal"] });
const clearDraft = (to) => { delete draft[bareNumber(to)]; };

/* ── Conversation logic ──────────────────────────────────────── */
async function sendMainMenu(to) {
  const u = db.prepare("SELECT first_name, miles, tier FROM users WHERE id=1").get();
  setMenu(to, { "1": "BOOK_USUAL", "2": "MY_BOOKING", "3": "EXTRAS", "4": "STATUS", "5": "CHECKIN", "6": "CANCEL" });
  await sendText(to,
`Olá ${u.first_name} 👋 You're chatting with TAP AI on WhatsApp — linked to your Miles&Go account (${u.tier}, ${u.miles.toLocaleString()} miles).

Reply with a number — or just type where you want to go (e.g. "flights to Madrid"):
1️⃣  Book my usual flight  (TP1927 Porto→Lisbon, Mon 07:05)
2️⃣  My booking
3️⃣  Add extras
4️⃣  Flight status
5️⃣  Check in
6️⃣  Cancel booking

Every action updates the same TAP database as the app.`);
}

/* ── Booking-flow step helpers (flight → seat → extras → checkout → pay) ── */

// Price a draft: flight + paid extras, with Gold voucher + miles applied
function priceDraft(d, f) {
  const anc = db.prepare("SELECT code,price FROM ancillaries").all();
  const extras = (d.items || []).reduce((s, c) => s + (anc.find(a => a.code === c)?.price || 0), 0);
  const gross = +(((f?.price) || 72) + extras).toFixed(2);
  const voucher = Math.min(35, gross);
  const miles_used = 6000, miles_amt = 18;
  const card = Math.max(0, +(gross - voucher - miles_amt).toFixed(2));
  return { gross, extras, voucher, miles_used, miles_amt, card };
}

// SEAT step — recommend the seat Daniel uses most (from history)
async function startSeatStep(to, f) {
  const rec = await apiCall("GET", "/seat-recommendation");
  const recSeat = rec?.seat || "4C";
  // a few alternative seats to offer
  const alts = ["4C", "2A", "1C", "10F"].filter((s, i, arr) => arr.indexOf(s) === i);
  if (!alts.includes(recSeat)) alts.unshift(recSeat);
  const map = { "0": "MENU" }; const lines = [];
  alts.slice(0, 4).forEach((s, i) => { const n = String(i + 1); map[n] = `SEAT_${s}`; lines.push(`${n}️⃣  Seat ${s}${s === recSeat ? "  ⭐ your usual" : ""}`); });
  setMenu(to, map);
  await sendText(to,
`✈️ ${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)} · ${f.flight_date} · ${f.dep}–${f.arr}

Choose your seat — ${rec?.reason || "seat 4C is your usual"}:

${lines.join("\n")}

0 for menu`);
}

// EXTRAS step — history-personalized ancillaries, toggle then done
async function startExtrasStep(to, note) {
  const d = getDraft(to);
  const anc = await apiCall("GET", "/ancillaries");   // includes bought/reason/recommended
  const paid = anc.filter(a => a.price > 0);
  const map = {}; const lines = [];
  paid.forEach((a, i) => {
    const n = String(i + 1);
    map[n] = `XTOG_${a.code}`;
    const on = d.items.includes(a.code);
    const tag = a.recommended ? `  ⭐ ${a.reason}` : (a.reason ? `  · ${a.reason}` : "");
    lines.push(`${n}️⃣  ${on ? "✅" : "➕"} ${a.name} — €${a.price}${tag}`);
  });
  map["9"] = "XDONE";
  setMenu(to, map);
  const head = note ? `${note}\n\n` : "";
  await sendText(to,
`${head}🧳 Add extras (reply a number to toggle):

${lines.join("\n")}

9️⃣  Done — review & pay`);
}

// CHECKOUT review — full summary before payment
async function startCheckoutReview(to) {
  const d = getDraft(to);
  const f = flightByNo(d.flight_no);
  if (!f) { await sendText(to, "Your selection expired — reply \"menu\" to start again."); clearDraft(to); return sendMainMenu(to); }
  const priced = priceDraft(d, f);
  const anc = db.prepare("SELECT code,name,price FROM ancillaries").all();
  const extraNames = d.items.filter(c => !["seat","bag","meal"].includes(c)).map(c => anc.find(a => a.code === c)?.name || c);
  setMenu(to, { "1": "DO_PAY", "2": "DO_HOLD", "0": "MENU" });
  await sendText(to,
`🧾 Review your booking
${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)} · ${f.flight_date} · ${f.dep}–${f.arr}
Seat ${d.seat} · cabin bag + espresso${extraNames.length ? " + " + extraNames.join(", ") : ""}

Total €${priced.gross.toFixed(2)}
 • Voucher −€${priced.voucher}
 • ${priced.miles_used.toLocaleString()} miles −€${priced.miles_amt}
 • Visa ••4417 €${priced.card.toFixed(2)}

Reply:  1 to Pay now   ·   2 to Hold 48h free   ·   0 for menu`);
}

async function handleAction(to, id) {
  if (id === "BOOK_USUAL") {
    const flights = await apiCall("GET", "/flights?dest=LIS&origin=OPO");
    const f = flights.find(x => x.flight_no === "TP1927") || flights[0];
    const d = getDraft(to); d.flight_no = f.flight_no; d.seat = "4C"; d.items = ["seat","bag","meal"];
    return startSeatStep(to, f);
  }

  /* Pick a flight returned by a search → go to SEAT selection */
  if (id.startsWith("PICK_")) {
    const fno = id.slice(5);
    const f = flightByNo(fno);
    if (!f) { await sendText(to, "That flight's no longer available — reply \"menu\" to start over."); return; }
    const d = getDraft(to); d.flight_no = f.flight_no; d.seat = "4C"; d.items = ["seat","bag","meal"];
    return startSeatStep(to, f);
  }

  /* SEAT step: choose a seat with a history-based recommendation */
  if (id.startsWith("SEAT_")) {
    const seat = id.slice(5);
    const d = getDraft(to); d.seat = seat;
    return startExtrasStep(to);
  }

  /* EXTRAS step: toggle history-recommended ancillaries, then checkout */
  if (id.startsWith("XTOG_")) {
    const code = id.slice(5);
    const d = getDraft(to);
    if (d.items.includes(code)) d.items = d.items.filter(c => c !== code);
    else d.items.push(code);
    return startExtrasStep(to, `${d.items.includes(code) ? "Added" : "Removed"} ${code}.`);
  }
  if (id === "XDONE") return startCheckoutReview(to);

  /* CHECKOUT → PAY / HOLD using the full draft */
  if (id === "DO_PAY") {
    const d = getDraft(to);
    const f = flightByNo(d.flight_no);
    if (!f) { await sendText(to, "Your selection expired — reply \"menu\" to start again."); clearDraft(to); return sendMainMenu(to); }
    const priced = priceDraft(d, f);
    const r = await apiCall("POST", "/pay", { flight_no: d.flight_no, items: d.items, seat: d.seat, total: priced.gross, voucher_amt: priced.voucher, miles_used: priced.miles_used, miles_amt: priced.miles_amt, card_amt: priced.card });
    const facts = { action: "checkout", state: "booked", pnr: r.pnr, flight_no: f.flight_no, route: `${cityName(f.origin)}→${cityName(f.dest)}`, date: f.flight_date, seat: d.seat, extras: d.items.filter(c=>!["seat","bag","meal"].includes(c)), split: { voucher: priced.voucher, miles: priced.miles_used, miles_eur: priced.miles_amt, card: priced.card } };
    await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp",
      fallback: `✅ Booked! ${r.pnr} — ${f.flight_no} ${cityName(f.origin)}→${cityName(f.dest)}, ${f.flight_date}, seat ${d.seat}.\nPayment: voucher −€${priced.voucher} · ${priced.miles_used.toLocaleString()} miles −€${priced.miles_amt} · Visa ••4417 €${priced.card.toFixed(2)}.\nConfirmation emailed. Auto check-in is ON.` }));
    clearDraft(to);
    await sendMainMenu(to);
    return;
  }
  if (id === "DO_HOLD") {
    const d = getDraft(to);
    const f = flightByNo(d.flight_no);
    const priced = priceDraft(d, f);
    const r = await apiCall("POST", "/hold", { flight_no: d.flight_no, items: d.items, seat: d.seat, total: priced.gross });
    setMenu(to, { "1": "DO_PAY", "0": "MENU" });
    await sendText(to, `⏳ Held until ${r.expires} — price, seat ${d.seat} and extras frozen, free as a Gold benefit. Hold confirmation emailed.\n\nReply 1 to complete payment · 0 for menu`);
    return;
  }

  if (id === "MY_BOOKING") {
    const b = latestBooking();
    if (!b) {
      const facts = { action: "my_booking", state: "no_booking", message: "You have no upcoming booking right now." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message + " Reply 1 to book your usual flight." }));
      return sendMainMenu(to);
    }
    const f = flightByNo(b.flight_no) || {};
    setMenu(to, { "1": "CHECKIN", "2": "EXTRAS", "0": "MENU" });
    await sendText(to,
`📄 ${b.pnr} — ${b.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)}
${b.flight_date} · ${f.dep}–${f.arr} · Seat ${b.seat}
Status: ${f.status === "delayed" ? `⚠️ delayed, new departure ${f.new_dep}` : "on time"} · ${b.checked_in ? "Checked in ✓" : "Auto check-in 24h before"}

Reply:  1 to Check in now   ·   2 to Add extras   ·   0 for menu`);
    return;
  }
  if (id === "CHECKIN") {
    const b = latestBooking();
    // Verify real DB state first — never claim success blindly.
    if (!b) {
      const facts = { action: "check_in", state: "no_booking", message: "You don't have any upcoming flight to check in for right now." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message + " Reply 1 to book your usual flight." }));
      return;
    }
    const f = flightByNo(b.flight_no) || {};
    const route = `${cityName(f.origin)}→${cityName(f.dest)}`;
    if (b.checked_in) {
      const facts = { action: "check_in", state: "already_checked_in", pnr: b.pnr, flight_no: b.flight_no, route, date: b.flight_date, seat: b.seat, group: "A (Gold)" };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp",
        fallback: `You're already checked in for ${b.pnr} (${b.flight_no} ${route}, ${b.flight_date}), seat ${b.seat}, boarding group A. Nothing more to do — your boarding pass is in the app.` }));
      return;
    }
    if (f.status === "cancelled") {
      const facts = { action: "check_in", state: "flight_cancelled", pnr: b.pnr, flight_no: b.flight_no, route };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: `${b.flight_no} (${route}) is cancelled, so check-in isn't available. Reply 1 and I'll help you rebook.` }));
      return;
    }
    // Action actually happens here
    db.prepare("UPDATE bookings SET checked_in=1 WHERE id=?").run(b.id);
    db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('wa_checkin',?,?)").run(JSON.stringify({ pnr: b.pnr }), now());
    const facts = { action: "check_in", state: "checked_in_now", pnr: b.pnr, flight_no: b.flight_no, route, date: b.flight_date, dep: f.dep, seat: b.seat, group: "A (Gold)" };
    await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp",
      fallback: `🎫 Checked in for ${b.pnr} — ${b.flight_no} ${route}, ${b.flight_date}${f.dep ? " · departs " + f.dep : ""}. Boarding group A (Gold), seat ${b.seat}. Boarding pass issued; it updates live if anything changes.` }));
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
    if (r.ok) {
      const facts = { action: "add_extra", state: "added", item: r.name, price: r.price, pnr: r.pnr, card: "Visa ••4417" };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: `✅ Added ${r.name} (€${r.price}) to ${r.pnr} — charged to Visa ••4417. Updated itinerary emailed.` }));
    } else {
      const facts = { action: "add_extra", state: "no_booking", message: "There's no active booking to add extras to yet." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message + " Reply 1 to book your usual flight." }));
    }
    return;
  }

  if (id === "STATUS") {
    const b = latestBooking();
    const f = b ? flightByNo(b.flight_no) : null;
    if (!f) {
      const facts = { action: "flight_status", state: "no_booking", message: "You have no upcoming flight on file." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message + " Reply 1 to book one!" }));
      return;
    }
    const route = `${cityName(f.origin)} → ${cityName(f.dest)}`;
    const facts = f.status === "delayed"
      ? { action: "flight_status", state: "delayed", flight_no: f.flight_no, route, new_dep: f.new_dep, new_arr: f.new_arr, pnr: b.pnr }
      : { action: "flight_status", state: "on_time", flight_no: f.flight_no, route, dep: f.dep, date: b.flight_date, pnr: b.pnr };
    const fb = f.status === "delayed"
      ? `⚠️ ${f.flight_no} (${route}) is delayed — new departure ${f.new_dep}, landing ${f.new_arr}. Reply here and I can rebook you.`
      : `🟢 ${f.flight_no} ${route} on ${b.flight_date} is on time. Departure ${f.dep}, gate closes 20 min before. I'll message you if anything changes.`;
    await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: fb }));
    return;
  }

  if (id === "CANCEL") {
    const b = latestBooking();
    if (!b) {
      const facts = { action: "cancel", state: "no_booking", message: "You have no active booking to cancel." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message }));
      return;
    }
    const f = flightByNo(b.flight_no) || {};
    setMenu(to, { "1": `CONFIRM_CANCEL_${b.id}`, "0": "MENU" });
    await sendText(to,
`You're about to cancel ${b.pnr} (${b.flight_no} ${cityName(f.origin)}→${cityName(f.dest)}, ${b.flight_date}).
Refund goes back instantly to the original split — voucher, miles and card.

Reply:  1 to confirm cancel   ·   0 to keep my booking`);
    return;
  }
  if (id.startsWith("CONFIRM_CANCEL_")) {
    const r = await apiCall("POST", "/bookings/cancel", {});
    if (r.ok) {
      const facts = { action: "cancel", state: "cancelled", pnr: r.pnr, refund: r.refund || { note: "original payment split" } };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: `✅ ${r.pnr} cancelled. Refund issued instantly: miles restored, voucher reactivated, card amount returned to Visa ••4417. Confirmation emailed — no forms, no queue.` }));
    } else {
      const facts = { action: "cancel", state: "no_booking", message: "No active booking was found to cancel." };
      await sendText(to, await phraseFromFacts(facts, { channel: "whatsapp", fallback: facts.message }));
    }
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

  // 2) Fast deterministic paths (instant, no LLM needed)
  if (/^(hi|hello|hey|menu|start|olá|ola)\b/.test(t) || t === "") return sendMainMenu(from);
  if (/^(book|book my usual|usual)\b/.test(t)) return handleAction(from, "BOOK_USUAL");
  if (/^cancel\b/.test(t)) return handleAction(from, "CANCEL");
  if (/^check.?in\b/.test(t)) return handleAction(from, "CHECKIN");
  if (/^(status|delay)\b/.test(t)) return handleAction(from, "STATUS");

  // 2a) Simple "flights to X" still uses the fast deterministic search
  const dest = detectDest(t);
  if (dest && /\b(flight|fly|go|search|travel|trip|to)\b/.test(t)) return searchRoute(from, "OPO", dest);

  // 3) EVERYTHING ELSE → the LLM agent (same brain as the web chat).
  //    This makes WhatsApp intelligent: recommendations, questions, multi-step
  //    requests, etc. The agent can also call tools (search/book/etc).
  return runAgent(from, text);
}

/* Route a free-form message through the AI agent endpoint and relay the reply
   to WhatsApp. If the agent searched flights, render them as a numbered pick
   list so the user can act with a reply. Falls back to the menu on error. */
async function runAgent(to, text) {
  try {
    const r = await apiCall("POST", "/ai/agent", { messages: [{ role: "user", content: text }], screen: "whatsapp" });
    if (!r || (!r.reply && !(r.cards && r.cards.length))) return sendMainMenu(to);

    // If the agent produced a flight list, present it as a numbered pick menu
    const flightsCard = (r.cards || []).find(c => c.type === "flights");
    if (flightsCard && flightsCard.flights?.length) {
      const flights = flightsCard.flights.slice(0, 5);
      const map = { "0": "MENU" }; const lines = [];
      flights.forEach((f, i) => { const n = String(i + 1); map[n] = `PICK_${f.flight_no}`; lines.push(`${n}️⃣  ${f.flight_no} · ${f.dep}–${f.arr} · €${f.price}${f.recommended ? " ⭐" : ""}`); });
      setMenu(to, map);
      const head = r.reply ? r.reply + "\n\n" : "";
      await sendText(to, `${head}✈️ ${cityName(flightsCard.origin)} → ${cityName(flightsCard.dest)} · ${flightsCard.date}\nReply with a number:\n\n${lines.join("\n")}\n\n0 for menu`);
      return;
    }

    // If the agent confirmed a booking/checkout, relay it and return to menu
    const conf = (r.cards || []).find(c => c.type === "confirmation");
    if (conf) { await sendText(to, r.reply || `✅ Booked! Confirmation ${conf.pnr}.`); return sendMainMenu(to); }

    // Otherwise just relay the agent's text answer (recommendations, Q&A, etc.)
    await sendText(to, r.reply);
    // keep the conversation actionable
    setMenu(to, { "1": "BOOK_USUAL", "2": "MY_BOOKING", "3": "EXTRAS", "4": "STATUS", "5": "CHECKIN", "6": "CANCEL" });
  } catch (e) {
    await sendText(to, "Let me show you what I can do:");
    return sendMainMenu(to);
  }
}

/* Resolve a destination from free text → IATA code, using the airports table. */
function detectDest(t) {
  // direct IATA code mention
  const codeMatch = t.toUpperCase().match(/\b(LIS|OPO|MAD|CDG|FNC|BCN|LON|LHR|FCO|FRA|BRU|AMS|GVA|ZRH|MUC|MXP|ORY)\b/);
  if (codeMatch && AIRPORTS[codeMatch[1]]) return codeMatch[1];
  // city-name mention — scan known airports
  for (const [code, a] of Object.entries(AIRPORTS)) {
    if (!a.city) continue;
    const city = a.city.toLowerCase();
    if (t.includes(city)) return code;
  }
  // a few common aliases
  const alias = { lisbon: "LIS", porto: "OPO", madrid: "MAD", paris: "CDG", funchal: "FNC", barcelona: "BCN", london: "LHR", rome: "FCO", frankfurt: "FRA", brussels: "BRU", amsterdam: "AMS", geneva: "GVA", zurich: "ZRH", munich: "MUC", milan: "MXP" };
  for (const [name, code] of Object.entries(alias)) if (t.includes(name) && AIRPORTS[code]) return code;
  return null;
}

/* Free-route search → numbered flight list (mirrors the web AI chat). */
async function searchRoute(to, origin, dest, date = "2026-06-15") {
  const r = await apiCall("GET", `/search?origin=${origin}&dest=${dest}&date=${date}`);
  if (!r.ok || !r.flights?.length) {
    await sendText(to, `Hmm, I couldn't find a ${cityName(origin)} → ${cityName(dest)} flight in our network. Try another city, or reply "menu".`);
    return;
  }
  const flights = r.flights.slice(0, 5);
  const map = { "0": "MENU" }; const lines = [];
  flights.forEach((f, i) => {
    const n = String(i + 1);
    map[n] = `PICK_${f.flight_no}`;
    lines.push(`${n}️⃣  ${f.flight_no} · ${f.dep}–${f.arr} · €${f.price}${f.recommended ? " ⭐" : ""}`);
  });
  setMenu(to, map);
  await sendText(to,
`✈️ ${cityName(origin)} → ${cityName(dest)} · ${date}
Found ${flights.length} flights — reply with a number to pick:

${lines.join("\n")}

0 for menu`);
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
