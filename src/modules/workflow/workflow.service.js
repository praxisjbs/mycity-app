"use strict";
/**
 * Approvals as people meet them, over the engine (shared/workflow).
 *
 * Who may do what (docs/guides/foundation.md §5, §8):
 *  - My Approvals lists the pending requests whose current stage names the caller, in
 *    the modules where the caller holds `approve` (the CEO approves everywhere).
 *  - A request is read by whoever opened it, the employee it is about, the people its
 *    current stage names, anyone who decided on it, and a holder of `view` on its
 *    module whose scope covers that employee (for `queries`, scope `all` only). Anyone
 *    else gets a 404.
 *  - Deciding needs both: the stage names the caller (the engine checks, and nobody
 *    decides their own request, the CEO excepted), and the caller holds `approve` on
 *    the request's module (shared/workflow/approvers.js leaves that to the route).
 *  - A request decided on its own record (definitions.decidedOnRecord: a sanction, decided on its
 *    query's card) is listed and read here, but never decided here: 409, and can_decide false.
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
    // A flow the code ships is in use before its first request; one made on screen is not until a module opens it.
    used: definitions.getDefault(row.key) !== null || row.ever_opened === true,
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

const nameRefused = (message) => new AppError("VALIDATION_FAILED", message, 422, { name: [message] });

/**
 * Make a flow on screen: version 1, under the key its module and name give. Nothing opens it
 * until a module's service calls openInstance with that key, so it lists as Not Used Yet.
 */
async function createFlow(actor, body) {
  return tx(async (client) => {
    if (!catalog.isModule(body.module_key)) {
      throw new AppError("VALIDATION_FAILED", "Pick a module", 422, { module_key: ["Pick a module"] });
    }
    const key = definitions.keyFor(body.module_key, body.name);
    if (!key) throw nameRefused("Use letters");
    if (await definitions.keyTaken(client, key)) throw nameRefused("Name already used");
    const proposed = {
      key,
      module: body.module_key,
      name: body.name,
      description: body.description ?? null,
      context: body.context_types,
      stages: authoredStages(body.stages),
    };
    const problems = definitions.problemsOf(proposed);
    if (problems.length) throw refuseRoute(problems.map((p) => plainly(p, body.stages)));
    await assertApproversExist(client, body.stages);
    const saved = await definitions.saveVersion(client, proposed, { created_by: actor.user_id });
    await emit(client, {
      key: EVENTS.WORKFLOW_DEFINITION_CREATED,
      entity: { type: "workflow_definition", id: saved.workflow_definition_id },
      actor,
      after: { key: saved.key, version: saved.version, module: saved.module, name: saved.name, stages: saved.stages },
      payload: { key: saved.key, version: saved.version, module_key: saved.module },
    });
    const row = await repo.flowById(client, saved.workflow_definition_id);
    return (await flowsView(client, [row]))[0];
  });
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

/** The age bands as the assistant's summary reads them. */
const AGE_WORDS = Object.freeze({
  "1_under_a_day": "Under a day",
  "2_one_to_three_days": "1 to 3 days",
  "3_four_to_seven_days": "4 to 7 days",
  "4_over_a_week": "Over a week",
});

/**
 * The assistant's approvals summary (docs/guides/praxis-ai.md §6.13; foundation.md §9): what waits on
 * the asker, counted by flow, age and stage or module; figures, never a row. Runs on the client the
 * assistant hands over, inside its read timeout.
 * @param {{query: Function}} client
 * @param {object} params   ApprovalSummaryQuery, parsed
 * @param {object} user     the asker
 */
async function aiSummary(client, params, user) {
  const { figure, group } = require("../../shared/ai/summary");
  const roleCodes = await approvers.roleCodesOf(client, user.role_ids || []);
  const modules = await approveModules(user);
  const r = await repo.waitingSummary(client, user, roleCodes, modules, params, deliveryPlan.closedTypes());
  const f = r.figures || {};
  const moduleLabel = (key) => (catalog.MODULE_META[key] ? catalog.MODULE_META[key].label : key);
  const third = params.by === "stage" ? group("stage", "Waiting by stage", r.by_third) : group("module", "Waiting by module", r.by_third.map((x) => ({ ...x, label: moduleLabel(x.label) })));
  return {
    figures: [
      figure("waiting", "Waiting on me", f.waiting),
      figure("overdue", "Past their time", f.overdue),
      figure("due_within_a_day", "Due within a day", f.due_within_a_day),
      figure("oldest_days", "Oldest, in days", f.oldest_days, "days"),
      figure("flows", "Flows", f.flows),
    ],
    groups: [
      group("flow", "Waiting by flow", r.by_flow),
      group("age", "Waiting by age", r.by_age.map((x) => ({ ...x, label: AGE_WORDS[x.label] || x.label }))),
      third,
    ],
    series: [],
    total: f.waiting || 0,
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

/** Modules whose `view` scope `team` does not reach their people's requests (queries.md §6.1). */
const NARROW_MODULES = new Set(["queries"]);

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
  // A module whose records a team scope never widens (a sanction, queries.md §6.1) is read here
  // only by those above, or with scope all.
  if (NARROW_MODULES.has(instance.module_key)) return false;
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
      pending &&
      !definitions.decidedOnRecord(instance.definition_key) &&
      Boolean(approves) &&
      (await approvers.canAct(client, instance.stage_approvers, user, instance)),
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

/**
 * Whether the caller may act on the stage a request waits on, wherever it is decided: the record
 * that decides its own approval (decidedOnRecord) asks this for its card.
 */
async function mayAct(user, id) {
  const instance = await engine.getInstance(pool, id);
  if (!instance || instance.state !== "pending") return false;
  if (!(await approveScope(user, instance.module_key))) return false;
  return approvers.canAct(pool, instance.stage_approvers, user, instance);
}

/**
 * The stage a request waits on and its name, for a record that has already checked its reader may
 * see it (a query's card, queries.md §6.1): no read check of its own. Null once it has completed.
 */
async function pendingStage(id) {
  const instance = await engine.getInstance(pool, id);
  if (!instance || instance.state !== "pending" || !instance.current_stage) return null;
  const def = await definitions.findById(pool, instance.workflow_definition_id);
  const stage = cond.stageByKey(def, instance.current_stage);
  return { key: instance.current_stage, name: stage ? stage.name : instance.current_stage };
}

/** The stage a request waits on, under the caller's transaction (null once it has completed). */
async function stageOf(client, id) {
  const found = await engine.getInstance(client, id);
  return found && found.state === "pending" ? found.current_stage : null;
}

/** Approve, reject or request changes on the current stage, from My Approvals. */
async function decide(user, id, decision, reason = null) {
  return tx(async (client) => {
    const found = await readable(client, id, user);
    if (definitions.decidedOnRecord(found.definition_key))
      throw new AppError("DECIDE_ON_RECORD", "Decide this on its record", 409);
    return decideIn(client, user, id, decision, reason);
  });
}

/* ------------------------------------------------------------------ *
 * Praxis AI's card on My Approvals (docs/guides/praxis-ai.md §6.11): the requests waiting on
 * the person decided together, each through decide(), the same call the screen's buttons make.
 * ------------------------------------------------------------------ */

const DECIDED_WORD = Object.freeze({ approve: "approved", reject: "rejected", request_changes: "returned for changes" });

/** A request as a card names it: what it is, about whom. */
const instanceLabel = (i) => `${i.definition_name || i.definition_key}${i.subject_name ? `, ${i.subject_name}` : ""}`;

/**
 * The requests a card names, as the person may read them: the flow and who it is about for each
 * they may read; one they may not keeps its id alone, and the re-check refuses the card.
 */
async function cardRecords(db, ids, user) {
  const out = [];
  for (const id of [...new Set(ids || [])].slice(0, 25)) {
    const found = await engine.getInstance(db, id);
    const mayReadIt = found && (await mayRead(db, found, user));
    let label = null;
    if (mayReadIt) {
      const def = await definitions.findById(db, found.workflow_definition_id);
      const name = found.subject_employee_id ? (await repo.employeeNames(db, [found.subject_employee_id])).get(found.subject_employee_id) || null : null;
      label = instanceLabel({ ...found, definition_name: def ? def.name : null, subject_name: name });
    }
    out.push({ type: "workflow_instance", id, label });
  }
  return out;
}

/** The card's re-check (§6.11 step 5): every request is one the person may read; the stage, the state and the chain are each request's own line at the press. */
async function assertCardInstances(db, ids, user) {
  for (const id of [...new Set(ids || [])]) {
    const found = await engine.getInstance(db, id);
    if (!found || !(await mayRead(db, found, user)))
      throw new AppError("APPROVAL_NOT_YOURS", "One of these requests is not yours to read", 404, { workflow_instance_ids: ["Not yours to read"] });
  }
}

/**
 * Decide the requests a card names, one after another, each through decide(): one already
 * decided, not waiting on this person, their own, or decided on its record is a line of its own
 * (the last with the record's screen) and the rest still go. Nothing decided is a refusal, so
 * the card stays open with the reason.
 * @param {object} user
 * @param {{workflow_instance_ids: string[], decision: "approve"|"reject"|"request_changes", reason?: string}} values
 * @returns {Promise<{lines: Array<{type: string, id: string, label: string, ok: boolean, message: string|null, link: string|null}>}>}
 */
async function decideMany(user, { workflow_instance_ids: ids, decision, reason = null }) {
  const lines = [];
  let firstRefusal = null;
  for (const id of [...new Set(ids || [])]) {
    const found = await engine.getInstance(pool, id);
    const record = found ? (await cardRecords(pool, [id], user))[0] : null;
    const label = record && record.label ? record.label : id;
    const link = found ? linkOf(found, user) : null;
    try {
      if (!found) throw notFound();
      if (user.employee_id && found.subject_employee_id === user.employee_id && user.is_ceo !== true)
        throw new AppError("SELF_APPROVAL", "Nobody decides their own request", 403);
      if (found.state !== "pending") throw new AppError("WORKFLOW_CLOSED", "This request was already decided", 409);
      await decide(user, id, decision, reason);
      lines.push({ type: "workflow_instance", id, label, ok: true, message: DECIDED_WORD[decision] || decision, link });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      firstRefusal = firstRefusal || err;
      lines.push({ type: "workflow_instance", id, label, ok: false, message: err.message, link });
    }
  }
  if (lines.length && !lines.some((l) => l.ok)) throw firstRefusal;
  return { lines };
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
  createFlow,
  saveSteps,
  plainly,
  mine,
  mineCount,
  aiSummary,
  getInstance,
  decide,
  decideIn,
  decideMany,
  cardRecords,
  assertCardInstances,
  stageOf,
  mayAct,
  pendingStage,
  withdraw,
  reassign,
};
