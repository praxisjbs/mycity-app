#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: every capability is catalogued once and seeded (README §5.2,
 * BACKEND_GUIDE §5).
 *
 * A capability is an authority inside a module beyond its six actions ("home.team",
 * "alerts.clear"). It is declared once, in src/shared/access/access.catalog.js
 * CAPABILITY_CATALOG, and inserted into the `capability` table by its milestone's
 * reference seed. middleware/rbac.js refuses an uncatalogued code when a route is
 * defined; this finds it before boot, in the shell's and search's checks as well, and
 * finds what boot cannot: a catalogued code that no seed inserts. Settings · Roles &
 * Permissions offers only the rows of `capability`, so nobody could be given that code
 * and every route behind it would refuse everyone but the CEO.
 *
 * The checks are read from src/ and app/src/ (tests excluded):
 *   requireCapability("home.team")
 *   requireAnyCapability(["alerts.clear", "alerts.manage"])
 *   hasCapability(me, "home.reports")
 *
 * Fails the build on:
 *  1. a code those calls name that is not in the catalogue;
 *  2. a code given through a variable (the gate, and a reviewer, must see it);
 *  3. a catalogue entry whose code breaks the two-segment rule, whose module is not a
 *     module key, that has no label or description, or that is catalogued twice;
 *  4. a catalogued code that no seeds/reference/*.sql inserts into `capability`, and a
 *     code a seed inserts (and no later seed deletes) that is not catalogued;
 *  5. an INSERT INTO capability whose codes cannot be read: write its rows as VALUES.
 *
 * Usage: node scripts/check/capabilities.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { mask, argsAt, walk, relTo } = require("./lib/source");
const { parseMigration, byNumber } = require("../db/migrate");

const ROOT = path.resolve(__dirname, "..", "..");

/** The calls that name a capability, and which argument holds it. */
const CALLS = [
  { name: "requireCapability", arg: 0, list: false },
  { name: "requireAnyCapability", arg: 0, list: true },
  { name: "hasCapability", arg: 1, list: false },
];

const LITERAL = /^\s*(["'`])([^"'`$]*)\1\s*$/;

/** Top-level pieces of an argument list or an array literal's body. */
function split(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth += 1;
    if (")]}".includes(ch)) depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const lit = (s) => {
  const x = LITERAL.exec(s || "");
  return x ? x[2] : null;
};

/**
 * The capability codes one file checks.
 * @param {string} source
 * @returns {{uses: Array<{code: string, line: number}>, dynamic: number[]}}
 */
function usesIn(source) {
  const m = mask(source);
  const uses = [];
  const dynamic = [];
  for (const call of CALLS) {
    const re = new RegExp(`(?<!function\\s+)\\b${call.name}\\s*\\(`, "g");
    for (const x of m.bare.matchAll(re)) {
      const line = m.lineOf(x.index);
      const arg = split(argsAt(m.code, x.index + x[0].length - 1))[call.arg];
      if (!call.list) {
        const code = lit(arg);
        if (code === null) dynamic.push(line);
        else uses.push({ code, line });
        continue;
      }
      const body = /^\s*\[([\s\S]*)\]\s*$/.exec(arg || "");
      const items = body ? split(body[1]) : [];
      if (!items.length || items.some((i) => lit(i) === null))
        dynamic.push(line);
      for (const i of items) {
        const code = lit(i);
        if (code !== null) uses.push({ code, line });
      }
    }
  }
  return { uses, dynamic };
}

/**
 * A SQL text as statements, split on `;` outside quotes, with comments removed.
 * @param {string} sql
 * @returns {string[]}
 */
function statements(sql) {
  const out = [];
  let cur = "";
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      cur += "\n";
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) {
        j += sql[j] === "'" ? 2 : 1;
      }
      cur += sql.slice(i, j + 1);
      i = j;
      continue;
    }
    if (ch === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The rows of a VALUES list as arrays of field texts; stops at the first thing that is not a row. */
function rowsOf(values) {
  const rows = [];
  let i = 0;
  const skip = () => {
    while (i < values.length && /[\s,]/.test(values[i])) i += 1;
  };
  skip();
  while (values[i] === "(") {
    const fields = [];
    let cur = "";
    let depth = 0;
    for (i += 1; i < values.length; i += 1) {
      const ch = values[i];
      if (ch === "'") {
        let j = i + 1;
        while (j < values.length && !(values[j] === "'" && values[j + 1] !== "'"))
          j += values[j] === "'" ? 2 : 1;
        cur += values.slice(i, j + 1);
        i = j;
        continue;
      }
      if (ch === "(") depth += 1;
      if (ch === ")" && depth === 0) break;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        fields.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    fields.push(cur.trim());
    rows.push(fields);
    i += 1;
    skip();
  }
  return rows;
}

const sqlText = (field) => {
  const x = /^'((?:[^']|'')*)'$/.exec(field);
  return x ? x[1].replace(/''/g, "'") : null;
};

/**
 * What the reference seeds leave in `capability`, in the order they run: a code an
 * UP section inserts, less one a later UP section deletes.
 * @param {string} dir  seeds/reference
 * @param {string} root
 * @returns {{seeded: Map<string, string>, problems: string[]}}  code → the seed that inserts it
 */
function seededCodes(dir, root) {
  const seeded = new Map();
  const problems = [];
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^\d{4,5}_[a-z0-9_]+\.sql$/.test(f))
        .sort(byNumber)
    : [];
  for (const f of files) {
    const rel = relTo(root, path.join(dir, f));
    let up;
    try {
      ({ up } = parseMigration(fs.readFileSync(path.join(dir, f), "utf8"), rel));
    } catch (err) {
      problems.push(err.message);
      continue;
    }
    for (const st of statements(up)) {
      const ins = /^INSERT\s+INTO\s+capability\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i.exec(st);
      if (ins) {
        const at = ins[1].split(",").map((c) => c.trim().toLowerCase()).indexOf("code");
        const codes = at === -1 ? [] : rowsOf(ins[2]).map((r) => sqlText(r[at] || ""));
        if (!codes.length || codes.some((c) => c === null)) {
          problems.push(`${rel}: an INSERT INTO capability whose codes cannot be read; write each row's code as a literal in VALUES`);
        }
        for (const c of codes) if (c !== null) seeded.set(c, rel);
        continue;
      }
      if (/^INSERT\s+INTO\s+capability\b/i.test(st)) {
        problems.push(`${rel}: an INSERT INTO capability whose codes cannot be read; write each row's code as a literal in VALUES`);
        continue;
      }
      if (/^DELETE\s+FROM\s+capability\b/i.test(st)) {
        for (const x of st.matchAll(/'((?:[^']|'')*)'/g)) seeded.delete(x[1]);
      }
    }
  }
  return { seeded, problems };
}

/**
 * @param {{root?: string, catalog?: {MODULES: string[], CAPABILITY_CODE: RegExp, CAPABILITY_CATALOG: Array<{code: string, module: string, label: string, description: string}>}}} [opts]
 * @returns {{problems: string[], catalogued: number, checks: number}}
 */
function check({ root = ROOT, catalog } = {}) {
  const cat =
    catalog ||
    require(path.join(root, "src", "shared", "access", "access.catalog.js"));
  const problems = [];
  const modules = new Set(cat.MODULES);
  const known = new Set();

  for (const entry of cat.CAPABILITY_CATALOG) {
    const where = `access.catalog.js: capability "${entry.code}"`;
    if (!cat.CAPABILITY_CODE.test(entry.code || ""))
      problems.push(`${where} is not <area>.<authority>, two lower_snake segments`);
    if (!modules.has(entry.module))
      problems.push(`${where} belongs to "${entry.module}", which is not a module key`);
    if (!String(entry.label || "").trim() || !String(entry.description || "").trim())
      problems.push(`${where} needs a label and a description`);
    if (known.has(entry.code)) problems.push(`${where} is catalogued twice`);
    known.add(entry.code);
  }

  const files = [
    ...walk(path.join(root, "src"), (n) => /\.js$/.test(n) && !/\.test\.js$/.test(n)),
    ...walk(
      path.join(root, "app", "src"),
      (n) => /\.(ts|tsx)$/.test(n) && !/\.(test|spec|d)\.tsx?$/.test(n),
    ),
  ];
  let checks = 0;
  for (const f of files) {
    const rel = relTo(root, f);
    const source = fs.readFileSync(f, "utf8");
    if (!/Capability\s*\(/.test(source)) continue;
    const { uses, dynamic } = usesIn(source);
    for (const line of dynamic)
      problems.push(`${rel}:${line} names its capability through a variable; write the code as a string literal`);
    for (const u of uses) {
      checks += 1;
      if (!known.has(u.code))
        problems.push(`${rel}:${u.line} "${u.code}" is not a capability in shared/access/access.catalog.js`);
    }
  }

  const { seeded, problems: unread } = seededCodes(path.join(root, "seeds", "reference"), root);
  problems.push(...unread);
  for (const code of known) {
    if (!seeded.has(code))
      problems.push(`capability "${code}" is catalogued but no seeds/reference/*.sql inserts it into capability`);
  }
  for (const [code, rel] of seeded) {
    if (!known.has(code))
      problems.push(`${rel}: inserts capability "${code}", which is not in shared/access/access.catalog.js`);
  }

  return { problems, catalogued: known.size, checks };
}

if (require.main === module) {
  const { problems, catalogued, checks } = check();
  if (!problems.length) {
    console.log(
      `capabilities: ok (${catalogued} catalogued, each seeded; ${checks} check${checks === 1 ? "" : "s"} in the code, each on a catalogued code)`,
    );
    process.exit(0);
  }
  console.error("capabilities: every capability is catalogued once and seeded\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nREADME §5.2 and BACKEND_GUIDE §5 say how to add one.");
  process.exit(1);
}

module.exports = { check, usesIn, statements, seededCodes };
