#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: the codebase never says where code came from.
 *
 * Code that was ported from another project is MyCity's code once it lands. A
 * comment that names the other project ("from <project> src/...", "ported from
 * ...", "<project> did X") describes a repository nobody here can open, goes
 * stale the day either side changes, and leaks the name of other clients' work
 * into this one. A comment says what the code does and why. Where a piece came
 * from is recorded once, in docs/MyCity-ERP-Documents/REUSE_MAP.md and
 * docs/BACKEND_STRUCTURE.md §3, and nowhere else.
 *
 * Scans everything that ships or runs: src/, scripts/, tests/, packages/,
 * migrations/, seeds/, templates/, ops/, .github/, .claude/, app/, public-app/
 * and the root config files. Not scanned: docs/, README.MD and CLAUDE.md (the
 * planning documents, which are where provenance belongs), lockfiles, and this file.
 *
 * "Praxis AI" (the product's assistant), `praxis_ai` (its permission key) and
 * "JBS Praxis" (the company) are names in this product, not provenance, and pass.
 *
 * Usage: node scripts/check/provenance.js     exit 0 clean, 1 on a reference
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN = ["src", "scripts", "tests", "packages", "migrations", "seeds", "templates", "ops", ".github", ".claude", "app", "public-app"];
const ROOT_FILES = /^[^/]+\.(js|cjs|mjs|json|ya?ml)$|^\.(nvmrc|gitattributes|gitignore|env\.example)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git"]);
const SKIP_FILES = new Set(["package-lock.json", path.join("scripts", "check", "provenance.js")]);
const TEXT = /\.(js|cjs|mjs|ts|tsx|jsx|json|sql|md|ya?ml|sh|html|css|txt|conf|service|template|env|example)$|^[^.]+$/;

const PATTERNS = [
  [/pixie/i, "names another project"],
  [/praxis[-_ ]?ls\b/i, "names another project"],
  [/\bdonor\b/i, "refers to donor code"],
  [/\bported\s+from\b|\bport(ed)?\s+of\b/i, "says where code was ported from"],
  // "praxis" alone, except the product's own names
  [/(?<!jbs\s)\bpraxis\b(?![\s_-]*ai\b)/i, "names another project"],
];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (TEXT.test(e.name)) out.push(full);
  }
  return out;
}

const files = SCAN.flatMap((d) => walk(path.join(ROOT, d), []));
for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (e.isFile() && ROOT_FILES.test(e.name)) files.push(path.join(ROOT, e.name));
}

const problems = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (SKIP_FILES.has(rel)) continue;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
    for (const [re, why] of PATTERNS) {
      if (re.test(line)) {
        problems.push(`${rel}:${i + 1}  ${why}: ${line.trim().slice(0, 100)}`);
        break;
      }
    }
  });
}

if (problems.length) {
  console.error(`provenance: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nSay what the code does and why. Where it came from belongs in REUSE_MAP.md only.");
  process.exit(1);
}
console.log(`provenance: ok (${files.length} files)`);
