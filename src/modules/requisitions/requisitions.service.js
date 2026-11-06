"use strict";
/**
 * Requisitions: the one write path for Operations & People's batch of approved requests for the
 * CEO (docs/guides/expenses.md §3 steps 4 and 5, §6.4).
 *
 *   create()    Create Requisition: 1 to 25 approved requests not yet grouped, by an
 *               `expenses.finance` holder; each moves to `in_requisition` and the requisition
 *               opens `expenses.requisition` (the CEO) in the same transaction
 *   remove()    the CEO takes one request out before deciding, with a reason: it returns to
 *               `approved` and the total is counted again; an emptied requisition is cancelled
 *   settle()    after commit, the CEO's decision copied onto the requisition and every request in
 *               it: `authorised` on approval, back to `approved` (and out of it) on rejection
 *   recountIn() its total counted again in the caller's transaction, after a request left it
 *               (removed, or withdrawn by an `expenses.finance` holder)
 *
 * The requests themselves are written by the expenses module alone (expenses.service).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const m = require("../../shared/money/money");
const engine = require("../../shared/workflow/engine");
const approvers = require("../../shared/workflow/approvers");
const routeMap = require("../../shared/route-map");
const expenses = require("../expenses/expenses.service");
const expensesRepo = require("../expenses/expenses.repo");
const repo = require("./requisitions.repo");
const { EVENTS, DEFINITION_KEY } = require("./requisitions.events");

const ALL = Object.freeze({ scope: "all", scope_ids: null });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That requisition does not exist", 404, { requisition_id: ["No such requisition"] });

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const list = (query, user) => repo.list(pool, query, user);

/** One requisition with its requests (25 at most: a requisition is made of 25 at most). */
async function get(user, id) {
  const row = await repo.get(pool, id, user);
  if (!row) throw notFound();
  const items = await expensesRepo.list(pool, { requisition_id: id, page: 1, sort: { field: "number", dir: "asc" } }, ALL);
  return { ...row, items: items.data };
}

/* ------------------------------------------------------------------ *
 * Grouping and removing
 * ------------------------------------------------------------------ */

/** Create Requisition. */
async function create(actor, body) {
  if (!actor.employee_id) throw new AppError("NO_EMPLOYEE", "Only staff group requests", 403);
  const ids = [...new Set(body.expense_request_ids)];
  const id = await tx(async (client) => {
    const rows = await expenses.lockGroupable(client, ids);
    const total = m.toWire(m.sum(rows.map((r) => r.amount)));
    const { number } = await numbering.allocate(client, "requisition");
    const requisition = await repo.insert(client, { number, requester_id: actor.employee_id, total_amount: total });
    await expenses.groupIn(client, ids, requisition.requisition_id);
    await emit(client, {
      key: EVENTS.REQUISITION_SUBMITTED,
      entity: { type: "requisition", id: requisition.requisition_id },
      actor,
      after: requisition,
      payload: { requisition_id: requisition.requisition_id, number, total_amount: total, expense_request_ids: ids },
      metadata: { count: ids.length },
    });
    const instance = await engine.openInstance(client, {
      definition_key: DEFINITION_KEY,
      entity: { type: "requisition", id: requisition.requisition_id },
      subject_employee_id: null,
      context: { total },
      actor,
    });
    await repo.setWorkflow(client, requisition.requisition_id, instance.workflow_instance_id);
    return requisition.requisition_id;
  });
  return get(actor, id);
}

/** The pending approval of a requisition still with the CEO, locked; refused when it was decided. */
async function pendingOf(client, requisition) {
  if (requisition.status !== "submitted") throw new AppError("REQUISITION_DECIDED", "This requisition was already decided", 409);
  const instance = await engine.findOpenInstance(client, { type: "requisition", id: requisition.requisition_id });
  if (!instance) throw new AppError("REQUISITION_DECIDED", "This requisition was already decided", 409);
  return instance;
}

/**
 * Count a requisition's total again after a request left it, in the caller's transaction. With no
 * request left it is cancelled and its approval withdrawn for whoever grouped it.
 */
async function recountIn(client, id, actor) {
  const requisition = await repo.lock(client, id);
  if (!requisition || requisition.status !== "submitted") return;
  const { n, total } = await expenses.requisitionTotalIn(client, id);
  if (n > 0) {
    await repo.setTotal(client, id, total);
    return;
  }
  const instance = await engine.findOpenInstance(client, { type: "requisition", id });
  if (instance) await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: "No request left in it" });
  await repo.setTotal(client, id, "0.00");
  if (!(await repo.settle(client, id, "cancelled"))) return;
  await emit(client, {
    key: EVENTS.REQUISITION_CANCELLED,
    entity: { type: "requisition", id },
    actor,
    before: { status: "submitted" },
    after: { status: "cancelled" },
    payload: { requisition_id: id, number: requisition.number },
  });
}

/** The CEO (whoever the requisition's stage names) takes a request out of it before deciding. */
async function remove(actor, id, body) {
  await tx(async (client) => {
    const requisition = await repo.lock(client, id);
    if (!requisition) throw notFound();
    const instance = await pendingOf(client, requisition);
    if (!(await approvers.canAct(client, instance.stage_approvers, actor, instance)))
      throw new AppError("PERMISSION_DENIED", "Only the requisition's approver removes a request", 403);
    const request = await expenses.removeFromRequisitionIn(client, id, body.expense_request_id);
    const groupedBy = await repo.userOfEmployee(client, requisition.requester_id);
    await emit(client, {
      key: EVENTS.REQUISITION_REQUEST_REMOVED,
      entity: { type: "requisition", id },
      actor,
      payload: {
        requisition_id: id,
        number: requisition.number,
        expense_request_id: request.expense_request_id,
        request_number: request.number,
        employee_id: request.employee_id,
        subject_employee_id: request.employee_id,
        grouped_by: groupedBy,
        reason: body.reason,
      },
    });
    await recountIn(client, id, actor);
  });
  return get(actor, id);
}

/* ------------------------------------------------------------------ *
 * After the CEO decides (requisitions.events.js)
 * ------------------------------------------------------------------ */

const OUTCOME = Object.freeze({
  approved: { status: "approved", requests: "authorised", key: () => EVENTS.REQUISITION_APPROVED },
  timeout_approved: { status: "approved", requests: "authorised", key: () => EVENTS.REQUISITION_APPROVED },
  rejected: { status: "rejected", requests: "approved", key: () => EVENTS.REQUISITION_REJECTED },
  timeout_rejected: { status: "rejected", requests: "approved", key: () => EVENTS.REQUISITION_REJECTED },
  cancelled: { status: "cancelled", requests: "approved", key: () => EVENTS.REQUISITION_CANCELLED },
});

/**
 * Copy the CEO's decision onto the requisition and every request still in it. Runs after commit,
 * at least once: only a requisition still `submitted` moves.
 */
async function settle(id, state) {
  const outcome = OUTCOME[state];
  if (!outcome) return null;
  return tx(async (client) => {
    const requisition = await repo.lock(client, id);
    if (!requisition || requisition.status !== "submitted") return null;
    const moved = await repo.settle(client, id, outcome.status);
    if (!moved) return null;
    const requests = await expenses.settleRequisitionIn(client, id, outcome.requests);
    await emit(client, {
      key: outcome.key(),
      entity: { type: "requisition", id },
      actor: null,
      before: { status: "submitted" },
      after: { status: outcome.status },
      payload: { requisition_id: id, number: requisition.number, expense_request_ids: requests.map((r) => r.expense_request_id) },
      metadata: { count: requests.length },
    });
    return outcome.status;
  });
}

/* ------------------------------------------------------------------ *
 * Praxis AI's card (docs/guides/praxis-ai.md §6.11): Create Requisition. Nothing here writes.
 * ------------------------------------------------------------------ */

/** The requests a card names: number and purpose for each in reach, the id alone otherwise. */
async function cardRequests(db, ids) {
  const out = [];
  for (const id of [...new Set(ids || [])].slice(0, 25)) {
    const row = db && UUID.test(String(id)) ? await expensesRepo.get(db, id) : null;
    out.push({ type: "expense", id, label: row && row.status !== "draft" ? `${row.number}, ${row.purpose}` : null });
  }
  return out;
}

/** Create Requisition's re-check: every request is approved and in no requisition yet. */
async function assertCardRequests(db, ids) {
  for (const id of [...new Set(ids || [])]) {
    const row = UUID.test(String(id)) ? await expensesRepo.get(db, id) : null;
    if (!row || row.status !== "approved" || row.requisition_id)
      throw new AppError("REQUEST_NOT_APPROVED", "Only approved requests not in a requisition are grouped", 409, { expense_request_ids: ["Not waiting for a requisition"] });
  }
}

const readback = (r) => [{ type: "requisition", id: r.requisition_id, label: `${r.number}, ${r.requests} ${r.requests === 1 ? "request" : "requests"}`, status: "sent to the CEO", link: (routeMap.linkFor("requisition", r.requisition_id) || {}).path || null }];

module.exports = { list, get, create, remove, recountIn, settle, cardRequests, assertCardRequests, readback };
