"use strict";
/**
 * Payroll runs: the transaction around each move, what a reader is shown, and how an approval's end reaches
 * the run (docs/guides/payroll.md §3, §5, §6.9). The moves themselves are payroll.run.js and payroll.lock.js,
 * the SQL payroll.repo.js; this file owns the transaction and the events they emit commit with.
 *
 *   listRuns, summary, getRun, problems, adjustments   what Payroll Runs reads
 *   createRun, computeRun, submitRun, discardRun,
 *   excludePerson, includePerson, addAdjustment,
 *   removeAdjustment, markPaid                         what its buttons do
 *   settle, sentBack                                   the approval's end, copied onto the run after commit
 *
 * The salary-derived amounts leave under the names the salary mask governs (`gross_pay`, `total_deductions`,
 * `net_pay`, `employer_cost`, `pay_amount`); the controller masks them for a reader without the grant. A run
 * that is refused Submit is refused *after* its recompute commits, so the screen reads the figures that now
 * stand (RUN_CHANGED carries them, to a reader who may see pay).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { scopeFor } = require("../../middleware/rbac");
const { canSee } = require("../../shared/rbac/field-mask");
const engine = require("../../shared/workflow/engine");
const lagos = require("../../shared/time/lagos");
const workflowService = require("../workflow/workflow.service");
const repo = require("./payroll.repo");
const lock = require("./payroll.lock");
const run = require("./payroll.run");
const { DEFINITION_KEY } = require("./payroll.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (at) => (at ? new Date(at).toISOString() : null);

/* ------------------------------------------------------------------ *
 * What a reader is shown
 * ------------------------------------------------------------------ */

/** What the reader may press: their grants on payroll (the run's status is the other half). */
async function grantsOf(user) {
  const [edit, remove] = await Promise.all([scopeFor(user, "payroll", "edit"), scopeFor(user, "payroll", "delete")]);
  return { edit: Boolean(edit), remove: Boolean(remove) };
}

/**
 * A repo row as the contract's PayrollRun. A list row has an empty chain and cannot be decided; the run a
 * person opens carries the approval's route and whether it waits on them.
 */
function present(row, { grants, counts = null, approval = null }) {
  const open = row.status === "draft" || row.status === "computed";
  return {
    payroll_run_id: row.payroll_run_id,
    number: row.number,
    period: row.period,
    status: row.status,
    advanced: row.advanced,
    headcount: row.headcount,
    gross_pay: row.earnings_total,
    total_deductions: row.deductions_total,
    net_pay: row.net_total,
    employer_cost: row.employer_total,
    computed_at: iso(row.computed_at),
    submitted_at: iso(row.submitted_at),
    submitted_by_name: row.submitted_by_name || null,
    approved_at: iso(row.approved_at),
    approved_by_name: row.approved_by_name || null,
    paid_on: row.paid_on || null,
    payment_reference: row.payment_reference || null,
    paid_by_name: row.paid_by_name || null,
    returned_reason: row.returned_reason || null,
    workflow_instance_id: row.workflow_instance_id || null,
    chain: approval ? approval.route : [],
    blocking_problems: counts ? counts.blocking : 0,
    warnings: counts ? counts.warnings : 0,
    can_compute: open && grants.edit,
    can_submit: row.status === "computed" && grants.edit,
    can_decide: Boolean(approval && approval.can_decide && row.status === "submitted"),
    can_pay: row.status === "approved" && grants.edit,
    can_discard: open && grants.remove,
    created_at: iso(row.created_at),
  };
}

/** The approval a run is on, as its reader sees it: its route and whether it waits on them. Null when the run has none. */
async function approvalOf(user, row) {
  if (!row.workflow_instance_id || !["submitted", "approved", "paid"].includes(row.status)) return null;
  try {
    return await workflowService.getInstance(user, row.workflow_instance_id);
  } catch {
    return null;
  }
}

/** GET /payroll/runs/:id and the answer to every move on it. */
async function getRun(user, id) {
  const row = await repo.getRun(pool, id);
  if (!row) throw new AppError("NOT_FOUND", "That payroll run does not exist", 404);
  const [grants, approval, counts] = await Promise.all([grantsOf(user), approvalOf(user, row), repo.problemCounts(pool, [id])]);
  return present(row, { grants, approval, counts: counts.get(id) || null });
}

/** GET /payroll/runs: Run History, 25 a page. */
async function listRuns(user, query) {
  const page = await repo.listRuns(pool, query);
  const [grants, counts] = await Promise.all([grantsOf(user), repo.problemCounts(pool, page.data.map((r) => r.payroll_run_id))]);
  return { ...page, data: page.data.map((r) => present(r, { grants, counts: counts.get(r.payroll_run_id) || null })) };
}

/** GET /payroll/runs/summary: the run to show first, the runs by status and the last twelve months' net. */
async function summary(user) {
  const today = lagos.today();
  const from = lagos.addMonths(lagos.monthBounds(today).first, -11);
  const [current, counts, trend] = await Promise.all([repo.currentRun(pool), repo.countsByStatus(pool), repo.trend(pool, from)]);
  return {
    current: current ? await getRun(user, current.payroll_run_id) : null,
    counts,
    trend: trend.map((t) => ({ period: t.period, net_pay: t.net_total })),
  };
}

/** What each problem says and what to do about it (§6.15); the person is named in the message. */
const PROBLEM_WORDS = Object.freeze({
  NO_SALARY: { message: (n) => `No Salary Set for ${n.name}`, action: "Set the pay, or exclude them" },
  NEGATIVE_NET: { message: (n) => `${n.name} would be paid less than nothing`, action: "Spread a deduction, add an adjustment or exclude them" },
  NO_RATES: { message: () => "No rates are set for the statutory items", action: "Enter the rates on Configurations" },
  OVERTIME_WAITING: {
    message: (n) => `${n.n} overtime ${n.n === 1 ? "item waits" : "items wait"} for a decision for ${n.name}`,
    action: "Ask the line manager to decide",
  },
  NO_BANK: { message: (n) => `No Bank Details for ${n.name}`, action: "Add them on People · Employees" },
  CONTRACT_ENDED: { message: (n) => `${n.name}'s contract has ended`, action: "Check the person, exclude if needed" },
  NO_PAY_SPLIT: { message: (n) => `No Pay Split for ${n.name}`, action: "Set the split on Configurations" },
  FINE_WAITING: {
    message: (n) => `${n.n} ${n.n === 1 ? "fine waits" : "fines wait"} for payroll for ${n.name}`,
    action: "Accept, spread or waive it on Deductions",
  },
});

/** GET /payroll/runs/:id/problems: blocking first, then the warnings. */
async function problems(id, query) {
  if (!(await repo.getRun(pool, id))) throw new AppError("NOT_FOUND", "That payroll run does not exist", 404);
  const page = await repo.pageProblems(pool, id, query);
  return {
    ...page,
    data: page.data.map((p) => ({
      code: p.code,
      severity: p.severity,
      employee: p.employee || null,
      payslip_id: p.payslip_id || null,
      message: PROBLEM_WORDS[p.code].message({ name: p.display_name, n: Number(p.n) }),
      action: PROBLEM_WORDS[p.code].action,
    })),
  };
}

/** A repo row as the contract's PayrollAdjustment. */
const presentAdjustment = (row) => ({
  payroll_adjustment_id: row.payroll_adjustment_id,
  payroll_run_id: row.payroll_run_id,
  employee: row.employee,
  kind: row.kind,
  label: row.label,
  pay_amount: row.amount,
  reason: row.reason,
  created_by_name: row.created_by_name || null,
  created_at: iso(row.created_at),
});

/** GET /payroll/runs/:id/adjustments */
async function adjustments(id, query) {
  if (!(await repo.getRun(pool, id))) throw new AppError("NOT_FOUND", "That payroll run does not exist", 404);
  const page = await repo.pageAdjustments(pool, id, query);
  return { ...page, data: page.data.map(presentAdjustment) };
}

/* ------------------------------------------------------------------ *
 * What its buttons do
 * ------------------------------------------------------------------ */

/** New Run. */
async function createRun(actor, body) {
  const id = await tx((client) => run.createRun(client, { period: body.period, actor }));
  return getRun(actor, id);
}

/** Compute Run: Draft or Computed. Idempotent. */
async function computeRun(actor, id) {
  await tx((client) => run.computeRun(client, id, { actor }));
  return getRun(actor, id);
}

/**
 * Submit for Approval. A refusal (no one to pay, a blocking problem, a changed total) is thrown after the
 * recompute commits. RUN_CHANGED names the totals that now stand, to a reader who may see pay.
 */
async function submitRun(actor, id, body) {
  const result = await tx((client) => run.submitRun(client, id, { expected_net_total: body.expected_net_total, actor }));
  if (result.refusal) {
    if (result.refusal.code === "RUN_CHANGED" && (await canSee(pool, actor, "employee.salary"))) {
      const now = await repo.getRun(pool, id);
      result.refusal.fields = { gross_pay: [now.earnings_total], total_deductions: [now.deductions_total], net_pay: [now.net_total] };
    }
    throw result.refusal;
  }
  return getRun(actor, id);
}

/** Discard: a run never sent. */
async function discardRun(actor, id) {
  await tx((client) => run.discardRun(client, id, { actor }));
}

/** Exclude a person from the run, with the reason. */
async function excludePerson(actor, id, body) {
  await tx((client) => run.excludePerson(client, id, { employee_id: body.employee_id, reason: body.reason, actor }));
  return getRun(actor, id);
}

/** Put an excluded person back. */
async function includePerson(actor, id, body) {
  await tx((client) => run.includePerson(client, id, { employee_id: body.employee_id, actor }));
  return getRun(actor, id);
}

/** Add Adjustment. */
async function addAdjustment(actor, id, body) {
  const adjustmentId = await tx((client) => run.addAdjustment(client, id, { body, actor }));
  return presentAdjustment(await repo.getAdjustment(pool, adjustmentId));
}

/** Remove an adjustment of the run. */
async function removeAdjustment(actor, id, adjustmentId) {
  await tx((client) => run.removeAdjustment(client, id, { adjustment_id: adjustmentId, actor }));
}

/** Mark Paid. */
async function markPaid(actor, id, body) {
  await tx((client) => run.markPaid(client, id, { body, actor }));
  return getRun(actor, id);
}

/* ------------------------------------------------------------------ *
 * After an approval moves (payroll.events.js)
 * ------------------------------------------------------------------ */

/** How an approval's end lands on the run. A timeout never approves a payroll, so `timeout_approved` has no place here. */
const OUTCOME = Object.freeze({
  approved: "approve",
  rejected: "return",
  timeout_rejected: "return",
  cancelled: "return",
});

/**
 * Copy an approval's end onto its run. Runs after commit, at least once: only a run still `submitted` on
 * that very approval moves, so a copy twice, or the withdrawal a Send Back makes, changes nothing.
 * @param {string} id          the payroll_run_id
 * @param {string} state       the approval's end state
 * @param {string} instanceId  the approval that ended
 * @param {string|null} [reason]  what the approver or the opener said
 */
async function settle(id, state, instanceId, reason = null) {
  const outcome = OUTCOME[state];
  if (!outcome) return null;
  return tx(async (client) => {
    const row = await repo.lockRun(client, id);
    if (!row || row.status !== "submitted" || (instanceId && row.workflow_instance_id !== instanceId)) return null;
    if (outcome === "approve") {
      const decided = await repo.approverOf(client, instanceId || row.workflow_instance_id);
      await lock.applyApproval(client, id, { approver_user_id: decided ? decided.actor_id : null });
      return "approved";
    }
    await lock.returnToDraft(client, id, { reason: reason || (state === "cancelled" ? "Withdrawn" : null) });
    return "draft";
  });
}

/**
 * An approver pressed Send Back: the pending approval is withdrawn for its opener and the run goes back to
 * Draft with the reason, everything frozen released. Safe to run twice.
 */
async function sentBack(id, payload) {
  return tx(async (client) => {
    const row = await repo.lockRun(client, id);
    if (!row || row.status !== "submitted" || (payload.instance_id && row.workflow_instance_id !== payload.instance_id)) return null;
    const instance = await engine.findOpenInstance(client, { type: "payroll_run", id });
    if (instance && instance.definition_key === DEFINITION_KEY)
      await engine.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: payload.reason || null });
    await lock.returnToDraft(client, id, { reason: payload.reason || null });
    return "draft";
  });
}

module.exports = {
  PROBLEM_WORDS,
  listRuns,
  summary,
  getRun,
  problems,
  adjustments,
  createRun,
  computeRun,
  submitRun,
  discardRun,
  excludePerson,
  includePerson,
  addAdjustment,
  removeAdjustment,
  markPaid,
  settle,
  sentBack,
};
