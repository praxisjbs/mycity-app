"use strict";
/**
 * npm run new:screen writes every piece of a new staff-app screen at once
 * (scripts/new-screen.js), so the shell, the route map, PROGRESS and the
 * gates never disagree about the screens.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ns = require("../../scripts/new-screen");

const ROOT = path.resolve(__dirname, "..", "..");
const FILES = [
  "app/src/shell/catalogue.ts",
  "app/src/shell/screens.tsx",
  "src/shared/route-map.js",
  "src/shared/search/screens.js",
  "app/src/shell/coming-soon.ts",
  "docs/PROGRESS.md",
  "scripts/check/progress.js",
  "tests/unit/foundation/events-workflow.test.js",
  "app/src/features/people/index.tsx",
  "app/src/features/ess/index.tsx",
];

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-new-screen-"));
  for (const f of FILES) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(tmp, f));
  }
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const args = (o) => Object.entries(o).flatMap(([k, v]) => [`--${k}`, v]);
const write = (p) => {
  for (const [file, text] of p.writes) fs.writeFileSync(path.join(tmp, file), text);
};
const read = (f) => fs.readFileSync(path.join(tmp, f), "utf8");

describe("new:screen", () => {
  test("adds the tab, the slug, the screen, its case, Coming Soon, the PROGRESS row, note and counts", () => {
    const p = ns.plan(args({ module: "people", tab: "Work Patterns", m: "M1", owner: "LA" }), tmp);
    expect(p).toMatchObject({ slug: "work-patterns", name: "WorkPatterns", folder: "people", n: 104 });
    write(p);
    expect(read("app/src/shell/catalogue.ts")).toContain('t("Worksites", "worksites"), t("Work Patterns", "work-patterns")]');
    expect(read("src/shared/route-map.js")).toContain('"departments", "work-patterns"]');
    expect(read("src/shared/search/screens.js")).toContain('  s("people", "work-patterns", "Work Patterns", []),\n  // new:screen adds screens above this line');
    expect(read("app/src/features/people/WorkPatterns.tsx")).toContain('<PageHeader title="Work Patterns" />');
    expect(read("app/src/features/people/index.tsx")).toMatch(/import \{ WorkPatterns \} from "\.\/WorkPatterns";[\s\S]*case "work-patterns":\n\s+return <WorkPatterns \/>;\n\s+default:/);
    expect(read("app/src/shell/coming-soon.ts")).toContain('"people/work-patterns": [],');
    const progress = read("docs/PROGRESS.md");
    expect(progress).toContain("| 104 | Work Patterns | `work-patterns` | M1 | LA | ☐ | ☐ | ☐ | Not started | |");
    expect(progress).toMatch(/- \d{2}\/\d{2}\/\d{4} · LA · Work Patterns added with npm run new:screen/);
    expect(progress).toContain("103 screens (97 in the staff app");
    // The total and its Not started count each go up by one, whatever the tracker held before.
    const [, screens, notStarted] = /\| \*\*Total\*\* \| \*\*(\d+)\*\* \| \*\*(\d+)\*\* \|/.exec(fs.readFileSync(path.join(ROOT, "docs/PROGRESS.md"), "utf8"));
    expect(progress).toContain(`| **Total** | **${Number(screens) + 1}** | **${Number(notStarted) + 1}** |`);
    expect(read("scripts/check/progress.js")).toContain("const SCREENS = 104;");
    expect(read("tests/unit/foundation/events-workflow.test.js")).toContain(".toHaveLength(97)");
  });

  test("keeps a multi-line list multi-line", () => {
    write(ns.plan(args({ module: "ess", tab: "My Training", m: "M2", owner: "AJ" }), tmp));
    expect(read("src/shared/route-map.js")).toMatch(/"org-chart",\n {4}"my-training",\n {2}\]/);
    expect(read("app/src/features/ess/index.tsx")).toContain('case "my-training":');
  });

  test("refuses what the screen rules refuse", () => {
    const refused = (o) => expect(() => ns.plan(args({ module: "people", m: "M1", owner: "LA", ...o }), tmp)).toThrow(ns.Refusal);
    refused({ tab: "Patterns of Work for Staff" });
    refused({ tab: "work patterns" });
    refused({ tab: "Employees" });
    refused({ tab: "Work Patterns", owner: "XX" });
    refused({ tab: "Work Patterns", m: "M12" });
    expect(() => ns.plan(args({ module: "nope", tab: "Work Patterns", m: "M1", owner: "LA" }), tmp)).toThrow(/--module/);
  });
});
