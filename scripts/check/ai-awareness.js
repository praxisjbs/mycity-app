#!/usr/bin/env node
"use strict";
/**
 * Gate 23: the Praxis AI Engine is told when a form, a payload or a schema changes
 * (docs/guides/praxis-ai.md §6.15; decision 22). Six rules:
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
 *  4. Every `<Thing>Create` schema any module's contract exports is accounted for (universal
 *     since PR5): offered as an action's input (by any manifest: ESS offers leave's own request),
 *     or in its module's `not_offered` with a reason; and every `not_offered` name is a schema of
 *     that contract. A module with no manifest is one that opted out whole (`// ai:none <reason>`
 *     in its controller, gate 9): the assistant has no surface there at all, and that written
 *     reason covers its Create schemas. A module not built yet (no filled controller) is not asked.
 *  5. Every Try Asking line (src/modules/assistant/assistant.suggestions.js) names a read that
 *     exists.
 *  6. Every create and edit form is in the chat, or never for a named reason (decision 33): each
 *     `<Thing>Create`, `Edit`, `Update`, `Patch` or `Save` schema of a built module's contract is
 *     an action's input; or its module's `not_offered` reason starts `via <action key>:` (reached
 *     through that action's card) or with a never word (`secret:`, `device:`, `personal:`,
 *     `file:`, `ai:`, `design:` by decision 35), as does the `// ai:none` reason of a module opted
 *     out whole; or it is on the
 *     list of today's gaps, scripts/check/ai-forms-gaps.json. That list only shrinks: an entry now
 *     accounted for, or naming no such schema, fails until it is taken off, and one the change's
 *     base did not hold fails, so a new form comes with its action or its reason.
 *  7. Every field a card needs is asked before it is drawn (decision 34): each field an action's
 *     input requires (its JSON Schema's `required`, among the fields the card carries, with no
 *     default) has an ask without `when`.
 *
 * Usage: node scripts/check/ai-awareness.js [--list]     exit 0 ok, 1 problems
 *        --list prints the sweep: each Create schema, and each create and edit form, and how it
 *        is accounted for
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
const MODULES = path.join(ROOT, "src", "modules");
const GAPS = path.join(ROOT, "scripts", "check", "ai-forms-gaps.json");
const coverage = require("./ai-manifest-coverage");

/** A create or edit form's request, by its schema's name (decision 33). */
const FORM_SCHEMA = /(Create|Edit|Update|Patch|Save)$/;
/** Why a form is never in the chat (decision 33): the five words a reason may start with. */
const NEVER = Object.freeze(["secret", "device", "personal", "file", "ai", "design"]);

/** What a not_offered or ai:none reason says of its form: reached via an action, never for a word, or neither. */
function reasonOf(reason) {
  const r = String(reason || "").trim();
  const via = r.match(/^via ([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*):\s*\S/);
  if (via) return { kind: "via", key: via[1] };
  const never = r.match(/^([a-z]+):\s*\S/);
  if (never && NEVER.includes(never[1])) return { kind: "never", word: never[1] };
  return null;
}

/**
 * Rule 6 (decision 33): how each create and edit form of a built module is accounted for, and
 * the gaps list held to only shrinking.
 * @param {{forms: Array<{module: string, name: string, offeredAs: string|null, reason: string|null, moduleReason: string|null}>,
 *          actionKeys: Set<string>, gaps: Record<string, string>, baseGaps: Record<string, string>|null}} q
 *        `baseGaps` is the list as the change's base held it; null when the base had none
 * @returns {{problems: string[], sweep: string[], counts: {offered: number, via: number, never: number, gaps: number}}}
 */
function formsAccountedFor({ forms, actionKeys, gaps, baseGaps }) {
  const problems = [];
  const sweep = [];
  const counts = { offered: 0, via: 0, never: 0, gaps: 0 };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const seen = new Set();
  for (const f of forms) {
    const id = `${f.module}.${f.name}`;
    seen.add(id);
    let state = null;
    if (f.offeredAs) {
      state = `offered as ${f.offeredAs}`;
      counts.offered += 1;
    } else {
      const how = reasonOf(f.reason) || reasonOf(f.moduleReason);
      if (how && how.kind === "via" && !actionKeys.has(how.key)) {
        problems.push(`${id}: its reason says via ${how.key}, which no manifest declares`);
        continue;
      }
      if (how && how.kind === "via") {
        state = `reached via ${how.key}`;
        counts.via += 1;
      } else if (how) {
        state = `never (${how.word})`;
        counts.never += 1;
      }
    }
    if (state) {
      sweep.push(`${id}: ${state}`);
      if (has(gaps, id)) problems.push(`${id} is ${state}: take it off scripts/check/ai-forms-gaps.json (the list only shrinks)`);
    } else if (has(gaps, id)) {
      sweep.push(`${id}: not in the chat yet (${gaps[id]})`);
      counts.gaps += 1;
    } else {
      problems.push(
        `${id}: a create or edit form not in the chat. Offer it as an action, or start its not_offered reason (the // ai:none reason for a module opted out whole) with "via <action key>:" or a never word: ${NEVER.map((w) => `${w}:`).join(", ")} (praxis-ai.md decision 33)`,
      );
    }
  }
  for (const id of Object.keys(gaps)) if (!seen.has(id)) problems.push(`scripts/check/ai-forms-gaps.json names ${id}, which is no create or edit schema of a built module: take it off`);
  if (baseGaps)
    for (const id of Object.keys(gaps))
      if (!has(baseGaps, id)) problems.push(`scripts/check/ai-forms-gaps.json gained ${id}: the list only shrinks, so a form comes with its action or its reason (praxis-ai.md decision 33)`);
  return { problems, sweep, counts };
}

/**
 * Rule 7 (decision 34): a card is drawn whole. Each field an action's input requires (its JSON
 * Schema's `required`, among the fields the card carries, with no default) has an ask without
 * `when`, so the person is asked for it before the card is drawn and never meets it as a problem.
 * @param {Array<{key: string, input: object, fields: string[]|null, asks: Array<{field: string, when?: string|null}>}>} actions
 * @param {(schema: object) => {properties?: object, required?: string[]}} schemaOf  the input as JSON Schema
 * @returns {string[]} problems
 */
function requiredAsked(actions, schemaOf) {
  const out = [];
  for (const a of actions) {
    const js = schemaOf(a.input) || {};
    const props = js.properties || {};
    const carried = (f) => !a.fields || a.fields.includes(f);
    const required = (js.required || []).filter((f) => carried(f) && !(props[f] && props[f].default !== undefined));
    const asked = new Set((a.asks || []).filter((q) => !q.when).map((q) => q.field));
    for (const f of required)
      if (!asked.has(f))
        out.push(`${a.key}: its input requires ${f}, which no ask asks before the card is drawn; add an ask (its question, answers to tap, \`read\` when it names a record) (praxis-ai.md decision 34)`);
  }
  return out;
}

/** The gaps list, as this tree holds it and as the change's base held it (null when the base had none). */
function gapsLists() {
  const now = JSON.parse(fs.readFileSync(GAPS, "utf8")).gaps || {};
  const then = (() => {
    try {
      const changes = require("./lib/changes");
      const b = changes.base();
      const text = b ? changes.git(["show", `${b}:scripts/check/ai-forms-gaps.json`], { allowFail: true }) : null;
      return text ? JSON.parse(text).gaps || {} : null;
    } catch {
      return null;
    }
  })();
  return { now, then };
}

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

/**
 * The text of each `useContractForm(...)` call, braces balanced, so a schema named on a later line
 * counts; a call that names its values' type (`useContractForm<Values>(...)`) counts the same.
 */
function formCalls(code) {
  const out = [];
  const start = /useContractForm(<[^()]*>)?\(/g;
  let m;
  while ((m = start.exec(code))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(code.slice(m.index, i + 1));
    start.lastIndex = i;
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

  // 4. Every Create schema of every module's contract is offered (by any manifest: ESS offers
  //    leave's LeaveRequestCreate as the person's own request), explained in its manifest's
  //    not_offered, or in a module that opted out whole with a written reason (gate 9).
  const offered = new Map(actions.map((a) => [a.input, a.key]));
  const byFolder = new Map(registry.manifests().map((m) => [m.folder, m.manifest]));
  const optedOut = new Map(coverage.check().optedOut.map((o) => [o.module, o.reason]));
  const sweep = [];
  for (const file of fs.readdirSync(SCHEMAS).filter((f) => f.endsWith(".js")).sort()) {
    const folder = file.replace(/\.js$/, "");
    const creates = Object.entries(require(path.join(SCHEMAS, file))).filter(([k, v]) => /Create$/.test(k) && v && typeof v.safeParse === "function");
    if (!creates.length) continue;
    const manifest = byFolder.get(folder);
    if (!manifest) {
      if (!built(folder)) continue;
      if (optedOut.has(folder)) {
        for (const [name] of creates) sweep.push(`${folder}.${name}: the module opted out of the assistant whole (${optedOut.get(folder)})`);
        continue;
      }
      problems.push(`${folder}: its contract exports ${creates.map(([k]) => k).join(", ")} and the module has neither a manifest with not_offered nor // ai:none <reason> in its controller`);
      continue;
    }
    for (const [name, schema] of creates) {
      if (offered.has(schema)) sweep.push(`${folder}.${name}: offered as ${offered.get(schema)}`);
      else if (manifest.not_offered[name]) sweep.push(`${folder}.${name}: not offered (${manifest.not_offered[name]})`);
      else problems.push(`${folder}.ai.js: ${name} is neither an action's input nor in not_offered; say whether the assistant may draft it, and why not if not`);
    }
    // not_offered may name any create or edit schema of the contract (rule 6 reads its never words).
    const formNames = Object.keys(require(path.join(SCHEMAS, file))).filter((k) => FORM_SCHEMA.test(k));
    for (const name of Object.keys(manifest.not_offered))
      if (!formNames.includes(name)) problems.push(`${folder}.ai.js: not_offered names ${name}, which packages/contract/schemas/${folder}.js does not export as a create or edit schema`);
  }
  // A manifest's not_offered with no contract file of its module's name explains nothing.
  for (const { folder, manifest } of registry.manifests())
    if (Object.keys(manifest.not_offered).length && !fs.existsSync(path.join(SCHEMAS, `${folder}.js`)))
      problems.push(`${folder}.ai.js: not_offered names schemas, but packages/contract/schemas/${folder}.js does not exist`);

  // 5. Try Asking names reads that exist.
  try {
    const { QUESTIONS } = require(SUGGESTIONS);
    for (const [key] of QUESTIONS) if (!registry.read(key)) problems.push(`assistant.suggestions.js names "${key}", which no manifest declares`);
  } catch (err) {
    problems.push(`assistant.suggestions.js could not be read: ${err.message}`);
  }

  // 6. Every create and edit form of a built module is in the chat, or never for a named reason (decision 33).
  const formSchemas = [];
  for (const file of fs.readdirSync(SCHEMAS).filter((f) => f.endsWith(".js")).sort()) {
    const folder = file.replace(/\.js$/, "");
    if (!built(folder)) continue;
    const manifest = byFolder.get(folder);
    for (const [name, schema] of Object.entries(require(path.join(SCHEMAS, file)))) {
      if (!FORM_SCHEMA.test(name) || !schema || typeof schema.safeParse !== "function") continue;
      formSchemas.push({
        module: folder,
        name,
        offeredAs: offered.get(schema) || null,
        reason: manifest ? manifest.not_offered[name] || null : null,
        moduleReason: !manifest && optedOut.has(folder) ? optedOut.get(folder) : null,
      });
    }
  }
  const lists = gapsLists();
  const six = formsAccountedFor({ forms: formSchemas, actionKeys: new Set(actions.map((a) => a.key)), gaps: lists.now, baseGaps: lists.then });
  problems.push(...six.problems);

  // 7. Every field a card needs is asked before it is drawn (decision 34).
  const { jsonSchemaOf } = require(path.join(ROOT, "src", "services", "ai", "structured"));
  problems.push(...requiredAsked(actions, jsonSchemaOf));

  return { problems, actions: actions.length, sweep, forms: six.sweep, counts: six.counts };
}

/** A module counts once its controller has content, as gate 9 counts it; the map makes every module's files empty first. */
function built(folder) {
  const dir = path.join(MODULES, folder);
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((f) => f.endsWith(".controller.js") && fs.readFileSync(path.join(dir, f), "utf8").trim().length > 0);
}

if (require.main === module) {
  const r = check();
  if (process.argv.includes("--list")) {
    for (const line of r.sweep) console.log(`  ${line}`);
    console.log("\n  Create and edit forms (decision 33):");
    for (const line of r.forms) console.log(`  ${line}`);
  }
  if (r.problems.length === 0) {
    const c = r.counts;
    console.log(
      `ai-awareness: ok (${r.actions} action(s); the snapshot, forms, tests and evaluation set agree with the manifests; ${r.sweep.length} Create schema(s) accounted for; ` +
        `create and edit forms: ${c.offered} in the chat, ${c.via} through another action, ${c.never} never, ${c.gaps} gap(s) to close in scripts/check/ai-forms-gaps.json)`,
    );
    process.exit(0);
  }
  console.error("ai-awareness: the engine must be told what changed (praxis-ai.md §6.15)\n");
  for (const p of r.problems) console.error(`  - ${p}`);
  process.exit(1);
}

module.exports = { check, formCalls, built, formsAccountedFor, requiredAsked, reasonOf, NEVER, FORM_SCHEMA };
