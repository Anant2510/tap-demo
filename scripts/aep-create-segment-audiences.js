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

  // Idempotency: map existing definition names → id so re-runs don't duplicate.
  const existing = {};
  try {
    const r = await fetch(`${ENDPOINT}?limit=500`, { headers: H });
    const j = await r.json().catch(() => ({}));
    const list = j.segments || j.definitions || j.children || [];
    for (const d of list) if (d && d.name) existing[d.name] = d.id || d.segmentId;
  } catch (e) { console.warn("! could not list existing definitions:", e.message); }

  const map = {};      // audienceId → clean segment name (for ADOBE_AUDIENCE_NAMES)
  let firstError = null;
  const targets = ONLY ? names.filter((n) => n === ONLY) : names;
  if (ONLY && !targets.length) { console.error(`! --only "${ONLY}" matched no segment name. Valid names listed above.`); return; }
  for (const name of targets) {
    const aepName = PREFIX + name;
    if (existing[aepName]) {
      if (RECREATE) {
        const dr = await fetch(`${ENDPOINT}/${existing[aepName]}`, { method: "DELETE", headers: H });
        if (!dr.ok && dr.status !== 404) { console.error(`✗ delete FAIL ${name} -> HTTP ${dr.status} ${(await dr.text()).slice(0, 200)}`); continue; }
        console.log(`- deleted old  ${name}  (${existing[aepName]})`);
        delete existing[aepName];
      } else { console.log(`= exists  ${name}  ->  ${existing[aepName]}`); map[existing[aepName]] = name; continue; }
    }
    const r = await fetch(ENDPOINT, { method: "POST", headers: H, body: JSON.stringify(definitionBody(name)) });
    const txt = await r.text();
    if (!r.ok) {
      console.error(`✗ FAIL   ${name}  ->  HTTP ${r.status}  ${txt.slice(0, 280)}`);
      // If the very first creation fails on validation/PQL, stop so we fix the template once
      // instead of emitting the same error N times.
      if (!firstError && (r.status === 400 || r.status === 403)) {
        firstError = r.status;
        console.error(`\nStopping after first ${r.status}. If 400: the PQL form likely needs adjusting for your schema`);
        console.error(`(tried:  ${pql(name)} ). If 403: the IMS client lacks the segmentation scope.`);
        break;
      }
      continue;
    }
    let j = {}; try { j = JSON.parse(txt); } catch {}
    const id = j.id || j.segmentId;
    console.log(`+ created ${name}  ->  ${id}`);
    if (id) map[id] = name;
  }

  console.log("\n=== add this single line to .env, then restart node ===");
  console.log("ADOBE_AUDIENCE_NAMES=" + JSON.stringify(map));
  console.log(`\n(${Object.keys(map).length} audiences mapped. Streaming evaluation — profiles qualify within minutes.)`);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
