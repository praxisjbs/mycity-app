"use strict";
/**
 * Goals: the one write path for every level of the cascade (A16;
 * docs/guides/performance.md §3 steps 1 to 3, §6).
 *
 *   create()       an organisational goal (active at once, the CEO's), or an annual or monthly
 *                  goal (a draft, until `performance.goal` approves it)
 *   insertGoal()   the shared insert the targets module uses for a departmental target
 *   edit()         a draft or returned goal; its quarters with it
 *   submit()       an annual or monthly goal into `performance.goal`
 *   decide()       approve or return the stage it waits at; the CEO's approval makes it active
 *   settle()       the outcome of a request that ended elsewhere (a timeout, a withdrawal)
 *
 * Reads: list(), summary(), get(). Goals are visible to everyone with the `performance`
 * grant; who may act is decided here, by capability and by the approval's stage.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const repo = require("./goals.repo");
const cascade = require("./goals.cascade");
const trace = require("./goals.trace");
const approval = require("./goals.approval");
const { EVENTS } = require("./goals.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That goal does not exist", 404);
const conflict = (code, message) => new AppError(code, message, 409);

/** The levels the Goals screen lists; departmental targets are on Targets. */
const GOAL_LEVELS = ["organisation", "annual", "monthly"];
const EDITABLE_STATUS = new Set(["draft", "returned"]);

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** A repo row and its progress as the contract's Goal. */
function toGoal(row, progress) {
  return {
    organisational_goal_id: row.organisational_goal_id,
    code: row.code,
    level: row.level,
    title: row.title,
    strategic_theme: row.strategic_theme,
    success_measure: row.success_measure,
    baseline: row.baseline,
    description: row.description,
    status: row.status,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    department: row.department,
    department_id: row.department_id,
    owner: row.owner,
    rolls_up_to: row.rolls_up_to,
    progress: progress || { attainment: null, progress_status: null },
    workflow_instance_id: row.workflow_instance_id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** The facts every goal event carries. */
const payloadOf = (row, extra = {}) => ({
  organisational_goal_id: row.organisational_goal_id,
  code: row.code,
  level: row.level,
  title: row.title,
  owner_employee_id: row.owner_employee_id,
  department_id: row.department_id,
  ...extra,
});

/** Progress for a set of rows, keyed by id. */
async function progressFor(client, rows, today = lagos.today()) {
  const cal = await workingWeek.loadCalendar(client);
  return trace.progressOf(client, rows, { today, cal });
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** The period a list's year or month means. */
function periodOfQuery(query) {
  if (query.month) {
    const { first, last } = lagos.monthBounds(`${query.month}-01`);
    return { from: first, to: last };
  }
  if (query.year) return { from: `${query.year}-01-01`, to: `${query.year}-12-31` };
  return { from: null, to: null };
}

async function list(query) {
  const page = await repo.list(pool, {
    ...query,
    ...periodOfQuery(query),
    levels: query.level ? null : GOAL_LEVELS,
  });
  const progress = await progressFor(pool, page.data);
  return { ...page, data: page.data.map((r) => toGoal(r, progress.get(r.organisational_goal_id))) };
}

async function summary(query) {
  const year = query.year || Number(lagos.today().slice(0, 4));
  const period = { from: `${year}-01-01`, to: `${year}-12-31` };
  const counts = await repo.cascadeCounts(pool, period);
  const of = (level) => counts.find((c) => c.level === level) || { active: 0, pending: 0 };
  const orgGoals = await repo.organisationGoals(pool, period);
  const progress = await progressFor(pool, orgGoals.map((g) => ({ ...g, level: "organisation" })));
  const rows = orgGoals.map((g) => ({
    organisational_goal_id: g.organisational_goal_id,
    code: g.code,
    title: g.title,
    ...progress.get(g.organisational_goal_id),
  }));
  return {
    year,
    cascade: ["organisation", "annual", "monthly", "department", "individual"].map((level) => ({
      level,
      active: of(level).active,
      pending: of(level).pending,
    })),
    on_track: rows.filter((r) => r.progress_status === "on_track" || r.progress_status === "met").length,
    progress: rows,
  };
}

/** What the caller may do with a goal. */
async function abilities(client, row, actor) {
  const author = await cascade.mayAuthor(client, actor, row.level);
  const editable = EDITABLE_STATUS.has(row.status);
  return {
    can_edit: author && editable,
    can_submit: author && editable && (row.level === "annual" || row.level === "monthly"),
  };
}

async function get(id, actor, client = pool) {
  const row = await repo.get(client, id);
  if (!row) throw notFound();
  const [progress, quarters, ancestors, children, view, may] = await Promise.all([
    progressFor(client, [row]),
    repo.quarters(client, id),
    trace.traceOf(client, id),
    repo.children(client, id),
    approval.view(client, row.workflow_instance_id, actor),
    abilities(client, row, actor),
  ]);
  return {
    ...toGoal(row, progress.get(id)),
    quarters,
    trace: ancestors,
    children,
    route: view.route,
    decisions: view.decisions,
    can_edit: may.can_edit,
    can_submit: may.can_submit,
    can_decide: row.status === "pending_approval" && view.can_decide,
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/** The next number of a level's scheme (OG, AG, MG, DT), in the year the goal starts. */
async function numberFor(client, level, startsOn) {
  const at = { date: startsOn };
  let allocated;
  if (level === "organisation") allocated = await numbering.allocate(client, "goal_organisation", at);
  else if (level === "annual") allocated = await numbering.allocate(client, "goal_annual", at);
  else if (level === "monthly") allocated = await numbering.allocate(client, "goal_monthly", at);
  else allocated = await numbering.allocate(client, "goal_department", at);
  return allocated.number;
}

/**
 * Insert a goal at any level after its rules have passed: number, row, quarters, event.
 * Used by create() here and by the targets module for a departmental target.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @returns {Promise<string>} the new id
 */
async function insertGoal(client, actor, v) {
  const code = await numberFor(client, v.level, v.starts_on);
  const id = await repo.insert(client, {
    ...v,
    code,
    owner_employee_id: v.owner_employee_id || actor.employee_id,
  });
  if (v.quarters && v.quarters.length) await repo.replaceQuarters(client, id, v.quarters);
  const row = await repo.get(client, id);
  await emit(client, {
    key: EVENTS.GOAL_CREATED,
    entity: { type: "goal", id },
    actor,
    after: row,
    payload: payloadOf(row),
  });
  return id;
}

async function create(actor, body) {
  const id = await tx(async (client) => {
    await cascade.assertMayAuthor(client, actor, body.level);
    const period = cascade.periodOf(body);
    const parent = body.parent_goal_id ? await repo.get(client, body.parent_goal_id) : null;
    cascade.assertParent(body.level, parent, period);
    return insertGoal(client, actor, {
      level: body.level,
      parent_goal_id: body.parent_goal_id || null,
      title: body.title,
      strategic_theme: body.strategic_theme,
      success_measure: body.success_measure,
      baseline: body.baseline,
      description: body.description,
      // A16: the CEO's organisational goals need nobody's approval.
      status: body.level === "organisation" ? "active" : "draft",
      ...period,
      quarters: body.level === "organisation" ? body.quarters || [] : [],
    });
  });
  const row = await repo.get(pool, id);
  return toGoal(row, (await progressFor(pool, [row])).get(id));
}

/** Load a goal for a change, with its row locked, or 404. */
async function lockedGoal(client, id) {
  const row = await repo.get(client, id, { lock: true });
  if (!row || row.level === "department") throw notFound();
  return row;
}

async function edit(actor, id, body) {
  await tx(async (client) => {
    const row = await lockedGoal(client, id);
    await cascade.assertMayAuthor(client, actor, row.level);
    if (!EDITABLE_STATUS.has(row.status)) throw conflict("GOAL_NOT_EDITABLE", "Only a draft or returned goal can change");
    if (body.parent_goal_id && body.parent_goal_id !== row.parent_goal_id) {
      const parent = await repo.get(client, body.parent_goal_id);
      cascade.assertParent(row.level, parent, { starts_on: row.starts_on, ends_on: row.ends_on });
    }
    const { quarters, ...fields } = body;
    await repo.update(client, id, fields);
    if (quarters && row.level === "organisation") await repo.replaceQuarters(client, id, quarters);
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.GOAL_EDITED,
      entity: { type: "goal", id },
      actor,
      before: row,
      after,
      payload: payloadOf(after),
    });
  });
  return get(id, actor);
}

async function submit(actor, id) {
  await tx(async (client) => {
    const row = await lockedGoal(client, id);
    if (row.level !== "annual" && row.level !== "monthly")
      throw conflict("GOAL_NOT_SUBMITTABLE", "Organisational goals need no approval");
    await cascade.assertMayAuthor(client, actor, row.level);
    if (!EDITABLE_STATUS.has(row.status)) throw conflict("GOAL_NOT_EDITABLE", "This goal is already waiting or approved");
    const instance = await approval.submit(client, { entity: { type: "goal", id }, actor });
    const status = approval.statusFor(instance.state);
    await repo.setStatus(client, id, status, { workflowInstanceId: instance.workflow_instance_id });
    await emit(client, {
      key: EVENTS.GOAL_SUBMITTED,
      entity: { type: "goal", id },
      actor,
      before: { status: row.status },
      after: { status },
      payload: payloadOf(row),
    });
  });
  return get(id, actor);
}

async function decide(actor, id, { decision, reason = null }) {
  await tx(async (client) => {
    const row = await lockedGoal(client, id);
    if (row.status !== "pending_approval" || !row.workflow_instance_id)
      throw conflict("GOAL_NOT_PENDING", "This goal is not waiting for approval");
    if (decision === "approve" && row.parent_goal_id) {
      const parent = await repo.get(client, row.parent_goal_id);
      if (!parent || parent.status !== "active")
        throw new AppError("PARENT_NOT_ACTIVE", "The goal above it is not approved yet", 422);
    }
    const instance = await approval.decide(client, {
      instance_id: row.workflow_instance_id,
      actor,
      decision,
      reason,
    });
    await apply(client, row, instance.state, actor, reason);
  });
  return get(id, actor);
}

/** Write the status a request's state means, and tell the owner when it ended. */
async function apply(client, row, state, actor, reason = null) {
  const status = approval.statusFor(state);
  if (!status || status === row.status) return;
  await repo.setStatus(client, row.organisational_goal_id, status);
  const key = status === "active" ? EVENTS.GOAL_APPROVED : status === "returned" ? EVENTS.GOAL_RETURNED : null;
  if (!key) return;
  await emit(client, {
    key,
    entity: { type: "goal", id: row.organisational_goal_id },
    actor,
    before: { status: row.status },
    after: { status },
    payload: payloadOf(row, { reason }),
  });
}

/** A request on a goal ended away from its screen; idempotent. */
async function settle(id, state) {
  await tx(async (client) => {
    const row = await repo.get(client, id, { lock: true });
    if (!row || row.status !== "pending_approval") return;
    await apply(client, row, state, null);
  });
}

module.exports = {
  GOAL_LEVELS,
  toGoal,
  progressFor,
  list,
  summary,
  get,
  insertGoal,
  create,
  edit,
  submit,
  decide,
  settle,
};
