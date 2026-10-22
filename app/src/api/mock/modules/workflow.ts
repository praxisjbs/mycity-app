import type { ApprovalFlow, ApprovalStageInput } from "@mycity/contract/contract.gen.ts";
import { at, fail, invalid, notFound, ok, paged, route, sid } from "../core";
import { SIGN_INS } from "../data/people";

/**
 * Settings · Approvals on the in-browser mock (laptops and CI only, F12 to F14),
 * in the contract's shapes. The flows are the ones every database holds from the
 * reference seeds: the leave flow (0499) and the consequence review an earlier
 * seed stored before the rules, which the screen lists as needing fixing.
 */
const editor = (u: string) => ["operations", "ceo"].includes(SIGN_INS[u]?.view ?? "");

const ROLE_NAMES: Record<string, string> = { operations_people: "Operations & People", management: "Management", manager: "Line Manager", head_of_department: "Head of Department" };
const label = (a: { type: string; value?: string | null }) =>
  a.type === "role" ? (ROLE_NAMES[a.value ?? ""] ?? a.value ?? "A Role") : a.type === "manager_of_subject" ? "Line Manager" : a.type === "employee_in_context" ? "Named Person" : a.type === "ceo" ? "CEO" : a.type === "user" ? "A Login" : "Not Set";

const FLOWS: ApprovalFlow[] = [
  {
    workflow_definition_id: sid("flow:leave.approval:1"),
    key: "leave.approval",
    version: 1,
    module_key: "people",
    name: "Leave Request",
    description: "The line manager, then Operations & People when the request is over 5 days.",
    context_types: { days: "number" },
    stages: [
      { key: "line_manager", name: "Line Manager", approvers: [{ type: "manager_of_subject", value: null, label: "Line Manager" }], condition: [], sla_hours: 48, on_timeout: "escalate", on_approve: "next", on_reject: "reject" },
      {
        key: "operations_people",
        name: "Operations & People",
        approvers: [{ type: "role", value: "operations_people", label: "Operations & People" }],
        condition: [{ field: "days", op: ">", value: 5 }],
        sla_hours: 48,
        on_timeout: "escalate",
        on_approve: "next",
        on_reject: "reject",
      },
    ],
    open_requests: 2,
    problems: [],
    created_by_name: null,
    created_at: at(3, "08:00"),
  },
  {
    workflow_definition_id: sid("flow:employee_consequence:1"),
    key: "employee_consequence",
    version: 1,
    module_key: "queries",
    name: "Employee Consequence",
    description: "Configurable query and consequence review.",
    context_types: { employee_id: "uuid", sanction_type: "text" },
    stages: [
      { key: "manager_review", name: "manager_review", approvers: [{ type: "unknown", value: null, label: "Not Set" }], condition: [], sla_hours: 48, on_timeout: "escalate", on_approve: "operations_review", on_reject: "rejected" },
      { key: "operations_review", name: "operations_review", approvers: [{ type: "unknown", value: null, label: "Not Set" }], condition: [], sla_hours: 48, on_timeout: "escalate", on_approve: "approved", on_reject: "rejected" },
    ],
    open_requests: 0,
    problems: ['key is dotted snake_case, e.g. "expense.approval"', "stage 1 (manager_review): approver type must be one of role, user, manager_of_subject, ceo"],
    created_by_name: null,
    created_at: at(3, "08:00"),
  },
];

route("GET /api/v1/settings/approvals/summary", () =>
  ok({ flows: FLOWS.length, open_requests: FLOWS.reduce((n, f) => n + f.open_requests, 0), overdue: 0, needs_fixing: FLOWS.filter((f) => f.problems.length).length }),
);

route("GET /api/v1/settings/approvals", (req) => {
  const { sort, ...rest } = req.query;
  const rows = sort === "-name" ? [...FLOWS].reverse() : FLOWS;
  return paged(rows, { ...req, query: rest }, { search: (f) => [f.name, f.key, f.description], filters: { module_key: (f, v) => f.module_key === v } });
});

route("PUT /api/v1/settings/approvals/:id/steps", (req) => {
  if (!editor(req.user!)) return fail(403, "PERMISSION_DENIED", "You need settings edit to change approval flows.");
  const i = FLOWS.findIndex((f) => f.workflow_definition_id === req.params.id);
  if (i < 0) return notFound();
  const stages = (req.body.stages as ApprovalStageInput[] | undefined) ?? [];
  if (!stages.length) return invalid({ stages: ["Keep at least one stage"] });
  const flow = FLOWS[i];
  const next: ApprovalFlow = {
    ...flow,
    workflow_definition_id: sid(`flow:${flow.key}:${flow.version + 1}`),
    version: flow.version + 1,
    stages: stages.map((s) => ({ ...s, approvers: s.approvers.map((a) => ({ type: a.type, value: a.value ?? null, label: label(a) })) })),
    problems: [],
    created_by_name: "You",
    created_at: new Date().toISOString(),
  };
  FLOWS[i] = next;
  return ok(next);
});
