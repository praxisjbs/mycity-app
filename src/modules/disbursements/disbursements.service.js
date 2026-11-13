"use strict";
/**
 * Disbursements: the one write path for the transfer that pays one authorised request
 * (docs/guides/expenses.md §3 step 6, §6.5).
 *
 *   create()        Record Disbursement: one per request, only for an `authorised` one, by an
 *                   `expenses.finance` holder. The amount is the request's, and the payee and bank
 *                   details are copied from it. The bank's transaction reference, or a receipt, is
 *                   asked for: with neither the API answers 422 REFERENCE_REQUIRED unless
 *                   `confirm_without_reference` (the screen's Save Without Reference?) is true, and
 *                   the transfer is then Reference Missing. The request moves to `disbursed`.
 *   addReference()  Add Reference on a transfer saved without one.
 *
 * Nothing in the database refuses a transfer without a reference (decision 2 of 04/11/2026).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const routeMap = require("../../shared/route-map");
const m = require("../../shared/money/money");
const { holdsCapability } = require("../../middleware/rbac");
const expenses = require("../expenses/expenses.service");
const expensesRepo = require("../expenses/expenses.repo");
const repo = require("./disbursements.repo");
const { EVENTS, RECEIPT_DOC_TYPE } = require("./disbursements.events");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That disbursement does not exist", 404, { disbursement_id: ["No such disbursement"] });

const list = (query, scope) => repo.list(pool, query, scope);

/** A payee type as New Request's form names it. */
const PAYEE_WORDS = Object.freeze({ staff: "Staff", vendor: "Vendor", partner: "Partner", task_team: "Dedicated Task Team" });
const DIM_WORDS = Object.freeze({ category: "category", department: "department", payee_type: "payee type" });
const BUCKET_WORDS = Object.freeze({ day: "day", week: "week", month: "month" });

/**
 * The transfers in figures for the assistant (docs/guides/praxis-ai.md §6.13, Finance and pay), for a
 * holder of `expenses.finance` as the screen shows them, within their `expenses` scope: those paid in the
 * period (this Lagos month to today unless asked), by category, department or payee type, amount paid
 * by day, week or month, and what is authorised and still to pay. Anyone else is given no figures.
 * @param {{query: Function}} client
 * @param {object} params  DisbursementSummaryQuery, parsed
 * @param {object} actor   the asking person with their `expenses` scope
 */
async function aiSummary(client, params, actor, now = new Date()) {
  if (!(await holdsCapability(actor, "expenses.finance"))) return { figures: [], groups: [], series: [], total: 0 };
  const { figure, group, series, periodOf } = require("../../shared/ai/summary");
  const dim = DIM_WORDS[params.by] ? params.by : "category";
  const bucket = BUCKET_WORDS[params.by] ? params.by : "month";
  const r = await repo.aiSummary(client, { reference_missing: params.reference_missing, ...periodOf(params, now), dim, bucket }, actor.scope);
  const f = r.figures;
  const average = f.average_days === null || f.average_days === undefined ? 0 : Number(f.average_days);
  return {
    figures: [
      figure("payments", "Payments", f.payments || 0),
      figure("paid", "Amount paid", m.toWire(f.paid || "0.00"), "ngn"),
      figure("reference_missing", "Reference missing", f.reference_missing || 0),
      figure("to_pay", "Authorised, not yet paid", r.waiting.n || 0),
      figure("to_pay_amount", "Amount to pay", m.toWire(r.waiting.amount || "0.00"), "ngn"),
      figure("average_days", "Days from authorised to paid", average, "days"),
    ],
    groups: [
      group(
        dim,
        `Amount paid by ${DIM_WORDS[dim]}`,
        r.by_dim.map((x) => ({ ...x, label: dim === "payee_type" ? PAYEE_WORDS[x.label] || x.label : x.label, value: m.toWire(x.value) })),
      ),
    ],
    series: [series("paid", `Amount paid by ${BUCKET_WORDS[bucket]}`, r.points.map((p) => ({ at: p.at, value: m.toWire(p.value) })))],
    total: f.payments || 0,
  };
}

/** One disbursement within the reader's scope; the requester's id beside it for the controller's mask. */
async function getFor(scope, id) {
  const row = await repo.get(pool, id);
  if (!row || !(scope.scope === "all" || (scope.scope_ids || []).includes(row.employee_id))) throw notFound();
  return row;
}

/** What only the service reads, taken off before a disbursement leaves. */
const publicRow = ({ employee_id: _e, receipt_document_id: _r, ...out }) => out;

async function claimReceipt(client, disbursement, requesterId, actor) {
  if (!disbursement.receipt_document_id) return;
  await vault.claim(client, {
    document_id: disbursement.receipt_document_id,
    doc_type: RECEIPT_DOC_TYPE,
    entity: { type: "disbursement", id: disbursement.disbursement_id },
    subject_employee_id: requesterId,
    actor,
    field: "receipt_document_id",
  });
}

/** Record Disbursement. */
async function create(actor, body) {
  if (!body.payment_reference && !body.receipt_document_id && body.confirm_without_reference !== true)
    throw new AppError("REFERENCE_REQUIRED", "Add the bank reference, or save without one", 422, { payment_reference: ["Add the reference"] });
  if (body.paid_on > lagos.today())
    throw new AppError("PAID_IN_FUTURE", "Pick the day it was paid", 422, { paid_on: ["Not yet"] });
  const id = await tx(async (client) => {
    const request = await expenses.lockPayable(client, body.expense_request_id);
    const { number } = await numbering.allocate(client, "disbursement");
    let row;
    try {
      row = await repo.insert(client, {
        number,
        expense_request_id: request.expense_request_id,
        requisition_id: request.requisition_id,
        recipient_type: request.payee_type,
        recipient_name: request.payee_name,
        bank_name: request.bank_name,
        account_name: request.account_name,
        account_number: request.account_number,
        amount: request.amount,
        payment_reference: body.payment_reference || null,
        receipt_document_id: body.receipt_document_id || null,
        paid_on: body.paid_on,
        processed_by: actor.user_id || null,
      });
    } catch (err) {
      if (err.code === "23505") throw new AppError("ALREADY_DISBURSED", "This request is already paid", 409, { expense_request_id: ["Already paid"] });
      throw err;
    }
    await claimReceipt(client, row, request.employee_id, actor);
    await expenses.markDisbursedIn(client, request.expense_request_id);
    await emit(client, {
      key: EVENTS.DISBURSEMENT_RECORDED,
      entity: { type: "disbursement", id: row.disbursement_id },
      actor,
      after: row,
      payload: {
        disbursement_id: row.disbursement_id,
        number,
        expense_request_id: request.expense_request_id,
        request_number: request.number,
        purpose: request.purpose,
        amount: request.amount,
        reference_missing: !row.payment_reference,
        employee_id: request.employee_id,
        subject_employee_id: request.employee_id,
      },
    });
    return row.disbursement_id;
  });
  return repo.get(pool, id).then(publicRow);
}

/** Add Reference, on a transfer saved without one. */
async function addReference(actor, scope, id, body) {
  await getFor(scope, id);
  await tx(async (client) => {
    const before = await repo.lock(client, id);
    if (!before) throw notFound();
    if (before.payment_reference) throw new AppError("REFERENCE_SET", "This transfer already has its reference", 409, { payment_reference: ["Already added"] });
    const request = await expensesRepo.get(client, before.expense_request_id);
    const after = await repo.addReference(client, id, body.payment_reference, body.receipt_document_id);
    if (!after) throw new AppError("REFERENCE_SET", "This transfer already has its reference", 409, { payment_reference: ["Already added"] });
    if (body.receipt_document_id && body.receipt_document_id !== before.receipt_document_id) await claimReceipt(client, after, request.employee_id, actor);
    await emit(client, {
      key: EVENTS.DISBURSEMENT_REFERENCE_ADDED,
      entity: { type: "disbursement", id },
      actor,
      before: { payment_reference: null },
      after: { payment_reference: after.payment_reference },
      payload: { disbursement_id: id, number: before.number, expense_request_id: before.expense_request_id },
    });
  });
  return publicRow(await repo.get(pool, id));
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11): Record Disbursement and Add Reference.
 * Nothing here writes.
 * ------------------------------------------------------------------ */

const linkOf = (id) => (routeMap.linkFor("disbursement", id) || {}).path || null;

/** The request a Record Disbursement card pays, by number and purpose. */
async function cardRequest(db, id) {
  const row = db && UUID.test(String(id || "")) ? await expensesRepo.get(db, id) : null;
  return row && row.status !== "draft" ? [{ type: "expense", id, label: `${row.number}, ${row.purpose}` }] : [];
}

/** The receipt a Record Disbursement card carries, by its file's name, when it is the person's own upload. */
async function cardNames(db, values, actor) {
  const name = await expenses.fileName(db, values.receipt_document_id, actor);
  return name ? [{ type: "document", id: values.receipt_document_id, label: name }] : [];
}

/** Record Disbursement's re-check: the request is authorised and not paid. */
async function assertCardPayable(db, id) {
  const row = UUID.test(String(id || "")) ? await expensesRepo.get(db, id) : null;
  if (!row || row.status !== "authorised")
    throw new AppError("REQUEST_NOT_AUTHORISED", "Only a request the CEO authorised is paid", 422, { expense_request_id: ["Not authorised yet"] });
}

/** The disbursement an Add Reference card names, by its number and its request's. */
async function cardDisbursement(db, id) {
  const row = db && UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  return row ? [{ type: "disbursement", id, label: `${row.number}, ${row.request_number}` }] : [];
}

/** Add Reference's re-check: the transfer is in the reader's reach and still has no reference. */
async function assertCardMissing(db, id, actor) {
  const row = UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  if (!row || !(actor.scope.scope === "all" || (actor.scope.scope_ids || []).includes(row.employee_id))) throw notFound();
  if (!row.reference_missing) throw new AppError("REFERENCE_SET", "This transfer already has its reference", 409, { payment_reference: ["Already added"] });
}

const readback = (status) => (r) => [{ type: "disbursement", id: r.disbursement_id, label: `${r.number}, ${r.request_number}`, status: r.reference_missing ? "recorded, reference missing" : status, link: linkOf(r.disbursement_id) }];

module.exports = { list, aiSummary, getFor, publicRow, create, addReference, cardRequest, cardNames, assertCardPayable, cardDisbursement, assertCardMissing, readback };
