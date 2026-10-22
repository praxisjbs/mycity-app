"use strict";
/**
 * Tasks: the one write path for a task (docs/guides/workspace.md §3, §6).
 *
 *   create()   a person sets a task for themselves, or a manager for someone in their
 *              reporting line (A24). It takes a number, lands at the foot of To Do, and
 *              is due at the end of the day it names, or of its cadence's day.
 *   edit()     the setter changes what they decided; the assignee their notes and priority.
 *   move()     a drag: a column and the card it now sits above. Entering In Progress the
 *              first time starts it; Done completes it; leaving Done reopens it.
 *   block(), unblock(), cancel(), comment()
 *   sweep()    the recurrence job: the next occurrence of each repeating task, and the
 *              due-today and due-tomorrow reminders.
 *
 * Every change writes a task_activity row and emits one event, in the same transaction.
 * A task may count towards a scorecard line or a key result of its assignee (Counts Towards,
 * docs/guides/performance.md §6.18); TASK_COMPLETED and TASK_REOPENED carry the line and the
 * month, and a line measured in tasks is counted where it is read (doneTowards).
 *
 * A commitment (performance.md §6.11) is a task marked as one, with its criteria and its month.
 * The assignee may mark it as well as whoever manages it; once its month's set is approved its
 * mark, month and criteria are fixed and it is rescoped rather than cancelled. The targets
 * module sends, approves and rescopes it, through the helpers at the foot of this file, in its
 * own transaction.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const { linkFor } = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const workflow = require("../../shared/workflow/engine");
const approvers = require("../../shared/workflow/approvers");
const repo = require("./tasks.repo");
const audience = require("./tasks.audience");
const recurrence = require("./tasks.recurrence");
const { EVENTS } = require("./tasks.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That task does not exist", 404);
const invalid = (field, message) =>
  new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** A repo row as the contract's Task. */
function toTask(row, now = new Date()) {
  const due = row.due_at ? new Date(row.due_at) : null;
  const open = row.status !== "done" && row.status !== "cancelled";
  return {
    task_id: row.task_id,
    number: row.number || "",
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    cadence: row.cadence,
    assignee: row.assignee,
    set_by: row.set_by,
    due_at: iso(row.due_at),
    overdue: Boolean(open && due && due < now),
    started_at: iso(row.started_at),
    completed_at: iso(row.completed_at),
    cancelled_at: iso(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    blocked_reason: row.blocked_reason,
    blocked_at: iso(row.blocked_at),
    counts_towards: countsTowardsOf(row),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    link: row.entity_type ? linkFor(row.entity_type, row.entity_id) : null,
    recurrence: row.recurrence || null,
    comment_count: row.comment_count || 0,
    is_commitment: Boolean(row.is_commitment),
    acceptance_criteria: row.acceptance_criteria ?? null,
    commitment_month: row.commitment_month ?? null,
    original_due_at: iso(row.original_due_at),
    rescoped_at: iso(row.rescoped_at),
    rescope_reason: row.rescope_reason ?? null,
    commitment_set_id: row.commitment_set_id ?? null,
    commitment_state: row.commitment_state ?? null,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** The scorecard line or key result a task counts towards, as the contract names it. */
function countsTowardsOf(row) {
  if (row.employee_target_id)
    return {
      kind: "line",
      employee_target_id: row.employee_target_id,
      okr_key_result_id: null,
      title: row.target_title || "",
      link: linkFor("target", row.employee_target_id),
    };
  if (row.entity_type === "key_result" && row.kr_code)
    return {
      kind: "key_result",
      employee_target_id: null,
      okr_key_result_id: row.entity_id,
      title: `${row.kr_code} ${row.kr_statement || ""}`.trim(),
      link: linkFor("key_result", row.entity_id),
    };
  return null;
}

/** The facts every task event carries, for the audit line and the notifications. */
const payloadOf = (row, extra = {}) => ({
  task_id: row.task_id,
  number: row.number,
  title: row.title,
  status: row.status,
  primary_assignee_id: row.primary_assignee_id,
  subject_employee_id: row.primary_assignee_id,
  set_by_employee_id: row.set_by_employee_id,
  employee_target_id: row.employee_target_id,
  assignee_name: row.assignee ? row.assignee.display_name : null,
  set_by_name: row.set_by ? row.set_by.display_name : null,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** Today and this week (Monday to Sunday) in Lagos, as half-open instant ranges. */
function windows(now = new Date()) {
  const today = lagos.today(now);
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));
  return {
    now,
    today: { from: lagos.instant(today), to: lagos.instant(lagos.addDays(today, 1)) },
    week: { from: lagos.instant(monday), to: lagos.instant(lagos.addDays(monday, 7)) },
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function list(query, scope) {
  const at = windows();
  const page = await repo.list(pool, query, scope, at);
  return { ...page, data: page.data.map((r) => toTask(r, at.now)) };
}

const summary = (query, scope) => repo.summary(pool, query.scope, scope, windows());

/** A task the caller may see, as a repo row; 404 otherwise. */
async function visible(db, id, scope) {
  const row = await repo.get(db, id);
  if (!row) throw notFound();
  const shared = await repo.sharedWith(db, id, scope.employee_id);
  if (!audience.maySee(scope, row, shared)) throw notFound();
  return row;
}

/** May the caller act on this person's commitment: they are its person, or the person is in their scope. */
const actsFor = (scope, row) => row.primary_assignee_id === scope.employee_id || audience.inScope(scope, row.primary_assignee_id);

/**
 * The panel: the task and what the caller may do to it. A commitment also carries where its set
 * stands, a rescope waiting on approval (and whether the caller decides it), and its recovery.
 * @param {string} id
 * @param {object} scope  scopeOf(req)
 * @param {object} [actor] withActor(req): who decides a rescope
 */
async function getFor(id, scope, actor = null) {
  const row = await visible(pool, id, scope);
  const manage = audience.mayManage(scope, row);
  const approved = Boolean(row.is_commitment && row.original_due_at);
  const open = await (approved ? workflow.findOpenInstance(pool, { type: "task", id }) : null);
  const rescope =
    open && open.definition_key === "performance.commitments"
      ? { workflow_instance_id: open.workflow_instance_id, can_decide: Boolean(actor) && (await approvers.canAct(pool, open.stage_approvers, actor, open)) }
      : null;
  const recovery = row.commitment_state === "missed" || row.commitment_state === "late" ? await repo.recoveryOf(pool, id) : null;
  return {
    ...toTask(row),
    can_edit: true,
    can_reassign: manage,
    can_cancel: manage && row.status !== "cancelled" && !approved,
    set_status: row.set_status || null,
    rescope,
    recovery: recovery ? { ...recovery, due_at: iso(recovery.due_at) } : null,
    can_rescope: approved && !rescope && !row.rescoped_at && !["done", "cancelled"].includes(row.status) && actsFor(scope, row),
    can_set_recovery: row.commitment_state === "missed" && !recovery && actsFor(scope, row),
  };
}

/** Counts Towards: the lines and key results the assignee (the caller unless named) may pick. */
async function countsTowards(query, scope) {
  const assigneeId = query.assignee_id || scope.employee_id;
  if (!assigneeId) throw new AppError("FORBIDDEN", "Only an employee can hold tasks", 403);
  if (!audience.maySetFor(scope, assigneeId)) throw invalid("assignee_id", "Not in your team");
  const month = query.month || `${lagos.today().slice(0, 7)}-01`;
  return repo.countsTowards(pool, { assigneeId, month }, query);
}

/**
 * How many tasks pointing at a line were done in a month (Africa/Lagos): a line measured in tasks
 * (performance.md §6.10, §6.18). `month` is its first day.
 */
async function doneTowards(db, lineId, month) {
  const from = lagos.instant(month);
  const to = lagos.instant(lagos.addMonths(month, 1));
  return repo.doneTowards(db, lineId, from, to);
}

async function comments(id, query, scope) {
  await visible(pool, id, scope);
  return repo.comments(pool, id, query);
}

async function activity(id, query, scope) {
  await visible(pool, id, scope);
  return repo.activity(pool, id, query);
}

/* ------------------------------------------------------------------ *
 * Checks shared by create and edit
 * ------------------------------------------------------------------ */

/** A line must be on the assignee's own scorecard, and that scorecard binding (§6.18). */
async function checkTarget(db, targetId, assigneeId) {
  if (!targetId) return;
  const t = await repo.targetOf(db, targetId);
  if (!t || t.employee_id !== assigneeId)
    throw invalid("employee_target_id", "Not one of their lines");
  if (!["binding", "agreed"].includes(t.scorecard_status))
    throw invalid("employee_target_id", "Scorecard not binding yet");
}

/** A key result a task points at must exist. */
async function checkRecord(db, entityType, entityId) {
  if (entityType === "key_result" && entityId && !(await repo.keyResultOf(db, entityId)))
    throw invalid("entity_id", "Not a key result");
}

/**
 * A commitment needs its criteria, its month and a due date in that month (§6.11). `t` is the
 * task as it will stand; `dueAt` its due instant.
 */
function checkCommitment(t, dueAt) {
  if (!t.is_commitment) return;
  if (!t.acceptance_criteria) throw invalid("acceptance_criteria", "Give the criteria");
  if (!t.commitment_month) throw invalid("commitment_month", "Pick the month");
  if (!dueAt) throw invalid("due_on", "Pick a due date");
  const month = String(t.commitment_month instanceof Date ? lagos.dateOf(t.commitment_month) : t.commitment_month).slice(0, 7);
  if (lagos.dateOf(new Date(dueAt)).slice(0, 7) !== month) throw invalid("due_on", "Not in that month");
}

const approvedCommitment = () =>
  new AppError("COMMITMENT_APPROVED", "Approved commitments are rescoped, not changed", 409);

async function checkAssignee(db, scope, employeeId) {
  audience.assertMaySetFor(scope, employeeId);
  if (!(await repo.employeeActive(db, employeeId)))
    throw invalid("primary_assignee_id", "Not on the staff");
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * Set a task. With no assignee it is the caller's own.
 * @param {object} actor  withActor(req)
 * @param {object} scope  scopeOf(req) under `workspace` create
 * @param {object} body   TaskCreate
 * @param {{client?: object}} [opts]  the caller's transaction, when it has one
 */
async function create(actor, scope, body, { client: within = null } = {}) {
  if (!actor.employee_id) throw new AppError("FORBIDDEN", "Only an employee can hold tasks", 403);
  const assigneeId = body.primary_assignee_id || actor.employee_id;
  // An importer sets tasks inside its own transaction (a key result's initiatives).
  const run = within ? (fn) => atomically(within, () => fn(within)) : tx;
  return run(async (client) => {
    await checkAssignee(client, scope, assigneeId);
    await checkTarget(client, body.employee_target_id, assigneeId);
    await checkRecord(client, body.entity_type, body.entity_id);
    const cal = await workingWeek.loadCalendar(client);
    const dueAt = recurrence.dueFor(body, lagos.today(), cal);
    const commitment = body.is_commitment === true;
    checkCommitment({ is_commitment: commitment, acceptance_criteria: body.acceptance_criteria, commitment_month: body.commitment_month }, dueAt);
    const { number } = await numbering.allocate(client, "task");
    const id = await repo.insert(client, {
      number,
      title: body.title,
      description: body.description || null,
      status: "todo",
      priority: body.priority || "normal",
      cadence: body.cadence || null,
      created_by: actor.user_id,
      set_by_employee_id: actor.employee_id,
      primary_assignee_id: assigneeId,
      due_at: dueAt,
      employee_target_id: body.employee_target_id || null,
      entity_type: body.entity_type || null,
      entity_id: body.entity_id || null,
      recurrence: body.recurrence || null,
      sort_order: await repo.nextOrder(client, assigneeId, "todo"),
      is_commitment: commitment,
      acceptance_criteria: commitment ? body.acceptance_criteria : null,
      commitment_month: commitment ? body.commitment_month : null,
    });
    await repo.addActivity(client, { task_id: id, actor_user_id: actor.user_id, kind: "created", to_status: "todo" });
    const row = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_CREATED,
      entity: { type: "task", id },
      actor,
      after: toTask(row),
      payload: payloadOf(row),
    });
    return toTask(row);
  });
}

/**
 * Change a task. The setter's fields need mayManage (§6); the assignee may change the
 * notes and priority of a task someone else set.
 */
async function edit(actor, scope, id, body) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (before.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
    const manage = audience.mayManage(scope, before);
    const touched = audience.SETTER_FIELDS.filter((k) => k in body);
    if (touched.length && !manage) {
      throw new AppError("FORBIDDEN", "Only the person who set this task can change that", 403, {
        [touched[0]]: ["Set by someone else"],
      });
    }
    const assigneeId = body.primary_assignee_id || before.primary_assignee_id;
    const reassigned = Boolean(body.primary_assignee_id && body.primary_assignee_id !== before.primary_assignee_id);
    const approved = Boolean(before.is_commitment && before.original_due_at);
    // An approved commitment keeps its person, mark, month and criteria (§6.11).
    if (approved) {
      const day = (v) => (v ? String(v instanceof Date ? lagos.dateOf(v) : v).slice(0, 10) : null);
      const moved =
        reassigned ||
        ("is_commitment" in body && body.is_commitment !== true) ||
        ("acceptance_criteria" in body && (body.acceptance_criteria || null) !== before.acceptance_criteria) ||
        ("commitment_month" in body && day(body.commitment_month) !== day(before.commitment_month));
      if (moved) throw approvedCommitment();
    }
    if (reassigned) await checkAssignee(client, scope, body.primary_assignee_id);
    const targetId = "employee_target_id" in body ? body.employee_target_id : before.employee_target_id;
    if ("employee_target_id" in body || body.primary_assignee_id)
      await checkTarget(client, targetId, assigneeId);
    if ("entity_type" in body) await checkRecord(client, body.entity_type, body.entity_id);

    const changes = {};
    for (const k of ["title", "priority", "cadence", "employee_target_id", "entity_type", "entity_id", "recurrence"])
      if (k in body) changes[k] = body[k];
    if ("description" in body) changes.description = body.description || null;
    if ("due_on" in body) {
      const cal = await workingWeek.loadCalendar(client);
      changes.due_at = body.due_on ? recurrence.dueInstant(body.due_on, cal) : null;
    }
    if (reassigned) {
      changes.primary_assignee_id = body.primary_assignee_id;
      changes.sort_order = await repo.nextOrder(client, body.primary_assignee_id, before.status);
      // A draft commitment leaves its old person's set with them.
      if (before.commitment_set_id) changes.commitment_set_id = null;
    }
    if (!approved && ["is_commitment", "acceptance_criteria", "commitment_month"].some((k) => k in body)) {
      const mark = "is_commitment" in body ? body.is_commitment === true : Boolean(before.is_commitment);
      changes.is_commitment = mark;
      changes.acceptance_criteria = mark
        ? ("acceptance_criteria" in body ? body.acceptance_criteria || null : before.acceptance_criteria)
        : null;
      changes.commitment_month = mark ? ("commitment_month" in body ? body.commitment_month : before.commitment_month) : null;
      if (!mark) changes.commitment_set_id = null;
    }
    if (!approved) {
      const will = { ...before, ...changes };
      checkCommitment(will, "due_at" in changes ? changes.due_at : before.due_at);
    } else if ("due_at" in changes && !changes.due_at) {
      throw invalid("due_on", "Pick a due date");
    }
    await repo.update(client, id, changes);
    await repo.addActivity(client, {
      task_id: id,
      actor_user_id: actor.user_id,
      kind: changes.primary_assignee_id ? "assigned" : "edited",
      detail: Object.keys(body).join(", "),
    });
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_EDITED,
      entity: { type: "task", id },
      actor,
      before: toTask(before),
      after: toTask(after),
      payload: payloadOf(after),
    });
    return toTask(after);
  });
}

/** Drag a card: a column, and the card it now sits above (null: the foot). */
async function move(actor, scope, id, { status, before_task_id: beforeId }) {
  if (beforeId === id) throw invalid("before_task_id", "Pick another card");
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (before.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
    let slot = await repo.slotIn(client, {
      assigneeId: before.primary_assignee_id,
      status,
      beforeId,
      movingId: id,
    });
    if (!slot) throw new AppError("CONFLICT", "That card has moved, reload the board", 409);
    if (slot.between === null) {
      await repo.renumber(client, before.primary_assignee_id, status);
      slot = await repo.slotIn(client, { assigneeId: before.primary_assignee_id, status, beforeId, movingId: id });
    }
    const now = new Date();
    const changes = { status, sort_order: slot.between };
    if (status !== before.status) {
      if (status === "in_progress" && !before.started_at) changes.started_at = now;
      if (status === "done") changes.completed_at = now;
      if (before.status === "done") changes.completed_at = null;
      if (status === "done" && before.blocked_reason) {
        changes.blocked_reason = null;
        changes.blocked_at = null;
      }
    }
    await repo.update(client, id, changes);
    const after = await repo.get(client, id);
    if (status !== before.status) {
      await repo.addActivity(client, {
        task_id: id,
        actor_user_id: actor.user_id,
        kind: "status_changed",
        from_status: before.status,
        to_status: status,
      });
      let key = EVENTS.TASK_STATUS_CHANGED;
      if (status === "done") key = EVENTS.TASK_COMPLETED;
      else if (before.status === "done") key = EVENTS.TASK_REOPENED;
      await emit(client, {
        key,
        entity: { type: "task", id },
        actor,
        before: { status: before.status },
        after: { status },
        // The month a counting line's figure changes in (§6.18): the completion's, or the one it left.
        payload: payloadOf(after, {
          from_status: before.status,
          month: `${lagos.dateOf(new Date(status === "done" ? now : before.completed_at || now)).slice(0, 7)}-01`,
        }),
      });
    }
    return toTask(after);
  });
}

async function block(actor, scope, id, { blocked_reason: reason }) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (["done", "cancelled"].includes(before.status))
      throw new AppError("TASK_CLOSED", "This task is closed", 409);
    await repo.update(client, id, { blocked_reason: reason, blocked_at: new Date() });
    await repo.addActivity(client, { task_id: id, actor_user_id: actor.user_id, kind: "blocked", detail: reason });
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_BLOCKED,
      entity: { type: "task", id },
      actor,
      after: { blocked_reason: reason },
      payload: payloadOf(after, { blocked_reason: reason }),
    });
    return toTask(after);
  });
}

async function unblock(actor, scope, id) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (!before.blocked_reason) return toTask(before);
    await repo.update(client, id, { blocked_reason: null, blocked_at: null });
    await repo.addActivity(client, { task_id: id, actor_user_id: actor.user_id, kind: "unblocked" });
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_UNBLOCKED,
      entity: { type: "task", id },
      actor,
      before: { blocked_reason: before.blocked_reason },
      payload: payloadOf(after),
    });
    return toTask(after);
  });
}

/** Cancel a task, with a reason. Only whoever manages it (§6). */
async function cancel(actor, scope, id, { cancel_reason: reason }) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (!audience.mayManage(scope, before))
      throw new AppError("FORBIDDEN", "Only the person who set this task can cancel it", 403);
    if (before.status === "cancelled") return toTask(before);
    if (before.is_commitment && before.original_due_at) throw approvedCommitment();
    await repo.update(client, id, { status: "cancelled", cancelled_at: new Date(), cancel_reason: reason });
    await repo.addActivity(client, {
      task_id: id,
      actor_user_id: actor.user_id,
      kind: "cancelled",
      from_status: before.status,
      to_status: "cancelled",
      detail: reason,
    });
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_CANCELLED,
      entity: { type: "task", id },
      actor,
      before: { status: before.status },
      after: { status: "cancelled" },
      payload: payloadOf(after, { cancel_reason: reason, from_status: before.status }),
    });
    return toTask(after);
  });
}

/**
 * A record that tasks carry out is gone (an imported key result reverted): its open tasks are
 * cancelled with it, in the caller's transaction.
 */
async function cancelForRecord(client, actor, { entity_type: entityType, entity_id: entityId, reason }) {
  for (const t of await repo.openForRecord(client, entityType, entityId)) {
    await repo.update(client, t.task_id, { status: "cancelled", cancelled_at: new Date(), cancel_reason: reason });
    await repo.addActivity(client, {
      task_id: t.task_id,
      actor_user_id: actor ? actor.user_id : null,
      kind: "cancelled",
      from_status: t.status,
      to_status: "cancelled",
      detail: reason,
    });
    const after = await repo.get(client, t.task_id);
    await emit(client, {
      key: EVENTS.TASK_CANCELLED,
      entity: { type: "task", id: t.task_id },
      actor,
      before: { status: t.status },
      after: { status: "cancelled" },
      payload: payloadOf(after, { cancel_reason: reason, from_status: t.status }),
    });
  }
}

async function comment(actor, scope, id, { body }) {
  return tx(async (client) => {
    const task = await visible(client, id, scope);
    const commentId = await repo.addComment(client, { task_id: id, author_user_id: actor.user_id, body });
    await repo.addActivity(client, { task_id: id, actor_user_id: actor.user_id, kind: "commented" });
    await emit(client, {
      key: EVENTS.TASK_COMMENTED,
      entity: { type: "task", id },
      actor,
      payload: payloadOf(task, { excerpt: body.slice(0, 140), task_comment_id: commentId }),
    });
    return repo.comment(client, commentId);
  });
}

/* ------------------------------------------------------------------ *
 * The recurrence job
 * ------------------------------------------------------------------ */

const BATCH = 100;

/** Make the next occurrence of one repeating task, if it is still due. */
/**
 * The next occurrence of one repeating task. It is counted from the task's own due day, or
 * from yesterday when that day is already past, so a task days overdue repeats once, on its
 * next day still to come, rather than once per sweep until it catches up.
 */
async function repeatOne(id, cal, now = new Date()) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) return false;
    const t = await repo.get(client, id);
    const { rows } = await client.query(
      "SELECT 1 FROM task WHERE parent_task_id = $1 AND recurrence IS NOT NULL",
      [id],
    );
    if (!t || !t.recurrence || rows.length || t.status === "cancelled") return false;
    const today = lagos.today(now);
    const dueDay = t.due_at ? lagos.dateOf(new Date(t.due_at)) : today;
    const lastDay = dueDay < today ? lagos.addDays(today, -1) : dueDay;
    const day = recurrence.nextDay(t.recurrence, lastDay, cal);
    const { number } = await numbering.allocate(client, "task");
    const childId = await repo.insert(client, {
      number,
      title: t.title,
      description: t.description,
      status: "todo",
      priority: t.priority,
      cadence: t.cadence,
      created_by: t.created_by,
      set_by_employee_id: t.set_by_employee_id,
      primary_assignee_id: t.primary_assignee_id,
      due_at: recurrence.dueInstant(day, cal),
      employee_target_id: t.employee_target_id,
      entity_type: t.entity_type,
      entity_id: t.entity_id,
      recurrence: t.recurrence,
      sort_order: await repo.nextOrder(client, t.primary_assignee_id, "todo"),
    });
    await client.query("UPDATE task SET parent_task_id = $2 WHERE task_id = $1", [childId, id]);
    await repo.addActivity(client, { task_id: childId, actor_user_id: null, kind: "created", to_status: "todo", detail: `repeats ${t.number}` });
    const row = await repo.get(client, childId);
    await emit(client, {
      key: EVENTS.TASK_CREATED,
      entity: { type: "task", id: childId },
      actor: null,
      after: toTask(row),
      payload: payloadOf(row, { repeats: id }),
    });
    return true;
  });
}

/** Tell assignees about tasks due today and tomorrow. Once a day per task (dedup). */
async function remind(now, cal) {
  const today = lagos.today(now);
  const tomorrow = workingWeek.nextWorkingDay(lagos.addDays(today, 1), cal);
  let sent = 0;
  for (const [when, day] of [["today", today], ["tomorrow", tomorrow]]) {
    let after = null;
    for (;;) {
      const batch = await repo.dueBetween(pool, lagos.instant(day), lagos.instant(lagos.addDays(day, 1)), after, BATCH);
      for (const t of batch) {
        await tx((client) =>
          emit(client, {
            key: EVENTS.TASK_DUE_SOON,
            entity: { type: "task", id: t.task_id },
            actor: null,
            payload: { ...t, subject_employee_id: t.primary_assignee_id, when },
            dedup_key: `task.due_soon:${t.task_id}:${day}`,
          }),
        );
        sent += 1;
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1];
    }
  }
  return sent;
}

/** The daily sweep: repeats made, reminders sent. Safe to run twice. */
async function sweep(now = new Date()) {
  const cal = await workingWeek.loadCalendar(pool);
  let repeated = 0;
  for (;;) {
    const ids = await repo.dueToRepeat(pool, now, BATCH);
    let made = 0;
    for (const id of ids) if (await repeatOne(id, cal, now)) made += 1;
    repeated += made;
    if (ids.length < BATCH || made === 0) break;
  }
  const reminded = lagos.today(now) && workingWeek.isWorkingDay(lagos.today(now), cal) ? await remind(now, cal) : 0;
  return { repeated, reminded };
}

/* ------------------------------------------------------------------ *
 * Commitments: what the targets module asks of a task, in its transaction (§6.11)
 * ------------------------------------------------------------------ */

/** Put a person's unapproved commitments for a month into their set; the ids put in. */
async function linkCommitments(client, actor, { employeeId, month, setId }) {
  const ids = await repo.linkCommitments(client, { employeeId, month, setId });
  for (const id of ids)
    await repo.addActivity(client, { task_id: id, actor_user_id: actor ? actor.user_id : null, kind: "edited", detail: "commitment sent" });
  return ids;
}

/** A set approved: its commitments' original dates are fixed. The ids fixed. */
async function fixOriginalDates(client, actor, setId) {
  const ids = await repo.fixOriginalDates(client, setId);
  for (const id of ids)
    await repo.addActivity(client, { task_id: id, actor_user_id: actor ? actor.user_id : null, kind: "edited", detail: "commitment approved" });
  return ids;
}

/** A rescope asked: its reason is kept on the task until it is decided. */
async function askRescope(client, actor, id, reason) {
  await repo.update(client, id, { rescope_reason: reason });
  await repo.addActivity(client, { task_id: id, actor_user_id: actor.user_id, kind: "edited", detail: `rescope asked: ${reason}` });
}

/** A rescope decided: approved, the commitment is rescoped; refused, its reason goes. */
async function settleRescope(client, actor, id, approved) {
  await repo.update(client, id, approved ? { rescoped_at: new Date() } : { rescope_reason: null });
  await repo.addActivity(client, {
    task_id: id,
    actor_user_id: actor ? actor.user_id : null,
    kind: "edited",
    detail: approved ? "commitment rescoped" : "rescope refused",
  });
}

module.exports = {
  linkCommitments,
  fixOriginalDates,
  askRescope,
  settleRescope,
  cancelForRecord,
  toTask,
  windows,
  list,
  summary,
  getFor,
  countsTowards,
  doneTowards,
  comments,
  activity,
  create,
  edit,
  move,
  block,
  unblock,
  cancel,
  comment,
  sweep,
};
