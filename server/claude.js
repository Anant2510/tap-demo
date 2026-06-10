/* ──────────────────────────────────────────────────────────────
   TAP Demo — Claude AI service (server-side)
   Set ANTHROPIC_API_KEY in .env for live AI. Without it, the
   demo still works using realistic cached responses.
   ────────────────────────────────────────────────────────────── */
const { db } = require("./db");

function danielContext() {
  const u = db.prepare("SELECT * FROM users WHERE id=1").get();
  const p = db.prepare("SELECT * FROM preferences WHERE user_id=1").get();
  const hist = db.prepare("SELECT flight_no,route,trip_date,dep_time FROM travel_history WHERE user_id=1 ORDER BY trip_date").all();
  return `You are the AI inside TAP Air Portugal's digital channel, serving one logged-in customer.
CUSTOMER PROFILE (live from the customer database):
- ${u.full_name}, 41, ${u.nationality}. Senior Digital Strategy Consultant. TAP Miles&Go ${u.tier.toUpperCase()}.
- Miles: ${u.miles.toLocaleString()}. Voucher: €35. Saved card ${u.card_brand} ••${u.card_last4}.
- Preferences: seat ${p.seat}; ${p.bag}; meal ${p.meal}; auto check-in ${p.auto_checkin ? "ON" : "OFF"}.
- Travel history (last ${hist.length} flights): ${hist.map(h => `${h.trip_date} ${h.flight_no} ${h.route} ${h.dep_time}`).join("; ")}.
- Pattern: flies OPO⇄LIS for business, outbound Mondays ~07:05 (TP1927), return Thursdays ~18:35 (TP1943). Tight client schedules in Lisbon.
- Personality: time-pressed, values efficiency and control, hates redirects and extra steps.
Tone: crisp, professional, warm but brief. 24h times, EUR. Today is ${new Date().toDateString()}.`;
}

async function callClaude(messages, { json = false, maxTokens = 1000 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no_api_key");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      system: danielContext() + (json ? "\nCRITICAL: Respond with ONLY a valid JSON object. No preamble, no markdown fences." : ""),
      messages,
    }),
  });
  if (!res.ok) throw new Error("api_" + res.status + ": " + (await res.text()).slice(0, 200));
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
  if (!json) return text;
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

/* Cached fallbacks so the demo never stalls without a key/network */
const FALLBACKS = {
  plan: {
    title: "Lisbon client week",
    summary: "Built around your usual Monday-out, Thursday-back rhythm, Daniel.",
    legs: [
      { day: "Mon 15 Jun", flight: "TP1927", route: "OPO → LIS", times: "07:05 – 08:00", why: "Matches 9 of your last 12 outbound departures — at the client by 09:30." },
      { day: "Thu 18 Jun", flight: "TP1943", route: "LIS → OPO", times: "18:35 – 19:30", why: "Your usual return; buffer after a 16:00 wrap-up meeting." },
    ],
    tip: "As Gold, you can fare-lock both legs free for 24h while your client confirms.",
  },
  recovery: {
    headline: "TP1927 delayed — new departure 08:55",
    message: "Daniel, your aircraft is arriving late from Lisbon, so TP1927 now departs 08:55 and lands 09:50. That makes your 10:00 meeting very tight — here are your realistic options, no queue needed.",
    options: [
      { id: "TP1927", label: "Keep TP1927 · lands 09:50", detail: "Tight but doable — we'll fast-track you on arrival (Gold)." },
      { id: "TP1931", label: "Move to TP1931 · 09:10 → 10:05", detail: "Guaranteed seat 4C, lands after 10:00 — better if the meeting can shift 30 min." },
    ],
    compensation: "Gold + EU261: lounge access now, €10 meal voucher added to your wallet automatically.",
  },
  offer: {
    subject: "Daniel — your Mondays just got an upgrade",
    title: "A fixed seat on your weekly commute",
    preheader: "9 of your last 12 Mondays were TP1927. Lock the pattern in.",
    body_html: "You've flown <b>TP1927 OPO→LIS</b> on 9 of your last 12 Mondays. This month, book your next four Monday flights together and we'll hold <b>seat 4C on every one</b>, fix the fare at <b>€79 per leg</b> (vs €86 average), and credit <b>double miles</b> — about 1,720 extra toward your 48,230 balance.",
    cta: "Lock in my Mondays",
  },
  chat: "I can help with that. Your next confirmed trip is TP1927 OPO→LIS on Mon 15 Jun, 07:05, seat 4C — say the word if you want to change, hold, or check disruption risk. (Live AI is offline in this environment, but all booking tools are fully functional.)",
};

module.exports = { callClaude, FALLBACKS, hasKey: () => !!process.env.ANTHROPIC_API_KEY };
