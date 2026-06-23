// FlyTAP v2 — login. Login is reached from the home screen's top-right button:
// it opens this dialog (username + password). On submit the user is logged in and
// the SAME home route re-renders as the personalized view (no separate login page).
// Credentials are cosmetic in the demo (the active persona is user_id=1); any
// password works and the field is prefilled for a one-click demo.
import React, { useState, useEffect } from "react";
import { Btn, Icon } from "./ui.jsx";
import { TapLogo } from "./shell.jsx";

// Each demo persona has a distinct identity. Match the entered email / member number to a
// persona so logging in as Daniel actually switches the live record to Daniel. (Previously
// login ignored the field and signed you in as whatever persona was last active — which is
// why entering Daniel's email still showed Lars.)
const ACCOUNTS = {
  "daniel.ferreira@consultmail.pt": "daniel", "pt-884512": "daniel",
  "sofia.marques@familymail.pt": "sofia", "pt-552037": "sofia",
  "lars.andersen@globalconsult.de": "lars", "de-100294": "lars",
};
const resolvePersona = (v) => ACCOUNTS[(v || "").trim().toLowerCase()] || null;

export function LoginModal({ profile, onClose, onLogin }) {
  const u = profile?.user;
  const [email, setEmail] = useState(u?.email || "");
  const [pw, setPw] = useState("demo");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (u?.email) setEmail(u.email); }, [u]);
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // Resolve the entered identity → persona, then log in (parent switches the live record).
  const submit = async (e) => { e?.preventDefault?.(); if (busy) return; setBusy(true); try { await onLogin(resolvePersona(email)); } finally { setBusy(false); } };

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
            <input value={email} onChange={e => setEmail(e.target.value)} autoFocus
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
          <Btn size="lg" className="w-full" type="submit" disabled={busy}>{busy ? "Signing in…" : <>Log in <Icon name="arrow" size={14} /></>}</Btn>
        </form>
        <div className="mt-4 text-[11px] text-ink-faint text-center">Demo environment · any password works — you'll sign in as the active Miles&Go member.</div>
      </div>
    </div>
  );
}
