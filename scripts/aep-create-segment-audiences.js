#!/usr/bin/env node
"use strict";
/* ─────────────────────────────────────────────────────────────────────────────
   Create one STREAMING passthrough audience per distinct local-engine segment, so
   Adobe RT-CDP mirrors the membership the app already writes to
   _aeppsemea.computedSegments. Idempotent (skips audiences that already exist by
   name). Prints the resulting id→name map ready to paste into .env as
   ADOBE_AUDIENCE_NAMES, which the read-back uses to label the app chips.

   Run ON THE VM, from the repo root (reuses .env + the same IMS client as ingest):
     node scripts/aep-create-segment-audiences.js               # create missing only
     node scripts/aep-create-segment-audiences.js --dry         # preview payload, no network
     node scripts/aep-create-segment-audiences.js --recreate --only "Miles-Rich (> 30k)"
                                                                 # delete + recreate ONE (test the PQL)
     node scripts/aep-create-segment-audiences.js --recreate    # delete + recreate ALL with fixed PQL

   Rule per audience (existential array match): _aeppsemea.computedSegments[*] = "<name>"
   ───────────────────────────────────────────────────────────────────────────── */
require("dotenv").config();
const cdp = require("../server/cdp");
const { PERSONAS } = require("../server/db");

const TENANT = "_aeppsemea";                                   // matches personaToXDM
const FIELD = process.env.ADOBE_LOCAL_SEGMENTS_FIELD || "computedSegments";
const PREFIX = process.env.AEP_AUDIENCE_PREFIX || "TAP – ";    // namespaced in the shared sandbox
const ENDPOINT = "https://platform.adobe.io/data/core/ups/segment/definitions";
const DRY = process.argv.includes("--dry");
// --recreate: delete any existing definition with the same name, then create it fresh with the
// corrected PQL (in-place PATCH of segment expressions is unreliable; delete+create is clean).
// --only "<name>": limit to a single segment so you can validate the rule before touching all 16.
const RECREATE = process.argv.includes("--recreate");
const onlyIdx = process.argv.indexOf("--only");
const ONLY = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

// PQL: computedSegments is a String[]. A scalar `=` is rejected by the segmentation engine
// (equals expects STRING, not STRING[]). The `[*]` projects each element, so the comparison
// becomes STRING = STRING per element → matches profiles whose array CONTAINS <name>.
const pql = (name) => `${TENANT}.${FIELD}[*] = "${String(name).replace(/"/g, '\\"')}"`;

const LIST = process.argv.includes("--list");                 // just print what's in the sandbox
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
// Normalize audience names for matching: drop the "TAP – " prefix, unify dash variants and
// whitespace, lowercase. Robust to en-dash vs hyphen drift between .env and what AEP stored
// (which silently broke the exact-string match and caused "already exists" on recreate).
const normName = (s) => String(s).replace(/^\s*TAP\s*[–—-]\s*/i, "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim().toLowerCase();

// Distinct segment names straight from the SAME engine the app uses (cdp.audiences),
// so the audience set always tracks whatever the local logic produces.
function distinctNames() {
  const set = new Set();
  for (const p of Object.values(PERSONAS)) {
    try { for (const a of (cdp.audiences(p.user) || [])) if (a && a.name) set.add(a.name); } catch { /* skip */ }
  }
  return [...set].sort();
}

function definitionBody(name) {
  return {
    name: PREFIX + name,
    description: `TAP local-engine segment mirrored from ${TENANT}.${FIELD}`,
    expression: { type: "PQL", format: "pql/text", value: pql(name) },
    schema: { name: "_xdm.context.profile" },
    evaluationInfo: { batch: { enabled: false }, continuous: { enabled: true }, synchronous: { enabled: false } },
  };
}

async function main() {
  const names = distinctNames();
  console.log(`Distinct local-engine segments: ${names.length}`);
  names.forEach((n) => console.log(`  • ${n}`));

  if (DRY) {
    console.log("\n--dry: example payload for the first name —");
    console.log(JSON.stringify(definitionBody(names[0]), null, 2));
    console.log("\nNo network calls made.");
    return;
  }

  const c = cdp.rawConfig();
  if (!c.configured) throw new Error("Adobe not configured in .env (ADOBE_CDP_ENABLED + IMS org + client id/secret).");
  const token = await cdp.imsToken(c);
  const H = {
    Authorization: `Bearer ${token}`, "x-api-key": c.clientId,
    "x-gw-ims-org-id": c.imsOrg, "x-sandbox-name": c.sandbox,
    "Content-Type": "application/json", Accept: "application/json",
  };

  // List ALL existing definitions, paginating, keyed by NORMALIZED name → {id, name}.
  // (The previous exact-string match silently missed everything, so recreate never deleted
  // and the create then collided with "already exists".)
  const existing = {};
  let listed = 0, diag = "";
  try {
    let url = `${ENDPOINT}?limit=100`;
    for (let page = 0; page < 15 && url; page++) {
      const r = await fetch(url, { headers: H });
      const txt = await r.text();
      if (!r.ok) { diag = `list HTTP ${r.status}: ${txt.slice(0, 160)}`; break; }
      let j = {}; try { j = JSON.parse(txt); } catch {}
      const arr = j.segments || j.definitions || j.children || j.audiences || (Array.isArray(j) ? j : []);
      if (page === 0 && !arr.length) diag = `0 items; top-level keys = ${Object.keys(j).join(",") || "(none)"}`;
      for (const d of arr) { const nm = d && d.name, id = d && (d.id || d.segmentId); if (nm && id) { existing[normName(nm)] = { id, name: nm }; listed++; } }
      const next = (j._links && j._links.next && (j._links.next.href || j._links.next)) || (j.page && j.page.next) || null;
      url = next ? (String(next).startsWith("http") ? next : `https://platform.adobe.io${next}`) : null;
    }
  } catch (e) { diag = e.message; }
  console.log(`Existing audiences in sandbox: ${listed}${diag ? `  (${diag})` : ""}`);

  if (LIST) {
    Object.values(existing).sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => console.log(`  ${e.id}  ${e.name}`));
    console.log("\n--list: no changes made.");
    return;
  }

  const map = {};      // audienceId → clean segment name (for ADOBE_AUDIENCE_NAMES)
  const targets = ONLY ? names.filter((n) => n === ONLY) : names;
  if (ONLY && !targets.length) { console.error(`! --only "${ONLY}" matched no segment name. Valid names listed above.`); return; }

  for (const name of targets) {
    const ex = existing[normName(name)];
    if (ex && !RECREATE) { console.log(`= exists  ${name}  ->  ${ex.id}`); map[ex.id] = name; continue; }
    if (ex && RECREATE) {
      const dr = await fetch(`${ENDPOINT}/${ex.id}`, { method: "DELETE", headers: H });
      if (!dr.ok && dr.status !== 404) { console.error(`✗ delete FAIL ${name} -> HTTP ${dr.status} ${(await dr.text()).slice(0, 200)}`); continue; }
      // Deletion is async — wait until the definition actually 404s before reusing the name.
      let gone = false;
      for (let i = 0; i < 12; i++) { const g = await fetch(`${ENDPOINT}/${ex.id}`, { headers: H }); if (g.status === 404) { gone = true; break; } await sleep(1500); }
      console.log(`- deleted old  ${name}  (${ex.id})${gone ? "" : "  [still settling]"}`);
      delete existing[normName(name)];
    }
    // Create — retry a few times if the name is briefly still reserved after delete.
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const r = await fetch(ENDPOINT, { method: "POST", headers: H, body: JSON.stringify(definitionBody(name)) });
      const txt = await r.text();
      if (r.ok) { let j = {}; try { j = JSON.parse(txt); } catch {} const id = j.id || j.segmentId; console.log(`+ created ${name}  ->  ${id}`); if (id) map[id] = name; done = true; break; }
      if (r.status === 400 && /already exists/i.test(txt) && attempt < 3) { console.log(`  …name still reserved, retrying in 4s`); await sleep(4000); continue; }
      console.error(`✗ FAIL   ${name}  ->  HTTP ${r.status}  ${txt.slice(0, 280)}`);
      if (r.status === 400 || r.status === 403) console.error(`(tried PQL:  ${pql(name)} ). 400 = PQL/schema · 403 = missing segmentation scope · "already exists" = delete still settling.`);
      break;
    }
  }

  console.log("\n=== add this single line to .env, then restart node ===");
  console.log("ADOBE_AUDIENCE_NAMES=" + JSON.stringify(map));
  console.log(`\n(${Object.keys(map).length} audiences mapped. Streaming evaluation — profiles qualify within minutes.)`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
