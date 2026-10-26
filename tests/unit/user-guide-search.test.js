"use strict";
/**
 * Searching the User Guide (packages/contract/guide-search.js and guide.js passagesOf;
 * docs/guides/user-guide.md §6.8): the passages, who receives them, and the words half's ranking,
 * on its own and with the meaning half's similarities.
 */
const { parseChapter, passagesOf, passageFor } = require("../../packages/contract/guide");
const engine = require("../../packages/contract/guide-search");

const PEOPLE = `---
title: People
module: people
summary: The staff register.
---

## Employees {#people-employees screen=people/employees}

Everyone who works for MyCity, one row each.

![The Employees screen](shot:people-list)

### Add an employee {#people-add-employee needs="people create"}

1. Open [People · Employees](/people?tab=employees).
2. {needs="settings view"} Check the numbering on Settings first.
3. Press **Add Employee** at the top right. ![The first step](shot:people-add)
4. Fill in **First Name** and **Last Name**, then press **Next**.

| Field | What to Enter |
|---|---|
| **Gross Monthly** | Their pay before deductions |

### Give someone a login {#people-give-login}

1. Open the person's record and press **Give Login**.

## Leave {#people-leave screen=people/leave}

Who is away, and the requests waiting on you.

### Approve or reject leave {#people-approve-leave needs="leave approve"}

1. Press the request.
2. Press **Approve**. The person is told.

\`\`\`shot people-list
open: /people?tab=employees
marks:
  1: button "Add Employee" | Add a person
\`\`\`

\`\`\`shot people-add
open: /people?tab=employees
marks:
  1: button "Next" | The next step
\`\`\`
`;

const START = `---
title: Getting Started
order: 0
summary: Signing in.
---

## Signing in {#start-sign-in}

Open the hub and sign in with your work email.

### Forgot your password {#start-forgot-password}

1. On the sign-in screen, press **Forgot Password**.
2. Type your work email. A link to choose a new password arrives.
`;

const chapters = [parseChapter(START, "getting-started.md").chapter, parseChapter(PEOPLE, "people.md").chapter];
const index = engine.indexOf(chapters.flatMap(passagesOf));
const { passages } = index;

/** A reader as user_guide.service asReader gives one. */
const readerOf = ({ tabs = [], grants = [] } = {}) => ({
  screen: (module, tab) => tabs.includes(`${module}/${tab}`),
  holds: (need) => need.kind === "grant" && grants.includes(`${need.module} ${need.action}`),
});
const everyone = { screen: () => true, holds: () => true };
const all = engine.visibleTo(index, everyone, passageFor);
const titles = (hits) => hits.map((h) => h.title);

describe("the passages", () => {
  test("each title, line, row, picture and step, and one whole passage per section and task", () => {
    const kinds = passages.reduce((m, p) => ({ ...m, [p.kind]: (m[p.kind] || 0) + 1 }), {});
    expect(kinds).toEqual({ title: 7, whole: 7, text: 5, step: 9 });
    const step = passages.find((p) => p.kind === "step" && p.text.startsWith("Press Add Employee"));
    expect(step).toMatchObject({ anchor: "people-add-employee", context: "People › Employees › Add an employee", also: "The first step" });
    const row = passages.find((p) => p.text.startsWith("Field:"));
    expect(row.text).toBe("Field: Gross Monthly; What to Enter: Their pay before deductions");
    const picture = passages.find((p) => p.text.startsWith("The Employees screen"));
    expect(picture.text).toBe("The Employees screen. Add a person");
  });

  test("a whole passage leaves out what only some of its readers receive", () => {
    const whole = passages.find((p) => p.kind === "whole" && p.anchor === "people-add-employee");
    expect(whole.text).toContain("Press Add Employee");
    expect(whole.text).not.toContain("numbering");
  });

  test("a reader receives what filterChapter would send them, steps numbered as they read them", () => {
    const viewer = engine.visibleTo(index, readerOf({ tabs: ["people/employees"] }), passageFor);
    const anchors = new Set([...viewer.keys()].map((i) => passages[i].anchor));
    expect([...anchors]).toEqual(["start-sign-in", "start-forgot-password", "people-employees", "people-give-login"]);

    const creator = engine.visibleTo(index, readerOf({ tabs: ["people/employees"], grants: ["people create"] }), passageFor);
    const press = passages.find((p) => p.text.startsWith("Press Add Employee"));
    expect(creator.get(press.id)).toEqual({ step: 2 });
    const both = engine.visibleTo(index, readerOf({ tabs: ["people/employees"], grants: ["people create", "settings view"] }), passageFor);
    expect(both.get(press.id)).toEqual({ step: 3 });
  });

  test("what the meaning index embeds is where a passage sits, what it says and its picture's words", () => {
    const press = passages.find((p) => p.text.startsWith("Press Add Employee"));
    expect(engine.meaningText(press)).toBe("People › Employees › Add an employee\nPress Add Employee at the top right.\nThe first step");
  });
});

describe("the words half", () => {
  test("stems plurals and tenses to one word", () => {
    expect(["approve", "approval", "approved", "approving"].map(engine.stem)).toEqual(["approv", "approv", "approv", "approv"]);
    expect(["employees", "employee"].map(engine.stem)).toEqual(["employe", "employe"]);
    expect(engine.stem("hopping")).toBe("hop");
    expect(engine.stem("2fa")).toBe("2fa");
  });

  test("counts a slip of a letter, two swapped, and gives up past the limit", () => {
    expect(engine.distance("pasword", "password", 2)).toBe(1);
    expect(engine.distance("passowrd", "password", 2)).toBe(1);
    expect(engine.distance("abc", "xyzuvw", 2)).toBe(3);
  });

  test("finds a task by its words, best first, and opens it at the step that says them", () => {
    const hits = engine.search(index, "add employee", { visible: all });
    expect(hits[0]).toMatchObject({ anchor: "people-add-employee", kind: "task", chapter: "people", section: "people-employees", step: 3, by: "words" });
    expect(hits[0].snippet.filter((s) => s.hit).map((s) => s.text)).toEqual(["Add", "Employee"]);
  });

  test("forgives a typo, a word half typed and another word for the same thing", () => {
    expect(titles(engine.search(index, "pasword", { visible: all }))[0]).toBe("Forgot your password");
    expect(titles(engine.search(index, "forg", { visible: all }))[0]).toBe("Forgot your password");
    expect(titles(engine.search(index, "authorise time off", { visible: all }))[0]).toBe("Approve or reject leave");
  });

  test("a word that only helps does not stop a passage being found", () => {
    expect(titles(engine.search(index, "how do I take time off", { visible: all })).slice(0, 2)).toContain("Approve or reject leave");
  });

  test("a word the guide never uses does not stop the others being found", () => {
    expect(titles(engine.search(index, "apply for leave", { visible: all }))).toContain("Approve or reject leave");
    expect(engine.search(index, "zebra quokka", { visible: all })).toEqual([]);
  });

  test("a short search no passage holds every word of finds those holding one", () => {
    const found = titles(engine.search(index, "password leave", { visible: all }));
    expect(found).toEqual(expect.arrayContaining(["Forgot your password", "Approve or reject leave"]));
  });

  test("a title typed in full comes first", () => {
    expect(titles(engine.search(index, "give someone a login", { visible: all }))[0]).toBe("Give someone a login");
  });

  test("never finds what the reader may not read", () => {
    const viewer = engine.visibleTo(index, readerOf({ tabs: ["people/employees"] }), passageFor);
    expect(titles(engine.search(index, "approve leave", { visible: viewer }))).toEqual([]);
    expect(titles(engine.search(index, "numbering", { visible: viewer }))).toEqual([]);
  });

  test("cuts a long line around the words found", () => {
    const long = [{ kind: "text", text: `${"Filler words here. ".repeat(20)}The needle is here. ${"More words after. ".repeat(20)}`, also: "", context: "C › S", anchor: "s", chapter: "c", chapter_title: "C", section: "s", section_title: "S", task: null, task_title: null, screen: null, needs: [], earlier: null }];
    const small = engine.indexOf(long);
    const [hit] = engine.search(small, "needle", { visible: new Map([[0, { step: null }]]) });
    const text = hit.snippet.map((s) => s.text).join("");
    expect(text.startsWith("…")).toBe(true);
    expect(text.endsWith("…")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(204);
    expect(hit.snippet.find((s) => s.hit).text).toBe("needle");
  });
});

describe("with the meaning half", () => {
  test("a description the words miss is found by its meaning", () => {
    const forgot = passages.find((p) => p.kind === "whole" && p.anchor === "start-forgot-password");
    const meaning = new Map([[forgot.id, 0.61]]);
    const hits = engine.search(index, "locked out of my account", { visible: all, meaning });
    expect(hits[0]).toMatchObject({ anchor: "start-forgot-password", by: "meaning", step: null });
    expect(hits[0].snippet.map((s) => s.text).join("")).toBe("On the sign-in screen, press Forgot Password.");
  });

  test("a passage found both ways rises above one found one way", () => {
    const login = passages.find((p) => p.kind === "whole" && p.anchor === "people-give-login");
    const press = passages.find((p) => p.text.startsWith("Press Add Employee"));
    const meaning = new Map([
      [login.id, 0.5],
      [press.id, 0.55],
    ]);
    const hits = engine.search(index, "add employee", { visible: all, meaning });
    expect(hits[0]).toMatchObject({ anchor: "people-add-employee", by: "both", step: 3 });
  });

  test("a passage far below the best match, or below the floor, is left out", () => {
    const forgot = passages.find((p) => p.kind === "whole" && p.anchor === "start-forgot-password");
    const leave = passages.find((p) => p.kind === "whole" && p.anchor === "people-leave");
    const meaning = new Map([
      [forgot.id, 0.6],
      [leave.id, 0.45],
    ]);
    expect(titles(engine.search(index, "zzz", { visible: all, meaning }))).toEqual(["Forgot your password"]);
    expect(engine.search(index, "zzz", { visible: all, meaning: new Map([[leave.id, engine.MEANING_FLOOR - 0.01]]) })).toEqual([]);
  });

  test("the meaning half never brings back what the reader may not read", () => {
    const approve = passages.find((p) => p.kind === "whole" && p.anchor === "people-approve-leave");
    const viewer = engine.visibleTo(index, readerOf({ tabs: ["people/employees", "people/leave"] }), passageFor);
    expect(engine.search(index, "zzz", { visible: viewer, meaning: new Map([[approve.id, 0.9]]) })).toEqual([]);
  });
});

describe("an answer's sources", () => {
  test("a task's lines as the reader reads them, steps numbered", () => {
    const creator = engine.visibleTo(index, readerOf({ tabs: ["people/employees"], grants: ["people create"] }), passageFor);
    expect(engine.linesOf(index, "people-add-employee", creator)).toEqual([
      "Step 1: Open People · Employees.",
      "Step 2: Press Add Employee at the top right.",
      "Step 3: Fill in First Name and Last Name, then press Next.",
      "Field: Gross Monthly; What to Enter: Their pay before deductions",
    ]);
  });
});
