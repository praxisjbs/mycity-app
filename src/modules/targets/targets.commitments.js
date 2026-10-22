"use strict";
/**
 * Commitments (docs/guides/performance.md §3.4, §6.11): each month's priority tasks, marked as
 * commitments on the task form, sent as the person's month and approved as one.
 *
 *   submit()     Send Commitments: the person's (or, for a manager, someone in their workspace
 *                scope's) commitments of a month not yet approved go into their set, which opens
 *                `performance.commitments`: their reviewer, or the CEO for a function head. When
 *                the sender is the reviewer, the stage is left out and the set is approved as sent.
 *   settle()     the flow's outcome, after commit (targets.events.js): a set approved fixes each
 *                original date; returned, its commitments stay drafts; a rescope approved marks
 *                the commitment rescoped; refused or withdrawn, nothing changes but its reason.
 *   rescope()    Rescope Commitment: an approved commitment not done, through the same flow.
 *   recovery()   Set Recovery: a Recovery task for a missed commitment, through the tasks service.
 *   list(), summary(), sets()   the Commitments view: its rows, its figures, Waiting On You.
 *   monthFigures()             on time ÷ due for a person's month (the On-time Commitment
 *                              Delivery line, §6.10; My Performance).
 *   requestReport(), buildReport()   the month-end delivery report, an export per function.
 *
 * A commitment is a task: the tasks service writes the task's own columns (the set it is in, its
 * original date, a rescope), in this file's transaction. Its state is the tasks repo's one SQL
 * expression (COMMITMENT_STATE), worked out on every read.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const { linkFor } = require("../../shared/route-map");
const { formatDate, formatMonth } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const workflow = require("../../shared/workflow/engine");
const approvers = require("../../shared/workflow/approvers");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const tasks = require("../tasks/tasks.service");
const tasksRepo = require("../tasks/tasks.repo");
const audience = require("../tasks/tasks.audience");
const repo = require("./targets.repo");
const { EVENTS, REPORT_DOC_TYPE } = require("./targets.events");

const FLOW = "performance.commitments";
/** The most commitments one report holds. */
const REPORT_CEILING = 5000;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const day = (v) => (v instanceof Date ? lagos.dateOf(v) : v ? String(v).slice(0, 10) : null);
/** "2026-11" → "2026-11-01". */
const monthStart = (key) => `${key}-01`;
const notFound = () => new AppError("NOT_FOUND", "That commitment does not exist", 404);

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** A commitment as the contract's Commitment, with what the filters and the report need. */
const ROW = `
  SELECT t.task_id, t.number::text AS number, t.title, t.acceptance_criteria,
         ${personJson("e", "d")} AS employee, t.primary_assignee_id, e.department_id, d.name AS department,
         t.commitment_month, t.due_at, t.original_due_at, t.completed_at, t.rescoped_at, t.rescope_reason,
         t.commitment_set_id, cs.status AS set_status, cs.workflow_instance_id AS set_instance_id,
         ${tasksRepo.COMMITMENT_STATE("t")} AS state,
         EXISTS (SELECT 1 FROM workflow_instance wi
                  WHERE wi.entity_type = 'task' AND wi.entity_id = t.task_id::text
                    AND wi.state = 'pending' AND wi.definition_key = '${FLOW}') AS rescope_pending,
         (SELECT json_build_object('task_id', r.task_id, 'number', r.number::text,
                                   'assignee', ${personJson("re", "rd")}, 'due_at', r.due_at)
            FROM task r
            LEFT JOIN employee re ON re.employee_id = r.primary_assignee_id
            LEFT JOIN department rd ON rd.department_id = re.department_id
           WHERE r.entity_type = 'task' AND r.entity_id = t.task_id AND r.status <> 'cancelled'
           ORDER BY r.created_at, r.task_id LIMIT 1) AS recovery,
         t.employee_target_id, e.first_name, e.last_name,
         search_fold(t.title || ' ' || COALESCE(t.number::text, '') || ' ' || e.first_name || ' ' || e.last_name) AS haystack
    FROM task t
    JOIN employee e ON e.employee_id = t.primary_assignee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN commitment_set cs ON cs.commitment_set_id = t.commitment_set_id
   WHERE t.is_commitment AND t.status <> 'cancelled' AND t.archived_at IS NULL`;

/** A row as the contract's Commitment. */
function view(r) {
  const recovery = r.recovery
    ? { task_id: r.recovery.task_id, number: r.recovery.number || "", assignee: r.recovery.assignee, due_at: iso(r.recovery.due_at) }
    : null;
  return {
    task_id: r.task_id,
    number: r.number || "",
    title: r.title,
    acceptance_criteria: r.acceptance_criteria,
    employee: r.employee,
    commitment_month: day(r.commitment_month),
    due_at: iso(r.due_at),
    original_due_at: iso(r.original_due_at),
    completed_at: iso(r.completed_at),
    rescoped_at: iso(r.rescoped_at),
    rescope_reason: r.rescope_reason,
    commitment_set_id: r.commitment_set_id,
    set_status: r.set_status,
    state: r.state,
    rescope_pending: Boolean(r.rescope_pending),
    recovery,
    employee_target_id: r.employee_target_id,
    link: linkFor("task", r.task_id),
  };
}

const SORTS = {
  due_at: "v.due_at",
  employee: "v.first_name, v.last_name",
};

/**
 * "Waiting on the reader": the pending performance.commitments instance over the commitment's set,
 * or over the commitment itself (a rescope), names them at its stage (shared/workflow/approvers).
 * Appends to `params`.
 */
async function waitingClause(db, actor, params, { set, task }) {
  const roleCodes = await approvers.roleCodesOf(db, actor.role_ids || []);
  const clause = approvers.waitingOnClause("wi", actor, roleCodes, params);
  const on = [set && `(wi.entity_type = 'commitment_set' AND wi.entity_id = ${set}::text)`, task && `(wi.entity_type = 'task' AND wi.entity_id = ${task}::text)`]
    .filter(Boolean)
    .join(" OR ");
  return `EXISTS (SELECT 1 FROM workflow_instance wi
                   WHERE wi.state = 'pending' AND wi.definition_key = '${FLOW}' AND (${on}) AND ${clause})`;
}

/** The filters every commitments read shares, as SQL over the row `v`. Appends to `params`. */
async function filtersOf(db, query, scope, actor, params) {
  const where = [];
  const add = (value, sql) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (query.month) add(monthStart(query.month), (p) => `v.commitment_month = ${p}::date`);
  if (query.department_id) add(query.department_id, (p) => `v.department_id = ${p}::uuid`);
  if (query.employee_id) add(query.employee_id, (p) => `v.primary_assignee_id = ${p}::uuid`);
  if (query.state) add(query.state, (p) => `v.state = ${p}`);
  if (query.q) add(query.q, (p) => `v.haystack LIKE '%' || search_fold(${p}) || '%'`);
  if (query.waiting_on_me === "true" && actor) {
    where.push(await waitingClause(db, actor, params, { set: "v.commitment_set_id", task: "v.task_id" }));
  } else {
    const s = scopeClause(scope, { column: "v.primary_assignee_id" }, params);
    if (s.and) where.push(s.and.slice(4));
  }
  return where.length ? `WHERE ${where.join(" AND ")}` : "";
}

/**
 * GET /performance/commitments: one page of a month's commitments in the reader's `performance`
 * scope, or those waiting on the reader.
 */
async function list(query, scope, actor = null, db = pool) {
  const params = [];
  const where = await filtersOf(db, query, scope, actor, params);
  const page = await pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${ROW}) v ${where}
      ORDER BY ${orderBy(query, SORTS, "v.task_id")}`,
    params,
    query,
  );
  return { ...page, data: page.data.map(view) };
}

/** GET /performance/commitments/summary: a month's commitments by state, within scope. */
async function summary(query, scope, db = pool) {
  const params = [];
  const where = await filtersOf(db, { ...query, state: undefined, q: undefined }, scope, null, params);
  const r = await one(
    db,
    `SELECT count(*)::int AS commitments,
            count(*) FILTER (WHERE v.state = 'awaiting_approval')::int AS awaiting_approval,
            count(*) FILTER (WHERE v.state = 'due')::int AS due,
            count(*) FILTER (WHERE v.state = 'on_time')::int AS on_time,
            count(*) FILTER (WHERE v.state = 'late')::int AS late,
            count(*) FILTER (WHERE v.state = 'missed')::int AS missed,
            count(*) FILTER (WHERE v.state = 'rescoped')::int AS rescoped
       FROM (${ROW}) v ${where}`,
    params,
  );
  return { month: monthStart(query.month), ...r };
}

/**
 * A person's month in figures (§6.10, §6.11): the approved commitments not rescoped (`due`, which
 * counts those still open too) and those delivered on time. `month` is its first day.
 */
async function monthFigures(db, employeeId, month) {
  return one(
    db,
    `SELECT count(*) FILTER (WHERE v.state IN ('due', 'on_time', 'late', 'missed'))::int AS due,
            count(*) FILTER (WHERE v.state = 'on_time')::int AS delivered_on_time
       FROM (${ROW}) v
      WHERE v.primary_assignee_id = $1 AND v.commitment_month = $2::date`,
    [employeeId, month],
  );
}

/** A set as the contract's CommitmentSetRow. */
const SET_ROW = `
  SELECT cs.commitment_set_id, cs.employee_id, cs.month, cs.status, cs.workflow_instance_id,
         cs.submitted_at, cs.approved_at,
         (SELECT count(*)::int FROM task t WHERE t.commitment_set_id = cs.commitment_set_id
           AND t.is_commitment AND t.status <> 'cancelled') AS task_count,
         ${personJson("e", "d")} AS employee, e.first_name, e.last_name,
         CASE WHEN cs.status = 'returned' THEN
           (SELECT wd.reason FROM workflow_decision wd
             WHERE wd.workflow_instance_id = cs.workflow_instance_id AND wd.decision IN ('reject', 'request_changes')
             ORDER BY wd.decided_at DESC LIMIT 1)
         END AS returned_reason
    FROM commitment_set cs
    JOIN employee e ON e.employee_id = cs.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id`;

const setView = (r) => ({
  commitment_set_id: r.commitment_set_id,
  employee_id: r.employee_id,
  month: day(r.month),
  status: r.status,
  workflow_instance_id: r.workflow_instance_id,
  submitted_at: iso(r.submitted_at),
  approved_at: iso(r.approved_at),
  task_count: r.task_count,
  employee: r.employee,
  returned_reason: r.returned_reason || null,
});

/** GET /performance/commitments/sets: the months in the reader's scope, or those waiting on them. */
async function sets(query, scope, actor, db = pool) {
  const params = [];
  const where = [];
  const add = (value, sql) => {
    params.push(value);
    where.push(sql(`$${params.length}`));
  };
  if (query.month) add(monthStart(query.month), (p) => `v.month = ${p}::date`);
  if (query.employee_id) add(query.employee_id, (p) => `v.employee_id = ${p}::uuid`);
  if (query.status) add(query.status, (p) => `v.status = ${p}`);
  if (query.q) add(query.q, (p) => `search_fold(v.first_name || ' ' || v.last_name) LIKE '%' || search_fold(${p}) || '%'`);
  if (query.waiting_on_me === "true") {
    where.push(await waitingClause(db, actor, params, { set: "v.commitment_set_id" }));
  } else {
    const s = scopeClause(scope, { column: "v.employee_id" }, params);
    if (s.and) where.push(s.and.slice(4));
  }
  const page = await pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${SET_ROW}) v ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy(query, { submitted_at: "v.submitted_at", employee: "v.first_name, v.last_name" }, "v.commitment_set_id")}`,
    params,
    query,
  );
  return { ...page, data: page.data.map(setView) };
}

/** One commitment the caller may act for (its person, or in their scope), locked; 404 otherwise. */
async function commitmentFor(client, scope, id) {
  if (!(await tasksRepo.lock(client, id))) throw notFound();
  const r = await one(client, `SELECT v.* FROM (${ROW}) v WHERE v.task_id = $1`, [id]);
  if (!r) throw notFound();
  if (r.primary_assignee_id !== scope.employee_id && !audience.inScope(scope, r.primary_assignee_id)) throw notFound();
  return r;
}

/* ------------------------------------------------------------------ *
 * Who approves
 * ------------------------------------------------------------------ */

/** Does the person head a department (its head, or in its filled head seat)? */
async function isHead(db, employeeId) {
  const r = await one(
    db,
    `SELECT EXISTS (SELECT 1 FROM department d LEFT JOIN org_seat s ON s.org_seat_id = d.head_seat_id
                     WHERE d.head_employee_id = $1 OR (s.status = 'filled' AND s.filled_by_employee_id = $1)) AS head`,
    [employeeId],
  );
  return Boolean(r && r.head);
}

/**
 * The person's reviewer for a month (§6.11): the reviewer on their binding scorecard for the
 * quarter holding it (a role reviewer's first active holder), else their effective line manager.
 */
async function reviewerFor(db, employeeId, month) {
  const card = await one(
    db,
    `SELECT s.reviewer_employee_id, s.reviewer_role_code::text AS reviewer_role_code
       FROM scorecard s JOIN performance_period p ON p.performance_period_id = s.performance_period_id
      WHERE s.employee_id = $1 AND s.status IN ('binding', 'agreed', 'closed') AND $2::date BETWEEN p.starts_on AND p.ends_on
      ORDER BY p.starts_on DESC LIMIT 1`,
    [employeeId, month],
  );
  if (card && card.reviewer_employee_id) return card.reviewer_employee_id;
  if (card && card.reviewer_role_code) {
    const holder = (await repo.roleHolders(db, card.reviewer_role_code)).find((id) => id !== employeeId);
    if (holder) return holder;
  }
  const m = await one(db, "SELECT manager_id FROM employee_effective_manager WHERE employee_id = $1", [employeeId]);
  return m ? m.manager_id : null;
}

/**
 * The flow's context for a person (§6.11). A head goes to the CEO; anyone else to their reviewer,
 * left out when the sender is that reviewer, so the stage is skipped.
 */
async function contextFor(db, employeeId, month, actor) {
  const head = await isHead(db, employeeId);
  const context = { is_function_head: head };
  if (!head) {
    const reviewer = await reviewerFor(db, employeeId, month);
    if (reviewer && reviewer !== actor.employee_id) context.reviewer_employee_id = reviewer;
  }
  return context;
}

/* ------------------------------------------------------------------ *
 * Sending and settling a month
 * ------------------------------------------------------------------ */

/** The person's set for a month, locked, made when missing. */
async function lockSet(client, employeeId, month) {
  await client.query(
    `INSERT INTO commitment_set (employee_id, month) VALUES ($1, $2)
     ON CONFLICT (employee_id, month) DO NOTHING`,
    [employeeId, month],
  );
  return one(
    client,
    `SELECT commitment_set_id, employee_id, month, status, workflow_instance_id
       FROM commitment_set WHERE employee_id = $1 AND month = $2 FOR UPDATE`,
    [employeeId, month],
  );
}

async function setRow(db, setId) {
  return setView(await one(db, `SELECT v.* FROM (${SET_ROW}) v WHERE v.commitment_set_id = $1`, [setId]));
}

/** Whose name and which month an event names. */
async function factsOf(db, employeeId, month) {
  const p = await one(db, "SELECT first_name || ' ' || last_name AS name FROM employee WHERE employee_id = $1", [employeeId]);
  return { employee_id: employeeId, employee_name: p ? p.name : null, month, month_label: formatMonth(month) };
}

/**
 * POST /performance/commitments/sets/:employee_id/:month/submit (§6.11).
 * @param {object} actor  withActor(req)
 * @param {object} scope  scopeOf(req) under `workspace` edit
 * @param {{employee_id: string, month: string}} params  month as YYYY-MM
 */
async function submit(actor, scope, { employee_id: employeeId, month: key }) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee can send commitments", 403);
  if (employeeId !== actor.employee_id && !audience.inScope(scope, employeeId))
    throw new AppError("FORBIDDEN", "You can send commitments for yourself and your team", 403);
  const month = monthStart(key);
  return tx(async (client) => {
    const set = await lockSet(client, employeeId, month);
    if (set.status === "submitted")
      throw new AppError("COMMITMENTS_WAITING", "This month's commitments are already waiting for approval", 409);
    const ids = await tasks.linkCommitments(client, actor, { employeeId, month, setId: set.commitment_set_id });
    if (!ids.length)
      throw new AppError("COMMITMENTS_EMPTY", "Mark at least one task as a commitment for that month first", 422);
    await client.query(
      "UPDATE commitment_set SET status = 'submitted', submitted_at = now() WHERE commitment_set_id = $1",
      [set.commitment_set_id],
    );
    const facts = await factsOf(client, employeeId, month);
    await emit(client, {
      key: EVENTS.COMMITMENTS_SUBMITTED,
      entity: { type: "commitment_set", id: set.commitment_set_id },
      actor,
      payload: { commitment_set_id: set.commitment_set_id, ...facts, count: ids.length, subject_employee_id: employeeId },
    });
    const instance = await workflow.openInstance(client, {
      definition_key: FLOW,
      entity: { type: "commitment_set", id: set.commitment_set_id },
      subject_employee_id: employeeId,
      context: await contextFor(client, employeeId, month, actor),
      actor,
      exclude_employee_ids: [employeeId],
    });
    await client.query("UPDATE commitment_set SET workflow_instance_id = $2 WHERE commitment_set_id = $1", [
      set.commitment_set_id,
      instance.workflow_instance_id,
    ]);
    // Nobody left to ask (the sender is the reviewer): approved as sent.
    if (instance.state === "approved")
      await settleSet(client, set.commitment_set_id, { state: "approved", instance_id: instance.workflow_instance_id });
    return setRow(client, set.commitment_set_id);
  });
}

/** A set's outcome, in the caller's transaction; a no-op once settled or when another instance owns it. */
async function settleSet(client, setId, { state, reason = null, instance_id: instanceId }) {
  const set = await one(
    client,
    "SELECT commitment_set_id, employee_id, month, status, workflow_instance_id FROM commitment_set WHERE commitment_set_id = $1 FOR UPDATE",
    [setId],
  );
  if (!set || set.status !== "submitted" || (instanceId && set.workflow_instance_id !== instanceId)) return null;
  const facts = await factsOf(client, set.employee_id, day(set.month));
  const entity = { type: "commitment_set", id: setId };
  if (state === "approved" || state === "timeout_approved") {
    await client.query("UPDATE commitment_set SET status = 'approved', approved_at = now() WHERE commitment_set_id = $1", [setId]);
    const ids = await tasks.fixOriginalDates(client, null, setId);
    await emit(client, { key: EVENTS.COMMITMENTS_APPROVED, entity, actor: null, payload: { commitment_set_id: setId, ...facts, count: ids.length } });
    return "approved";
  }
  const back = state === "cancelled" ? "draft" : "returned";
  await client.query("UPDATE commitment_set SET status = $2 WHERE commitment_set_id = $1", [setId, back]);
  if (back === "returned")
    await emit(client, { key: EVENTS.COMMITMENTS_RETURNED, entity, actor: null, payload: { commitment_set_id: setId, ...facts, reason } });
  return back;
}

/** A rescope's outcome, in the caller's transaction; a no-op once settled. */
async function settleRescope(client, taskId, { state, reason = null }) {
  if (!(await tasksRepo.lock(client, taskId))) return null;
  const r = await one(client, `SELECT v.* FROM (${ROW}) v WHERE v.task_id = $1`, [taskId]);
  if (!r || r.rescoped_at || !r.rescope_reason) return null;
  const approved = state === "approved" || state === "timeout_approved";
  await tasks.settleRescope(client, null, taskId, approved);
  await emit(client, {
    key: approved ? EVENTS.COMMITMENT_RESCOPED : EVENTS.COMMITMENT_RESCOPE_REFUSED,
    entity: { type: "task", id: taskId },
    actor: null,
    payload: { task_id: taskId, title: r.title, employee_id: r.primary_assignee_id, reason: approved ? r.rescope_reason : reason },
  });
  return approved ? "rescoped" : "refused";
}

/**
 * performance.commitments has finished (or was withdrawn): settle the set or the rescope it was
 * over. Safe to run again.
 * @param {{type: string, id: string}} entity
 * @param {{state: string, reason?: string|null, instance_id?: string}} outcome
 */
async function settle(entity, outcome) {
  return tx((client) =>
    entity.type === "commitment_set"
      ? settleSet(client, entity.id, outcome)
      : entity.type === "task"
        ? settleRescope(client, entity.id, outcome)
        : null,
  );
}

/* ------------------------------------------------------------------ *
 * One commitment: rescope and recovery
 * ------------------------------------------------------------------ */

/** POST /performance/commitments/:id/rescope */
async function rescope(actor, scope, id, { reason }) {
  return tx(async (client) => {
    const r = await commitmentFor(client, scope, id);
    if (!r.original_due_at)
      throw new AppError("COMMITMENT_NOT_APPROVED", "Only an approved commitment is rescoped", 409);
    if (r.rescoped_at) throw new AppError("COMMITMENT_RESCOPED", "This commitment is already rescoped", 409);
    if (["on_time", "late"].includes(r.state))
      throw new AppError("COMMITMENT_DONE", "This commitment is done", 409);
    if (r.rescope_pending) throw new AppError("WORKFLOW_ALREADY_OPEN", "A rescope is already waiting for approval", 409);
    await tasks.askRescope(client, actor, id, reason);
    await emit(client, {
      key: EVENTS.COMMITMENT_RESCOPE_REQUESTED,
      entity: { type: "task", id },
      actor,
      payload: { task_id: id, title: r.title, employee_id: r.primary_assignee_id, reason, subject_employee_id: r.primary_assignee_id },
    });
    const instance = await workflow.openInstance(client, {
      definition_key: FLOW,
      entity: { type: "task", id },
      subject_employee_id: r.primary_assignee_id,
      context: await contextFor(client, r.primary_assignee_id, day(r.commitment_month), actor),
      actor,
      exclude_employee_ids: [r.primary_assignee_id],
    });
    if (instance.state === "approved") await settleRescope(client, id, { state: "approved" });
    return view(await one(client, `SELECT v.* FROM (${ROW}) v WHERE v.task_id = $1`, [id]));
  });
}

/** POST /performance/commitments/:id/recovery: a Recovery task for a missed commitment. */
async function recovery(actor, scope, id, { primary_assignee_id: ownerId, due_on: dueOn }) {
  return tx(async (client) => {
    const r = await commitmentFor(client, scope, id);
    if (r.state !== "missed")
      throw new AppError("COMMITMENT_NOT_MISSED", "Only a missed commitment needs a recovery", 409);
    if (r.recovery) throw new AppError("RECOVERY_SET", "This commitment already has a recovery", 409);
    const task = await tasks.create(
      actor,
      scope,
      {
        title: `Recovery: ${r.title}`.slice(0, 200),
        priority: "high",
        due_on: dueOn,
        primary_assignee_id: ownerId,
        entity_type: "task",
        entity_id: id,
      },
      { client },
    );
    await emit(client, {
      key: EVENTS.COMMITMENT_RECOVERY_SET,
      entity: { type: "task", id },
      actor,
      payload: { task_id: id, title: r.title, recovery_task_id: task.task_id, owner_employee_id: ownerId, due_on: dueOn },
    });
    return view(await one(client, `SELECT v.* FROM (${ROW}) v WHERE v.task_id = $1`, [id]));
  });
}

/* ------------------------------------------------------------------ *
 * The reminder (targets.events.js)
 * ------------------------------------------------------------------ */

/** Before `commitments_due` fires: still nothing sent for the month? */
async function dueCheck(client, row) {
  const month = row.payload && row.payload.month;
  if (!month) return null;
  const sent = await one(
    client,
    "SELECT 1 AS x FROM commitment_set WHERE employee_id = $1 AND month = $2 AND status IN ('submitted', 'approved')",
    [row.entity_id, month],
  );
  if (sent) return null;
  return {
    entity: { type: "employee", id: row.entity_id },
    payload: {
      employee_id: row.entity_id,
      month,
      month_label: formatMonth(month),
      due_label: formatDate(row.payload.due_on),
    },
  };
}

/* ------------------------------------------------------------------ *
 * The month-end delivery report
 * ------------------------------------------------------------------ */

/** POST /performance/commitments/report: reserve the file, which the worker makes. */
async function requestReport(actor, scope, body) {
  return tx(async (client) => {
    const doc = await exportFiles.reserve(client, {
      doc_type: REPORT_DOC_TYPE,
      entity: { type: REPORT_DOC_TYPE, id: crypto.randomUUID() },
      file_name: exportFilename({ base: `commitments-${body.month}`, env: config.APP_ENV, extension: "xlsx" }),
      title: `Month-end delivery report, ${formatMonth(monthStart(body.month))}`,
      actor,
    });
    await emit(client, {
      key: EVENTS.COMMITMENTS_REPORT_REQUESTED,
      entity: { type: doc.entity_type, id: doc.entity_id },
      actor,
      payload: {
        document_id: doc.document_id,
        month: body.month,
        department_id: body.department_id || null,
        scope: { scope: scope.scope, scope_ids: scope.scope_ids, employee_id: scope.employee_id },
        requested_by: actor.user_id,
      },
    });
    return exportFiles.present(doc);
  });
}

const STATE_WORDS = {
  awaiting_approval: "Awaiting Approval",
  due: "Due",
  on_time: "On Time",
  late: "Late",
  missed: "Missed",
  rescoped: "Rescoped",
};

/** Every commitment the report covers, a page of 25 at a time up to the ceiling. */
async function gather(db, filters, scope) {
  const rows = [];
  let page = await list({ ...filters, page: 1, sort: { field: "employee", dir: "asc" } }, scope, null, db);
  rows.push(...page.data);
  while (page.page.has_next && rows.length < REPORT_CEILING) {
    page = await list({ ...filters, page: page.page.number + 1, sort: { field: "employee", dir: "asc" } }, scope, null, db);
    rows.push(...page.data);
  }
  return rows.slice(0, REPORT_CEILING);
}

/** One function's figures: due (approved, not rescoped), on time, late, missed, rescoped. */
function figuresOf(rows) {
  const n = (s) => rows.filter((r) => r.state === s).length;
  const due = rows.filter((r) => ["due", "on_time", "late", "missed"].includes(r.state)).length;
  return {
    commitments: rows.length,
    due,
    on_time: n("on_time"),
    late: n("late"),
    missed: n("missed"),
    rescoped: n("rescoped"),
    awaiting_approval: n("awaiting_approval"),
    rate: due ? `${Math.round((n("on_time") / due) * 1000) / 10}%` : "",
  };
}

const LINE_COLUMNS = [
  { key: "person", header: "Person", width: 24 },
  { key: "number", header: "Task", width: 12 },
  { key: "title", header: "Commitment", width: 40 },
  { key: "criteria", header: "Acceptance Criteria", width: 40 },
  { key: "original", header: "Original Date", format: "date", width: 14 },
  { key: "now", header: "Due Now", format: "date", width: 14 },
  { key: "completed", header: "Completed", format: "date", width: 14 },
  { key: "state", header: "State", width: 18 },
  { key: "recovery_owner", header: "Recovery Owner", width: 24 },
  { key: "recovery_due", header: "Recovery Date", format: "date", width: 14 },
  { key: "rescope_reason", header: "Rescope Reason", width: 30 },
];

/**
 * The outbox handler (targets.events.js): the month's commitments within the asker's scope, one
 * sheet per function and a summary, into the file the request reserved.
 */
async function buildReport(event, ctx) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");

  await exportFiles.make(p.document_id, ctx, async () => {
    const rows = await gather(pool, { month: p.month, ...(p.department_id ? { department_id: p.department_id } : {}) }, p.scope);
    const byFunction = new Map();
    for (const r of rows) {
      const name = (r.employee && r.employee.department) || "No Department";
      if (!byFunction.has(name)) byFunction.set(name, []);
      byFunction.get(name).push(r);
    }
    const functions = [...byFunction.keys()].sort();
    const date = (v) => (v ? lagos.dateOf(new Date(v)) : null);
    const summaryRows = functions.map((name) => ({ function: name, ...figuresOf(byFunction.get(name)) }));
    summaryRows.push({ function: "All Functions", ...figuresOf(rows) });
    return buildWorkbook({
      sheets: [
        {
          name: "Summary",
          columns: [
            { key: "function", header: "Function", width: 30 },
            { key: "commitments", header: "Commitments", format: "int" },
            { key: "due", header: "Due", format: "int" },
            { key: "on_time", header: "On Time", format: "int" },
            { key: "late", header: "Late", format: "int" },
            { key: "missed", header: "Missed", format: "int" },
            { key: "rescoped", header: "Rescoped", format: "int" },
            { key: "awaiting_approval", header: "Awaiting Approval", format: "int" },
            { key: "rate", header: "On Time of Due", width: 16 },
          ],
          rows: summaryRows,
          freeze: { y: 1 },
        },
        ...functions.map((name) => ({
          name,
          columns: LINE_COLUMNS,
          rows: byFunction.get(name).map((r) => ({
            person: r.employee ? r.employee.display_name : "",
            number: r.number,
            title: r.title,
            criteria: r.acceptance_criteria || "",
            original: date(r.original_due_at),
            now: date(r.due_at),
            completed: date(r.completed_at),
            state: STATE_WORDS[r.state] || r.state,
            recovery_owner: r.recovery && r.recovery.assignee ? r.recovery.assignee.display_name : "",
            recovery_due: r.recovery ? date(r.recovery.due_at) : null,
            rescope_reason: r.rescope_reason || "",
          })),
          freeze: { y: 1 },
        })),
      ],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: `Month-end delivery report, ${formatMonth(monthStart(p.month))}`,
        lines: [
          ["Month", formatMonth(monthStart(p.month))],
          ["Commitments", rows.length >= REPORT_CEILING ? `The first ${REPORT_CEILING}` : String(rows.length)],
        ],
      }),
      cover: true,
    });
  });
}

module.exports = {
  FLOW,
  list,
  summary,
  sets,
  monthFigures,
  submit,
  settle,
  rescope,
  recovery,
  dueCheck,
  requestReport,
  buildReport,
};
