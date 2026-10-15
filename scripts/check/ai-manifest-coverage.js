#!/usr/bin/env node
"use strict";
/**
 * Gate 9: every module the app exposes is reachable by the assistant, or says in
 * writing that it is not (MILESTONES A13, BACKEND_STRUCTURE §14.4).
 *
 * The assistant's catalogue comes only from `<module>.ai.js` manifests. A module that
 * ships without one is invisible to it, silently: no failing test, no red build. Under
 * A23 a manifest declares reads and routes only, so writing one costs little; leaving
 * it out is the retrofit M10 would otherwise inherit.
 *
 * Covered means one of:
 *   1. a `<module>.ai.js` with content in the module's folder, or
 *   2. `// ai:none <reason>` in the module's controller. The reason is required: the
 *      marker records that somebody decided and why. A bare `// ai:none` fails.
 *
 * A module counts once its controller has content. The repository map creates every
 * module's files empty before the module is built; an empty controller is not yet a
 * module anyone can reach.
 *
 * Usage: node scripts/check/ai-manifest-coverage.js [--list]     exit 0 ok, 1 on a gap
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const MODULES = path.join(ROOT, "src", "modules");
const OPT_OUT = /\/\/\s*ai:none\b[ \t:,-]*(.*)$/m;

const filled = (file) =>
  fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().length > 0;

/**
 * @param {{dir?: string}} [opts]
 * @returns {{wired: string[], optedOut: Array<{module: string, reason: string}>, missing: string[], unexplained: string[]}}
 */
function check({ dir = MODULES } = {}) {
  const out = { wired: [], optedOut: [], missing: [], unexplained: [] };
  if (!fs.existsSync(dir)) return out;
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue;
    const folder = path.join(dir, e.name);
    const files = fs.readdirSync(folder);
    const controllers = files
      .filter((f) => f.endsWith(".controller.js"))
      .map((f) => path.join(folder, f))
      .filter(filled);
    if (controllers.length === 0) continue;
    if (
      files.some((f) => f.endsWith(".ai.js") && filled(path.join(folder, f)))
    ) {
      out.wired.push(e.name);
      continue;
    }
    let opt = null;
    for (const c of controllers) {
      const m = fs.readFileSync(c, "utf8").match(OPT_OUT);
      if (m) {
        opt = (m[1] || "").trim();
        break;
      }
    }
    if (opt === null) out.missing.push(e.name);
    else if (opt.replace(/[^A-Za-z]/g, "").length < 8)
      out.unexplained.push(e.name);
    else out.optedOut.push({ module: e.name, reason: opt });
  }
  return out;
}

if (require.main === module) {
  const r = check();
  if (process.argv.includes("--list")) {
    for (const m of r.wired) console.log(`  ai    ${m}`);
    for (const o of r.optedOut) console.log(`  none  ${o.module}: ${o.reason}`);
    for (const m of r.missing) console.log(`  GAP   ${m}`);
  }
  if (r.missing.length === 0 && r.unexplained.length === 0) {
    console.log(
      `ai-manifest-coverage: ok (${r.wired.length} modules with a manifest, ${r.optedOut.length} opted out with a reason)`,
    );
    process.exit(0);
  }
  if (r.missing.length) {
    console.error(
      `ai-manifest-coverage: ${r.missing.length} built module(s) with neither a manifest nor an opt-out:`,
    );
    for (const m of r.missing) console.error(`  - src/modules/${m}`);
    console.error(
      "\nAdd src/modules/<m>/<m>.ai.js (defineManifest: reads and routes, BACKEND_STRUCTURE §14.3),",
    );
    console.error(
      "or put `// ai:none <reason>` at the top of the module's controller.",
    );
  }
  if (r.unexplained.length) {
    console.error(
      `ai-manifest-coverage: ${r.unexplained.length} opt-out(s) without a reason:`,
    );
    for (const m of r.unexplained) console.error(`  - src/modules/${m}`);
  }
  process.exit(1);
}

module.exports = { check };
