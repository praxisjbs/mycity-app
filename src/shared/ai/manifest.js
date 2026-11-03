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
 *       fields: ["employee_id", "confirmed_on"],     // the input's fields the card carries, in order (all unless given)
 *       picks: { employee_id: "colleague" },          // what Edit picks an id field with (AiCardPicks)
 *       names: (values, actor, db) => service.cardNames(db, values),   // ids the fields hold, by name; never counted
 *       asks: [{ field: "confirmed_on", question: "From which day?", choices: ["Today"] }],   // asked before the card
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
 *    check, records, readback and names functions when given; its fields, picks and asks name
 *    fields its input takes (praxis-ai.md §1.3 decisions 29 and 31), each ask one short question;
 *    its capability, when given, one of the catalogue's (held on top of the grant, as a route's
 *    requireCapability holds it);
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
  "fields",
  "picks",
  "names",
  "asks",
  "resolve",
  "capability",
]);
const ROUTE_KEYS = new Set(["intent", "screen", "params", "prefill"]);
/** What an id field of a card is picked with on Edit (packages/contract AiCardPicks; praxis-ai.md decisions 31 and 32). */
const PICKS = new Set(["colleague", "task_assignee", "task_member", "department", "project", "leave_type", "task"]);
const ASK_KEYS = new Set(["field", "question", "choices", "options", "none", "when", "read", "params", "type"]);
/** The answers to tap under a question, at most (AiAnswer.choices). */
const CHOICES_MAX = 6;
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
  // A route that asks only view and a capability (Home's alert rules, reports): the capability is the authority.
  checkPermission(at, a.permission, a.capability !== undefined ? new Set([...ACTION_GRANTS, "view"]) : ACTION_GRANTS, "an action");
  // An authority held on top of the grant, as the screen's route holds it with requireCapability (praxis-ai.md §6.11).
  if (a.capability !== undefined && (typeof a.capability !== "string" || !catalog.isCapability(a.capability)))
    throw new Error(`${at}: capability is a code in shared/access/access.catalog.js CAPABILITY_CATALOG`);
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
  const shape = shapeOf(a.input);
  const takes = (k) => Object.prototype.hasOwnProperty.call(shape, k);
  if (a.labels !== undefined) {
    if (!a.labels || typeof a.labels !== "object" || Object.values(a.labels).some((v) => typeof v !== "string" || !v.trim()))
      throw new Error(`${at}: labels is { field: "Label" }`);
    for (const k of Object.keys(a.labels)) if (!takes(k)) throw new Error(`${at}: labels names "${k}", which input does not take`);
  }
  if (a.fields !== undefined) {
    if (!Array.isArray(a.fields) || !a.fields.length || new Set(a.fields).size !== a.fields.length)
      throw new Error(`${at}: fields lists the input's fields the card carries, each once`);
    for (const k of a.fields) if (typeof k !== "string" || !takes(k)) throw new Error(`${at}: fields names "${k}", which input does not take`);
  }
  const carried = (k) => !a.fields || a.fields.includes(k);
  if (a.picks !== undefined) {
    if (!a.picks || typeof a.picks !== "object" || Array.isArray(a.picks)) throw new Error(`${at}: picks is { field: "colleague" }`);
    for (const [k, v] of Object.entries(a.picks)) {
      if (!takes(k) || !carried(k)) throw new Error(`${at}: picks names "${k}", which the card does not carry`);
      if (!PICKS.has(v)) throw new Error(`${at}: picks.${k} is one of ${[...PICKS].join(", ")}`);
    }
  }
  if (a.names !== undefined && typeof a.names !== "function") throw new Error(`${at}: names is (values, actor, db) => [{ type, id, label }]`);
  // A field the model may write by name, matched to the person's own record on the server (decision 32).
  if (a.resolve !== undefined) {
    if (!a.resolve || typeof a.resolve !== "object" || Array.isArray(a.resolve)) throw new Error(`${at}: resolve is { field: (value, actor, db, values) => id }`);
    for (const [k, fn] of Object.entries(a.resolve)) {
      if (!takes(k) || !carried(k)) throw new Error(`${at}: resolve names "${k}", which the card does not carry`);
      if (typeof fn !== "function") throw new Error(`${at}: resolve.${k} is (value, actor, db, values) => id`);
    }
  }
  const asks = checkAsks(at, a.asks, takes, carried);
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
    fields: a.fields ? Object.freeze([...a.fields]) : null,
    picks: Object.freeze({ ...(a.picks || {}) }),
    names: a.names || null,
    asks,
    resolve: Object.freeze({ ...(a.resolve || {}) }),
    capability: a.capability || null,
  });
}

/**
 * What an action must have before its card is drawn (praxis-ai.md §1.3 decision 29, §1.6 decision
 * 34): each a field the card carries, the short question that asks for it, the answers to tap (a
 * list, or a function of `{ today }` for answers that move with the day; `options` read from the
 * person's own records; or `read`, a list read whose rows are the person's own records, with its
 * `params` and the citation `type` kept), whether "none" is an answer (`none`: null, or an empty
 * list, is then a value the person gave), and `when`, another field: asked only while it holds a
 * value. A read's key is checked against the registry once every manifest has loaded.
 */
function checkAsks(at, asks, takes, carried) {
  if (asks === undefined) return Object.freeze([]);
  if (!Array.isArray(asks)) throw new Error(`${at}: asks is [{ field, question, choices?, none? }]`);
  const seen = new Set();
  return Object.freeze(
    asks.map((q) => {
      if (!q || typeof q !== "object") throw new Error(`${at}: each ask is { field, question, choices?, none? }`);
      for (const k of Object.keys(q)) if (!ASK_KEYS.has(k)) throw new Error(`${at}: an ask takes no "${k}"`);
      if (!takes(q.field) || !carried(q.field)) throw new Error(`${at}: asks names "${q.field}", which the card does not carry`);
      if (seen.has(q.field)) throw new Error(`${at}: asks names "${q.field}" twice`);
      seen.add(q.field);
      const words = String(q.question || "").trim();
      if (!words.endsWith("?") || words.split(/\s+/).length > 8 || /[—–]/.test(words))
        throw new Error(`${at}: ask ${q.field}'s question is one short question, at most 8 words`);
      const fixed = Array.isArray(q.choices);
      if (q.choices !== undefined && !fixed && typeof q.choices !== "function")
        throw new Error(`${at}: ask ${q.field}'s choices are a list, or ({ today }) => a list`);
      if (fixed && (q.choices.length > CHOICES_MAX || q.choices.some((c) => typeof c !== "string" || !c.trim() || c.length > 60)))
        throw new Error(`${at}: ask ${q.field} offers at most ${CHOICES_MAX} short choices`);
      // Answers read from the person's own records (their leave types): filled by the service, never the engine (decision 32).
      if (q.options !== undefined && typeof q.options !== "function") throw new Error(`${at}: ask ${q.field}'s options are ({ actor, db, today, values }) => a list`);
      if (q.options !== undefined && q.choices !== undefined) throw new Error(`${at}: ask ${q.field} takes choices or options, not both`);
      if (q.none !== undefined && typeof q.none !== "boolean") throw new Error(`${at}: ask ${q.field}'s none is true or false`);
      // Asked only while another field holds a value: a field required in some states (praxis-ai.md decision 34).
      // `when` is a field ("department_id": while it holds a value) or { field, not: [values] } (while it holds another value).
      const whenField = q.when && typeof q.when === "object" ? q.when.field : q.when;
      if (q.when !== undefined && (typeof whenField !== "string" || whenField === q.field || !takes(whenField) || !carried(whenField)))
        throw new Error(`${at}: ask ${q.field}'s when names another field the card carries`);
      if (q.when && typeof q.when === "object" && (Object.keys(q.when).some((k) => k !== "field" && k !== "not") || !Array.isArray(q.when.not) || !q.when.not.length || q.when.not.some((v) => typeof v !== "string")))
        throw new Error(`${at}: ask ${q.field}'s when is a field, or { field, not: [values] }`);
      // A field naming a record: its answers are the person's own records from a list read, matched by their words.
      if (q.read !== undefined && (typeof q.read !== "string" || !KEY_RE.test(q.read))) throw new Error(`${at}: ask ${q.field}'s read is a read's key`);
      if (q.read !== undefined && (q.options !== undefined || q.choices !== undefined)) throw new Error(`${at}: ask ${q.field} takes read, options or choices, one of them`);
      if (q.params !== undefined && (q.read === undefined || !q.params || typeof q.params !== "object" || Array.isArray(q.params)))
        throw new Error(`${at}: ask ${q.field}'s params are the read's own, beside read`);
      if (q.type !== undefined && (q.read === undefined || typeof q.type !== "string" || !q.type)) throw new Error(`${at}: ask ${q.field}'s type is a citation's type, beside read`);
      return Object.freeze({
        field: q.field,
        question: words,
        choices: q.choices || [],
        options: q.options || null,
        none: q.none === true,
        when: q.when && typeof q.when === "object" ? Object.freeze({ field: q.when.field, not: Object.freeze([...q.when.not]) }) : q.when || null,
        read: q.read || null,
        params: Object.freeze({ ...(q.params || {}) }),
        type: q.type || null,
      });
    }),
  );
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
