"use strict";
/**
 * Leave: the one write path for a leave request and a leave type (docs/guides/ess.md
 * §3 step 5, §6; docs/guides/foundation.md §6.5).
 *
 * Three ways a request arrives, one set of checks:
 *
 *   request()   the employee asks, from My Leave (/ess/leave). It is saved as
 *               `submitted` and opens the `leave.approval` flow in the same
 *               transaction: the line manager, then Operations & People over 5 days.
 *   record()    People record leave for someone (People · Leave, Record Leave). It is
 *               approved at once, with no flow; who recorded it is kept on the row.
 *   settle()    after commit, an approval's outcome is copied onto the request
 *               (leave.events.js). Idempotent: it changes only a request still waiting.
 *
 * Every request is refused when it ends before it starts, crosses New Year, has no
 * working day in it, overlaps a request already waiting or granted, or would take the
 * year past the type's allowance (leave.balance.js). Two requests from one person are
 * checked one after the other (an advisory lock per person), so both cannot pass.
 *
 * An employee cancels their own request while it waits (the approval is withdrawn with
 * it) or once granted until it starts. People cancel granted leave until it ends; a
 * waiting request is theirs to decide in My Approvals instead.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const grantsCache = require("../../shared/rbac/grants-cache");
const { assertInScope } = require("../../shared/rbac/scope");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const engine = require("../../shared/workflow/engine");
const repo = require("./leave.repo");
const rules = require("./leave.balance");
const { clashesOf } = require("./leave.clash");
const { EVENTS, DEFINITION_KEY } = require("./leave.events");

/** Leave types a year can show at once (LeaveBalances holds at most 25). */
const MAX_ACTIVE_TYPES = 25;

const ALL = Object.freeze({ scope: "all", scope_ids: null });

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That leave request does not exist", 404);

/** The facts every leave event carries, for the audit line and the notifications. */
const payloadOf = (row, type) => ({
  leave_request_id: row.leave_request_id,
  employee_id: row.employee_id,
  subject_employee_id: row.employee_id,
  leave_type_name: type ? type.name : row.leave_type_name,
  starts_on: row.starts_on,
  ends_on: row.ends_on,
  days: Number(row.amount !== undefined ? row.amount : row.days), // @money:ok working days, not an amount
});

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** People's list, within the caller's scope; `live` keeps the waiting and approved (the Leave Calendar). */
const list = ({ live, ...query }, scope) => repo.list(pool, { ...query, ...(live && { statuses: ["approved", "submitted"] }) }, scope);

/** One request People may see. */
/** Statuses as the list reads them, for the assistant's summary. */
const STATUS_WORDS = Object.freeze({ submitted: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", draft: "Draft" });

/**
 * The assistant's leave summary (docs/guides/praxis-ai.md §6.13; ess.md §9): this year in Lagos unless a
 * period or a year is asked, within the reader's `people` scope; figures, never a row. Runs on the
 * client the assistant hands over, inside its read timeout.
 * @param {{query: Function}} client
 * @param {object} params   LeaveSummaryQuery, parsed
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function aiSummary(client, params, scope, now = new Date()) {
  const { figure, group, series } = require("../../shared/ai/summary");
  const today = lagos.today(now);
  const year = !params.from && !params.to && !params.year ? Number(today.slice(0, 4)) : params.year || null;
  const r = await repo.aiSummary(client, { ...params, year, today }, scope);
  const f = r.figures || {};
  const by = params.by || "status";
  const figures = [
    figure("requests", "Requests", f.requests),
    figure("waiting", "Waiting", f.waiting),
    figure("approved", "Approved", f.approved),
    figure("rejected", "Rejected", f.rejected),
    figure("cancelled", "Cancelled", f.cancelled),
    figure("days_approved", "Days approved", f.days_approved, "days"),
    figure("days_taken", "Days taken", f.days_taken, "days"),
    figure("days_booked", "Days booked ahead", f.days_booked, "days"),
    figure("days_waiting", "Days waiting", f.days_waiting, "days"),
    figure("people", "People with approved leave", f.people),
    figure("on_leave_today", "On leave today", f.on_leave_today),
  ];
  const groups = [
    group("status", "Requests by status", r.by_status.map((x) => ({ ...x, label: STATUS_WORDS[x.label] || x.label }))),
    group("type", "Days approved by type", r.by_type),
  ];
  if (r.series)
    return {
      figures,
      groups,
      series: [
        series("days_approved", "Days approved by month", r.points.map((p) => ({ at: p.at, value: p.days }))),
        series("requests", "Requests by month", r.points.map((p) => ({ at: p.at, value: p.requests }))),
      ],
      total: f.requests || 0,
    };
  if (by === "person" || by === "department") groups.push(group(by, `Days approved by ${by}`, r.by_dim));
  return { figures, groups, series: [], total: f.requests || 0 };
}

async function getFor(id, scope) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  return repo.publicRow(row);
}

const summary = (scope) => repo.summary(pool, lagos.today(), scope);

const clashes = (id, query, scope) => clashesOf(id, query, scope);

/** One person's requests (My Leave). The person is the caller; nothing names another. */
const listFor = (employeeId, query) =>
  repo.list(pool, { ...query, employee_id: employeeId }, ALL);

/**
 * Whose leave the calendar on My Leave shows (the team lead, 18/10/2026): the CEO and People
 * with scope all (Operations & People) see everyone; anyone else sees their own and everyone
 * under them in the reporting tree, which for most staff is their own alone.
 */
async function calendarScope(user, employeeId) {
  const people = await scopeFor(user, "people", "view");
  if (people && people.scope === "all") return { scope: "all", scope_ids: null, employee_id: employeeId };
  return {
    scope: "team",
    scope_ids: await grantsCache.getTeamEmployeeIds(pool, employeeId),
    employee_id: employeeId,
  };
}

/** The leave calendar: approved and waiting leave touching one month, within calendarScope. */
async function calendarFor(user, employeeId, query) {
  const month = query.month || lagos.today().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return repo.list(
    pool,
    { ...query, from: `${month}-01`, to: last, statuses: ["approved", "submitted"] },
    await calendarScope(user, employeeId),
  );
}

/** One of the caller's own requests, or a 404 when it is someone else's. */
async function getOwn(employeeId, id) {
  const row = await repo.get(pool, id);
  if (!row || row.employee_id !== employeeId) throw notFound();
  return repo.publicRow(row);
}

/** One person's year, every active type. */
async function balancesFor(employeeId, year) {
  const y = year || Number(lagos.today().slice(0, 4));
  return { year: y, balances: await repo.balances(pool, employeeId, y, lagos.today()) };
}

/** One person's year, for People within their scope. */
async function balancesOf(scope, employeeId, year) {
  assertInScope(scope, employeeId);
  return balancesFor(employeeId, year);
}

/** People set one person's allowance of one type for one year (null: the type's figure). */
async function setAllowance(actor, scope, body) {
  assertInScope(scope, body.employee_id);
  const person = await repo.employeeOf(pool, body.employee_id);
  if (!person) throw new AppError("NOT_FOUND", "That employee does not exist", 404);
  const type = await repo.getType(pool, body.leave_type_id);
  if (!type)
    throw new AppError("LEAVE_TYPE_UNAVAILABLE", "Pick a leave type that exists", 422, {
      leave_type_id: ["Not a type"],
    });
  await tx(async (client) => {
    const before = await repo.setAllowance(client, body);
    await emit(client, {
      key: EVENTS.LEAVE_BALANCE_SET,
      entity: { type: "employee", id: body.employee_id },
      actor,
      before: { days: before },
      after: { days: body.days },
      payload: {
        employee_id: body.employee_id,
        subject_employee_id: body.employee_id,
        leave_type_name: type.name,
        year: body.year,
        days: body.days,
      },
    });
  });
  return balancesFor(body.employee_id, body.year);
}

/* ------------------------------------------------------------------ *
 * Requesting and recording
 * ------------------------------------------------------------------ */

/** The type a request names: it must exist and be offered. */
async function activeType(db, leaveTypeId) {
  const type = await repo.getType(db, leaveTypeId);
  if (!type || !type.active)
    throw new AppError("LEAVE_TYPE_UNAVAILABLE", "Pick a leave type that is offered", 422, {
      leave_type_id: ["Not offered"],
    });
  return type;
}

/**
 * Every check a request must pass, on the transaction's client after the person's lock.
 * @returns {Promise<number>} its length in working days
 */
async function checked(client, employeeId, body, type, own = true) {
  const days = rules.daysOf(body.starts_on, body.ends_on, await workingWeek.loadCalendar(client));
  const clash = await repo.overlapping(client, employeeId, body.starts_on, body.ends_on);
  if (clash)
    throw new AppError(
      "LEAVE_OVERLAP",
      own ? "You already have leave on some of those days" : "They already have leave on some of those days",
      409,
      { starts_on: ["Overlaps other leave"] },
    );
  const year = Number(body.starts_on.slice(0, 4));
  const balance = (await repo.balances(client, employeeId, year, lagos.today())).find(
    (b) => b.leave_type_id === type.leave_type_id,
  );
  rules.assertWithinAllowance(balance, days);
  return days;
}

/** The employee asks for leave. Opens the approval in the same transaction. */
async function request(user, employeeId, body) {
  if (body.starts_on < lagos.today())
    throw new AppError("LEAVE_IN_THE_PAST", "Pick a first day from today on", 422, {
      starts_on: ["Already past"],
    });
  const id = await tx(async (client) => {
    const type = await activeType(client, body.leave_type_id);
    await repo.lockEmployee(client, employeeId);
    const days = await checked(client, employeeId, body, type);
    const row = await repo.insertRequest(client, {
      employee_id: employeeId,
      leave_type_id: type.leave_type_id,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      amount: days,
      reason: body.reason,
      status: "submitted",
    });
    await emit(client, {
      key: EVENTS.LEAVE_REQUEST_SUBMITTED,
      entity: { type: "leave_request", id: row.leave_request_id },
      actor: user,
      after: row,
      payload: payloadOf(row, type),
    });
    const instance = await engine.openInstance(client, {
      definition_key: DEFINITION_KEY,
      entity: { type: "leave_request", id: row.leave_request_id },
      subject_employee_id: employeeId,
      context: { days },
      actor: user,
    });
    await repo.setWorkflow(client, row.leave_request_id, instance.workflow_instance_id);
    return row.leave_request_id;
  });
  return getOwn(employeeId, id);
}

/** People record leave for someone in their scope. Approved at once, no flow. */
async function record(actor, scope, body) {
  assertInScope(scope, body.employee_id);
  const person = await repo.employeeOf(pool, body.employee_id);
  if (!person || person.status !== "active")
    throw new AppError("EMPLOYEE_NOT_ACTIVE", "Pick someone who works here now", 422, {
      employee_id: ["Not active"],
    });
  const id = await tx(async (client) => {
    const type = await activeType(client, body.leave_type_id);
    await repo.lockEmployee(client, body.employee_id);
    const days = await checked(client, body.employee_id, body, type, false);
    const row = await repo.insertRequest(client, {
      employee_id: body.employee_id,
      leave_type_id: type.leave_type_id,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      amount: days,
      reason: body.reason,
      status: "approved",
      recorded_by: actor.user_id,
    });
    await emit(client, {
      key: EVENTS.LEAVE_REQUEST_RECORDED,
      entity: { type: "leave_request", id: row.leave_request_id },
      actor,
      after: row,
      payload: payloadOf(row, type),
    });
    return row.leave_request_id;
  });
  return getFor(id, scope);
}

/* ------------------------------------------------------------------ *
 * Cancelling
 * ------------------------------------------------------------------ */

async function cancelRow(client, row, actor, reason) {
  const done = await repo.cancel(client, row.leave_request_id);
  if (!done) throw new AppError("LEAVE_NOT_CANCELLABLE", "This leave can no longer be cancelled", 409);
  await emit(client, {
    key: EVENTS.LEAVE_REQUEST_CANCELLED,
    entity: { type: "leave_request", id: row.leave_request_id },
    actor,
    before: { status: row.status },
    after: { status: "cancelled" },
    payload: { ...payloadOf(row), reason: reason || null },
  });
}

/** The employee cancels their own request: while it waits, or once granted until it starts. */
async function cancelOwn(user, employeeId, id, body) {
  const row = await repo.get(pool, id);
  if (!row || row.employee_id !== employeeId) throw notFound();
  const waiting = row.status === "submitted";
  const notStarted = row.status === "approved" && row.starts_on > lagos.today();
  if (!waiting && !notStarted)
    throw new AppError("LEAVE_NOT_CANCELLABLE", "This leave can no longer be cancelled", 409);
  await tx(async (client) => {
    if (waiting && row.workflow_instance_id) {
      await engine.cancel(client, {
        instance_id: row.workflow_instance_id,
        actor: user,
        reason: body.reason || null,
      });
    }
    await cancelRow(client, row, user, body.reason);
  });
  return getOwn(employeeId, id);
}

/** People cancel granted leave, until it ends. A waiting request is decided in My Approvals. */
async function cancelFor(actor, scope, id, body) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  if (row.status === "submitted")
    throw new AppError(
      "LEAVE_AWAITING_APPROVAL",
      "Decide this request in My Approvals instead",
      409,
    );
  if (row.status !== "approved" || row.ends_on < lagos.today())
    throw new AppError("LEAVE_NOT_CANCELLABLE", "This leave can no longer be cancelled", 409);
  await tx((client) => cancelRow(client, row, actor, body.reason));
  return getFor(id, scope);
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11): the requests waiting on the person
 * approved or rejected together, each on its approval's current stage through the same call
 * People · Leave's Approve and Reject make (workflow.service.decide), never one's own.
 * ------------------------------------------------------------------ */

/** The approvals service, required late: it requires this module's events through the engine. */
const workflow = () => require("../workflow/workflow.service");

const requestLabel = (row) => `${row.employee && row.employee.display_name ? row.employee.display_name : "Someone"}, ${row.leave_type_name}, ${Number(row.days)} ${Number(row.days) === 1 ? "day" : "days"}`;

/**
 * The requests a card names, as the person may see them: who, the type and the days for each in
 * their scope; one outside it keeps its id alone, and the re-check refuses the card.
 */
async function cardRecords(db, ids, scope) {
  const out = [];
  for (const id of [...new Set(ids || [])].slice(0, 25)) {
    const row = await repo.get(db, id);
    const seen = row && (scope.scope === "all" || (scope.scope_ids || []).includes(row.employee_id));
    out.push({ type: "leave_request", id, label: seen ? requestLabel(row) : null });
  }
  return out;
}

/**
 * The card's re-check (§6.11 step 5): every request is one the person may see; the rest (waiting,
 * named on its stage, not their own) is each request's own line at the press.
 */
async function assertCardRequests(db, ids, actor) {
  for (const id of [...new Set(ids || [])]) {
    const row = await repo.get(db, id);
    if (!row || !(actor.scope.scope === "all" || (actor.scope.scope_ids || []).includes(row.employee_id)))
      throw new AppError("LEAVE_NOT_YOURS", "One of these requests is not in your scope", 404, { leave_request_ids: ["Not in your scope"] });
  }
}

/**
 * Approve or reject the requests a card names, one after another, each through its approval;
 * a request already decided, not waiting on this person, or their own is a line of its own and
 * the rest still go. Nothing decided is a refusal, so the card stays open with the reason.
 * @param {object} actor   the person, with the scope their `people` approve gives
 * @param {{leave_request_ids: string[], reason?: string}} values
 * @param {"approve"|"reject"} decision
 * @returns {Promise<{lines: Array<{type: string, id: string, label: string, ok: boolean, message: string|null}>}>}
 */
async function decideMany(actor, values, decision) {
  const lines = [];
  let firstRefusal = null;
  for (const id of [...new Set(values.leave_request_ids || [])]) {
    const row = await repo.get(pool, id);
    const label = row ? requestLabel(row) : id;
    try {
      if (!row) throw notFound();
      if (row.employee_id && actor.employee_id === row.employee_id) throw new AppError("SELF_APPROVAL", "Nobody decides their own request", 403);
      if (row.status !== "submitted" || !row.workflow_instance_id) throw new AppError("LEAVE_DECIDED", "This request was already decided", 409);
      await workflow().decide(actor, row.workflow_instance_id, decision, values.reason || null);
      lines.push({ type: "leave_request", id, label, ok: true, message: decision === "approve" ? "approved" : "rejected" });
    } catch (err) {
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      firstRefusal = firstRefusal || err;
      lines.push({ type: "leave_request", id, label, ok: false, message: err.message });
    }
  }
  if (lines.length && !lines.some((l) => l.ok)) throw firstRefusal;
  return { lines };
}

/* ------------------------------------------------------------------ *
 * After an approval ends
 * ------------------------------------------------------------------ */

const SETTLED_EVENT = {
  approved: EVENTS.LEAVE_REQUEST_APPROVED,
  rejected: EVENTS.LEAVE_REQUEST_REJECTED,
  cancelled: EVENTS.LEAVE_REQUEST_CANCELLED,
};

/**
 * Copy an approval's outcome onto its request. Runs after commit, at least once; a
 * request already settled (or one that does not exist) is left alone.
 * @param {string} id      the leave_request_id the approval is about
 * @param {string|null} status  approved, rejected or cancelled
 */
async function settle(id, status) {
  if (!SETTLED_EVENT[status]) return;
  await tx(async (client) => {
    const row = await repo.settle(client, id, status);
    if (!row) return;
    // The approval already told the person; this is the request's own audit line. A
    // withdrawal from My Leave was recorded there, so a second line is not written.
    if (status === "cancelled") return;
    await emit(client, {
      key: SETTLED_EVENT[status],
      entity: { type: "leave_request", id },
      actor: null,
      before: { status: "submitted" },
      after: { status },
      payload: { leave_request_id: id, employee_id: row.employee_id, subject_employee_id: row.employee_id },
    });
  });
}

/* ------------------------------------------------------------------ *
 * Leave types
 * ------------------------------------------------------------------ */

const listTypes = (query) => repo.listTypes(pool, query);

async function createType(actor, body) {
  if (await repo.typeByCode(pool, body.code))
    throw new AppError("LEAVE_TYPE_EXISTS", "A leave type already has this code", 409, {
      code: ["Already in use"],
    });
  if ((await repo.countActiveTypes(pool)) >= MAX_ACTIVE_TYPES)
    throw new AppError("LEAVE_TYPES_FULL", `Retire a type first: ${MAX_ACTIVE_TYPES} is the most offered at once`, 409);
  return tx(async (client) => {
    const type = await repo.insertType(client, body);
    await emit(client, {
      key: EVENTS.LEAVE_TYPE_CREATED,
      entity: { type: "leave_type", id: type.leave_type_id },
      actor,
      after: type,
    });
    return type;
  });
}

async function updateType(actor, id, patch) {
  const before = await repo.getType(pool, id);
  if (!before) throw new AppError("NOT_FOUND", "That leave type does not exist", 404);
  if (patch.active === true && !before.active && (await repo.countActiveTypes(pool)) >= MAX_ACTIVE_TYPES)
    throw new AppError("LEAVE_TYPES_FULL", `Retire a type first: ${MAX_ACTIVE_TYPES} is the most offered at once`, 409);
  return tx(async (client) => {
    const after = await repo.updateType(client, id, patch);
    await emit(client, {
      key: EVENTS.LEAVE_TYPE_UPDATED,
      entity: { type: "leave_type", id },
      actor,
      before,
      after,
    });
    return after;
  });
}

/**
 * Delete a type nothing has used. A type with requests or balances is part of their
 * history, so it is refused and People retire it instead (PATCH active: false).
 */
async function deleteType(actor, id) {
  const before = await repo.getType(pool, id);
  if (!before) throw new AppError("NOT_FOUND", "That leave type does not exist", 404);
  const inUse = () =>
    new AppError(
      "LEAVE_TYPE_IN_USE",
      "This type has leave on record. Retire it instead.",
      409,
    );
  if (await repo.typeInUse(pool, id)) throw inUse();
  await tx(async (client) => {
    if (!(await repo.deleteType(client, id))) throw inUse();
    await emit(client, {
      key: EVENTS.LEAVE_TYPE_DELETED,
      entity: { type: "leave_type", id },
      actor,
      before,
    });
  });
}

module.exports = {
  aiSummary,
  MAX_ACTIVE_TYPES,
  list,
  getFor,
  summary,
  clashes,
  listFor,
  calendarFor,
  calendarScope,
  getOwn,
  balancesFor,
  balancesOf,
  setAllowance,
  request,
  record,
  cancelOwn,
  cancelFor,
  cardRecords,
  assertCardRequests,
  decideMany,
  settle,
  listTypes,
  createType,
  updateType,
  deleteType,
};
