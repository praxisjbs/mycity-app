"use strict";
/**
 * Every AI manifest, discovered (BACKEND_STRUCTURE §14.4). What a module does not
 * declare in its `<module>.ai.js` does not exist for the assistant: nobody edits a
 * central list, the module says so beside itself.
 *
 *   registry.reads()             every read, with the module that declared it
 *   registry.read("employees.list")
 *   registry.summaries()         every summary read (figures, never rows; praxis-ai.md §6.13)
 *   registry.summary("attendance.summary")
 *   registry.actions()           every action the assistant may draft as a card (§6.11)
 *   registry.action("tasks.create")
 *   registry.routes()            every "where to make this change" route
 *   registry.files()             every kind of document a module reads when attached on Ask (§6.18)
 *   registry.file("invoice")     one kind, with the module that declared it
 *   registry.filesFor(actor)     the kinds this person may attach: the grant, and the capability
 *   registry.manifests()         each manifest with its file, for the gates
 *   registry.catalogue()         rows for ai_catalogue (catalogue-sync.js): what the
 *                                assistant is told it can read and do, with each one's
 *                                parameters as JSON Schema
 *   registry.snapshot()          the catalogue as gate 23 compares it to the committed
 *                                src/shared/ai/catalogue.snapshot.json (§6.15)
 *
 * Loaded once per process, on first use. A file that does not load, a file that does
 * not export defineManifest(...), or a key two modules both declare stops the load: the
 * API and the worker would rather not start than give the assistant a tool list with a
 * hole in it. Files the repository map created but nobody has written yet (empty) are
 * skipped. Reads, summaries and actions share one namespace: the model's tool names.
 *
 * A module with no AI surface says so in its controller with `// ai:none <reason>`;
 * gate 9 (scripts/check/ai-manifest-coverage.js) fails a module that does neither.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { isManifest, contractNameOf } = require("./manifest");
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
      if (f.endsWith(".ai.js") && fs.statSync(full).size > 0) out.push({ folder: e.name, file: full });
    }
  }
  return out;
}

/**
 * Load every manifest under `dir`.
 * @param {{dir?: string, extra?: Array<{folder: string, manifest: object}>}} [opts]  `extra`: manifests a
 *        test adds beside the modules', each named for the folder it stands in for
 */
function load({ dir = MODULES_DIR, extra = [] } = {}) {
  const manifests = [];
  const keyMap = new Map();
  const routeList = [];
  const fileMap = new Map();
  const take = (folder, rel, m) => {
    if (!isManifest(m)) throw new Error(`${rel}: export defineManifest({ ... }) from shared/ai/manifest.js`);
    manifests.push({ folder, file: rel, manifest: m });
    for (const kind of ["reads", "summaries", "actions"]) {
      for (const r of m[kind]) {
        if (keyMap.has(r.key))
          throw new Error(`AI ${r.kind} "${r.key}" is declared by both ${keyMap.get(r.key).file} and ${rel}`);
        keyMap.set(r.key, { ...r, module: m.module, file: rel });
      }
    }
    for (const r of m.routes) routeList.push({ ...r, owner: m.module, file: rel });
    for (const f of m.files || []) {
      if (fileMap.has(f.kind)) throw new Error(`AI file kind "${f.kind}" is declared by both ${fileMap.get(f.kind).file} and ${rel}`);
      fileMap.set(f.kind, { ...f, module: m.module, file: rel });
    }
  };
  for (const { folder, file } of discover(dir)) {
    const rel = path.relative(path.resolve(dir, ".."), file).split(path.sep).join("/");
    take(folder, rel, require(file));
  }
  for (const { folder, manifest } of extra) take(folder, `${folder}/${folder}.ai.js (test)`, manifest);
  checkAskReads(keyMap);
  checkFileActions(keyMap, fileMap);
  loaded = { dir, manifests, keys: keyMap, routes: routeList, files: fileMap };
  return loaded;
}

/**
 * A kind of document draws cards some manifest declares (praxis-ai.md §6.18), and an action drawn
 * only from a file names a kind a manifest reads and is among that kind's cards.
 */
function checkFileActions(keyMap, fileMap) {
  for (const f of fileMap.values())
    for (const key of f.actions) {
      const a = keyMap.get(key);
      if (!a || a.kind !== "action") throw new Error(`${f.file}: file ${f.kind} draws "${key}", which no manifest declares as an action`);
    }
  for (const a of keyMap.values()) {
    if (a.kind !== "action" || !a.from_file) continue;
    const f = fileMap.get(a.from_file.kind);
    if (!f || !f.actions.includes(a.key)) throw new Error(`${a.file}: action ${a.key} is drawn from a ${a.from_file.kind}, whose file does not list it`);
  }
}

/**
 * An ask that names a record answers from a list read (praxis-ai.md decision 34): the read is
 * declared by some manifest, is a list (its params take a page), and takes the ask's own params.
 * Checked once every manifest has loaded, since the read is often another module's.
 */
function checkAskReads(keyMap) {
  for (const a of keyMap.values()) {
    if (a.kind !== "action") continue;
    for (const q of a.asks || []) {
      if (!q.read) continue;
      const r = keyMap.get(q.read);
      const at = `${a.file}: action ${a.key} ask ${q.field}`;
      if (!r || r.kind !== "read") throw new Error(`${at}: read "${q.read}" is no read a manifest declares`);
      if (!r.list) throw new Error(`${at}: read "${q.read}" is not a list, so it has no rows to offer`);
      const parsed = r.params.safeParse({ ...q.params, page: 1 });
      if (!parsed.success) throw new Error(`${at}: read "${q.read}" does not take params ${JSON.stringify(q.params)}`);
    }
  }
}

function current() {
  return loaded || load();
}

const ofKind = (kind) => [...current().keys.values()].filter((r) => r.kind === kind);
const byKey = (key, kind) => {
  const r = current().keys.get(key);
  return r && r.kind === kind ? r : null;
};

/** Every read, in load order. */
const reads = () => ofKind("read");
/** One read by key, or null. */
const read = (key) => byKey(key, "read");
/** Every summary read. */
const summaries = () => ofKind("summary");
const summary = (key) => byKey(key, "summary");
/** Every action. */
const actions = () => ofKind("action");
const action = (key) => byKey(key, "action");
/** A read, summary or action by its tool name, whatever its kind; null for none. */
const tool = (key) => current().keys.get(key) || null;
/** Every route. */
const routes = () => current().routes.slice();
/** Every manifest with its folder and file, in load order. */
const manifests = () => current().manifests.slice();
/** Every kind of document a module reads, in load order. */
const files = () => [...current().files.values()];
/** One kind of document, or null. */
const file = (kind) => current().files.get(kind) || null;
/**
 * The kinds this person may attach (decision 41): those whose grant they hold, and the capability on
 * top when the kind names one, as a card's own check would hold them.
 * @param {object} actor  req.user
 */
async function filesFor(actor) {
  const { scopedFor } = require("./authorise");
  const out = [];
  for (const f of files()) if (await scopedFor(actor, f)) out.push(f);
  return out;
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|$/g, "");

/**
 * The catalogue rows: one per read, summary, action and route, keyed stably.
 * @returns {Array<{key: string, kind: "read"|"summary"|"action"|"route", module_key: string, description: string,
 *          permission: string|null, risk: string|null, params_schema: object|null, screen: string|null, path: string|null}>}
 */
function catalogue() {
  const rows = [];
  for (const r of reads())
    rows.push({ key: r.key, kind: "read", module_key: r.module, description: r.description, permission: `${r.permission[0]}.${r.permission[1]}`, risk: null, params_schema: jsonSchemaOf(r.params), screen: null, path: null });
  for (const r of routes()) {
    rows.push({
      key: `${r.owner}.route.${slug(r.intent)}`,
      kind: "route",
      module_key: r.owner,
      description: r.intent,
      permission: null,
      risk: null,
      params_schema: r.prefill ? jsonSchemaOf(r.prefill) : null,
      screen: r.screen,
      path: r.path,
    });
  }
  for (const s of summaries())
    rows.push({ key: s.key, kind: "summary", module_key: s.module, description: s.description, permission: `${s.permission[0]}.${s.permission[1]}`, risk: null, params_schema: jsonSchemaOf(s.params), screen: null, path: null });
  for (const a of actions())
    rows.push({ key: a.key, kind: "action", module_key: a.module, description: a.description, permission: `${a.permission[0]}.${a.permission[1]}`, risk: a.risk, params_schema: jsonSchemaOf(a.input), screen: null, path: null });
  return rows;
}

const sha = (v) => crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

/**
 * What gate 23 holds the committed snapshot to (praxis-ai.md §6.15): every read, summary, action
 * and route with its module, permission, risk, bulk and the hash of its schema, and an action's
 * capability or capabilities when it names them, sorted by key.
 * @returns {Array<{key: string, kind: string, module_key: string, permission: string|null, risk: string|null,
 *          bulk: number|null, schema: string|null, schema_sha: string|null, screen: string|null}>}
 */
function snapshot() {
  const rows = catalogue().map((r) => ({
    key: r.key,
    kind: r.kind,
    module_key: r.module_key,
    permission: r.permission,
    risk: r.risk,
    bulk: r.kind === "action" ? action(r.key).bulk : null,
    schema: r.kind === "action" ? contractNameOf(action(r.key).input) : r.kind === "summary" ? contractNameOf(summary(r.key).params) : r.kind === "read" ? contractNameOf(read(r.key).params) : null,
    schema_sha: r.params_schema ? sha(r.params_schema) : null,
    screen: r.screen,
    // An authority held on top of the grant is part of who may press it (praxis-ai.md §6.11).
    ...(r.kind === "action" && action(r.key).capability ? { capability: action(r.key).capability } : {}),
    ...(r.kind === "action" && action(r.key).capabilities ? { capabilities: [...action(r.key).capabilities] } : {}),
  }));
  return rows.sort((a, b) => (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind.localeCompare(b.kind)));
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
  summaries,
  summary,
  actions,
  action,
  tool,
  routes,
  manifests,
  files,
  file,
  filesFor,
  catalogue,
  snapshot,
  reset,
};
