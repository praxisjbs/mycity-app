#!/usr/bin/env node
"use strict";
/**
 * Gate 19: the AI manifests declare reads, summaries, actions and routes, and nothing else
 * (MILESTONES A23 as amended 01/11/2026; docs/guides/praxis-ai.md §1.2 decision 10, §6.11).
 *
 * The assistant never executes anything itself: a change is an action the module declares on
 * its own service function and a person confirms, or a route to the screen. Three checks, so
 * neither a typo nor a clever manifest gets past:
 *
 *  1. Static. Every `*.ai.js` with content calls defineManifest(...) and declares no write by
 *     another name (`write`, `writes`, `executor`, `execute`, `mutations`, `sql`, `creates`,
 *     `updates`, `deletes`), comments aside.
 *  2. Static. No SQL and no query call inside a manifest: an action's `run` is the module's
 *     service function, never INSERT, UPDATE, DELETE or `.query(` of its own.
 *  3. Loaded. Every manifest goes through shared/ai/registry.js, where defineManifest refuses
 *     a malformed read, summary, action or route (an action's `run` not a function, a risk
 *     outside the five classes, a `view` grant on an action, a summary that takes a page),
 *     exactly as the API and the worker do at boot.
 *
 * Usage: node scripts/check/ai-no-writes.js     exit 0 ok, 1 on a write or a bad manifest
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = process.env.APP_ENV || "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");
const MODULES = path.join(ROOT, "src", "modules");
const WRITE_KEY = /(^|[{,\s])["']?(writes?|executors?|execute|mutations?|sql|creates|updates|deletes)["']?\s*:/m;
const SQL = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/;
const QUERY_CALL = /\.\s*query\s*\(/;

/** Source with comments removed (strings kept), so a comment that says "writes:" is not a write. */
function stripComments(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += next || "";
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * @param {{dir?: string}} [opts]
 * @returns {{files: number, problems: string[]}}
 */
function check({ dir = MODULES } = {}) {
  const problems = [];
  const registry = require(path.join(ROOT, "src", "shared", "ai", "registry"));
  const files = registry.discover(dir);
  for (const { file } of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const code = stripComments(fs.readFileSync(file, "utf8"));
    if (!/\bdefineManifest\s*\(/.test(code)) problems.push(`${rel}: a manifest is built with defineManifest() (shared/ai/manifest.js)`);
    const m = WRITE_KEY.exec(code);
    if (m) problems.push(`${rel}: declares "${m[2]}". The assistant acts only through a declared action's run, the module's own service function; declare an action or route the change to its screen`);
    if (SQL.test(code)) problems.push(`${rel}: holds SQL. A manifest names the module's service and repo functions; it never writes a statement of its own`);
    if (QUERY_CALL.test(code)) problems.push(`${rel}: calls .query(). A manifest's run and check call the module's service, never the database`);
  }
  if (problems.length === 0) {
    try {
      registry.load({ dir });
    } catch (err) {
      problems.push(err.message);
    }
  }
  return { files: files.length, problems };
}

if (require.main === module) {
  const r = check();
  if (r.problems.length === 0) {
    console.log(`ai-no-writes: ok (${r.files} manifest(s): reads, summaries, declared actions and routes only)`);
    process.exit(0);
  }
  console.error("ai-no-writes: the AI manifests declare reads, summaries, actions and routes only (praxis-ai.md §6.11)\n");
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, stripComments };
