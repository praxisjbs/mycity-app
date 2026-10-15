#!/usr/bin/env node
"use strict";
/**
 * Gate 10, backend half: every module with records answers ⌘K, or says in writing why
 * not (MILESTONES A13 and §18.2). A record nobody can find is a record people stop
 * trusting the system with.
 *
 * Checked:
 *  1. A module with records (a controller AND a repo with content) has a
 *     `<module>.search.js` with content, or `// search:none <reason>` in its controller.
 *     The reason is required.
 *  2. Every provider loads (shared/search/registry.js): a module key that exists, a
 *     record type shared/route-map can open, and no type declared twice.
 *
 * The frontend half (every routed screen and tab registered in the staff app's screen
 * registry) runs against app/ once the frontend foundation lands (AJ).
 *
 * Usage: node scripts/check/search-coverage.js [--list]     exit 0 ok, 1 on a gap
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = process.env.APP_ENV || "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");
const MODULES = path.join(ROOT, "src", "modules");
const OPT_OUT = /\/\/\s*search:none\b[ \t:,-]*(.*)$/m;

const filled = (file) =>
  fs.existsSync(file) && fs.readFileSync(file, "utf8").trim().length > 0;

/**
 * @param {{dir?: string}} [opts]
 */
function check({ dir = MODULES } = {}) {
  const out = {
    providers: [],
    optedOut: [],
    missing: [],
    unexplained: [],
    loadError: null,
    types: [],
  };
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
    const repos = files
      .filter((f) => f.endsWith(".repo.js"))
      .map((f) => path.join(folder, f))
      .filter(filled);
    if (controllers.length === 0 || repos.length === 0) continue;
    if (
      files.some(
        (f) => f.endsWith(".search.js") && filled(path.join(folder, f)),
      )
    ) {
      out.providers.push(e.name);
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
  try {
    out.types = require(path.join(ROOT, "src", "shared", "search", "registry"))
      .load({ dir })
      .map((p) => p.type);
  } catch (err) {
    out.loadError = err.message;
  }
  return out;
}

if (require.main === module) {
  const r = check();
  if (process.argv.includes("--list")) {
    for (const m of r.providers) console.log(`  search  ${m}`);
    for (const o of r.optedOut)
      console.log(`  none    ${o.module}: ${o.reason}`);
    for (const m of r.missing) console.log(`  GAP     ${m}`);
  }
  if (!r.missing.length && !r.unexplained.length && !r.loadError) {
    console.log(
      `search-coverage: ok (${r.types.length} record types searchable, ${r.optedOut.length} module(s) opted out with a reason)`,
    );
    process.exit(0);
  }
  if (r.missing.length) {
    console.error(
      `search-coverage: ${r.missing.length} module(s) with records and neither a provider nor an opt-out:`,
    );
    for (const m of r.missing) console.error(`  - src/modules/${m}`);
    console.error(
      "\nAdd src/modules/<m>/<m>.search.js (recordProvider, shared/search/provider.js),",
    );
    console.error(
      "or put `// search:none <reason>` at the top of the module's controller.",
    );
  }
  if (r.unexplained.length) {
    console.error(
      `search-coverage: ${r.unexplained.length} opt-out(s) without a reason:`,
    );
    for (const m of r.unexplained) console.error(`  - src/modules/${m}`);
  }
  if (r.loadError)
    console.error(`search-coverage: a provider does not load: ${r.loadError}`);
  process.exit(1);
}

module.exports = { check };
