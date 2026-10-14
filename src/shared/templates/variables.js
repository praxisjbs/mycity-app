"use strict";
/**
 * What a template may say, declared. Every template has a variable schema, a Zod
 * object from packages/contract (BACKEND_STRUCTURE §5.5), registered here by the
 * module that owns the template:
 *
 *   // modules/queries/queries.events.js (or the module's templates file)
 *   defineVariables("document", "query-letter", c.queries.QueryLetterVars);
 *
 * Two checks follow from it:
 *  - a template (shipped or edited in Settings) may only name declared variables, so
 *    a typo in an edit is refused when it is saved, not discovered on a printed letter;
 *  - the data handed to a render is parsed with the schema first, so a missing value
 *    fails BEFORE a number is allocated or anything is stored.
 *
 * Every template can also read the built-ins: `org` (the organisation's name and
 * contacts), `number`, `today`, `doc` (its title), `staging` (true on staging, for the
 * marker), and in mail `recipient` and `subject`.
 */
const { AppError } = require("../errors");
const { parse, variablesOf } = require("../documents/render");

const BUILT_INS = new Set(["org", "number", "today", "staging", "recipient", "doc", "subject"]);
const KINDS = new Set(["document", "email"]);

/** "kind:key" → Zod object schema */
const REGISTRY = new Map();

/**
 * @param {"document"|"email"} kind
 * @param {string} key  the template's key (its file name without .html)
 * @param {import("zod").ZodObject} schema
 */
function defineVariables(kind, key, schema) {
  if (!KINDS.has(kind)) throw new Error(`defineVariables: kind is document or email (got "${kind}")`);
  if (!schema || typeof schema.safeParse !== "function" || !schema.shape) throw new Error(`defineVariables(${kind}:${key}): give a Zod object schema`);
  const id = `${kind}:${key}`;
  if (REGISTRY.has(id) && REGISTRY.get(id) !== schema) throw new Error(`defineVariables: ${id} is already declared`);
  REGISTRY.set(id, schema);
}

function schemaOf(kind, key) {
  return REGISTRY.get(`${kind}:${key}`) || null;
}

/** Top-level names a Zod object declares, recursing through optional/nullable wrappers. */
function shapeOf(schema) {
  let s = schema;
  while (s && s._def && !s.shape && (s._def.innerType || s._def.schema)) s = s._def.innerType || s._def.schema;
  return (s && s.shape) || {};
}

/**
 * Names a template reads that its schema does not declare. Checks the root of each
 * path; inside {{#each}} names are the items' own and are not checked.
 * @param {string} source
 * @param {import("zod").ZodObject|null} schema
 * @returns {string[]}
 */
function undeclared(source, schema) {
  const declared = new Set([...Object.keys(shapeOf(schema)), ...BUILT_INS]);
  const used = [...variablesOf(parse(source))].filter((p) => !p.startsWith("~"));
  return [...new Set(used.map((p) => p.split(".")[0]))].filter((root) => !declared.has(root)).sort();
}

/** Refuse a template that names an undeclared variable (422 for a Settings edit). */
function assertTemplate(kind, key, source) {
  const schema = schemaOf(kind, key);
  if (!schema) throw new Error(`template ${kind}:${key} has no declared variables; call defineVariables()`);
  const bad = undeclared(source, schema);
  if (bad.length) {
    throw new AppError("TEMPLATE_UNKNOWN_VARIABLE", `This template uses ${bad.map((b) => `"${b}"`).join(", ")}, which it cannot fill.`, 422, {
      body: bad.map((b) => `${b} is not a variable of this template`),
    });
  }
}

/**
 * Parse render data with the template's schema. Throws a 422 naming every problem.
 * @returns {object} the parsed data (defaults applied, strings trimmed)
 */
function parseData(kind, key, data) {
  const schema = schemaOf(kind, key);
  if (!schema) throw new Error(`template ${kind}:${key} has no declared variables; call defineVariables()`);
  const parsed = schema.safeParse(data || {});
  if (parsed.success) return parsed.data;
  const fields = {};
  for (const issue of parsed.error.issues) {
    const k = issue.path.join(".") || "(data)";
    (fields[k] = fields[k] || []).push(issue.message);
  }
  throw new AppError("TEMPLATE_DATA_INVALID", `This ${kind === "email" ? "message" : "document"} cannot be produced: ${Object.keys(fields).join(", ")} missing or wrong.`, 422, fields);
}

module.exports = { BUILT_INS, defineVariables, schemaOf, undeclared, assertTemplate, parseData };
