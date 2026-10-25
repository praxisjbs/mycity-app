"use strict";
/**
 * What can be imported. Each importer is declared by the module that owns the records
 * (BACKEND_STRUCTURE §9.4), in `<module>.import.js`, and registered here:
 *
 *   defineImporter({
 *     key: "employees",
 *     label: "Employees",
 *     permission: ["people", "create"],
 *     capability: "performance.manage",            // optional: a capability it needs as well
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
 *   options        enum values: ["remote", ...] or [{ value, label, aliases }]; aliases are other
 *                  spellings a sheet uses ("WFH" for Remote), read but never offered
 *   ref            a reference field: what it points at ("department", "employee")
 *   pass           2: resolved after every row of pass 1 exists (a line manager who is
 *                  another row of the same file)
 *   createMissing  "confirm": an unknown value is listed as "will be created" and is only
 *                  created when the person ticks it at commit
 *   mask           a field key (shared/rbac/field-mask.js): hidden in previews and error
 *                  files from people masked from it
 *   max            a text field's longest value; 500 characters unless set
 *   clean          a text field's tidy-up, (text) => text, run before the value is compared or
 *                  written ("Mrs Ada OBI" → "Ada Obi")
 *   sequenceOf     a text field holding a number the numbering engine issues ("employee"): a
 *                  cell of digits shorter than the scheme's padding is padded, as a spreadsheet
 *                  drops the leading zeros of a number it reads as a number (19 → 00019)
 *   example, hint  shown on the template's Reference sheet
 *
 * Functions the importer supplies (every write goes through the module's SERVICE, so
 * numbering, audit, events and rules apply as on screen):
 *   find(client, { key, value })               existing record by one match key → { id, values } | null
 *   resolve(client, field, value, ctx)         a reference → id | null
 *   create(client, field, value, ctx)          create a missing referenced record → id   (createMissing)
 *   write(client, values, ctx)                 create or update one row → { id }; ctx.existing tells
 *                                              which. It may answer { id, action: "none" } when the
 *                                              module decided the row needed no write, and the batch
 *                                              then counts the row as unchanged
 *   link(client, id, refs, ctx)                pass 2: set the pass-2 references on a row's record;
 *                                              ctx.values holds the row's own cells. It may answer
 *                                              false when it wrote nothing, and a row that needed no
 *                                              write then stays unchanged
 *   archive(client, id, ctx)                   revert a create
 *   restore(client, id, before, ctx)           revert an update to its before-snapshot
 *   isReferenced(client, id, {batch})          optional: true refuses reverting a row it created
 *   alsoEntities                               optional: other entity types a row may write (a VACANT
 *                                              row's seat), read for "changed since" on revert
 *   extract(sheets)                            optional: a whole workbook as the business keeps it
 *                                              (sheets as readSheets gives them) → { rows, notes },
 *                                              each row keyed by field. Its rows are imported as one
 *                                              sheet headed by the field labels; notes are kept on
 *                                              the batch's stats. It throws an AppError for a
 *                                              workbook that is not the one it reads
 */
const catalog = require("../access/access.catalog");

const TYPES = new Set([
  "text",
  "int",
  "number",
  "money",
  "phone",
  "email",
  "enum",
  "date",
  "boolean",
  "reference",
]);
const REQUIRED_FNS = ["find", "write", "archive", "restore"];
const IMPORTERS = new Map();

function fail(key, msg) {
  throw new Error(`defineImporter(${key}): ${msg}`);
}

function checkField(key, f, seen) {
  if (!/^[a-z][a-z0-9_]*$/.test(String(f.key || "")))
    fail(key, `field key "${f.key}" is snake_case`);
  if (seen.has(f.key)) fail(key, `field "${f.key}" is declared twice`);
  seen.add(f.key);
  if (!f.label) fail(key, `field "${f.key}" needs a label`);
  const type = f.type || "text";
  if (!TYPES.has(type)) fail(key, `field "${f.key}" has type "${type}"`);
  if (type === "enum" && (!Array.isArray(f.options) || f.options.length === 0))
    fail(key, `enum field "${f.key}" needs options`);
  if (type === "reference" && !f.ref)
    fail(key, `reference field "${f.key}" needs ref`);
  if (f.max !== undefined && !(Number.isInteger(f.max) && f.max > 0))
    fail(key, `field "${f.key}": max is a whole number of characters`);
  if (f.pass !== undefined && ![1, 2].includes(f.pass))
    fail(key, `field "${f.key}": pass is 1 or 2`);
  if (f.pass === 2 && type !== "reference")
    fail(key, `field "${f.key}": only references resolve in pass 2`);
  if (f.createMissing && f.createMissing !== "confirm")
    fail(key, `field "${f.key}": createMissing is "confirm"`);
  if (f.createMissing && f.pass === 2)
    fail(
      key,
      `field "${f.key}": a pass-2 reference cannot create what it points at`,
    );
}

/** Normalised enum options: [{ value, label }]. */
function optionsOf(field) {
  return (field.options || []).map((o) =>
    typeof o === "string"
      ? { value: o, label: o }
      : { value: o.value, label: o.label || String(o.value) },
  );
}

/** Every spelling an enum cell may use for each value: its value, its label and its aliases. */
function spellingsOf(field) {
  return (field.options || []).map((o) =>
    typeof o === "string" ? { value: o, names: [o] } : { value: o.value, names: [o.value, o.label, ...(o.aliases || [])].filter(Boolean) },
  );
}

/**
 * Register an importer.
 * @param {object} spec  see the file header
 */
function defineImporter(spec) {
  const key = spec && spec.key;
  if (!/^[a-z][a-z0-9_]*$/.test(String(key || "")))
    throw new Error("defineImporter: key is snake_case");
  if (!spec.label) fail(key, "label is required");
  const [module, action] = spec.permission || [];
  if (!catalog.isModule(module) || !catalog.isAction(action))
    fail(key, "permission is [module, action]");
  if (spec.capability !== undefined && !catalog.CAPABILITY_CATALOG.some((c) => c.code === spec.capability))
    fail(key, `capability "${spec.capability}" is not in the catalogue`);
  if (!/^[a-z][a-z0-9_]*$/.test(String(spec.entity || "")))
    fail(key, "entity is the snake_case entity type it writes");
  if (!spec.schema || typeof spec.schema.safeParse !== "function")
    fail(key, "schema is a Zod schema from packages/contract");
  if (!Array.isArray(spec.fields) || spec.fields.length === 0)
    fail(key, "fields are required");
  const seen = new Set();
  spec.fields.forEach((f) => checkField(key, f, seen));
  if (
    !Array.isArray(spec.matchKeys) ||
    spec.matchKeys.some((k) => !seen.has(k))
  )
    fail(key, "matchKeys must be field keys");
  for (const fn of REQUIRED_FNS)
    if (typeof spec[fn] !== "function") fail(key, `${fn}() is required`);
  const refs = spec.fields.filter((f) => f.type === "reference");
  if (refs.length && typeof spec.resolve !== "function")
    fail(key, "resolve() is required for reference fields");
  if (refs.some((f) => f.pass === 2) && typeof spec.link !== "function")
    fail(key, "link() is required for pass-2 references");
  if (refs.some((f) => f.createMissing) && typeof spec.create !== "function")
    fail(key, "create() is required for createMissing fields");
  if (spec.extract !== undefined && typeof spec.extract !== "function")
    fail(key, "extract is a function of the workbook's sheets");
  if (IMPORTERS.has(key) && IMPORTERS.get(key) !== spec)
    fail(key, "already registered");
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
  let held = null;
  const out = [];
  for (const imp of all()) {
    const [module, action] = imp.permission;
    const rows = await grants.getGrants(client, {
      role_ids: (user && user.role_ids) || [],
      module,
    });
    if (!scopeFromGrants(rows, action)) continue;
    if (imp.capability) {
      held = held || (user && user.user_id ? await grants.getCapabilities(client, user.user_id) : []);
      if (!held.includes(imp.capability)) continue;
    }
    out.push(imp);
  }
  return out;
}

/** Tests only. */
function __reset() {
  IMPORTERS.clear();
}

module.exports = {
  spellingsOf,
  TYPES,
  defineImporter,
  get,
  all,
  availableTo,
  optionsOf,
  __reset,
};
