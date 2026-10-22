"use strict";
/**
 * Goals: the one write path for quarters (docs/guides/performance.md §4, §5, §6.2), and in PR 2
 * for organisational goals, objectives, key results, monthly reports, plans and target changes.
 *
 * A quarter carries its own scoring rules (ScoringRules): a new quarter copies the last one's,
 * the code's defaults for the first, so a rule changed next quarter never rewrites this one.
 * Its status runs planning → active → closed, one active at a time.
 */
const { pool } = require("../../config/db");
const authority = require("./goals.authority");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scoring } = require("@mycity/contract");
const periods = require("./goals.periods");
const repo = require("./goals.repo");
const { EVENTS } = require("./goals.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That quarter does not exist", 404);

/** A dates-only value from the database or the wire, as YYYY-MM-DD. */
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/** A performance_period row as PerformancePeriod. */
function periodView(row) {
  const startsOn = day(row.starts_on);
  return {
    performance_period_id: row.performance_period_id,
    name: row.name,
    starts_on: startsOn,
    ends_on: day(row.ends_on),
    plan_year_starts_on: day(row.plan_year_starts_on),
    targets_lock_on: day(row.targets_lock_on),
    live_from: day(row.live_from),
    status: row.status,
    rules: row.rules,
    months: periods.monthsOf(startsOn),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** A date the quarter's own days must hold (the lock date, the first live day). */
function assertInQuarter(field, value, startsOn, endsOn) {
  if (value && (value < startsOn || value > endsOn))
    throw new AppError("VALIDATION_FAILED", "Pick a day inside the quarter", 422, { [field]: ["Outside the quarter"] });
}

const ORDER = { planning: 0, active: 1, closed: 2 };

async function listPeriods(query) {
  const page = await repo.listPeriods(pool, query);
  return { ...page, data: page.data.map(periodView) };
}

async function getPeriod(id) {
  const row = await repo.getPeriod(pool, id);
  if (!row) throw notFound();
  return periodView(row);
}

/** The active quarter, else the latest one still being planned; 404 when there is none. */
async function currentPeriod(db = pool) {
  const row = await repo.currentPeriod(db);
  if (!row)
    throw new AppError("NO_QUARTER", "No quarter has been set up yet", 404);
  return periodView(row);
}

/**
 * Set up a quarter: its name, end and plan year follow from its first day unless given; its rules
 * are copied from the quarter before it (the code's defaults for the first).
 */
async function createPeriod(actor, body) {
  const startsOn = body.starts_on;
  const endsOn = periods.quarterEnd(startsOn);
  assertInQuarter("targets_lock_on", body.targets_lock_on, startsOn, endsOn);
  assertInQuarter("live_from", body.live_from, startsOn, endsOn);
  const id = await tx(async (client) => {
    if (await repo.periodStarting(client, startsOn))
      throw new AppError("PERIOD_EXISTS", "That quarter is already set up", 409, { starts_on: ["Already set up"] });
    const before = await repo.periodBefore(client, startsOn);
    const rules = scoring.ScoringRules.parse(before ? before.rules : scoring.DEFAULT_RULES);
    const row = await repo.insertPeriod(client, {
      name: body.name || periods.quarterName(startsOn),
      starts_on: startsOn,
      ends_on: endsOn,
      plan_year_starts_on: body.plan_year_starts_on || periods.planYearOf(startsOn),
      targets_lock_on: body.targets_lock_on || null,
      live_from: body.live_from || null,
      rules,
    });
    const after = await repo.getPeriod(client, row.performance_period_id);
    await emit(client, {
      key: EVENTS.PERIOD_CREATED,
      entity: { type: "performance_period", id: row.performance_period_id },
      actor,
      after,
      payload: { performance_period_id: row.performance_period_id, name: after.name, copied_from: before ? before.performance_period_id : null },
    });
    return row.performance_period_id;
  });
  return getPeriod(id);
}

/** Change a quarter's name, lock date, first live day, rules or status. */
async function updatePeriod(actor, id, patch) {
  const id2 = await tx(async (client) => {
    const before = await repo.getPeriod(client, id);
    if (!before) throw notFound();
    const startsOn = day(before.starts_on);
    const endsOn = day(before.ends_on);
    assertInQuarter("targets_lock_on", patch.targets_lock_on, startsOn, endsOn);
    assertInQuarter("live_from", patch.live_from, startsOn, endsOn);
    if (patch.status && patch.status !== before.status) {
      if (ORDER[patch.status] < ORDER[before.status])
        throw new AppError("PERIOD_STATUS", "A quarter moves forward only: planning, active, closed", 409, {
          status: ["Cannot go back"],
        });
      if (patch.status === "active" && (await repo.otherActive(client, id)))
        throw new AppError("PERIOD_ACTIVE_EXISTS", "Close the active quarter first", 409, { status: ["Another is active"] });
    }
    await repo.updatePeriod(client, id, patch);
    const after = await repo.getPeriod(client, id);
    await emit(client, {
      key: EVENTS.PERIOD_CHANGED,
      entity: { type: "performance_period", id },
      actor,
      before,
      after,
      payload: { performance_period_id: id, name: after.name, status: after.status },
    });
    return id;
  });
  return getPeriod(id2);
}

/* ------------------------------------------------------------------ *
 * Organisational goals (§3.1, §6.3): the CEO's, active at once (A16)
 * ------------------------------------------------------------------ */

/** An organisational_goal row as OrganisationalGoal. */
function goalView(g) {
  return {
    organisational_goal_id: g.organisational_goal_id,
    code: g.code,
    title: g.title,
    strategic_theme: g.strategic_theme,
    detail: g.detail,
    success_measure: g.success_measure,
    reference_target: g.reference_target,
    baseline: g.baseline,
    key_decisions: g.key_decisions,
    function_cascade: g.function_cascade,
    plan_year_starts_on: day(g.plan_year_starts_on),
    starts_on: day(g.starts_on),
    ends_on: day(g.ends_on),
    status: g.status === "closed" ? "closed" : "active",
    owner: g.owner,
    created_at: iso(g.created_at),
    updated_at: iso(g.updated_at),
  };
}

async function listGoals(query) {
  const page = await repo.listGoals(pool, query);
  return { ...page, data: page.data.map(goalView) };
}

async function getGoal(id) {
  const g = await repo.getGoal(pool, id);
  if (!g) throw new AppError("NOT_FOUND", "That goal does not exist", 404);
  const okrs = require("./goals.okrs");
  const objectives = [];
  for (const objectiveId of await repo.companyObjectivesOf(pool, id)) objectives.push(await okrs.getObjective(objectiveId));
  const { scoring: sc } = require("@mycity/contract");
  return {
    ...goalView(g),
    targets: (await repo.goalTargets(pool, id)).map((t) => ({ ...t })),
    objectives: objectives.map((o) => ({ okr_objective_id: o.okr_objective_id, code: o.code, title: o.title })),
    progress: sc.formatScore(sc.meanScore(objectives.map((o) => o.score))),
  };
}

/** POST /performance/goals: active at once; its year is the plan year, its owner the CEO who records it. */
async function createGoal(actor, body, { owner_employee_id: ownerId = null } = {}) {
  const owner = ownerId || (actor && actor.employee_id);
  if (!owner) throw new AppError("VALIDATION_FAILED", "A goal needs an owner with an employee record", 422);
  const year = body.plan_year_starts_on.slice(0, 4);
  const id = await tx(async (client) => {
    if (body.code && (await repo.goalCodeTaken(client, body.plan_year_starts_on, body.code)))
      throw new AppError("GOAL_CODE_TAKEN", "Another goal this year has that code", 409, { code: ["Already in use"] });
    const { targets = [], ...fields } = body;
    const newId = await repo.insertGoal(client, {
      ...fields,
      level: "organisation",
      status: "active",
      starts_on: `${year}-01-01`,
      ends_on: `${year}-12-31`,
      owner_employee_id: owner,
    });
    await repo.setGoalTargets(client, newId, targets);
    await emit(client, {
      key: EVENTS.ORGANISATIONAL_GOAL_SAVED,
      entity: { type: "organisational_goal", id: newId },
      actor,
      after: { code: body.code || null, title: body.title },
      payload: { organisational_goal_id: newId, code: body.code || null, title: body.title },
    });
    return newId;
  });
  return goalView(await repo.getGoal(pool, id));
}

/** PATCH /performance/goals/:id */
async function updateGoal(actor, id, patch) {
  const before = await repo.getGoal(pool, id);
  if (!before) throw new AppError("NOT_FOUND", "That goal does not exist", 404);
  await tx(async (client) => {
    if (patch.code && (await repo.goalCodeTaken(client, day(before.plan_year_starts_on), patch.code, id)))
      throw new AppError("GOAL_CODE_TAKEN", "Another goal this year has that code", 409, { code: ["Already in use"] });
    const { targets, ...fields } = patch;
    await repo.updateGoal(client, id, fields);
    if (targets) await repo.setGoalTargets(client, id, targets);
    await emit(client, {
      key: EVENTS.ORGANISATIONAL_GOAL_SAVED,
      entity: { type: "organisational_goal", id },
      actor,
      before: goalView(before),
      after: { ...goalView(before), ...fields },
      payload: { organisational_goal_id: id, code: fields.code ?? before.code, title: fields.title || before.title },
    });
  });
  return goalView(await repo.getGoal(pool, id));
}

/* ------------------------------------------------------------------ *
 * Plans (§6.4)
 * ------------------------------------------------------------------ */

const plansLib = require("./goals.plans");

/** A performance_plan row as Plan. */
function planView(p) {
  return {
    performance_plan_id: p.performance_plan_id,
    performance_period_id: p.performance_period_id,
    period_name: p.period_name,
    department_id: p.department_id,
    department: p.department,
    status: p.status,
    workflow_instance_id: p.workflow_instance_id,
    submitted_at: iso(p.submitted_at),
    returned_reason: p.returned_reason,
    binding_at: iso(p.binding_at),
    objective_count: p.objective_count,
    scorecard_count: p.scorecard_count,
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

async function listPlans(query) {
  const page = await repo.listPlans(pool, query);
  return { ...page, data: page.data.map(planView) };
}

/** What stops a plan being sent, and what only warns (§6.4). */
async function planProblems(db, plan, { objectives, scorecards, contributions }) {
  const out = [];
  if (!objectives.length) out.push({ code: "PLAN_EMPTY", message: "Add an objective first", blocking: true });
  for (const o of objectives)
    if (o.key_results.length === 1)
      out.push({ code: "OBJECTIVE_ONE_RESULT", message: `${o.code} holds one key result`, blocking: false });
  for (const card of scorecards)
    for (const w of card.weight_problems)
      out.push({
        code: "WEIGHTS_NOT_100",
        message: `${card.employee.display_name}: ${w.section === "kpis" ? "KPIs" : w.section[0].toUpperCase() + w.section.slice(1)} weights add to ${w.total}, not ${w.expected}`,
        blocking: true,
      });
  for (const c of contributions)
    if (c.status === "rebalance")
      out.push({ code: "CONTRIBUTION_REBALANCE", message: `${c.code}: shares are ${c.difference} off the target`, blocking: true });
  if (plan.department_id)
    for (const l of await plansLib.foreignLinks(db, plan))
      out.push({ code: "LINK_OTHER_QUARTER", message: `${l.person}: ${l.title} links another quarter's key result`, blocking: true });
  return out;
}

/**
 * Everything a plan binds, its problems, and whether the reader may send it. The problems count
 * every scorecard; the list shows only those the reader may read (`scope`, from the request).
 */
async function planDetail(id, actor, scope = null) {
  const plan = await repo.getPlan(pool, id);
  if (!plan) throw new AppError("NOT_FOUND", "That plan does not exist", 404);
  const okrs = require("./goals.okrs");
  const kpis = require("../kpis/kpis.service");
  const targets = require("../targets/targets.service");
  const targetsRepo = require("../targets/targets.repo");
  const weights = require("../targets/targets.weights");
  const objectives = await okrs.objectivesOfPlan(pool, id);
  const cards = plan.department_id ? await targetsRepo.ofDepartment(pool, plan.performance_period_id, plan.department_id) : [];
  const details = [];
  for (const c of cards) details.push(await targets.detail(pool, c, { ...actor, is_ceo: true }, { scope: "all", scope_ids: null }));
  const contributions = (await targetsRepo.contributions(pool, { planId: id })).map(weights.contribution);
  const problems = await planProblems(pool, plan, { objectives, scorecards: details, contributions });
  let mayAct;
  try {
    await authority.assertSetsGoals(pool, actor, plan.department_id);
    mayAct = true;
  } catch {
    mayAct = false;
  }
  return {
    ...planView(plan),
    objectives,
    kpis: plan.department_id ? await kpis.ofDepartment(pool, plan.department_id) : [],
    scorecards: await readable(cards, (c) => (scope ? targets.mayRead(pool, c, actor, scope) : true)).then((shown) =>
      shown.map((c) => targets.cardView(c)),
    ),
    contributions,
    problems,
    can_submit: mayAct && ["draft", "returned"].includes(plan.status) && !problems.some((p) => p.blocking),
  };
}

/** The items a reader may see, in order. */
async function readable(items, may) {
  const out = [];
  for (const item of items) if (await may(item)) out.push(item);
  return out;
}

/** Does the actor hold the Operations & People role? */
const isOperationsPeople = (db, actor) =>
  actor && (actor.role_ids || []).length ? repo.holdsRoleCode(db, actor.role_ids, "operations_people") : false;

/**
 * POST /performance/plans/:id/submit: Send Plan. Refuses while anything blocks; opens
 * `performance.plan` over the head (or acting head), whose line manager is its first stage.
 */
async function submitPlan(actor, id, scope = null) {
  const plan = await repo.getPlan(pool, id);
  if (!plan) throw new AppError("NOT_FOUND", "That plan does not exist", 404);
  await authority.assertSetsGoals(pool, actor, plan.department_id);
  if (!["draft", "returned"].includes(plan.status)) throw new AppError("PLAN_NOT_DRAFT", "This plan is already sent", 409);
  const detail = await planDetail(id, actor);
  const blocking = detail.problems.filter((p) => p.blocking);
  if (blocking.length)
    throw new AppError(blocking[0].code, blocking[0].message, 409, { problems: blocking.map((p) => p.message) });
  const organisation = require("../organisation/organisation.service");
  const head = plan.department_id ? await organisation.headOf(pool, plan.department_id) : null;
  const headManager = head ? await repo.effectiveManagerOf(pool, head) : null;
  const context = {
    head_reports_to_ceo: !headManager || (await repo.isCeoEmployee(pool, headManager)),
    by_operations_people: await isOperationsPeople(pool, actor),
    is_company: !plan.department_id,
  };
  const workflow = require("../../shared/workflow/engine");
  await tx(async (client) => {
    const instance = await workflow.openInstance(client, {
      definition_key: "performance.plan",
      entity: { type: "performance_plan", id },
      subject_employee_id: head,
      context,
      actor,
    });
    await repo.updatePlan(client, id, {
      status: "submitted",
      workflow_instance_id: instance.workflow_instance_id,
      submitted_by: actor && actor.user_id,
      submitted_at: new Date(),
      returned_reason: null,
    });
    await emit(client, {
      key: EVENTS.PLAN_SUBMITTED,
      entity: { type: "performance_plan", id },
      actor,
      payload: { performance_plan_id: id, department: plan.department, period: plan.period_name },
    });
  });
  return planDetail(id, actor, scope);
}

/* ------------------------------------------------------------------ *
 * Target changes (§6.7)
 * ------------------------------------------------------------------ */

async function listChanges(query) {
  const okrs = require("./goals.okrs");
  const page = await repo.listChanges(pool, query);
  return { ...page, data: page.data.map(okrs.changeView) };
}

/** POST /performance/target-changes: a binding key result's or line's target, to the CEO. */
async function requestChange(actor, scope, body) {
  const okrs = require("./goals.okrs");
  let from;
  if (body.okr_key_result_id) {
    const ctx = await repo.keyResultContext(pool, body.okr_key_result_id);
    if (!ctx) throw new AppError("NOT_FOUND", "That key result does not exist", 404);
    if (ctx.plan_status !== "binding") throw new AppError("PLAN_NOT_BINDING", "Edit a draft's target directly", 409);
    const owner = actor && actor.employee_id === ctx.accountable_employee_id;
    if (!owner) await authority.assertSetsGoals(pool, actor, ctx.department_id);
    from = { value: ctx.target_value, text: ctx.target_text };
  } else {
    const line = await require("../targets/targets.repo").lineWithCard(pool, body.employee_target_id);
    if (!line) throw new AppError("NOT_FOUND", "That line does not exist", 404);
    if (!["binding", "agreed"].includes(line.scorecard_status)) throw new AppError("SCORECARD_NOT_BINDING", "Edit a draft's lines directly", 409);
    if (!(await authority.runsTheCycle(actor))) {
      const { assertInScope } = require("../../shared/rbac/scope");
      assertInScope(scope, line.employee_id);
      if (line.employee_id === (actor && actor.employee_id)) throw new AppError("PERMISSION_DENIED", "Your reviewer changes your targets", 403);
    }
    from = { value: line.target_value, text: line.target_text };
  }
  if (await repo.changePending(pool, body))
    throw new AppError("CHANGE_PENDING", "A change to this target is already waiting for a decision", 409);
  const workflow = require("../../shared/workflow/engine");
  const id = await tx(async (client) => {
    const changeId = await repo.insertChange(client, {
      ...body,
      from_value: from.value,
      from_text: from.text,
      requested_by: actor && actor.user_id,
    });
    const instance = await workflow.openInstance(client, {
      definition_key: "performance.target_change",
      entity: { type: "target_change", id: changeId },
      subject_employee_id: actor && actor.employee_id,
      context: {},
      actor,
    });
    await repo.updateChange(client, changeId, { workflow_instance_id: instance.workflow_instance_id });
    await emit(client, {
      key: EVENTS.TARGET_CHANGE_REQUESTED,
      entity: { type: "target_change", id: changeId },
      actor,
      payload: { target_change_id: changeId, okr_key_result_id: body.okr_key_result_id || null, employee_target_id: body.employee_target_id || null },
    });
    return changeId;
  });
  return okrs.changeView(await repo.getChange(pool, id));
}

/**
 * The `targets-lock` job: every TBC target whose quarter's lock date has come locks, once.
 * @param {string} today  YYYY-MM-DD in Lagos
 */
async function lockTargets(today) {
  const due = await repo.provisionalDue(pool, today);
  if (!due.length) return { locked: 0 };
  const byPeriod = new Map();
  for (const kr of due) byPeriod.set(kr.performance_period_id, [...(byPeriod.get(kr.performance_period_id) || []), kr]);
  await tx(async (client) => {
    for (const [periodId, krs] of byPeriod) {
      for (const kr of krs) {
        await repo.updateKeyResult(client, kr.okr_key_result_id, { target_provisional: false, target_locked_at: new Date() });
        // The months reported while the target was TBC are scored now it is firm.
        await require("./goals.okrs").rescoreFrom(client, kr.okr_key_result_id);
      }
      await emit(client, {
        key: EVENTS.PERIOD_TARGETS_LOCKED,
        entity: { type: "performance_period", id: periodId },
        actor: null,
        payload: { performance_period_id: periodId, locked: krs.map((k) => k.code) },
      });
    }
  });
  return { locked: due.length };
}

module.exports = {
  periodView,
  listPeriods,
  getPeriod,
  currentPeriod,
  createPeriod,
  updatePeriod,
  goalView,
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  planView,
  listPlans,
  planDetail,
  submitPlan,
  listChanges,
  requestChange,
  lockTargets,
};
