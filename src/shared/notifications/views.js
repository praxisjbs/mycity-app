"use strict";
/**
 * Where a record sits inside the screen it opens on (docs/guides/notifications.md §6, Where it
 * waits): a screen's inner views as paths, outermost first ("temporary", "temporary/cancelled"),
 * so the screen's switch and chips each carry the share of its reader's unread notices they hold
 * (`GET /notifications/views`) and the screen opens where they are.
 *
 * Each module declares its own records in `src/modules/<module>/<module>.views.js`, an array of
 *
 *   { module: "people", tab: "worksites", type: "attendance_location_request", view: "temporary/requests" }
 *   { module: "people", tab: "worksites", type: "worksite", place: async (db, ids) => Map<id, path> }
 *
 * `view` puts every record of the type in one view; `place` reads each record's view, as the
 * screen's own filters would find it (its state decides the chip), and a record it leaves out
 * counts on the tab alone. The paths are the screen's own values: a switch's value, then a chip's.
 * One declaration per screen and record type: two are a load error, as is a path that is not one.
 * Files the repository map created but nobody has written yet (empty) are skipped.
 */
const fs = require("node:fs");
const path = require("node:path");

const MODULES_DIR = path.resolve(__dirname, "../../modules");
const NAME_RE = /^[a-z][a-z0-9_]*$/;
/** As the contract's ViewPath. */
const PATH_RE = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let cached = null;

/** Non-empty `*.views.js` files, in a stable order. */
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
      if (f.endsWith(".views.js") && fs.statSync(full).size > 0) out.push(full);
    }
  }
  return out;
}

const keyOf = (moduleKey, tab, type) => `${moduleKey}/${tab}/${type}`;

/**
 * Every declaration under `dir`, by screen and record type.
 * @param {{dir?: string}} [opts]
 * @returns {Map<string, {module: string, tab: string, type: string, view?: string, place?: Function, file: string}>}
 */
function load({ dir = MODULES_DIR } = {}) {
  const all = new Map();
  for (const file of discover(dir)) {
    const rel = path.relative(path.resolve(dir, ".."), file).split(path.sep).join("/");
    for (const d of [].concat(require(file))) {
      if (!d || !d.module || !d.tab || !d.type) throw new Error(`${rel}: a view needs module, tab and type`);
      if (!d.view === !d.place) throw new Error(`${rel}: ${d.type} on ${d.module}/${d.tab} needs a view or a place, not both`);
      if (d.view && !PATH_RE.test(d.view)) throw new Error(`${rel}: "${d.view}" is not a view path`);
      if (d.place && typeof d.place !== "function") throw new Error(`${rel}: ${d.type}'s place is not a function`);
      const key = keyOf(d.module, d.tab, d.type);
      if (all.has(key)) throw new Error(`${d.type} on ${d.module}/${d.tab} is placed by both ${all.get(key).file} and ${rel}`);
      all.set(key, Object.freeze({ ...d, file: rel }));
    }
  }
  cached = all;
  return all;
}

function declarations() {
  return cached || load();
}

/**
 * The view each of these records sits in on one screen, or none: a Map of id to path. Only ids a
 * record of the type could have reach a `place` (a uuid), and a path it returns that is not one
 * is dropped, so a slip in one module costs only its own counts.
 * @param {import("pg").Pool | import("pg").PoolClient} db
 * @param {{module: string, tab: string, type: string, ids: string[]}} q
 * @returns {Promise<Map<string, string>>}
 */
async function placeAll(db, { module: moduleKey, tab, type, ids }) {
  const d = declarations().get(keyOf(moduleKey, tab, type));
  const out = new Map();
  if (!d) return out;
  if (d.view) {
    for (const id of ids) out.set(id, d.view);
    return out;
  }
  const asked = ids.filter((id) => UUID_RE.test(id));
  if (!asked.length) return out;
  for (const [id, where] of await d.place(db, asked)) {
    if (where && PATH_RE.test(where)) out.set(String(id), where);
  }
  return out;
}

/** "temporary/cancelled" → ["temporary", "temporary/cancelled"]: a record counts in each. */
function pathsOf(where) {
  const parts = where.split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** Tests: forget what was loaded. */
function reset() {
  cached = null;
}

module.exports = { MODULES_DIR, PATH_RE, discover, load, declarations, placeAll, pathsOf, reset };
