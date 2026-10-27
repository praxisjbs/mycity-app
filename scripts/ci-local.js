#!/usr/bin/env node
"use strict";
/**
 * `npm run ci`: every gate, with the whole report at the end.
 *
 * The same command runs locally before a push and in each job of
 * .github/workflows/ci.yml, so a green run here and a green run in CI mean the
 * same thing. It does not stop at the first failure (unless --fast): five
 * unrelated breakages are five lines in one report, not five round trips.
 *
 * PARALLEL. The gates fall in four groups (GROUPS below), which CI runs as four
 * jobs at once. Locally the groups run at the same time too, each one's gates
 * in order, so a full run takes as long as its slowest group (the backend's
 * tests), not the sum of all four. Each gate's line prints when it ends, with
 * its group. --serial runs every gate one after another, in GATES order; --fast
 * does too, since it stops at the first failure. The groups share nothing that
 * one could break for another: the screens group builds its own demo app and
 * gallery (scripts/check/lib/screens.js, gallery.js), away from fe:build's.
 * The processor they do share: the frontend's tests run on the machine's CPUs
 * less two (MYCITY_TEST_WORKERS, read by scripts/fe-test.js), left to the
 * backend's tests and the screens' browser, since tests that wait on a clock
 * fail when starved.
 *
 * NOT BUILT IS NOT PASSED. Most gate scripts exist as empty files until their
 * M0 slice is written. Running an empty file exits 0, which would print a
 * green tick for a check that checks nothing. So an empty gate is reported as
 * NOT BUILT, listed at the end, and does not count as passed. With --strict
 * (CI switches this on once M0 is complete) a NOT BUILT gate fails the run.
 *
 *   node scripts/ci-local.js            everything, the four groups at once, full report
 *   node scripts/ci-local.js --serial   everything, one gate after another
 *   node scripts/ci-local.js --fast     one after another, stop at the first failure
 *   node scripts/ci-local.js --strict   NOT BUILT counts as a failure
 *   node scripts/ci-local.js --list     print the gates and exit
 *   node scripts/ci-local.js --only=progress,guides   run just these (by id)
 *   node scripts/ci-local.js --group=backend          run one CI job's gates (backend, frontend,
 *                                                     screens or checks; GROUPS below)
 *   node scripts/ci-local.js --groups                 print each group's gates as JSON
 *   node scripts/ci-local.js --decide-scope   GitHub Actions: how much this run needs
 *
 * SCOPE. In GitHub Actions, ci.yml first asks how much of this a run needs
 * (scripts/check/lib/scope.js) and passes it as CI_SCOPE: `full` runs every
 * gate; `docs` (a change to documents only) and `tested` (a push to main whose
 * tree a pull request's run already passed) run only the gates that read
 * documents, and report the rest as skipped. Unset, or on a laptop, it is full.
 */
const { spawn } = require("node:child_process");
const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(`--${flag}`);
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const groupArg = argv.find((a) => a.startsWith("--group="));
const GROUP = groupArg ? groupArg.slice(8) : null;
const FAST = has("fast");
const SERIAL = has("serial") || FAST;
const STRICT = has("strict") || process.env.CI_STRICT === "1";
const SCOPE = process.env.CI_SCOPE || "full";
const scope = require("./check/lib/scope");

if (has("decide-scope")) {
  scope.main();
  process.exit(0);
}
if (!["full", "docs", "tested"].includes(SCOPE)) {
  console.error(`CI_SCOPE is "${SCOPE}": it must be full, docs or tested`);
  process.exit(2);
}

/*
 * The Node major CI runs (.nvmrc), or no run: another major passes what CI fails. On Node 22's
 * larger default heap the backend suite never ran out of memory as it did on Node 20 (27/10/2026).
 */
const NODE_WANTED = fs.readFileSync(path.join(ROOT, ".nvmrc"), "utf8").trim().replace(/^v/, "").split(".")[0];
if (process.versions.node.split(".")[0] !== NODE_WANTED) {
  console.error(
    `npm run ci: CI runs Node ${NODE_WANTED} (.nvmrc) and this is Node ${process.versions.node}. ` +
      "Switch first: nvm use (a cloud session's start does it, .claude/hooks/session-start.sh).",
  );
  process.exit(2);
}

const bin = (pkg, rel) => path.join(ROOT, "node_modules", pkg, rel);

/**
 * id      short name for --only
 * label   what the report prints
 * script  repo-relative script, run with node; empty file = NOT BUILT
 * args    extra arguments
 * tool    [package, bin path] for a dependency's CLI (eslint, jest)
 * npm     an npm script to run (the frontend workspaces' typecheck, lint, test, build)
 * group   the CI job that runs it (ci.yml runs the four in parallel); `checks` unless named:
 *           backend   needs PostgreSQL, Redis and ffmpeg: the whole jest suite and the schema gates
 *           frontend  the workspaces' typecheck, lint, tests and builds
 *           screens   needs Chromium: the gates that open every screen
 *           checks    the fast static and process gates, including every gate that reads documents
 */
const GATES = [
  // Gates 1 to 8 (M0)
  { id: "lint", label: "1  Lint", tool: ["eslint", "bin/eslint.js"], args: ["--max-warnings", "0", "."] },
  { id: "test", label: "2  Tests, whole suite", tool: ["jest", "bin/jest.js"], args: ["--ci"], group: "backend" },
  { id: "migration-numbers", label: "3  Migration numbering", script: "scripts/check/migration-numbers.js", group: "backend" },
  { id: "migration-reversibility", label: "4  Migration reversibility", script: "scripts/check/migration-reversibility.js", group: "backend" },
  { id: "migration-idempotency", label: "5  Migration idempotency", script: "scripts/check/migration-idempotency.js", group: "backend" },
  { id: "schema-drift", label: "6  Schema drift", script: "scripts/check/schema-drift.js", group: "backend" },
  { id: "contract-columns", label: "6  Contract keys are columns", script: "scripts/check/contract-columns.js", group: "backend" },
  { id: "route-contracts", label: "7  Write routes validated", script: "scripts/check/route-contracts.js", group: "backend" },
  { id: "five-second", label: "8  Five-second rule (screen copy)", script: "scripts/check/five-second.js", group: "screens" },
  // Gates from M1 onward
  { id: "ai-manifest-coverage", label: "9  AI manifest coverage", script: "scripts/check/ai-manifest-coverage.js" },
  { id: "search-coverage", label: "10 Search coverage", script: "scripts/check/search-coverage.js" },
  { id: "two-shells", label: "11 Two shells (phone and desktop)", script: "scripts/check/two-shells.js", group: "screens" },
  { id: "forms", label: "12 Inline validation, one form system", script: "scripts/check/forms.js" },
  { id: "palette", label: "13 Palette (colours only in tokens.css)", script: "scripts/check/palette.js" },
  { id: "contrast", label: "14 Contrast, every token pair, both themes", script: "scripts/check/contrast.js" },
  { id: "date-format", label: "15 Day-first dates", script: "scripts/check/date-format.js" },
  { id: "native-dialogs", label: "16 No native dialogs", script: "scripts/check/native-dialogs.js" },
  { id: "dashes", label: "17 No dashes (and gate 8 backend copy)", script: "scripts/check/dashes.js" },
  { id: "upload", label: "18 Files only through the upload field", script: "scripts/check/upload.js" },
  { id: "ai-no-writes", label: "19 AI read manifest only", script: "scripts/check/ai-no-writes.js" },
  { id: "money", label: "20 Money", script: "scripts/check/money.js" },
  { id: "native-ui", label: "21 Nothing the browser styles itself", script: "scripts/check/native-ui.js", group: "screens" },
  { id: "addresses", label: "22 Addresses picked, never typed", script: "scripts/check/addresses.js" },
  // Pipeline guards
  { id: "contract", label: "Contract is generated and current", script: "scripts/gen/contract.js", args: ["--check"] },
  { id: "env-template", label: ".env.example matches the schema", script: "scripts/check/env-template.js" },
  { id: "module-catalogue", label: "Module catalogue equals enforced keys", script: "scripts/check/module-catalogue.js" },
  { id: "capabilities", label: "Capabilities are catalogued and seeded", script: "scripts/check/capabilities.js" },
  { id: "public-surface", label: "Public routes import no auth", script: "scripts/check/public-surface.js" },
  { id: "numbering-schemes", label: "Numbering schemes exist", script: "scripts/check/numbering-schemes.js" },
  { id: "schedulers", label: "Every scheduler is started", script: "scripts/check/schedulers.js" },
  { id: "production-environment-refs", label: "Only release/rollback reach production", script: "scripts/check/production-environment-refs.js" },
  { id: "ai-vendor-imports", label: "No AI vendor imports outside services/ai", script: "scripts/check/ai-vendor-imports.js" },
  { id: "ai-actions", label: "Every AI call names a registered action", script: "scripts/check/ai-actions.js" },
  { id: "shell", label: "Shell scripts LF and parse", script: "scripts/check/shell.js" },
  { id: "pagination", label: "Every list pages at 25", script: "scripts/check/pagination.js" },
  { id: "provenance", label: "Code never names its origin project", script: "scripts/check/provenance.js" },
  // Frontend: the design system and both apps (packages/ui, app, public-app)
  { id: "components-catalogue", label: "Component catalogue is generated and current", script: "scripts/gen/components.js", args: ["--check"] },
  { id: "components", label: "Every component documented, tested, in the gallery", script: "scripts/check/components.js" },
  { id: "fe-typecheck", label: "Frontend typecheck", npm: "fe:typecheck", group: "frontend" },
  { id: "fe-lint", label: "Frontend lint", npm: "fe:lint", group: "frontend" },
  { id: "fe-test", label: "Frontend tests", npm: "fe:test", group: "frontend" },
  { id: "fe-build", label: "Frontend build (gallery, app, public site)", npm: "fe:build", group: "frontend" },
  { id: "mock-free", label: "Release builds carry no mock", script: "scripts/check/mock-free.js", group: "frontend" },
  { id: "a11y", label: "Accessibility (axe on the gallery and the app)", script: "scripts/check/a11y.js", group: "screens" },
  // Process: the work is recorded where the team reads it
  { id: "progress", label: "PROGRESS.md updated and well formed", script: "scripts/check/progress.js" },
  { id: "guides", label: "Feature guides followed and complete", script: "scripts/check/guides.js" },
  { id: "readme-map", label: "New files are on the README map", script: "scripts/check/readme-map.js" },
  { id: "user-guide", label: "User Guide matches the screens", script: "scripts/check/user-guide.js" },
  { id: "codeowners", label: "CODEOWNERS complete and valid", script: "scripts/check/codeowners.js" },
];

const GROUPS = ["backend", "frontend", "screens", "checks"];
const groupOf = (gate) => gate.group || "checks";
if (GROUP && !GROUPS.includes(GROUP)) {
  console.error(`--group=${GROUP}: it must be one of ${GROUPS.join(", ")}`);
  process.exit(2);
}

function isEmpty(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return true;
  return fs.readFileSync(file, "utf8").trim() === "";
}

/** npm's own CLI, run with this node: the one that launched us, else the one installed beside node. */
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((f) => f && /npm-cli\.js$/.test(f) && fs.existsSync(f)) || null;
}

function command(gate) {
  if (gate.npm) {
    const cli = npmCli();
    if (!cli) return { missing: "npm's CLI was not found beside node" };
    return { argv: [cli, "run", gate.npm] };
  }
  if (gate.tool) {
    const [pkg, rel] = gate.tool;
    const file = bin(pkg, rel);
    if (!fs.existsSync(file)) return { missing: `${pkg} is not installed; run npm ci` };
    return { argv: [file, ...(gate.args || [])] };
  }
  if (isEmpty(gate.script)) return { notBuilt: true };
  return { argv: [path.join(ROOT, gate.script), ...(gate.args || [])] };
}

if (has("groups")) {
  const out = Object.fromEntries(GROUPS.map((g) => [g, GATES.filter((x) => groupOf(x) === g).map((x) => x.id)]));
  console.log(JSON.stringify({ groups: out, doc_gates: scope.DOC_GATES }, null, 2));
  process.exit(0);
}

if (has("list")) {
  for (const g of GATES) {
    const c = command(g);
    const state = c.notBuilt ? "not built" : c.missing ? "missing tool" : "ready";
    console.log(`${g.id.padEnd(28)} ${g.label.padEnd(52)} ${state}`);
  }
  process.exit(0);
}

/** Runs one gate in its own process; its output is kept for the report. */
function run(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (err) => resolve({ status: 1, out: `${out}${err.message}` }));
    child.on("close", (status) => resolve({ status, out }));
  });
}

/** One gate's result: PASS, FAIL, SKIPPED or NOT BUILT, with its output when it ran. */
async function check(gate, tag) {
  if (SCOPE !== "full" && !scope.DOC_GATES.includes(gate.id)) return { gate, status: "SKIPPED" };
  const c = command(gate);
  if (c.notBuilt) return { gate, status: "NOT BUILT" };
  if (c.missing) return { gate, status: "FAIL", output: c.missing };
  // One after another, the line opens as the gate starts; at once, it is written whole as it ends.
  if (!tag) process.stdout.write(`▸ ${gate.label} … `);
  const started = Date.now();
  // Beside the other groups, the frontend's tests leave two CPUs to the backend's tests and the screens' browser.
  const share = tag && !process.env.MYCITY_TEST_WORKERS ? { MYCITY_TEST_WORKERS: String(Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 2)) } : {};
  const r = await run(c.argv, { ...process.env, ...share });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = r.status === 0;
  if (tag) console.log(`▸ ${gate.label} … ${ok ? "ok" : "FAILED"} (${secs}s)  [${tag}]`);
  else console.log(`${ok ? "ok" : "FAILED"} (${secs}s)`);
  return { gate, status: ok ? "PASS" : "FAIL", output: r.out.trim() };
}

/** The gates of one lane, in order; with --fast, none after the first failure. */
async function lane(gates, tag) {
  const out = [];
  for (const gate of gates) {
    const r = await check(gate, tag);
    out.push(r);
    if (FAST && r.status === "FAIL") break;
  }
  return out;
}

/** Whether something answers on a URL's host and port within two seconds. */
function answers(url, port) {
  const u = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect({ host: u.hostname, port: Number(u.port) || port });
    const done = (ok) => (socket.destroy(), resolve(ok));
    socket.setTimeout(2000, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function main() {
  const chosen = GATES.filter((g) => (!ONLY || ONLY.has(g.id)) && (!GROUP || groupOf(g) === GROUP));
  /*
   * With RUN_DB_TESTS=1 the backend group needs PostgreSQL and Redis. One that had stopped cost a
   * ten-minute run that failed every integration file (27/10/2026): say so before starting.
   */
  if (process.env.RUN_DB_TESTS === "1" && chosen.some((g) => groupOf(g) === "backend")) {
    const down = [];
    if (process.env.DATABASE_URL && !(await answers(process.env.DATABASE_URL, 5432))) down.push("PostgreSQL");
    if (process.env.REDIS_URL && !(await answers(process.env.REDIS_URL, 6379))) down.push("Redis");
    if (down.length) {
      console.error(`npm run ci: ${down.join(" and ")} not answering. Start ${down.length > 1 ? "them" : "it"} first (a cloud session: bash .claude/hooks/session-start.sh).`);
      process.exit(2);
    }
  }
  const groups = GROUPS.map((g) => chosen.filter((x) => groupOf(x) === g)).filter((l) => l.length);
  const together = !SERIAL && groups.length > 1;
  if (together) console.log(`Running ${groups.length} groups at once: ${groups.map((l) => groupOf(l[0])).join(", ")}. --serial runs one gate at a time.\n`);
  const started = Date.now();
  const done = together ? (await Promise.all(groups.map((l) => lane(l, groupOf(l[0]))))).flat() : await lane(chosen, null);
  // The report keeps GATES order, whichever group finished first.
  const order = new Map(GATES.map((g, i) => [g, i]));
  return { results: done.sort((a, b) => order.get(a.gate) - order.get(b.gate)), secs: Math.round((Date.now() - started) / 1000) };
}

main().then(({ results, secs }) => {
  const failed = results.filter((r) => r.status === "FAIL");
  const notBuilt = results.filter((r) => r.status === "NOT BUILT");
  const skipped = results.filter((r) => r.status === "SKIPPED");
  const passed = results.filter((r) => r.status === "PASS");

  for (const r of failed) {
    console.log(`\n──── FAILED: ${r.gate.label} ────`);
    console.log(r.output || "(no output)");
  }

  console.log("\n════ Summary ════");
  console.log(`passed     ${passed.length}`);
  console.log(`failed     ${failed.length}${failed.length ? `: ${failed.map((r) => r.gate.id).join(", ")}` : ""}`);
  console.log(`not built  ${notBuilt.length}${notBuilt.length ? `: ${notBuilt.map((r) => r.gate.id).join(", ")}` : ""}`);
  console.log(`time       ${Math.floor(secs / 60)} min ${secs % 60} s`);
  if (skipped.length)
    console.log(`skipped    ${skipped.length}: scope ${SCOPE}, so only the gates that read documents ran`);
  if (notBuilt.length) {
    console.log(
      STRICT
        ? "\n--strict: a gate that is not built counts as a failure."
        : "\nNot built means the gate's script is still an empty file: those rules are NOT being checked yet.",
    );
  }

  // Not process.exit(): a failed gate's report can be long, and into a pipe (CI) exit drops what is
  // still being written, the summary included.
  process.exitCode = failed.length || (STRICT && notBuilt.length) ? 1 : 0;
}, (err) => {
  console.error(`ci-local: ${err.stack || err.message}`);
  process.exitCode = 1;
});
