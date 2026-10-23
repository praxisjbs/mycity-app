"use strict";
/**
 * Tasks: the one write path for a task (docs/guides/workspace.md §3, §6).
 *
 *   create()   a person sets a task for themselves, or a manager for someone in their
 *              reporting line (A24). It takes a number, lands at the foot of To Do, and
 *              is due at the end of the day it names, or of its cadence's day. Shared, it
 *              has a lead (the primary assignee) and the people sharing it, named or a
 *              whole department (shareWith).
 *   people()   who the caller may put on a task, for New Task's pickers.
 *   edit()     the setter changes what they decided, who shares it among them; the assignee
 *              and the people sharing it their notes and priority.
 *   move()     a drag: a column and the card it now sits above. Entering In Progress the
 *              first time starts it; Done completes it; leaving Done reopens it.
 *   block(), unblock()   a hold with its note and expected day; clearing it moves the due
 *              time on by the days it lasted, unless told not to.
 *   cancel(), comment()
 *   addStep(), editStep(), removeStep()          the task's steps
 *   addWaiting(), removeWaiting(), overrideWaiting()   the tasks it waits on: a task waiting
 *              on one not yet done does not leave To Do until that is done or overridden
 *   watch(), unwatch(), ping(), setReminders()
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
const grantsCache = require("../../shared/rbac/grants-cache");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./tasks.repo");
const audience = require("./tasks.audience");
const recurrence = require("./tasks.recurrence");
const reasons = require("./tasks.reasons");
const reminders = require("../notifications/notifications.reminders");
const { EVENTS, REMINDER_KEY } = require("./tasks.events");

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
    members: row.members || [],
    set_by: row.set_by,
    due_at: iso(row.due_at),
    overdue: Boolean(open && due && due < now),
    started_at: iso(row.started_at),
    completed_at: iso(row.completed_at),
    cancelled_at: iso(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    blocked_reason: row.blocked_reason,
    blocked_at: iso(row.blocked_at),
    late_reason: row.late_reason ?? null,
    late_reason_label: row.late_reason_label ?? null,
    counts_towards: countsTowardsOf(row),
    project: row.project_id ? { project_id: row.project_id, number: row.project_number || "", name: row.project_name || "" } : null,
    assignee_left: Boolean(row.assignee_left),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    link: row.entity_type ? linkFor(row.entity_type, row.entity_id) : null,
    recurrence: row.recurrence || null,
    comment_count: row.comment_count || 0,
    steps_total: row.steps_total || 0,
    steps_done: row.steps_done || 0,
    waiting: Boolean(row.waiting),
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
  member_employee_ids: (row.members || []).map((p) => p.employee_id),
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
    last30: { from: lagos.instant(lagos.addDays(today, -29)), to: lagos.instant(lagos.addDays(today, 1)) },
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** One page of tasks; `only` narrows it for Today (repo.list), whose `now` it is read at. */
async function list(query, scope, only = {}, now = new Date()) {
  const at = windows(now);
  const page = await repo.list(pool, query, scope, at, only);
  return { ...page, data: page.data.map((r) => toTask(r, at.now)) };
}

const summary = (query, scope) => repo.summary(pool, query.scope, scope, windows());

/** A task the caller may see, as a repo row; 404 otherwise. `member`: the caller shares it. */
async function visible(db, id, scope) {
  const row = await repo.get(db, id);
  if (!row) throw notFound();
  const shared = await repo.sharedWith(db, id, scope.employee_id);
  if (!audience.maySee(scope, row, shared)) throw notFound();
  return { ...row, member: shared };
}

/**
 * Who the caller may put on a task: their scope, and for a shared task they lead, also their own
 * department (A24 as extended, workspace.md §6). The repo's reachClause reads it.
 */
async function reachOf(db, scope, { peers }) {
  return {
    all: scope.scope === "all",
    ids: scope.scope === "all" ? [] : (scope.scope_ids || []),
    peerDepartmentId: peers ? await repo.departmentOf(db, scope.employee_id) : null,
  };
}

/**
 * GET /tasks/people: who the caller may set a task for, or with `shared`, share one with; with
 * `department_id`, who in that department may lead a task shared with it, the caller included.
 */
async function people(query, scope) {
  const reach = await reachOf(pool, scope, { peers: query.shared === "true" });
  return repo.people(pool, query, { reach, excludeId: query.department_id ? null : scope.employee_id });
}

/** Another task as a panel line: its words only when the reader may open it (`reader_shares`: they share it). */
function toRef(row, scope) {
  const seen = audience.maySee(scope, row, row.reader_shares);
  return {
    task_id: row.task_id,
    number: row.number || "",
    title: seen ? row.title : "A task you cannot open",
    status: row.status,
    assignee: seen ? row.assignee : null,
    visible: seen,
  };
}

/**
 * Which of these employees may see the task by their own workspace grant: its lead, its setter,
 * the people sharing it, and anyone whose scope covers the lead (A24). A watcher is only someone
 * who already may, and watchers and nudges reach only them (workspace.md §6).
 * @param {{task_id: string, primary_assignee_id: string, set_by_employee_id: string|null}} task
 */
async function whoMaySee(db, task, employeeIds) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return [];
  const members = new Set(await repo.memberIds(db, task.task_id));
  const logins = await repo.usersOf(db, ids);
  const seen = [];
  for (const id of ids) {
    if (id === task.primary_assignee_id || id === task.set_by_employee_id || members.has(id)) {
      seen.push(id);
      continue;
    }
    const user = logins.has(id) ? await grantsCache.getAuthUser(db, logins.get(id)) : null;
    const theirs = user && user.status === "active" ? await scopeFor(user, "workspace", "view") : null;
    if (theirs && audience.maySee(theirs, task, false)) seen.push(id);
  }
  return seen;
}

const toEdge = (row, scope) => ({
  task_dependency_id: row.task_dependency_id,
  task: toRef(row, scope),
  satisfied: row.status === "done" || Boolean(row.overridden_at),
  overridden_at: iso(row.overridden_at),
  override_reason: row.override_reason,
});

function toStep(row) {
  return {
    task_step_id: row.task_step_id,
    task_id: row.task_id,
    title: row.title,
    due_on: row.due_on || null,
    done_at: iso(row.done_at),
    done_by: row.done_by,
    sort_order: row.sort_order,
    created_at: iso(row.created_at),
  };
}

function toBlockage(row) {
  if (!row) return null;
  return {
    task_blockage_id: row.task_blockage_id,
    note: row.note,
    estimated_resolve_on: row.estimated_resolve_on || null,
    raised_by: row.raised_by,
    raised_at: iso(row.raised_at),
    resolved_at: iso(row.resolved_at),
    resolved_by: row.resolved_by,
    resolve_note: row.resolve_note,
    due_shift_days: row.due_shift_days ?? null,
    blocked_days: Number(row.blocked_days) || 0,
  };
}

/** May the caller plan the task: its steps, what it waits on, its reminders? Its people may. */
const mayPlan = (scope, row) =>
  audience.mayManage(scope, row) || row.primary_assignee_id === scope.employee_id || row.member === true;

/** May the caller act on this person's commitment: they are its person, or the person is in their scope. */
const actsFor = (scope, row) => row.primary_assignee_id === scope.employee_id || audience.inScope(scope, row.primary_assignee_id);

/**
 * The panel: the task, what hangs off it (steps, links, watchers, the open hold, reminders) and what
 * the caller may do to it. A commitment also carries where its set stands, a rescope waiting on
 * approval (and whether the caller decides it), and its recovery.
 * @param {string} id
 * @param {object} scope  scopeOf(req)
 * @param {object} [actor] withActor(req): who decides a rescope
 */
async function getFor(id, scope, actor = null) {
  const row = await visible(pool, id, scope);
  const manage = audience.mayManage(scope, row);
  const approved = Boolean(row.is_commitment && row.original_due_at);
  const [stepRows, waits, held, watching, hold, pending, open] = await Promise.all([
    repo.steps(pool, id),
    repo.waitingOn(pool, id, scope.employee_id),
    repo.holdingUp(pool, id, scope.employee_id),
    repo.watchers(pool, id),
    repo.openBlockage(pool, id),
    reminders.pendingFor(pool, { key: REMINDER_KEY, entity: { type: "task", id } }),
    approved ? workflow.findOpenInstance(pool, { type: "task", id }) : null,
  ]);
  const rescope =
    open && open.definition_key === "performance.commitments"
      ? { workflow_instance_id: open.workflow_instance_id, can_decide: Boolean(actor) && (await approvers.canAct(pool, open.stage_approvers, actor, open)) }
      : null;
  const recovery = row.commitment_state === "missed" || row.commitment_state === "late" ? await repo.recoveryOf(pool, id) : null;
  return {
    ...toTask(row),
    steps: stepRows.map(toStep),
    waiting_on: waits.map((r) => toEdge(r, scope)),
    holding_up: held.map((r) => toEdge(r, scope)),
    watchers: watching,
    watching: watching.some((p) => p.employee_id === scope.employee_id),
    blockage: toBlockage(hold),
    reminders: pending
      .map((r) => ({
        slot: Number(r.occurrence) || 1,
        remind_at: iso(r.due_at),
        minutes_before: r.payload && Number.isInteger(r.payload.minutes_before) ? r.payload.minutes_before : null,
      }))
      .filter((r) => r.slot >= 1 && r.slot <= 3)
      .sort((a, b) => a.slot - b.slot),
    can_edit: true,
    can_reassign: manage,
    can_cancel: manage && row.status !== "cancelled" && !approved,
    can_plan: mayPlan(scope, row) && row.status !== "cancelled",
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

async function blockageHistory(id, query, scope) {
  await visible(pool, id, scope);
  const page = await repo.blockages(pool, id, query);
  return { ...page, data: page.data.map(toBlockage) };
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
/** A task joins an open project (422 otherwise): the projects service decides. */
async function checkProject(db, projectId) {
  if (projectId) await require("../projects/projects.service").assertOpen(db, projectId);
}

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

/**
 * A shared task's lead (workspace.md §6): shared with a department, someone in it; named along
 * with the people, the caller or one of them. Whether the caller may set them work is checkAssignee's.
 */
async function checkLead(db, scope, leadId, body) {
  if (body.department_id) {
    const [p] = await repo.peopleFacts(db, [leadId]);
    if (!p || p.department_id !== body.department_id) throw invalid("primary_assignee_id", "Not in that department");
  } else if (body.primary_assignee_id && body.member_ids && leadId !== scope.employee_id && !body.member_ids.includes(leadId)) {
    throw invalid("primary_assignee_id", "Pick from the people");
  }
}

/**
 * The people a shared task is shared with, beside its lead (workspace.md §6): named, or a
 * department's active people the caller may add, at the moment of saving. Anyone the caller may
 * set a task for; colleagues of their own department too when they lead it themselves.
 * @returns {Promise<string[]>} employee ids, never the lead
 */
async function shareWith(db, scope, leadId, { member_ids: named, department_id: departmentId }) {
  const peers = leadId === scope.employee_id;
  const mine = await repo.departmentOf(db, scope.employee_id);
  const reach = { ...(await reachOf(db, scope, { peers: false })), peerDepartmentId: peers ? mine : null };
  if (departmentId) {
    if (!(await repo.department(db, departmentId))) throw invalid("department_id", "Not a department");
    const { total, ids } = await repo.departmentPeople(db, { departmentId, leadId, reach });
    if (!total) throw invalid("department_id", "Nobody to share with");
    if (total > repo.MEMBERS_MAX) throw invalid("department_id", `More than ${repo.MEMBERS_MAX} people`);
    return ids;
  }
  const ids = [...new Set(named || [])].filter((id) => id !== leadId);
  if (ids.length > repo.MEMBERS_MAX) throw invalid("member_ids", `At most ${repo.MEMBERS_MAX} people`);
  const facts = new Map((await repo.peopleFacts(db, ids)).map((r) => [r.employee_id, r]));
  for (const id of ids) {
    const p = facts.get(id);
    if (!p || p.status !== "active") throw invalid("member_ids", "Not on the staff");
    const colleague = Boolean(mine) && p.department_id === mine;
    if (!audience.maySetFor(scope, id) && !(peers && colleague))
      throw invalid("member_ids", colleague ? "Lead it yourself" : "Not in your team");
  }
  return ids;
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
  const shared = body.member_ids !== undefined || body.department_id !== undefined;
  // An importer sets tasks inside its own transaction (a key result's initiatives).
  const run = within ? (fn) => atomically(within, () => fn(within)) : tx;
  return run(async (client) => {
    // A department is shared under a lead picked from it; with no lead named, the task is the caller's.
    if (body.department_id && !body.primary_assignee_id) throw invalid("primary_assignee_id", "Pick a lead");
    const assigneeId = body.primary_assignee_id || actor.employee_id;
    await checkAssignee(client, scope, assigneeId);
    const members = shared ? await shareWith(client, scope, assigneeId, body) : [];
    if (shared) await checkLead(client, scope, assigneeId, body);
    await checkTarget(client, body.employee_target_id, assigneeId);
    await checkRecord(client, body.entity_type, body.entity_id);
    await checkProject(client, body.project_id);
    const cal = await workingWeek.loadCalendar(client);
    const dueAt = recurrence.dueFor(body, lagos.today(), cal);
    const commitment = body.is_commitment === true;
    checkCommitment({ is_commitment: commitment, acceptance_criteria: body.acceptance_criteria, commitment_month: body.commitment_month }, dueAt);
    if (body.recurrence && !dueAt) throw invalid("recurrence", "Needs a due date");
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
      project_id: body.project_id || null,
      recurrence: body.recurrence || null,
      sort_order: await repo.nextOrder(client, assigneeId, "todo"),
      is_commitment: commitment,
      acceptance_criteria: commitment ? body.acceptance_criteria : null,
      commitment_month: commitment ? body.commitment_month : null,
    });
    if (members.length) await repo.setMembers(client, id, members);
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
 * Change a task. The setter's fields, who shares it among them, need mayManage (§6); the
 * assignee and the people sharing it may change the notes and priority of a task someone else
 * set, and only the assignee (the lead) its commitment fields.
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
    const day = (v) => (v ? String(v instanceof Date ? lagos.dateOf(v) : v).slice(0, 10) : null);
    // The commitment fields the body changes, against the task as it stands.
    const remarked = [
      "is_commitment" in body && body.is_commitment !== Boolean(before.is_commitment) && "is_commitment",
      "acceptance_criteria" in body && (body.acceptance_criteria || null) !== before.acceptance_criteria && "acceptance_criteria",
      "commitment_month" in body && day(body.commitment_month) !== day(before.commitment_month) && "commitment_month",
    ].find(Boolean);
    // A commitment is its lead's (the assignee's): the people sharing the task leave it as it is.
    if (remarked && !manage && before.primary_assignee_id !== scope.employee_id) {
      throw new AppError("FORBIDDEN", "Only its lead can change that", 403, { [remarked]: ["Its lead's to change"] });
    }
    // An approved commitment keeps its person, mark, month and criteria (§6.11).
    if (approved) {
      const moved =
        reassigned ||
        ("is_commitment" in body && body.is_commitment !== true) ||
        ("acceptance_criteria" in body && (body.acceptance_criteria || null) !== before.acceptance_criteria) ||
        ("commitment_month" in body && day(body.commitment_month) !== day(before.commitment_month));
      if (moved) throw approvedCommitment();
    }
    if (reassigned) await checkAssignee(client, scope, body.primary_assignee_id);
    // Who shares it: named again (or a department) replaces them; a new lead is never also one of them.
    const resharing = "member_ids" in body || "department_id" in body;
    const membersBefore = (before.members || []).map((p) => p.employee_id);
    let members = null;
    if (resharing) {
      members = await shareWith(client, scope, assigneeId, body);
      await checkLead(client, scope, assigneeId, body);
    }
    else if (reassigned && membersBefore.includes(assigneeId)) members = membersBefore.filter((m) => m !== assigneeId);
    const targetId = "employee_target_id" in body ? body.employee_target_id : before.employee_target_id;
    if ("employee_target_id" in body || body.primary_assignee_id)
      await checkTarget(client, targetId, assigneeId);
    if ("entity_type" in body) await checkRecord(client, body.entity_type, body.entity_id);
    // A task may stay in a project completed since; joining one needs it open.
    if (body.project_id && body.project_id !== before.project_id) await checkProject(client, body.project_id);
    if (body.late_reason) await reasons.assertOn(client, body.late_reason);

    const changes = {};
    for (const k of ["title", "priority", "cadence", "employee_target_id", "entity_type", "entity_id", "project_id", "recurrence", "late_reason"])
      if (k in body) changes[k] = body[k];
    if ("description" in body) changes.description = body.description || null;
    if ("due_on" in body) {
      const cal = await workingWeek.loadCalendar(client);
      changes.due_at = body.due_on ? recurrence.dueInstant(body.due_on, cal) : null;
    }
    // A series counts from its due day: a repeating task keeps one (the rule a repeat is anchored by).
    const repeats = "recurrence" in body ? body.recurrence : before.recurrence;
    const dueAfter = "due_at" in changes ? changes.due_at : before.due_at;
    if (repeats && !dueAfter) throw invalid("recurrence", "Needs a due date");
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
    if (members) await repo.setMembers(client, id, members);
    await repo.addActivity(client, {
      task_id: id,
      actor_user_id: actor.user_id,
      kind: changes.primary_assignee_id || members ? "assigned" : "edited",
      detail: Object.keys(body).join(", "),
    });
    const after = await repo.get(client, id);
    if ("due_on" in body) await followDue(client, id, after.due_at);
    // Whoever is newly on it hears: people added, and a new lead.
    const added = [
      ...(reassigned ? [after.primary_assignee_id] : []),
      ...(after.members || []).map((p) => p.employee_id).filter((m) => !membersBefore.includes(m)),
    ].filter((m) => m !== before.primary_assignee_id);
    await emit(client, {
      key: EVENTS.TASK_EDITED,
      entity: { type: "task", id },
      actor,
      before: toTask(before),
      after: toTask(after),
      payload: payloadOf(after, { added_employee_ids: [...new Set(added)], editor_name: actor.display_name || null }),
    });
    return toTask(after);
  });
}

/** Drag a card: a column, and the card it now sits above (null: the foot). */
async function move(actor, scope, id, { status, before_task_id: beforeId, late_reason: lateReason }) {
  if (beforeId === id) throw invalid("before_task_id", "Pick another card");
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    // The card it lands above is one on the reader's own board; any other is a stale board.
    if (beforeId) await visible(client, beforeId, scope).catch(() => {
      throw new AppError("CONFLICT", "That card has moved, reload the board", 409);
    });
    if (before.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
    if (status === "done" && lateReason) await reasons.assertOn(client, lateReason);
    if (before.status === "todo" && status !== "todo") {
      const pending = await repo.firstUnsatisfied(client, id);
      if (pending) {
        throw new AppError("TASK_WAITING", `Waiting on ${pending.number}: ${pending.title}`, 409, {
          status: [`Waiting on ${pending.number}`],
        });
      }
    }
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
        await repo.resolveBlockage(client, id, { by: actor.user_id, note: "Done", shiftDays: null });
      }
      if (status === "done" && lateReason) changes.late_reason = lateReason;
    }
    await repo.update(client, id, changes);
    if (status === "done" && before.status !== "done") await reminders.cancel(client, { key: REMINDER_KEY, entity: { type: "task", id } });
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
      if (status === "done") await tellWaiting(client, actor, after);
    } else {
      // Within its column: no history line and no notice, but open boards follow it.
      await emit(client, {
        key: EVENTS.TASK_REORDERED,
        entity: { type: "task", id },
        actor,
        before: { sort_order: Number(before.sort_order) },
        after: { sort_order: Number(after.sort_order) },
        payload: payloadOf(after),
      });
    }
    return toTask(after);
  });
}

/**
 * A task is done: the people on each open task waiting on it hear, about their own task, so the
 * notice names nothing they may not open.
 */
async function tellWaiting(client, actor, done) {
  for (const waitingId of await repo.waitingTaskIds(client, done.task_id)) {
    const row = await repo.get(client, waitingId);
    await emit(client, {
      key: EVENTS.TASK_PREREQUISITE_DONE,
      entity: { type: "task", id: waitingId },
      actor,
      payload: payloadOf(row, { prerequisite_task_id: done.task_id }),
    });
  }
}

async function block(actor, scope, id, { blocked_reason: reason, estimated_resolve_on: estimate }) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (["done", "cancelled"].includes(before.status))
      throw new AppError("TASK_CLOSED", "This task is closed", 409);
    if (before.blocked_reason)
      throw new AppError("TASK_BLOCKED", "This task is already blocked; clear that first", 409);
    const hold = await repo.insertBlockage(client, {
      task_id: id,
      note: reason,
      estimated_resolve_on: estimate || null,
      raised_by: actor.user_id,
    });
    await repo.update(client, id, { blocked_reason: reason, blocked_at: hold.raised_at });
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

/** Days a hold lasted, rounded up: a hold of an afternoon moves the due time a day. */
const heldDays = (since, now) => Math.max(1, Math.ceil((now.getTime() - new Date(since).getTime()) / 86_400_000));

async function unblock(actor, scope, id, body = {}) {
  const pushDue = body.push_due !== false;
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const before = await visible(client, id, scope);
    if (!before.blocked_reason) return toTask(before);
    const now = new Date();
    const open = !["done", "cancelled"].includes(before.status);
    const shift = pushDue && open && before.due_at && before.blocked_at ? heldDays(before.blocked_at, now) : null;
    await repo.resolveBlockage(client, id, { by: actor.user_id, note: body.resolve_note || null, shiftDays: shift });
    const changes = { blocked_reason: null, blocked_at: null };
    if (shift) changes.due_at = new Date(new Date(before.due_at).getTime() + shift * 86_400_000);
    await repo.update(client, id, changes);
    await repo.addActivity(client, {
      task_id: id,
      actor_user_id: actor.user_id,
      kind: "unblocked",
      detail: [body.resolve_note, shift ? `due moved ${shift} day${shift === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || null,
    });
    if (shift) await followDue(client, id, changes.due_at);
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.TASK_UNBLOCKED,
      entity: { type: "task", id },
      actor,
      before: { blocked_reason: before.blocked_reason },
      payload: payloadOf(after, { resolve_note: body.resolve_note || null }),
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
    await reminders.cancel(client, { key: REMINDER_KEY, entity: { type: "task", id } });
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
    await reminders.cancel(client, { key: REMINDER_KEY, entity: { type: "task", id: t.task_id } });
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
 * Steps, waiting on, watchers, pings and reminders
 * ------------------------------------------------------------------ */

const conflict = (code, message) => new AppError(code, message, 409);

/** Lock and load a task the caller may plan, or refuse. */
async function planned(client, id, scope) {
  if (!(await repo.lock(client, id))) throw notFound();
  const row = await visible(client, id, scope);
  if (row.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
  if (!mayPlan(scope, row))
    throw new AppError("FORBIDDEN", "Only its assignee or the person who set it can change that", 403);
  return row;
}

/** One write to a task's plan: the history line and the event, in the caller's transaction. */
async function noted(client, actor, row, { kind, detail, key, extra = {} }) {
  await repo.addActivity(client, { task_id: row.task_id, actor_user_id: actor.user_id, kind, detail: detail || null });
  await emit(client, {
    key,
    entity: { type: "task", id: row.task_id },
    actor,
    payload: payloadOf(row, { change: kind, detail: detail || null, ...extra }),
  });
}

async function addStep(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await planned(client, id, scope);
    const { n, last } = await repo.stepCount(client, id);
    if (n >= repo.PLAN_MAX) throw conflict("TOO_MANY_STEPS", `A task holds at most ${repo.PLAN_MAX} steps`);
    const stepId = await repo.insertStep(client, {
      task_id: id,
      title: body.title,
      due_on: body.due_on || null,
      sort_order: last + 1,
      created_by: actor.user_id,
    });
    await noted(client, actor, row, { kind: "step_added", detail: body.title, key: EVENTS.TASK_STEP_CHANGED });
    return toStep(await repo.step(client, id, stepId));
  });
}

/** Rename, re-date, tick or untick a step. Ticking is open to anyone who can see the task. */
async function editStep(actor, scope, id, stepId, body) {
  return tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const row = await visible(client, id, scope);
    if (row.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
    const before = await repo.step(client, id, stepId);
    if (!before) throw new AppError("NOT_FOUND", "That step does not exist", 404);
    if (("title" in body || "due_on" in body) && !mayPlan(scope, row))
      throw new AppError("FORBIDDEN", "Only its assignee or the person who set it can change that", 403);
    const changes = {};
    if ("title" in body) changes.title = body.title;
    if ("due_on" in body) changes.due_on = body.due_on;
    let kind = "edited";
    if ("done" in body && body.done !== Boolean(before.done_at)) {
      changes.done_at = body.done ? new Date() : null;
      changes.done_by = body.done ? actor.user_id : null;
      kind = body.done ? "step_done" : "step_reopened";
    }
    await repo.updateStep(client, stepId, changes);
    await noted(client, actor, row, { kind, detail: changes.title || before.title, key: EVENTS.TASK_STEP_CHANGED });
    return toStep(await repo.step(client, id, stepId));
  });
}

async function removeStep(actor, scope, id, stepId) {
  await tx(async (client) => {
    const row = await planned(client, id, scope);
    const before = await repo.step(client, id, stepId);
    if (!before) throw new AppError("NOT_FOUND", "That step does not exist", 404);
    await repo.deleteStep(client, stepId);
    await noted(client, actor, row, { kind: "step_removed", detail: before.title, key: EVENTS.TASK_STEP_CHANGED });
  });
  return getFor(id, scope, actor);
}

/** This task waits on another the caller can see. No loops, and no more than PLAN_MAX either way. */
async function addWaiting(actor, scope, id, { depends_on_task_id: otherId }) {
  if (otherId === id) throw invalid("depends_on_task_id", "Pick another task");
  await tx(async (client) => {
    const row = await planned(client, id, scope);
    const other = await repo.get(client, otherId);
    if (!other || !audience.maySee(scope, other, await repo.sharedWith(client, otherId, scope.employee_id)))
      throw invalid("depends_on_task_id", "Not a task you can see");
    if (other.status === "cancelled") throw invalid("depends_on_task_id", "That task was cancelled");
    const counts = await repo.edgeCounts(client, id, otherId);
    if (counts.waits >= repo.PLAN_MAX || counts.held >= repo.PLAN_MAX)
      throw conflict("TOO_MANY_LINKS", `A task waits on, or holds up, at most ${repo.PLAN_MAX} others`);
    if (await repo.wouldCycle(client, id, otherId))
      throw invalid("depends_on_task_id", `${other.number} already waits on this task`);
    const made = await repo.insertDependency(client, { task_id: id, depends_on_task_id: otherId, created_by: actor.user_id });
    if (made)
      await noted(client, actor, row, {
        kind: "waiting_added",
        detail: `${other.number} ${other.title}`,
        key: EVENTS.TASK_WAITING_CHANGED,
      });
  });
  return getFor(id, scope, actor);
}

async function removeWaiting(actor, scope, id, dependencyId) {
  await tx(async (client) => {
    const row = await planned(client, id, scope);
    const edge = await repo.dependency(client, id, dependencyId);
    if (!edge) throw new AppError("NOT_FOUND", "That link does not exist", 404);
    await repo.deleteDependency(client, dependencyId);
    await noted(client, actor, row, { kind: "waiting_removed", detail: edge.other_number, key: EVENTS.TASK_WAITING_CHANGED });
  });
  return getFor(id, scope, actor);
}

/** Go ahead without the other task: a person's word, kept on the link. */
async function overrideWaiting(actor, scope, id, dependencyId, { override_reason: reason }) {
  await tx(async (client) => {
    const row = await planned(client, id, scope);
    const edge = await repo.dependency(client, id, dependencyId);
    if (!edge) throw new AppError("NOT_FOUND", "That link does not exist", 404);
    if (edge.overridden_at) return;
    await repo.overrideDependency(client, dependencyId, { by: actor.user_id, reason });
    await noted(client, actor, row, {
      kind: "waiting_overridden",
      detail: [edge.other_number, reason].filter(Boolean).join(": "),
      key: EVENTS.TASK_WAITING_CHANGED,
    });
  });
  return getFor(id, scope, actor);
}

/**
 * Watch a task. Anyone who can see it watches it themselves; naming someone else is for its
 * assignee or the person who set it, and that person must be on the staff and able to see it.
 */
async function watch(actor, scope, id, { employee_id: who }) {
  const employeeId = who || actor.employee_id;
  if (!employeeId) throw new AppError("FORBIDDEN", "Only an employee can watch a task", 403);
  await tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const row = await visible(client, id, scope);
    if (employeeId !== actor.employee_id) {
      if (!mayPlan(scope, row))
        throw new AppError("FORBIDDEN", "Only its assignee or the person who set it can add watchers", 403);
      if (!(await repo.employeeActive(client, employeeId))) throw invalid("employee_id", "Not on the staff");
      if (!(await whoMaySee(client, row, [employeeId])).length) throw invalid("employee_id", "Cannot see this task");
    }
    if ((await repo.watcherIds(client, id)).length >= repo.PLAN_MAX)
      throw conflict("TOO_MANY_WATCHERS", `A task has at most ${repo.PLAN_MAX} watchers`);
    if (await repo.addWatcher(client, { task_id: id, employee_id: employeeId, created_by: actor.user_id }))
      await noted(client, actor, row, {
        kind: "watcher_added",
        key: EVENTS.TASK_WATCHERS_CHANGED,
        extra: { watcher_employee_id: employeeId },
      });
  });
  return getFor(id, scope, actor);
}

/** Stop watching: oneself always; someone else, for the assignee or the setter. */
async function unwatch(actor, scope, id, employeeId) {
  await tx(async (client) => {
    if (!(await repo.lock(client, id))) throw notFound();
    const row = await visible(client, id, scope);
    if (employeeId !== actor.employee_id && !mayPlan(scope, row))
      throw new AppError("FORBIDDEN", "Only its assignee or the person who set it can remove watchers", 403);
    if (await repo.removeWatcher(client, id, employeeId))
      await noted(client, actor, row, {
        kind: "watcher_removed",
        key: EVENTS.TASK_WATCHERS_CHANGED,
        extra: { watcher_employee_id: employeeId },
      });
  });
  return getFor(id, scope, actor);
}

/** A nudge with a line of text, to the assignee, the watchers or both. Never to the sender. */
async function ping(actor, scope, id, { message, to }) {
  return tx(async (client) => {
    const row = await visible(client, id, scope);
    if (row.status === "cancelled") throw new AppError("TASK_CANCELLED", "This task was cancelled", 409);
    const watchers = to === "assignee" ? [] : await whoMaySee(client, row, await repo.watcherIds(client, id));
    const onIt = [row.primary_assignee_id, ...(row.members || []).map((p) => p.employee_id)];
    const told = [...(to === "watchers" ? [] : onIt), ...watchers]
      .filter((p) => p && p !== actor.employee_id);
    if (!told.length) throw invalid("to", "Nobody else to tell");
    await noted(client, actor, row, {
      kind: "pinged",
      detail: message.slice(0, 140),
      key: EVENTS.TASK_PINGED,
      extra: { ping_employee_ids: [...new Set(told)], message: message.slice(0, 280), sender_name: actor.display_name || null },
    });
    return toTask(row);
  });
}

/** When a reminder fires: minutes before the due time, or the time itself. */
function reminderAt(r, dueAt) {
  if (r.remind_at) return new Date(r.remind_at);
  if (!dueAt) return null;
  return new Date(new Date(dueAt).getTime() - r.minutes_before * 60_000);
}

/** Replace a task's reminders to its assignee (up to three). A lead time needs a due time. */
async function setReminders(actor, scope, id, { reminders: wanted }) {
  await tx(async (client) => {
    const row = await planned(client, id, scope);
    if (["done", "cancelled"].includes(row.status)) throw new AppError("TASK_CLOSED", "This task is closed", 409);
    const now = new Date();
    const times = wanted.map((r, i) => {
      const at = reminderAt(r, row.due_at);
      if (!at) throw invalid(`reminders.${i}.minutes_before`, "Give the task a due date");
      if (at <= now) throw invalid(`reminders.${i}`, "That time has passed");
      return { at, minutes: r.minutes_before ?? null };
    });
    await reminders.cancel(client, { key: REMINDER_KEY, entity: { type: "task", id } });
    for (const [i, t] of times.entries()) {
      await reminders.schedule(client, {
        key: REMINDER_KEY,
        entity: { type: "task", id },
        occurrence: String(i + 1),
        at: t.at,
        payload: { minutes_before: t.minutes },
      });
    }
    await noted(client, actor, row, {
      kind: "reminders_set",
      detail: times.length ? `${times.length} reminder${times.length === 1 ? "" : "s"}` : "none",
      key: EVENTS.TASK_EDITED,
    });
  });
  return getFor(id, scope, actor);
}

/** The due time moved: lead-time reminders move with it; fixed ones stay where they were. */
async function followDue(client, id, dueAt) {
  const pending = await reminders.pendingFor(client, { key: REMINDER_KEY, entity: { type: "task", id } });
  for (const r of pending) {
    const minutes = r.payload && Number.isInteger(r.payload.minutes_before) ? r.payload.minutes_before : null;
    if (minutes === null) continue;
    const at = dueAt ? new Date(new Date(dueAt).getTime() - minutes * 60_000) : null;
    if (!at || at <= new Date()) {
      await reminders.cancel(client, { key: REMINDER_KEY, entity: { type: "task", id }, occurrence: r.occurrence });
    } else {
      await reminders.schedule(client, {
        key: REMINDER_KEY,
        entity: { type: "task", id },
        occurrence: r.occurrence,
        at,
        payload: { minutes_before: minutes },
      });
    }
  }
}

/** The reminder engine's check before a task reminder fires: an open task only. */
async function reminderCheck(client, row) {
  const t = await repo.get(client, row.entity_id);
  if (!t || ["done", "cancelled"].includes(t.status) || t.archived_at) return null;
  return {
    entity: { type: "task", id: t.task_id },
    payload: { ...payloadOf(t), due_at: iso(t.due_at) },
  };
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
    let day = recurrence.nextDay(t.recurrence, lastDay, cal);
    // A sweep after that day's due time would make the next task late at birth, and the sweep after
    // would repeat it again: it comes round on the following day of the rule instead.
    while (new Date(recurrence.dueInstant(day, cal)) <= now) day = recurrence.nextDay(t.recurrence, day, cal);
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
      project_id: t.project_id || null,
      recurrence: t.recurrence,
      sort_order: await repo.nextOrder(client, t.primary_assignee_id, "todo"),
    });
    await client.query("UPDATE task SET parent_task_id = $2 WHERE task_id = $1", [childId, id]);
    await repo.copyMembers(client, id, childId);
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
  people,
  linkCommitments,
  fixOriginalDates,
  askRescope,
  settleRescope,
  cancelForRecord,
  toTask,
  toRef,
  whoMaySee,
  windows,
  list,
  summary,
  getFor,
  blockageHistory,
  countsTowards,
  doneTowards,
  comments,
  activity,
  addStep,
  editStep,
  removeStep,
  addWaiting,
  removeWaiting,
  overrideWaiting,
  watch,
  unwatch,
  ping,
  setReminders,
  reminderCheck,
  create,
  edit,
  move,
  block,
  unblock,
  cancel,
  comment,
  sweep,
};
