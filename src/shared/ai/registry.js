"use strict";
/**
 * Every AI manifest, discovered (BACKEND_STRUCTURE §14.4). What a module does not
 * declare in its `<module>.ai.js` does not exist for the assistant: nobody edits a
 * central list, the module says so beside itself.
 *
 *   registry.reads()             every read, with the module that declared it
 *   registry.read("employees.list")
 *   registry.routes()            every "where to make this change" route
 *   registry.catalogue()         rows for ai_catalogue (catalogue-sync.js): what the
 *                                assistant is told it can read, with each read's
 *                                parameters as JSON Schema
 *
 * Loaded once per process, on first use. A file that does not load, a file that does
 * not export defineManifest(...), or a read key two modules both declare stops the
 * load: the API and the worker would rather not start than give the assistant a tool
 * list with a hole in it. Files the repository map created but nobody has written yet
 * (empty) are skipped.
 *
 * A module with no AI surface says so in its controller with `// ai:none <reason>`;
 * gate 9 (scripts/check/ai-manifest-coverage.js) fails a module that does neither.
 */
const fs = require("node:fs");
const path = require("node:path");
const { isManifest } = require("./manifest");
const { jsonSchemaOf } = require("../../services/ai/structured");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;

let loaded = null;

/** Non-empty `*.ai.js` files under src/modules/<module>/, in a stable order. */
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
      if (f.endsWith(".ai.js") && fs.statSync(full).size > 0)
        out.push({ folder: e.name, file: full });
    }
  }
  return out;
}

/**
 * Load every manifest under `dir`.
 * @param {{dir?: string}} [opts]
 */
function load({ dir = MODULES_DIR } = {}) {
  const manifests = [];
  const readMap = new Map();
  const routeList = [];
  for (const { folder, file } of discover(dir)) {
    const rel = path
      .relative(path.resolve(dir, ".."), file)
      .split(path.sep)
      .join("/");
    const m = require(file);
    if (!isManifest(m))
      throw new Error(
        `${rel}: export defineManifest({ ... }) from shared/ai/manifest.js`,
      );
    manifests.push({ folder, file: rel, manifest: m });
    for (const r of m.reads) {
      if (readMap.has(r.key))
        throw new Error(
          `AI read "${r.key}" is declared by both ${readMap.get(r.key).file} and ${rel}`,
        );
      readMap.set(r.key, { ...r, module: m.module, file: rel });
    }
    for (const r of m.routes)
      routeList.push({ ...r, owner: m.module, file: rel });
  }
  loaded = { dir, manifests, reads: readMap, routes: routeList };
  return loaded;
}

function current() {
  return loaded || load();
}

/** Every read, in load order. */
function reads() {
  return [...current().reads.values()];
}

/** One read by key, or null. */
function read(key) {
  return current().reads.get(key) || null;
}

/** Every route. */
function routes() {
  return current().routes.slice();
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/**
 * The catalogue rows: one per read and one per route, keyed stably.
 * @returns {Array<{key: string, kind: "read"|"route", module_key: string, description: string,
 *          permission: string|null, params_schema: object|null, screen: string|null, path: string|null}>}
 */
function catalogue() {
  const rows = reads().map((r) => ({
    key: r.key,
    kind: "read",
    module_key: r.module,
    description: r.description,
    permission: `${r.permission[0]}.${r.permission[1]}`,
    params_schema: jsonSchemaOf(r.params),
    screen: null,
    path: null,
  }));
  for (const r of routes()) {
    rows.push({
      key: `${r.owner}.route.${slug(r.intent)}`,
      kind: "route",
      module_key: r.owner,
      description: r.intent,
      permission: null,
      params_schema: r.prefill ? jsonSchemaOf(r.prefill) : null,
      screen: r.screen,
      path: r.path,
    });
  }
  return rows;
}

/** Tests: forget what was loaded (required files stay in Node's cache). */
function reset() {
  loaded = null;
}

module.exports = {
  MODULES_DIR,
  discover,
  load,
  reads,
  read,
  routes,
  catalogue,
  reset,
};
