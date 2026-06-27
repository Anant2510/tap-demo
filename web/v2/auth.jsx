// FlyTAP v2 — login. Login is reached from the home screen's top-right button:
// it opens this dialog (username + password). On submit the user is logged in and
// the SAME home route re-renders as the personalized view (no separate login page).
// Credentials are cosmetic in the demo (the active persona is user_id=1); any
// password works and the field is prefilled for a one-click demo.
import React, { useState, useEffect } from "react";
import { Btn, Icon, TierBadge } from "./ui.jsx";
import { TapLogo } from "./shell.jsx";

// Each demo persona has a distinct identity. Match the entered email / member number to a
// persona so logging in as Daniel actually switches the live record to Daniel. (Previously
// login ignored the field and signed you in as whatever persona was last active — which is
// why entering Daniel's email still showed Lars.)
const ACCOUNTS = {
  "anant.direct2links+daniel@gmail.com": "daniel", "pt-990001": "daniel", "daniel": "daniel", "daniel ferreira": "daniel",
  "anant.direct2links+sofia@gmail.com": "sofia", "pt-990002": "sofia", "sofia": "sofia", "sofia marques": "sofia",
  "anant.direct2links+lars@gmail.com": "lars", "de-100294": "lars", "de-990003": "lars", "lars": "lars", "lars andersen": "lars",
};
function resolvePersona(v) {
  const k = (v || "").trim().toLowerCase();
  if (!k) return null;
  if (ACCOUNTS[k]) return ACCOUNTS[k];
  // Lenient demo matching: any email whose local-part names a member resolves to them
  // (e.g. daniel@flytap.demo, sofia@anything). Exact seeded emails, names, full names
  // and member numbers all still work.
  const local = k.split("@")[0].replace(/[._-].*$/, "");   // "daniel.ferreira" → "daniel"
  if (ACCOUNTS[local]) return ACCOUNTS[local];
  const compact = k.replace(/[\s-]/g, "");                  // "pt884512" → matches "pt-884512"
  for (const key in ACCOUNTS) if (key.replace(/[\s-]/g, "") === compact) return ACCOUNTS[key];
  return null;
}

// One-tap demo sign-in so any of the three members can be reached without typing the exact
// email (which is why login kept defaulting to whoever was active — usually Daniel).
const DEMO = [
  { id: "daniel", name: "Daniel Ferreira", tier: "Gold", hub: "Porto · OPO", email: "anant.direct2links+daniel@gmail.com" },
  { id: "sofia", name: "Sofia Marques", tier: "Silver", hub: "Lisbon · LIS", email: "anant.direct2links+sofia@gmail.com" },
  { id: "lars", name: "Lars Andersen", tier: "Platinum", hub: "Frankfurt · FRA", email: "anant.direct2links+lars@gmail.com" },
];

export function LoginModal({ profile, onClose, onLogin }) {
  // Start blank. Do NOT prefill from the active persona — prefilling (and a prior
  // effect that re-synced the field to profile.user.email) was overwriting the typed
  // email with the currently-active member, so login kept defaulting to that member.
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("demo");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // Resolve the entered identity → persona, then log in (parent switches the live record).
  // If it doesn't match a known account, surface an error instead of falling through to
  // onLogin(null) — which previously logged the user in as whoever was already active.
  const submit = async (e) => {
    e?.preventDefault?.(); if (busy) return;
    const id = resolvePersona(email);
    if (!id) { setErr("We couldn't match that email or member number to an account. Use a demo account below, or enter the member's email."); return; }
    setErr(""); setBusy(true);
    try { await onLogin(id); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[380px] bg-surface rounded-2xl shadow-pop border border-line p-6 v2-in">
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg text-ink-faint hover:bg-surface-mute" aria-label="Close">✕</button>
        <TapLogo />
        <h2 className="text-[20px] font-bold mt-4">Log in to your account</h2>
        <p className="text-[12px] text-ink-muted mt-1">Welcome back — pick up your trips, Miles & Go and saved preferences.</p>
        <form className="mt-5 space-y-3" onSubmit={submit}>
          <label className="block">
            <span className="block text-[10px] font-bold tracking-wide uppercase text-ink-slate mb-1">Email or member number</span>
            <input value={email} onChange={e => { setEmail(e.target.value); if (err) setErr(""); }} autoFocus
              placeholder="daniel@flytap.demo, a name, or member no."
              className="w-full bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] focus:border-tap-green outline-none" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-bold tracking-wide uppercase text-ink-slate mb-1">Password</span>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)}
              className="w-full bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] focus:border-tap-green outline-none" />
          </label>
          <div className="flex items-center justify-between text-[12px]">
            <label className="flex items-center gap-1.5 text-ink-muted"><input type="checkbox" defaultChecked className="accent-[#46a41a]" /> Keep me signed in</label>
            <a className="text-tap-greenDeep font-semibold">Forgot password?</a>
          </div>
          {err && <div className="rounded-lg bg-tap-red/10 text-tap-red text-[12px] font-medium px-3 py-2">{err}</div>}
          <Btn size="lg" className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : <>Log in <Icon name="arrow" size={14} /></>}</Btn>
        </form>
        <div className="mt-5 pt-4 border-t border-line">
          <div className="text-[10px] font-bold tracking-wide uppercase text-ink-slate mb-2">Demo accounts · one-tap sign-in</div>
          <div className="space-y-1.5">
            {DEMO.map(d => (
              <button key={d.id} disabled={busy} onClick={() => { setEmail(d.email); onLogin(d.id); }}
                className="w-full flex items-center justify-between rounded-xl border border-line-strong px-3 py-2.5 text-left hover:border-tap-green disabled:opacity-50 transition-colors">
                <span><span className="text-[13px] font-semibold">{d.name}</span><span className="block text-[11px] text-ink-faint">{d.hub}</span></span>
                <TierBadge tier={d.tier} />
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 text-[11px] text-ink-faint text-center">Demo environment · any password works — sign in as any member above.</div>
      </div>
    </div>
  );
}
