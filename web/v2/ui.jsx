// FlyTAP v2 — design-system primitives. Faithful to the approved Figma tokens:
// Inter, white surfaces, dark-navy panels, lime accent, TAP green/red.
import React from "react";

export const cx = (...a) => a.filter(Boolean).join(" ");

/* ---- Buttons ---- */
export function Btn({ variant = "primary", size = "md", className = "", children, ...p }) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
  const sizes = { sm: "text-[12px] px-3 py-1.5", md: "text-[13px] px-4 py-2.5", lg: "text-[14px] px-5 py-3" };
  const variants = {
    primary: "bg-tap-green text-white hover:bg-tap-greenDeep",
    lime: "bg-lime text-ink hover:bg-lime-alt",
    dark: "bg-surface-dark text-white hover:bg-ink-strong",
    outline: "border border-line-strong text-ink hover:bg-surface-mute",
    ghost: "text-ink hover:bg-surface-mute",
    danger: "bg-tap-red text-white hover:opacity-90",
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...p}>{children}</button>;
}

/* ---- Surfaces ---- */
export const Card = ({ className = "", children, ...p }) =>
  <div className={cx("bg-surface rounded-2xl border border-line shadow-card", className)} {...p}>{children}</div>;

export const Pill = ({ tone = "lime", className = "", children }) => {
  const tones = {
    lime: "bg-lime-tint text-tap-greenDark border-lime/40",
    green: "bg-tap-green/10 text-tap-greenDeep border-tap-green/20",
    dark: "bg-surface-dark text-white border-transparent",
    slate: "bg-surface-mute text-ink-slate border-line",
    red: "bg-tap-red/10 text-tap-red border-tap-red/20",
  };
  return <span className={cx("inline-flex items-center gap-1 text-[10px] font-bold tracking-wide uppercase px-2 py-1 rounded-full border", tones[tone], className)}>{children}</span>;
};

export function TierBadge({ tier = "Gold", className = "" }) {
  const map = { Platinum: "from-slate-300 to-slate-500 text-ink", Gold: "from-[#E8C75A] to-[#C9A227] text-ink", Silver: "from-slate-200 to-slate-400 text-ink" };
  return <span className={cx("inline-flex items-center text-[10px] font-extrabold tracking-widest px-2 py-0.5 rounded-full bg-gradient-to-br", map[tier] || map.Gold, className)}>{(tier || "Member").toUpperCase()}</span>;
}

export const Eyebrow = ({ children, className = "" }) =>
  <div className={cx("text-[10px] font-bold tracking-[0.14em] uppercase text-ink-slate", className)}>{children}</div>;

export const Avatar = ({ initials = "D", className = "" }) =>
  <span className={cx("inline-flex items-center justify-center w-8 h-8 rounded-full bg-surface-dark text-white text-[12px] font-bold", className)}>{initials}</span>;

/* ---- Form field ---- */
export function Field({ label, children, className = "" }) {
  return (
    <label className={cx("block", className)}>
      {label && <span className="block text-[10px] font-bold tracking-wide uppercase text-ink-slate mb-1">{label}</span>}
      {children}
    </label>
  );
}
export const Input = ({ className = "", ...p }) =>
  <input className={cx("w-full bg-surface border border-line-strong rounded-xl px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-tap-green outline-none", className)} {...p} />;

/* ---- Icons (inline, currentColor) ---- */
export const Icon = ({ name, size = 16, className = "" }) => {
  const paths = {
    plane: "M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5Z",
    arrow: "M5 12h14M13 6l6 6-6 6",
    search: "M11 19a8 8 0 1 1 5.29-14A8 8 0 0 1 11 19Zm10 2-4.35-4.35",
    spark: "M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
    bag: "M6 7h12l1 14H5L6 7Zm3 0V5a3 3 0 0 1 6 0v2",
    seat: "M5 5v9h9M5 14l-1 5M14 14v5M7 14h10a2 2 0 0 0 2-2V9",
    star: "M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19l1-5.8L3.5 9.2l5.9-.9L12 3Z",
    clock: "M12 7v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z",
    heart: "M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9Z",
    cart: "M3 4h2l2 12h11l2-8H7M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    check: "M5 12l5 5L20 7",
    chevR: "M9 6l6 6-6 6",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name] || paths.check} />
    </svg>
  );
};

export const Divider = ({ className = "" }) => <div className={cx("h-px bg-line", className)} />;
