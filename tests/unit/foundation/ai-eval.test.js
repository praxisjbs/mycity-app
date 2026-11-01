"use strict";
/**
 * Praxis AI's graded questions (scripts/ai/eval-assistant.js, docs/guides/praxis-ai.md §6.10)
 * without a key: every question names reads and screens that exist, the grading passes and fails
 * what it should, and --list runs with no database.
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const registry = require("../../../src/shared/ai/registry");
const { CASES, grade, screenOf, waiting } = require("../../../scripts/ai/eval-assistant");

const SCRIPT = path.join(__dirname, "../../../scripts/ai/eval-assistant.js");

describe("the questions", () => {
  const reads = new Set([...registry.reads(), ...registry.summaries()].map((r) => r.key));
  const screens = new Set(registry.routes().map((r) => r.screen));
  const actions = new Set(registry.actions().map((a) => a.key));

  test("each has its own id, a role to ask as, and something to grade", () => {
    expect(new Set(CASES.map((k) => k.id)).size).toBe(CASES.length);
    for (const k of CASES) {
      expect([k.id, typeof k.as]).toEqual([k.id, "string"]);
      expect([k.id, Boolean(k.reads || k.never || k.route || k.needs || k.action || k.no_action)]).toEqual([k.id, true]);
    }
  });

  test("the summary questions name summaries that exist, and ask from a screen with a pane", () => {
    const summaries = new Set(registry.summaries().map((s) => s.key));
    const cases = CASES.filter((k) => k.id.startsWith("summary."));
    expect(cases.length).toBeGreaterThanOrEqual(3);
    for (const k of cases) {
      expect([k.id, k.reads.every((key) => summaries.has(key))]).toEqual([k.id, true]);
      expect([k.id, (k.shows || []).includes("pane")]).toEqual([k.id, true]);
    }
  });

  test("every read and screen a question names is declared by a manifest", () => {
    for (const k of CASES.filter((x) => !x.needs)) {
      for (const key of [...(k.reads || []), ...(k.never || [])]) expect([k.id, key, reads.has(key)]).toEqual([k.id, key, true]);
      if (k.route) expect([k.id, k.route, screens.has(k.route)]).toEqual([k.id, k.route, true]);
      // A card case names a declared action and asks from a screen that draws cards (praxis-ai.md §6.11).
      if (k.action) expect([k.id, k.action, actions.has(k.action), (k.shows || []).includes("cards")]).toEqual([k.id, k.action, true, true]);
      for (const key of k.no_action || []) expect([k.id, key, actions.has(key), (k.shows || []).includes("cards")]).toEqual([k.id, key, true, true]);
    }
  });

  test("every declared action has a card case (gate 23), and a change the person may not make has a case that refuses it", () => {
    const graded = new Set(CASES.filter((k) => k.action).map((k) => k.action));
    for (const key of actions) expect([key, graded.has(key)]).toEqual([key, true]);
    expect(CASES.some((k) => k.no_action && k.no_action.length)).toBe(true);
  });

  test("Ifeoma's questions are asked, through Home's activity.list", () => {
    expect(CASES.filter((k) => k.id.startsWith("today.")).map((k) => k.reads)).toEqual([["activity.list"], ["activity.list"]]);
  });

  test("a target question names a module the catalogue has, and waits until that module declares a read", () => {
    const catalog = require("../../../src/shared/access/access.catalog");
    for (const k of CASES.filter((x) => x.needs)) expect([k.id, k.needs, catalog.isModule(k.needs)]).toEqual([k.id, k.needs, true]);
    const expenses = CASES.find((k) => k.needs === "expenses");
    expect(waiting(expenses, { reads: () => [{ key: "leave.requests", module: "people" }] })).toBe(true);
    expect(waiting(expenses, { reads: () => [{ key: "expenses.list", module: "expenses" }] })).toBe(false);
  });
});

describe("the grade", () => {
  const read = (key, rows = 1, ok = true) => ({ key, ok, rows: Array.from({ length: rows }, () => ({})) });
  const shown = (over = {}) => ({ declined: null, link: null, ...over });

  test("answered from the reads it should run", () => {
    const k = { id: "x", reads: ["leave.requests", "approvals.mine"] };
    expect(grade(k, { reads: [read("approvals.mine")], shown: shown() }).pass).toBe(true);
    const missed = grade(k, { reads: [read("leave.requests", 0, false)], shown: shown() });
    expect(missed.pass).toBe(false);
    expect(missed.problems[0]).toMatch(/ran none of leave.requests, approvals.mine/);
  });

  test("a read that must not return rows to this person fails it; a refused one is fine", () => {
    const k = { id: "x", never: ["employees.list"] };
    expect(grade(k, { reads: [read("employees.list", 0, false)], shown: shown() }).pass).toBe(true);
    expect(grade(k, { reads: [read("employees.list", 0)], shown: shown() }).pass).toBe(true);
    expect(grade(k, { reads: [read("employees.list", 3)], shown: shown() }).problems).toEqual(["employees.list returned rows to someone who may not see them"]);
  });

  test("a target question, once it runs, must read from its module", () => {
    const k = { id: "x", needs: "partnerships" };
    expect(grade(k, { reads: [{ ...read("partners.list"), module: "partnerships" }], shown: shown() }).pass).toBe(true);
    expect(grade(k, { reads: [{ ...read("employees.list"), module: "people" }], shown: shown() }).problems[0]).toMatch(/read nothing from partnerships/);
  });

  test("a change is a screen offered with declined change, never a claim", () => {
    const k = { id: "x", route: "workspace.tasks" };
    expect(grade(k, { reads: [], shown: shown({ declined: "change", link: { path: "/workspace?tab=tasks&new=1&title=Report" } }) }).pass).toBe(true);
    expect(grade(k, { reads: [], shown: shown({ declined: null, link: { path: "/workspace?tab=tasks" } }) }).problems).toEqual(["declined is null, not change"]);
    expect(grade(k, { reads: [], shown: shown({ declined: "change", link: null }) }).problems).toEqual(["offered no screen, not workspace.tasks"]);
    expect(screenOf("/ess?tab=my-leave&starts_on=2026-10-26")).toBe("ess.my-leave");
    expect(screenOf("/praxis-ai?tab=ask")).toBe("praxis_ai.ask");
  });
});

test("--list prints every question and who asks it, with no database or key", () => {
  const run = spawnSync(process.execPath, [SCRIPT, "--list"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  expect(run.status).toBe(0);
  const lines = run.stdout.trim().split("\n");
  expect(lines).toHaveLength(CASES.length);
  expect(lines[0]).toMatch(/^today\.what-happened\s+ceo\s+What happened today\?$/);
});
