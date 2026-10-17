"use strict";
/**
 * The workflow module's own rules, without a database: how a request's route reads,
 * how a stored stage is shown, how the screen's stages go back to the engine, and that
 * the leave flow seeded in 0499 is the one the code ships.
 */
const fs = require("node:fs");
const path = require("node:path");
const definitions = require("../../shared/workflow/definitions");
const cond = require("../../shared/workflow/conditions");
const service = require("./workflow.service");

const LEAVE = definitions.DEFAULTS["leave.approval"];
const names = { roles: new Map([["operations_people", "Operations & People"]]), users: new Map(), employees: new Map([["e1", "Kemi Alade"]]) };

describe("the leave flow", () => {
  test("is valid, and the line manager alone decides five days or fewer", () => {
    expect(definitions.problemsOf(LEAVE)).toEqual([]);
    expect(cond.applicableStages(LEAVE, { days: 5 }).map((s) => s.key)).toEqual(["line_manager"]);
    expect(cond.applicableStages(LEAVE, { days: 5.5 }).map((s) => s.key)).toEqual(["line_manager", "operations_people"]);
  });

  test("0499 seeds exactly the definition the code ships", () => {
    const sql = fs.readFileSync(path.resolve(__dirname, "../../../seeds/reference/0499_seed_workflow.sql"), "utf8");
    const json = [...sql.matchAll(/'(\{[^']*\}|\[[^']*\])'::jsonb/g)].map((m) => JSON.parse(m[1]));
    expect(json[0]).toEqual(LEAVE.context);
    expect(json[1]).toEqual(LEAVE.stages);
    expect(sql).toContain(`'${LEAVE.key}', 1, '${LEAVE.module}', '${LEAVE.name}'`);
    expect(sql).toContain(`'${LEAVE.description}'`);
  });
});

describe("showing a stage", () => {
  test("an approver reads as a name", () => {
    expect(service.approverView({ type: "role", value: "operations_people" }, names)).toEqual({
      type: "role",
      value: "operations_people",
      label: "Operations & People",
    });
    expect(service.approverView({ type: "manager_of_subject" }, names).label).toBe("Line Manager");
    expect(service.approverView({ type: "employee", value: "e1", via: "manager_of_subject" }, names).label).toBe("Kemi Alade");
    expect(service.approverView({ type: "ceo" }, names).label).toBe("CEO");
    expect(service.approverView({ role: "manager" }, names)).toEqual({ type: "unknown", value: null, label: "Not Set" });
  });

  test("a condition is always a list, and a malformed stored one is left out", () => {
    expect(service.conditionList(null)).toEqual([]);
    expect(service.conditionList({ field: "days", op: ">", value: 5 })).toEqual([{ field: "days", op: ">", value: 5 }]);
    expect(service.conditionList([{ field: "days", op: "between", value: 5 }])).toEqual([]);
  });

  test("the screen's stages go back in the engine's shape", () => {
    const [one, two] = service.authoredStages([
      { key: "a", name: "A", approvers: [{ type: "manager_of_subject" }], condition: [], sla_hours: 48, on_timeout: "escalate", on_approve: "next", on_reject: "reject" },
      {
        key: "b",
        name: "B",
        approvers: [{ type: "role", value: "operations_people" }],
        condition: [{ field: "days", op: ">", value: 5 }, { field: "days", op: "<", value: 30 }],
        sla_hours: 24,
        on_timeout: "escalate",
        on_approve: "next",
        on_reject: "return",
      },
    ]);
    expect(one).toMatchObject({ approvers: [{ type: "manager_of_subject" }], condition: null });
    expect(two.condition).toHaveLength(2);
    expect(definitions.problemsOf({ ...LEAVE, stages: [one, two] })).toEqual([]);
  });
});

describe("a request's route", () => {
  const route = (instance) => service.routeOf(LEAVE, { decisions: [], context: { days: 7 }, ...instance }).map((x) => x.state);

  test("pending: behind, waiting, to come; a stage that does not apply is skipped", () => {
    expect(route({ state: "pending", current_stage: "line_manager" })).toEqual(["now", "todo"]);
    expect(route({ state: "pending", current_stage: "operations_people" })).toEqual(["done", "now"]);
    expect(route({ state: "pending", current_stage: "line_manager", context: { days: 2 } })).toEqual(["now", "skipped"]);
  });

  test("closed: where it stopped, and nothing after", () => {
    expect(route({ state: "approved", current_stage: "operations_people" })).toEqual(["done", "done"]);
    expect(route({ state: "rejected", current_stage: "line_manager" })).toEqual(["stopped", "skipped"]);
    expect(route({ state: "cancelled", current_stage: "operations_people" })).toEqual(["done", "stopped"]);
  });
});
