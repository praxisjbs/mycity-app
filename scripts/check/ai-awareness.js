#!/usr/bin/env node
"use strict";
/**
 * Gate 23: the Praxis AI Engine is told when a form, a payload or a schema changes
 * (docs/guides/praxis-ai.md §6.15; decision 22). Five rules:
 *
 *  1. The committed snapshot src/shared/ai/catalogue.snapshot.json equals what the manifests
 *     declare now (every read, summary, action and route with its module, permission, risk and
 *     the hash of its schema). A change is `npm run gen:ai-catalogue`, reviewed with the PR.
 *  2. An action's `input` is a schema the module's own screens validate a form with
 *     (`useContractForm(..., <schema>)` under app/src/features/), unless the action says
 *     `form: "none: <reason>"` (a button with no form), so the card's fields are the form's.
 *  3. Every action key is exercised by an integration test (a string literal in
 *     tests/integration or a module's test) and graded by the evaluation set
 *     (scripts/ai/eval-assistant.js, a case with `action: "<key>"`).
 *  4. A module that declares actions accounts for every `<Thing>Create` schema its contract
 *     exports: offered as an action's input (by any manifest: ESS offers leave's own request), or
 *     in `not_offered` with a reason; and every `not_offered` name is a schema of that contract.
 *     (PR5 makes this rule universal.)
 *  5. Every Try Asking line (src/modules/assistant/assistant.suggestions.js) names a read that
 *     exists.
 *
 * Usage: node scripts/check/ai-awareness.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");

process.env.MYCITY_SKIP_DOTENV = "1";
process.env.APP_ENV = process.env.APP_ENV || "test";
process.env.LOG_LEVEL = "silent";

const ROOT = path.resolve(__dirname, "..", "..");
const FEATURES = path.join(ROOT, "app", "src", "features");
const TESTS = [path.join(ROOT, "tests", "integration"), path.join(ROOT, "src", "modules")];
const EVAL = path.join(ROOT, "scripts", "ai", "eval-assistant.js");
const SUGGESTIONS = path.join(ROOT, "src", "modules", "assistant", "assistant.suggestions.js");
const SCHEMAS = path.join(ROOT, "packages", "contract", "schemas");

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, test, out);
    else if (test(e.name)) out.push(full);
  }
  return out;
}

/** The text of each `useContractForm(...)` call, braces balanced, so a schema named on a later line counts. */
function formCalls(code) {
  const out = [];
  let from = code.indexOf("useContractForm(");
  while (from >= 0) {
    let depth = 0;
    let i = from + "useContractForm".length;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(code.slice(from, i + 1));
    from = code.indexOf("useContractForm(", i);
  }
  return out;
}

const word = (text, name) => new RegExp(`(^|[^A-Za-z0-9_])${name}([^A-Za-z0-9_]|$)`).test(text);

/**
 * @param {{root?: string}} [opts]
 * @returns {{problems: string[], actions: number}}
 */
function check() {
  const problems = [];
  const registry = require(path.join(ROOT, "src", "shared", "ai", "registry"));
  const { contractNameOf } = require(path.join(ROOT, "src", "shared", "ai", "manifest"));
  const snapshot = require(path.join(ROOT, "scripts", "gen", "ai-catalogue"));
  registry.load();

  // 1. The snapshot.
  const s = snapshot.compare();
  if (s.stale) {
    const what = [...s.added.map((k) => `+ ${k}`), ...s.removed.map((k) => `- ${k}`), ...s.changed.map((k) => `~ ${k}`)].join(", ");
    problems.push(`src/shared/ai/catalogue.snapshot.json is stale (${what}): run npm run gen:ai-catalogue and review the diff with the PR`);
  }

  // 2 and 3. Each action's form, test and evaluation case.
  const actions = registry.actions();
  const forms = walk(FEATURES, (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).flatMap((f) => formCalls(fs.readFileSync(f, "utf8")));
  const testText = TESTS.flatMap((d) => walk(d, (f) => f.endsWith(".test.js"))).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  let evalText;
  try {
    evalText = fs.readFileSync(EVAL, "utf8");
  } catch {
    evalText = "";
  }
  for (const a of actions) {
    const schemaName = contractNameOf(a.input);
    const bare = schemaName ? schemaName.split(".").pop() : null;
    if (!a.form) {
      if (!bare || !forms.some((call) => word(call, bare)))
        problems.push(`${a.key}: its input ${schemaName || "(unknown)"} is validated by no form under app/src/features (useContractForm); the card's fields must be the form's own, or say form: "none: <reason>"`);
    }
    if (!word(testText, `"${a.key}"`) && !word(testText, `'${a.key}'`)) problems.push(`${a.key}: no integration test names it (tests/integration or the module's own test)`);
    if (!new RegExp(`action:\\s*["']${a.key.replace(".", "\\.")}["']`).test(evalText)) problems.push(`${a.key}: the evaluation set (scripts/ai/eval-assistant.js) has no case with action: "${a.key}"`);
  }

  // 4. Every Create schema of a module that declares actions is offered (by any manifest: ESS offers
  //    leave's LeaveRequestCreate as the person's own request) or explained.
  const offered = new Set(actions.map((a) => a.input));
  for (const { folder, manifest } of registry.manifests()) {
    if (!manifest.actions.length && !Object.keys(manifest.not_offered).length) continue;
    const file = path.join(SCHEMAS, `${folder}.js`);
    if (!fs.existsSync(file)) continue;
    const mod = require(file);
    const creates = Object.entries(mod).filter(([k, v]) => /Create$/.test(k) && v && typeof v.safeParse === "function");
    for (const [name, schema] of creates) {
      if (offered.has(schema) || manifest.not_offered[name]) continue;
      problems.push(`${folder}.ai.js: ${name} is neither an action's input nor in not_offered; say whether the assistant may draft it, and why not if not`);
    }
    for (const name of Object.keys(manifest.not_offered))
      if (!creates.some(([k]) => k === name)) problems.push(`${folder}.ai.js: not_offered names ${name}, which packages/contract/schemas/${folder}.js does not export as a Create schema`);
  }

  // 5. Try Asking names reads that exist.
  try {
    const { QUESTIONS } = require(SUGGESTIONS);
    for (const [key] of QUESTIONS) if (!registry.read(key)) problems.push(`assistant.suggestions.js names "${key}", which no manifest declares`);
  } catch (err) {
    problems.push(`assistant.suggestions.js could not be read: ${err.message}`);
  }

  return { problems, actions: actions.length };
}

if (require.main === module) {
  const r = check();
  if (r.problems.length === 0) {
    console.log(`ai-awareness: ok (${r.actions} action(s); the snapshot, forms, tests and evaluation set agree with the manifests)`);
    process.exit(0);
  }
  console.error("ai-awareness: the engine must be told what changed (praxis-ai.md §6.15)\n");
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, formCalls };
