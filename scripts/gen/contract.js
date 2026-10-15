#!/usr/bin/env node
"use strict";
/**
 * Generate packages/contract/contract.gen.ts: the frontend's only way to the API
 * (BACKEND_STRUCTURE §6).
 *
 *   npm run gen:contract                   write contract.gen.ts and contract.gen.meta.json
 *   node scripts/gen/contract.js --check   CI: exit 1 if either differs from what would be written
 *
 * What it does:
 *
 *  1. Loads every module the way the API does at boot, in describe mode (no database,
 *     no Redis; neither connects until used), strictly: a module that does not load is
 *     an error here too. http/route.js has recorded every route's contract.
 *  2. Names every Zod schema packages/contract exports (`domain.Name`) and refuses a
 *     key that is not snake_case anywhere inside one (§6.2: one casing on the wire).
 *  3. Writes, deterministically (same inputs, same bytes, on any machine):
 *       - a type for every exported schema whose name starts with a capital
 *         (`export type EmployeeCreate = z.infer<...>`); a name two domains share is
 *         prefixed with its domain (`OrganisationEmployee`);
 *       - `Endpoints`: "METHOD /path" → { body, query, params, response } for every route
 *         both surfaces mount; request parts are the schema's input type, the response its
 *         output type;
 *       - `schemas`: the runtime schemas, so a form validates with the rule the API uses.
 *     And contract.gen.meta.json: the hash of every input (schema files, routes files).
 *
 * contract.gen.ts is never edited by hand: --check regenerates and compares, so a hand
 * edit, or a schema or route changed without regenerating, fails CI.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const PKG = path.join(ROOT, "packages", "contract");
const OUT_TS = path.join(PKG, "contract.gen.ts");
const OUT_META = path.join(PKG, "contract.gen.meta.json");
const SNAKE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const lf = (t) => String(t).replace(/\r\n/g, "\n");
const sha = (t) =>
  crypto.createHash("sha256").update(lf(t), "utf8").digest("hex");
const pascal = (s) =>
  s
    .split(/[_-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
const isSchema = (v) =>
  Boolean(v) && typeof v.safeParse === "function" && v._def;

/* ------------------------------------------------------------------ *
 * Schemas
 * ------------------------------------------------------------------ */

/** Every object key inside a schema, with where it was found. Stops at a schema seen before. */
function keysOf(schema, where, out = [], seen = new Set()) {
  if (!isSchema(schema) || seen.has(schema)) return out;
  seen.add(schema);
  const def = schema._def;
  const walk = (s, w) => keysOf(s, w, out, seen);
  switch (def.typeName) {
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      for (const [k, v] of Object.entries(shape)) {
        out.push({ key: k, where: `${where}.${k}` });
        walk(v, `${where}.${k}`);
      }
      if (def.catchall) walk(def.catchall, `${where}[*]`);
      break;
    }
    case "ZodArray":
      walk(def.type, `${where}[]`);
      break;
    case "ZodEffects":
      walk(def.schema, where);
      break;
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
    case "ZodCatch":
    case "ZodReadonly":
      walk(def.innerType, where);
      break;
    case "ZodBranded":
      walk(def.type, where);
      break;
    case "ZodPipeline":
      walk(def.in, where);
      walk(def.out, where);
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      for (const o of def.options instanceof Map
        ? [...def.options.values()]
        : def.options)
        walk(o, where);
      break;
    case "ZodIntersection":
      walk(def.left, where);
      walk(def.right, where);
      break;
    case "ZodRecord":
      walk(def.valueType, `${where}[*]`);
      break;
    case "ZodTuple":
      def.items.forEach((s, i) => walk(s, `${where}[${i}]`));
      break;
    default:
      break;
  }
  return out;
}

/**
 * Every exported schema, named, with casing checked.
 * @param {object} contract  require("@mycity/contract")
 * @returns {{entries: Array<{domain: string, name: string, schema: object}>, problems: string[]}}
 */
function collectSchemas(contract) {
  const entries = [];
  const problems = [];
  for (const domain of Object.keys(contract).sort()) {
    for (const [name, value] of Object.entries(contract[domain] || {})) {
      if (!isSchema(value)) continue;
      entries.push({ domain, name, schema: value });
      for (const k of keysOf(value, `${domain}.${name}`)) {
        if (!SNAKE.test(k.key))
          problems.push(`${k.where}: "${k.key}" is not snake_case`);
      }
    }
  }
  return { entries, problems: [...new Set(problems)] };
}

/** Type alias name for each capitalised schema: bare, or domain-prefixed where two domains share it. */
function typeNames(entries) {
  const typed = entries.filter((e) => /^[A-Z]/.test(e.name));
  const count = new Map();
  for (const e of typed) count.set(e.name, (count.get(e.name) || 0) + 1);
  return typed.map((e) => ({
    ...e,
    type: count.get(e.name) > 1 ? `${pascal(e.domain)}${e.name}` : e.name,
  }));
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function pathParams(p) {
  return [...p.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
}

/**
 * The generated files, as strings.
 * @param {{contract: object, routes: Array<object>, inputs: Record<string, string>}} source
 *   inputs: repo-relative path → file text, for the source hash
 */
function render({ contract, routes, inputs }) {
  const { entries, problems } = collectSchemas(contract);
  if (problems.length) {
    const err = new Error(
      `Keys on the wire are snake_case (BACKEND_STRUCTURE §6.2):\n  ${problems.join("\n  ")}`,
    );
    err.problems = problems;
    throw err;
  }
  const ref = new Map(entries.map((e) => [e.schema, `${e.domain}.${e.name}`]));
  const named = (schema, where) => {
    const r = ref.get(schema);
    if (!r)
      throw new Error(
        `${where}: its schema is not exported from packages/contract`,
      );
    return r;
  };

  const inputHashes = Object.fromEntries(
    Object.keys(inputs)
      .sort()
      .map((k) => [k, sha(inputs[k])]),
  );
  const sourceHash = sha(JSON.stringify(inputHashes));
  const domains = [...new Set(entries.map((e) => e.domain))].sort();

  const lines = [];
  lines.push("// @generated by scripts/gen/contract.js. DO NOT EDIT.");
  lines.push(
    `// Source hash: ${sourceHash.slice(0, 16)}. Regenerate: npm run gen:contract`,
  );
  lines.push("/* eslint-disable */");
  lines.push('import type { z } from "zod";');
  for (const d of domains)
    lines.push(`import * as ${d} from "./schemas/${d}.js";`);
  lines.push("");
  lines.push(
    "/* Types of every exported schema (the value as the API returns it). */",
  );
  for (const e of typeNames(entries))
    lines.push(
      `export type ${e.type} = z.infer<typeof ${e.domain}.${e.name}>;`,
    );
  lines.push("");
  lines.push(
    "/* Every route both surfaces mount. Request parts are what the client sends (input types). */",
  );
  lines.push("export interface Endpoints {");
  const sorted = [...routes].sort((a, b) =>
    a.path === b.path
      ? a.method.localeCompare(b.method)
      : a.path.localeCompare(b.path),
  );
  for (const r of sorted) {
    const where = `${r.method} ${r.path}`;
    const c = r.contract || {};
    const body = c.body ? `z.input<typeof ${named(c.body, where)}>` : "never";
    const query = c.query
      ? `z.input<typeof ${named(c.query, where)}>`
      : "never";
    const ps = pathParams(r.path);
    const params = c.params
      ? `z.input<typeof ${named(c.params, where)}>`
      : ps.length
        ? `{ ${ps.map((p) => `${p}: string`).join("; ")} }`
        : "never";
    const response = c.no_content
      ? "null"
      : `z.output<typeof ${named(c.response, where)}>`;
    lines.push(
      `  ${JSON.stringify(where)}: { body: ${body}; query: ${query}; params: ${params}; response: ${response} };`,
    );
  }
  lines.push("}");
  lines.push("");
  lines.push("export type EndpointKey = keyof Endpoints;");
  lines.push("");
  lines.push(
    "/* The runtime schemas, for form validation with the same rules as the API. */",
  );
  lines.push(`export const schemas = { ${domains.join(", ")} } as const;`);
  lines.push("");

  const meta = {
    generator: "scripts/gen/contract.js",
    source_hash: sourceHash,
    schemas: entries.length,
    endpoints: routes.length,
    inputs: inputHashes,
  };
  return {
    ts: lines.join("\n"),
    meta: `${JSON.stringify(meta, null, 2)}\n`,
    schemas: entries.length,
    endpoints: routes.length,
  };
}

/* ------------------------------------------------------------------ *
 * Loading the real inputs
 * ------------------------------------------------------------------ */

function loadSources() {
  process.env.MYCITY_SKIP_DOTENV = "1";
  process.env.APP_ENV = process.env.APP_ENV || "test";
  process.env.LOG_LEVEL = "silent";
  const { buildApp } = require(path.join(ROOT, "src", "app"));
  const { report } = buildApp({ strict: true, accessLog: false });
  const contract = require(PKG);
  const { discover } = require(path.join(ROOT, "src", "http", "module-loader"));

  const inputs = {};
  const schemaDir = path.join(PKG, "schemas");
  for (const f of fs.readdirSync(schemaDir).sort()) {
    if (f.endsWith(".js"))
      inputs[rel(path.join(schemaDir, f))] = fs.readFileSync(
        path.join(schemaDir, f),
        "utf8",
      );
  }
  for (const found of discover())
    inputs[rel(found.file)] = fs.readFileSync(found.file, "utf8");
  return { contract, routes: report.routes, inputs };
}

function main(argv) {
  const known = new Set(["--check"]);
  for (const a of argv)
    if (!known.has(a)) throw new Error(`Unknown option ${a}`);
  const out = render(loadSources());

  if (argv.includes("--check")) {
    const stale = [];
    const current = (f) =>
      fs.existsSync(f) ? lf(fs.readFileSync(f, "utf8")) : "";
    if (current(OUT_TS) !== out.ts) stale.push(rel(OUT_TS));
    if (current(OUT_META) !== out.meta) stale.push(rel(OUT_META));
    if (stale.length) {
      console.error(
        `contract: ${stale.join(" and ")} ${stale.length > 1 ? "are" : "is"} not what the schemas and routes generate.`,
      );
      console.error(
        "Run npm run gen:contract and commit the result. Never edit contract.gen.ts by hand.",
      );
      return 1;
    }
    console.log(
      `contract: ok (${out.schemas} schemas, ${out.endpoints} endpoints, generated file current)`,
    );
    return 0;
  }
  fs.writeFileSync(OUT_TS, out.ts);
  fs.writeFileSync(OUT_META, out.meta);
  console.log(
    `contract: wrote ${rel(OUT_TS)} (${out.schemas} schemas, ${out.endpoints} endpoints)`,
  );
  return 0;
}

if (require.main === module) {
  let code = 1;
  try {
    code = main(process.argv.slice(2));
  } catch (err) {
    console.error(`contract: ${err.message}`);
  }
  process.exit(code);
}

module.exports = {
  collectSchemas,
  keysOf,
  typeNames,
  render,
  pathParams,
  main,
};
