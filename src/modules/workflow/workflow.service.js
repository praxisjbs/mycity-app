"use strict";
/**
 * Approvals as people meet them, over the engine (shared/workflow).
 *
 * Who may do what (docs/guides/foundation.md §5, §8):
 *  - My Approvals lists the pending requests whose current stage names the caller, in
 *    the modules where the caller holds `approve` (the CEO approves everywhere).
 *  - A request is read by whoever opened it, the employee it is about, the people its
 *    current stage names, anyone who decided on it, and a holder of `view` on its
 *    module whose scope covers that employee. Anyone else gets a 404.
 *  - Deciding needs both: the stage names the caller (the engine checks, and nobody
 *    decides their own request, the CEO excepted), and the caller holds `approve` on
 *    the request's module (shared/workflow/approvers.js leaves that to the route).
 *  - Withdrawing is the requester's (or the CEO's), while it is pending.
 *  - Reassigning a stage whose approver has gone needs `approve` with scope `all` on
 *    the request's module: Operations & People, Management, the CEO (§11).
 *  - Settings, Approvals edits a flow as a new version; open requests keep theirs.
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const catalog = require("../../shared/access/access.catalog");
const grantsCache = require("../../shared/rbac/grants-cache");
const routeMap = require("../../shared/route-map");
const deliveryPlan = require("../../shared/delivery-plan");
const engine = require("../../shared/workflow/engine");
const cond = require("../../shared/workflow/conditions");
const definitions = require("../../shared/workflow/definitions");
const approvers = require("../../shared/workflow/approvers");
const c = require("@mycity/contract");
const repo = require("./workflow.repo");
const { EVENTS } = require("./workflow.events");

const rbac = () => require("../../middleware/rbac");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "Approval not found", 404);

/* ------------------------------------------------------------------ *
 * Grants
 * ------------------------------------------------------------------ */

/** The modules where the user holds `approve`; null for the CEO, who approves everywhere. */
async function approveModules(user) {
  if (user.is_ceo === true) return null;
  const out = [];
  for (const module of catalog.MODULES) {
    const rows = await grantsCache.getGrants(pool, { role_ids: user.role_ids || [], module });
    if (rbac().scopeFromGrants(rows, "approve")) out.push(module);
  }
  return out;
}

async function approveScope(user, module) {
  if (user.is_ceo === true) return "all";
  const rows = await grantsCache.getGrants(pool, { role_ids: user.role_ids || [], module });
  return rbac().scopeFromGrants(rows, "approve");
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** A stage's condition as a list the screen can draw; a malformed stored one is left out. */
function conditionList(condition) {
  if (condition === null || condition === undefined) return [];
  const list = Array.isArray(condition) ? condition : [condition];
  return list.filter((x) => c.workflow.StageCondition.safeParse(x).success);
}

/** Every name the approvers of these stages need, fetched once. */
async function namesFor(client, approverLists) {
  // One after another: on a transaction's client, queries cannot overlap.
  const all = approverLists.flat();
  const of = (type) => all.filter((a) => a && a.type === type).map((a) => a.value);
  const roles = await repo.roleNames(client, of("role"));
  const users = await repo.namesOfUsers(client, of("user"));
  const employees = await repo.employeeNames(client, of("employee"));
  return { roles, users, employees };
}

/** One approver as a person reads it. */
function approverView(a, names) {
  const type = (a && a.type) || "unknown";
  const value = a && a.value !== undefined && a.value !== null ? String(a.value) : null;
  let label;
  if (type === "role") label = names.roles.get(value) || value || "A Role";
  else if (type === "user") label = names.users.get(value) || "A Login";
  else if (type === "employee") label = names.employees.get(value) || "Line Manager";
  else if (type === "manager_of_subject") label = "Line Manager";
  else if (type === "employee_in_context") label = "Named Person";
  else if (type === "ceo") label = "CEO";
  else label = "Not Set";
  return { type, value, label };
}

function stageView(stage, names) {
  return {
    key: String(stage.key || ""),
    name: String(stage.name || stage.key || ""),
    approvers: stage.approvers.map((a) => approverView(a, names)),
    condition: conditionList(stage.condition),
    sla_hours: Number(stage.sla_hours),
    on_timeout: String(stage.on_timeout),
    on_approve: String(stage.on_approve),
    on_reject: String(stage.on_reject),
  };
}

/** A stored flow row as ApprovalFlow. */
function flowView(row, names) {
  const def = definitions.fromRow(row);
  return {
    workflow_definition_id: row.workflow_definition_id,
    key: row.key,
    version: Number(row.version),
    module_key: row.module_key,
    name: row.name,
    description: row.description || null,
    context_types: row.context_types || {},
    stages: cond.stagesOf(def).map((s) => stageView(s, names)),
    open_requests: Number(row.open_requests) || 0,
    problems: definitions.problemsOf(def).map((p) => plainly(p, def.stages)),
    created_by_name: row.created_by_name || null,
    created_at: row.created_at,
  };
}

async function flowsView(client, rows) {
  const names = await namesFor(
    client,
    rows.flatMap((r) => cond.stagesOf({ stages: r.stages }).map((s) => s.approvers)),
  );
  return rows.map((r) => flowView(r, names));
}

/** The link to the record a request is about, for the caller. */
function linkOf(instance, user) {
  const self = Boolean(user.employee_id && instance.subject_employee_id === user.employee_id);
  const link = routeMap.linkFor(instance.entity_type, instance.entity_id, { self });
  return link ? link.path : null;
}

/* ------------------------------------------------------------------ *
 * Settings, Approvals
 * ------------------------------------------------------------------ */

async function listFlows(query) {
  const page = await repo.listFlows(pool, query);
  return { ...page, data: await flowsView(pool, page.data) };
}

async function summary() {
  const counts = await repo.summaryCounts(pool);
  const defs = await repo.activeDefinitions(pool);
  const needsFixing = defs.filter((r) => definitions.problemsOf(definitions.fromRow(r)).length > 0).length;
  return { ...counts, needs_fixing: needsFixing };
}

/** Stages as the screen sent them, in the engine's authored shape. */
function authoredStages(stages) {
  return stages.map((s) => ({
    key: s.key,
    name: s.name,
    approvers: s.approvers.map((a) => (a.value === undefined ? { type: a.type } : { type: a.type, value: a.value })),
    condition: s.condition.length === 0 ? null : s.condition.length === 1 ? s.condition[0] : s.condition,
    sla_hours: s.sla_hours,
    on_timeout: s.on_timeout,
    on_approve: s.on_approve,
    on_reject: s.on_reject,
  }));
}

/** What a definition problem means to the person who set the stages: the stage by its name, the rule in words. */
const PLAIN = [
  [/sla_hours/, "the time limit is 1 to 2,160 hours"],
  [/name at least one approver/, "it names nobody to decide"],
  [/approver needs a value|named person's value/, "pick who decides"],
  [/user approver's value/, "pick a person"],
  [/key is used twice/, "two stages share a key"],
  [/never approves itself/, "a request with money never approves itself on time out"],
  [/condition/, "its condition does not fit these requests"],
];
function plainly(problem, stages = []) {
  const m = /^stage (\d+)(?: \([^)]*\))?( condition)?: (.*)$/.exec(problem);
  if (!m) return problem === "at least one stage is required" ? "Add a stage" : "Check the stages";
  const n = Number(m[1]);
  const name = (stages[n - 1] && stages[n - 1].name) || `Stage ${n}`;
  const rule = `${m[2] ? "condition " : ""}${m[3]}`;
  const words = (PLAIN.find(([re]) => re.test(rule)) || [null, "check its settings"])[1];
  return `${name}: ${words}`;
}

/** The person-facing refusal of a route: each problem plainly, on Stages. */
const refuseRoute = (problems) =>
  new AppError("WORKFLOW_DEFINITION_INVALID", "Fix the stages first", 422, { stages: problems });

/** Every role a stage names is a role, and every login is a login: a stage nobody can decide is refused. */
async function assertApproversExist(client, stages) {
  const problems = [];
  for (const s of stages) {
    const codes = s.approvers.filter((a) => a.type === "role").map((a) => a.value);
    const users = s.approvers.filter((a) => a.type === "user").map((a) => a.value);
    const roles = await repo.roleNames(client, codes);
    const logins = await repo.namesOfUsers(client, users);
    if (codes.some((code) => !roles.has(code))) problems.push(`${s.name}: a role it names no longer exists`);
    if (users.some((id) => !logins.has(id))) problems.push(`${s.name}: a person it names has no login`);
  }
  if (problems.length) throw refuseRoute(problems);
}

/**
 * Save a flow's stages as a new version. `id` is the version on screen: when someone
 * saved another since, the save is refused rather than written over theirs.
 */
async function saveSteps(actor, id, { stages }) {
  return tx(async (client) => {
    const current = await repo.flowById(client, id);
    if (!current) throw new AppError("NOT_FOUND", "Approval flow not found", 404);
    if (!current.active) {
      throw new AppError("WORKFLOW_DEFINITION_STALE", "This flow changed since you opened it. Open it again.", 409);
    }
    const before = definitions.fromRow(current);
    const proposed = {
      key: before.key,
      module: before.module,
      name: before.name,
      description: before.description,
      context: before.context,
      stages: authoredStages(stages),
    };
    // Refused in the words of the stages, never the engine's (definitions.assertValid is for code).
    const problems = definitions.problemsOf(proposed);
    if (problems.length) throw refuseRoute(problems.map((p) => plainly(p, stages)));
    const next = definitions.assertValid(proposed);
    await assertApproversExist(client, stages);
    const saved = await definitions.saveVersion(client, next, { created_by: actor.user_id });
    await emit(client, {
      key: EVENTS.WORKFLOW_DEFINITION_SAVED,
      entity: { type: "workflow_definition", id: saved.workflow_definition_id },
      actor,
      before: { version: before.version, stages: before.stages },
      after: { version: saved.version, stages: saved.stages },
      payload: { key: saved.key, from_version: before.version, version: saved.version },
    });
    const row = await repo.flowById(client, saved.workflow_definition_id);
    return (await flowsView(client, [row]))[0];
  });
}

/* ------------------------------------------------------------------ *
 * My Approvals
 * ------------------------------------------------------------------ */

/** My Approvals; `client` is the caller's when it reads inside its own transaction (⌘K). */
async function mine(user, query, client = pool) {
  const roleCodes = await approvers.roleCodesOf(client, user.role_ids || []);
  const modules = await approveModules(user);
  // A request about a record whose screen has not shipped would open Coming Soon: never offered.
  const page = await repo.waiting(client, user, roleCodes, modules, query, deliveryPlan.closedTypes());
  return {
    ...page,
    data: page.data.map(({ stages, ...r }) => {
      const stage = cond.stageByKey({ stages }, r.current_stage);
      return {
        ...r,
        stage_name: stage ? stage.name : r.current_stage,
        context: r.context || {},
        link: linkOf(r, user),
      };
    }),
  };
}

async function mineCount(user) {
  const [roleCodes, modules] = await Promise.all([
    approvers.roleCodesOf(pool, user.role_ids || []),
    approveModules(user),
  ]);
  return repo.waitingCount(pool, user, roleCodes, modules, deliveryPlan.closedTypes());
}

/* ------------------------------------------------------------------ *
 * One request
 * ------------------------------------------------------------------ */

/** Is the caller named by this snapshot (a role they hold, their login, their employee, the CEO)? */
async function named(client, snapshot, user) {
  const list = snapshot || [];
  if (list.some((a) => a.type === "ceo") && user.is_ceo === true) return true;
  if (list.some((a) => a.type === "user" && a.value === user.user_id)) return true;
  if (user.employee_id && list.some((a) => a.type === "employee" && a.value === user.employee_id)) return true;
  const wanted = list.filter((a) => a.type === "role").map((a) => a.value);
  if (wanted.length === 0) return false;
  const held = await approvers.roleCodesOf(client, user.role_ids || []);
  return held.some((code) => wanted.includes(code));
}

/** May the caller read this request? */
async function mayRead(client, instance, user) {
  if (user.is_ceo === true) return true;
  if (instance.opened_by && instance.opened_by === user.user_id) return true;
  if (user.employee_id && instance.subject_employee_id === user.employee_id) return true;
  if (instance.decisions.some((d) => d.actor_id && d.actor_id === user.user_id)) return true;
  if (instance.state === "pending" && (await named(client, instance.stage_approvers, user))) return true;
  const scope = await rbac().scopeFor(user, instance.module_key, "view");
  if (!scope) return false;
  if (scope.scope === "all") return true;
  return Boolean(instance.subject_employee_id && (scope.scope_ids || []).includes(instance.subject_employee_id));
}

/** Where the request stands on each stage of its version. */
function routeOf(def, instance) {
  const all = cond.stagesOf(def);
  let applies;
  try {
    applies = new Set(cond.applicableStages(def, instance.context || {}).map((s) => s.key));
  } catch {
    applies = new Set(all.map((s) => s.key));
  }
  const decided = new Map();
  for (const d of instance.decisions) decided.set(d.stage_key, d.decision);
  const at = all.findIndex((s) => s.key === instance.current_stage);
  return all.map((s, i) => {
    let state;
    if (!applies.has(s.key)) state = "skipped";
    else if (instance.state === "pending") state = i < at ? "done" : i === at ? "now" : "todo";
    else if (instance.state === "approved" || instance.state === "timeout_approved")
      state = decided.has(s.key) || at === -1 || i <= at ? "done" : "skipped";
    else state = i < at ? "done" : i === at ? "stopped" : "skipped";
    return { stage: s, state };
  });
}

async function detail(client, id, user) {
  const instance = await engine.getInstance(client, id);
  if (!instance || !(await mayRead(client, instance, user))) throw notFound();
  const def = await definitions.findById(client, instance.workflow_definition_id);
  const route = routeOf(def, instance);
  const authored = route.map(({ stage, state }) => (state === "now" ? instance.stage_approvers : stage.approvers));
  const names = await namesFor(client, authored);
  const people = await repo.instanceNames(client, instance);
  const actors = await repo.namesOfUsers(client, instance.decisions.map((d) => d.actor_id));
  const pending = instance.state === "pending";
  const approves = await approveScope(user, instance.module_key);
  const stage = instance.current_stage ? cond.stageByKey(def, instance.current_stage) : null;
  return {
    workflow_instance_id: instance.workflow_instance_id,
    definition_key: instance.definition_key,
    definition_name: def.name,
    version: def.version,
    module_key: instance.module_key,
    entity_type: instance.entity_type,
    entity_id: instance.entity_id,
    subject_employee_id: instance.subject_employee_id,
    subject_name: people.subject_name || null,
    state: instance.state,
    current_stage: pending ? instance.current_stage : null,
    stage_name: pending && stage ? stage.name : null,
    context: instance.context || {},
    stage_entered_at: instance.stage_entered_at,
    stage_due_at: pending ? instance.stage_due_at : null,
    opened_by: instance.opened_by,
    opened_by_name: people.opened_by_name || null,
    opened_at: instance.opened_at,
    completed_at: instance.completed_at,
    route: route.map(({ stage: s, state }, i) => ({
      key: s.key,
      name: s.name,
      state,
      approvers: authored[i].map((a) => approverView(a, names)),
    })),
    decisions: instance.decisions.map((d) => {
      const s = cond.stageByKey(def, d.stage_key);
      return {
        workflow_decision_id: d.workflow_decision_id,
        stage_key: d.stage_key,
        stage_name: s ? s.name : null,
        actor_id: d.actor_id,
        actor_name: d.actor_id ? actors.get(d.actor_id) || null : null,
        decision: d.decision,
        reason: d.reason,
        decided_at: d.decided_at,
      };
    }),
    can_decide:
      pending && Boolean(approves) && (await approvers.canAct(client, instance.stage_approvers, user, instance)),
    can_withdraw: pending && (user.is_ceo === true || instance.opened_by === user.user_id),
    can_reassign: pending && approves === "all",
    link: linkOf(instance, user),
  };
}

async function getInstance(user, id) {
  return detail(pool, id, user);
}

/**
 * The module of a request the caller may read, or a 404. Deciding on a request you
 * cannot even see says nothing about it.
 */
async function readable(client, id, user) {
  const found = await engine.getInstance(client, id);
  if (!found || !(await mayRead(client, found, user))) throw notFound();
  return found;
}

/**
 * Approve, reject or request changes on the current stage, on the caller's transaction: a module
 * that keeps something with the decision (a sanction's signature, queries.md §6.4) writes it and
 * decides in one transaction. The same checks as decide().
 */
async function decideIn(client, user, id, decision, reason = null) {
  const found = await readable(client, id, user);
  if (!(await approveScope(user, found.module_key))) {
    throw new AppError("PERMISSION_DENIED", "You do not approve these requests", 403);
  }
  await engine.act(client, { instance_id: id, actor: user, decision, reason });
  return detail(client, id, user);
}

/** Approve, reject or request changes on the current stage. */
async function decide(user, id, decision, reason = null) {
  return tx((client) => decideIn(client, user, id, decision, reason));
}

/** The requester takes a pending request back. */
async function withdraw(user, id, reason = null) {
  return tx(async (client) => {
    await readable(client, id, user);
    await engine.cancel(client, { instance_id: id, actor: user, reason });
    return detail(client, id, user);
  });
}

/**
 * Give the current stage to one login instead: its approver has left, or is away. The
 * new approver is told; the time limit starts again for them.
 */
async function reassign(user, id, { user_id: toUserId, reason }) {
  return tx(async (client) => {
    const found = await readable(client, id, user);
    if ((await approveScope(user, found.module_key)) !== "all") {
      throw new AppError("PERMISSION_DENIED", "Only Operations & People reassign approvals", 403);
    }
    const locked = await repo.lockPending(client, id);
    if (!locked || locked.state !== "pending") {
      throw new AppError("WORKFLOW_CLOSED", "This approval is already decided", 409);
    }
    const to = await repo.activeUser(client, toUserId);
    if (!to) throw new AppError("VALIDATION_FAILED", "Pick an active login", 422, { user_id: ["Pick an active login"] });
    if (locked.opened_by && to.user_id === locked.opened_by) {
      throw new AppError("VALIDATION_FAILED", "Not the requester", 422, { user_id: ["Not the requester"] });
    }
    // Someone the approval excludes never decides it (a temporary site's people, foundation.md §6.5).
    if (to.employee_id && (locked.excluded_employee_ids || []).includes(to.employee_id)) {
      throw new AppError("VALIDATION_FAILED", "Not someone on it", 422, { user_id: ["Not someone on it"] });
    }
    if (!(await approveScope(to, locked.module_key))) {
      throw new AppError("VALIDATION_FAILED", "They cannot approve these", 422, { user_id: ["They cannot approve these"] });
    }
    const def = await definitions.findById(client, locked.workflow_definition_id);
    const stage = cond.stageByKey(def, locked.current_stage);
    const snapshot = [{ type: "user", value: to.user_id, via: "reassigned" }];
    await repo.insertDecision(client, {
      instance_id: id,
      stage_key: locked.current_stage,
      actor_id: user.user_id,
      decision: "reassign",
      reason,
    });
    await repo.setStageApprovers(client, id, snapshot, stage ? stage.sla_hours : cond.DEFAULT_SLA_HOURS);
    await emit(client, {
      key: EVENTS.WORKFLOW_REASSIGNED,
      entity: { type: locked.entity_type, id: locked.entity_id },
      module: locked.module_key,
      actor: user,
      payload: {
        instance_id: id,
        definition_key: locked.definition_key,
        definition_name: def.name,
        state: "pending",
        stage: locked.current_stage,
        stage_name: stage ? stage.name : null,
        stage_approvers: snapshot,
        reassigned_from: locked.stage_approvers,
        subject_employee_id: locked.subject_employee_id,
        opened_by: locked.opened_by,
        excluded_employee_ids: locked.excluded_employee_ids || [],
        reason,
      },
    });
    return detail(client, id, user);
  });
}

module.exports = {
  approveModules,
  conditionList,
  approverView,
  routeOf,
  authoredStages,
  listFlows,
  summary,
  saveSteps,
  plainly,
  mine,
  mineCount,
  getInstance,
  decide,
  decideIn,
  withdraw,
  reassign,
};
