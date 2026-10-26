"use strict";
/**
 * The User Guide's parser and filter (packages/contract/guide.js; docs/guides/user-guide.md §6.2, §6.3).
 */
const { parseChapter, filterChapter, parseNeeds, parseInline, boldNames, linksOf } = require("../../packages/contract/guide");

const CHAPTER = `---
title: People
module: people
milestones: M0
summary: The staff register.
---

## Employees {#people-employees screen=people/employees}

The staff register, by **Department**.

![The register](shot:people-list)

### Add an employee {#people-add-employee needs="people create"}

1. Open [People · Employees](/people?tab=employees).
2. Press **Add Employee**. ![The first step](shot:people-add)
3. {needs="settings view"} Check the numbering on [Documents & Numbering](/settings?tab=documents-and-numbering).
4. Press **Next**.

> **Tip:** See [Roles](#settings-roles) first.

| Field | What to Enter |
|---|---|
| **First Name** | Their first name |
| {needs="ceo"} **Gross Monthly** | Their pay |

## Organogram {#people-organogram screen=people/organogram}

Seats and lines.

\`\`\`shot people-list
open: /people?tab=employees
as: operations
marks:
  1: button "Add Employee" | Add a person
  2: searchbox | Find anyone
\`\`\`

\`\`\`shot people-add
open: /people?tab=employees&action=new
device: desktop
crop: modal
\`\`\`
`;

const reader = ({ screens = [], grants = [] } = {}) => ({
  screen: (m, t) => screens.includes(`${m}/${t}`),
  holds: (n) => (n.kind === "grant" ? grants.includes(`${n.module} ${n.action}`) : false),
});

describe("parseChapter", () => {
  test("reads front matter, sections, tasks, steps, notes, tables and pictures", () => {
    const { chapter, problems } = parseChapter(CHAPTER, "people.md");
    expect(problems).toEqual([]);
    expect(chapter).toMatchObject({ slug: "people", title: "People", module: "people", milestones: ["M0"] });
    expect(chapter.sections.map((s) => s.slug)).toEqual(["people-employees", "people-organogram"]);
    const [employees] = chapter.sections;
    expect(employees.screen).toEqual({ module: "people", tab: "employees" });
    expect(employees.tasks[0]).toMatchObject({ slug: "people-add-employee", needs: [{ kind: "grant", module: "people", action: "create" }] });
    const steps = employees.tasks[0].blocks[0];
    expect(steps.kind).toBe("steps");
    expect(steps.items).toHaveLength(4);
    expect(steps.items[1].figure).toEqual({ shot: "people-add", alt: "The first step" });
    expect(steps.items[1].spans.map((s) => s.text).join("")).toBe("Press Add Employee.");
    expect(steps.items[2].needs).toEqual([{ kind: "grant", module: "settings", action: "view" }]);
    expect(employees.tasks[0].blocks[1]).toMatchObject({ kind: "note", tone: "tip" });
    expect(employees.tasks[0].blocks[2].kind).toBe("table");
    expect(chapter.shots["people-list"].marks).toEqual([
      { n: 1, target: { kind: "button", name: "Add Employee" }, text: "Add a person" },
      { n: 2, target: { kind: "searchbox", name: null }, text: "Find anyone" },
    ]);
    expect(chapter.shots["people-add"]).toMatchObject({ devices: ["desktop"], crop: "modal", as: "operations" });
  });

  test("lists bold names and links for the gate", () => {
    const { chapter } = parseChapter(CHAPTER, "people.md");
    expect(boldNames(chapter).map((b) => b.text)).toEqual(["Department", "Add Employee", "Next", "First Name", "Gross Monthly"]);
    expect(linksOf(chapter).map((l) => l.href)).toEqual(["/people?tab=employees", "/settings?tab=documents-and-numbering", "#settings-roles"]);
  });

  test("refuses what it does not read", () => {
    const bad = `---\ntitle: X\nwho: me\n---\n\n# Title\n\n## No slug\n\n#### Too deep\n\n![Oops](shot:missing)\n\n\`\`\`js\nx\n\`\`\`\n`;
    const { problems } = parseChapter(bad, "x.md");
    expect(problems.join("\n")).toMatch(/unknown key "who"/);
    expect(problems.join("\n")).toMatch(/start sections with ##/);
    expect(problems.join("\n")).toMatch(/give the heading its slug/);
    expect(problems.join("\n")).toMatch(/no deeper than ###/);
    expect(problems.join("\n")).toMatch(/picture missing has no/);
    expect(problems.join("\n")).toMatch(/only fenced block is a picture spec/);
  });

  test("a picture spec may open the lock screen, for one of its three reasons", () => {
    const spec = (step) => `---\ntitle: X\n---\n\n## A {#a}\n\n![Locked](shot:locked)\n\n\`\`\`shot locked\nopen: /home\ndo:\n  - ${step}\n\`\`\`\n`;
    const ok = parseChapter(spec("lock: idle"), "x.md");
    expect(ok.problems).toEqual([]);
    expect(ok.chapter.shots.locked.do).toEqual([{ action: "lock", reason: "idle" }]);
    expect(parseChapter(spec("lock: asleep"), "x.md").problems).toEqual(['x.md: shot locked, line 12: lock reads "lock: idle", "lock: time" or "lock: ended"']);
  });

  test("a picture of a prompt that opens once per sign-in keeps it (prompt: keep), and nothing else", () => {
    const spec = (line) => `---\ntitle: X\n---\n\n## A {#a}\n\n![Owed](shot:owed)\n\n\`\`\`shot owed\nopen: /ess?tab=policy-updates\n${line}\n\`\`\`\n`;
    const ok = parseChapter(spec("prompt: keep"), "x.md");
    expect(ok.problems).toEqual([]);
    expect(ok.chapter.shots.owed.prompt).toBe("keep");
    expect(parseChapter(spec("crop: modal"), "x.md").chapter.shots.owed.prompt).toBeNull();
    expect(parseChapter(spec("prompt: close"), "x.md").problems).toEqual(["x.md: shot owed, line 11: prompt is keep"]);
  });

  test("a need may be team, or either of two", () => {
    const { needs, problems } = parseNeeds("workspace create, team, manager or cap performance.manage");
    expect(problems).toEqual([]);
    expect(needs).toEqual([
      { kind: "grant", module: "workspace", action: "create" },
      { kind: "team" },
      { kind: "any", of: [{ kind: "manager" }, { kind: "cap", code: "performance.manage" }] },
    ]);
    expect(parseNeeds("manager or nobody").problems).toEqual(['needs "nobody" reads "<module> <action>", "cap <code>", "manager", "team" or "ceo", and "<one> or <another>" for either']);
  });

  test("a picture spec's step may run on one device only", () => {
    const md = `---\ntitle: X\n---\n\n## A {#a}\n\n![Cards](shot:cards)\n\n\`\`\`shot cards\nopen: /home\ndo:\n  - desktop click: button "Choose Cards"\n  - phone click: button "More Actions"\n  - wait: button "Save Cards"\n  - tablet click: button "X"\n\`\`\`\n`;
    const { chapter, problems } = parseChapter(md, "x.md");
    expect(chapter.shots.cards.do).toEqual([
      { action: "click", target: { kind: "button", name: "Choose Cards" }, device: "desktop" },
      { action: "click", target: { kind: "button", name: "More Actions" }, device: "phone" },
      { action: "wait", target: { kind: "button", name: "Save Cards" } },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/line 15: a do step reads/);
  });

  test("a picture spec nobody shows is a problem", () => {
    const text = "---\ntitle: X\n---\n\n## A {#a}\n\nText.\n\n```shot unused\nopen: /home\n```\n";
    expect(parseChapter(text, "x.md").problems).toEqual(["x.md: picture spec unused is not shown anywhere"]);
  });
});

describe("filterChapter", () => {
  const { chapter } = parseChapter(CHAPTER, "people.md");

  test("a reader who may not open the tab receives nothing", () => {
    expect(filterChapter(chapter, reader())).toBeNull();
  });

  test("a viewer gets the section but not the task that needs create", () => {
    const out = filterChapter(chapter, reader({ screens: ["people/employees"], grants: ["people view"] }));
    expect(out.sections.map((s) => s.slug)).toEqual(["people-employees"]);
    expect(out.sections[0].tasks).toEqual([]);
    expect(out.pictures.map((p) => p.shot)).toEqual(["people-list"]);
    expect(out.pictures[0].legend).toEqual([{ n: 1, text: "Add a person" }, { n: 2, text: "Find anyone" }]);
  });

  test("steps a reader may not take are cut and the rest renumbered; closed links go plain", () => {
    const out = filterChapter(chapter, reader({ screens: ["people/employees"], grants: ["people view", "people create"] }), { slugs: new Set(["people-employees"]) });
    const steps = out.sections[0].tasks[0].blocks[0].items;
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3]);
    expect(steps[2].spans.map((s) => s.text).join("")).toBe("Press Next.");
    expect(JSON.stringify(out)).not.toMatch(/needs/);
    const tip = out.sections[0].tasks[0].blocks[1];
    expect(tip.spans.find((s) => s.text === "Roles").href).toBeNull();
    const table = out.sections[0].tasks[0].blocks[2];
    expect(table.rows).toHaveLength(1);
  });

  test("a link to a screen the reader may not open becomes plain text", () => {
    const out = filterChapter(chapter, reader({ screens: ["people/employees"], grants: ["people view", "people create", "settings view"] }));
    const step = out.sections[0].tasks[0].blocks[0].items[2];
    expect(step.spans.find((s) => s.text === "Documents & Numbering").href).toBeNull();
    const first = out.sections[0].tasks[0].blocks[0].items[0];
    expect(first.spans.find((s) => s.text === "People · Employees").href).toBe("/people?tab=employees");
  });
});

describe("needs and inline text", () => {
  test("needs read grants, capabilities, managers and the CEO", () => {
    expect(parseNeeds("people create, cap home.team, manager, ceo").needs).toEqual([
      { kind: "grant", module: "people", action: "create" },
      { kind: "cap", code: "home.team" },
      { kind: "manager" },
      { kind: "ceo" },
    ]);
    expect(parseNeeds("people").problems).toHaveLength(1);
  });

  test("inline marks and escapes", () => {
    const r = parseInline("Type `name@mycityapp.io`, press **Save**, see *Ada* \\*not bold\\*.");
    expect(r.spans).toEqual([
      { text: "Type ", bold: false, italic: false, code: false, href: null },
      { text: "name@mycityapp.io", bold: false, italic: false, code: true, href: null },
      { text: ", press ", bold: false, italic: false, code: false, href: null },
      { text: "Save", bold: true, italic: false, code: false, href: null },
      { text: ", see ", bold: false, italic: false, code: false, href: null },
      { text: "Ada", bold: false, italic: true, code: false, href: null },
      { text: " *not bold*.", bold: false, italic: false, code: false, href: null },
    ]);
  });
});
