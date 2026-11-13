"use strict";
/**
 * A run's moves, each inside the transaction the service owns (docs/guides/payroll.md §6.9): open, compute,
 * exclude and include a person, add and remove an adjustment, submit, discard, mark paid. Every write is
 * made with `payroll.lock.defineWrite`, so each locks the run row and refuses a run it must not touch
 * before it does anything; the test that enumerates `WRITES` holds this file to that.
 *
 * `computeInto` builds every payslip and line for the month from the owners' records. It is not a write on
 * its own and is not exported: Compute and Submit both call it, inside the run's lock.
 *
 * A run is Compute's idempotent product: pressed twice with nothing changed it writes the same lines and
 * totals to the kobo, and it never changes adjustments, exclusions or what the run's earlier status holds.
 * What it reads of the month is fixed in the order the people and items are loaded, never by an arrival
 * time, so the same inputs make the same lines.
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const lagos = require("../../shared/time/lagos");
const m = require("../../shared/money/money");
const engine = require("../../shared/workflow/engine");
const attendancePay = require("../attendance/attendance.pay");
const statutoryRates = require("../statutory/statutory.rates");
const statutoryRepo = require("../statutory/statutory.repo");
const rentDeclarations = require("../organisation/employee.rent");
const structure = require("../salary_structure/salary_structure.repo");
const calc = require("./payroll.calc");
const settings = require("./payroll.config.repo");
const inputs = require("./payroll.inputs");
const repo = require("./payroll.repo");
const lock = require("./payroll.lock");
const { EVENTS, DEFINITION_KEY } = require("./payroll.events");

const ZERO = m.toWire(0);

/** Group rows by a key, keeping their order. */
function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const list = out.get(r[key]);
    if (list) list.push(r);
    else out.set(r[key], [r]);
  }
  return out;
}

/** The last four digits of an account number, or null with none. */
const last4 = (account) => (account && String(account).trim() ? String(account).trim().slice(-4) : null);

/** The employee's payslip with nothing on it: an excluded person, or one with no salary to pay from. */
const emptyRow = (person, number, extra = {}) => ({
  employee_id: person.employee_id,
  number,
  status: "draft",
  excluded_reason: null,
  gross_monthly: person.gross_monthly ?? null,
  working_days: null,
  working_days_paid: null,
  earnings_total: ZERO,
  deductions_total: ZERO,
  net_pay: ZERO,
  employer_total: ZERO,
  bank_name: person.bank_name || null,
  account_last4: last4(person.account_number),
  taxable_pay: null,
  ...extra,
});

/**
 * Each person's PAYE year to date before the run's month (§6.12 rule 11, §13.1 item 42): what MyCity's advanced runs of
 * the year sent for approval, approved or paid kept and deducted (payroll.inputs yearToDateFor), plus the Pay to Date
 * entered for the year (a leaving certificate, or MyCity's own months before the option was on). A person with neither
 * starts at nothing.
 * @returns {Promise<Map<string, {taxable_pay: string, tax: string}>>}
 */
async function yearToDate(client, ids, period) {
  const ran = await inputs.yearToDateFor(client, ids, period);
  const entered = await statutoryRepo.payToDateFor(client, ids, Number(period.slice(0, 4)));
  const out = new Map();
  for (const id of ids) {
    const a = ran.get(id);
    const b = entered.get(id);
    if (!a && !b) continue;
    out.set(id, {
      taxable_pay: m.toWire(m.sum([a ? a.taxable_pay : "0", b ? b.taxable_pay : "0"])),
      tax: m.toWire(m.sum([a ? a.tax : "0", b ? b.tax : "0"])),
    });
  }
  return out;
}

/**
 * One person's month into a payslip row and its lines (§6.3 to §6.8). Pure but for the person's working
 * days, which attendance counts. `month` is the run's shared context.
 * @returns {{row: object, lines: object[], itemIds: string[], instalmentIds: string[]}}
 */
async function buildPayslip(client, person, number, month) {
  const { first, last, shared, prices } = month;
  const mine = { itemIds: [], instalmentIds: [] };
  if (person.gross_monthly === null || person.gross_monthly === undefined) return { row: emptyRow(person, number), lines: [], ...mine };

  const rates = await attendancePay.monthRates(client, person, first, shared);
  const part = calc.paidPart(rates.working_dates, { first, last, from: person.start_date, to: person.left_on || last });

  // Attendance: confirmed overtime and pending deductions, each at the amount attendance priced (or now).
  const overtime = [];
  const deductions = {};
  const absenceDates = new Set();
  for (const item of month.items.get(person.employee_id) || []) {
    const amount = item.amount ?? prices.get(item.attendance_pay_item_id) ?? null;
    if (amount === null) continue;
    mine.itemIds.push(item.attendance_pay_item_id);
    if (item.kind === "overtime") overtime.push({ id: item.attendance_pay_item_id, amount });
    else {
      (deductions[item.kind] ||= []).push({ id: item.attendance_pay_item_id, amount });
      if (item.kind === "absence") absenceDates.add(item.work_date);
    }
  }

  // Unpaid leave: the days inside the month times the daily rate, once per request (§6.5 rule 1).
  const unpaidLeave = [];
  for (const l of month.leaves.get(person.employee_id) || []) {
    const from = l.starts_on > first ? l.starts_on : first;
    const to = l.ends_on < last ? l.ends_on : last;
    const wholly = l.starts_on >= first && l.ends_on <= last;
    const days = wholly ? l.days : rates.working_dates.filter((d) => d >= from && d <= to).length;
    unpaidLeave.push({ id: l.leave_request_id, days, from, to, amount: calc.daysAmount(person.gross_monthly, rates.working_days, days) });
  }

  // Unpaid suspension: working days inside the overlap, not a day already counted as absent (§6.5 rule 2).
  const unpaidSuspension = [];
  for (const s of month.suspensions.get(person.employee_id) || []) {
    const from = s.starts_on > first ? s.starts_on : first;
    const to = s.ends_on < last ? s.ends_on : last;
    const days = rates.working_dates.filter((d) => d >= from && d <= to && !absenceDates.has(d)).length;
    unpaidSuspension.push({ id: s.sanction_id, days, from, to, amount: calc.daysAmount(person.gross_monthly, rates.working_days, days) });
  }

  // Fines and advances: each instalment due is one line (§6.6 rule 7).
  const instalments = (month.instalments.get(person.employee_id) || []).map((i) => {
    mine.instalmentIds.push(i.payroll_deduction_instalment_id);
    const nth = `${i.ordinal} of ${i.of}`;
    return {
      id: i.payroll_deduction_instalment_id,
      code: i.source === "salary_advance" ? "advance" : "fine",
      amount: i.amount,
      detail: i.query_number ? `${i.query_number}, ${nth}` : nth,
    };
  });

  const adjustments = (month.adjustments.get(person.employee_id) || []).map((a) => ({
    id: a.payroll_adjustment_id,
    kind: a.kind,
    label: a.label,
    amount: a.amount,
  }));

  // Advanced mode (§6.11 rule 6): the person's pay split, used only while it adds up to their gross as it stands; with
  // none, their Monthly Pay is the whole base and the run warns No Pay Split. The statutory items read the person's NHF
  // choice, their year to date and their declared rent for the year (§6.12 rules 11 and 15).
  let components = null;
  let statutory = null;
  if (month.statutory) {
    const split = month.splits.get(person.employee_id) || [];
    if (split.length && m.compare(m.sum(split.map((c) => c.amount)), person.gross_monthly) === 0)
      components = split.map((c) => ({ id: c.employee_pay_component_id, code: c.code, label: c.label, amount: c.amount, pensionable: c.pensionable === true }));
    statutory = {
      ...month.statutory,
      nhf_contributes: person.nhf_contributes === true,
      to_date: month.toDate.get(person.employee_id) || calc.NOTHING_TO_DATE,
      year_rent: month.rents.get(person.employee_id) ?? null,
    };
  }

  const { lines, taxable_pay: taxablePay } = calc.payslipOf({
    gross: person.gross_monthly,
    part,
    overtime,
    deductions,
    unpaidLeave,
    unpaidSuspension,
    instalments,
    adjustments,
    components,
    statutory,
  });
  const row = emptyRow(person, number, {
    working_days: part.workingDays,
    working_days_paid: part.daysPaid,
    taxable_pay: taxablePay,
    ...calc.totalsOf(lines),
  });
  return { row, lines, ...mine };
}

/**
 * Build every payslip and line of a run from the month's records, replace what Compute wrote before, and
 * leave the run Computed with its totals (§3.1 step 3). Called with the run locked and editable.
 * @param {import("pg").PoolClient} client
 * @param {object} run  the locked run row
 * @returns {Promise<{totals: object, itemIds: string[], instalmentIds: string[], setting: object}>}
 */
async function computeInto(client, run) {
  const runId = run.payroll_run_id;
  const { first, last } = lagos.monthBounds(run.period);
  const setting = await settings.settingOn(client, first);

  const people = await inputs.peopleFor(client, first, last);
  const ids = people.map((p) => p.employee_id);
  const prior = new Map((await repo.payslipsOf(client, runId)).map((p) => [p.employee_id, p]));

  // The mode is the setting's on the month's first day; the figures and the splits are those in force on its last day
  // (§6.11 rule 2, §6.12). What is missing is listed (No Rates Set): the items that have figures are computed, and Submit
  // refuses the run. PAYE is cumulative over the calendar year (§6.12 rule 11): the run's month of the year scales the
  // bands, and each person's year to date and declared rent are read for it.
  const advanced = setting.advanced_enabled === true;
  const rated = advanced ? await statutoryRates.ratesOn(client, last) : { rates: {}, rows: [], misbased: [] };
  const missing = advanced ? calc.statutoryMissing(rated) : [];

  const items = await inputs.payItemsFor(client, ids, last);
  const unpriced = items.filter((i) => i.amount === null);
  const month = {
    first,
    last,
    shared: await attendancePay.monthContext(client, first),
    prices: unpriced.length ? await attendancePay.pricesOf(client, unpriced) : new Map(),
    items: groupBy(items, "employee_id"),
    leaves: groupBy(await inputs.unpaidLeaveFor(client, ids, first, last), "employee_id"),
    suspensions: groupBy(await inputs.unpaidSuspensionsFor(client, ids, first, last), "employee_id"),
    instalments: groupBy(await inputs.instalmentsFor(client, ids, run.period, last), "employee_id"),
    adjustments: groupBy(await repo.adjustmentsOf(client, runId), "employee_id"),
    statutory: advanced ? { rates: rated.rates, month: Number(run.period.slice(5, 7)) } : null,
    splits: advanced ? groupBy(await structure.splitsFor(client, ids, last), "employee_id") : new Map(),
    toDate: advanced ? await yearToDate(client, ids, run.period) : new Map(),
    rents: advanced ? await rentDeclarations.yearRentsFor(client, ids, Number(run.period.slice(0, 4))) : new Map(),
  };

  const rows = [];
  const lines = [];
  const lineRows = [];
  const itemIds = [];
  const instalmentIds = [];
  for (const person of people) {
    const was = prior.get(person.employee_id) || null;
    const number = was ? was.number : (await numbering.allocate(client, "payslip", { date: run.period })).number;
    if (was && was.status === "excluded") {
      rows.push(emptyRow(person, number, { status: "excluded", excluded_reason: was.excluded_reason }));
      continue;
    }
    const made = await buildPayslip(client, person, number, month);
    rows.push(made.row);
    lineRows.push({ employee_id: person.employee_id, lines: made.lines });
    itemIds.push(...made.itemIds);
    instalmentIds.push(...made.instalmentIds);
  }

  // A person no longer paid in the month (their dates changed) has no payslip any more.
  const paid = new Set(ids);
  await repo.deletePayslips(client, runId, [...prior.keys()].filter((id) => !paid.has(id)));
  const payslipIds = await repo.upsertPayslips(client, runId, rows);
  for (const { employee_id: id, lines: made } of lineRows)
    for (const l of made) lines.push({ ...l, payslip_id: payslipIds.get(id) });
  await repo.replaceLines(client, runId, lines);

  const totals = calc.sumTotals(rows);
  await repo.setRun(client, runId, {
    status: "computed",
    advanced,
    headcount: totals.headcount,
    earnings_total: totals.earnings_total,
    deductions_total: totals.deductions_total,
    net_total: totals.net_total,
    employer_total: totals.employer_total,
    computed_at: "now",
    config_snapshot: {
      payroll_setting_id: setting.payroll_setting_id,
      advanced,
      require_bank_details: setting.require_bank_details === true,
      pay_day: settings.payDayOf(setting),
      pay_day_is_default: !setting.pay_day,
      // The figures an advanced run was computed with and how PAYE was worked out, so a locked run is explained after
      // they change (the report prints them). `cumulative`: on the year to date, the bands scaled to the months elapsed.
      ...(advanced && {
        paye_method: "cumulative",
        statutory_missing: missing,
        statutory_rates: rated.rows.map((r) => ({
          item: r.item,
          base: r.base,
          rate: r.rate,
          band_from: r.band_from,
          band_to: r.band_to,
          flat_amount: r.flat_amount,
          position: r.position,
          effective_from: r.effective_from,
          // Where the figure came from (§6.12 rule 12), so the report says it of a run long after it changes.
          ...statutoryRates.sourceOf(r),
        })),
      }),
    },
  });
  return { totals, itemIds, instalmentIds, setting };
}

/* ------------------------------------------------------------------ *
 * The moves
 * ------------------------------------------------------------------ */

/**
 * New Run: the month, as its first day (§5). One run per month, ever (409 RUN_EXISTS); not a month after
 * the current one in Lagos, nor one before anyone started (422 PERIOD_NOT_ALLOWED). The number is the
 * period's, allocated in this transaction.
 * @param {import("pg").PoolClient} client
 * @param {{period: string, actor: object}} args
 * @returns {Promise<string>} the new run's id
 */
const createRun = lock.defineCreate("createRun", async (client, { period, actor }) => {
  const thisMonth = lagos.monthBounds(lagos.today()).first;
  const earliest = await repo.earliestStart(client);
  if (period > thisMonth || !earliest || period < earliest)
    throw new AppError("PERIOD_NOT_ALLOWED", "Pick a month from the first start to this month", 422, { period: ["Pick another month"] });
  const exists = await repo.runOfPeriod(client, period);
  const taken = () => new AppError("RUN_EXISTS", "This month already has a run", 409, { period: ["Already has a run"] });
  if (exists) throw taken();
  const { number } = await numbering.allocate(client, "payroll_run", { date: period });
  let made;
  try {
    made = await repo.insertRun(client, { number, period });
  } catch (err) {
    // A second New Run for the month that raced this one waited on the unique period, and lost.
    if (err.code === "23505") throw taken();
    throw err;
  }
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_CREATED,
    entity: { type: "payroll_run", id: made.payroll_run_id },
    actor,
    after: { number, period, status: "draft" },
    payload: { payroll_run_id: made.payroll_run_id, number, period },
  });
  return made.payroll_run_id;
});

/**
 * Compute Run: Draft or Computed (409 RUN_NOT_EDITABLE otherwise). Idempotent.
 * @returns {Promise<{headcount: number}>}
 */
const computeRun = lock.defineWrite("computeRun", "editable", async (client, run, { actor }) => {
  const { totals } = await computeInto(client, run);
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_COMPUTED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    before: { status: run.status },
    after: { status: "computed", headcount: totals.headcount },
    payload: { payroll_run_id: run.payroll_run_id, number: run.number, period: run.period, headcount: totals.headcount },
  });
  return { headcount: totals.headcount };
});

/** The run goes back to Draft because something it was computed from changed (§6.9): totals follow its payslips. */
async function backToDraft(client, run) {
  const totals = await repo.totalsOfRun(client, run.payroll_run_id);
  await repo.setRun(client, run.payroll_run_id, { status: "draft", ...totals });
}

/** A person who is paid in the run's month, or a 422 saying they are not. */
async function paidIn(client, run, employeeId) {
  const { first, last } = lagos.monthBounds(run.period);
  const [person] = await inputs.peopleFor(client, first, last, [employeeId]);
  if (!person) throw new AppError("NOT_IN_RUN", "This person is not paid in this month", 422, { employee_id: ["Not paid this month"] });
  return person;
}

/** Exclude: leave one person out of the run, with the reason; the run must be computed again. */
const excludePerson = lock.defineWrite("excludePerson", "editable", async (client, run, { employee_id: employeeId, reason, actor }) => {
  const person = await paidIn(client, run, employeeId);
  const was = await repo.payslipOf(client, run.payroll_run_id, employeeId);
  const number = was ? was.number : (await numbering.allocate(client, "payslip", { date: run.period })).number;
  const slip = await repo.setExcluded(client, run.payroll_run_id, employeeId, { number, reason });
  await backToDraft(client, run);
  await emit(client, {
    key: EVENTS.PAYSLIP_EXCLUDED,
    entity: { type: "payslip", id: slip.payslip_id },
    actor,
    after: { status: "excluded", reason },
    payload: { payslip_id: slip.payslip_id, payroll_run_id: run.payroll_run_id, employee_id: person.employee_id, period: run.period },
  });
});

/** Include: put an excluded person back; the next Compute builds their lines. */
const includePerson = lock.defineWrite("includePerson", "editable", async (client, run, { employee_id: employeeId, actor }) => {
  const slip = await repo.setExcluded(client, run.payroll_run_id, employeeId, { number: null, reason: null });
  if (!slip) throw new AppError("NOT_EXCLUDED", "This person is not left out of the run", 404);
  await backToDraft(client, run);
  await emit(client, {
    key: EVENTS.PAYSLIP_INCLUDED,
    entity: { type: "payslip", id: slip.payslip_id },
    actor,
    after: { status: "draft" },
    payload: { payslip_id: slip.payslip_id, payroll_run_id: run.payroll_run_id, employee_id: employeeId, period: run.period },
  });
});

/** Add Adjustment: a one-off earning or deduction on a person paid in the run; the run goes back to Draft. */
const addAdjustment = lock.defineWrite("addAdjustment", "editable", async (client, run, { body, actor }) => {
  await paidIn(client, run, body.employee_id);
  const was = await repo.payslipOf(client, run.payroll_run_id, body.employee_id);
  if (was && was.status === "excluded")
    throw new AppError("NOT_IN_RUN", "This person is left out of the run", 422, { employee_id: ["Left out of this run"] });
  const made = await repo.insertAdjustment(client, { ...body, payroll_run_id: run.payroll_run_id, created_by: actor.user_id });
  await backToDraft(client, run);
  await emit(client, {
    key: EVENTS.PAYROLL_ADJUSTMENT_ADDED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    after: { kind: body.kind, label: body.label },
    payload: {
      payroll_run_id: run.payroll_run_id,
      payroll_adjustment_id: made.payroll_adjustment_id,
      employee_id: body.employee_id,
      period: run.period,
      kind: body.kind,
    },
  });
  return made.payroll_adjustment_id;
});

/** Remove an adjustment of the run; the run goes back to Draft. */
const removeAdjustment = lock.defineWrite("removeAdjustment", "editable", async (client, run, { adjustment_id: id, actor }) => {
  const gone = await repo.deleteAdjustment(client, run.payroll_run_id, id);
  if (!gone) throw new AppError("NOT_FOUND", "That adjustment does not exist", 404);
  await backToDraft(client, run);
  await emit(client, {
    key: EVENTS.PAYROLL_ADJUSTMENT_REMOVED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    before: { kind: gone.kind, label: gone.label },
    payload: { payroll_run_id: run.payroll_run_id, payroll_adjustment_id: id, employee_id: gone.employee_id, period: run.period, kind: gone.kind },
  });
});

/**
 * Submit for Approval (§3.1 step 5, §6.9 rules 1 and 7): compute again in this transaction, then refuse
 * if there is no one to pay (422 NO_ONE_TO_PAY), a blocking problem stands (422 RUN_HAS_PROBLEMS) or the
 * net differs from the one the person saw (409 RUN_CHANGED). A refusal is *returned*, not thrown, so the
 * service commits the recompute first and the screen reads the figures that now stand. Otherwise: freeze
 * the pay items it counted (attendance's `takeIntoRun`) and the month's instalments, open `payroll.run`
 * for the CEO and mark the run Submitted.
 * @returns {Promise<{refusal: AppError}|{instance_id: string}>}
 */
const submitRun = lock.defineWrite("submitRun", "computed", async (client, run, { expected_net_total: expected, actor }) => {
  const runId = run.payroll_run_id;
  const { totals, itemIds, instalmentIds } = await computeInto(client, run);
  if (totals.headcount === 0) return { refusal: new AppError("NO_ONE_TO_PAY", "No one to pay this month", 422) };
  const counts = (await repo.problemCounts(client, [runId])).get(runId);
  if (counts && counts.blocking > 0)
    return { refusal: new AppError("RUN_HAS_PROBLEMS", "Fix the blocking problems first", 422, { problems: [`${counts.blocking} blocking`] }) };
  if (expected !== undefined && expected !== null && m.toWire(expected) !== totals.net_total)
    return { refusal: new AppError("RUN_CHANGED", "The totals changed. Check them and send again", 409), totals };

  await attendancePay.takeIntoRun(client, { run_id: runId, items: itemIds, actor });
  await repo.freezeInstalments(client, runId, instalmentIds);
  const instance = await engine.openInstance(client, {
    definition_key: DEFINITION_KEY,
    entity: { type: "payroll_run", id: runId },
    subject_employee_id: null,
    context: { net_total: totals.net_total },
    actor,
  });
  await repo.setRun(client, runId, {
    status: "submitted",
    submitted_at: "now",
    submitted_by: actor.user_id,
    returned_reason: null,
    workflow_instance_id: instance.workflow_instance_id,
  });
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_SUBMITTED,
    entity: { type: "payroll_run", id: runId },
    actor,
    before: { status: "computed" },
    after: { status: "submitted", headcount: totals.headcount },
    payload: {
      payroll_run_id: runId,
      number: run.number,
      period: run.period,
      headcount: totals.headcount,
      items_frozen: itemIds.length,
      instalments_frozen: instalmentIds.length,
      instance_id: instance.workflow_instance_id,
    },
  });
  return { instance_id: instance.workflow_instance_id };
});

/** Discard: a run never sent, Draft or Computed. Nothing was frozen, so nothing is released; the number is free again. */
const discardRun = lock.defineWrite("discardRun", "editable", async (client, run, { actor }) => {
  await repo.deleteRun(client, run.payroll_run_id);
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_DISCARDED,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    before: { number: run.number, period: run.period, status: run.status },
    payload: { payroll_run_id: run.payroll_run_id, number: run.number, period: run.period },
  });
});

/** Mark Paid: the day the money was transferred (not in the future in Lagos) and, if they wish, the bank's reference. */
const markPaid = lock.defineWrite("markPaid", "approved", async (client, run, { body, actor }) => {
  if (body.paid_on > lagos.today())
    throw new AppError("PAID_IN_THE_FUTURE", "The payment date cannot be in the future", 422, { paid_on: ["Date too late"] });
  await repo.setRun(client, run.payroll_run_id, {
    status: "paid",
    paid_on: body.paid_on,
    payment_reference: body.payment_reference || null,
    paid_by: actor.user_id,
  });
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_PAID,
    entity: { type: "payroll_run", id: run.payroll_run_id },
    actor,
    before: { status: "approved" },
    after: { status: "paid", paid_on: body.paid_on },
    payload: { payroll_run_id: run.payroll_run_id, number: run.number, period: run.period, paid_on: body.paid_on },
  });
});

module.exports = {
  createRun,
  computeRun,
  excludePerson,
  includePerson,
  addAdjustment,
  removeAdjustment,
  submitRun,
  discardRun,
  markPaid,
};
