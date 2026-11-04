#!/usr/bin/env node
"use strict";
/**
 * Gate 24: the Praxis AI Engine requires nothing of MyCity (docs/guides/praxis-ai.md §6.14;
 * decision 17). `src/services/ai/engine/` is the part that would travel to another project, so:
 *
 *  1. a file in the folder requires only Node's builtins and its sibling files (`./x`); no
 *     `../`, no package, no config, no database, no vendor;
 *  2. a file outside the folder reaches the engine through `engine` or `engine/index` only,
 *     never a file inside it, so the engine's internals can change without the adapter knowing.
 *
 * Usage: node scripts/check/ai-engine-boundary.js     exit 0 ok, 1 on a crossing
 */
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");

const ROOT = path.resolve(__dirname, "..", "..");
const ENGINE = "src/services/ai/engine";
const SCAN = ["src", "scripts", "tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
const REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs|ts|tsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/** The `require("...")` targets of a file. */
function requiresOf(code) {
  const out = [];
  let m;
  while ((m = REQUIRE.exec(code))) out.push(m[1]);
  return out;
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], inside: number, outside: number}}
 */
function check({ root = ROOT } = {}) {
  const problems = [];
  const engineDir = path.join(root, ENGINE);
  let inside = 0;
  let outside = 0;
  for (const dir of SCAN) {
    for (const file of walk(path.join(root, dir), [])) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const code = fs.readFileSync(file, "utf8");
      const within = file.startsWith(engineDir + path.sep);
      for (const target of requiresOf(code)) {
        if (within) {
          inside += 1;
          if (BUILTINS.has(target)) continue;
          if (/^\.\/[a-z][a-z0-9-]*$/.test(target)) continue;
          problems.push(`${rel}: requires "${target}". The engine requires only Node's builtins and its sibling files; inject the rest through createEngine(deps) (praxis-ai.md §6.14)`);
        } else if (target.includes("/engine/") || /\/engine\/?$/.test(target)) {
          outside += 1;
          const resolved = path.resolve(path.dirname(file), target);
          if (!resolved.startsWith(engineDir)) continue;
          const sub = path.relative(engineDir, resolved).split(path.sep).join("/");
          if (sub === "" || sub === "index" || sub === "index.js") continue;
          problems.push(`${rel}: requires "${target}", inside the engine. Reach it through services/ai/engine (its index.js) only`);
        }
      }
    }
  }
  return { problems, inside, outside };
}

if (require.main === module) {
  const r = check();
  if (r.problems.length === 0) {
    console.log(`ai-engine-boundary: ok (${r.inside} requires inside the engine, ${r.outside} into it, none crossing)`);
    process.exit(0);
  }
  console.error("ai-engine-boundary: the engine requires nothing of MyCity, and nothing reaches past its index (praxis-ai.md §6.14)\n");
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, requiresOf, ENGINE };
