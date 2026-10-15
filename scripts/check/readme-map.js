#!/usr/bin/env node
"use strict";
/**
 * Process gate: a new file is either where the map already says files go,
 * or the map is updated to say where it is (README §11).
 *
 * Without this, README.MD drifts within weeks: someone adds a helper in a new
 * folder, the next person (or AI) cannot find it, and writes a second one.
 *
 * Needs no README change, because the map already describes these:
 *   src/modules/<m>/<m>.<anything>.js        a module file in its own module (README §5.1)
 *   packages/contract/schemas/<m>.js         a module's contract (or common.js)
 *   migrations/NNNN_name.sql
 *   seeds/, tests/, docs/, templates/, assets/, src/services/ai/prompts/
 *   app/, public-app/                        mapped in docs/FRONTEND_GUIDE.md §9.1
 *   packages/ui/                             mapped in docs/FRONTEND_GUIDE.md §9.1 and docs/COMPONENTS.md
 *   .github/ files other than workflows, package-lock.json
 *
 * Anything else that is ADDED (or renamed into place) must be findable in
 * README.MD: by its path, by its path under src/, or by its file name together
 * with its folder name (the map's tree lists "db/  tx · query-helpers").
 *
 * Usage: node scripts/check/readme-map.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, changedFiles } = require("./lib/changes");

const README = "README.MD";
const text = fs.readFileSync(path.join(ROOT, README), "utf8");
const word = (w) => new RegExp(`(^|[^A-Za-z0-9_-])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_-]|$)`).test(text);
const moduleExists = (m) => fs.existsSync(path.join(ROOT, "src", "modules", m));

const ALLOWED = [
  (p) => {
    const m = /^src\/modules\/([a-z0-9_]+)\/([^/]+)$/.exec(p);
    return m && m[2].startsWith(`${m[1]}.`) && m[2].endsWith(".js");
  },
  (p) => {
    const m = /^packages\/contract\/schemas\/([a-z0-9_]+)\.js$/.exec(p);
    return m && (m[1] === "common" || moduleExists(m[1]));
  },
  (p) => /^migrations\/\d{4,5}_[a-z0-9_]+\.sql$/.test(p),
  (p) => /^(seeds|tests|docs|templates|assets|app|public-app)\//.test(p),
  (p) => /^src\/services\/ai\/prompts\/[a-z0-9-]+\.md$/.test(p),
  (p) => /^packages\/ui\//.test(p),
  (p) => /^\.github\//.test(p) && !/^\.github\/workflows\//.test(p),
  (p) => p === "package-lock.json" || p.endsWith("/.gitkeep") || p === ".gitkeep",
];

function onMap(p) {
  if (text.includes(p)) return true;
  if (p.startsWith("src/") && text.includes(p.slice(4))) return true;
  const base = path.posix.basename(p).replace(/\.[^.]+$/, "");
  const dir = path.posix.basename(path.posix.dirname(p));
  if (dir === "." || dir === "") return word(path.posix.basename(p));
  return word(base) && word(dir);
}

let changed;
try {
  changed = changedFiles();
} catch (err) {
  console.error(`readme-map: could not read the change from git: ${err.message}`);
  process.exit(1);
}

const added = changed.filter((c) => c.status === "A" || c.status === "R").map((c) => c.path);
const missing = added.filter((p) => !ALLOWED.some((ok) => ok(p)) && !onMap(p));

if (missing.length) {
  console.error(`readme-map: ${missing.length} new file(s) not on the map in ${README}\n`);
  for (const p of missing) console.error(`  ${p}`);
  console.error(
    `\nAdd each to the right section of ${README} (§3 repository map, §4 src outside modules,\n` +
      "§5 modules) in the same change. If it duplicates something already on the map, use that instead (README §11).",
  );
  process.exit(1);
}
console.log(`readme-map: ok (${added.length} new file(s) in this change)`);
