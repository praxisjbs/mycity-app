#!/usr/bin/env node
"use strict";
/**
 * Pipeline guard: only release.yml and rollback.yml reach production
 * (BACKEND_STRUCTURE §10, SYSTEM_ARCHITECTURE §9).
 *
 * The GitHub `production` environment is where the approval rule and the production
 * secrets live: a job that names it waits for a person, then gets the keys to the
 * production server. A second workflow that names it is a second way to deploy, and a
 * repository secret named for production is a key that skips the approval altogether.
 *
 * Fails the build on, in any workflow under .github/workflows other than release.yml and
 * rollback.yml (comments are not read):
 *  1. `environment: production`, or an environment block whose `name:` is production;
 *  2. an environment given as an expression (`environment: ${{ inputs.env }}`), which
 *     can evaluate to production;
 *  3. a secret whose name says production (secrets.PROD_SSH_KEY, secrets.PRODUCTION_...).
 *
 * Usage: node scripts/check/production-environment-refs.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const ALLOWED = new Set(["release.yml", "rollback.yml"]);
const PROD = /^["']?prod(uction)?["']?$/i;

/** A YAML line without its comment (a # inside quotes is kept). */
function uncomment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1])))
      return line.slice(0, i);
  }
  return line;
}

/**
 * Every production reference in one workflow's text.
 * @returns {Array<{line: number, why: string}>}
 */
function scanWorkflow(text) {
  const lines = String(text).replace(/\r\n/g, "\n").split("\n").map(uncomment);
  const hits = [];
  lines.forEach((l, i) => {
    const env = /^(\s*)(?:-\s+)?environment\s*:\s*(.*?)\s*$/.exec(l);
    if (env) {
      const value = env[2];
      if (value && PROD.test(value))
        hits.push({ line: i + 1, why: "names the production environment" });
      else if (/\$\{\{/.test(value))
        hits.push({
          line: i + 1,
          why: "sets the environment from an expression, which can be production",
        });
      else if (!value) {
        const indent = env[1].length;
        for (let k = i + 1; k < lines.length; k += 1) {
          const sub = lines[k];
          if (!sub.trim()) continue;
          if (sub.search(/\S/) <= indent) break;
          const name = /^\s*name\s*:\s*(.*?)\s*$/.exec(sub);
          if (!name) continue;
          if (PROD.test(name[1]))
            hits.push({ line: k + 1, why: "names the production environment" });
          else if (/\$\{\{/.test(name[1]))
            hits.push({
              line: k + 1,
              why: "sets the environment from an expression, which can be production",
            });
        }
      }
    }
    for (const s of l.matchAll(/\bsecrets\s*\.\s*([A-Za-z0-9_]+)/g)) {
      if (/(^|_)PROD(UCTION)?(_|$)/i.test(s[1]))
        hits.push({
          line: i + 1,
          why: `uses secrets.${s[1]}; production secrets live in the production environment, reached only by release and rollback`,
        });
    }
  });
  return hits;
}

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], notes: string[], count: number}}
 */
function check({ root = ROOT } = {}) {
  const dir = path.join(root, ".github", "workflows");
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /\.ya?ml$/.test(f))
        .sort()
    : [];
  const problems = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    if (f === "release.yaml" || f === "rollback.yaml") {
      problems.push(
        `.github/workflows/${f}: name it ${f.replace(/yaml$/, "yml")}; only release.yml and rollback.yml may reach production`,
      );
    }
    for (const h of scanWorkflow(fs.readFileSync(path.join(dir, f), "utf8")))
      problems.push(`.github/workflows/${f}:${h.line} ${h.why}`);
  }
  return { problems, notes: [], count: files.length };
}

if (require.main === module) {
  const { problems, count } = check();
  if (!problems.length) {
    console.log(
      `production-environment-refs: ok (${count} workflows; only release.yml and rollback.yml may reach production)`,
    );
    process.exit(0);
  }
  console.error(
    "production-environment-refs: only release.yml and rollback.yml reach production\n",
  );
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, scanWorkflow, uncomment };
