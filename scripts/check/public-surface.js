#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: public routes import no staff auth (README §7 rule 9).
 *
 * A `<module>.public.routes.js` file, and every file inside its own module that
 * it requires (followed transitively), must not require middleware/auth or
 * middleware/rbac. A public route is reached by a token or a slug; if staff auth
 * code is in its import graph, someone will one day "just add" a check that
 * makes a candidate's link depend on a staff session.
 *
 * Files outside the module (shared/, services/, http/route.js) are not followed:
 * they are shared by both surfaces and are covered by their own rules. http/route.js
 * loads auth only for staff routes, when they are defined.
 *
 * Usage: node scripts/check/public-surface.js     exit 0 ok, 1 on a violation
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const MODULES = path.join(ROOT, "src", "modules");
const FORBIDDEN = /require\(\s*["'][./]*(?:\.\.\/)*middleware\/(auth|rbac)(?:\.js)?["']\s*\)/;
const LOCAL_REQUIRE = /require\(\s*["'](\.\/[^"']+)["']\s*\)/g;

const problems = [];
let checked = 0;

function follow(file, moduleDir, seen) {
  if (seen.has(file) || !fs.existsSync(file)) return;
  seen.add(file);
  checked += 1;
  const src = fs.readFileSync(file, "utf8");
  src.split(/\r?\n/).forEach((line, i) => {
    const m = FORBIDDEN.exec(line.replace(/\/\/.*$/, ""));
    if (m) problems.push(`${path.relative(ROOT, file)}:${i + 1}  requires middleware/${m[1]}`);
  });
  for (const m of src.matchAll(LOCAL_REQUIRE)) {
    let next = path.resolve(path.dirname(file), m[1]);
    if (!next.endsWith(".js")) next += ".js";
    if (next.startsWith(moduleDir + path.sep)) follow(next, moduleDir, seen);
  }
}

if (fs.existsSync(MODULES)) {
  for (const entry of fs.readdirSync(MODULES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(MODULES, entry.name);
    const file = path.join(dir, `${entry.name}.public.routes.js`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) follow(file, dir, new Set());
  }
}

if (problems.length) {
  console.error(`public-surface: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nPublic routes are reached by token or slug, never by a staff session. README §7 rule 9.");
  process.exit(1);
}
console.log(`public-surface: ok (${checked} public route file(s) and their local imports)`);
