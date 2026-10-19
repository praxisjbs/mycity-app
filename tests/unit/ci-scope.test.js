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
  isDocument,
  scopeOfFiles,
  testedRun,
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
    expect(out).toEqual({ scope: "tested", reason: "pull request #71 passed this tree in CI run 39200314369" });
    expect(tested).toHaveBeenCalledWith({ repo: "o/r", sha: "abc", tree: "def" });
  });

  test("a push to main whose tree no run passed runs everything", () => {
    expect(decide({ event: "push", files: files("src/app.js"), repo: "o/r", sha: "abc", tree: "def", tested: never }).scope).toBe("full");
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
  test("every document the apps' build reads counts as code", () => {
    const docsTheBuildReads = [...read("packages/ui/vite.shared.js").matchAll(/\bdoc\("([^"]+\.md)"\)/g)].map((m) => m[1]);
    expect(docsTheBuildReads.length).toBeGreaterThan(0);
    for (const f of docsTheBuildReads) expect(READ_BY_CODE.has(f)).toBe(true);
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
    expect(yml).toContain("CI_SCOPE: ${{ steps.scope.outputs.scope }}");
  });
});
