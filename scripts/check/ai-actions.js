#!/usr/bin/env node
"use strict";
/**
 * Every AI call names a registered action (docs/guides/ai-control.md §1.1 decision 24, §6.5).
 * An action is declared once in src/services/ai/actions.js with its job, whether it carries
 * personal data and who chose it; AI Control then lists it, gives it its job's chain and adds
 * its spend up. A call that names no action would answer on the Default chain, unseen.
 *
 * Fails the build on:
 *  1. a registry entry without its label, a module key, a job (one of the seven, or none for a
 *     direct call), its personal-data answer, who chose it (initials) and when (YYYY-MM-DD); a
 *     Top Tier entry without a written reason; an own chain naming an unknown provider or family;
 *  2. a built action with a chain and no prompt file (services/ai/prompts/<key>.md);
 *  3. an AI call in src/ (`ai.complete`, `llm.complete`, `ai.converse`, `ai.search`, `llm.search`,
 *     `ai.embed`, `llm.embed`, `transcription.transcribe`, or a ledger run opened in services/ai)
 *     whose purpose is not a registered action, or is not written as a literal string;
 *  4. a complete(), converse(), search() or embed() call with no purpose.
 * Comments are not code.
 *
 * Usage: node scripts/check/ai-actions.js     exit 0 clean, 1 on a problem
 */
const fs = require("node:fs");
const path = require("node:path");
const { stripComments } = require("./ai-no-writes");

const ROOT = path.resolve(__dirname, "..", "..");
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".git", "vendors", "prompts"]);

const CALL = /\b(?:ai|llm)\.(complete|search|converse|embed)\s*\(\s*\{|\btranscription\.transcribe\s*\(\s*\{|\bledger\.startRun\s*\(\s*\w+\s*,\s*\{/g;
const PURPOSE_LITERAL = /\bpurpose\s*:\s*["']([^"']*)["']/;
const PURPOSE_ANY = /\bpurpose\s*[:,}]/;
const DEFAULT_PURPOSE = /\bpurpose\s*=\s*["']([a-z][a-z0-9-]*)["']/g;

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(full);
  }
  return out;
}

/** The object literal that opens at `from` (its "{"), braces balanced; strings are skipped. */
function objectAt(code, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(from, i + 1);
    }
  }
  return code.slice(from);
}

/** The object's own keys only: a nested object's keys are not the call's. */
function topLevel(obj) {
  let depth = 0;
  let quote = null;
  let out = "";
  for (let i = 0; i < obj.length; i += 1) {
    const ch = obj[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      if (depth === 1) out += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    if (depth === 1) out += ch;
    if (ch === "}" || ch === "]" || ch === ")") depth -= 1;
  }
  return out;
}

function checkRegistry(root, problems) {
  const file = path.join(root, "src", "services", "ai", "actions.js");
  if (!fs.existsSync(file)) {
    problems.push("src/services/ai/actions.js is missing: every AI feature is registered there");
    return null;
  }
  delete require.cache[require.resolve(file)];
  const { ACTIONS } = require(file);
  const catalog = require(path.join(root, "src", "shared", "access", "access.catalog.js"));
  const jobs = require(path.join(root, "src", "services", "ai", "jobs.js"));
  const providers = new Set(["gemini", "groq", "openai", "anthropic", "deepseek"]);
  for (const [key, a] of Object.entries(ACTIONS)) {
    const at = `actions.js "${key}"`;
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(key)) problems.push(`${at}: a key is kebab-case`);
    if (typeof a.label !== "string" || !a.label.trim()) problems.push(`${at}: no label`);
    if (!catalog.isModule(a.module)) problems.push(`${at}: module "${a.module}" is not a module key`);
    if (a.direct ? a.job !== null : !jobs.JOBS.includes(a.job))
      problems.push(`${at}: job "${a.job}" is not one of ${jobs.JOBS.join(", ")}${a.direct ? " (a direct call has none)" : ""}`);
    if (typeof a.personal_data !== "boolean") problems.push(`${at}: say whether it carries personal data (personal_data: true or false)`);
    if (!/^[A-Z]{2,3}$/.test(String(a.chosen_by || ""))) problems.push(`${at}: chosen_by is the initials of the person who chose the job`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.chosen_at || ""))) problems.push(`${at}: chosen_at is the day it was chosen, YYYY-MM-DD`);
    if (a.job === "top_tier" && !(typeof a.reason === "string" && a.reason.trim().length >= 20))
      problems.push(`${at}: Top Tier needs a written reason why Default or Deep Reasoning will not do`);
    for (const pair of a.chain || []) {
      if (!Array.isArray(pair) || !providers.has(pair[0]) || !jobs.FAMILIES[pair[1]])
        problems.push(`${at}: its chain names [${pair}], not a provider and a family in services/ai/jobs.js`);
    }
    if (a.built !== false && !a.direct && a.job !== "transcription" && a.job !== "embeddings") {
      const prompt = path.join(root, "src", "services", "ai", "prompts", `${key}.md`);
      if (!fs.existsSync(prompt)) problems.push(`${at}: no prompt file src/services/ai/prompts/${key}.md`);
    }
  }
  return ACTIONS;
}

/**
 * @param {{root?: string, extra?: Array<{rel: string, code: string}>}} [opts]  extra: code to check
 *        as if it were in src/ (tests)
 */
function check({ root = ROOT, extra = [] } = {}) {
  const problems = [];
  const ACTIONS = checkRegistry(root, problems);
  if (!ACTIONS) return problems;
  const known = (k) => Object.prototype.hasOwnProperty.call(ACTIONS, k);
  const sources = [
    ...walk(path.join(root, "src"), []).map((file) => ({
      rel: path.relative(root, file).split(path.sep).join("/"),
      code: fs.readFileSync(file, "utf8"),
    })),
    ...extra,
  ];
  for (const source of sources) {
    const { rel } = source;
    const code = stripComments(source.code);
    const line = (i) => code.slice(0, i).split("\n").length;
    CALL.lastIndex = 0;
    let m;
    while ((m = CALL.exec(code))) {
      // A ledger run opened outside services/ai is not an AI call.
      if (m[0].startsWith("ledger") && !rel.startsWith("src/services/ai/")) continue;
      const brace = code.indexOf("{", m.index + m[0].length - 1);
      const own = topLevel(objectAt(code, brace));
      const lit = PURPOSE_LITERAL.exec(own);
      const where = `${rel}:${line(m.index)}`;
      if (lit) {
        if (!known(lit[1])) problems.push(`${where}: purpose "${lit[1]}" is not registered in src/services/ai/actions.js`);
      } else if (PURPOSE_ANY.test(own)) {
        // A purpose passed through (the ledger and the pipeline's own helpers) is checked where it is named.
        if (!rel.startsWith("src/services/ai/")) problems.push(`${where}: name the action as a literal string, purpose: "my-action"`);
      } else if (m[1]) {
        problems.push(`${where}: ${m[1]}() names no purpose; register the action and name it`);
      }
    }
    if (rel.startsWith("src/services/ai/")) {
      DEFAULT_PURPOSE.lastIndex = 0;
      let d;
      while ((d = DEFAULT_PURPOSE.exec(code)))
        if (!known(d[1])) problems.push(`${rel}:${line(d.index)}: default purpose "${d[1]}" is not registered`);
    }
  }
  return problems;
}

if (require.main === module) {
  const problems = check();
  if (!problems.length) {
    console.log("ai-actions: ok (every AI call names a registered action)");
    process.exit(0);
  }
  console.error(`ai-actions: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nRegister the action in src/services/ai/actions.js, asking which job it uses (docs/guides/ai-control.md §6.2).");
  process.exit(1);
}

module.exports = { check, objectAt, topLevel };
