#!/usr/bin/env node
"use strict";
/**
 * The committed catalogue snapshot (docs/guides/praxis-ai.md §6.15; gate 23): every read,
 * summary, action and route the manifests declare, with its module, permission, risk, bulk and
 * the hash of its schema, written to src/shared/ai/catalogue.snapshot.json.
 *
 *   npm run gen:ai-catalogue            rewrite the snapshot after a manifest or a schema changed
 *   node scripts/gen/ai-catalogue.js --check    exit 1 when the snapshot is stale (gate 23 runs this)
 *
 * The diff of the snapshot travels with the pull request, so a widened filter, a new field on a
 * form's schema, a new action or a read that went away is seen and reviewed, and the deploy's
 * catalogue sync (catalogue-sync.js) writes what the review saw.
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = process.env.APP_ENV || "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");
const FILE = path.join(ROOT, "src", "shared", "ai", "catalogue.snapshot.json");

function current() {
  const registry = require(path.join(ROOT, "src", "shared", "ai", "registry"));
  return registry.snapshot();
}

function render(rows) {
  return `${JSON.stringify({ about: "The AI manifests as the build declares them (docs/guides/praxis-ai.md §6.15). Rewrite with npm run gen:ai-catalogue; never by hand.", entries: rows }, null, 2)}\n`;
}

/** @returns {{stale: boolean, added: string[], removed: string[], changed: string[]}} */
function compare() {
  const now = current();
  let kept;
  try {
    kept = JSON.parse(fs.readFileSync(FILE, "utf8")).entries || [];
  } catch {
    kept = [];
  }
  const key = (r) => `${r.kind}:${r.key}`;
  const was = new Map(kept.map((r) => [key(r), r]));
  const is = new Map(now.map((r) => [key(r), r]));
  const added = [...is.keys()].filter((k) => !was.has(k));
  const removed = [...was.keys()].filter((k) => !is.has(k));
  const changed = [...is.keys()].filter((k) => was.has(k) && JSON.stringify(was.get(k)) !== JSON.stringify(is.get(k)));
  return { stale: added.length + removed.length + changed.length > 0, added, removed, changed, rows: now };
}

if (require.main === module) {
  const r = compare();
  if (process.argv.includes("--check")) {
    if (!r.stale) {
      console.log(`ai-catalogue: snapshot current (${r.rows.length} entries)`);
      process.exit(0);
    }
    console.error("ai-catalogue: the snapshot is stale; run npm run gen:ai-catalogue and review the diff with your PR (praxis-ai.md §6.15)");
    for (const k of r.added) console.error(`  + ${k}`);
    for (const k of r.removed) console.error(`  - ${k}`);
    for (const k of r.changed) console.error(`  ~ ${k}`);
    process.exit(1);
  }
  fs.writeFileSync(FILE, render(r.rows));
  console.log(`ai-catalogue: wrote ${path.relative(ROOT, FILE)} (${r.rows.length} entries${r.stale ? `: ${r.added.length} added, ${r.removed.length} removed, ${r.changed.length} changed` : ", unchanged"})`);
}

module.exports = { compare, current, FILE };
