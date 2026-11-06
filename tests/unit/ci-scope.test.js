"use strict";
/**
 * How much of `npm run ci` a run in GitHub Actions needs (scripts/check/lib/scope.js). A rule
 * that skips too much lets a broken change through; one that skips too little costs the Actions
 * minutes it exists to save. Both edges are pinned here, and so is every name the workflow and
 * the build share with it.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  DOC_GATES,
  READ_BY_CODE,
  TREE_ARTIFACT,
  TREE_FILE,
  SETS,
  JEST_SHARDS,
  FE_SHARDS,
  A11Y_SHARDS,
  isDocument,
  scopeOfFiles,
  setsOfFile,
  setsOfFiles,
  plan,
  testedRun,
  passedRun,
  decide,
} = require("../../scripts/check/lib/scope");

const ROOT = path.join(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const files = (...paths) => paths.map((p) => ({ path: p, status: "M" }));

describe("isDocument", () => {
  test("Markdown at the root, under docs/ and directly in .github/ is a document", () => {
    for (const f of ["README.MD", "CLAUDE.md", "docs/guides/home.md", "docs/runbooks/deploy.md", ".github/pull_request_template.md"])
      expect(isDocument(f)).toBe(true);
  });

  test("Markdown that code reads, or that lives with code, is not", () => {
    for (const f of [
      "docs/PROGRESS.md",
      "docs/MyCity-ERP-Documents/MILESTONES.md",
      "src/services/ai/prompts/assistant.md",
      "app/README.md",
      "packages/ui/README.md",
      ".github/workflows/notes.md",
    ])
      expect(isDocument(f)).toBe(false);
  });

  test("a page or a picture under docs/ is not (the screen gates open demo.html)", () => {
    expect(isDocument("docs/MyCity-ERP-Documents/demo.html")).toBe(false);
    expect(isDocument("docs/shots/pane.png")).toBe(false);
  });
});

describe("scopeOfFiles", () => {
  test("docs only when every file is a document", () => {
    expect(scopeOfFiles(files("docs/guides/home.md", "README.MD"))).toBe("docs");
    expect(scopeOfFiles(files("docs/guides/home.md", "src/app.js"))).toBe("full");
    expect(scopeOfFiles(files("docs/guides/home.md", "docs/PROGRESS.md"))).toBe("full");
  });

  test("nothing changed is not a reason to skip anything", () => {
    expect(scopeOfFiles([])).toBe("full");
  });
});

describe("decide", () => {
  const never = () => null;

  test("a run by hand runs everything", () => {
    expect(decide({ event: "workflow_dispatch", files: files("README.MD"), tested: never }).scope).toBe("full");
  });

  test("a pull request of documents runs the document gates; one with code runs everything", () => {
    expect(decide({ event: "pull_request", files: files("docs/guides/home.md"), tested: never }).scope).toBe("docs");
    expect(decide({ event: "pull_request", files: files("src/app.js"), tested: never }).scope).toBe("full");
  });

  test("a pull request never asks whether its tree was tested", () => {
    const tested = jest.fn(() => ({ runId: "1", pull: "2" }));
    expect(decide({ event: "pull_request", files: files("src/app.js"), repo: "o/r", sha: "s", tree: "t", tested }).scope).toBe("full");
    expect(tested).not.toHaveBeenCalled();
  });

  test("a push to main whose tree a pull request's run passed is tested, and says which", () => {
    const tested = jest.fn(() => ({ runId: "39200314369", pull: "71" }));
    const out = decide({ event: "push", files: files("src/app.js"), repo: "o/r", sha: "abc", tree: "def", tested });
    expect(out).toEqual({ scope: "tested", reason: "pull request #71 passed this tree in CI run 39200314369", sets: [] });
    expect(tested).toHaveBeenCalledWith({ repo: "o/r", sha: "abc", tree: "def" });
  });

  test("a push to main whose tree no run passed runs everything", () => {
    expect(decide({ event: "push", files: files("src/app.js"), repo: "o/r", sha: "abc", tree: "def", tested: never }).scope).toBe("full");
  });

  test("an edit to a description whose tree a full run on that head passed runs the document gates, and says which", () => {
    const passed = jest.fn(() => "40485988816");
    const out = decide({ event: "pull_request", action: "edited", files: files("src/app.js"), repo: "o/r", head: "h", tree: "t", passed });
    expect(out).toEqual({ scope: "tested", reason: "the description changed, and CI run 40485988816 passed this tree", sets: [] });
    expect(passed).toHaveBeenCalledWith({ repo: "o/r", head: "h", tree: "t" });
  });

  test("an edit whose tree no full run passed (still running, red, or main moved) runs everything; a push to it never asks", () => {
    expect(decide({ event: "pull_request", action: "edited", files: files("src/app.js"), repo: "o/r", head: "h", tree: "t", passed: never }).scope).toBe("full");
    const passed = jest.fn(() => "1");
    expect(decide({ event: "pull_request", action: "synchronize", files: files("src/app.js"), repo: "o/r", head: "h", tree: "t", passed }).scope).toBe("full");
    expect(passed).not.toHaveBeenCalled();
  });
});

describe("passedRun", () => {
  const github = (runs) => (args) => (/actions\/workflows\/ci\.yml\/runs/.test(args[1] || "") ? runs : null);

  test("finds the successful run on this head that left this tree", () => {
    const treeOf = (repo, runId) => ({ 201: null, 202: "this-tree" })[runId];
    expect(passedRun({ repo: "o/r", head: "h", tree: "this-tree", call: github("201\n202\n"), treeOf })).toBe("202");
  });

  test("a run with no tree (one that ran the document gates only) or another tree, or GitHub not answering: null", () => {
    expect(passedRun({ repo: "o/r", head: "h", tree: "t", call: github("201\n"), treeOf: () => null })).toBeNull();
    expect(passedRun({ repo: "o/r", head: "h", tree: "t", call: github("201\n"), treeOf: () => "older" })).toBeNull();
    expect(passedRun({ repo: "o/r", head: "h", tree: "t", call: () => null, treeOf: () => "t" })).toBeNull();
  });
});

describe("testedRun", () => {
  /** GitHub through gh: the pushed commit's pull requests, then each head's successful CI runs. */
  const github =
    ({ pulls, runs }) =>
    (args) => {
      const url = args[1] || "";
      if (/\/commits\/[^/]+\/pulls$/.test(url)) return pulls;
      if (/actions\/workflows\/ci\.yml\/runs/.test(url)) return runs[/head_sha=([^&]+)/.exec(url)[1]] ?? "";
      return null;
    };

  test("finds the run whose recorded tree is this one", () => {
    const call = github({ pulls: "71 head71\n", runs: { head71: "101\n102\n" } });
    const treeOf = (repo, runId) => ({ 101: "old-tree", 102: "this-tree" })[runId];
    expect(testedRun({ repo: "o/r", sha: "abc", tree: "this-tree", call, treeOf })).toEqual({ runId: "102", pull: "71" });
  });

  test("no run with this tree (main moved before the merge): null", () => {
    const call = github({ pulls: "71 head71\n", runs: { head71: "101\n" } });
    expect(testedRun({ repo: "o/r", sha: "abc", tree: "this-tree", call, treeOf: () => "older-tree" })).toBeNull();
  });

  test("a commit from no pull request, or GitHub not answering: null", () => {
    expect(testedRun({ repo: "o/r", sha: "abc", tree: "t", call: github({ pulls: "", runs: {} }), treeOf: () => "t" })).toBeNull();
    expect(testedRun({ repo: "o/r", sha: "abc", tree: "t", call: () => null, treeOf: () => "t" })).toBeNull();
  });
});

describe("names the workflow and the build share with the scope", () => {
  test("every document the apps' build and the API read the delivery plan from counts as code", () => {
    // packages/contract/plan.js readPlan is the one reader: vite.shared.js hands it `doc`, the API its own.
    const docsThePlanReads = [...read("packages/contract/plan.js").matchAll(/\bread\("([^"]+\.md)"\)/g)].map((m) => m[1]);
    expect(docsThePlanReads.length).toBeGreaterThan(0);
    for (const f of docsThePlanReads) expect(READ_BY_CODE.has(f)).toBe(true);
    expect(read("packages/ui/vite.shared.js")).toMatch(/contractPlan\.readPlan\(doc\)/);
  });

  test("every document gate is a gate ci-local.js runs", () => {
    const ids = [...read("scripts/ci-local.js").matchAll(/\bid: "([^"]+)"/g)].map((m) => m[1]);
    for (const g of DOC_GATES) expect(ids).toContain(g);
  });

  test("ci.yml records and keeps the tree under the names the scope reads", () => {
    const yml = read(".github/workflows/ci.yml");
    expect(yml).toContain(`> ${TREE_FILE}`);
    expect(yml).toContain(`name: ${TREE_ARTIFACT}`);
    expect(yml).toContain(`path: ${TREE_FILE}`);
    expect(yml).toContain("node scripts/ci-local.js --decide-scope");
    expect(yml).toContain("CI_SCOPE: ${{ needs.scope.outputs.scope }}");
  });

  test("ci.yml runs every group of gates, every set in a job, and a job named ci waits for them all", () => {
    const yml = read(".github/workflows/ci.yml");
    const groups = [...read("scripts/ci-local.js").matchAll(/const GROUPS = \[([^\]]+)\]/g)][0][1].match(/"([a-z]+)"/g).map((g) => g.slice(1, -1));
    expect(groups).toEqual(["backend", "frontend", "screens", "checks"]);
    // backend and screens arrive through their matrices (plan() below); the others are in the file.
    for (const g of ["frontend", "checks"]) expect(yml).toContain(`npm run ci -- --group=${g}`);
    expect(yml).toContain("npm run ci -- --group=frontend --except=fe-test");
    expect(yml).toContain("npm run ci -- --only=fe-test");
    expect(yml).toContain("npm run ci -- ${{ matrix.gates }}");
    for (const v of [
      "MYCITY_JEST_SHARD: ${{ matrix.shard }}",
      "MYCITY_FE_TESTS: ${{ matrix.tests }}",
      "MYCITY_SCREEN_TARGETS: ${{ matrix.targets }}",
      "MYCITY_A11Y_TARGETS: ${{ matrix.a11y }}",
      "MYCITY_A11Y_SHARD: ${{ matrix.a11y_shard }}",
    ])
      expect(yml).toContain(v);
    // Each of plan()'s outputs is handed from the scope job and gates its job.
    for (const k of Object.keys(plan(SETS))) expect(yml).toContain(`${k}: \${{ steps.scope.outputs.${k} }}`);
    for (const k of ["backend", "frontend_tests", "screens"]) {
      expect(yml).toContain(`if: needs.scope.outputs.${k} != '[]'`);
      expect(yml).toContain(`include: \${{ fromJSON(needs.scope.outputs.${k}) }}`);
    }
    expect(yml).toContain("if: needs.scope.outputs.backend_unit == 'true'");
    expect(yml).toContain("if: needs.scope.outputs.frontend == 'true'");
    // Branch protection requires the check called "ci": it must wait for every job.
    expect(yml).toContain("  ci:\n    name: ci\n    needs: [scope, backend, backend-unit, frontend, frontend-tests, screens, checks]");
    expect(yml).toContain("needs.scope.outputs.all == 'true'");
  });
});

describe("sets: a pull request runs what its files can affect", () => {
  const ALL = [...SETS];
  test("documents affect nothing; the documents code reads affect what reads the plan, not packages/ui", () => {
    expect(setsOfFile("docs/guides/home.md")).toEqual([]);
    expect(setsOfFile("docs/PROGRESS.md")).toEqual(["backend", "frontend", "app", "public-app", "screens-app"]);
    expect(setsOfFile("docs/MyCity-ERP-Documents/MILESTONES.md")).toEqual(setsOfFile("docs/PROGRESS.md"));
  });

  test("app/ alone: its tests, the frontend gates, the app's screens and jest's unit files; not ui, public-app or the gallery", () => {
    expect(setsOfFiles(files("app/src/features/home/index.tsx"))).toEqual(["backend-unit", "frontend", "app", "screens-app"]);
  });

  test("public-app/ alone: its tests, the frontend gates, the app's screens job (it reads public-app's source) and jest's unit files", () => {
    expect(setsOfFiles(files("public-app/src/main.tsx"))).toEqual(["backend-unit", "frontend", "public-app", "screens-app"]);
  });

  test("the backend alone skips every frontend job", () => {
    for (const f of ["src/modules/people/people.service.js", "migrations/0700_x.sql", "seeds/reference/x.js", "templates/mail/x.html", "tests/integration/x.test.js"])
      expect(setsOfFiles(files(f))).toEqual(["backend"]);
  });

  test("packages/, scripts/, root config, the lockfile, .github/, ops/ and pages under docs/ run everything", () => {
    for (const f of [
      "packages/ui/src/Button.tsx",
      "packages/contract/schemas/people.js",
      "scripts/check/a11y.js",
      "scripts/ci-local.js",
      "package.json",
      "package-lock.json",
      "jest.config.js",
      ".nvmrc",
      ".github/workflows/ci.yml",
      "ops/nginx/hub.conf",
      "docs/MyCity-ERP-Documents/demo.html",
    ])
      expect(setsOfFile(f)).toEqual(ALL);
  });

  test("sets add up, in one order, and the full backend takes in its unit files", () => {
    expect(setsOfFiles(files("app/a.tsx", "src/b.js"))).toEqual(["backend", "frontend", "app", "screens-app"]);
    expect(setsOfFiles(files("app/a.tsx", "public-app/b.tsx", "README.MD"))).toEqual(["backend-unit", "frontend", "app", "public-app", "screens-app"]);
    expect(setsOfFiles(files("app/a.tsx", "package-lock.json"))).toEqual(ALL.filter((s) => s !== "backend-unit"));
  });

  test("decide: a pull request's sets come from its files; a push, a run by hand or a full edit run them all; docs and tested none", () => {
    const never = () => null;
    expect(decide({ event: "pull_request", files: files("app/a.tsx"), tested: never }).sets).toEqual(["backend-unit", "frontend", "app", "screens-app"]);
    const everything = ALL.filter((s) => s !== "backend-unit");
    expect(decide({ event: "push", files: files("app/a.tsx"), repo: "o/r", sha: "s", tree: "t", tested: never }).sets).toEqual(everything);
    expect(decide({ event: "workflow_dispatch", files: files("app/a.tsx") }).sets).toEqual(everything);
    expect(decide({ event: "pull_request", files: files("docs/guides/home.md") }).sets).toEqual([]);
    expect(decide({ event: "push", files: files("src/a.js"), repo: "o/r", sha: "s", tree: "t", tested: () => ({ runId: "1", pull: "2" }) }).sets).toEqual([]);
  });
});

describe("plan: the jobs a run starts", () => {
  const everything = SETS.filter((s) => s !== "backend-unit");

  test("a full run: every jest shard once, the schema gates once, every workspace's every shard once, both screen targets", () => {
    const p = plan(everything);
    expect(p.backend.map((j) => j.shard)).toEqual(Array.from({ length: JEST_SHARDS }, (_, i) => `${i + 1}/${JEST_SHARDS}`));
    expect(p.backend.filter((j) => j.gates === "--group=backend")).toHaveLength(1);
    expect(p.backend.filter((j) => j.gates === "--only=test")).toHaveLength(JEST_SHARDS - 1);
    const pieces = p.frontend_tests.flatMap((j) => j.tests.split(" "));
    const want = Object.entries(FE_SHARDS).flatMap(([ws, n]) => (n === 1 ? [ws] : Array.from({ length: n }, (_, i) => `${ws}:${i + 1}/${n}`)));
    expect([...pieces].sort()).toEqual([...want].sort());
    // The crawl gates once per target (with gallery,demo and app between them), axe's every shard once.
    const crawls = p.screens.filter((j) => j.gates === "--group=screens");
    expect(crawls.map((j) => j.targets).join(",").split(",").sort()).toEqual(["app", "demo", "gallery"]);
    expect(p.screens.filter((j) => j.gates !== "--group=screens").every((j) => j.gates === "--only=a11y")).toBe(true);
    for (const [t, n] of Object.entries(A11Y_SHARDS)) {
      const shards = p.screens.filter((j) => j.a11y === t).map((j) => j.a11y_shard);
      expect(shards).toEqual(n === 1 ? [""] : Array.from({ length: n }, (_, i) => `${i + 1}/${n}`));
    }
    expect(p.frontend).toBe(true);
    expect(p.backend_unit).toBe(false);
    expect(p.all).toBe(true);
  });

  test("names are unique, so each job is its own check", () => {
    const p = plan(everything);
    const names = [...p.backend, ...p.frontend_tests, ...p.screens].map((j) => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("public-app rides with another shard, or runs alone when nothing else does", () => {
    expect(plan(["public-app"]).frontend_tests).toEqual([{ name: "frontend tests public-app", tests: "public-app" }]);
    expect(plan(["app", "public-app"]).frontend_tests.at(-1).tests).toMatch(/^app:\d+\/\d+ public-app$/);
  });

  test("no sets, no jobs: the document gates alone", () => {
    expect(plan([])).toEqual({ backend: [], backend_unit: false, frontend: false, frontend_tests: [], screens: [], all: false });
  });

  test("a narrowed run is not all, so main runs everything after its merge", () => {
    expect(plan(["backend-unit", "frontend", "app", "screens-app"]).all).toBe(false);
  });
});

describe("the facts the narrow sets stand on", () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel, out);
      else out.push(rel);
    }
    return out;
  };

  test("no frontend source imports the backend (src/, migrations/, seeds/, templates/), so the backend alone skips the frontend", () => {
    const backend = /^(src|migrations|seeds|templates)\//;
    const bad = [];
    for (const f of ["app", "public-app", "packages/ui"].flatMap((d) => walk(d)).filter((x) => /\.(ts|tsx|js|mjs|cjs)$/.test(x))) {
      for (const m of read(f).matchAll(/(?:from\s+|require\(|import\()\s*["'](\.{1,2}\/[^"']+)["']/g)) {
        const target = path.relative(ROOT, path.resolve(ROOT, path.dirname(f), m[1])).split(path.sep).join("/");
        if (backend.test(target)) bad.push(`${f} -> ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("no integration file names frontend source, so a frontend change needs jest's unit files only", () => {
    const bad = walk("tests/integration").filter((f) => /(^|["'`/\s])(app|public-app|packages\/ui)\/(src|dist|gallery|vite|index|package)/.test(read(f)));
    expect(bad).toEqual([]);
  });

  test("packages/ui's tests and gallery never read the delivery plan, so PROGRESS.md skips them", () => {
    for (const f of walk("packages/ui/gallery").filter((x) => /config\.(ts|js)$/.test(x)).concat("packages/ui/vitest.config.ts"))
      expect(read(f)).not.toMatch(/deliveryPlan|readPlan|PROGRESS/);
  });
});

describe("tests/shard-sequencer.js: jest's backend shards", () => {
  const { deal, cost } = require("../shard-sequencer");

  test("every file goes to exactly one shard, the same deal every time", () => {
    const paths = Array.from({ length: 40 }, (_, i) => `/r/tests/integration/f${i}.test.js`);
    const costOf = (p) => 1000 + Number(/f(\d+)/.exec(p)[1]) * 37;
    const a = deal(paths, 5, costOf);
    const b = deal([...paths].reverse(), 5, costOf);
    expect([...a.owner.keys()].sort()).toEqual([...paths].sort());
    for (const p of paths) expect(a.owner.get(p)).toBe(b.owner.get(p));
    expect(new Set(a.owner.values())).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  test("the shards come out level: none carries more than its share and the longest file", () => {
    const paths = Array.from({ length: 90 }, (_, i) => `/r/tests/integration/f${i}.test.js`);
    const costOf = (p) => 3000 + ((Number(/f(\d+)/.exec(p)[1]) * 7919) % 20000);
    const { loads } = deal(paths, 5, costOf);
    const total = loads.reduce((x, y) => x + y, 0);
    const longest = Math.max(...paths.map(costOf));
    for (const l of loads) expect(l).toBeLessThanOrEqual(total / 5 + longest);
  });

  test("an integration file costs more than a unit file of the same size", () => {
    const file = path.join(ROOT, "tests", "unit", "ci-scope.test.js");
    const asIntegration = path.join(ROOT, "tests", "integration", "x.test.js");
    expect(cost(asIntegration)).toBeGreaterThan(cost(file));
  });

  test("jest uses it, and only --shard calls into it", () => {
    expect(read("jest.config.js")).toContain('testSequencer: "<rootDir>/tests/shard-sequencer.js"');
    const Seq = require("../shard-sequencer");
    expect(Object.getOwnPropertyNames(Seq.prototype)).toEqual(["constructor", "shard"]);
  });
});

describe("a11y.js shards", () => {
  const { shardOf } = require("../../scripts/check/a11y");
  test("n shards take every page once between them; unset takes all", () => {
    const pages = Array.from({ length: 11 }, (_, i) => `P${i}`);
    const got = [1, 2, 3].flatMap((i) => shardOf(pages, { i, n: 3 }));
    expect(got.sort()).toEqual([...pages].sort());
    expect(shardOf(pages, null)).toEqual(pages);
  });
});
