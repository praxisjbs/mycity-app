#!/usr/bin/env node
"use strict";
/**
 * Gate 6: contract keys are column names (BACKEND_STRUCTURE §6.2, docs/MIGRATIONS.md §7).
 *
 * One spelling everywhere: a repo row, an API payload, a contract type and a migration
 * column read the same. So every object schema a file in packages/contract/schemas
 * exports is declared in that file's TABLES export, one of:
 *
 *   EmployeeCreate: { table: "employee" }
 *       every key is a column of employee, as the migrations build it
 *   EmployeeCreate: { table: "employee", virtual: { department_name: "<why it is not a column>" } }
 *       a key that is deliberately not a column says why
 *   AdminBootstrap: { table: null, reason: "<why no table>", nested: { employee: { table: "employee" } } }
 *       not a row of any table (a list query, a script input, template variables); an
 *       object inside it that IS a row is checked as one
 *
 * Fails on: an exported object schema with no TABLES entry; a key that is not a column
 * and not declared virtual; a virtual key or nested key the schema does not have; a
 * reason left empty; a table no migration creates; a TABLES entry for a schema the file
 * does not export. The columns come from check/lib/catalogue.js, the same reading of
 * migrations/ that schema-drift.js uses.
 *
 * Usage: node scripts/check/contract-columns.js     exit 0 ok, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { buildCatalogue } = require("./lib/catalogue");

const ROOT = path.resolve(__dirname, "..", "..");
const SCHEMAS = path.join("packages", "contract", "schemas");

const isZod = (v) => Boolean(v) && typeof v.safeParse === "function" && Boolean(v._def);

/** The object schema under effects, defaults, optionals and nullables, or null. */
function objectOf(schema) {
  let s = schema;
  for (let i = 0; i < 10 && isZod(s); i += 1) {
    const def = s._def;
    if (def.typeName === "ZodObject") return s;
    if (def.typeName === "ZodEffects") s = def.schema;
    else if (["ZodOptional", "ZodNullable", "ZodDefault", "ZodCatch", "ZodReadonly", "ZodBranded"].includes(def.typeName))
      s = def.innerType || (def.type && def.type);
    else if (def.typeName === "ZodPipeline") s = def.in;
    else return null;
  }
  return null;
}

const keysOf = (obj) => Object.keys(obj.shape);
const blank = (v) => typeof v !== "string" || !v.trim();

/** Check one object against one declaration; `at` names it in messages. */
function checkObject(obj, decl, at, cat, problems) {
  if (!decl || typeof decl !== "object") {
    problems.push(`${at}: the declaration must be { table, virtual? } or { table: null, reason }`);
    return;
  }
  const keys = keysOf(obj);
  const virtual = decl.virtual || {};
  for (const [k, why] of Object.entries(virtual)) {
    if (!keys.includes(k)) problems.push(`${at}: virtual key "${k}" is not in the schema`);
    else if (blank(why)) problems.push(`${at}: virtual key "${k}" needs a reason`);
  }
  const nested = decl.nested || {};
  for (const [k, inner] of Object.entries(nested)) {
    const child = keys.includes(k) ? objectOf(obj.shape[k]) : null;
    if (!child) problems.push(`${at}: nested key "${k}" is not an object in the schema`);
    else checkObject(child, inner, `${at}.${k}`, cat, problems);
  }
  if (decl.table === null) {
    if (blank(decl.reason)) problems.push(`${at}: table: null needs a reason (what the schema is, if not a row)`);
    return;
  }
  if (typeof decl.table !== "string") {
    problems.push(`${at}: table must be a table name, or null with a reason`);
    return;
  }
  const columns = cat.tables.get(decl.table);
  if (!columns) {
    problems.push(`${at}: no migration creates table "${decl.table}"`);
    return;
  }
  if (cat.opaque.has(decl.table)) return;
  for (const k of keys) {
    if (k in virtual || k in nested || columns.has(k)) continue;
    problems.push(`${at}: "${k}" is not a column of ${decl.table}; add the column in a migration, rename the key, or declare it virtual with a reason`);
  }
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], schemas: number, files: number}}
 */
function check({ root = ROOT } = {}) {
  const cat = buildCatalogue({ root });
  const dir = path.join(root, SCHEMAS);
  const problems = [];
  let schemas = 0;
  let files = 0;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
    const file = path.join(dir, name);
    if (!fs.readFileSync(file, "utf8").trim()) continue;
    files += 1;
    const rel = path.posix.join(SCHEMAS.split(path.sep).join("/"), name);
    let mod;
    try {
      mod = require(file);
    } catch (err) {
      problems.push(`${rel}: does not load (${err.message.split("\n")[0]})`);
      continue;
    }
    const tables = mod.TABLES || {};
    const objects = Object.entries(mod).filter(([k, v]) => /^[A-Z]/.test(k) && k !== "TABLES" && objectOf(v));
    for (const [exportName, schema] of objects) {
      schemas += 1;
      if (!(exportName in tables)) {
        problems.push(`${rel}: ${exportName} has no TABLES entry: name its table, or table: null with a reason`);
        continue;
      }
      checkObject(objectOf(schema), tables[exportName], `${rel}: ${exportName}`, cat, problems);
    }
    for (const k of Object.keys(tables))
      if (!objects.some(([n]) => n === k)) problems.push(`${rel}: TABLES names ${k}, which the file does not export as an object schema`);
  }
  return { problems, schemas, files };
}

if (require.main === module) {
  const { problems, schemas, files } = check();
  if (problems.length) {
    console.error(`contract-columns: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  ${p}`);
    console.error("\nContract keys are column names (BACKEND_STRUCTURE §6.2). Declare each schema in its file's TABLES.");
    process.exit(1);
  }
  console.log(`contract-columns: ok (${schemas} object schemas in ${files} contract files, each key a column or declared)`);
}

module.exports = { check, checkObject, objectOf };
