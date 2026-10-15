#!/usr/bin/env node
"use strict";
/**
 * Gate 19: the assistant reads, it never writes (MILESTONES A23).
 *
 * A change a person asks the assistant for is routed to the screen where they make it
 * themselves; the model executes nothing. Two checks, so neither a typo nor a clever
 * manifest gets past:
 *
 *  1. Static. Every `*.ai.js` with content calls defineManifest(...) and declares no
 *     write-shaped key (`write`, `writes`, `actions`, `executor`, `execute`, `mutations`,
 *     `creates`, `updates`, `deletes`), comments aside.
 *  2. Loaded. Every manifest goes through shared/ai/registry.js, where defineManifest
 *     refuses a write and anything malformed, exactly as the API and the worker do at
 *     boot.
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
const WRITE_KEY =
  /(^|[{,\s])["']?(writes?|actions?|executors?|execute|mutations|creates|updates|deletes)["']?\s*:/m;

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
    if (!/\bdefineManifest\s*\(/.test(code))
      problems.push(
        `${rel}: a manifest is built with defineManifest() (shared/ai/manifest.js)`,
      );
    const m = WRITE_KEY.exec(code);
    if (m)
      problems.push(
        `${rel}: declares "${m[2]}". The assistant reads, never writes (A23); route the change to its screen with routes: [...]`,
      );
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
    console.log(
      `ai-no-writes: ok (${r.files} manifest(s), reads and routes only)`,
    );
    process.exit(0);
  }
  console.error(
    "ai-no-writes: the AI manifests must declare reads and routes only (MILESTONES A23)\n",
  );
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, stripComments };
