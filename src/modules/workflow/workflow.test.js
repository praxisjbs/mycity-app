"use strict";
/**
 * The workflow module's own rules, without a database: how a request's route reads,
 * how a stored stage is shown, how the screen's stages go back to the engine, and that
 * the leave flow seeded in 0499 is the one the code ships.
 */
const fs = require("node:fs");
const path = require("node:path");
const c = require("@mycity/contract");
const definitions = require("../../shared/workflow/definitions");
const cond = require("../../shared/workflow/conditions");
const service = require("./workflow.service");

const LEAVE = definitions.DEFAULTS["leave.approval"];
const names = { roles: new Map([["operations_people", "Operations & People"]]), users: new Map(), employees: new Map([["e1", "Kemi Alade"]]) };

describe("a route's problems, plainly", () => {
  test("name the stage and say the rule in words", () => {
    const stages = [{ name: "Line Manager" }, { name: "Finance" }];
    expect(service.plainly("stage 2 (finance): sla_hours is between 1 and 2160", stages)).toBe("Finance: the time limit is 1 to 2,160 hours");
    expect(service.plainly("stage 1 (line_manager): name at least one approver", stages)).toBe("Line Manager: it names nobody to decide");
    expect(service.plainly("stage 1 (line_manager) condition: field \"x\" is not declared in context", stages)).toBe("Line Manager: its condition does not fit these requests");
    expect(service.plainly("stage 3 (x): something new", stages)).toBe("Stage 3: check its settings");
    expect(service.plainly("at least one stage is required", stages)).toBe("Add a stage");
  });
});

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

describe("the key of a flow made on screen", () => {
  test("is its module and its name in snake_case", () => {
    expect(definitions.keyFor("expenses", "Petty Cash")).toBe("expenses.petty_cash");
    expect(definitions.keyFor("people", "Operations & People")).toBe("people.operations_people");
    expect(definitions.keyFor("people", "Café Run")).toBe("people.cafe_run");
  });

  test("starts with a letter, stays short, and is null when the name has none to give", () => {
    expect(definitions.keyFor("people", "2nd Opinion")).toBe("people.flow_2nd_opinion");
    const long = definitions.keyFor("people", "a ".repeat(40));
    expect(long.split(".")[1].length).toBeLessThanOrEqual(40);
    expect(long).not.toMatch(/_$/);
    expect(definitions.keyFor("people", "???")).toBeNull();
  });

  test("makes a definition the engine accepts", () => {
    const key = definitions.keyFor("expenses", "Petty Cash");
    const stage = { key: "ceo", name: "CEO", approver: { type: "ceo" }, sla_hours: 48 };
    expect(definitions.problemsOf({ key, module: "expenses", name: "Petty Cash", context: {}, stages: [stage] })).toEqual([]);
  });
});

describe("making a flow: the contract", () => {
  const stage = { key: "ceo", name: "CEO", approvers: [{ type: "ceo" }], condition: [], sla_hours: 48, on_timeout: "escalate", on_approve: "next", on_reject: "reject" };
  const flow = { name: "Petty Cash", module_key: "expenses", context_types: { amount: "money" }, stages: [stage] };

  test("takes a name, a module, its values and its stages", () => {
    const r = c.workflow.ApprovalFlowCreate.safeParse(flow);
    expect(r.success).toBe(true);
    expect(r.data.description).toBeUndefined();
  });

  test("refuses no stage, more than 5 values, a value type it does not know and a key the caller chose", () => {
    const bad = (patch) => c.workflow.ApprovalFlowCreate.safeParse({ ...flow, ...patch }).success;
    expect(bad({ stages: [] })).toBe(false);
    const six = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, "text"]));
    expect(bad({ context_types: six })).toBe(false);
    expect(bad({ context_types: { amount: "euro" } })).toBe(false);
    expect(bad({ context_types: { "Amount Due": "money" } })).toBe(false);
    expect(bad({ key: "expenses.petty_cash" })).toBe(false);
  });
});
