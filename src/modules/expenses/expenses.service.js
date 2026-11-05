"use strict";
/**
 * Expense requests: the one write path for a request (docs/guides/expenses.md §3 steps 1 to 3, §6.1
 * to §6.3).
 *
 *   create()      New Request: a draft, or sent at once with `submit`
 *   update()      Edit: the requester's own draft or sent-back request, every field sent again
 *   submit()      Send Request and Send Again: opens `expenses.request` in the same transaction
 *   cancelOwn()   Cancel Request: the requester, while a draft, sent back or with its approval
 *   withdraw()    an `expenses.finance` holder, with a reason, once approved and until it is paid
 *   settle()      after commit, the approval's outcome copied onto the request (expenses.events.js)
 *   sentBack()    after commit, an approver's Send Back returns the request to its requester
 *
 * A request's lines are worked out here: a line is quantity times unit price, rounded to the kobo
 * through shared/money; the request's amount is their sum. NGN only. Use My Company Account copies
 * the bank details on the requester's employee record at the moment it is sent, so a later change
 * to the profile leaves a request in flight as it was.
 *
 * Send Back and Send Again (guide §6.1): the engine's Request Changes keeps an approval pending and
 * moves it back to its first stage, where the line manager could still decide a request its
 * requester is changing. So, as a performance review is returned to its reviewer, the request's
 * approval is withdrawn for its opener and the request is `sent_back`; Send Again opens a new
 * approval on the flow as Settings · Approvals holds it then. The earlier approval and its
 * decisions stay on the request's history.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const engine = require("../../shared/workflow/engine");
const approvers = require("../../shared/workflow/approvers");
const vault = require("../../shared/documents/vault");
const routeMap = require("../../shared/route-map");
const { holdsCapability } = require("../../middleware/rbac");
const categories = require("../expense_categories/expense_categories.service");
const repo = require("./expenses.repo");
const budget = require("./expenses.budget-check");
const { EVENTS, DEFINITION_KEY, INVOICE_DOC_TYPE } = require("./expenses.events");

const ALL = Object.freeze({ scope: "all", scope_ids: null });
const FINANCE = "expenses.finance";

/** Statuses the requester edits and sends again. */
const EDITABLE = Object.freeze(["draft", "sent_back"]);
/** Statuses the requester cancels: before Operations & People approve. */
const CANCELLABLE = Object.freeze(["draft", "sent_back", "submitted"]);
/** Statuses an `expenses.finance` holder withdraws: approved, until it is paid. */
const WITHDRAWABLE = Object.freeze(["approved", "in_requisition", "authorised"]);
const MAX_LINES = 25;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That expense request does not exist", 404, { expense_request_id: ["No such request"] });

/**
 * A request on these budget lines moved: their committed and spent are recounted (the budgets
 * module's), and the Over Budget flag of each request still deciding on them is worked out again
 * against the lines as they now stand (guide §6.6 rules 2 and 3), in the caller's transaction.
 */
async function countIn(client, lineIds) {
  const ids = (lineIds || []).filter(Boolean);
  if (!ids.length) return;
  await require("../budgets/budgets.service").recountIn(client, ids);
  await repo.refreshOverBudget(client, ids);
}

/** The budgets module set or changed a budget's lines: the requests on them are flagged again. */
const refreshOverBudgetIn = (client, lineIds) => repo.refreshOverBudget(client, lineIds);

/** A budget line taken away: the requests on it that no longer count let go of it (budgets.service update). */
const detachLineIn = (client, lineId) => repo.detachLine(client, lineId);

/** A budget set after requests were sent counts them (budgets.service create and update). */
const attachToBudgetIn = (client, budgetId) => repo.attachToBudget(client, budgetId);
const invalid = (code, message, fields) => new AppError(code, message, 422, fields);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The facts every request event carries, for the audit line and the notifications. */
const payloadOf = (row, extra = {}) => ({
  expense_request_id: row.expense_request_id,
  number: row.number,
  employee_id: row.employee_id,
  subject_employee_id: row.employee_id,
  amount: row.amount,
  ...extra,
});

/** The caller's employee record: a request is always somebody's (no login without an employee). */
async function requesterOf(db, actor) {
  const employee = actor && actor.employee_id ? await repo.employeeOf(db, actor.employee_id) : null;
  if (!employee) throw new AppError("NO_EMPLOYEE", "Only staff raise expense requests", 403);
  return employee;
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** Newest first unless the caller sorted it. */
const newestFirst = (query) => (query.sort ? query : { ...query, sort: { field: "created_at", dir: "desc" } });

/** Everyone's requests within the caller's `expenses` scope; somebody else's draft is never shown. */
const list = (query, scope, reader) =>
  repo.list(pool, { ...newestFirst(query), reader_employee_id: (reader && reader.employee_id) || null, reader_user_id: (reader && reader.user_id) || null }, scope);

/** The caller's own requests (ESS · My Requests). */
const listMine = (employeeId, query) => repo.list(pool, { ...newestFirst(query), employee_id: employeeId }, ALL);

/** The requests waiting on the caller now (Expenses · Approvals), oldest sent first. */
const approvals = (user, query) => repo.waitingOn(pool, user, query);

async function approvalsSummary(user) {
  const r = await repo.approvalsSummary(pool, user, `${lagos.today().slice(0, 7)}-01`);
  return { with_you: r.with_you, total_value: r.total_value, oldest_days: r.oldest_days, approved_this_month: r.approved_this_month };
}

async function mineSummary(employeeId) {
  const r = await repo.mineSummary(pool, employeeId, `${lagos.today().slice(0, 4)}-01-01`);
  return {
    in_flight: r.in_flight,
    disbursed_this_year: r.disbursed_this_year,
    average_turnaround_days: r.average_turnaround_days === null ? null : Number(r.average_turnaround_days),
    rejected: r.rejected,
  };
}

/** What only the service reads, taken off before a request leaves. */
const INTERNAL = ["employee_id", "invoice_document_id", "approval_state", "approval_opened_by", "budget_line_id"];

/**
 * A request as the reader sees it: whether they may edit it now (their own draft or sent-back
 * request) and cancel or withdraw it now (their own, before Operations & People approve; or, with
 * `expenses.finance`, once approved and until it is paid).
 */
async function publicView(row, reader, scope = null) {
  const own = Boolean(reader && reader.employee_id && reader.employee_id === row.employee_id);
  const finance = WITHDRAWABLE.includes(row.status) && reader ? await holdsCapability(reader, FINANCE) : false;
  const out = { ...row };
  for (const k of INTERNAL) delete out[k];
  const dups = await readableDuplicates(reader, scope, row.possible_duplicates || []);
  return {
    ...out,
    possible_duplicates: dups.shown.map(duplicateRef),
    possible_duplicates_hidden: dups.hidden,
    can_edit: own && EDITABLE.includes(row.status),
    can_cancel: (own && CANCELLABLE.includes(row.status)) || finance,
  };
}

/** A possible duplicate as the contract carries it: nothing about whose it is. */
const duplicateRef = (d) => ({
  expense_request_id: d.expense_request_id,
  number: d.number,
  purpose: d.purpose,
  amount: d.amount,
  status: d.status,
  submitted_at: d.submitted_at,
});

/**
 * The possible duplicates the reader may see, by getFor's own test: their own, within their
 * `expenses` scope, or one whose pending stage names them (audit F8). The others are only counted:
 * the request shows that there are more, never their number, purpose or amount. With no scope
 * given (the requester's own views), only their own requests are shown.
 */
async function readableDuplicates(reader, scope, dups) {
  const shown = [];
  let hidden = 0;
  const reach = scope || { scope: "own", scope_ids: reader && reader.employee_id ? [reader.employee_id] : [] };
  for (const d of dups) {
    let ok = Boolean(reader && reader.employee_id && d.employee_id === reader.employee_id) || reach.scope === "all" || (reach.scope_ids || []).includes(d.employee_id);
    if (!ok && reader && d.approval_state === "pending") {
      const instance = await engine.findOpenInstance(pool, { type: "expense", id: d.expense_request_id });
      ok = Boolean(instance && (await approvers.canAct(pool, instance.stage_approvers, reader, instance)));
    }
    if (ok) shown.push(d);
    else hidden += 1;
  }
  return { shown, hidden };
}

/**
 * One request the reader may see: within their `expenses` scope (somebody else's draft never), or
 * named on the stage its approval waits at now. Answers with the requester's id beside it, for
 * the controller's mask.
 */
async function getFor(user, scope, id) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  const own = Boolean(user.employee_id && row.employee_id === user.employee_id);
  if (row.status === "draft" && !own) throw notFound();
  const inScope = own || scope.scope === "all" || (scope.scope_ids || []).includes(row.employee_id);
  if (!inScope) {
    const instance = row.approval_state === "pending" ? await engine.findOpenInstance(pool, { type: "expense", id }) : null;
    if (!instance || !(await approvers.canAct(pool, instance.stage_approvers, user, instance))) throw notFound();
  }
  return { own, request: await publicView(row, user, scope) };
}

/** One of the caller's own requests, or a 404 when it is somebody else's. */
async function getOwn(user, id) {
  const row = await repo.get(pool, id);
  if (!row || row.employee_id !== user.employee_id) throw notFound();
  return publicView(row, user);
}

/** What each event says on a request's history; one not listed reads as its catalogue summary. */
const HISTORY_LABEL = Object.freeze({
  "expense_request.created": "Saved as a draft",
  "expense_request.updated": "Changed",
  "expense_request.submitted": "Sent for approval",
  "expense_request.approved": "Approved by Operations & People",
  "expense_request.rejected": "Rejected",
  "expense_request.sent_back": "Sent back to the requester",
  "expense_request.cancelled": "Cancelled",
  "expense_request.withdrawn": "Withdrawn",
  "workflow.opened": "Approval started",
  "workflow.advanced": "Approved, on to the next stage",
  "workflow.completed": "Approval finished",
  "workflow.changes_requested": "Changes asked for",
  "workflow.cancelled": "Approval withdrawn",
  "workflow.escalated": "Approval escalated",
  "workflow.reminded": "Approvers reminded",
  "requisition.submitted": "Put in a requisition for the CEO",
  "requisition.request_removed": "Removed from its requisition by the CEO",
  "requisition.approved": "Authorised by the CEO",
  "requisition.rejected": "Requisition rejected by the CEO",
  "disbursement.recorded": "Paid",
  "disbursement.reference_added": "Bank reference added",
});

/** A request's history on its modal, for a reader who may open it, 25 a page (audit F3). */
async function history(user, scope, id, query) {
  await getFor(user, scope, id);
  const page = await repo.historyOf(pool, id, query);
  const catalogue = require("../../shared/events/catalogue");
  const labelOf = (action) => HISTORY_LABEL[action] || (catalogue.has(action) ? catalogue.get(action).summary : action);
  return { ...page, data: page.data.map((r) => ({ at: r.at, action: r.action, label: labelOf(r.action), by: r.by || null, reason: r.reason || null })) };
}

/**
 * Check Duplicate on a request the reader may open (expenses.duplicates.js): the model compares it
 * with the requests it may repeat. Nothing is kept.
 */
async function checkDuplicate(user, scope, id) {
  await getFor(user, scope, id);
  const row = await repo.get(pool, id);
  // The model is given only the requests the reader may open (audit F8).
  const { shown } = await readableDuplicates(user, scope, row.possible_duplicates || []);
  const out = await require("./expenses.duplicates").check(user, { ...row, possible_duplicates: shown });
  return out.duplicate ? { ...out, duplicate: duplicateRef(out.duplicate) } : out;
}

/* ------------------------------------------------------------------ *
 * Raising and editing
 * ------------------------------------------------------------------ */

/**
 * The request's fields as stored, from the form's: the category offered, the department and the
 * project real, each line's amount and the total worked out. `keepCategory` is the category the
 * request already names, kept when it was deactivated since.
 */
async function normalise(db, employee, body, keepCategory = null) {
  await categories.assertOffered(db, body.expense_category_id, keepCategory);
  const departmentId = body.department_id || employee.department_id || null;
  if (body.department_id && !(await repo.departmentExists(db, body.department_id)))
    throw invalid("DEPARTMENT_UNKNOWN", "Pick a department from the list", { department_id: ["Not a department"] });
  if (body.project_id) {
    const project = await repo.projectOf(db, body.project_id);
    if (!project || ["archived", "cancelled"].includes(project.status))
      throw invalid("PROJECT_UNAVAILABLE", "Pick a project that is running", { project_id: ["Not open"] });
  }
  const items = (body.lines || []).map((l) => ({
    description: l.description,
    quantity: l.quantity || "1",
    unit_price: l.unit_price,
    amount: m.toWire(m.money(l.quantity || "1").times(m.money(l.unit_price))),
  }));
  if (!items.length) throw invalid("LINES_REQUIRED", "Add a line", { lines: ["Add a line"] });
  if (items.length > MAX_LINES) throw invalid("TOO_MANY_LINES", `A request holds at most ${MAX_LINES} lines`, { lines: ["At most 25"] });
  const amount = m.toWire(m.sum(items.map((i) => i.amount)));
  if (!m.money(amount).greaterThan(0)) throw invalid("AMOUNT_REQUIRED", "The request needs an amount", { lines: ["Add an amount"] });
  const profile = body.uses_profile_account === true;
  if (profile && body.payee_type !== "staff")
    throw invalid("PROFILE_ACCOUNT_STAFF_ONLY", "Only a staff payee uses the company account", { uses_profile_account: ["Staff only"] });
  return {
    items,
    fields: {
      purpose: body.purpose,
      expense_category_id: body.expense_category_id,
      project_id: body.project_id || null,
      department_id: departmentId,
      needed_on: body.needed_on || null,
      amount,
      payee_type: body.payee_type,
      uses_profile_account: profile,
      // The profile's account is copied when the request is sent, never before.
      payee_name: profile ? null : body.payee_name || null,
      bank_name: profile ? null : body.bank_name || null,
      account_name: profile ? null : body.account_name || null,
      account_number: profile ? null : body.account_number || null,
      invoice_document_id: body.invoice_document_id || null,
    },
  };
}

/** The invoice the request names, bound to it (vault.claim), so its approvers can open it. */
async function claimInvoice(client, row, actor) {
  if (!row.invoice_document_id) return;
  await vault.claim(client, {
    document_id: row.invoice_document_id,
    doc_type: INVOICE_DOC_TYPE,
    entity: { type: "expense", id: row.expense_request_id },
    subject_employee_id: row.employee_id,
    actor,
    field: "invoice_document_id",
  });
}

/** Who the money goes to, as it is sent: the profile's account for Use My Company Account. */
function payeeAsSent(row, employee) {
  if (row.uses_profile_account) {
    if (!employee.bank_name || !employee.account_number)
      throw invalid("PROFILE_BANK_MISSING", "Add your bank details to your profile first", {
        uses_profile_account: ["Add them to your profile"],
      });
    return { payee_name: employee.display_name, bank_name: employee.bank_name, account_name: employee.display_name, account_number: employee.account_number };
  }
  const missing = {};
  for (const k of ["payee_name", "bank_name", "account_name", "account_number"]) if (!row[k]) missing[k] = ["Required"];
  if (Object.keys(missing).length) throw invalid("PAYEE_INCOMPLETE", "Add the payee's bank details", missing);
  return { payee_name: row.payee_name, bank_name: row.bank_name, account_name: row.account_name, account_number: row.account_number };
}

/**
 * Send a draft or sent-back request in the caller's transaction: the payee fixed, the budget line
 * and its flag set, `expense_request.submitted` emitted and the approval opened.
 */
async function sendIn(client, row, actor, employee) {
  const payee = payeeAsSent(row, employee);
  const counted = await budget.check(client, row, lagos.today());
  const moved = await repo.move(client, row.expense_request_id, EDITABLE, "submitted", { submitted_at: "now" });
  if (!moved) throw new AppError("EXPENSE_ALREADY_SENT", "This request was already sent", 409);
  await emit(client, {
    key: EVENTS.EXPENSE_REQUEST_SUBMITTED,
    entity: { type: "expense", id: row.expense_request_id },
    actor,
    before: { status: row.status },
    after: { status: "submitted", over_budget: counted.over_budget },
    payload: payloadOf(row, { again: row.status === "sent_back" }),
  });
  const instance = await engine.openInstance(client, {
    definition_key: DEFINITION_KEY,
    entity: { type: "expense", id: row.expense_request_id },
    subject_employee_id: row.employee_id,
    context: { amount: row.amount, requester_manages_people: employee.manages_people === true },
    actor,
  });
  await repo.setSending(client, row.expense_request_id, { ...payee, ...counted, workflow_instance_id: instance.workflow_instance_id });
}

/** New Request: a draft, or sent at once when `submit` is true. */
async function create(actor, body) {
  const employee = await requesterOf(pool, actor);
  const id = await tx(async (client) => {
    const { fields, items } = await normalise(client, employee, body);
    const { number } = await numbering.allocate(client, "expense");
    const row = await repo.insert(client, { ...fields, number, employee_id: employee.employee_id, currency: "NGN", status: "draft" });
    await repo.replaceLines(client, row.expense_request_id, items);
    await claimInvoice(client, row, actor);
    await emit(client, {
      key: EVENTS.EXPENSE_REQUEST_CREATED,
      entity: { type: "expense", id: row.expense_request_id },
      actor,
      after: row,
      payload: payloadOf(row),
    });
    if (body.submit) await sendIn(client, row, actor, employee);
    return row.expense_request_id;
  });
  return getOwn(actor, id);
}

/** The caller's own request, locked, in one of `statuses`. */
async function ownLocked(client, actor, id, statuses, refusal) {
  const row = await repo.lock(client, id);
  if (!row || row.employee_id !== actor.employee_id) throw notFound();
  if (!statuses.includes(row.status)) throw refusal();
  return row;
}

const notEditable = () => new AppError("EXPENSE_NOT_EDITABLE", "Only a draft or a sent-back request is edited", 409);

/** Edit: the requester's draft or sent-back request; every field is sent again, the lines replace its own. */
async function update(actor, id, body) {
  const employee = await requesterOf(pool, actor);
  await tx(async (client) => {
    const before = await ownLocked(client, actor, id, EDITABLE, notEditable);
    const { fields, items } = await normalise(client, employee, body, before.expense_category_id);
    const after = await repo.updateFields(client, id, fields);
    await repo.replaceLines(client, id, items);
    await claimInvoice(client, after, actor);
    await emit(client, {
      key: EVENTS.EXPENSE_REQUEST_UPDATED,
      entity: { type: "expense", id },
      actor,
      before,
      after,
      payload: payloadOf(after),
    });
  });
  return getOwn(actor, id);
}

/** Send Request, and Send Again on a sent-back request. */
async function submit(actor, id) {
  const employee = await requesterOf(pool, actor);
  await tx(async (client) => {
    const row = await ownLocked(client, actor, id, EDITABLE, () => new AppError("EXPENSE_ALREADY_SENT", "This request was already sent", 409));
    await sendIn(client, row, actor, employee);
  });
  return getOwn(actor, id);
}

/* ------------------------------------------------------------------ *
 * Cancelling and withdrawing
 * ------------------------------------------------------------------ */

/** Cancel Request: the requester's own, while a draft, sent back, or with its approval still deciding. */
async function cancelOwn(actor, id, body) {
  const shown = await repo.get(pool, id);
  if (!shown || shown.employee_id !== actor.employee_id) throw notFound();
  if (!CANCELLABLE.includes(shown.status))
    throw new AppError("EXPENSE_NOT_CANCELLABLE", "Ask Operations & People to withdraw it", 409);
  await tx(async (client) => {
    const row = await ownLocked(client, actor, id, CANCELLABLE, () => new AppError("EXPENSE_NOT_CANCELLABLE", "Ask Operations & People to withdraw it", 409));
    if (row.status === "submitted" && row.workflow_instance_id) {
      const instance = await engine.findOpenInstance(client, { type: "expense", id });
      if (instance) await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor, reason: body.reason || null });
    }
    await repo.move(client, id, CANCELLABLE, "cancelled", { cancelled_at: "now" });
    await emit(client, {
      key: EVENTS.EXPENSE_REQUEST_CANCELLED,
      entity: { type: "expense", id },
      actor,
      before: { status: row.status },
      after: { status: "cancelled" },
      payload: payloadOf(row, { reason: body.reason || null }),
    });
  });
  return getOwn(actor, id);
}

/**
 * Withdraw: an `expenses.finance` holder takes back an approved request, with a reason, until it
 * is paid. One in a requisition leaves it, and the requisition's total is counted again.
 */
async function withdraw(actor, scope, id, body) {
  if (!body.reason) throw invalid("REASON_REQUIRED", "Say why it is withdrawn", { reason: ["Give a reason"] });
  const shown = await repo.get(pool, id);
  if (!shown || shown.status === "draft") throw notFound();
  if (!(scope.scope === "all" || (scope.scope_ids || []).includes(shown.employee_id))) throw notFound();
  if (!WITHDRAWABLE.includes(shown.status))
    throw new AppError("EXPENSE_NOT_WITHDRAWABLE", "Only an approved request not yet paid is withdrawn", 409);
  await tx(async (client) => {
    const row = await repo.lock(client, id);
    // A decision copied onto the row meanwhile: the row and the read must agree before it moves.
    if (!row || row.status !== (await repo.get(client, id)).status)
      throw new AppError("EXPENSE_MOVING", "This request is moving on. Try again.", 409);
    const moved = await repo.move(client, id, WITHDRAWABLE, "cancelled", { cancelled_at: "now", requisition_id: null });
    if (!moved) throw new AppError("EXPENSE_NOT_WITHDRAWABLE", "Only an approved request not yet paid is withdrawn", 409);
    if (row.requisition_id) await require("../requisitions/requisitions.service").recountIn(client, row.requisition_id, actor);
    await countIn(client, [row.budget_line_id]);
    await emit(client, {
      key: EVENTS.EXPENSE_REQUEST_WITHDRAWN,
      entity: { type: "expense", id },
      actor,
      before: { status: row.status, requisition_id: row.requisition_id },
      after: { status: "cancelled" },
      payload: payloadOf(row, { reason: body.reason }),
    });
  });
  return (await getFor(actor, scope, id)).request;
}

/* ------------------------------------------------------------------ *
 * After an approval moves (expenses.events.js)
 * ------------------------------------------------------------------ */

const OUTCOME = Object.freeze({
  approved: { status: "approved", at: "approved_at", key: () => EVENTS.EXPENSE_REQUEST_APPROVED },
  timeout_approved: { status: "approved", at: "approved_at", key: () => EVENTS.EXPENSE_REQUEST_APPROVED },
  rejected: { status: "rejected", at: "rejected_at", key: () => EVENTS.EXPENSE_REQUEST_REJECTED },
  timeout_rejected: { status: "rejected", at: "rejected_at", key: () => EVENTS.EXPENSE_REQUEST_REJECTED },
  cancelled: { status: "cancelled", at: "cancelled_at", key: () => EVENTS.EXPENSE_REQUEST_CANCELLED },
});

/**
 * Copy an approval's end onto its request. Runs after commit, at least once: only a request still
 * `submitted` on that very approval moves, so a copy twice, or the withdrawal a Send Back makes,
 * changes nothing.
 * @param {string} id          the expense_request_id
 * @param {string} state       the approval's end state
 * @param {string} instanceId  the approval that ended
 */
async function settle(id, state, instanceId) {
  const outcome = OUTCOME[state];
  if (!outcome) return null;
  return tx(async (client) => {
    const row = await repo.lock(client, id);
    if (!row || row.status !== "submitted" || (instanceId && row.workflow_instance_id !== instanceId)) return null;
    const moved = await repo.move(client, id, ["submitted"], outcome.status, { [outcome.at]: "now" });
    if (!moved) return null;
    await countIn(client, [row.budget_line_id]);
    await emit(client, {
      key: outcome.key(),
      entity: { type: "expense", id },
      actor: null,
      before: { status: "submitted" },
      after: { status: outcome.status },
      payload: payloadOf(row),
    });
    return outcome.status;
  });
}

/**
 * An approver pressed Send Back: the pending approval is withdrawn for its opener and the request
 * goes back to its requester to change and send again (see the header). Safe to run twice.
 */
async function sentBack(id, payload) {
  return tx(async (client) => {
    const row = await repo.lock(client, id);
    if (!row || row.status !== "submitted" || (payload.instance_id && row.workflow_instance_id !== payload.instance_id)) return null;
    const instance = await engine.findOpenInstance(client, { type: "expense", id });
    if (instance) await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: payload.reason || null });
    await repo.move(client, id, ["submitted"], "sent_back", { sent_back_at: "now" });
    await emit(client, {
      key: EVENTS.EXPENSE_REQUEST_SENT_BACK,
      entity: { type: "expense", id },
      actor: null,
      before: { status: "submitted" },
      after: { status: "sent_back" },
      payload: payloadOf(row, { reason: payload.reason || null, from_stage: payload.from_stage || null }),
    });
    return "sent_back";
  });
}

/* ------------------------------------------------------------------ *
 * Requisitions and disbursements (PR 4): the requests' own moves, in the caller's transaction,
 * called by requisitions.service and disbursements.service so a request is written here alone.
 * ------------------------------------------------------------------ */

const notGroupable = (fields) =>
  new AppError("REQUEST_NOT_APPROVED", "Only approved requests not in a requisition are grouped", 409, fields);

/**
 * Lock the requests a requisition will hold and check each is approved and in none yet, as every
 * read shows it; answers the locked rows, in the order asked.
 */
async function lockGroupable(client, ids) {
  const rows = await repo.lockMany(client, ids);
  if (rows.length !== new Set(ids).size) throw notGroupable({ expense_request_ids: ["Not every request exists"] });
  for (const row of rows) {
    const shown = await repo.get(client, row.expense_request_id);
    if (row.status !== "approved" || row.requisition_id || shown.status !== "approved")
      throw notGroupable({ expense_request_ids: [`${row.number} is not waiting for a requisition`] });
  }
  return ids.map((id) => rows.find((r) => r.expense_request_id === id));
}

/** Put the locked requests into a requisition (status `in_requisition`). */
async function groupIn(client, ids, requisitionId) {
  if ((await repo.group(client, ids, requisitionId)) !== new Set(ids).size) throw notGroupable({ expense_request_ids: ["One was grouped meanwhile"] });
}

/**
 * The CEO took a request out of a requisition before deciding it: back to `approved` and to the
 * Requisitions list, its removal and reason on its history.
 */
async function removeFromRequisitionIn(client, requisitionId, requestId) {
  const row = await repo.lock(client, requestId);
  if (!row || row.requisition_id !== requisitionId || row.status !== "in_requisition")
    throw invalid("NOT_IN_REQUISITION", "That request is not in this requisition", { expense_request_id: ["Not in it"] });
  await repo.move(client, requestId, ["in_requisition"], "approved", { requisition_id: null });
  return row;
}

/** Every request still in a requisition moves with its decision (requisitions.service settle). */
const settleRequisitionIn = (client, requisitionId, outcome) => repo.settleRequisition(client, requisitionId, outcome);

const requisitionTotalIn = (client, requisitionId) => repo.requisitionTotal(client, requisitionId);

/**
 * Lock an authorised request for its disbursement and check it is one, as every read shows it.
 * @returns {Promise<object>} the stored row
 */
async function lockPayable(client, id) {
  const row = await repo.lock(client, id);
  const shown = row ? await repo.get(client, id) : null;
  if (!row) throw invalid("NOT_FOUND", "Pick a request waiting to be paid", { expense_request_id: ["No such request"] });
  if (row.status === "disbursed") throw new AppError("ALREADY_DISBURSED", "This request is already paid", 409, { expense_request_id: ["Already paid"] });
  if (shown.status === "authorised" && row.status !== "authorised")
    throw new AppError("EXPENSE_MOVING", "This request is moving on. Try again.", 409);
  if (row.status !== "authorised")
    throw invalid("REQUEST_NOT_AUTHORISED", "Only a request the CEO authorised is paid", { expense_request_id: ["Not authorised yet"] });
  return row;
}

/** The request is paid: `disbursed`, its amount moving from committed to spent on its budget line. */
async function markDisbursedIn(client, id) {
  const moved = await repo.move(client, id, ["authorised"], "disbursed", { disbursed_at: "now" });
  if (!moved) throw new AppError("ALREADY_DISBURSED", "This request is already paid", 409, { expense_request_id: ["Already paid"] });
  await countIn(client, [moved.budget_line_id]);
  return moved;
}

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11, decision 33): New Request with its first line,
 * Save Request and Add Line, each through create() or update() above. Nothing here writes.
 * ------------------------------------------------------------------ */

const labelOf = (row) => `${row.number}, ${row.purpose}`;
const link = (id) => (routeMap.linkFor("expense", id, { self: true }) || {}).path || null;

/** A request as a card's readback line. */
const readbackOf = (status) => (r) => [{ type: "expense", id: r.expense_request_id, label: labelOf(r), status: r.status === "submitted" ? "sent" : status, link: link(r.expense_request_id) }];

/** The form's body as the request holds it now, for a card that changes part of it. */
function bodyOf(row) {
  return {
    purpose: row.purpose,
    expense_category_id: row.expense_category_id,
    project_id: row.project_id,
    department_id: row.department_id,
    needed_on: row.needed_on,
    lines: row.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price })),
    payee_type: row.payee_type,
    uses_profile_account: row.uses_profile_account,
    payee_name: row.payee_name,
    bank_name: row.bank_name,
    account_name: row.account_name,
    account_number: row.account_number,
    invoice_document_id: row.invoice_document_id,
  };
}

/** New Request's card: its first line flat, sent at once unless the person said to keep a draft. */
function createFromCard(actor, values) {
  const { description, quantity, unit_price: unitPrice, ...rest } = values;
  return create(actor, { ...rest, lines: [{ description, quantity: quantity || "1", unit_price: unitPrice }] });
}

/** The caller's own request a card names, editable now. */
async function editableOwn(db, actor, id) {
  const row = UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  if (!row || row.employee_id !== actor.employee_id) throw notFound();
  if (!EDITABLE.includes(row.status)) throw notEditable();
  return row;
}

/** Save Request's card: what it names laid over the request as it stands, then Edit's own save. */
async function changeFromCard(actor, values) {
  const { expense_request_id: id, ...changes } = values;
  const row = await editableOwn(pool, actor, id);
  const given = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
  return update(actor, id, { ...bodyOf(row), ...given });
}

/** Add Line's card: one more line after the request's own. */
async function addLineFromCard(actor, values) {
  const row = await editableOwn(pool, actor, values.expense_request_id);
  const body = bodyOf(row);
  body.lines.push({ description: values.description, quantity: values.quantity || "1", unit_price: values.unit_price });
  return update(actor, values.expense_request_id, body);
}

/** The request a card names, by number and purpose, when it is the person's own. */
async function cardRequest(db, actor, id) {
  const row = db && UUID.test(String(id || "")) ? await repo.get(db, id) : null;
  return row && row.employee_id === actor.employee_id ? [{ type: "expense", id, label: labelOf(row) }] : [];
}

/** A card's re-check: the request is the person's own and still a draft or sent back. */
async function assertCardEditable(db, actor, id) {
  await editableOwn(db, actor, id);
}

/** The ids a New Request or Save Request card holds, by name: its category, project and department. */
async function cardNames(db, values) {
  if (!db) return [];
  const out = [...(await categories.cardCategory(db, values.expense_category_id))];
  if (UUID.test(String(values.project_id || ""))) {
    const name = await repo.projectName(db, values.project_id);
    if (name) out.push({ type: "project", id: values.project_id, label: name });
  }
  if (UUID.test(String(values.department_id || ""))) {
    const name = await repo.departmentName(db, values.department_id);
    if (name) out.push({ type: "department", id: values.department_id, label: name });
  }
  return out;
}

module.exports = {
  EDITABLE,
  CANCELLABLE,
  WITHDRAWABLE,
  list,
  listMine,
  approvals,
  approvalsSummary,
  mineSummary,
  getFor,
  getOwn,
  checkDuplicate,
  history,
  create,
  update,
  submit,
  cancelOwn,
  withdraw,
  settle,
  sentBack,
  lockGroupable,
  groupIn,
  removeFromRequisitionIn,
  settleRequisitionIn,
  requisitionTotalIn,
  lockPayable,
  markDisbursedIn,
  countIn,
  refreshOverBudgetIn,
  attachToBudgetIn,
  detachLineIn,
  createFromCard,
  changeFromCard,
  addLineFromCard,
  readbackOf,
  cardRequest,
  assertCardEditable,
  cardNames,
};
