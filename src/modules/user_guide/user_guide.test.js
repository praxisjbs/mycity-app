"use strict";
/**
 * The User Guide's own reasoning, without a database: the chapters read from a folder, put in
 * the rail's order, and cut to a reader down to the step (docs/guides/user-guide.md §6.3). The
 * API against the real migrations is tests/integration/user-guide.test.js.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const service = require("./user_guide.service");

const PEOPLE = `---
title: People
module: people
milestones: M0
summary: The staff register.
---

## Employees {#people-employees screen=people/employees}

The register. See [Integrations](/settings?tab=integrations) and [Users](#settings-users).

### Add an employee {#people-add-employee needs="people create"}

1. Open [People · Employees](/people?tab=employees).
2. {needs="settings edit"} Check the numbering first.
3. Press **Add Employee**.
`;

const SETTINGS = `---
title: Settings
module: settings
milestones: M0
summary: How the hub is set up.
---

## Users {#settings-users screen=settings/users}

Every login.

## Integrations {#settings-integrations screen=settings/integrations}

Mail and AI providers.
`;

const START = `---
title: Getting Started
order: 0
summary: Signing in and finding your way.
---

## Signing in {#start-sign-in}

Open the hub and sign in.
`;

const OLD = "# Mailbox\n\nWritten before the guide had its format.\n";

/** A reader as ⌘K builds one: grants by module, capabilities, CEO, manages people. */
const reader = (grants, extra = {}) => service.asReader({ grants, capabilities: [], is_ceo: false, manages_people: false, ...extra });
/** The CEO, as readerOf gives them: every action on every module. */
const catalog = require("../../shared/access/access.catalog");
const ceo = () => reader(Object.fromEntries(catalog.MODULES.map((m) => [m, [...catalog.ACTIONS]])), { is_ceo: true });
/** Operations & People: the register and Settings, not Integrations. */
const OPS = { people: ["view", "create"], settings: ["view"] };

let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mycity-guide-"));
  fs.writeFileSync(path.join(dir, "people.md"), PEOPLE);
  fs.writeFileSync(path.join(dir, "settings.md"), SETTINGS);
  fs.writeFileSync(path.join(dir, "getting-started.md"), START);
  fs.writeFileSync(path.join(dir, "mailbox.md"), OLD);
  fs.writeFileSync(path.join(dir, "home.md"), "");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the chapters", () => {
  test("are read in the rail's order, Getting Started first, and a file not yet in the format is left out", () => {
    const guide = service.load({ dir, fresh: true });
    expect(guide.chapters.map((c) => c.slug)).toEqual(["getting-started", "people", "settings"]);
  });
});

describe("what a reader receives", () => {
  const guide = () => service.load({ dir, fresh: true });

  test("a member of staff reads only the chapters about what they may open", () => {
    const mine = service.cut(guide(), reader({ knowledge: ["view"] }));
    expect(mine.chapters.map((c) => c.slug)).toEqual(["getting-started"]);
  });

  test("a section about a tab goes with the tab: Integrations needs its own grant, not Settings'", () => {
    const admin = service.cut(guide(), reader({ settings: ["view", "edit"] }));
    expect(admin.chapters.find((c) => c.slug === "settings").sections.map((s) => s.slug)).toEqual(["settings-users"]);
    const it = service.cut(guide(), reader({ settings: ["view"], integrations: ["view"] }));
    expect(it.chapters.find((c) => c.slug === "settings").sections.map((s) => s.slug)).toEqual(["settings-users", "settings-integrations"]);
  });

  test("a step the reader may not take is not sent, and the steps are numbered without it", () => {
    const ops = service.cut(guide(), reader(OPS));
    const task = ops.chapters.find((c) => c.slug === "people").sections[0].tasks[0];
    const steps = task.blocks.find((b) => b.kind === "steps").items;
    expect(steps.map((s) => s.n)).toEqual([1, 2]);
    expect(JSON.stringify(steps)).not.toMatch(/numbering/);
  });

  test("a task needing a grant the reader lacks is not sent at all", () => {
    const viewer = service.cut(guide(), reader({ ...OPS, people: ["view"] }));
    expect(viewer.chapters.find((c) => c.slug === "people").sections[0].tasks).toEqual([]);
  });

  test("a link to a screen or a section the reader may not open is plain text", () => {
    const ops = service.cut(guide(), reader(OPS));
    const spans = ops.chapters.find((c) => c.slug === "people").sections[0].blocks[0].spans;
    expect(spans.find((s) => s.text === "Integrations").href).toBeNull();
    expect(spans.find((s) => s.text === "Users").href).toBe("#settings-users");
    const all = service.cut(guide(), ceo());
    const theirs = all.chapters.find((c) => c.slug === "people").sections[0].blocks[0].spans;
    expect(theirs.find((s) => s.text === "Integrations").href).toBe("/settings?tab=integrations");
  });

  test("the CEO reads everything", () => {
    const all = service.cut(guide(), ceo());
    expect(all.chapters.map((c) => c.slug)).toEqual(["getting-started", "people", "settings"]);
  });
});

describe("the real chapters", () => {
  test("every chapter in docs/manual reads without problems", () => {
    const { parseChapter } = require("@mycity/contract/guide");
    for (const f of fs.readdirSync(service.MANUAL).filter((x) => x.endsWith(".md") && x !== "README.md")) {
      const text = fs.readFileSync(path.join(service.MANUAL, f), "utf8");
      if (!text.startsWith("---")) continue;
      expect({ file: f, problems: parseChapter(text, f).problems }).toEqual({ file: f, problems: [] });
    }
  });
});
