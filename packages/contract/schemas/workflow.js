"use strict";
/**
 * Workflow: approvals as people meet them (docs/guides/foundation.md §5, §6.5).
 *
 * Two halves over the one engine (shared/workflow, BACKEND_STRUCTURE §4):
 *
 *  - Requests waiting on people: My Approvals and its count (Home's Waiting on You),
 *    one request with its route and decisions, and the moves a person makes on it:
 *    approve, reject, request changes (both with a reason), withdraw, and reassign
 *    a stage whose approver has gone.
 *  - Settings, Approvals: every flow and its stages. Saving stages writes a NEW
 *    version; a request already open keeps the version it started on.
 *
 * A stage, as the engine stores it (shared/workflow/conditions.js):
 *   approvers   who decides: a role, one login, the subject's line manager, or the CEO
 *   condition   comparisons against the request's values, all of which must hold; an
 *               empty list means the stage always applies
 *   sla_hours   how long it may wait before on_timeout applies
 */
const { z } = require("zod");
const { uuid, text, optionalText, isoDateTime, listQuery, Paged } = require("./common");
const { ModuleKey } = require("./identity");

const KEY = /^[a-z][a-z0-9_]*$/;

const ApprovalState = z.enum(["pending", "approved", "rejected", "cancelled", "timeout_approved", "timeout_rejected"]);
const ApproverType = z.enum(["role", "user", "manager_of_subject", "ceo"]);
const ContextType = z.enum(["money", "number", "date", "text", "uuid", "boolean"]);
const ConditionOp = z.enum([">=", ">", "=", "<", "<=", "in"]);
const OnTimeout = z.enum(["escalate", "auto_approve", "auto_reject"]);
const OnApprove = z.enum(["next", "complete"]);
const OnReject = z.enum(["reject", "return"]);
const Decision = z.enum(["approve", "reject", "request_changes", "cancel", "timeout_approve", "timeout_reject", "reassign"]);

/** A value a condition compares with, or a request carries: money and dates travel as strings. */
const Scalar = z.union([z.string().max(200), z.number(), z.boolean()]);
const ConditionValue = z.union([Scalar, z.array(z.union([z.string().max(200), z.number()])).min(1).max(50)]);

/* ------------------------------------------------------------------ *
 * Flows (Settings, Approvals)
 * ------------------------------------------------------------------ */

/** One comparison against the request's values. */
const StageCondition = z
  .object({
    field: z.string().regex(KEY).max(40),
    op: ConditionOp,
    value: ConditionValue,
  })
  .strict();

/** Who decides, as authored: `value` is the role code or the user id. */
const StageApprover = z
  .object({
    type: ApproverType,
    value: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

/** A stage as Settings sends it back. Every field is given, so nothing is lost on a save. */
const ApprovalStageInput = z
  .object({
    key: z.string().regex(KEY, "Use lower case and underscores").max(40),
    name: text(60),
    approvers: z.array(StageApprover).min(1).max(5),
    condition: z.array(StageCondition).max(5),
    sla_hours: z.number().int().min(1).max(2160),
    on_timeout: OnTimeout,
    on_approve: OnApprove,
    on_reject: OnReject,
  })
  .strict();

/** PUT /settings/approvals/:id/steps: the stages of the version open on screen. */
const ApprovalStepsUpdate = z.object({ stages: z.array(ApprovalStageInput).min(1).max(10) }).strict();

/**
 * An approver as a person reads it. `type` stays a plain string here because a stored
 * flow may predate the rules (the flow then lists its `problems`).
 */
const ApproverView = z
  .object({
    type: z.string(),
    value: z.string().nullable(),
    label: z.string(),
  })
  .strict();

/** A stage as stored, for the screen. */
const ApprovalStage = z
  .object({
    key: z.string(),
    name: z.string(),
    approvers: z.array(ApproverView),
    condition: z.array(StageCondition),
    sla_hours: z.number(),
    on_timeout: z.string(),
    on_approve: z.string(),
    on_reject: z.string(),
  })
  .strict();

/** One flow: its active version, its stages, and what is open on it. */
const ApprovalFlow = z
  .object({
    workflow_definition_id: uuid,
    key: z.string(),
    version: z.number().int().min(1),
    module_key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    context_types: z.record(z.string(), z.string()),
    stages: z.array(ApprovalStage),
    /** Requests still waiting, on any version of this flow. */
    open_requests: z.number().int().min(0),
    /** Why this flow would be refused if saved as it is (a flow stored before the rules). */
    problems: z.array(z.string()),
    created_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

/** GET /settings/approvals: the active version of every flow. */
const ApprovalFlowListQuery = listQuery({ module_key: ModuleKey.optional() }, ["name", "key"]);
const ApprovalFlowPage = Paged(ApprovalFlow);

/** GET /settings/approvals/summary: the figures above the flows. */
const ApprovalsSummary = z
  .object({
    flows: z.number().int().min(0),
    open_requests: z.number().int().min(0),
    overdue: z.number().int().min(0),
    needs_fixing: z.number().int().min(0),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Requests (My Approvals and one request)
 * ------------------------------------------------------------------ */

/** A request waiting on the caller. `link` opens the record it is about. */
const ApprovalWaiting = z
  .object({
    workflow_instance_id: uuid,
    definition_key: z.string(),
    definition_name: z.string(),
    module_key: z.string(),
    entity_type: z.string(),
    entity_id: z.string(),
    subject_employee_id: uuid.nullable(),
    subject_name: z.string().nullable(),
    current_stage: z.string(),
    stage_name: z.string(),
    context: z.record(z.string(), Scalar.nullable()),
    stage_entered_at: isoDateTime,
    stage_due_at: isoDateTime.nullable(),
    overdue: z.boolean(),
    opened_by: uuid.nullable(),
    opened_by_name: z.string().nullable(),
    opened_at: isoDateTime,
    link: z.string().nullable(),
  })
  .strict();

/** GET /workflow/mine: oldest waiting first; `module_key` keeps one module's requests. */
const ApprovalMineQuery = listQuery({ module_key: ModuleKey.optional() });
const ApprovalWaitingPage = Paged(ApprovalWaiting);

/** GET /workflow/mine/count: Home's Waiting on You. */
const ApprovalCount = z
  .object({
    waiting: z.number().int().min(0),
    overdue: z.number().int().min(0),
  })
  .strict();

/** One stage of a request's route: behind it, waiting on it, still to come, or skipped. */
const RouteStage = z
  .object({
    key: z.string(),
    name: z.string(),
    state: z.enum(["done", "now", "todo", "skipped", "stopped"]),
    approvers: z.array(ApproverView),
  })
  .strict();

/** One move on a request, oldest first. */
const ApprovalDecision = z
  .object({
    workflow_decision_id: uuid,
    stage_key: z.string(),
    stage_name: z.string().nullable(),
    actor_id: uuid.nullable(),
    actor_name: z.string().nullable(),
    decision: Decision,
    reason: z.string().nullable(),
    decided_at: isoDateTime,
  })
  .strict();

/** GET /workflow/instances/:id, and the answer to every move on it. */
const ApprovalInstance = z
  .object({
    workflow_instance_id: uuid,
    definition_key: z.string(),
    definition_name: z.string(),
    version: z.number().int().min(1),
    module_key: z.string(),
    entity_type: z.string(),
    entity_id: z.string(),
    subject_employee_id: uuid.nullable(),
    subject_name: z.string().nullable(),
    state: ApprovalState,
    current_stage: z.string().nullable(),
    stage_name: z.string().nullable(),
    context: z.record(z.string(), Scalar.nullable()),
    stage_entered_at: isoDateTime,
    stage_due_at: isoDateTime.nullable(),
    opened_by: uuid.nullable(),
    opened_by_name: z.string().nullable(),
    opened_at: isoDateTime,
    completed_at: isoDateTime.nullable(),
    route: z.array(RouteStage),
    decisions: z.array(ApprovalDecision),
    can_decide: z.boolean(),
    can_withdraw: z.boolean(),
    can_reassign: z.boolean(),
    link: z.string().nullable(),
  })
  .strict();

/** POST /workflow/instances/:id/approve: an optional note for the requester. */
const ApproveBody = z.object({ reason: optionalText(1000) }).strict();

/** POST …/reject and …/request-changes: the requester is always told why. */
const ReasonBody = z.object({ reason: text(1000) }).strict();

/** POST …/withdraw: the requester takes it back, saying why if they like. */
const WithdrawBody = z.object({ reason: optionalText(1000) }).strict();

/** POST …/reassign: the current stage goes to one login instead (an approver has left). */
const ReassignBody = z
  .object({
    user_id: uuid,
    reason: text(1000),
  })
  .strict();

/** Gate 6 (check/contract-columns.js): which table each schema's keys are the columns of. */
const TABLES = {
  StageCondition: { table: null, reason: "one comparison inside workflow_definition.stages" },
  StageApprover: { table: null, reason: "one approver inside workflow_definition.stages" },
  ApprovalStageInput: { table: null, reason: "one stage inside workflow_definition.stages" },
  ApprovalStepsUpdate: { table: "workflow_definition" },
  ApproverView: { table: null, reason: "an approver inside a stage, with the name a person reads" },
  ApprovalStage: { table: null, reason: "one stage inside workflow_definition.stages" },
  ApprovalFlow: {
    table: "workflow_definition",
    virtual: {
      open_requests: "counted from workflow_instance rows still pending on the flow's key",
      problems: "shared/workflow/definitions.problemsOf() on the stored flow",
      created_by_name: "the name of the login in created_by",
    },
  },
  ApprovalFlowListQuery: { table: null, reason: "list controls for the flows" },
  ApprovalFlowPage: { table: null, reason: "a page of flows" },
  ApprovalsSummary: { table: null, reason: "counts over workflow_definition and workflow_instance" },
  ApprovalWaiting: {
    table: "workflow_instance",
    virtual: {
      definition_name: "workflow_definition.name of the instance's version",
      subject_name: "the name of the employee in subject_employee_id",
      stage_name: "the current stage's name in the instance's version",
      overdue: "stage_due_at has passed",
      opened_by_name: "the name of the login in opened_by",
      link: "derived from entity_type and entity_id through shared/route-map.js",
    },
  },
  ApprovalMineQuery: { table: null, reason: "list controls for My Approvals" },
  ApprovalWaitingPage: { table: null, reason: "a page of requests waiting on the caller" },
  ApprovalCount: { table: null, reason: "counts of requests waiting on the caller" },
  RouteStage: { table: null, reason: "a stage of the instance's version with where the request stands on it" },
  ApprovalDecision: {
    table: "workflow_decision",
    virtual: {
      stage_name: "the stage's name in the instance's version",
      actor_name: "the name of the login in actor_id",
    },
  },
  ApprovalInstance: {
    table: "workflow_instance",
    virtual: {
      definition_name: "workflow_definition.name of the instance's version",
      version: "workflow_definition.version of the instance's version",
      subject_name: "the name of the employee in subject_employee_id",
      stage_name: "the current stage's name in the instance's version",
      opened_by_name: "the name of the login in opened_by",
      route: "the version's stages with where the request stands on each",
      decisions: "the instance's workflow_decision rows",
      can_decide: "the caller is named on the current stage",
      can_withdraw: "the caller opened the request and it is pending",
      can_reassign: "the caller approves the module's records with scope all",
      link: "derived from entity_type and entity_id through shared/route-map.js",
    },
  },
  ApproveBody: { table: "workflow_decision" },
  ReasonBody: { table: "workflow_decision" },
  WithdrawBody: { table: "workflow_decision" },
  ReassignBody: {
    table: "workflow_decision",
    virtual: { user_id: "the login the current stage goes to; stored in workflow_instance.stage_approvers" },
  },
};

module.exports = {
  TABLES,
  ApprovalState,
  ApproverType,
  ContextType,
  ConditionOp,
  Decision,
  StageCondition,
  StageApprover,
  ApprovalStageInput,
  ApprovalStepsUpdate,
  ApproverView,
  ApprovalStage,
  ApprovalFlow,
  ApprovalFlowListQuery,
  ApprovalFlowPage,
  ApprovalsSummary,
  ApprovalWaiting,
  ApprovalMineQuery,
  ApprovalWaitingPage,
  ApprovalCount,
  RouteStage,
  ApprovalDecision,
  ApprovalInstance,
  ApproveBody,
  ReasonBody,
  WithdrawBody,
  ReassignBody,
};
