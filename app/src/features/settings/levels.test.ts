import { describe, expect, test } from "vitest";
import type { AccessCatalogue, RoleDetail, RoleGrant } from "@mycity/contract/contract.gen.ts";
import { atLevel, bodyOf, changesOf, draftOf, grantWords, lettersOf, levelOf, levelWord, summaryOf, toggled, usualScope, words, type Module } from "./levels";

const mod = (key: string, label: string, own_only = false): Module => ({ key: key as Module["key"], label, area: "people", description: "", own_only });
const PEOPLE = mod("people", "People");
const PAYROLL = mod("payroll", "Payroll");
const ESS = mod("ess", "Employee Self-Service", true);
const grant = (module_key: string, actions: RoleGrant["actions"], scope: RoleGrant["scope"] = "all"): RoleGrant => ({ module_key: module_key as RoleGrant["module_key"], actions, scope });

const CAT: AccessCatalogue = {
  modules: [PEOPLE, PAYROLL, ESS],
  actions: ["view", "create", "edit", "delete", "approve", "export"],
  scopes: ["all", "team", "own"],
  fields: [
    { key: "employee.salary", label: "Salary" },
    { key: "employee.bank", label: "Bank Details" },
  ],
  capabilities: [{ code: "announcements.post", name: "Post Announcements", description: null }],
};

const ROLE: RoleDetail = {
  role_id: "00000000-0000-4000-8000-000000000001",
  code: "manager",
  name: "Line Manager",
  description: "Manages the people who report to them.",
  home_view: "staff",
  rank: 40,
  is_system: true,
  two_step_required: false,
  users: 6,
  grants: [grant("people", ["view", "approve"], "team"), grant("ess", ["view", "create", "edit"], "own")],
  visible_fields: [],
  capabilities: [],
};

/** The seeded grants read as the levels the screen shows (seeds/reference/0290). */
describe("levels from actions", () => {
  test("each level is its actions, whatever their order", () => {
    expect(levelOf(grant("people", []))).toBe(0);
    expect(levelOf(grant("people", ["view"]))).toBe(1);
    expect(levelOf(grant("people", ["create", "view"]))).toBe(2);
    expect(levelOf(grant("people", ["view", "create", "edit"]))).toBe(3);
    expect(levelOf(grant("people", ["delete", "edit", "create", "view"]))).toBe(4);
  });

  test("Approve and Export sit beside the level, not in it", () => {
    expect(levelOf(grant("payroll", ["view", "approve", "export"]))).toBe(1);
    expect(levelOf(grant("people", ["view", "create", "edit", "delete", "approve", "export"]))).toBe(4);
  });

  test("actions that fit no level read Custom", () => {
    expect(levelOf(grant("people", ["view", "edit"]))).toBeNull();
    expect(levelWord(grant("people", ["view", "delete"]))).toBe("Custom");
  });
});

describe("moving a grant", () => {
  test("a level gives exactly its actions and keeps the add-ons", () => {
    const g = atLevel(grant("people", ["view", "approve"], "team"), 3, PEOPLE, "all");
    expect([...g.actions].sort()).toEqual(["approve", "create", "edit", "view"]);
    expect(g.scope).toBe("team");
  });

  test("No Access drops every action, add-ons too", () => {
    expect(atLevel(grant("people", ["view", "approve", "export"]), 0, PEOPLE, "all").actions).toEqual([]);
  });

  test("a module granted afresh takes the role's usual scope; Self-Service is always Own", () => {
    expect(atLevel(grant("payroll", []), 1, PAYROLL, "team")).toEqual(grant("payroll", ["view"], "team"));
    expect(atLevel(grant("ess", []), 3, ESS, "all").scope).toBe("own");
  });

  test("Approve and Export switch only on a granted module", () => {
    expect(toggled(grant("people", ["view"]), "approve").actions).toEqual(["view", "approve"]);
    expect(toggled(grant("people", ["view", "approve"]), "approve").actions).toEqual(["view"]);
    expect(toggled(grant("people", []), "export").actions).toEqual([]);
  });
});

describe("words and letters", () => {
  test("a grant in words, Custom spelt out", () => {
    expect(grantWords(grant("people", ["view", "approve"], "team"), PEOPLE)).toBe("View · Team · Approve");
    expect(grantWords(grant("people", ["view", "edit"], "all"), PEOPLE)).toBe("View, Edit · All");
    expect(grantWords(grant("people", []), PEOPLE)).toBe("No Access");
  });

  test("letters: T or O for the scope, none for All; A and X for the add-ons", () => {
    expect(lettersOf(grant("people", ["view", "approve"], "team"), PEOPLE)?.text).toBe("T A");
    expect(lettersOf(grant("people", ["view", "export"], "all"), PEOPLE)?.text).toBe("X");
    expect(lettersOf(grant("ess", ["view"], "all"), ESS)?.text).toBe("O");
    expect(lettersOf(grant("people", ["view"], "all"), PEOPLE)).toBeNull();
    expect(lettersOf(grant("people", []), PEOPLE)).toBeNull();
  });
});

describe("saving and reviewing", () => {
  test("a role read and saved unchanged sends the same grants and nothing it did not hold", () => {
    const d = draftOf(CAT, ROLE);
    expect(bodyOf(d).grants).toEqual(ROLE.grants);
    expect(changesOf(CAT, d, d)).toEqual([]);
  });

  test("the review names what is gained, lost and changed", () => {
    const before = draftOf(CAT, ROLE);
    const after = {
      ...before,
      grants: { ...before.grants, payroll: grant("payroll", ["view"], "team"), people: grant("people", [], "team"), ess: grant("ess", ["view", "create", "edit", "export"], "own") },
      fields: ["employee.salary"],
    };
    const c = changesOf(CAT, before, after);
    expect(c).toContainEqual({ kind: "Gains", what: "Payroll", from: "No Access", to: "View · Team" });
    expect(c).toContainEqual({ kind: "Loses", what: "People", from: "View · Team · Approve", to: "No Access" });
    expect(c).toContainEqual({ kind: "Changes", what: "Employee Self-Service", from: "Edit · Own", to: "Edit · Own · Export" });
    expect(c).toContainEqual({ kind: "Gains", what: "Salary", from: "Masked", to: "Visible" });
  });

  test("a scope change on an ungranted module is not a change", () => {
    const before = draftOf(CAT, ROLE);
    const after = { ...before, grants: { ...before.grants, payroll: grant("payroll", [], "all") } };
    expect(changesOf(CAT, before, after)).toEqual([]);
  });

  test("the usual scope is the one most grants use, the wider on a tie", () => {
    expect(usualScope(CAT, draftOf(CAT, ROLE))).toBe("team");
    expect(usualScope(CAT, draftOf(CAT, null))).toBe("own");
  });
});

describe("the summary behind the ⓘ", () => {
  test("says what the role changes, approves and reads, and stays within 35 words", () => {
    const text = summaryOf(CAT, draftOf(CAT, ROLE));
    expect(text).toContain("Approves in People.");
    expect(text).toContain("Salary stays masked.");
    expect(words(text)).toBeLessThanOrEqual(35);
  });

  test("a role with nothing granted says so", () => {
    expect(summaryOf(CAT, draftOf(CAT, null))).toBe("Opens nothing yet.");
  });
});
