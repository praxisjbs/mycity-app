"use strict";
/**
 * Every search provider, discovered: `src/modules/<module>/<module>.search.js`, one
 * provider or an array (a module with two kinds of record). What is not declared is
 * not searchable; gate 10 (scripts/check/search-coverage.js) fails a module with records
 * that neither declares a provider nor writes `// search:none <reason>` in its
 * controller.
 *
 * Two providers claiming one type is a load error, not an overwrite: results are
 * grouped by type, and a duplicate would put two modules' records under one heading
 * behind one module's grant. Files the repository map created but nobody has written
 * yet (empty) are skipped.
 */
const fs = require("node:fs");
const path = require("node:path");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let cached = null;

/** Non-empty `*.search.js` files, in a stable order. */
function discover(dir = MODULES_DIR) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || !NAME_RE.test(e.name)) continue;
    for (const f of fs.readdirSync(path.join(dir, e.name)).sort()) {
      const full = path.join(dir, e.name, f);
      if (f.endsWith(".search.js") && fs.statSync(full).size > 0)
        out.push(full);
    }
  }
  return out;
}

/**
 * Load every provider under `dir`.
 * @param {{dir?: string}} [opts]
 */
function load({ dir = MODULES_DIR } = {}) {
  const all = [];
  const seen = new Map();
  for (const file of discover(dir)) {
    const rel = path
      .relative(path.resolve(dir, ".."), file)
      .split(path.sep)
      .join("/");
    const exported = require(file);
    for (const p of Array.isArray(exported) ? exported : [exported]) {
      if (!p || typeof p.search !== "function" || !p.type || !p.module) {
        throw new Error(
          `${rel}: export recordProvider({ ... }) (or an array of them) from shared/search/provider.js`,
        );
      }
      if (seen.has(p.type))
        throw new Error(
          `search type "${p.type}" is declared by both ${seen.get(p.type)} and ${rel}`,
        );
      seen.set(p.type, rel);
      all.push(Object.freeze({ ...p, file: rel }));
    }
  }
  cached = all;
  return all;
}

/** Every provider. */
function providers() {
  return cached || load();
}

/** Tests: forget what was loaded. */
function reset() {
  cached = null;
}

module.exports = { MODULES_DIR, discover, load, providers, reset };
