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

/*
 * SETS. A full run is split into sets that CI runs as jobs of their own (ci.yml, plan() below). A
 * pull request runs only the sets its files can affect (GE, 06/11/2026); a push to main, a run by
 * hand, or anything not a pull request runs them all.
 *
 *   backend          the whole jest suite against PostgreSQL and Redis, in JEST_SHARDS jobs, and the
 *                    schema gates
 *   backend-unit     jest without the database: the unit files, a few of which read app/ and
 *                    public-app/ source (new-screen, check-frontend-gates). Run when the frontend
 *                    changed and the backend did not; `backend` already includes it
 *   frontend         the workspaces' typecheck, lint and builds, and the mock check
 *   ui, app, public-app   one workspace's vitest files, in FE_SHARDS jobs
 *   screens-gallery  the screen gates and axe on the gallery (and demo.html when it changed)
 *   screens-app      the same on the staff app's screens; also the gates' static reads of app/ and
 *                    public-app/ source (toasts, copy props, native inputs)
 */
const SETS = Object.freeze(["backend", "backend-unit", "frontend", "ui", "app", "public-app", "screens-gallery", "screens-app"]);

/**
 * The sets a change to one file can affect. Anything not named here (packages/ui, packages/contract,
 * scripts/ and the CI scripts, root config, package-lock.json, .github/, ops/, a page or picture
 * under docs/) runs every set: what it reaches is too wide to name, and a set skipped wrongly lets
 * a broken change through. tests/unit/ci-scope.test.js holds the edges, and holds the facts the
 * narrow rules stand on (no app imports backend code; no integration file reads frontend source).
 * @returns {readonly string[]}
 */
function setsOfFile(file) {
  if (isDocument(file)) return [];
  // The delivery plan: the API, both apps' builds and their tests (vite.config.ts injects it), and
  // the app's screens. Not packages/ui or its gallery, which never read it.
  if (READ_BY_CODE.has(file)) return ["backend", "frontend", "app", "public-app", "screens-app"];
  if (file.startsWith("app/")) return ["backend-unit", "frontend", "app", "screens-app"];
  if (file.startsWith("public-app/")) return ["backend-unit", "frontend", "public-app", "screens-app"];
  if (/^(src|migrations|seeds|templates|tests)\//.test(file)) return ["backend"];
  return SETS;
}

/** Every set any of the files can affect, in SETS order; `backend` takes in `backend-unit`. */
function setsOfFiles(files) {
  const wanted = new Set(files.flatMap((f) => setsOfFile(f.path)));
  if (wanted.has("backend")) wanted.delete("backend-unit");
  return SETS.filter((s) => wanted.has(s));
}

/*
 * How each set is split into jobs on GitHub's runners, so that no job's own work runs past about
 * four minutes (a run under six, wall clock; GE, 06/11/2026). Run 42283369560 on a 4-core runner:
 * jest 937 s in one process (its integration files share one database, so it never used more than
 * one CPU), vitest 960 s for the three workspaces side by side. Alone on four CPUs (06/11/2026)
 * app's files take about twice ui's though ui has more of them (222 s and 87 s on a laptop-class
 * machine, public-app's 14 s), hence more shards for app. Tune these from a run's job times.
 */
const JEST_SHARDS = 6;
const FE_SHARDS = Object.freeze({ ui: 2, app: 3, "public-app": 3 });
/*
 * Jobs per screen target. On four CPUs here (06/11/2026): the gallery's crawl 40 s, its axe 174 s;
 * the app's crawl 170 s, its axe 182 s. A gallery job takes a share of axe's pages
 * (MYCITY_A11Y_SHARD), the first also crawling it whole; an app job takes the same share of the
 * app's screens for the crawl (MYCITY_SCREEN_SHARD) and for axe.
 */
const SCREEN_SHARDS = Object.freeze({ gallery: 4, app: 4 });

/**
 * The matrices ci.yml runs, from the sets a run needs. Each entry is one job; an empty list starts
 * no runner (the job's `if`). The variables each entry sets are read by the scripts that do the
 * work, so `npm run ci` on a laptop, where none is set, still runs everything in one go:
 *   MYCITY_JEST_SHARD   ci-local.js: `jest --shard=i/n`, the slice tests/shard-sequencer.js picks
 *   MYCITY_FE_TESTS     scripts/fe-test.js: which workspaces, and which shard of each
 *   MYCITY_SCREEN_TARGETS, MYCITY_A11Y_TARGETS   lib/screens.js and a11y.js: what they open
 *   MYCITY_A11Y_SHARD, MYCITY_SCREEN_SHARD   a11y.js and lib/screens.js: their share of the
 *                       target's pages (SCREEN_SHARDS below)
 * @param {readonly string[]} sets
 */
function plan(sets) {
  const has = (s) => sets.includes(s);
  const backend = has("backend")
    ? Array.from({ length: JEST_SHARDS }, (_, i) => ({
        name: `backend ${i + 1} of ${JEST_SHARDS}`,
        shard: `${i + 1}/${JEST_SHARDS}`,
        // The schema gates once, in the first shard; every shard runs its slice of jest.
        gates: i === 0 ? "--group=backend" : "--only=test",
      }))
    : [];
  const piecesOf = (ws) => {
    const n = FE_SHARDS[ws];
    return has(ws) ? Array.from({ length: n }, (_, i) => (n === 1 ? ws : `${ws}:${i + 1}/${n}`)) : [];
  };
  // ui's and app's shards are a job each. public-app's are too few for runners of their own: each
  // rides with one of app's shards (or ui's when app is not running), one to a job, so no job runs
  // two big pieces side by side. With neither running, they are jobs of their own.
  const tests = [...piecesOf("app"), ...piecesOf("ui")].map((p) => [p]);
  const hosts = tests.length;
  piecesOf("public-app").forEach((p, k) => (hosts ? tests[k % hosts].push(p) : tests.push([p])));
  const screens = [];
  const screenJobs = (targets, a11y) => {
    const n = SCREEN_SHARDS[a11y];
    for (let i = 1; i <= n; i++) {
      const share = n === 1 ? "" : `${i}/${n}`;
      screens.push({
        name: n === 1 ? `screens ${a11y}` : `screens ${a11y} ${i} of ${n}`,
        targets,
        a11y,
        a11y_shard: share,
        // The gallery's crawl is short and runs whole in its first job; the app's is dealt out.
        screen_shard: a11y === "app" ? share : "",
        gates: a11y === "app" || i === 1 ? "--group=screens" : "--only=a11y",
      });
    }
  };
  if (has("screens-gallery")) screenJobs("gallery,demo", "gallery");
  if (has("screens-app")) screenJobs("app", "app");
  return {
    backend,
    backend_unit: has("backend-unit"),
    frontend: has("frontend"),
    frontend_tests: tests.map((t) => ({ name: `frontend tests ${t.join(" ")}`, tests: t.join(" ") })),
    screens,
    // The tree is recorded for main's run only when this run ran everything (ci.yml).
    all: SETS.every((s) => s === "backend-unit" || has(s)),
  };
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
 * The scope of this run, and why, and the sets it runs (SETS): every one on a full run that is not
 * a pull request; on a pull request, the ones its files can affect; none on a docs or tested run,
 * which runs the document gates alone.
 * @param {{event?: string, action?: string, files: Array<{path: string}>, repo?: string, sha?: string,
 *          head?: string, tree?: string, tested?: Function, passed?: Function}} p
 * @returns {{scope: "full"|"docs"|"tested", reason: string, sets: string[]}}
 */
function decide(p) {
  const out = decideScope(p);
  if (out.scope !== "full") return { ...out, sets: [] };
  if (p.event !== "pull_request") return { ...out, sets: SETS.filter((s) => s !== "backend-unit") };
  return { ...out, sets: setsOfFiles(p.files) };
}

function decideScope({ event, action, files, repo, sha, head, tree, tested = testedRun, passed = passedRun }) {
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

/**
 * ci-local.js --decide-scope: prints the scope and the sets, and hands them to the workflow step in
 * Actions: `scope`, `reason`, `sets` (JSON) and each of plan()'s matrices (JSON).
 */
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
    : { scope: "full", reason: "not in GitHub Actions", sets: SETS.filter((s) => s !== "backend-unit") };
  const jobs = plan(out.sets);
  console.log(`scope: ${out.scope} (${out.reason})`);
  console.log(`sets:  ${out.sets.join(", ") || "none, the document gates alone"}`);
  // backend-unit is part of backend: not "skipped" when backend runs.
  for (const s of SETS) if (!out.sets.includes(s) && !(s === "backend-unit" && out.sets.includes("backend"))) console.log(`  skipped ${s}: ${out.scope === "full" ? "nothing this change touched can affect it" : `scope ${out.scope}`}`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = [`scope=${out.scope}`, `reason=${out.reason}`, `sets=${JSON.stringify(out.sets)}`];
    for (const [k, v] of Object.entries(jobs)) lines.push(`${k}=${JSON.stringify(v)}`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
  return { ...out, jobs };
}

module.exports = {
  DOC_GATES,
  READ_BY_CODE,
  TREE_ARTIFACT,
  TREE_FILE,
  SETS,
  JEST_SHARDS,
  FE_SHARDS,
  SCREEN_SHARDS,
  isDocument,
  scopeOfFiles,
  setsOfFile,
  setsOfFiles,
  plan,
  testedRun,
  passedRun,
  treeOfRun,
  decide,
  main,
};
