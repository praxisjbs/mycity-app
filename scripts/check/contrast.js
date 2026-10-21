#!/usr/bin/env node
"use strict";
/**
 * Gate 14, contrast (FRONTEND_FOUNDATION F3; MILESTONES §3, §5).
 *
 * Every text pair the screens use keeps WCAG AA (4.5:1) in both themes: light,
 * dark as chosen ([data-theme=dark]) and dark from the device setting, which
 * must also equal the chosen dark. The pair table and the ratio maths live in
 * ONE place, the contract (packages/contract/schemas/appearance.js, which also
 * derives a palette saved on Settings · Appearance); the token test
 * packages/ui/src/styles/tokens.test.ts reads tokens.css against them, and this
 * gate runs exactly that test, so a token edited without its pair holding fails
 * here by name, not in an axe run on one screen.
 *
 * Refuses: a failing pair (text token, surface token, the two values and the
 * ratio are printed), a token a pair needs that is missing, a device-dark
 * block that differs from the chosen dark, and a missing test file (a gate
 * with nothing to run fails; it never passes).
 *
 * Usage: node scripts/check/contrast.js     exit 0 ok, 1 problems
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const UI = path.join(ROOT, "packages", "ui");
const TEST = "src/styles/tokens.test.ts";

function fail(message) {
  console.error(`contrast: ${message}`);
  console.error(
    "\nEvery text pair keeps 4.5:1 in light and dark (FRONTEND_FOUNDATION F3). Fix the value in\n" +
      "packages/ui/src/styles/tokens.css (derived tokens carry their ratio in a comment) or the pair table in\n" +
      `packages/ui/${TEST}; never lower the bar.`,
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(UI, TEST))) fail(`packages/ui/${TEST} is missing: the contrast pairs have nothing to check them`);

let vitest;
try {
  vitest = path.join(path.dirname(require.resolve("vitest/package.json", { paths: [UI] })), "vitest.mjs");
} catch {
  fail("vitest is not installed for packages/ui; run npm ci");
}

const r = spawnSync(process.execPath, [vitest, "run", TEST, "--reporter=verbose"], {
  cwd: UI,
  encoding: "utf8",
  env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  maxBuffer: 64 * 1024 * 1024,
});
const output = `${r.stdout || ""}${r.stderr || ""}`.trim();
if (r.status !== 0) fail(`a token pair falls below AA, or the token test did not run\n\n${output}`);

// Both themes must actually have been checked, not merely a test file that passes.
if (!/✓[^\n]*AA in light/.test(output) || !/✓[^\n]*AA in dark/.test(output)) {
  fail(`the token test ran but no longer checks every pair in both themes ("AA in light", "AA in dark")\n\n${output}`);
}

const passed = (output.match(/✓[^\n]*/g) || []).map((l) => `  ${l.trim()}`);
console.log(`contrast: ok (packages/ui/${TEST}, light and both darks)`);
for (const l of passed) console.log(l);
