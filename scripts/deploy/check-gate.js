#!/usr/bin/env node
"use strict";
/**
 * Is the server running the deploy-gate this release was built with?
 *
 *   ssh mycity-deploy@<host> status > gate-status.txt
 *   node scripts/deploy/check-gate.js --status=gate-status.txt --sha=<commit> [--host=<ip>]
 *
 * Run by release.yml before `stage` and before `promote`. A release never carries
 * scripts/deploy, so nothing a deploy does can replace /srv/mycity/bin/deploy-gate: only a person
 * on the server can (docs/runbooks/deploy.md §5). When the repository's copy changes and nobody
 * installs it, every deploy still runs the old one, and whatever the new one added (the staff
 * roster step, for one) silently never happens.
 *
 * `status` prints `gate<TAB>sha256=<hex>` first. A gate older than that line prints none, which is
 * out of date by definition. On a mismatch this exits 1 before anything on the server is touched,
 * and writes the steps that fix it, with this commit's exact download and the hash to check, to
 * the job summary (GITHUB_STEP_SUMMARY) as well as the log.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..");
const GATE = path.join(ROOT, "scripts", "deploy", "deploy-gate");
const INSTALLED = "/srv/mycity/bin/deploy-gate";

/** The fingerprint a `status` answer reports, or null when the gate predates it. */
function reported(statusText) {
  const m = /^gate\tsha256=([0-9a-f]{64})$/m.exec(statusText || "");
  return m ? m[1] : null;
}

function expected(gatePath = GATE) {
  return crypto.createHash("sha256").update(fs.readFileSync(gatePath)).digest("hex");
}

/** The steps that fix an out-of-date gate, in Markdown, for this commit. */
function remedy({ sha, want, got, host = "<server address>", repo = "praxisjbs/mycity-app" }) {
  const short = sha.slice(0, 12);
  return [
    "## The server's deploy-gate is out of date",
    "",
    `Nothing was deployed. The server runs deploy-gate ${got ? `\`${got.slice(0, 12)}…\`` : "from before gates reported their version"};`,
    `release \`${short}\` was built with \`${want.slice(0, 12)}…\`.`,
    "",
    "A deploy never replaces the gate, on purpose: it is the one command CI may run on the server,",
    "so only a person with sudo there can change it. Install this commit's copy, then re-run.",
    "",
    "**1. On the server**",
    "",
    "```sh",
    `ssh administrator@${host}`,
    "```",
    "",
    "**2. Download the gate from this exact commit.** A GitHub token with read access to the",
    "repository's contents (GitHub, Settings, Developer settings, Personal access tokens):",
    "",
    "```sh",
    'curl -fsSL -H "Authorization: Bearer <your-token>" \\',
    '  -H "Accept: application/vnd.github.raw" \\',
    `  "https://api.github.com/repos/${repo}/contents/scripts/deploy/deploy-gate?ref=${sha}" \\`,
    "  -o ~/deploy-gate",
    "```",
    "",
    "Or from a computer with the repository checked out at this commit:",
    `\`scp scripts/deploy/deploy-gate administrator@${host}:~/deploy-gate\``,
    "",
    "**3. Check it is the right file.** This must print exactly the hash below:",
    "",
    "```sh",
    "sha256sum ~/deploy-gate",
    "```",
    "",
    `\`${want}\``,
    "",
    "**4. Install it and tidy up**",
    "",
    "```sh",
    `sudo install -m 755 -o root -g root ~/deploy-gate ${INSTALLED}`,
    `sha256sum ${INSTALLED}`,
    "rm ~/deploy-gate",
    "```",
    "",
    "**5. Re-run this workflow**: Actions, this run, *Re-run failed jobs*.",
    "",
    "Full detail: `docs/runbooks/deploy.md` §5.",
  ].join("\n");
}

/** @returns {{ ok: boolean, got: string|null, want: string }} */
function check(statusText, gatePath = GATE) {
  const want = expected(gatePath);
  const got = reported(statusText);
  return { ok: got === want, got, want };
}

function parseArgs(argv) {
  const a = {};
  for (const arg of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(arg);
    if (m) a[m[1]] = m[2];
  }
  return a;
}

function main(argv) {
  const a = parseArgs(argv);
  if (!a.status || !/^[0-9a-f]{40}$/.test(a.sha || "")) {
    console.error("usage: check-gate.js --status=<file> --sha=<40-character sha> [--host=<ip>]");
    return 2;
  }
  const r = check(fs.readFileSync(a.status, "utf8"));
  if (r.ok) {
    console.log(`check-gate: ok, the server runs deploy-gate ${r.want.slice(0, 12)}`);
    return 0;
  }
  const text = remedy({ sha: a.sha, want: r.want, got: r.got, host: a.host || undefined, repo: process.env.GITHUB_REPOSITORY || undefined });
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  console.log(
    "::error title=deploy-gate out of date::The server runs an old deploy-gate, so nothing was deployed. " +
      "The job summary lists the five steps that install this commit's copy; then re-run failed jobs.",
  );
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { reported, expected, check, remedy };
