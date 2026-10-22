"use strict";
/**
 * What the assistant may read in a module, and where it sends a person to change
 * something (BACKEND_STRUCTURE §14.3, MILESTONES A13 and A23). One per module, in
 * `src/modules/<module>/<module>.ai.js`, or `// ai:none <reason>` in the controller.
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
 *     routes: [{ intent: "add an employee", screen: "people.employees", params: { action: "new" } }],
 *   });
 *
 * The assistant reads, it never writes (A23). A manifest that declares anything like
 * a write (`write`, `writes`, `actions`, `executor` ...) is refused when it loads, and
 * gate 19 (scripts/check/ai-no-writes.js) fails the build. A change the person asks for
 * is a `route`: the screen where they make it themselves.
 *
 * Checked when the file loads, so a mistake fails at boot and in CI, not mid-answer:
 *  - module and the read's permission are module keys; a read needs `view`;
 *  - `params` and `prefill` are schemas exported from packages/contract (the same
 *    rules as the screen); a list read's params carry `page` (a listQuery), and
 *    authorise.js refuses a list that returns more than one page of 25;
 *  - keys are `<thing>.<verb>` and unique; descriptions are short, plain and have no
 *    em dash (the model reads them and so may a person);
 *  - a route names a real screen (shared/route-map SCREENS) as "<module>.<tab>";
 *  - a route's prefill is the form's own fields (packages/contract `<Thing>Prefill`), never a
 *    restricted field nor one of the address's own words (tab, id, action, new, its params).
 *
 * `run(client, params, actor)` receives the caller's own scope as `actor.scope`
 * ({ scope, scope_ids, employee_id }), so a read returns exactly what the same person
 * would see on the screen.
 */
const catalog = require("../access/access.catalog");
const routeMap = require("../route-map");

const MANIFEST = Symbol.for("mycity.ai.manifest");
const TOP_KEYS = new Set(["module", "reads", "routes"]);
const WRITE_WORDS = new Set([
  "write",
  "writes",
  "actions",
  "action",
  "executor",
  "execute",
  "executors",
  "mutations",
  "creates",
  "updates",
  "deletes",
]);
const READ_KEYS = new Set([
  "key",
  "description",
  "params",
  "permission",
  "run",
  "cite",
]);
const ROUTE_KEYS = new Set(["intent", "screen", "params", "prefill"]);
const READ_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

let contractSchemas = null;
function isContractSchema(schema) {
  if (!contractSchemas) {
    contractSchemas = new Set();
    for (const domain of Object.values(require("@mycity/contract"))) {
      for (const v of Object.values(domain || {}))
        if (v && typeof v.safeParse === "function") contractSchemas.add(v);
    }
  }
  return contractSchemas.has(schema);
}

function shapeOf(schema) {
  let s = schema;
  while (s && s._def && !s.shape && (s._def.schema || s._def.innerType))
    s = s._def.schema || s._def.innerType;
  return s && s.shape ? s.shape : null;
}

function checkRead(where, r, seen) {
  if (!r || typeof r !== "object")
    throw new Error(`${where}: each read is an object`);
  for (const k of Object.keys(r)) {
    if (WRITE_WORDS.has(k))
      throw new Error(
        `${where}: "${k}" in a read. The assistant reads, never writes (A23)`,
      );
    if (!READ_KEYS.has(k)) throw new Error(`${where}: unknown read key "${k}"`);
  }
  const at = `${where} read ${r.key}`;
  if (!READ_KEY_RE.test(String(r.key || "")))
    throw new Error(
      `${where}: read key "${r.key}" is <thing>.<verb>, snake_case`,
    );
  if (seen.has(r.key)) throw new Error(`${at}: declared twice`);
  seen.add(r.key);
  if (
    typeof r.description !== "string" ||
    r.description.trim().length < 10 ||
    r.description.length > 200
  ) {
    throw new Error(
      `${at}: description is a plain sentence of 10 to 200 characters`,
    );
  }
  if (r.description.includes("—"))
    throw new Error(`${at}: no em dashes in a description`);
  if (
    !r.params ||
    typeof r.params.safeParse !== "function" ||
    !isContractSchema(r.params)
  ) {
    throw new Error(
      `${at}: params is a schema exported from packages/contract`,
    );
  }
  const shape = shapeOf(r.params);
  if (!shape) throw new Error(`${at}: params is an object schema`);
  if (!Array.isArray(r.permission) || r.permission.length !== 2)
    throw new Error(`${at}: permission is [module, "view"]`);
  if (!catalog.isModule(r.permission[0]))
    throw new Error(`${at}: "${r.permission[0]}" is not a module key`);
  if (r.permission[1] !== "view")
    throw new Error(
      `${at}: a read needs the "view" grant, not "${r.permission[1]}"`,
    );
  if (typeof r.run !== "function")
    throw new Error(`${at}: run is (client, params, actor) => result`);
  if (typeof r.cite !== "function")
    throw new Error(`${at}: cite is (row) => { type, id, label? }`);
  return Object.freeze({
    ...r,
    list: Object.prototype.hasOwnProperty.call(shape, "page"),
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
  if (!shape)
    throw new Error(
      `${where}: route "${r.intent}" prefill is an object schema`,
    );
  const { FIELDS, maskedPropsFor } = require("../rbac/field-mask");
  const restricted = maskedPropsFor(Object.keys(FIELDS));
  for (const k of Object.keys(shape)) {
    if (ADDRESS_WORDS.has(k) || (r.params && k in r.params))
      throw new Error(
        `${where}: route "${r.intent}" prefill field "${k}" is a word the address already uses`,
      );
    if (restricted.has(k))
      throw new Error(
        `${where}: route "${r.intent}" prefill field "${k}" is restricted (shared/rbac/field-mask); an address is kept in the browser's history`,
      );
  }
}

function checkRoute(where, r, seen) {
  if (!r || typeof r !== "object")
    throw new Error(`${where}: each route is an object`);
  for (const k of Object.keys(r))
    if (!ROUTE_KEYS.has(k))
      throw new Error(`${where}: unknown route key "${k}"`);
  if (
    typeof r.intent !== "string" ||
    r.intent.trim().length < 3 ||
    r.intent.length > 120
  ) {
    throw new Error(
      `${where}: a route's intent is a short phrase ("add an employee")`,
    );
  }
  if (seen.has(r.intent))
    throw new Error(`${where}: route intent "${r.intent}" declared twice`);
  seen.add(r.intent);
  const [module, tab, extra] = String(r.screen || "").split(".");
  if (
    extra !== undefined ||
    !routeMap.SCREENS[module] ||
    !routeMap.SCREENS[module].includes(tab)
  ) {
    throw new Error(
      `${where}: route "${r.intent}" names screen "${r.screen}", which is not "<module>.<tab>" in shared/route-map SCREENS`,
    );
  }
  if (r.params !== undefined) {
    if (
      !r.params ||
      typeof r.params !== "object" ||
      Object.values(r.params).some((v) => typeof v !== "string")
    ) {
      throw new Error(
        `${where}: route "${r.intent}" params are { name: "value" } strings`,
      );
    }
  }
  if (r.prefill !== undefined && (!r.prefill || !isContractSchema(r.prefill))) {
    throw new Error(
      `${where}: route "${r.intent}" prefill is a schema exported from packages/contract`,
    );
  }
  if (r.prefill !== undefined) checkPrefill(where, r);
  return Object.freeze({
    ...r,
    module,
    tab,
    path: routeMap.screenPath(module, tab, { params: r.params || {} }),
  });
}

/**
 * Declare a module's AI surface. Throws on anything malformed, and on any write.
 * @param {{module: string, reads?: object[], routes?: object[]}} spec
 */
function defineManifest(spec) {
  const where = `defineManifest(${spec && spec.module})`;
  if (!spec || typeof spec !== "object")
    throw new Error("defineManifest: give { module, reads, routes }");
  for (const k of Object.keys(spec)) {
    if (WRITE_WORDS.has(k))
      throw new Error(
        `${where}: "${k}" is a write. The assistant reads, never writes (A23); add a route to the screen instead`,
      );
    if (!TOP_KEYS.has(k)) throw new Error(`${where}: unknown key "${k}"`);
  }
  if (!catalog.isModule(spec.module))
    throw new Error(
      `${where}: module is a permission key (shared/access/access.catalog.js)`,
    );
  if (spec.reads !== undefined && !Array.isArray(spec.reads))
    throw new Error(`${where}: reads is an array`);
  if (spec.routes !== undefined && !Array.isArray(spec.routes))
    throw new Error(`${where}: routes is an array`);
  const seenReads = new Set();
  const seenRoutes = new Set();
  return Object.freeze({
    [MANIFEST]: true,
    module: spec.module,
    reads: Object.freeze(
      (spec.reads || []).map((r) => checkRead(where, r, seenReads)),
    ),
    routes: Object.freeze(
      (spec.routes || []).map((r) => checkRoute(where, r, seenRoutes)),
    ),
  });
}

const isManifest = (v) => Boolean(v && v[MANIFEST] === true);

module.exports = { defineManifest, isManifest, isContractSchema, WRITE_WORDS };
