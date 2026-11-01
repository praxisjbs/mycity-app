"use strict";
/**
 * What the assistant may read and do in a module, and where it sends a person to make a
 * change it does not offer (BACKEND_STRUCTURE §14.3; docs/guides/praxis-ai.md §6.11, §6.13).
 * One per module, in `src/modules/<module>/<module>.ai.js`, or `// ai:none <reason>` in the
 * controller.
 *
 *   module.exports = defineManifest({
 *     module: "people",
 *     reads: [{
 *       key: "employees.list",
 *       description: "List employees, filtered by department, status or manager",
 *       params: c.organisation.EmployeeListQuery,     // a listQuery(): pages at 25
 *       permission: ["people", "view"],
 *       run: (client, params, actor) => repo.list(client, params, actor.scope),
 *       cite: (row) => ({ type: "employee", id: row.employee_id, label: row.full_name }),
 *     }],
 *     summaries: [{                                   // figures the database computes, never rows
 *       key: "employees.summary",
 *       description: "Headcount by department, status or confirmation due",
 *       params: c.organisation.EmployeeSummaryQuery,  // filters and the grouping; no page
 *       permission: ["people", "view"],
 *       run: (client, params, actor) => repo.summary(client, params, actor.scope),   // AiSummaryResult
 *     }],
 *     actions: [{                                     // a change drafted as a card the person confirms
 *       key: "employees.confirm",
 *       description: "Confirm an employee at the end of probation",
 *       input: c.organisation.EmployeeConfirm,        // the form's own contract schema: the card's fields
 *       permission: ["people", "edit"],
 *       risk: "standard",                             // standard | approval | money | payroll | delete
 *       bulk: 1,                                      // records one press may touch, at most 25
 *       records: (values) => [{ type: "employee", id: values.employee_id }],
 *       check: async (client, values, actor) => {},   // the module's own rules before run: state, scope
 *       run: (values, actor, ctx) => service.confirm(actor, actor.scope, values),   // the screen's own function
 *       readback: (result) => [{ type: "employee", id: result.employee_id, label: result.full_name, status: "confirmed" }],
 *     }],
 *     routes: [{ intent: "add an employee", screen: "people.employees", params: { new: "1" } }],
 *     not_offered: { EmployeeImportRow: "an import row is loaded through the import engine" },
 *   });
 *
 * The assistant reads, and acts only through a declared action a person confirms (A23 as
 * amended 01/11/2026, praxis-ai.md §1.2 decision 10). A manifest that declares a write by any
 * other name (`write`, `executor`, `execute`, `mutations`, `sql`, `query`) is refused when it
 * loads, and gate 19 (scripts/check/ai-no-writes.js) fails the build; so is one that holds SQL.
 * An action's `run` is the module's own service function, which keeps its transaction and its
 * emit(); the engine never sees a repo.
 *
 * Checked when the file loads, so a mistake fails at boot and in CI, not mid-answer:
 *  - module and every permission are module keys; a read or a summary needs `view`, an action
 *    needs create, edit, approve or delete;
 *  - `params`, `input` and `prefill` are schemas exported from packages/contract (the same rules
 *    as the screen); a list read's params carry `page` (a listQuery), a summary's never do, and
 *    authorise.js refuses a list that returns more than one page of 25 or a summary that returns
 *    rows;
 *  - keys are `<thing>.<verb>`, unique across reads, summaries and actions (they share the
 *    model's tool names); descriptions are short, plain and have no em dash;
 *  - an action's risk is one of the five classes, its bulk 1 to 25, its run a function, its
 *    check, records and readback functions when given;
 *  - a route names a real screen (shared/route-map SCREENS) as "<module>.<tab>";
 *  - a route's prefill is the form's own fields (packages/contract `<Thing>Prefill`), never a
 *    restricted field nor one of the address's own words (tab, id, action, new, its params);
 *  - not_offered names schemas with a reason each (gate 23 holds them to the module's contract).
 *
 * `run(client, params, actor)` receives the caller's own scope as `actor.scope`
 * ({ scope, scope_ids, employee_id }), so a read returns exactly what the same person would see
 * on the screen; an action's `run(values, actor, ctx)` receives the scope its grant gives.
 */
const catalog = require("../access/access.catalog");
const routeMap = require("../route-map");

const MANIFEST = Symbol.for("mycity.ai.manifest");
const TOP_KEYS = new Set(["module", "reads", "summaries", "actions", "routes", "not_offered"]);
/** A write by another name, anywhere in a manifest: refused. */
const WRITE_WORDS = new Set([
  "write",
  "writes",
  "executor",
  "execute",
  "executors",
  "mutations",
  "mutation",
  "sql",
  "creates",
  "updates",
  "deletes",
]);
const READ_KEYS = new Set(["key", "description", "params", "permission", "run", "cite", "matrix"]);
const SUMMARY_KEYS = new Set(["key", "description", "params", "permission", "run", "matrix"]);
const ACTION_KEYS = new Set([
  "key",
  "label",
  "description",
  "input",
  "permission",
  "risk",
  "bulk",
  "records",
  "check",
  "run",
  "readback",
  "suggest",
  "form",
  "labels",
  "matrix",
]);
const ROUTE_KEYS = new Set(["intent", "screen", "params", "prefill"]);
const KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/** An action's grant: never `view`, which cannot change anything. */
const ACTION_GRANTS = new Set(["create", "edit", "approve", "delete", "export"]);
/** The risk classes (praxis-ai.md §1.2 decision 11); the four after standard need a fresh sign-in. */
const RISKS = Object.freeze(["standard", "approval", "money", "payroll", "delete"]);
const BULK_MAX = 25;

let contractSchemas = null;
/** Every object schema packages/contract exports, by identity, with its "domain.Name". */
function contractIndex() {
  if (!contractSchemas) {
    contractSchemas = new Map();
    for (const [domain, schemas] of Object.entries(require("@mycity/contract"))) {
      for (const [name, v] of Object.entries(schemas || {}))
        if (v && typeof v.safeParse === "function" && !contractSchemas.has(v)) contractSchemas.set(v, `${domain}.${name}`);
    }
  }
  return contractSchemas;
}

function isContractSchema(schema) {
  return contractIndex().has(schema);
}

/** "tasks.TaskCreate" for a contract schema, or null. */
function contractNameOf(schema) {
  return contractIndex().get(schema) || null;
}

function shapeOf(schema) {
  let s = schema;
  while (s && s._def && !s.shape && (s._def.schema || s._def.innerType))
    s = s._def.schema || s._def.innerType;
  return s && s.shape ? s.shape : null;
}

function checkKeys(where, obj, allowed, what) {
  if (!obj || typeof obj !== "object") throw new Error(`${where}: each ${what} is an object`);
  for (const k of Object.keys(obj)) {
    if (WRITE_WORDS.has(k))
      throw new Error(`${where}: "${k}" in ${what === "action" ? "an action" : `a ${what}`}. The assistant acts only through a declared action's run, never a write by another name`);
    if (!allowed.has(k)) throw new Error(`${where}: unknown ${what} key "${k}"`);
  }
}

function checkDescription(at, description) {
  if (typeof description !== "string" || description.trim().length < 10 || description.length > 200)
    throw new Error(`${at}: description is a plain sentence of 10 to 200 characters`);
  if (description.includes("—")) throw new Error(`${at}: no em dashes in a description`);
}

function checkKey(where, key, seen, what) {
  if (!KEY_RE.test(String(key || ""))) throw new Error(`${where}: ${what} key "${key}" is <thing>.<verb>, snake_case`);
  if (seen.has(key)) throw new Error(`${where} ${what} ${key}: declared twice`);
  seen.add(key);
}

function checkPermission(at, permission, allowed, what) {
  if (!Array.isArray(permission) || permission.length !== 2) throw new Error(`${at}: permission is [module, action]`);
  if (!catalog.isModule(permission[0])) throw new Error(`${at}: "${permission[0]}" is not a module key`);
  if (!allowed.has(permission[1]))
    throw new Error(`${at}: ${what} needs ${[...allowed].map((a) => `"${a}"`).join(" or ")}, not "${permission[1]}"`);
}

function checkSchemaParam(at, schema, name) {
  if (!schema || typeof schema.safeParse !== "function" || !isContractSchema(schema))
    throw new Error(`${at}: ${name} is a schema exported from packages/contract`);
  const shape = shapeOf(schema);
  if (!shape) throw new Error(`${at}: ${name} is an object schema`);
  return shape;
}

const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
/** A card's button from its key when the manifest gives none: "tasks.create" reads "Create Task" (Verb Noun). */
function labelOfKey(key) {
  const [thing, verb] = String(key).split(".");
  const noun = thing.replace(/_/g, " ").replace(/ies$/, "y").replace(/s$/, "");
  return `${cap(verb.replace(/_/g, " "))} ${noun.split(" ").map(cap).join(" ")}`;
}

/** PR5's scope probes: { inside, outside } functions a module gives the matrix (praxis-ai.md §1.2 decision 26). */
function checkMatrix(at, matrix) {
  if (matrix === undefined) return;
  if (!matrix || typeof matrix !== "object" || typeof matrix.inside !== "function" || typeof matrix.outside !== "function")
    throw new Error(`${at}: matrix is { inside: (ctx) => record, outside: (ctx) => record }`);
}

function checkRead(where, r, seen) {
  checkKeys(where, r, READ_KEYS, "read");
  checkKey(where, r.key, seen, "read");
  const at = `${where} read ${r.key}`;
  checkDescription(at, r.description);
  const shape = checkSchemaParam(at, r.params, "params");
  checkPermission(at, r.permission, new Set(["view"]), "a read");
  if (typeof r.run !== "function") throw new Error(`${at}: run is (client, params, actor) => result`);
  if (typeof r.cite !== "function") throw new Error(`${at}: cite is (row) => { type, id, label? }`);
  checkMatrix(at, r.matrix);
  return Object.freeze({
    ...r,
    kind: "read",
    list: Object.prototype.hasOwnProperty.call(shape, "page"),
  });
}

function checkSummary(where, s, seen) {
  checkKeys(where, s, SUMMARY_KEYS, "summary");
  checkKey(where, s.key, seen, "summary");
  const at = `${where} summary ${s.key}`;
  checkDescription(at, s.description);
  const shape = checkSchemaParam(at, s.params, "params");
  if (Object.prototype.hasOwnProperty.call(shape, "page"))
    throw new Error(`${at}: a summary takes no page; it returns figures, never rows`);
  checkPermission(at, s.permission, new Set(["view"]), "a summary");
  if (typeof s.run !== "function") throw new Error(`${at}: run is (client, params, actor) => AiSummaryResult`);
  checkMatrix(at, s.matrix);
  return Object.freeze({ ...s, kind: "summary", list: false });
}

function checkAction(where, a, seen) {
  checkKeys(where, a, ACTION_KEYS, "action");
  checkKey(where, a.key, seen, "action");
  const at = `${where} action ${a.key}`;
  checkDescription(at, a.description);
  checkSchemaParam(at, a.input, "input");
  checkPermission(at, a.permission, ACTION_GRANTS, "an action");
  if (!RISKS.includes(a.risk)) throw new Error(`${at}: risk is one of ${RISKS.join(", ")}`);
  const bulk = a.bulk === undefined ? 1 : a.bulk;
  if (!Number.isInteger(bulk) || bulk < 1 || bulk > BULK_MAX) throw new Error(`${at}: bulk is 1 to ${BULK_MAX}`);
  if (typeof a.run !== "function") throw new Error(`${at}: run is (values, actor, ctx) => result, the module's own service function`);
  for (const fn of ["records", "check", "readback"])
    if (a[fn] !== undefined && typeof a[fn] !== "function") throw new Error(`${at}: ${fn} is a function`);
  if (a.suggest !== undefined && typeof a.suggest !== "boolean") throw new Error(`${at}: suggest is true or false`);
  if (a.label !== undefined && (typeof a.label !== "string" || !a.label.trim() || a.label.length > 30 || a.label.trim().split(/\s+/).length > 3))
    throw new Error(`${at}: label is the card's button, Verb Noun, at most 3 words`);
  if (a.form !== undefined && !/^none: \S/.test(String(a.form)))
    throw new Error(`${at}: form is "none: <reason>" when the screen has no form for it, else left out`);
  if (a.labels !== undefined) {
    if (!a.labels || typeof a.labels !== "object" || Object.values(a.labels).some((v) => typeof v !== "string" || !v.trim()))
      throw new Error(`${at}: labels is { field: "Label" }`);
    const shape = shapeOf(a.input);
    for (const k of Object.keys(a.labels))
      if (!Object.prototype.hasOwnProperty.call(shape, k)) throw new Error(`${at}: labels names "${k}", which input does not take`);
  }
  checkMatrix(at, a.matrix);
  return Object.freeze({
    ...a,
    kind: "action",
    label: a.label ? a.label.trim() : labelOfKey(a.key),
    bulk,
    suggest: a.suggest === true,
    records: a.records || (() => []),
    readback: a.readback || null,
    check: a.check || null,
    labels: Object.freeze({ ...(a.labels || {}) }),
  });
}

/** Words the screen's address already uses: a prefill field may not take one over. */
const ADDRESS_WORDS = new Set(["tab", "id", "action", "new"]);

/**
 * A prefill lands in the address bar, and so in the browser's history: an object schema, no field
 * named like the address's own words or the route's params, and none the field mask restricts
 * (salary, bank, personal, statutory).
 */
function checkPrefill(where, r) {
  const shape = shapeOf(r.prefill);
  if (!shape) throw new Error(`${where}: route "${r.intent}" prefill is an object schema`);
  const { FIELDS, maskedPropsFor } = require("../rbac/field-mask");
  const restricted = maskedPropsFor(Object.keys(FIELDS));
  for (const k of Object.keys(shape)) {
    if (ADDRESS_WORDS.has(k) || (r.params && k in r.params))
      throw new Error(`${where}: route "${r.intent}" prefill field "${k}" is a word the address already uses`);
    if (restricted.has(k))
      throw new Error(
        `${where}: route "${r.intent}" prefill field "${k}" is restricted (shared/rbac/field-mask); an address is kept in the browser's history`,
      );
  }
}

function checkRoute(where, r, seen) {
  if (!r || typeof r !== "object") throw new Error(`${where}: each route is an object`);
  for (const k of Object.keys(r)) if (!ROUTE_KEYS.has(k)) throw new Error(`${where}: unknown route key "${k}"`);
  if (typeof r.intent !== "string" || r.intent.trim().length < 3 || r.intent.length > 120)
    throw new Error(`${where}: a route's intent is a short phrase ("add an employee")`);
  if (seen.has(r.intent)) throw new Error(`${where}: route intent "${r.intent}" declared twice`);
  seen.add(r.intent);
  const [module, tab, extra] = String(r.screen || "").split(".");
  if (extra !== undefined || !routeMap.SCREENS[module] || !routeMap.SCREENS[module].includes(tab)) {
    throw new Error(
      `${where}: route "${r.intent}" names screen "${r.screen}", which is not "<module>.<tab>" in shared/route-map SCREENS`,
    );
  }
  if (r.params !== undefined) {
    if (!r.params || typeof r.params !== "object" || Object.values(r.params).some((v) => typeof v !== "string"))
      throw new Error(`${where}: route "${r.intent}" params are { name: "value" } strings`);
  }
  if (r.prefill !== undefined && (!r.prefill || !isContractSchema(r.prefill)))
    throw new Error(`${where}: route "${r.intent}" prefill is a schema exported from packages/contract`);
  if (r.prefill !== undefined) checkPrefill(where, r);
  return Object.freeze({
    ...r,
    module,
    tab,
    path: routeMap.screenPath(module, tab, { params: r.params || {} }),
  });
}

function checkNotOffered(where, v) {
  if (v === undefined) return Object.freeze({});
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${where}: not_offered is { SchemaName: "reason" }`);
  for (const [name, reason] of Object.entries(v)) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`${where}: not_offered names a contract schema, not "${name}"`);
    if (typeof reason !== "string" || reason.trim().length < 5) throw new Error(`${where}: not_offered ${name} needs a reason`);
  }
  return Object.freeze({ ...v });
}

/**
 * Declare a module's AI surface. Throws on anything malformed, and on any write by another name.
 * @param {{module: string, reads?: object[], summaries?: object[], actions?: object[], routes?: object[], not_offered?: object}} spec
 */
function defineManifest(spec) {
  const where = `defineManifest(${spec && spec.module})`;
  if (!spec || typeof spec !== "object") throw new Error("defineManifest: give { module, reads, summaries, actions, routes }");
  for (const k of Object.keys(spec)) {
    if (WRITE_WORDS.has(k))
      throw new Error(`${where}: "${k}" is a write by another name. Declare an action the person confirms, or a route to the screen`);
    if (!TOP_KEYS.has(k)) throw new Error(`${where}: unknown key "${k}"`);
  }
  if (!catalog.isModule(spec.module)) throw new Error(`${where}: module is a permission key (shared/access/access.catalog.js)`);
  for (const k of ["reads", "summaries", "actions", "routes"])
    if (spec[k] !== undefined && !Array.isArray(spec[k])) throw new Error(`${where}: ${k} is an array`);
  const seenKeys = new Set();
  const seenRoutes = new Set();
  return Object.freeze({
    [MANIFEST]: true,
    module: spec.module,
    reads: Object.freeze((spec.reads || []).map((r) => checkRead(where, r, seenKeys))),
    summaries: Object.freeze((spec.summaries || []).map((s) => checkSummary(where, s, seenKeys))),
    actions: Object.freeze((spec.actions || []).map((a) => checkAction(where, a, seenKeys))),
    routes: Object.freeze((spec.routes || []).map((r) => checkRoute(where, r, seenRoutes))),
    not_offered: checkNotOffered(where, spec.not_offered),
  });
}

const isManifest = (v) => Boolean(v && v[MANIFEST] === true);

module.exports = {
  defineManifest,
  isManifest,
  isContractSchema,
  contractNameOf,
  shapeOf,
  WRITE_WORDS,
  RISKS,
  BULK_MAX,
  ACTION_GRANTS,
};
