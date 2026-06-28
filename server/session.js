const crypto = require("node:crypto");
const { db } = require("./db");

// In-memory session→user map. 15-user demo: no external store needed.
// { sessionId: { uid, source } }   source = 'sqlite' | 'adobe' (option b, per-session)
const sessions = new Map();

function newSessionId() { return "s_" + crypto.randomBytes(12).toString("hex"); }

// Bind a session to a user id (called at login / persona-pick / registration).
function bindSession(sessionId, uid, source = "sqlite") {
  sessions.set(sessionId, { uid, source });
}

function getSession(sessionId) {
  return sessionId ? sessions.get(sessionId) || null : null;
}

// Unbind a session (logout). Returns true if a binding was removed.
function unbindSession(sessionId) {
  return sessionId ? sessions.delete(sessionId) : false;
}

// THE resolver. Priority:
//   1. explicit session binding (web/chat)         — X-Session-Id header or body.sessionId
//   2. phone→user (WhatsApp)                        — passed in by the WA layer
//   3. fallback to 1 (PRE-MIGRATION SAFETY DEFAULT) — preserves today's behaviour
function resolveUid(req, opts = {}) {
  const sid = (req && (req.headers["x-session-id"] || (req.body && req.body.sessionId) || (req.query && req.query.sessionId))) || opts.sessionId;
  const s = getSession(sid);
  if (s && s.uid) return s.uid;
  if (opts.phone) { const u = userByPhone(opts.phone); if (u) return u.id; }
  return 1; // default — REMOVE/replace once every caller passes identity (see §5 cutover)
}

function userByPhone(raw) {
  const tail = String(raw || "").replace(/[^0-9]/g, "").slice(-9);
  if (!tail) return null;
  const cmp = "replace(replace(replace(phone,' ',''),'+',''),'-','')";
  return db.prepare(`SELECT * FROM users WHERE ${cmp} LIKE ?`).get("%" + tail) || null;
}

function sessionSource(req, opts = {}) {
  const sid = (req && (req.headers["x-session-id"] || (req.body && req.body.sessionId))) || opts.sessionId;
  const s = getSession(sid);
  return (s && s.source) || require("./db").getDataSource(); // global default if unbound
}

module.exports = { newSessionId, bindSession, getSession, unbindSession, resolveUid, sessionSource, userByPhone, _sessions: sessions };
