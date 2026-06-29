// FlyTAP v2 — API client + formatters. Same-origin: the v2 app is served at /v2/,
// the backend API lives at /api/* (unchanged). No build/server changes required.
const API = "/api";
const j = (r) => r.json();

// Per-session identity: the sessionId returned by /api/auth/login|register. Sent as
// X-Session-Id on EVERY request so the server resolves the right user (multi-user seam).
// Hydrated from localStorage so it survives a page reload (re-minted on boot via re-login,
// since server sessions are in-memory — see main.jsx). This is the single choke point.
let SID = (() => { try { return localStorage.getItem("flytap_sid") || null; } catch { return null; } })();
export function setSessionId(id) {
  SID = id || null;
  try { id ? localStorage.setItem("flytap_sid", id) : localStorage.removeItem("flytap_sid"); } catch {}
}
export const getSessionId = () => SID;

// Boot session gate. Server sessions are in-memory and clear on restart, so the sid
// hydrated from localStorage above is unreliable until the app re-logs-in on boot. Until
// then a request would carry the STALE sid and the server falls back to its default user —
// which surfaced the wrong person in once-on-mount panels (e.g. the 360° profile fired on
// mount before re-login finished). So api.* parks every call on this gate until main.jsx
// settles the session and calls authReady(). A timeout fallback guarantees the gate always
// opens, so a missing/hung re-login can never brick the app. The boot re-login itself is
// the call that settles the session, so it passes { ungated:true } to skip the gate.
let _openGate, _gateOpen = false;
const _gate = new Promise((res) => { _openGate = res; });
export function authReady() { if (!_gateOpen) { _gateOpen = true; _openGate(); } }
setTimeout(authReady, 5000);   // belt-and-suspenders: never hold boot calls longer than this

// Base headers + the session header when bound. Built per-call so a fresh login is picked up.
const hdrs = (extra) => ({ "X-App": "v2", ...(SID ? { "X-Session-Id": SID } : {}), ...(extra || {}) });
const _send = (p, init, opts) => {
  const go = () => fetch(API + p, init).then(j);
  return (opts && opts.ungated) ? go() : _gate.then(go);   // gate held until the session is settled
};
export const api = {
  get: (p, opts) => _send(p, { headers: hdrs() }, opts),
  post: (p, body, opts) => _send(p, { method: "POST", headers: hdrs({ "Content-Type": "application/json" }), body: JSON.stringify(body || {}) }, opts),
};

export const EUR = (n) => n == null ? "—" : `€${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2)}`;
export const miles = (n) => Number(n || 0).toLocaleString("en-GB");
export const MILES_RATE = 0.003; // ~1,000 mi ≈ €3 (matches server)

// Trigger a real client-side file download from in-memory content (used by the booking-
// confirmed quick actions: e-ticket, boarding pass, calendar — #13).
export function downloadFile(filename, content, mime = "text/plain") {
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return true;
  } catch { return false; }
}
// Minimal RFC-5545 VEVENT so "Add to Calendar" produces a file any calendar app imports.
export function buildICS({ title, start, end, location, description }) {
  const fmt = (d) => { const x = new Date(d); return isNaN(x.getTime()) ? "" : x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); };
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TAP Air Portugal//FlyTAP//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}@flytap`, `DTSTAMP:${fmt(new Date())}`, start ? `DTSTART:${fmt(start)}` : "",
    end ? `DTEND:${fmt(end)}` : "", `SUMMARY:${title || "TAP flight"}`,
    location ? `LOCATION:${location}` : "", description ? `DESCRIPTION:${description}` : "",
    "END:VEVENT", "END:VCALENDAR"].filter(Boolean).join("\r\n");
}

// Tier ladder (demo thresholds; progress is computed from LIVE miles so it's truthful)
export const TIERS = [
  { name: "Silver", at: 0 },
  { name: "Gold", at: 35000 },
  { name: "Platinum", at: 56000 },
];
export function tierProgress(tier, milesBalance) {
  const i = Math.max(0, TIERS.findIndex(t => t.name === tier));
  const next = TIERS[i + 1];
  if (!next) return { next: null, pct: 100, toGo: 0 };
  const base = TIERS[i].at;
  const pct = Math.max(0, Math.min(100, Math.round(((milesBalance - base) / (next.at - base)) * 100)));
  return { next: next.name, pct, toGo: Math.max(0, next.at - milesBalance) };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (iso, withYear = false) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00"); if (isNaN(d)) return iso;
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
};
export const cityFromMap = (map, code) => (map[code] && map[code].city) || code;
