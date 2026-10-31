"use strict";
/**
 * How much of `npm run ci` a run in GitHub Actions needs. ci.yml asks once, before installing
 * anything, so a run that needs little costs little (TB, 19/10/2026: a week of CI used GitHub's
 * monthly Actions minutes in under three days).
 *
 *   full    every gate. The default, and always the answer on a laptop
 *   docs    the change touches documents only: Markdown at the root, under docs/ or directly in
 *           .github/, never one that code or tests read (READ_BY_CODE). Only the gates that read
 *           documents run (DOC_GATES)
 *   tested  a push to main whose tree a pull request's full run already passed. That run tested
 *           the pull request merged into main as main then was; the same tree means main has not
 *           moved since, so nothing it passed can fail now. The document gates run again: on a
 *           push they read the merged pull request's trailers. Likewise an edit to a pull
 *           request's description when a full run on its head already passed this tree: only the
 *           document gates read a description, so only they run again (27/10/2026)
 *
 * A draft pull request runs no CI at all (ci.yml): its author runs `npm run ci` while working,
 * and the run starts when the pull request is marked ready.
 *
 *   node scripts/ci-local.js --decide-scope    prints the scope; in Actions, writes it to the
 *                                              step's outputs as `scope` and `reason`
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const changes = require("./changes");

/** The gates that read documents (by their id in ci-local.js): all a docs or tested run needs. */
const DOC_GATES = ["dashes", "components-catalogue", "components", "progress", "guides", "readme-map", "codeowners", "user-guide"];

/**
 * Documents that code reads: a change to one is a code change. The delivery plan is read from
 * both (packages/contract/plan.js readPlan): by the apps' build (packages/ui/vite.shared.js,
 * deliveryPlan) and by the API where there is no build (src/shared/delivery-plan.js); two
 * backend tests read PROGRESS.md. tests/unit/ci-scope.test.js keeps this list level with plan.js.
 */
const READ_BY_CODE = new Set(["docs/PROGRESS.md", "docs/MyCity-ERP-Documents/MILESTONES.md"]);

/** The artifact a pull request's full run leaves: the tree it passed (ci.yml). */
const TREE_ARTIFACT = "ci-tree";
const TREE_FILE = "ci-tree.txt";

/** A document no gate but the document gates can be affected by. */
function isDocument(file) {
  if (!/\.md$/i.test(file) || READ_BY_CODE.has(file)) return false;
  return !file.includes("/") || file.startsWith("docs/") || /^\.github\/[^/]+$/.test(file);
}

/** "docs" when every file the change touched is a document, else "full". */
function scopeOfFiles(files) {
  return files.length > 0 && files.every((f) => isDocument(f.path)) ? "docs" : "full";
}

/** gh, with the job's token. Returns stdout, or null when the call failed. */
function gh(args) {
  const r = spawnSync(process.env.MYCITY_GH || "gh", args, {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "" },
  });
  return r.status === 0 ? r.stdout : null;
}

/** The tree a run of the pull request passed, from its artifact, or null. */
function treeOfRun(repo, runId, call = gh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-tree-"));
  try {
    if (call(["run", "download", String(runId), "-R", repo, "-n", TREE_ARTIFACT, "-D", dir]) === null) return null;
    const file = path.join(dir, TREE_FILE);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A successful pull request run of CI that passed exactly this tree, or null. The pushed commit's
 * pull requests come from GitHub (squash and merge commits both count); each one's final head is
 * looked up among CI's successful pull request runs.
 * @param {{repo: string, sha: string, tree: string, call?: Function, treeOf?: Function}} p
 * @returns {{runId: string, pull: string}|null}
 */
function testedRun({ repo, sha, tree, call = gh, treeOf = treeOfRun }) {
  const pulls = call(["api", `repos/${repo}/commits/${sha}/pulls`, "--jq", '.[] | "\\(.number) \\(.head.sha)"']);
  for (const line of (pulls || "").split("\n").filter(Boolean)) {
    const [pull, head] = line.split(" ");
    const runId = passedRun({ repo, head, tree, call, treeOf });
    if (runId) return { runId, pull };
  }
  return null;
}

/**
 * A successful pull request run of CI on this head that passed exactly this tree (it left the
 * tree as its artifact, which only a full run does), or null.
 * @param {{repo: string, head: string, tree: string, call?: Function, treeOf?: Function}} p
 * @returns {string|null} the run's id
 */
function passedRun({ repo, head, tree, call = gh, treeOf = treeOfRun }) {
  const runs = call([
    "api",
    `repos/${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=20`,
    "--jq",
    ".workflow_runs[].id",
  ]);
  for (const runId of (runs || "").split("\n").filter(Boolean)) {
    if (treeOf(repo, runId, call) === tree) return runId;
  }
  return null;
}

/**
 * The scope of this run, and why.
 * @param {{event?: string, action?: string, files: Array<{path: string}>, repo?: string, sha?: string,
 *          head?: string, tree?: string, tested?: Function, passed?: Function}} p
 * @returns {{scope: "full"|"docs"|"tested", reason: string}}
 */
function decide({ event, action, files, repo, sha, head, tree, tested = testedRun, passed = passedRun }) {
  if (event !== "pull_request" && event !== "push") return { scope: "full", reason: "not a pull request or a push" };
  if (scopeOfFiles(files) === "docs") return { scope: "docs", reason: `${files.length} document(s) changed, nothing else` };
  if (event === "push" && repo && sha && tree) {
    const run = tested({ repo, sha, tree });
    if (run) return { scope: "tested", reason: `pull request #${run.pull} passed this tree in CI run ${run.runId}` };
  }
  if (event === "pull_request" && action === "edited" && repo && head && tree) {
    const runId = passed({ repo, head, tree });
    if (runId) return { scope: "tested", reason: `the description changed, and CI run ${runId} passed this tree` };
  }
  return { scope: "full", reason: "the change touches code, or this tree was not tested" };
}

/** ci-local.js --decide-scope: prints the scope, and hands it to the workflow step in Actions. */
function main() {
  const event = changes.githubEvent() || {};
  const out = changes.IN_CI
    ? decide({
        event: process.env.GITHUB_EVENT_NAME,
        action: event.action,
        files: changes.changedFiles(),
        repo: process.env.GITHUB_REPOSITORY,
        sha: process.env.GITHUB_SHA,
        head: event.pull_request && event.pull_request.head ? event.pull_request.head.sha : undefined,
        tree: changes.git(["rev-parse", "HEAD^{tree}"]).trim(),
      })
    : { scope: "full", reason: "not in GitHub Actions" };
  console.log(`scope: ${out.scope} (${out.reason})`);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `scope=${out.scope}\nreason=${out.reason}\n`);
  return out;
}

module.exports = { DOC_GATES, READ_BY_CODE, TREE_ARTIFACT, TREE_FILE, isDocument, scopeOfFiles, testedRun, passedRun, treeOfRun, decide, main };
