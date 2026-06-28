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
// Base headers + the session header when bound. Built per-call so a fresh login is picked up.
const hdrs = (extra) => ({ "X-App": "v2", ...(SID ? { "X-Session-Id": SID } : {}), ...(extra || {}) });
export const api = {
  get: (p) => fetch(API + p, { headers: hdrs() }).then(j),
  post: (p, body) => fetch(API + p, { method: "POST", headers: hdrs({ "Content-Type": "application/json" }), body: JSON.stringify(body || {}) }).then(j),
};

export const EUR = (n) => n == null ? "—" : `€${Number(n).toFixed(Number(n) % 1 === 0 ? 0 : 2)}`;
export const miles = (n) => Number(n || 0).toLocaleString("en-GB");
export const MILES_RATE = 0.003; // ~1,000 mi ≈ €3 (matches server)

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
