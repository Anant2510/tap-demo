// FlyTAP — per-request frontend attribution (v1 vs v2), shared across modules.
// A single AsyncLocalStorage instance is created here so server.js (which sets it from
// the X-App header) and email.js (which reads it to tag the emails table) use the SAME
// context. Default "v1" preserves the legacy app's behaviour when no header is present.
const { AsyncLocalStorage } = require("node:async_hooks");
const appCtx = new AsyncLocalStorage();
const currentApp = () => { const s = appCtx.getStore(); return (s && s.app) || "v1"; };
module.exports = { appCtx, currentApp };
