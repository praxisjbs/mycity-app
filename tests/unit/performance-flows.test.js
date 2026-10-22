"use strict";
/**
 * The four Performance approval flows and the named-person approver
 * (docs/guides/performance.md §6.4, §6.7, §6.11, §6.12, §6.13).
 */
const cond = require("../../src/shared/workflow/conditions");
const definitions = require("../../src/shared/workflow/definitions");
const approvers = require("../../src/shared/workflow/approvers");

const D = definitions.DEFAULTS;
const stages = (key, context) => cond.applicableStages(D[key], context).map((s) => s.key);
const someone = "7f0c4c53-8c55-4b1a-9a43-6b1b4a3c2d10";

describe("the Performance flows ship valid", () => {
  test.each(["performance.plan", "performance.target_change", "performance.commitments", "performance.review"])(
    "%s passes validateDefinition",
    (key) => {
      expect(definitions.problemsOf(D[key])).toEqual([]);
      expect(D[key].module).toBe("performance");
    },
  );
});

describe("performance.plan (§6.4)", () => {
  const ctx = (o) => ({ head_reports_to_ceo: false, by_operations_people: false, is_company: false, ...o });

  test("Branding & Marketing: Program Manager, Operations & People, CEO", () => {
    expect(stages("performance.plan", ctx())).toEqual(["line_manager", "operations_people", "ceo"]);
  });
  test("Technology & Back-office Ops (the CTO reports to the CEO): Operations & People, CEO", () => {
    expect(stages("performance.plan", ctx({ head_reports_to_ceo: true }))).toEqual(["operations_people", "ceo"]);
  });
  test("People & Culture (sent by Operations & People): Program Manager, CEO", () => {
    expect(stages("performance.plan", ctx({ by_operations_people: true }))).toEqual(["line_manager", "ceo"]);
  });
  test("the company plan: the CEO alone", () => {
    expect(stages("performance.plan", ctx({ is_company: true, head_reports_to_ceo: true }))).toEqual(["ceo"]);
  });
});

describe("performance.target_change (§6.7)", () => {
  test("one stage, the CEO", () => {
    expect(stages("performance.target_change", {})).toEqual(["ceo"]);
  });
});

describe("performance.commitments (§6.11)", () => {
  test("a member of staff: their reviewer", () => {
    expect(stages("performance.commitments", { is_function_head: false, reviewer_employee_id: someone })).toEqual(["reviewer"]);
  });
  test("a function head: the CEO", () => {
    expect(stages("performance.commitments", { is_function_head: true })).toEqual(["ceo"]);
    expect(cond.contextProblems(D["performance.commitments"], { is_function_head: true })).toEqual([]);
  });
});

describe("performance.review (§6.12)", () => {
  test("second level, then Operations & People", () => {
    expect(stages("performance.review", { reviewer_is_ceo: false, second_level_employee_id: someone })).toEqual([
      "second_level",
      "operations_people",
    ]);
  });
  test("no second level when the reviewer is the CEO", () => {
    expect(stages("performance.review", { reviewer_is_ceo: true, second_level_employee_id: someone })).toEqual(["operations_people"]);
  });
  test("an empty named field skips the stage, and may be left out of the context", () => {
    expect(stages("performance.review", { reviewer_is_ceo: false, second_level_employee_id: null })).toEqual(["operations_people"]);
    expect(cond.contextProblems(D["performance.review"], { reviewer_is_ceo: false })).toEqual([]);
    expect(cond.contextProblems(D["performance.review"], { reviewer_is_ceo: false, second_level_employee_id: "nope" })).toEqual([
      'context "second_level_employee_id" is not a uuid',
    ]);
  });
  test("a condition field is still required", () => {
    expect(cond.contextProblems(D["performance.review"], {})).toEqual(['context is missing "reviewer_is_ceo"']);
  });
});

describe("the named-person approver (employee_in_context)", () => {
  const base = {
    key: "x.named",
    module: "performance",
    name: "Named",
    context: { who: "uuid", note: "text" },
    stages: [{ key: "named", name: "Named", approver: { type: "employee_in_context", value: "who" } }],
  };

  test("its value must be a uuid field of the context", () => {
    expect(cond.validateDefinition(base)).toEqual([]);
    const bad = { ...base, stages: [{ key: "named", name: "Named", approver: { type: "employee_in_context", value: "note" } }] };
    expect(cond.validateDefinition(bad)).toEqual(["stage 1 (named): a named person's value is a uuid field of the context"]);
  });

  test("`field` is read as `value`", () => {
    const authored = { ...base, stages: [{ key: "named", name: "Named", approver: { type: "employee_in_context", field: "who" } }] };
    expect(cond.validateDefinition(authored)).toEqual([]);
    expect(cond.stagesOf(authored)[0].approvers).toEqual([{ type: "employee_in_context", value: "who" }]);
  });

  test("resolves to the employee the context names when the stage starts", async () => {
    const client = { query: jest.fn() };
    const snap = await approvers.resolve(client, [{ type: "employee_in_context", value: "who" }], { context: { who: someone } });
    expect(snap).toEqual([{ type: "employee", value: someone, via: "employee_in_context" }]);
    expect(client.query).not.toHaveBeenCalled();
  });

  test("a stage started with nobody named goes to the CEO", async () => {
    const snap = await approvers.resolve({ query: jest.fn() }, [{ type: "employee_in_context", value: "who" }], { context: {} });
    expect(snap).toEqual([{ type: "ceo", via: "nobody_named" }]);
  });
});
