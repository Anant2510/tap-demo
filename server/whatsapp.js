/* ──────────────────────────────────────────────────────────────
   TAP Demo — WhatsApp Cloud API integration (Meta test number)
   • With WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID set, messages
     really send via Meta's Graph API (free on a test number, to
     up to 5 verified recipients).
   • Without credentials, every outbound message is still logged
     to the wa_messages table (visible in the Demo Console), so
     the conversation logic is fully testable offline.
   • Button taps arrive on the webhook and trigger the SAME
     backend endpoints the portal uses — bookings, rebooking,
     ancillaries, cancellations all hit the same database and
     feed the same personalization.
   ────────────────────────────────────────────────────────────── */
const { db, now } = require("./db");
const { AIRPORTS } = require("./routes-data");

const cityName = (c) => (AIRPORTS[c] && AIRPORTS[c].city) || c;
const TOKEN = () => process.env.WHATSAPP_TOKEN;
const PHONE_ID = () => process.env.WHATSAPP_PHONE_NUMBER_ID;
const CONFIGURED = () => !!(TOKEN() && PHONE_ID());
const PORT = () => process.env.PORT || 3000;

const logWA = (direction, wa_id, type, body, payload, status) =>
  db.prepare(`INSERT INTO wa_messages (direction,wa_id,msg_type,body,payload_json,status,created_at)
    VALUES (?,?,?,?,?,?,?)`).run(direction, wa_id || "", type, body || "", JSON.stringify(payload || {}), status, now());

/* ── Outbound send (Graph API) ───────────────────────────────── */
async function sendWA(to, payload, summary) {
  let status = "logged (WhatsApp not configured)";
  if (CONFIGURED()) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${PHONE_ID()}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
      });
      const data = await res.json();
      status = res.ok ? "delivered via Cloud API" : "send failed: " + JSON.stringify(data.error || data).slice(0, 120);
    } catch (e) { status = "send failed: " + e.message.slice(0, 100); }
  }
  logWA("out", to, payload.type, summary, payload, status);
  return status;
}

const sendText = (to, text) => sendWA(to, { type: "text", text: { body: text } }, text);

const sendButtons = (to, body, buttons, footer) => sendWA(to, {
  type: "interactive",
  interactive: {
    type: "button",
    body: { text: body },
    ...(footer ? { footer: { text: footer } } : {}),
    action: { buttons: buttons.slice(0, 3).map(b => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
  },
}, body);

const sendList = (to, body, buttonLabel, rows, footer) => sendWA(to, {
  type: "interactive",
  interactive: {
    type: "list",
    body: { text: body },
    ...(footer ? { footer: { text: footer } } : {}),
    action: { button: buttonLabel.slice(0, 20), sections: [{ title: "Options", rows: rows.slice(0, 10).map(r => ({ id: r.id, title: r.title.slice(0, 24), description: (r.description || "").slice(0, 72) })) }] },
  },
}, body);

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

/* ── Conversation logic ──────────────────────────────────────── */
async function sendMainMenu(to) {
  const u = db.prepare("SELECT first_name, miles, tier FROM users WHERE id=1").get();
  await sendList(to,
    `Olá ${u.first_name} 👋 This is TAP on WhatsApp — fully linked to your Miles&Go account (${u.tier}, ${u.miles.toLocaleString()} miles).\n\nWhat would you like to do?`,
    "Choose",
    [
      { id: "BOOK_USUAL", title: "Book my usual flight", description: "TP1927 Porto → Lisbon, Mon 07:05, seat 4C" },
      { id: "MY_BOOKING", title: "My booking", description: "View, check in, or change your trip" },
      { id: "EXTRAS", title: "Add extras", description: "Meal, Wi-Fi, transfer — added to your trip" },
      { id: "STATUS", title: "Flight status", description: "Live status of your next flight" },
      { id: "CANCEL", title: "Cancel booking", description: "Instant refund to original payment" },
    ],
    "Every action here updates the same TAP database as the app");
}

async function handleAction(to, id) {
  /* Book the usual flight, one tap */
  if (id === "BOOK_USUAL") {
    const flights = await apiCall("GET", "/flights?dest=LIS&origin=OPO");
    const f = flights.find(x => x.flight_no === "TP1927") || flights[0];
    await sendButtons(to,
      `✈️ ${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)}\nMon 15 Jun · ${f.dep}–${f.arr} · Seat 4C\nCabin bag + espresso pre-selected (your usuals)\n\nTotal €90.50 — €35 voucher and 6,000 miles applied, €37.50 to Visa ••4417.`,
      [{ id: `PAY_${f.flight_no}`, title: "Pay now" }, { id: `HOLD_${f.flight_no}`, title: "Hold 48h free" }, { id: "MENU", title: "Back" }],
      "One-tap payment from your saved profile");
    return;
  }
  if (id.startsWith("PAY_")) {
    const fno = id.slice(4);
    const r = await apiCall("POST", "/pay", { flight_no: fno, items: ["seat","bag","meal"], total: 90.5, voucher_amt: 35, miles_used: 6000, miles_amt: 18, card_amt: 37.5 });
    await sendText(to, `✅ Booked! Confirmation *${r.pnr}*.\n\nPayment split: voucher −€35 · 6,000 miles −€18 · Visa ••4417 €37.50.\nConfirmation email sent to your inbox. Auto check-in is ON — your boarding pass will appear 24h before departure.`);
    await sendMainMenu(to);
    return;
  }
  if (id.startsWith("HOLD_")) {
    const fno = id.slice(5);
    const r = await apiCall("POST", "/hold", { flight_no: fno, items: ["seat","bag","meal"], total: 90.5 });
    await sendText(to, `⏳ Held for you until *${r.expires}* — price, seat 4C and extras frozen, free as a Gold benefit. Hold confirmation emailed. Tap "Book my usual flight" anytime to complete.`);
    return;
  }

  /* Latest booking summary */
  if (id === "MY_BOOKING") {
    const b = latestBooking();
    if (!b) { await sendText(to, "You have no active booking yet. Tap *Book my usual flight* to get going."); return sendMainMenu(to); }
    const f = flightByNo(b.flight_no) || {};
    await sendButtons(to,
      `📄 *${b.pnr}* — ${b.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)}\nMon 15 Jun · ${f.dep}–${f.arr} · Seat ${b.seat}\nStatus: ${f.status === "delayed" ? `⚠️ delayed, new departure ${f.new_dep}` : "on time"} · ${b.checked_in ? "Checked in" : "Auto check-in 24h before"}`,
      [{ id: "CHECKIN", title: "Check in now" }, { id: "EXTRAS", title: "Add extras" }, { id: "MENU", title: "Back" }]);
    return;
  }
  if (id === "CHECKIN") {
    const b = latestBooking();
    if (b) db.prepare("UPDATE bookings SET checked_in=1 WHERE id=?").run(b.id);
    db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('wa_checkin',?,?)").run(JSON.stringify({ pnr: b?.pnr }), now());
    await sendText(to, `🎫 Checked in! Boarding pass issued in the app — Group A (Gold), seat ${b?.seat || "4C"}. It updates live if anything changes.`);
    return;
  }

  /* Ancillaries */
  if (id === "EXTRAS") {
    const anc = db.prepare("SELECT * FROM ancillaries WHERE price > 0").all();
    await sendList(to, "Add to your trip — charged to your saved Visa, instantly on your booking:", "Pick an extra",
      anc.map(a => ({ id: `ANC_${a.code}`, title: `${a.name.slice(0,20)}`, description: `€${a.price} — ${a.descr}` })));
    return;
  }
  if (id.startsWith("ANC_")) {
    const code = id.slice(4);
    const r = await apiCall("POST", "/bookings/ancillary", { code });
    if (r.ok) await sendText(to, `✅ Added *${r.name}* (€${r.price}) to ${r.pnr} — charged to Visa ••4417. Updated itinerary emailed.`);
    else await sendText(to, "You need an active booking first — tap *Book my usual flight*.");
    return;
  }

  /* Flight status */
  if (id === "STATUS") {
    const b = latestBooking();
    const f = b ? flightByNo(b.flight_no) : null;
    if (!f) { await sendText(to, "No upcoming flight on file. Book one first!"); return; }
    await sendText(to, f.status === "delayed"
      ? `⚠️ ${f.flight_no} is delayed — new departure *${f.new_dep}*, landing ${f.new_arr}. We've emailed your options; reply here and I can rebook you in one tap.`
      : `🟢 ${f.flight_no} ${cityName(f.origin)} → ${cityName(f.dest)} is *on time*. Departure ${f.dep}, gate closes 20 min before. Live tracking is on — I'll message you the moment anything changes.`);
    return;
  }

  /* Cancellation with confirm step */
  if (id === "CANCEL") {
    const b = latestBooking();
    if (!b) { await sendText(to, "Nothing to cancel — you have no active booking."); return; }
    await sendButtons(to,
      `You're about to cancel *${b.pnr}* (${b.flight_no}, Mon 15 Jun).\nRefund goes back instantly to the original payment split — voucher, miles and card.`,
      [{ id: `CONFIRM_CANCEL_${b.id}`, title: "Yes, cancel" }, { id: "MENU", title: "Keep my booking" }]);
    return;
  }
  if (id.startsWith("CONFIRM_CANCEL_")) {
    const r = await apiCall("POST", "/bookings/cancel", {});
    if (r.ok) await sendText(to, `✅ ${r.pnr} cancelled. Refund issued instantly: miles restored, voucher reactivated, card amount returned to Visa ••4417. Confirmation emailed — no forms, no queue.`);
    else await sendText(to, "No active booking found to cancel.");
    await sendMainMenu(to);
    return;
  }

  /* Disruption rebooking buttons (pushed proactively by the portal's disrupt action) */
  if (id.startsWith("REBOOK_")) {
    const optId = id.slice(7);
    const label = optId === "KEEP" ? "Keep my original flight" : `Move to ${optId}`;
    await apiCall("POST", "/rebook", { option: { id: optId === "KEEP" ? (latestBooking()?.flight_no || "TP1927") : optId, label } });
    await sendText(to, `✅ Done — ${label.toLowerCase()}. New boarding pass issued, seat 4C kept, confirmation emailed. Nothing else to do.`);
    return;
  }

  if (id === "MENU") return sendMainMenu(to);

  /* Fallback */
  await sendText(to, "I didn't catch that — here's the menu:");
  await sendMainMenu(to);
}

/* ── Inbound webhook processing ──────────────────────────────── */
async function handleIncoming(body) {
  const value = body?.entry?.[0]?.changes?.[0]?.value;
  const msg = value?.messages?.[0];
  if (!msg) return;                       // delivery/read receipts etc.
  const from = msg.from;

  let actionId = null, text = "";
  if (msg.type === "interactive") {
    actionId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
    text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  } else if (msg.type === "button") {     // template quick-reply
    actionId = msg.button?.payload; text = msg.button?.text || "";
  } else if (msg.type === "text") {
    text = msg.text?.body || "";
  }
  logWA("in", from, msg.type, text, { actionId }, "received");
  db.prepare("INSERT INTO events (type,payload_json,created_at) VALUES ('wa_inbound',?,?)").run(JSON.stringify({ from, text, actionId }), now());

  // Remember the most recent conversation partner so the portal can push proactively
  db.prepare("UPDATE users SET wa_id=? WHERE id=1").run(from);

  if (actionId) return handleAction(from, actionId);

  // Free text → simple intents, else menu
  const t = text.toLowerCase();
  if (/book/.test(t)) return handleAction(from, "BOOK_USUAL");
  if (/cancel/.test(t)) return handleAction(from, "CANCEL");
  if (/status|delay/.test(t)) return handleAction(from, "STATUS");
  return sendMainMenu(from);
}

/* ── Proactive push: portal disruption → WhatsApp buttons ────── */
async function pushDisruption(f, recovery) {
  const to = process.env.WHATSAPP_DEFAULT_TO || db.prepare("SELECT wa_id FROM users WHERE id=1").get()?.wa_id;
  if (!to) { logWA("out", "", "skipped", "Disruption push skipped — no WhatsApp recipient known yet", {}, "no recipient"); return; }
  const opts = (recovery.options || []).slice(0, 2);
  await sendButtons(to,
    `⚠️ *${recovery.headline}*\n\n${recovery.message}\n\n🛡 ${recovery.compensation}`,
    [
      { id: "REBOOK_KEEP", title: (opts[0]?.label || "Keep my flight").slice(0, 20) },
      { id: `REBOOK_${opts[1]?.id || "TP1931"}`, title: (opts[1]?.label || "Move me").slice(0, 20) },
    ],
    "Tap to decide — no app, no queue");
}

module.exports = { handleIncoming, pushDisruption, sendMainMenu, CONFIGURED };
