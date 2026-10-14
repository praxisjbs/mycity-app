"use strict";
/**
 * What can be imported. Each importer is declared by the module that owns the records
 * (BACKEND_STRUCTURE §9.4), in `<module>.import.js`, and registered here:
 *
 *   defineImporter({
 *     key: "employees",
 *     label: "Employees",
 *     permission: ["people", "create"],
 *     entity: "employee",                          // entity_type of the records it writes
 *     schema: c.organisation.EmployeeImportRow,    // the same field rules as POST /employees
 *     matchKeys: ["staff_number", "work_email"],
 *     fields: [ { key, label, aliases, required, type, options, ref, by, pass, createMissing, mask } ],
 *     find, resolve, create, write, link, archive, restore,   // see below
 *   });
 *
 * Field options:
 *   type           text (default), int, number, money, phone, email, enum, date, boolean, reference
 *   required       the cell must have a value
 *   aliases        other header spellings ("staff no", "employee id")
 *   options        enum values: ["remote", ...] or [{ value, label }]
 *   ref            a reference field: what it points at ("department", "employee")
 *   pass           2: resolved after every row of pass 1 exists (a line manager who is
 *                  another row of the same file)
 *   createMissing  "confirm": an unknown value is listed as "will be created" and is only
 *                  created when the person ticks it at commit
 *   mask           a field key (shared/rbac/field-mask.js): hidden in previews and error
 *                  files from people masked from it
 *   example, hint  shown on the template's Reference sheet
 *
 * Functions the importer supplies (every write goes through the module's SERVICE, so
 * numbering, audit, events and rules apply as on screen):
 *   find(client, { key, value })               existing record by one match key → { id, values } | null
 *   resolve(client, field, value, ctx)         a reference → id | null
 *   create(client, field, value, ctx)          create a missing referenced record → id   (createMissing)
 *   write(client, values, ctx)                 create or update one row → { id }; ctx.existing tells which
 *   link(client, id, refs, ctx)                pass 2: set the pass-2 references on a row's record
 *   archive(client, id, ctx)                   revert a create
 *   restore(client, id, before, ctx)           revert an update to its before-snapshot
 *   isReferenced(client, id)                   optional: true refuses reverting that row
 */
const catalog = require("../access/access.catalog");

const TYPES = new Set(["text", "int", "number", "money", "phone", "email", "enum", "date", "boolean", "reference"]);
const REQUIRED_FNS = ["find", "write", "archive", "restore"];
const IMPORTERS = new Map();

function fail(key, msg) {
  throw new Error(`defineImporter(${key}): ${msg}`);
}

function checkField(key, f, seen) {
  if (!/^[a-z][a-z0-9_]*$/.test(String(f.key || ""))) fail(key, `field key "${f.key}" is snake_case`);
  if (seen.has(f.key)) fail(key, `field "${f.key}" is declared twice`);
  seen.add(f.key);
  if (!f.label) fail(key, `field "${f.key}" needs a label`);
  const type = f.type || "text";
  if (!TYPES.has(type)) fail(key, `field "${f.key}" has type "${type}"`);
  if (type === "enum" && (!Array.isArray(f.options) || f.options.length === 0)) fail(key, `enum field "${f.key}" needs options`);
  if (type === "reference" && !f.ref) fail(key, `reference field "${f.key}" needs ref`);
  if (f.pass !== undefined && ![1, 2].includes(f.pass)) fail(key, `field "${f.key}": pass is 1 or 2`);
  if (f.pass === 2 && type !== "reference") fail(key, `field "${f.key}": only references resolve in pass 2`);
  if (f.createMissing && f.createMissing !== "confirm") fail(key, `field "${f.key}": createMissing is "confirm"`);
  if (f.createMissing && f.pass === 2) fail(key, `field "${f.key}": a pass-2 reference cannot create what it points at`);
}

/** Normalised enum options: [{ value, label }]. */
function optionsOf(field) {
  return (field.options || []).map((o) => (typeof o === "string" ? { value: o, label: o } : { value: o.value, label: o.label || String(o.value) }));
}

/**
 * Register an importer.
 * @param {object} spec  see the file header
 */
function defineImporter(spec) {
  const key = spec && spec.key;
  if (!/^[a-z][a-z0-9_]*$/.test(String(key || ""))) throw new Error("defineImporter: key is snake_case");
  if (!spec.label) fail(key, "label is required");
  const [module, action] = spec.permission || [];
  if (!catalog.isModule(module) || !catalog.isAction(action)) fail(key, "permission is [module, action]");
  if (!/^[a-z][a-z0-9_]*$/.test(String(spec.entity || ""))) fail(key, "entity is the snake_case entity type it writes");
  if (!spec.schema || typeof spec.schema.safeParse !== "function") fail(key, "schema is a Zod schema from packages/contract");
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) fail(key, "fields are required");
  const seen = new Set();
  spec.fields.forEach((f) => checkField(key, f, seen));
  if (!Array.isArray(spec.matchKeys) || spec.matchKeys.some((k) => !seen.has(k))) fail(key, "matchKeys must be field keys");
  for (const fn of REQUIRED_FNS) if (typeof spec[fn] !== "function") fail(key, `${fn}() is required`);
  const refs = spec.fields.filter((f) => f.type === "reference");
  if (refs.length && typeof spec.resolve !== "function") fail(key, "resolve() is required for reference fields");
  if (refs.some((f) => f.pass === 2) && typeof spec.link !== "function") fail(key, "link() is required for pass-2 references");
  if (refs.some((f) => f.createMissing) && typeof spec.create !== "function") fail(key, "create() is required for createMissing fields");
  if (IMPORTERS.has(key) && IMPORTERS.get(key) !== spec) fail(key, "already registered");
  IMPORTERS.set(key, Object.freeze({ options: {}, ...spec }));
}

/** The importer, or a 404-worthy null. */
function get(key) {
  return IMPORTERS.get(key) || null;
}

function all() {
  return [...IMPORTERS.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The importers this user may run (the "what can I import" list).
 * @param {{query: Function}} client
 * @param {object} user  req.user
 */
async function availableTo(client, user) {
  if (user && user.is_ceo === true) return all();
  const grants = require("../rbac/grants-cache");
  const { scopeFromGrants } = require("../../middleware/rbac");
  const out = [];
  for (const imp of all()) {
    const [module, action] = imp.permission;
    const rows = await grants.getGrants(client, { role_ids: (user && user.role_ids) || [], module });
    if (scopeFromGrants(rows, action)) out.push(imp);
  }
  return out;
}

/** Tests only. */
function __reset() {
  IMPORTERS.clear();
}

module.exports = { TYPES, defineImporter, get, all, availableTo, optionsOf, __reset };
