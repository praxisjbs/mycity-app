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
 *   getSettings, changeSettings, removeSettingsChange  Configurations' setting: the pay day, Bank Details Required,
 *                                                      the advanced option and the accountant's conventions; and
 *                                                      Remove Change of a version still to come
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
const { formatMonth } = require("../../shared/time/day-first");
const { oneNamed } = require("../../shared/ai/named");
const { figure } = require("../../shared/ai/summary");
const { emit } = require("../../shared/events/emit");
const workflowService = require("../workflow/workflow.service");
const statutoryRates = require("../statutory/statutory.rates");
const settings = require("./payroll.config.repo");
const repo = require("./payroll.repo");
const lock = require("./payroll.lock");
const run = require("./payroll.run");
const { DEFINITION_KEY, EVENTS } = require("./payroll.events");

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
  NO_RATES: { message: () => "No PAYE bands or conventions in force", action: "Enter them on Configurations" },
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
 * What the assistant reads and checks (payroll.ai.js, guide §9)
 * ------------------------------------------------------------------ */

/** A run as a card names it: its number and its month, never an amount. */
const runLabel = (row) => `${row.number}, ${formatMonth(row.period)}`;

/** What each card may act on: the run's statuses, and the refusal a run in any other state earns (the move's own). */
const CARD_STATES = Object.freeze({
  submit: { statuses: ["computed"], code: "RUN_NOT_COMPUTED", message: "Compute the run first" },
  adjust: { statuses: ["draft", "computed"], code: "RUN_NOT_EDITABLE", message: "This run can no longer be changed" },
});

/** The runs a card of this kind may act on, newest month first: the first page of each status it takes. */
async function cardRuns(db, kind) {
  const pages = await Promise.all(CARD_STATES[kind].statuses.map((status) => repo.listRuns(db, { status, page: 1 })));
  return pages.flatMap((p) => p.data).sort((a, b) => (a.period < b.period ? 1 : -1));
}

/** The months to tap under "Which run?": those the card may act on, as a person names them ("October 2026"). */
async function cardRunChoices(db, kind) {
  return (await cardRuns(db, kind)).map((r) => formatMonth(r.period));
}

/** The run a person names by its month or its number ("October 2026", "PAY-2026-10"), among those the card may act on; null when none or several. */
async function cardRunIdOf(db, words, kind) {
  const found = oneNamed(await cardRuns(db, kind), words, (r) => [formatMonth(r.period), r.number, r.period.slice(0, 7)]);
  return found ? found.payroll_run_id : null;
}

/** The run a card names, for the card's chip: its number and month. Nothing for a run that does not exist. */
async function cardRun(db, id) {
  const row = id ? await repo.getRun(db, id) : null;
  return row ? [{ type: "payroll_run", id: row.payroll_run_id, label: runLabel(row) }] : [];
}

/** Before the press: the run is still the state the card saw (404 for none), so a card for a run sent meanwhile is refused with the move's own words. */
async function assertCardRun(db, id, kind) {
  const row = await repo.getRun(db, id);
  if (!row) throw new AppError("NOT_FOUND", "That payroll run does not exist", 404);
  const want = CARD_STATES[kind];
  if (!want.statuses.includes(row.status)) throw new AppError(want.code, want.message, 409);
}

/**
 * The assistant's month summary (`payroll.month`, guide §9): headcount and, to a reader who may see pay,
 * the gross, deductions and net of one month's run (the run Payroll Runs shows first when none is asked). Figures,
 * never a row. A summary is not masked on the way out as a read's rows are, so the amounts are left out here
 * for a reader whose role hides pay (`employee.salary`), as the screen shows them Restricted.
 * @param {{query: Function}} db
 * @param {{period?: string}} params  PayrollMonthQuery
 * @param {object} actor              the asker, with their grants
 */
async function monthSummary(db, params, actor) {
  const [found, salary] = await Promise.all([params.period ? repo.runOfPeriod(db, params.period) : repo.currentRun(db), canSee(db, actor, "employee.salary")]);
  const month = found ? await repo.getRun(db, found.payroll_run_id) : null;
  if (!month) return { figures: [], groups: [], series: [], total: 0 };
  const figures = [figure("headcount", "People paid", month.headcount)];
  if (salary) {
    figures.push(
      figure("gross", "Gross pay", month.earnings_total, "NGN"),
      figure("deductions", "Deductions", month.deductions_total, "NGN"),
      figure("net", "Net pay", month.net_total, "NGN"),
    );
  }
  return { figures, groups: [], series: [], total: month.headcount };
}

/* ------------------------------------------------------------------ *
 * Configurations: the setting (§5, §6.11)
 * ------------------------------------------------------------------ */

/** A version as the contract's PayrollSettingsVersion, or null. */
const presentVersion = (v) =>
  v
    ? {
        payroll_setting_id: v.payroll_setting_id,
        advanced_enabled: v.advanced_enabled === true,
        pay_day: v.pay_day ?? null,
        require_bank_details: v.require_bank_details === true,
        paye_basis: v.paye_basis ?? null,
        pension_reduces_taxable: v.pension_reduces_taxable ?? null,
        nhf_reduces_taxable: v.nhf_reduces_taxable ?? null,
        effective_from: v.effective_from,
        effective_to: v.effective_to ?? null,
        reason: v.reason ?? null,
        changed_by_name: v.changed_by_name ?? null,
      }
    : null;

/**
 * GET /payroll/settings: the setting as it stands today in Lagos, the version in force and the one that starts
 * later. With no version, the run is simple, the pay day the default 30 and bank details a warning.
 */
async function getSettings(db = pool) {
  const today = lagos.today();
  const [current, next, beenOn] = await Promise.all([settings.versionAt(db, today), settings.versionAfter(db, today), settings.hasBeenOn(db)]);
  const now = current || settings.DEFAULTS;
  return {
    advanced_enabled: now.advanced_enabled === true,
    advanced_has_been_on: beenOn,
    pay_day: settings.payDayOf(now),
    pay_day_is_default: !now.pay_day,
    require_bank_details: now.require_bank_details === true,
    paye_basis: now.paye_basis ?? null,
    pension_reduces_taxable: now.pension_reduces_taxable ?? null,
    nhf_reduces_taxable: now.nhf_reduces_taxable ?? null,
    current: presentVersion(current),
    next: presentVersion(next),
  };
}

/** The setting's own columns, from a version or the defaults. */
const COLUMNS = ["advanced_enabled", "pay_day", "require_bank_details", ...settings.CONVENTIONS];

/**
 * PATCH /payroll/settings (`payroll.configure`): a new version from `effective_from`, today or later (422
 * EFFECTIVE_IN_THE_PAST). What is sent changes; the rest carries over from the latest version, and a change for the
 * day a version already starts joins it. The conventions are taken only once the option has been on or is being
 * switched on (409 ADVANCED_OFF). Switching on needs a statutory rate in force that day (409 NO_RATES) and the two
 * conventions the screen asks for set, in this change or before (409 NO_CONVENTIONS); PAYE Basis is not asked since
 * PR 10, and an unset one reads as annualised (§6.11 rules 3 and 4, §3.5, §13.2 item 32).
 */
async function changeSettings(actor, body) {
  settings.assertNotPast(body.effective_from);
  await tx(async (client) => {
    const latest = await settings.lockLatest(client);
    const base = latest || settings.DEFAULTS;
    const merged = {};
    for (const c of COLUMNS) merged[c] = body[c] !== undefined ? body[c] : (base[c] ?? (c === "advanced_enabled" || c === "require_bank_details" ? false : null));
    const conventionsSent = settings.CONVENTIONS.some((c) => body[c] !== undefined);
    const switchingOn = body.advanced_enabled === true && base.advanced_enabled !== true;
    if (conventionsSent && body.advanced_enabled !== true && !(await settings.hasBeenOn(client)))
      throw new AppError("ADVANCED_OFF", "Conventions are set when Advanced Payroll is switched on", 409);
    if (switchingOn) {
      if (!(await statutoryRates.anyInForce(client, body.effective_from)))
        throw new AppError("NO_RATES", "Enter a statutory rate in force from this date first", 409, { effective_from: ["No rate that day"] });
      const unset = settings.REQUIRED_CONVENTIONS.filter((c) => merged[c] === null || merged[c] === undefined);
      if (unset.length)
        throw new AppError("NO_CONVENTIONS", "Set the conventions to switch on", 409, Object.fromEntries(unset.map((c) => [c, ["Pick one"]])));
    }
    const row = await settings.writeVersion(client, body.effective_from, { ...merged, changed_by: actor.user_id || null, reason: body.reason || null });
    const changed = COLUMNS.filter((c) => body[c] !== undefined && body[c] !== (base[c] ?? null));
    await emit(client, {
      key: EVENTS.PAYROLL_SETTING_CHANGED,
      entity: { type: "payroll_setting", id: row.payroll_setting_id },
      actor,
      before: latest ? Object.fromEntries(COLUMNS.map((c) => [c, latest[c] ?? null])) : undefined,
      after: { ...merged, effective_from: body.effective_from },
      payload: { payroll_setting_id: row.payroll_setting_id, effective_from: body.effective_from, changed, advanced_enabled: merged.advanced_enabled },
    });
  });
  return getSettings();
}

/**
 * DELETE /payroll/settings/versions/:effective_from (`payroll.configure`): Remove Change. The version of the setting
 * still to come (a pay day, the switch or the bank rule waiting for its day) is taken back and the version before it runs
 * on. 409 VERSION_IN_FORCE once it has started, or when a run sent for approval, approved or paid was computed with it (it
 * read the pay day at its month's end); 404 for a day no version starts on. Audited as a security event, as a change is.
 */
async function removeSettingsChange(actor, { effective_from: from }) {
  await tx(async (client) => {
    if (from > lagos.today()) await lock.assertVersionUnread(client, from);
    const { removed, reopened } = await settings.removeVersion(client, from);
    const gone = removed[0];
    const runsOn = reopened[0] || null;
    await emit(client, {
      key: EVENTS.PAYROLL_SETTING_REMOVED,
      entity: { type: "payroll_setting", id: gone.payroll_setting_id },
      actor,
      before: { ...Object.fromEntries(COLUMNS.map((c) => [c, gone[c] ?? null])), effective_from: from },
      after: runsOn ? { runs_on: runsOn.payroll_setting_id, effective_from: runsOn.effective_from } : { runs_on: null },
      payload: { payroll_setting_id: gone.payroll_setting_id, effective_from: from, runs_on: runsOn ? runsOn.payroll_setting_id : null },
    });
  });
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
  getSettings,
  changeSettings,
  removeSettingsChange,
  settle,
  sentBack,
  runLabel,
  cardRunChoices,
  cardRunIdOf,
  cardRun,
  assertCardRun,
  monthSummary,
};
