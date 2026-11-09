"use strict";
/**
 * What Operations & People do with a fine and an advance (docs/guides/payroll.md §3.3, §3.4, §6.6). Each
 * function runs inside the transaction its caller owns (deductions.service.js), emits its event with
 * `emit()` and writes only this module's tables: a fine moves through its owner, `sanctions.fines`, and a
 * run's own rows are asked of payroll's lock.
 *
 *   acceptFine(client, actor, fineId, { months, start_period })
 *                 Accept This Month (one) or Spread Over Months (two to twelve): `sanctions.fines.accept`,
 *                 then a deduction with one instalment a month, the shares from `allocate` so the kobo that do
 *                 not divide go to the first and they sum exactly to the fine
 *   waiveFine     Waive: `sanctions.fines.waive`, nothing is deducted, the person is told
 *   releaseFine   Release: an accepted fine goes back to waiting, only while every instalment is still scheduled
 *   recordAdvance Record Advance: salary paid outside the system, recovered in instalments the same way
 *   cancelAdvance Cancel Advance: an advance recorded in error, while none of its instalments is started
 *
 * Never their own: nobody accepts, waives, releases, records or cancels a deduction for themselves
 * (403 OWN_RECORD). An instalment is started once a run holds it or has applied it; from then on nothing
 * releases or cancels it (409 INSTALMENTS_STARTED).
 *
 * Every write takes the runs of the months it touches first, in month order, and its own rows after, the
 * order a run's lock takes them in; a Compute or a Submit of such a month queues behind the write and
 * reads its instalments after it, never between a read and a freeze (payroll.lock.js). Events carry ids,
 * the months and counts, never an amount (§6.13 rule 5).
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const fines = require("../sanctions/sanctions.fines");
const lock = require("../payroll/payroll.lock");
const calc = require("../payroll/payroll.calc");
const repo = require("./deductions.repo");
const { EVENTS } = require("./deductions.events");

const notFound = (what) => new AppError("NOT_FOUND", `That ${what} does not exist`, 404);

/** Nobody settles their own pay. */
function refuseOwn(actor, employeeId, message) {
  if (employeeId && employeeId === actor.employee_id) throw new AppError("OWN_RECORD", message, 403);
}

/** The months an instalment a month for `months` months from `start` falls in. */
const periodsFrom = (start, months) => Array.from({ length: months }, (_, i) => lagos.addMonths(start, i));

/**
 * What a total spread over months comes to, one instalment a month (§6.6 rule 3): equal shares, the kobo
 * that do not divide going to the first, summing exactly to the total. A total too small to give every month
 * a kobo is refused on the months field, because an instalment of nothing would never be deducted.
 * @param {string} total  the amount on the wire
 * @param {number} months  one to twelve
 * @param {string} start  the first month's first day
 * @returns {{periods: string[], amounts: string[]}}
 */
function plan(total, months, start) {
  const amounts = calc.instalmentShares(total, months);
  if (amounts.some((a) => m.isZero(a)))
    throw new AppError("TOO_MANY_MONTHS", "That amount is too small to spread so far", 422, { months: ["Fewer months"] });
  return { periods: periodsFrom(start, months), amounts };
}

/**
 * The first month is the open month or a later one (§6.6 rule 2), and none of the months already has a run
 * sent for approval. The runs of the months are locked as it checks.
 */
async function assertStart(client, start, months) {
  const open = await lock.openPeriod(client);
  if (start < open)
    throw new AppError("START_NOT_ALLOWED", "Start this month or a later one", 422, { start_period: ["Pick a later month"] });
  await lock.lockMonths(client, periodsFrom(start, months));
}

/** The facts a handler and an audit line need of a deduction just written: ids, months, counts. */
const factsOf = (d, extra = {}) => ({
  payroll_deduction_id: d.payroll_deduction_id,
  sanction_fine_id: d.sanction_fine_id || null,
  employee_id: d.employee_id,
  subject_employee_id: d.employee_id,
  source: d.source,
  instalments: d.instalments,
  start_period: d.start_period,
  reason: d.reason,
  ...extra,
});

/**
 * Accept a pending fine: one month is Accept This Month, two to twelve is Spread Over Months from the month
 * picked. The fine moves through `sanctions.fines.accept` (409 FINE_NOT_MOVABLE for one no longer waiting).
 * @returns {Promise<{source: "fine", id: string}>} the row the tab now shows
 */
async function acceptFine(client, actor, fineId, { months, start_period: start }) {
  await assertStart(client, start, months);
  const fine = await repo.lockFine(client, fineId);
  if (!fine) throw notFound("fine");
  refuseOwn(actor, fine.employee_id, "Someone else accepts your own fine");
  await fines.accept(client, fineId, actor);
  const { periods, amounts } = plan(fine.amount, months, start);
  const d = await repo.insertDeduction(client, {
    employee_id: fine.employee_id,
    source: "sanction_fine",
    sanction_fine_id: fineId,
    reason: fine.reason,
    total_amount: fine.amount,
    instalments: months,
    start_period: start,
    created_by: actor.user_id || null,
  });
  await repo.insertInstalments(client, d.payroll_deduction_id, periods, amounts);
  await emit(client, {
    key: EVENTS.PAYROLL_DEDUCTION_ACCEPTED,
    entity: { type: "deduction", id: fineId },
    actor,
    before: { status: "pending" },
    after: { status: "active", instalments: months, start_period: start },
    payload: factsOf(d, { query_number: fine.query_number }),
  });
  return { source: "fine", id: fineId };
}

/** Waive a pending fine with the reason the person reads: nothing is deducted. */
async function waiveFine(client, actor, fineId, { reason }) {
  const fine = await repo.lockFine(client, fineId);
  if (!fine) throw notFound("fine");
  refuseOwn(actor, fine.employee_id, "Someone else waives your own fine");
  await fines.waive(client, fineId, actor, reason);
  await emit(client, {
    key: EVENTS.PAYROLL_DEDUCTION_WAIVED,
    entity: { type: "deduction", id: fineId },
    actor,
    before: { status: "pending" },
    after: { status: "waived", reason },
    payload: {
      sanction_fine_id: fineId,
      employee_id: fine.employee_id,
      subject_employee_id: fine.employee_id,
      query_number: fine.query_number,
      reason,
    },
  });
  return { source: "fine", id: fineId };
}

/**
 * The deduction a release or a cancel acts on, once its months' runs are held: read as it stands to learn
 * which months, take their runs, then lock the deduction and its instalments and read them again. 404 for
 * one that does not exist; INSTALMENTS_STARTED once any instalment is in a run or applied.
 * @returns {Promise<{d: object, live: object[]}>}
 */
async function lockForUndoing(client, id) {
  const seen = await repo.getDeduction(client, id);
  if (!seen) throw notFound("deduction");
  await lock.lockRunsOf(client, (await repo.instalmentsOf(client, id)).map((i) => i.period));
  const d = await repo.lockDeduction(client, id);
  const live = await repo.instalmentsOf(client, id, { lock: true });
  if (live.some((i) => repo.STARTED.includes(i.status)))
    throw new AppError("INSTALMENTS_STARTED", "A month of this deduction is already in a run", 409);
  return { d, live };
}

/** Release an accepted fine back to waiting, to be accepted again or waived: only while every instalment is still scheduled. */
async function releaseFine(client, actor, deductionId, { reason }) {
  const seen = await repo.getDeduction(client, deductionId);
  if (!seen) throw notFound("deduction");
  if (seen.source !== "sanction_fine") throw new AppError("NOT_A_FINE", "Only a fine goes back to waiting", 422);
  refuseOwn(actor, seen.employee_id, "Someone else releases your own fine");
  const { d } = await lockForUndoing(client, deductionId);
  if (d.status !== "active") throw new AppError("FINE_NOT_MOVABLE", "This fine is no longer accepted", 409);
  const cancelled = await repo.cancelDeduction(client, deductionId, reason);
  await fines.release(client, d.sanction_fine_id, actor, reason);
  await emit(client, {
    key: EVENTS.PAYROLL_DEDUCTION_RELEASED,
    entity: { type: "deduction", id: d.sanction_fine_id },
    actor,
    before: { status: "active" },
    after: { status: "pending", reason },
    payload: factsOf(d, { instalments_cancelled: cancelled, reason }),
  });
  return { source: "fine", id: d.sanction_fine_id };
}

/**
 * Record Advance: salary paid to a person before the month it belongs to, outside this system (§3.4). It is
 * recovered in `months` equal instalments from `start_period`, and the person is told.
 * @returns {Promise<{source: "advance", id: string}>}
 */
async function recordAdvance(client, actor, body) {
  const person = await repo.employeeOf(client, body.employee_id);
  if (!person) throw new AppError("NOT_FOUND", "That person does not exist", 404, { employee_id: ["Pick a person"] });
  refuseOwn(actor, person.employee_id, "Someone else records your own advance");
  if (body.granted_on > lagos.today())
    throw new AppError("GRANTED_IN_THE_FUTURE", "An advance is recorded once it is paid", 422, { granted_on: ["Not in the future"] });
  await assertStart(client, body.start_period, body.months);
  const { periods, amounts } = plan(body.amount, body.months, body.start_period);
  const d = await repo.insertDeduction(client, {
    employee_id: person.employee_id,
    source: "salary_advance",
    reason: body.reason,
    total_amount: body.amount,
    instalments: body.months,
    start_period: body.start_period,
    granted_on: body.granted_on,
    created_by: actor.user_id || null,
  });
  await repo.insertInstalments(client, d.payroll_deduction_id, periods, amounts);
  await emit(client, {
    key: EVENTS.PAYROLL_DEDUCTION_ACCEPTED,
    entity: { type: "deduction", id: d.payroll_deduction_id },
    actor,
    after: { status: "active", source: "salary_advance", instalments: body.months, start_period: body.start_period },
    payload: factsOf(d, { granted_on: body.granted_on }),
  });
  return { source: "advance", id: d.payroll_deduction_id };
}

/** Cancel an advance recorded in error: its instalments are cancelled with it, while none is in a run or applied. */
async function cancelAdvance(client, actor, deductionId, { reason }) {
  const seen = await repo.getDeduction(client, deductionId);
  if (!seen) throw notFound("advance");
  if (seen.source !== "salary_advance") throw new AppError("NOT_AN_ADVANCE", "Only an advance is cancelled; release a fine", 422);
  refuseOwn(actor, seen.employee_id, "Someone else cancels your own advance");
  const { d } = await lockForUndoing(client, deductionId);
  if (d.status !== "active") throw new AppError("NOT_ACTIVE", "This advance is no longer being recovered", 409);
  const cancelled = await repo.cancelDeduction(client, deductionId, reason);
  await emit(client, {
    key: EVENTS.PAYROLL_DEDUCTION_CANCELLED,
    entity: { type: "deduction", id: deductionId },
    actor,
    before: { status: "active" },
    after: { status: "cancelled", reason },
    payload: factsOf(d, { instalments_cancelled: cancelled, reason }),
  });
  return { source: "advance", id: deductionId };
}

module.exports = { plan, periodsFrom, acceptFine, waiveFine, releaseFine, recordAdvance, cancelAdvance };
