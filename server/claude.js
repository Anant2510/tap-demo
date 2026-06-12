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
  const upcoming = db.prepare("SELECT pnr,flight_no,flight_date,seat FROM bookings WHERE user_id=1 AND status='confirmed' ORDER BY flight_date").all();
  const pastCount = db.prepare("SELECT COUNT(*) c FROM bookings WHERE user_id=1 AND status='completed'").get().c;
  return `You are the AI inside TAP Air Portugal's digital channel, serving one logged-in customer.
CUSTOMER PROFILE (live from the customer database):
- ${u.full_name}, 41, ${u.nationality}. Senior Digital Strategy Consultant. TAP Miles&Go ${u.tier.toUpperCase()}.
- Miles: ${u.miles.toLocaleString()}. Voucher: €35. Saved card ${u.card_brand} ••${u.card_last4}.
- Preferences: seat ${p.seat}; ${p.bag}; meal ${p.meal}; auto check-in ${p.auto_checkin ? "ON" : "OFF"}.
- Travel history (last ${hist.length} flights): ${hist.map(h => `${h.trip_date} ${h.flight_no} ${h.route} ${h.dep_time}`).join("; ")}.
- Bookings on file: ${pastCount} completed past trips, and ${upcoming.length} upcoming/active: ${upcoming.map(b => `${b.pnr} ${b.flight_no} on ${b.flight_date} seat ${b.seat}`).join("; ") || "none"}.
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

/* ── Agentic tool-use call ───────────────────────────────────────
   Lets Claude call real tools (defined by the caller) in a loop.
   `runTool(name, input)` must return a JSON-serialisable result.
   Returns { reply, toolCalls } where reply is the final text and
   toolCalls is the ordered list of {name, input, result} executed,
   which the server turns into UI cards + a screen command. */
async function callClaudeAgent(messages, tools, runTool, { maxTokens = 1200, maxTurns = 5 } = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no_api_key");
  const convo = [...messages];
  const toolCalls = [];
  const sys = danielContext() + `

You are an in-app booking agent. You can take real actions through tools that read and write the same database the website uses. When the customer wants to find, choose, add extras to, pay for, check in, or cancel a flight, USE THE TOOLS — don't just describe what you'd do, and never guess or assume the outcome.

GENUINENESS IS CRITICAL: your reply must reflect EXACTLY what the tool result says — never claim something happened that the tool didn't confirm. Tools return a "state" and sometimes a "message"; honour them:
- check_in → state "checked_in_now" (confirm the boarding pass, group, seat, flight), "already_checked_in" (tell them they're ALREADY checked in for that flight — do not pretend to check them in again), or "no_booking" (tell them there's no upcoming flight to check in for, offer to book).
- cancel_booking → state "needs_confirm" (ask them to confirm the specific PNR/route before cancelling — do NOT cancel yet), "cancelled" (confirm the refund split), or "no_booking" (nothing to cancel).
- If a tool returns ok:false, tell the customer the real reason plainly; never fabricate a success.

DESTINATIONS — NEVER ASSUME WHERE THEY WANT TO GO:
- HARD RULE: if a message names an origin (or implies one) but NO specific destination, your FIRST action must be to call list_destinations for that origin. Do not answer from memory, do not call search_flights, do not assume Porto or any city. Only after list_destinations returns may you reply.
- If the customer asks for flights but doesn't say a destination (e.g. "options for flights from Lisbon", "flights from Lisbon to any destination"), call list_destinations for that origin and present the real list of cities TAP flies to from there, then ask which one. Daniel's home pattern is OPO⇄LIS, but that is NOT a reason to assume Porto — he may want anywhere. Lisbon alone serves dozens of destinations.
- If the customer asks a FACTUAL question about the network ("do we only fly to Porto from Lisbon?", "where can I fly from Madrid?"), call list_destinations and ANSWER the question in words (e.g. "No — from Lisbon you fly to 44 cities including Madrid, London, Paris, Frankfurt, New York and more"). Do NOT trigger a flight search for a factual question, and do NOT imply the network is smaller than it is.
- Only call search_flights once you know BOTH origin and a specific destination.
- When you do list destinations, add a brief personal touch where true (e.g. note the ones Daniel has flown before), and if there are many, group or summarise (e.g. "44 cities — Europe, the Americas and Africa") rather than dumping all of them.

After acting, reply in one or two crisp sentences using the real PNR, route, date and seat from the result; the UI renders cards and updates the screen, so don't list every flight in prose. Always work from Daniel's real profile (saved card, voucher, miles, seat 4C, the OPO⇄LIS pattern).`;

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens: maxTokens, system: sys, tools, messages: convo,
      }),
    });
    if (!res.ok) throw new Error("api_" + res.status + ": " + (await res.text()).slice(0, 200));
    const data = await res.json();
    const blocks = data.content || [];
    convo.push({ role: "assistant", content: blocks });

    const toolUses = blocks.filter(b => b.type === "tool_use");
    if (toolUses.length === 0) {
      const reply = blocks.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
      return { reply, toolCalls };
    }
    // Execute each requested tool and feed results back
    const results = [];
    for (const tu of toolUses) {
      let result;
      try { result = await runTool(tu.name, tu.input || {}); }
      catch (e) { result = { error: e.message }; }
      toolCalls.push({ name: tu.name, input: tu.input || {}, result });
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 4000) });
    }
    convo.push({ role: "user", content: results });
  }
  // Ran out of turns — return whatever text we have
  return { reply: "Done.", toolCalls };
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

/* ── Genuine-response layer ──────────────────────────────────────
   The DETERMINISTIC code computes verified facts (from the DB) and a
   `state`. This helper turns those verified facts into natural,
   on-brand language — the LLM only PHRASES facts, it never invents
   outcomes. If the API key is missing or the call fails, a built-in
   deterministic phrasing is returned, so the truth is identical with
   or without the LLM. Channel = "whatsapp" | "web".  ─────────────── */
async function phraseFromFacts(facts, { channel = "web", fallback } = {}) {
  const safe = fallback || facts.message || "Done.";
  if (!process.env.ANTHROPIC_API_KEY) return safe;
  try {
    const sys = danielContext() + `

You phrase the result of an action that ALREADY HAPPENED (or was verified) against the real database. You are given a JSON "facts" object with the true outcome. Write ONE short, natural, warm confirmation message to Daniel that states exactly what the facts say — do not add, change, or invent any detail (no made-up times, gates, prices, or statuses). If the facts say an action could NOT happen (e.g. already done, nothing to do), say so plainly and helpfully. ${channel === "whatsapp" ? "This is WhatsApp: keep it to 1–3 short lines, no markdown headers. You may end with a brief next step." : "Keep it to 1–2 sentences."} Use 24h times and EUR. Never claim success the facts don't support.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens: 220, system: sys,
        messages: [{ role: "user", content: "facts = " + JSON.stringify(facts) }],
      }),
    });
    if (!res.ok) return safe;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join(" ").trim();
    return text || safe;
  } catch { return safe; }
}

module.exports = { callClaude, callClaudeAgent, phraseFromFacts, FALLBACKS, hasKey: () => !!process.env.ANTHROPIC_API_KEY };
