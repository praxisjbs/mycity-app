#!/usr/bin/env node
"use strict";
/**
 * Claude Code Stop hook: before Claude ends its turn, run the process gates
 * on the work it has done (committed or not). If PROGRESS.md was not updated,
 * a feature guide was bypassed, a new file is not on the README map, or the
 * User Guide no longer matches a screen the change touched (or a picture of
 * it is stale), Claude is told exactly what is missing and keeps working
 * instead of stopping (exit 2, message on stderr).
 *
 * It catches the miss inside the session, where it costs one more step,
 * instead of at review. CI runs the same checks for every PR, whoever or
 * whatever wrote it; this hook only makes Claude meet them first.
 *
 * Screen gates. When the change touches the design system, either app or the
 * demo (packages/ui/, app/, public-app/, docs/MyCity-ERP-Documents/demo.html),
 * the hook also runs the fast frontend gates: components (F8), palette (13),
 * forms (12), dashes (17), five-second (8), two-shells (11) and native-ui (21)
 * (FRONTEND_GUIDE §5, §7, §8; FRONTEND_FOUNDATION F4, F8, F25). They are the conventions agreed on
 * 8 and 15 October; a session that broke one does not get to stop. The slow
 * ones (a11y, mock-free, the builds) are left to npm run ci.
 *
 * Loop guard. If the checks still fail after Claude has been sent back twice
 * in a row in the same session, the hook lets it stop and prints the problems
 * to the user rather than looping. The count resets on a clean run.
 *
 * Registered in .claude/settings.json (committed, so it applies to everyone
 * using Claude Code in this repository).
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const MAX_BLOCKS = 2;
/* A cloud session's image has its own Chromium, not the build the repository's Playwright pins:
   the screen gates use it when nothing else is set (session-start.sh sets it for the session's
   own commands). */
const CLOUD_CHROMIUM = "/opt/pw-browsers/chromium";
if (process.env.CLAUDE_CODE_REMOTE === "true" && !process.env.MYCITY_CHROMIUM && fs.existsSync(CLOUD_CHROMIUM))
  process.env.MYCITY_CHROMIUM = CLOUD_CHROMIUM;
const CHECKS = ["progress", "guides", "readme-map", "user-guide"];
const SCREEN_CHECKS = ["components", "palette", "forms", "dashes", "five-second", "two-shells", "native-ui"];
const TOUCHES_SCREENS = /^(packages\/ui|app|public-app)\/|^docs\/MyCity-ERP-Documents\/demo\.html$/;

function screensChanged() {
  try {
    const { changedFiles } = require(path.join(ROOT, "scripts", "check", "lib", "changes.js"));
    return changedFiles().some((c) => TOUCHES_SCREENS.test(c.path));
  } catch {
    return false; // the process checks report a git problem themselves
  }
}

let input = {};
try {
  const raw = fs.readFileSync(0, "utf8");
  if (raw.trim()) input = JSON.parse(raw);
} catch {
  input = {};
}

const session = String(input.session_id || "unknown").replace(/[^A-Za-z0-9_-]/g, "");
const counter = path.join(os.tmpdir(), `mycity-stop-check-${session}`);
const readCount = () => {
  try {
    return Number(fs.readFileSync(counter, "utf8")) || 0;
  } catch {
    return 0;
  }
};
const writeCount = (n) => {
  try {
    if (n === 0) fs.rmSync(counter, { force: true });
    else fs.writeFileSync(counter, String(n));
  } catch {
    /* a missing counter only weakens the loop guard; the checks still run */
  }
};

const failures = [];
for (const id of screensChanged() ? [...CHECKS, ...SCREEN_CHECKS] : CHECKS) {
  const script = path.join(ROOT, "scripts", "check", `${id}.js`);
  if (!fs.existsSync(script)) continue;
  const r = spawnSync(process.execPath, [script], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) failures.push(`${(r.stderr || r.stdout || "").trim()}`);
}

if (!failures.length) {
  writeCount(0);
  process.exit(0);
}

// A stop that is not itself the result of a block starts a fresh count.
const blocks = input.stop_hook_active === false ? 0 : readCount();
const report = failures.join("\n\n");

if (blocks >= MAX_BLOCKS) {
  writeCount(0);
  console.log(`MyCity process checks still failing; stopping so a person can decide:\n\n${report}`);
  process.exit(0);
}

writeCount(blocks + 1);
console.error(
  "Before finishing, fix these (CLAUDE.md step 5). Update docs/PROGRESS.md, the feature guide and the " +
    "User Guide chapter (docs/manual), or, if they genuinely do not apply, tell the user why and suggest the PR trailer " +
    '("Progress-unchanged: <reason>" / "Guide-unchanged: <reason>" / "User-guide-unchanged: <reason>"). ' +
    "A stale User Guide picture has no trailer: retake it (npm run guide:shots -- --stale).\n\n" +
    report,
);
process.exit(2);
