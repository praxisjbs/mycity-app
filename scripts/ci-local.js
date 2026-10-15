#!/usr/bin/env node
"use strict";
/**
 * `npm run ci`: every gate, in CI's order, with the whole report at the end.
 *
 * The same command runs locally before a push and as the only step of
 * .github/workflows/ci.yml, so a green run here and a green run in CI mean the
 * same thing. It does not stop at the first failure (unless --fast): five
 * unrelated breakages are five lines in one report, not five round trips.
 *
 * NOT BUILT IS NOT PASSED. Most gate scripts exist as empty files until their
 * M0 slice is written. Running an empty file exits 0, which would print a
 * green tick for a check that checks nothing. So an empty gate is reported as
 * NOT BUILT, listed at the end, and does not count as passed. With --strict
 * (CI switches this on once M0 is complete) a NOT BUILT gate fails the run.
 *
 *   node scripts/ci-local.js            everything, full report
 *   node scripts/ci-local.js --fast     stop at the first failure
 *   node scripts/ci-local.js --strict   NOT BUILT counts as a failure
 *   node scripts/ci-local.js --list     print the gates and exit
 *   node scripts/ci-local.js --only=progress,guides   run just these (by id)
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(`--${flag}`);
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice(7).split(",")) : null;
const FAST = has("fast");
const STRICT = has("strict") || process.env.CI_STRICT === "1";

const bin = (pkg, rel) => path.join(ROOT, "node_modules", pkg, rel);

/**
 * id      short name for --only
 * label   what the report prints
 * script  repo-relative script, run with node; empty file = NOT BUILT
 * args    extra arguments
 * tool    [package, bin path] for a dependency's CLI (eslint, jest)
 */
const GATES = [
  // Gates 1 to 8 (M0)
  {
    id: "lint",
    label: "1  Lint",
    tool: ["eslint", "bin/eslint.js"],
    args: ["--max-warnings", "0", "."],
  },
  {
    id: "test",
    label: "2  Tests, whole suite",
    tool: ["jest", "bin/jest.js"],
    args: ["--ci"],
  },
  {
    id: "migration-numbers",
    label: "3  Migration numbering",
    script: "scripts/check/migration-numbers.js",
  },
  {
    id: "migration-reversibility",
    label: "4  Migration reversibility",
    script: "scripts/check/migration-reversibility.js",
  },
  {
    id: "migration-idempotency",
    label: "5  Migration idempotency",
    script: "scripts/check/migration-idempotency.js",
  },
  {
    id: "schema-drift",
    label: "6  Schema drift",
    script: "scripts/check/schema-drift.js",
  },
  {
    id: "contract-columns",
    label: "6  Contract keys are columns",
    script: "scripts/check/contract-columns.js",
  },
  {
    id: "route-contracts",
    label: "7  Write routes validated",
    script: "scripts/check/route-contracts.js",
  },
  {
    id: "dashes",
    label: "8  Five-second rule (backend half) / 17 No dashes",
    script: "scripts/check/dashes.js",
  },
  // Gates from M1 onward
  {
    id: "ai-manifest-coverage",
    label: "9  AI manifest coverage",
    script: "scripts/check/ai-manifest-coverage.js",
  },
  {
    id: "search-coverage",
    label: "10 Search coverage",
    script: "scripts/check/search-coverage.js",
  },
  {
    id: "date-format",
    label: "15 Day-first dates",
    script: "scripts/check/date-format.js",
  },
  {
    id: "ai-no-writes",
    label: "19 AI read manifest only",
    script: "scripts/check/ai-no-writes.js",
  },
  { id: "money", label: "20 Money", script: "scripts/check/money.js" },
  // Pipeline guards
  {
    id: "contract",
    label: "Contract is generated and current",
    script: "scripts/gen/contract.js",
    args: ["--check"],
  },
  {
    id: "env-template",
    label: ".env.example matches the schema",
    script: "scripts/check/env-template.js",
  },
  {
    id: "module-catalogue",
    label: "Module catalogue equals enforced keys",
    script: "scripts/check/module-catalogue.js",
  },
  {
    id: "public-surface",
    label: "Public routes import no auth",
    script: "scripts/check/public-surface.js",
  },
  {
    id: "numbering-schemes",
    label: "Numbering schemes exist",
    script: "scripts/check/numbering-schemes.js",
  },
  {
    id: "production-environment-refs",
    label: "Only release/rollback reach production",
    script: "scripts/check/production-environment-refs.js",
  },
  {
    id: "ai-vendor-imports",
    label: "No AI vendor imports outside services/ai",
    script: "scripts/check/ai-vendor-imports.js",
  },
  {
    id: "shell",
    label: "Shell scripts LF and parse",
    script: "scripts/check/shell.js",
  },
  {
    id: "pagination",
    label: "Every list pages at 25",
    script: "scripts/check/pagination.js",
  },
  {
    id: "provenance",
    label: "Code never names its origin project",
    script: "scripts/check/provenance.js",
  },
  // Process: the work is recorded where the team reads it
  {
    id: "progress",
    label: "PROGRESS.md updated and well formed",
    script: "scripts/check/progress.js",
  },
  {
    id: "guides",
    label: "Feature guides followed and complete",
    script: "scripts/check/guides.js",
  },
  {
    id: "readme-map",
    label: "New files are on the README map",
    script: "scripts/check/readme-map.js",
  },
  {
    id: "codeowners",
    label: "CODEOWNERS complete and valid",
    script: "scripts/check/codeowners.js",
  },
];

function isEmpty(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return true;
  return fs.readFileSync(file, "utf8").trim() === "";
}

function command(gate) {
  if (gate.tool) {
    const [pkg, rel] = gate.tool;
    const file = bin(pkg, rel);
    if (!fs.existsSync(file))
      return { missing: `${pkg} is not installed; run npm ci` };
    return { argv: [file, ...(gate.args || [])] };
  }
  if (isEmpty(gate.script)) return { notBuilt: true };
  return { argv: [path.join(ROOT, gate.script), ...(gate.args || [])] };
}

if (has("list")) {
  for (const g of GATES) {
    const c = command(g);
    const state = c.notBuilt
      ? "not built"
      : c.missing
        ? "missing tool"
        : "ready";
    console.log(`${g.id.padEnd(28)} ${g.label.padEnd(52)} ${state}`);
  }
  process.exit(0);
}

const results = [];
for (const gate of GATES) {
  if (ONLY && !ONLY.has(gate.id)) continue;
  const c = command(gate);
  if (c.notBuilt) {
    results.push({ gate, status: "NOT BUILT" });
    continue;
  }
  if (c.missing) {
    results.push({ gate, status: "FAIL", output: c.missing });
    if (FAST) break;
    continue;
  }
  process.stdout.write(`▸ ${gate.label} … `);
  const started = Date.now();
  const r = spawnSync(process.execPath, c.argv, {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const ok = r.status === 0;
  console.log(`${ok ? "ok" : "FAILED"} (${secs}s)`);
  results.push({
    gate,
    status: ok ? "PASS" : "FAIL",
    output: `${r.stdout || ""}${r.stderr || ""}`.trim(),
  });
  if (!ok && FAST) break;
}

const failed = results.filter((r) => r.status === "FAIL");
const notBuilt = results.filter((r) => r.status === "NOT BUILT");
const passed = results.filter((r) => r.status === "PASS");

for (const r of failed) {
  console.log(`\n──── FAILED: ${r.gate.label} ────`);
  console.log(r.output || "(no output)");
}

console.log("\n════ Summary ════");
console.log(`passed     ${passed.length}`);
console.log(
  `failed     ${failed.length}${failed.length ? `: ${failed.map((r) => r.gate.id).join(", ")}` : ""}`,
);
console.log(
  `not built  ${notBuilt.length}${notBuilt.length ? `: ${notBuilt.map((r) => r.gate.id).join(", ")}` : ""}`,
);
if (notBuilt.length) {
  console.log(
    STRICT
      ? "\n--strict: a gate that is not built counts as a failure."
      : "\nNot built means the gate's script is still an empty file: those rules are NOT being checked yet.",
  );
}

const exitCode = failed.length || (STRICT && notBuilt.length) ? 1 : 0;
process.exit(exitCode);
