// FlyTAP v2 — TAP AI concierge, mapped to behave like v1's "TAP AI Assistant":
// same dynamic greeting (name · usual route · recommended date · Adobe RT-CDP source),
// same suggestion chips (Express + Best-time / under €500 / in October), and the same
// LIVE agent backend (/api/ai/agent). Embedded mode replaces the hero search; full mode
// is the /ai route with a context rail.
import React, { useState, useRef, useEffect } from "react";
import { api, EUR, miles, tierProgress } from "./lib.js";
import { Btn, Card, Pill, Icon, Eyebrow, Divider, cx } from "./ui.jsx";

function FlightCard({ card, onPick }) {
  return (
    <div className="rounded-xl border border-line overflow-hidden mt-2">
      {(card.flights || []).slice(0, 3).map((f, i) => (
        <button key={f.flight_no} onClick={() => onPick(f)} className={cx("w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-surface-mute", i > 0 && "border-t border-line")}>
          <div className="text-[15px] font-bold v2-num w-14">{f.dep}</div>
          <div className="flex-1"><div className="text-[12px] font-semibold">{f.flight_no} → {f.arr}</div><div className="text-[11px] text-ink-faint">{f.duration} · Direct · Classic</div></div>
          {(f.recommended || f.lowest) && <Pill tone="lime">{f.recommended ? "Recommended" : "Lowest"}</Pill>}
          <div className="text-right"><div className="text-[13px] font-bold v2-num">{EUR(f.price)}</div>{f.miles_price && <div className="text-[10px] text-tap-greenDeep v2-num">or {miles(f.miles_price)} mi</div>}</div>
        </button>
      ))}
    </div>
  );
}
function Bubble({ m, onPick, onQuick, go }) {
  if (m.role === "user") return <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-br-md bg-surface-dark text-white px-3.5 py-2.5 text-[13px]">{m.content}</div></div>;
  const c = (m.cards || [])[0];
  return (
    <div className="space-y-2">
      {m.content && <div className={cx("text-[13px] text-ink leading-relaxed whitespace-pre-line", m.intro && "rounded-2xl bg-surface-mute px-4 py-3")}>{m.content}</div>}
      {c?.type === "flights" && <FlightCard card={c} onPick={onPick} />}
      {c && c.type !== "flights" && <div className="rounded-xl border border-line bg-surface-soft p-3 text-[12px] text-ink-muted">{c.type === "package" ? `${c.event} · ${c.city} — ${EUR(c.total)} (flight + hotel + event)` : c.type === "wallet" ? `Wallet: ${miles(c.miles)} miles (~${EUR(c.miles_value_eur)})${c.voucher ? ` + ${EUR(c.voucher)} voucher` : ""}` : c.type === "confirmation" ? `Booked · PNR ${c.pnr}` : c.type === "booking" ? `Booking ${c.pnr} · ${c.route} · ${c.dep}` : c.type === "suggestions" ? "Here are some options for you." : "Done."}</div>}
      {m.command?.action === "show_search" && <Btn size="sm" variant="outline" className="mt-1" onClick={() => go("results", { origin: m.command.origin, dest: m.command.dest, date: m.command.date })}>View all flights →</Btn>}
      {m.command?.action === "express" && <Btn size="sm" variant="outline" className="mt-1" onClick={() => go("express")}>Open express checkout →</Btn>}
      {(m.command?.action === "navigate" && m.command.screen) && <Btn size="sm" variant="outline" className="mt-1" onClick={() => go(m.command.screen === "search" ? "results" : m.command.screen === "manage" ? "basket" : m.command.screen)}>Open →</Btn>}
      {m.quick && <div className="flex flex-wrap gap-1.5 pt-1">{m.quick.map(q => <button key={q} onClick={() => onQuick(q)} className="px-2.5 py-1 rounded-full bg-lime-tint text-tap-greenDark text-[11px] font-semibold">+ {q}</button>)}</div>}
    </div>
  );
}

export function AIConcierge({ shared, go, embedded, onToggleOff }) {
  const profile = shared?.profile || {};
  const u = profile.user || {};
  const pat = profile.pattern || {};
  const airports = shared?.airports || [];
  const cityOf = (c) => airports.find(a => a.code === c)?.city || c;
  const origin = pat.origin || u.home_airport || "OPO";
  const dest = pat.dest || "LIS";
  const destCity = cityOf(dest);
  const dateLabel = pat.recommendedLabel || pat.usualOut || "your usual date";
  const sourceLabel = (profile.cdp || /cdp|adobe/i.test(String(profile.source || ""))) ? "Adobe Real-Time CDP" : "TAP";
  const greeting = `Hi ${u.first_name || "there"} ✈️ Tell me where you want to go and when — I'll plan the rest.\n\n⚡ Or book your usual ${cityOf(origin)} → ${cityOf(dest)} for ${dateLabel} in two taps with Express checkout.\n\n🔗 Personalizing from your ${sourceLabel} profile.`;
  const SUGS = [
    { label: `⚡ Express · your usual · ${dateLabel}`, send: "Book my usual flight with Express checkout", express: true },
    { label: `Best time to visit ${destCity}`, send: `When is the best time to visit ${destCity}?` },
    { label: `Flights under €500 to ${destCity}`, send: `Show me flights under €500 to ${destCity}` },
    { label: `${destCity} in October?`, send: `What are my options for ${destCity} in October?` },
  ];

  const [msgs, setMsgs] = useState([{ role: "assistant", content: greeting, intro: true }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef("v2-" + Math.random().toString(36).slice(2, 8));
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text) {
    const q = (text != null ? text : input).trim(); if (!q || busy) return;
    const next = [...msgs, { role: "user", content: q }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      // omit the intro greeting from the model history
      const history = next.filter(m => !m.intro).map(m => ({ role: m.role, content: m.content }));
      const r = await api.post("/ai/agent", { messages: history, screen: "home", sessionId: session.current });
      const quick = (r.cards || [])[0]?.type === "flights" ? ["Book the first option", "Pay with miles", "Earlier outbound?"] : [];
      setMsgs([...next, { role: "assistant", content: r.reply, cards: r.cards, command: r.command, quick }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: "I'm having trouble reaching the assistant right now — please try again in a moment." }]);
    } finally { setBusy(false); }
  }
  const pickFlight = (f) => send(`Book ${f.flight_no} departing ${f.dep}`);

  const Composer = (
    <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
      <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Tell me where you want to go and when" className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-faint" />
      <button className="text-ink-faint hover:text-ink"><Icon name="mic" size={16} /></button>
      <button onClick={() => send()} disabled={busy} className="w-8 h-8 rounded-full bg-tap-green text-white inline-flex items-center justify-center disabled:opacity-50"><Icon name="send" size={15} /></button>
    </div>
  );
  const Suggestions = (
    <div className="flex flex-wrap gap-1.5">
      {SUGS.map(s => (
        <button key={s.label} onClick={() => send(s.send)} className={cx("px-3 py-1.5 rounded-full text-[12px] font-semibold", s.express ? "bg-tap-green text-white" : "bg-surface border border-line text-ink hover:bg-surface-mute")}>{s.label}</button>
      ))}
    </div>
  );
  const Thread = (
    <div className={cx("space-y-3 overflow-y-auto v2-track", embedded ? "max-h-[360px] mt-3" : "flex-1 py-4")}>
      {msgs.map((m, i) => <Bubble key={i} m={m} onPick={pickFlight} onQuick={send} go={go} />)}
      {busy && <div className="text-[12px] text-ink-faint flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-tap-green animate-pulse" /> TAP AI is thinking…</div>}
      <div ref={endRef} />
    </div>
  );

  /* ── embedded (replaces hero search) ── */
  if (embedded) {
    return (
      <Card className="mt-5 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div><div className="flex items-center gap-2 text-[15px] font-bold"><Icon name="spark" size={16} className="text-tap-green" /> TAP AI Assistant</div><div className="text-[11px] text-tap-greenDeep font-semibold flex items-center gap-1 mt-0.5"><span className="w-1.5 h-1.5 rounded-full bg-tap-green" /> Online · personalized from {sourceLabel}</div></div>
          <button onClick={onToggleOff} className="flex items-center gap-2 text-[12px] font-semibold text-ink-muted">TAP AI <span className="w-9 h-5 rounded-full bg-lime relative"><span className="absolute right-0.5 top-0.5 w-4 h-4 rounded-full bg-white" /></span></button>
        </div>
        {Thread}
        <div className="mt-3 mb-3">{Suggestions}</div>
        {Composer}
        <button onClick={() => go("ai")} className="mt-3 text-[12px] font-semibold text-tap-greenDeep">Expand full chat ↗</button>
      </Card>
    );
  }

  /* ── full screen (/ai route) ── */
  return (
    <div className="bg-surface-soft min-h-screen">
      <div className="mx-auto max-w-page px-6 py-6 grid lg:grid-cols-[1fr_320px] gap-6 items-start">
        <Card className="p-0 flex flex-col h-[74vh] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 text-white" style={{ background: "linear-gradient(100deg,#c0392b,#a93226)" }}>
            <div className="flex items-center gap-2.5"><span className="w-8 h-8 rounded-full bg-white/15 inline-flex items-center justify-center"><Icon name="spark" size={15} /></span><div><div className="text-[14px] font-bold">TAP AI Assistant</div><div className="text-[11px] text-white/80 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-lime" /> Online</div></div></div>
            <div className="flex items-center gap-3 text-[12px] font-semibold text-white/90"><button onClick={() => setMsgs([{ role: "assistant", content: greeting, intro: true }])}>+ New chat</button><button onClick={() => go("home")}>✕ Close</button></div>
          </div>
          <div className="px-5 flex-1 flex flex-col overflow-hidden">{Thread}</div>
          <div className="px-5 py-3 border-t border-line"><div className="mb-2">{Suggestions}</div>{Composer}<div className="text-[11px] text-ink-faint mt-2 flex items-center gap-1.5"><Icon name="lock" size={11} /> Private to you · not used to train AI</div></div>
        </Card>
        <aside className="space-y-4">
          <Card className="p-4">
            <Eyebrow className="mb-2">Your context</Eyebrow>
            <div className="space-y-2 text-[12px]">
              <div><div className="text-ink-faint">Tier</div><div className="font-semibold">{u.tier} · {miles(u.miles)} miles</div></div>
              <div><div className="text-ink-faint">Usual route</div><div className="font-semibold">{cityOf(origin)} → {cityOf(dest)} · {dateLabel}</div></div>
              <div><div className="text-ink-faint">Upcoming</div><div className="font-semibold">{shared?.journey?.flight_no || "—"} {shared?.journey?.origin ? `${shared.journey.origin}→${shared.journey.dest}` : ""}</div></div>
              <div><div className="text-ink-faint">Source</div><div className="font-semibold">{sourceLabel}</div></div>
            </div>
          </Card>
          <Card className="p-4 bg-lime-tint border-lime/40">
            <div className="text-[13px] font-bold flex items-center gap-1.5"><Icon name="lock" size={13} className="text-tap-greenDeep" /> Your data is private</div>
            <div className="text-[11px] text-ink-muted mt-1">Chats stay in your TAP account. Never used to train AI. We only see traveller context you allow.</div>
            <div className="flex gap-4 mt-2 text-[12px] font-semibold text-tap-greenDeep"><button>Manage data</button><button>Delete all</button></div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
