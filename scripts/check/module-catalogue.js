#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: the module catalogue equals the permission keys the code enforces
 * (SYSTEM_ARCHITECTURE §8, MILESTONES M9 definition of done).
 *
 * src/shared/access/access.catalog.js is the single list of permission keys: the Roles &
 * Permissions screen offers exactly those modules. A route that names a key the
 * catalogue lacks is a grant nobody can give (middleware/rbac.js also refuses it at
 * boot; this finds it before boot). A catalogue key no route enforces is a tick box on
 * the Roles screen that controls nothing.
 *
 * The enforced keys are read from src/ (tests excluded):
 *   requirePermission("people", "view")
 *   requireAnyPermission([["people", "view"], ["payroll", "view"]])
 *   mountResource(router, { module: "people", ... })
 *
 * Fails the build on:
 *  1. a key or an action that is not in the catalogue;
 *  2. a key that is not a string literal (the gate, and a reviewer, must see it), outside
 *     the two files that define these helpers;
 *  3. with --exact: a catalogue key that no route enforces. The modules land milestone by
 *     milestone, so until M9 this is listed as a note; the CI entry adds --exact at M9.
 *
 * Usage: node scripts/check/module-catalogue.js [--exact]   exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { mask, argsAt, walk, relTo } = require("./lib/source");

const ROOT = path.resolve(__dirname, "..", "..");

/** The files that define the helpers and pass a key through as a variable. */
const DEFINITIONS = new Set([
  "src/middleware/rbac.js",
  "src/shared/crud/resource.js",
]);

const LITERAL = /^\s*(["'`])([^"'`$]*)\1\s*$/;

/**
 * The permission checks one file declares.
 * @param {string} source
 * @returns {{uses: Array<{key: string, action: string|null, line: number}>, dynamic: number[]}}
 */
function usesIn(source) {
  const m = mask(source);
  const uses = [];
  const dynamic = [];
  const split = (args) => {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of args) {
      if ("([{".includes(ch)) depth += 1;
      if (")]}".includes(ch)) depth -= 1;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
  };
  const lit = (s) => {
    const x = LITERAL.exec(s || "");
    return x ? x[2] : null;
  };

  for (const x of m.bare.matchAll(/\brequirePermission\s*\(/g)) {
    const args = split(argsAt(m.code, x.index + x[0].length - 1));
    const line = m.lineOf(x.index);
    const key = lit(args[0]);
    const action = lit(args[1]);
    if (key === null || action === null) dynamic.push(line);
    else uses.push({ key, action, line });
  }
  for (const x of m.bare.matchAll(/\brequireAnyPermission\s*\(/g)) {
    const args = argsAt(m.code, x.index + x[0].length - 1);
    const line = m.lineOf(x.index);
    const pairs = [
      ...args.matchAll(
        /\[\s*(["'`])([^"'`]*)\1\s*,\s*(["'`])([^"'`]*)\3\s*\]/g,
      ),
    ];
    if (!pairs.length) dynamic.push(line);
    for (const p of pairs) uses.push({ key: p[2], action: p[4], line });
  }
  for (const x of m.bare.matchAll(/\bmountResource\s*\(/g)) {
    const args = argsAt(m.code, x.index + x[0].length - 1);
    const line = m.lineOf(x.index);
    const k = /\bmodule\s*:\s*(["'`])([^"'`$]*)\1/.exec(args);
    if (k) uses.push({ key: k[2], action: null, line });
    else dynamic.push(line);
  }
  return { uses, dynamic };
}

/**
 * @param {{root?: string, exact?: boolean, catalog?: {MODULES: string[], ACTIONS: string[]}}} [opts]
 * @returns {{problems: string[], notes: string[], count: number, enforced: string[]}}
 */
function check({ root = ROOT, exact = false, catalog } = {}) {
  const cat =
    catalog ||
    require(path.join(root, "src", "shared", "access", "access.catalog.js"));
  const keys = new Set(cat.MODULES);
  const actions = new Set(cat.ACTIONS);
  const problems = [];
  const notes = [];
  const enforced = new Map();
  const files = walk(
    path.join(root, "src"),
    (n) => /\.js$/.test(n) && !/\.test\.js$/.test(n),
  );
  for (const f of files) {
    const rel = relTo(root, f);
    const { uses, dynamic } = usesIn(fs.readFileSync(f, "utf8"));
    if (!DEFINITIONS.has(rel)) {
      for (const line of dynamic)
        problems.push(
          `${rel}:${line} names its permission through a variable; write the key and action as string literals`,
        );
    }
    for (const u of uses) {
      if (!keys.has(u.key)) {
        problems.push(
          `${rel}:${u.line} "${u.key}" is not a module in shared/access/access.catalog.js`,
        );
        continue;
      }
      if (u.action !== null && !actions.has(u.action))
        problems.push(
          `${rel}:${u.line} "${u.action}" is not an action (${[...actions].join(", ")})`,
        );
      if (!enforced.has(u.key)) enforced.set(u.key, []);
      enforced.get(u.key).push(`${rel}:${u.line}`);
    }
  }
  const idle = cat.MODULES.filter((k) => !enforced.has(k));
  if (idle.length) {
    const msg = `catalogue keys no route enforces yet: ${idle.join(", ")}`;
    if (exact) problems.push(msg);
    else notes.push(msg);
  }
  return {
    problems,
    notes,
    count: files.length,
    enforced: [...enforced.keys()].sort(),
  };
}

if (require.main === module) {
  const exact = process.argv.includes("--exact");
  const { problems, notes, enforced } = check({ exact });
  for (const n of notes) console.log(`  note: ${n}`);
  if (!problems.length) {
    console.log(
      `module-catalogue: ok (${enforced.length} catalogue key${enforced.length === 1 ? "" : "s"} enforced, none outside the catalogue${exact ? ", every key enforced" : ""})`,
    );
    process.exit(0);
  }
  console.error(
    "module-catalogue: the catalogue and the enforced permission keys must agree\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, usesIn };
