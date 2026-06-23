// FlyTAP v2 — shell: top navigation + footer + page layout.
import React, { useState } from "react";
import { Avatar, Btn, Icon, TierBadge, cx } from "./ui.jsx";

export const TapLogo = ({ onDark = false }) => (
  <span className="text-[22px] font-black tracking-tight select-none">
    <span style={{ color: "var(--tap-red)" }}>T</span>
    <span style={{ color: onDark ? "#fff" : "var(--ink)" }}>A</span>
    <span style={{ color: "var(--tap-green)" }}>P</span>
    <span className={cx("ml-2 text-[10px] font-semibold tracking-[0.2em]", onDark ? "text-white/60" : "text-ink-faint")}>AIR PORTUGAL</span>
  </span>
);

const NAV = [
  { key: "home", label: "Book" },
  { key: "stopover", label: "Portugal Stopover" },
  { key: "extras", label: "Trip Extras" },
  { key: "miles", label: "TAP Miles & Go" },
  { key: "ai", label: "TAP AI" },
];

export function TopNav({ route, go, profile, loggedIn, onLogin, onLogout }) {
  const user = profile?.user;
  const [menu, setMenu] = useState(false);
  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-page px-6 h-16 flex items-center gap-6">
        <button onClick={() => go("home")} className="shrink-0"><TapLogo /></button>
        <nav className="hidden lg:flex items-center gap-1 ml-2">
          {NAV.map(n => (
            <button key={n.key} onClick={() => go(n.key)}
              className={cx("px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                route === n.key ? "text-ink bg-surface-mute" : "text-ink-muted hover:text-ink hover:bg-surface-mute")}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => go("results")} className="p-2 rounded-lg text-ink-muted hover:bg-surface-mute" title="Search"><Icon name="search" /></button>
          <button className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-ink-muted hover:bg-surface-mute">PT · EUR</button>
          <button onClick={() => go("wishlist")} className="p-2 rounded-lg text-ink-muted hover:bg-surface-mute" title="Wishlist"><Icon name="heart" /></button>
          <button onClick={() => go("basket")} className="p-2 rounded-lg text-ink-muted hover:bg-surface-mute" title="My Trip Cart"><Icon name="cart" /></button>
          <button onClick={() => go("console")} className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold text-ink-muted hover:bg-surface-mute border border-line" title="Demo-only: live backend view"><Icon name="db" size={14} /> Demo</button>
          {loggedIn && user
            ? <div className="relative">
                <button onClick={() => setMenu(m => !m)} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-surface-mute">
                  <Avatar initials={((user.first_name || "D")[0] + (user.full_name || "").split(" ")[1]?.[0] || "")} />
                  <span className="hidden sm:block text-[13px] font-semibold">{user.first_name}</span>
                  <TierBadge tier={user.tier} />
                  <span className="text-ink-faint text-[10px]">▾</span>
                </button>
                {menu && (
                  <div className="absolute right-0 mt-2 w-44 bg-surface rounded-xl border border-line shadow-pop py-1 text-[13px]">
                    <button onClick={() => { setMenu(false); go("miles"); }} className="w-full text-left px-3 py-2 hover:bg-surface-mute">Miles & Go</button>
                    <button onClick={() => { setMenu(false); go("basket"); }} className="w-full text-left px-3 py-2 hover:bg-surface-mute">My trips</button>
                    <div className="h-px bg-line my-1" />
                    <button onClick={() => { setMenu(false); onLogout?.(); }} className="w-full text-left px-3 py-2 hover:bg-surface-mute text-ink-muted">Log out</button>
                  </div>
                )}
              </div>
            : <Btn size="sm" variant="dark" onClick={() => onLogin?.()}>Login or Sign up</Btn>}
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  const cols = [
    ["Flights & Stopover", ["Book a flight", "Portugal Stopover", "Multi-city", "Flight status", "Manage booking", "Online check-in"]],
    ["Trip Extras", ["Hotels", "Cars & Transfers", "Experiences", "Travel insurance", "Airport parking", "Pet travel"]],
    ["voa.miles", ["Join the program", "Use my miles", "Status & tiers", "Star Alliance partners", "Club voa.miles", "Credit cards"]],
    ["Help", ["Customer support", "Delays & cancellations", "Refunds", "Special assistance", "Baggage", "Travel documents"]],
  ];
  return (
    <footer className="mt-16 bg-surface-dark text-white">
      <div className="mx-auto max-w-page px-6 py-12 grid lg:grid-cols-[1.4fr_1fr_1fr_1fr_1fr] gap-8">
        <div>
          <TapLogo onDark />
          <p className="text-[12px] text-white/55 mt-3 max-w-[230px]">An original premium airline concept connecting the Americas to Europe through Portugal.</p>
          <div className="flex gap-2 mt-4">{["IG", "f", "in", "X"].map(s => <span key={s} className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-[11px] font-bold">{s}</span>)}</div>
          <div className="mt-6"><div className="text-[10px] font-bold uppercase tracking-wide text-white/40">Newsletter</div><div className="text-[12px] text-white/70 mt-1 mb-2">Get fare alerts and Stopover offers.</div>
            <div className="flex gap-2"><input placeholder="you@email.com" className="flex-1 bg-white/10 border border-white/15 rounded-lg px-3 py-2 text-[12px] placeholder:text-white/40 outline-none" /><Btn size="sm" variant="lime">Join</Btn></div></div>
        </div>
        {cols.map(([h, items]) => (
          <div key={h}><div className="text-[12px] font-bold mb-3">{h}</div><ul className="space-y-2">{items.map(i => <li key={i}><a className="text-[12px] text-white/55 hover:text-white">{i}</a></li>)}</ul></div>
        ))}
      </div>
      <div className="border-t border-white/10"><div className="mx-auto max-w-page px-6 py-4 flex flex-wrap items-center justify-between gap-3 text-[11px] text-white/40">
        <span>© 2026 FlyTap · Privacy · Terms · Cookies · Accessibility</span>
        <span>Portugal · Brasil · United States</span>
      </div></div>
    </footer>
  );
}

export const Page = ({ children, wide = false }) =>
  <div className={cx("mx-auto px-6 py-8", wide ? "max-w-page" : "max-w-content")}>{children}</div>;
