// FlyTAP v2 — entry. Hash router, shared data load, shell (TopNav + Footer),
// and client-side auth: the home route renders the logged-out Homepage until the
// user logs in via the top-right dialog, then re-renders as the personalized Home.
import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./lib.js";
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
  const [loggedIn, setLoggedIn] = useState(false);
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

  const loadShared = useCallback(async () => {
    setShared(s => ({ ...s, loading: true }));
    try {
      const [profile, destinations, airports, journey, suggested] = await Promise.all([
        api.get("/profile").catch(() => null),
        api.get("/destinations").catch(() => []),
        api.get("/airports").catch(() => []),
        api.get("/journey").catch(() => null),
        api.get("/routes/suggested").catch(() => null),
      ]);
      setShared({ profile, destinations, airports, journey, suggested, loading: false });
    } catch { setShared(s => ({ ...s, loading: false })); }
  }, []);
  useEffect(() => { loadShared(); }, [loadShared]);

  // Log in as the persona matching the entered email (Daniel/Sofia/Lars). Switching the
  // persona re-seeds the live record, so we reload the shared profile/destinations/journey
  // afterwards and the home screen renders the correct member.
  const handleLogin = useCallback(async (personaId) => {
    if (personaId) { try { await api.post("/persona", { persona: personaId }); } catch {} }
    await loadShared();
    setLoggedIn(true); setShowLogin(false); go("home");
  }, [loadShared, go]);

  let Screen, entry = ROUTES[route] || ROUTES.home;
  if (route === "home") Screen = loggedIn ? Home : Homepage;
  else Screen = entry.comp;

  return (
    <div className="min-h-screen flex flex-col bg-surface-soft">
      <TopNav route={route} go={go} profile={shared.profile} loggedIn={loggedIn}
        onLogin={() => setShowLogin(true)} onLogout={() => { setLoggedIn(false); go("home"); }} />
      <main className="flex-1">
        {Screen
          ? <Screen shared={shared} params={params} go={go} />
          : <Placeholder title={entry.title} phase={entry.phase} plan={entry.plan} reuses={entry.reuses} go={go} />}
      </main>
      <Footer />
      {showLogin && <LoginModal profile={shared.profile} onClose={() => setShowLogin(false)}
        onLogin={handleLogin} />}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
