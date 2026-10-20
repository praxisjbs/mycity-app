#!/usr/bin/env node
"use strict";
/**
 * Gate 22, addresses are picked, never typed (FRONTEND_FOUNDATION F27, FRONTEND_GUIDE §8.9,
 * docs/guides/addresses.md §6.10). On hub and go, live and staging, every address a person
 * enters is a place our address search or a pin signed (or the device's location while search is
 * down), never free text. This refuses:
 *
 *   Contract half: every route the API mounts, loaded as at boot (no database needed)
 *   - a request body field named like an address (address, home_address, location, hq,
 *     headquarters, venue, city, cities, or ending _address or _location) that is not the
 *     contract's PlaceInput, or a list of them
 *   - a PlaceInput field whose name is no registered owner's column (src/shared/places/owners.js):
 *     a new address field is a new owner first
 *   - an owner whose module never registers how its readable line is rewritten
 *     (`places.owner(name, { rename })` in its `<module>.events.js`), which the naming job needs
 *
 *   Screen half: packages/ui/src, app/src and public-app/src
 *   - a <Field> labelled like an address (Address, Home Address, Location, Headquarters, Venue,
 *     City, Cities) whose control is not an AddressField or a PlacesField
 *   - a control bound to a form field named like an address ({...f.field("address")}) that is not
 *     an AddressField or a PlacesField
 *
 * A deliberate exception carries `address:none <reason>` on its line or the line above: beside
 * the key in the contract file, or beside the Field or control on the screen.
 *
 * Usage: node scripts/check/addresses.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { frontendFiles, read, lineOf } = require("./lib/sources");

const ROOT = path.resolve(__dirname, "..", "..");
const SCHEMAS = path.join(ROOT, "packages", "contract", "schemas");

/** A body field that holds an address, by its name. */
const ADDRESS_KEY = /^(address|home_address|location|hq|headquarters|venue|city|cities|\w+_address|\w+_location)$/;
/** A field label that asks for an address. */
const ADDRESS_LABEL = /\b(address|location|headquarters|venue|cities|city)\b/i;
/** Labels that say "address" and mean something else. */
const NOT_A_PLACE = /\b(e-?mail|web|ip|wallet)\s+address\b/i;
/** The two controls that pick an address. */
const PICKERS = new Set(["AddressField", "PlacesField"]);
const MARKER = /address:none\s+\S/;

/** Whether line `n` (1-based) of `src`, or the line above it, carries the exception marker. */
function marked(src, n) {
  const lines = src.split("\n");
  return MARKER.test(lines[n - 1] || "") || MARKER.test(lines[n - 2] || "");
}

/* ------------------------------------------------------------------ *
 * Contract half
 * ------------------------------------------------------------------ */

/** The schema under optional, nullable, default and plain effects; PlaceInput itself is kept whole. */
function unwrap(s, placeInput) {
  while (s && s._def) {
    if (s === placeInput) return s;
    const t = s._def.typeName;
    if (t === "ZodOptional" || t === "ZodNullable" || t === "ZodDefault") s = s._def.innerType;
    else if (t === "ZodEffects") s = s._def.schema;
    else break;
  }
  return s;
}

/** Whether a field's schema is a PlaceInput, or a list of them. */
function isPlace(s, placeInput) {
  const u = unwrap(s, placeInput);
  if (u === placeInput) return true;
  return !!u && u._def && u._def.typeName === "ZodArray" && unwrap(u._def.type, placeInput) === placeInput;
}

/**
 * Pure: every field named like an address in a body schema, with where it sits and whether it
 * is a PlaceInput. Walks objects, lists, unions and wrappers; stops inside a PlaceInput.
 * @returns {Array<{key: string, at: string, place: boolean}>}
 */
function addressFields(schema, placeInput, at = "body", out = [], seen = new Set()) {
  if (!schema || !schema._def || seen.has(schema) || schema === placeInput) return out;
  seen.add(schema);
  const d = schema._def;
  const walk = (s, w) => addressFields(s, placeInput, w, out, seen);
  switch (d.typeName) {
    case "ZodObject": {
      const shape = typeof d.shape === "function" ? d.shape() : d.shape;
      for (const [key, value] of Object.entries(shape)) {
        if (ADDRESS_KEY.test(key)) out.push({ key, at: `${at}.${key}`, place: isPlace(value, placeInput) });
        walk(value, `${at}.${key}`);
      }
      break;
    }
    case "ZodArray":
      walk(d.type, `${at}[]`);
      break;
    case "ZodEffects":
      walk(d.schema, at);
      break;
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      walk(d.innerType, at);
      break;
    case "ZodPipeline":
      walk(d.in, at);
      break;
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      for (const o of d.options instanceof Map ? [...d.options.values()] : d.options) walk(o, at);
      break;
    case "ZodIntersection":
      walk(d.left, at);
      walk(d.right, at);
      break;
    default:
      break;
  }
  return out;
}

/** Whether a contract file declares `key:` with the exception marker beside it. */
function exemptInContract(module, key) {
  const files = fs.readdirSync(SCHEMAS).filter((f) => f.endsWith(".js"));
  const ordered = [`${module}.js`, ...files.filter((f) => f !== `${module}.js`)].filter((f) => files.includes(f));
  const decl = new RegExp(`(^|[{,\\s])${key}\\s*:`);
  for (const f of ordered) {
    const src = fs.readFileSync(path.join(SCHEMAS, f), "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i += 1) if (decl.test(lines[i]) && marked(src, i + 1)) return true;
  }
  return false;
}

/** Every module's events file, as the worker loads them: where owners register their renames. */
function loadEventFiles() {
  const dir = path.join(ROOT, "src", "modules");
  for (const m of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const file = path.join(dir, m.name, `${m.name}.events.js`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) require(file);
  }
}

function contractProblems() {
  process.env.MYCITY_SKIP_DOTENV = "1";
  process.env.APP_ENV = process.env.APP_ENV || "test";
  process.env.LOG_LEVEL = "silent";
  const contract = require(path.join(ROOT, "packages", "contract"));
  const { buildApp } = require(path.join(ROOT, "src", "app"));
  const { report } = buildApp({ strict: true, accessLog: false });
  loadEventFiles();
  const owners = require(path.join(ROOT, "src", "shared", "places", "owners"));
  const placeInput = contract.maps.PlaceInput;
  const columns = new Set(owners.OWNERS.map((o) => o.name.slice(o.name.indexOf(".") + 1)));

  const problems = [];
  let places = 0;
  for (const r of report.routes) {
    if (!r.contract || !r.contract.body) continue;
    for (const f of addressFields(r.contract.body, placeInput)) {
      const where = `${r.method} ${r.path} ${f.at}`;
      if (!f.place) {
        if (!exemptInContract(r.module, f.key)) problems.push(`  ${where}: an address typed as text; make it the contract's PlaceInput (F27)`);
        continue;
      }
      places += 1;
      if (!columns.has(f.key)) problems.push(`  ${where}: a PlaceInput no owner keeps; register "<table>.${f.key}" in src/shared/places/owners.js`);
    }
  }
  for (const o of owners.OWNERS) {
    if (!owners.renameOf(o.name)) problems.push(`  ${o.name}: its module never registers places.owner("${o.name}", { rename }) in its events file`);
  }
  return { problems, places, owners: owners.OWNERS.length };
}

/* ------------------------------------------------------------------ *
 * Screen half
 * ------------------------------------------------------------------ */

/** The end of a JSX tag that starts at `from` (just after its name), minding braces and strings. */
function tagEnd(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) i += src[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (depth === 0 && c === ">") return i;
  }
  return src.length;
}

/**
 * Pure: the address fields on a screen whose control is not a picker, as [{ index, what }].
 * A Field labelled like an address must hold an AddressField or a PlacesField; a control bound to
 * a form field named like an address must be one. Exceptions marked `address:none` are skipped.
 */
function screenProblems(src) {
  const out = [];
  const fieldRe = /<Field\b/g;
  for (let m = fieldRe.exec(src); m; m = fieldRe.exec(src)) {
    const end = tagEnd(src, m.index + m[0].length);
    const tag = src.slice(m.index, end + 1);
    const label = /\blabel\s*=\s*(?:\{\s*)?(["'`])([^"'`]*)\1/.exec(tag);
    if (!label || !ADDRESS_LABEL.test(label[2]) || NOT_A_PLACE.test(label[2])) continue;
    if (tag.endsWith("/>")) continue;
    const close = src.indexOf("</Field>", end);
    const body = src.slice(end + 1, close === -1 ? src.length : close);
    const control = /<([A-Z][A-Za-z0-9]*)\b/.exec(body);
    if ([...PICKERS].some((p) => new RegExp(`<${p}\\b`).test(body))) continue;
    if (marked(src, lineOf(src, m.index))) continue;
    out.push({ index: m.index, what: `"${label[2]}" is a ${control ? control[1] : "field"}, not an AddressField or a PlacesField` });
  }
  const boundRe = /<([A-Z][A-Za-z0-9]*)\b/g;
  for (let m = boundRe.exec(src); m; m = boundRe.exec(src)) {
    const name = m[1];
    if (name === "Field" || PICKERS.has(name)) continue;
    const tag = src.slice(m.index, tagEnd(src, m.index + m[0].length) + 1);
    const bound = /\{\s*\.\.\.\s*\w+\.field\(\s*(["'`])([^"'`]+)\1/.exec(tag);
    if (!bound) continue;
    const key = bound[2].replace(/\$\{[^}]*\}/g, "n");
    if (!ADDRESS_KEY.test(key)) continue;
    if (marked(src, lineOf(src, m.index))) continue;
    out.push({ index: m.index, what: `${name} bound to "${bound[2]}", an address; use AddressField or PlacesField` });
  }
  return out.sort((a, b) => a.index - b.index);
}

function main() {
  const problems = [];
  const contract = contractProblems();
  problems.push(...contract.problems);
  const files = frontendFiles();
  for (const file of files) {
    const src = read(file);
    for (const p of screenProblems(src)) problems.push(`  ${file}:${lineOf(src, p.index)}: ${p.what}`);
  }
  if (problems.length) {
    console.error(`addresses: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(p);
    console.error(
      "\nEvery address a person enters is picked, never typed (gate 22; FRONTEND_FOUNDATION F27, docs/guides/addresses.md):\n" +
        "an AddressField (a PlacesField for cities) bound to the contract's PlaceInput, kept through shared/places by its\n" +
        "owner. A deliberate exception carries `address:none <reason>` on its line or the line above.",
    );
    process.exit(1);
  }
  console.log(`addresses: ok (${contract.places} address field(s) in request bodies, all PlaceInput; ${contract.owners} owner(s); ${files.length} frontend file(s))`);
  process.exit(0);
}

module.exports = { addressFields, screenProblems, ADDRESS_KEY, ADDRESS_LABEL };

if (require.main === module) main();
