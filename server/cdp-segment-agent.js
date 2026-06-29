"use strict";
/* ─────────────────────────────────────────────────────────────────────────────
   FlyTAP — RT-CDP Segment Agent (self-extending sync)
   ----------------------------------------------------------------------------
   Keeps Adobe RT-CDP in lockstep with the LOCAL segment engine, autonomously:

     1. Desired state = the distinct segment names the local engine (cdp.audiences)
        currently produces across all personas.
     2. For each name with no matching AEP audience → create a STREAMING passthrough
        audience (rule: _aeppsemea.<field> = "<name>"). New local segments therefore
        self-register in RT-CDP — "self-extending".
     3. Ingest the personas so their computedSegments attribute is current → the
        streaming engine (re)qualifies them automatically.
     4. The agent LEARNS each audience id→name (because it created/listed them) and
        registers the map with cdp.js, so the read-back labels chips correctly with
        NO manual ADOBE_AUDIENCE_NAMES upkeep.

   SAFETY (this writes to a shared sandbox, so it is deliberately conservative):
     • OFF by default. Set CDP_AGENT_ENABLED=1 to allow writes / the background loop.
     • On-demand reconcile() is the primary interface; the loop is opt-in + slow.
     • Idempotent: warms a cache of existing definitions before creating anything.
     • Capped: never creates more than CDP_AGENT_MAX_AUDIENCES in one pass.
     • Additive only: never deletes audiences (a dropped segment just sees profiles
       exit it via streaming; pre-existing sandbox audiences are left untouched).
     • Non-blocking: every AEP call is guarded; failures are reported, never thrown
       into a user request.
   ───────────────────────────────────────────────────────────────────────────── */
const cdp = require("./cdp");
const cdpIngest = require("./cdp-ingest");
const { PERSONAS } = require("./db");

const TENANT = "_aeppsemea";                       // matches personaToXDM
const ENDPOINT = "https://platform.adobe.io/data/core/ups/segment/definitions";

function cfg() {
  const c = cdp.rawConfig();
  return {
    raw: c,
    configured: c.configured,
    imsOrg: c.imsOrg, clientId: c.clientId, sandbox: c.sandbox,
    enabled: /^(1|true|yes)$/i.test(process.env.CDP_AGENT_ENABLED || ""),
    field: c.localSegmentsField || process.env.ADOBE_LOCAL_SEGMENTS_FIELD || "computedSegments",
    prefix: process.env.AEP_AUDIENCE_PREFIX || "TAP – ",
    maxAudiences: Math.max(1, Number(process.env.CDP_AGENT_MAX_AUDIENCES || 50)),
    intervalMs: Math.max(60000, Number(process.env.CDP_AGENT_INTERVAL_MS || 600000)),
  };
}

// in-memory state the agent maintains across reconciles
let nameToId = {};      // prefixed AEP name → audience id  (idempotency cache)
const learned = {};     // audience id → CLEAN segment name (for the read-back map)
let running = false;    // single-flight guard

const pql = (name, c) => `${TENANT}.${c.field}[*] = "${String(name).replace(/"/g, '\\"')}"`;

// Distinct segment names from the SAME engine the app uses — the desired audience set.
function desiredNames() {
  const set = new Set();
  for (const p of Object.values(PERSONAS)) {
    try { for (const a of (cdp.audiences(p.user) || [])) if (a && a.name) set.add(String(a.name)); } catch { /* skip */ }
  }
  return [...set].filter((n) => n && n.length <= 100).sort();
}

async function headers(c) {
  const token = await cdp.imsToken(c.raw);
  return {
    Authorization: `Bearer ${token}`, "x-api-key": c.clientId,
    "x-gw-ims-org-id": c.imsOrg, "x-sandbox-name": c.sandbox,
    "Content-Type": "application/json", Accept: "application/json",
  };
}

// Warm the cache from existing definitions so we never double-create, and so we learn
// the ids of audiences created on a prior run (or by the CLI script).
async function warmCache(c, H) {
  const r = await fetch(`${ENDPOINT}?limit=500`, { headers: H });
  const j = await r.json().catch(() => ({}));
  const list = j.segments || j.definitions || j.children || [];
  for (const d of list) {
    if (!d || !d.name) continue;
    const id = d.id || d.segmentId;
    nameToId[d.name] = id;
    if (d.name.startsWith(c.prefix) && id) learned[id] = d.name.slice(c.prefix.length);  // strip prefix → clean name
  }
}

function definitionBody(name, c) {
  return {
    name: c.prefix + name,
    description: `TAP local-engine segment mirrored from ${TENANT}.${c.field}`,
    expression: { type: "PQL", format: "pql/text", value: pql(name, c) },
    schema: { name: "_xdm.context.profile" },
    evaluationInfo: { batch: { enabled: false }, continuous: { enabled: true }, synchronous: { enabled: false } },
  };
}

// Ensure each name has a streaming audience. Returns { created:[], existing:[], failed:[] }.
async function ensureAudiences(names, c, H) {
  const out = { created: [], existing: [], failed: [] };
  let budget = c.maxAudiences;
  for (const name of names) {
    const aepName = c.prefix + name;
    if (nameToId[aepName]) { out.existing.push(name); learned[nameToId[aepName]] = name; continue; }
    if (budget <= 0) { out.failed.push({ name, reason: "max-audiences cap reached" }); continue; }
    try {
      const r = await fetch(ENDPOINT, { method: "POST", headers: H, body: JSON.stringify(definitionBody(name, c)) });
      const txt = await r.text();
      if (!r.ok) { out.failed.push({ name, reason: `HTTP ${r.status}`, detail: txt.slice(0, 200) }); continue; }
      let j = {}; try { j = JSON.parse(txt); } catch {}
      const id = j.id || j.segmentId;
      if (id) { nameToId[aepName] = id; learned[id] = name; out.created.push({ name, id }); budget--; }
      else out.failed.push({ name, reason: "no id in response" });
    } catch (e) { out.failed.push({ name, reason: String(e && e.message || e) }); }
  }
  return out;
}

// One reconcile pass. dryRun → compute desired set + PQL, no network.
async function reconcile(opts = {}) {
  const c = cfg();
  const names = desiredNames();
  if (opts.dryRun) return { dryRun: true, count: names.length, names, pql: names.map((n) => pql(n, c)), enabled: c.enabled };
  if (!c.enabled) return { skipped: "agent disabled (set CDP_AGENT_ENABLED=1)", names };
  if (!c.configured) return { error: "Adobe not configured (.env: ADOBE_CDP_ENABLED + IMS org + client id/secret)" };
  if (running) return { skipped: "reconcile already in progress" };
  running = true;
  try {
    const H = await headers(c);
    await warmCache(c, H);
    const audiences = await ensureAudiences(names.slice(0, c.maxAudiences), c, H);
    cdp.registerAudienceNames(learned);                 // teach the read-back the id→name map
    let ingest = null;
    try { ingest = await cdpIngest.ingest(Object.keys(PERSONAS), {}); }
    catch (e) { ingest = { error: String(e && e.message || e) }; }
    return { ok: true, desired: names.length, audiences, learnedCount: Object.keys(learned).length, ingest };
  } catch (e) {
    return { error: String(e && e.message || e) };
  } finally { running = false; }
}

function audienceNameMap() { return { ...learned }; }

// Background loop — opt-in. First pass shortly after boot, then every intervalMs.
function start() {
  const c = cfg();
  if (!c.enabled) { console.log("   Segment agent: OFF (set CDP_AGENT_ENABLED=1 to enable self-extending RT-CDP sync)"); return; }
  console.log(`   Segment agent: ON — reconciling RT-CDP audiences every ${Math.round(c.intervalMs / 60000)} min (cap ${c.maxAudiences})`);
  setTimeout(() => {
    reconcile().then((r) => console.log("   Segment agent first pass:", JSON.stringify(r).slice(0, 300))).catch(() => {});
    setInterval(() => { reconcile().catch(() => {}); }, c.intervalMs);
  }, 12000);
}

module.exports = { reconcile, ensureAudiences, desiredNames, audienceNameMap, start, cfg };
