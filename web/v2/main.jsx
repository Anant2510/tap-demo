// FlyTAP v2 — entry. Hash router, shared data load, shell (TopNav + Footer),
// and client-side auth: the home route renders the logged-out Homepage until the
// user logs in via the top-right dialog, then re-renders as the personalized Home.
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { api, setSessionId, authReady } from "./lib.js";
import { resetTrip, restoreFromSaved, loadTrip, saveTrip } from "./trip.js";
import { TopNav, Footer } from "./shell.jsx";
import { ROUTES, Placeholder, Homepage, Home } from "./screens.jsx";
import { LoginModal } from "./auth.jsx";

function parseHash() {
  const h = (window.location.hash || "#/home").replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  return { route: path || "home", params };
}

function App() {
  const [{ route, params }, setLoc] = useState(parseHash());
  const [shared, setShared] = useState({ profile: null, destinations: [], airports: [], journey: null, suggested: null, loading: true });
  const [loggedIn, setLoggedIn] = useState(() => { try { return localStorage.getItem("flytap_auth") === "1"; } catch { return false; } });
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const on = () => { setLoc(parseHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r, p) => {
    const qs = p ? "?" + new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v != null && v !== ""))).toString() : "";
    window.location.hash = `#/${r}${qs}`;
  }, []);

  const loadShared = useCallback(async (skipBasketRestore = false) => {
    setShared(s => ({ ...s, loading: true }));
    try {
      const [profile, destinations, airports, journey, suggested, basket] = await Promise.all([
        api.get("/profile").catch(() => null),
        api.get("/destinations").catch(() => []),
        api.get("/airports").catch(() => []),
        api.get("/journey").catch(() => null),
        api.get("/routes/suggested").catch(() => null),
        api.get("/basket").catch(() => null),
      ]);
      // Resume an abandoned, still-open basket so a returning member sees their saved
      // add-ons (and the nav count) without re-doing anything. Skipped on a refresh that
      // already has a richer in-progress trip in localStorage (#4) — that one wins.
      if (!skipBasketRestore && basket?.status === "open") restoreFromSaved(basket);
      setShared({ profile, destinations, airports, journey, suggested, basket, loading: false });
    } catch { setShared(s => ({ ...s, loading: false })); }
  }, []);

  // Boot (#4 session persistence): re-apply the saved persona to the server so the
  // member's identity survives a hard refresh, hydrate shared data, then restore any
  // in-progress trip (cart/flights/passengers) from localStorage. Local state takes
  // precedence over the server basket so nothing the user entered is lost on refresh.
  useEffect(() => {
    (async () => {
      let hasLocal = false;
      try {
        hasLocal = !!localStorage.getItem("flytap_trip");
        // Server sessions are in-memory and clear on restart, so a stored sid is unreliable.
        // RE-LOGIN from the saved credential (persona or registrant email) to mint a fresh
        // binding; setSessionId on success, clear it on failure (so we never act stale).
        const authed = localStorage.getItem("flytap_auth") === "1";
        let body = null;
        const saved = localStorage.getItem("flytap_login");
        if (saved) { try { body = JSON.parse(saved); } catch { body = null; } }
        if (!body) { const p = localStorage.getItem("flytap_persona"); if (p) body = { persona: p }; }   // back-compat
        if (authed && body) {
          try { const r = await api.post("/auth/login", body, { ungated: true }); setSessionId(r && r.ok && r.sessionId ? r.sessionId : null); }
          catch { setSessionId(null); }
        } else { setSessionId(null); }
      } catch {}
      finally { authReady(); }   // open the boot gate on every path — parked api.* now fire with the resolved session
      await loadShared(hasLocal);
      loadTrip();
    })();
  }, [loadShared]);

  // Persist the in-progress trip on tab close/refresh so a reload restores it (#4).
  useEffect(() => {
    const on = () => saveTrip();
    window.addEventListener("beforeunload", on);
    return () => window.removeEventListener("beforeunload", on);
  }, []);

  // Always land at the top of a new page, and after login the personalized home
  // commits before this runs, so the user starts at the hero — not mid-page (#5).
  useEffect(() => { requestAnimationFrame(() => window.scrollTo({ top: 0 })); }, [route, loggedIn]);

  // Log in via the canonical /api/auth/login — by persona (the 5 known) or by email
  // (registrants 6–15). Capture the returned sessionId and bind it BEFORE loadShared so
  // every subsequent request resolves to THIS user. Throws on failure (the modal shows it).
  const handleLogin = useCallback(async ({ persona, email } = {}) => {
    resetTrip();   // new member context starts with an empty basket
    const body = persona ? { persona } : { email };
    const r = await api.post("/auth/login", body).catch(() => null);
    if (!r || !r.ok || !r.sessionId) throw new Error((r && r.error) || "Couldn't log in — check the email or member.");
    setSessionId(r.sessionId);
    await loadShared();
    try { localStorage.setItem("flytap_auth", "1"); localStorage.setItem("flytap_login", JSON.stringify(body)); localStorage.removeItem("flytap_persona"); } catch {}
    setLoggedIn(true); setShowLogin(false); go("home"); window.scrollTo({ top: 0 });
  }, [loadShared, go]);

  // Register a brand-new visitor (anonymous slot 6–15) → bind their fresh session, then
  // they accrue their own history. Re-login on boot is by email (their row persists).
  const handleRegister = useCallback(async ({ first_name, email, phone, home_airport }) => {
    resetTrip();
    const r = await api.post("/auth/register", { first_name, email, phone, home_airport }).catch(() => null);
    if (!r || !r.ok || !r.sessionId) throw new Error((r && r.error) || "Couldn't register — try a different email.");
    setSessionId(r.sessionId);
    await loadShared();
    try { localStorage.setItem("flytap_auth", "1"); localStorage.setItem("flytap_login", JSON.stringify({ email })); localStorage.removeItem("flytap_persona"); } catch {}
    setLoggedIn(true); setShowLogin(false); go("home"); window.scrollTo({ top: 0 });
  }, [loadShared, go]);

  let Screen, entry = ROUTES[route] || ROUTES.home;
  if (route === "home") Screen = loggedIn ? Home : Homepage;
  else Screen = entry.comp;

  return (
    <div className="min-h-screen flex flex-col bg-surface-soft">
      <TopNav route={route} go={go} profile={shared.profile} loggedIn={loggedIn}
        onLogin={() => setShowLogin(true)} onLogout={() => { try { api.post("/auth/logout", {}); } catch {} setSessionId(null); try { localStorage.removeItem("flytap_auth"); localStorage.removeItem("flytap_persona"); localStorage.removeItem("flytap_login"); } catch {} resetTrip(); setLoggedIn(false); go("home"); }} />
      <main className="flex-1">
        {Screen
          ? <Screen shared={shared} params={params} go={go} />
          : <Placeholder title={entry.title} phase={entry.phase} plan={entry.plan} reuses={entry.reuses} go={go} />}
      </main>
      <Footer />
      {showLogin && <LoginModal profile={shared.profile} onClose={() => setShowLogin(false)}
        onLogin={handleLogin} onRegister={handleRegister} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
