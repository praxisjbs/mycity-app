#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: every document type the code numbers has a scheme.
 *
 * Fails when:
 *  - code calls numbering.allocate(client, "<type>") or preview(client, "<type>")
 *    for a type that is not in src/shared/numbering/schemes.js (it would fail at
 *    the first save in production with "No numbering scheme");
 *  - allocate() is called with a type that is not a string literal (the gate
 *    could not check it, and a computed type is how an unschemed one slips in).
 *    The resource kit (shared/crud/resource.js) and generated documents
 *    (shared/documents/generate.js) forward the type their caller configured, so
 *    there the gate checks the caller's `docType: "<type>"` / `numbering: "<type>"`;
 *  - a default scheme in schemes.js is itself invalid.
 *
 * The database side (a schemes.js type with no numbering_scheme row) is checked
 * at runtime by /api/health/ready.
 *
 * Usage: node scripts/check/numbering-schemes.js     exit 0 ok, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
const ROOT = path.resolve(__dirname, "..", "..");
const { SCHEMES, validateScheme } = require(
  path.join(ROOT, "src", "shared", "numbering", "schemes"),
);

const CALL =
  /\b(?:numbering\.)?(allocate|preview)\(\s*[A-Za-z_$][\w$]*\s*,\s*([^,)]+)/g;
const SELF = path.join("src", "shared", "numbering");
const DOC_TYPE = /\b(?:docType|numbering)\s*:\s*([^,{}\n]+)/g;
/** Files that forward a type their caller gave; the caller's docType is checked instead. */
const FORWARDERS = new Set([
  path.join("src", "shared", "crud", "resource.js"),
  path.join("src", "shared", "documents", "generate.js"),
]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const problems = [];
for (const [type, scheme] of Object.entries(SCHEMES)) {
  for (const p of validateScheme(scheme))
    problems.push(`schemes.js: ${type}: ${p}`);
}

let calls = 0;
for (const file of [
  ...walk(path.join(ROOT, "src")),
  ...walk(path.join(ROOT, "scripts")),
]) {
  const rel = path.relative(ROOT, file);
  if (rel.startsWith(SELF)) continue;
  const src = fs.readFileSync(file, "utf8");
  if (!/numbering/.test(src)) continue;
  src.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(code)) return;
    for (const m of code.matchAll(DOC_TYPE)) {
      if (FORWARDERS.has(rel) || m[1].trim() === "null") continue;
      calls += 1;
      const lit = /^["'`]([a-z_]+)["'`]$/.exec(m[1].trim());
      if (!lit)
        problems.push(
          `${rel}:${i + 1}  docType is computed (${m[1].trim()}); give the type as a string literal`,
        );
      else if (!SCHEMES[lit[1]])
        problems.push(
          `${rel}:${i + 1}  "${lit[1]}" has no scheme in src/shared/numbering/schemes.js`,
        );
    }
    for (const m of code.matchAll(CALL)) {
      if (FORWARDERS.has(rel)) continue;
      calls += 1;
      const arg = m[2].trim();
      const lit = /^["'`]([a-z_]+)["'`]$/.exec(arg);
      if (!lit)
        problems.push(
          `${rel}:${i + 1}  ${m[1]}() with a computed type (${arg}); pass the type as a string literal`,
        );
      else if (!SCHEMES[lit[1]])
        problems.push(
          `${rel}:${i + 1}  "${lit[1]}" has no scheme in src/shared/numbering/schemes.js`,
        );
    }
  });
}

if (problems.length) {
  console.error(`numbering-schemes: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nAdd the type to src/shared/numbering/schemes.js and to the seed migration. BACKEND_STRUCTURE §7.",
  );
  process.exit(1);
}
console.log(
  `numbering-schemes: ok (${Object.keys(SCHEMES).length} schemes, ${calls} allocation call(s))`,
);
