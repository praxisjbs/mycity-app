"use strict";
/**
 * The one guard every payroll write goes through, and the two moves that end a submitted run
 * (docs/guides/payroll.md §6.9).
 *
 *   assertEditable(run)    refuses (409 RUN_NOT_EDITABLE) anything on a run that is not a Draft or Computed:
 *                          a Submitted run is with the approver, an Approved or Paid one is locked
 *   defineWrite(name, guard, fn)
 *                          how a write function is made: it locks the run row (`SELECT ... FOR UPDATE`,
 *                          so two people pressing at once queue and the second sees the first's lines),
 *                          runs its guard, then the work. Every write registers in `WRITES`, and a test
 *                          enumerates them and asserts each refuses a run it must not touch (§6.9 rule 4)
 *   applyApproval          the approval ended approved: the lock (§6.9 rule 3)
 *   returnToDraft          the approver sent it back or rejected it, or the opener withdrew it (§6.9 rule 2)
 *
 * The guards a write names:
 *   editable   a Draft or a Computed run (Compute, Exclude, Include, Add Adjustment, Discard)
 *   computed   a Computed run (Submit)
 *   approved   an Approved run (Mark Paid)
 *   submitted  a Submitted run (the approval's two ends)
 *   none       there is no run yet (New Run)
 *
 * Locked means locked: nothing but Mark Paid, Email All Payslips and the exports (PR 4) touches an approved
 * or paid run. A correction after the lock goes into the next run as an adjustment.
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const attendancePay = require("../attendance/attendance.pay");
const fines = require("../sanctions/sanctions.fines");
const repo = require("./payroll.repo");
const { EVENTS } = require("./payroll.events");

/** The statuses a run's contents may change in. */
const EDITABLE = Object.freeze(["draft", "computed"]);

const notFound = () => new AppError("NOT_FOUND", "That payroll run does not exist", 404);

/** @param {{status: string}|null} run */
function assertEditable(run) {
  if (!run) throw notFound();
  if (!EDITABLE.includes(run.status))
    throw new AppError("RUN_NOT_EDITABLE", "This run can no longer be changed", 409);
  return run;
}

const GUARDS = Object.freeze({
  editable: assertEditable,
  computed(run) {
    assertEditable(run);
    if (run.status !== "computed") throw new AppError("RUN_NOT_COMPUTED", "Compute the run first", 409);
    return run;
  },
  approved(run) {
    if (!run) throw notFound();
    if (run.status !== "approved") throw new AppError("NOT_APPROVED", "Only an approved run is marked paid", 409);
    return run;
  },
  submitted(run) {
    if (!run) throw notFound();
    if (run.status !== "submitted") throw new AppError("RUN_NOT_SUBMITTED", "This run is not waiting for approval", 409);
    return run;
  },
});

/** name → the guard it runs, for the test that enumerates every write. */
const WRITES = new Map();

/**
 * Make a write function on one run: lock it, guard it, do the work.
 * @template A
 * @param {string} name
 * @param {"editable"|"computed"|"approved"|"submitted"} guard
 * @param {(client: import("pg").PoolClient, run: object, ...args: A[]) => Promise<any>} fn
 * @returns {(client: import("pg").PoolClient, runId: string, ...args: A[]) => Promise<any>}
 */
function defineWrite(name, guard, fn) {
  if (!GUARDS[guard]) throw new Error(`payroll.lock.defineWrite(${name}): "${guard}" is not a guard`);
  if (WRITES.has(name)) throw new Error(`payroll.lock.defineWrite: "${name}" is already defined`);
  WRITES.set(name, guard);
  return async (client, runId, ...args) => {
    const run = await repo.lockRun(client, runId);
    GUARDS[guard](run);
    return fn(client, run, ...args);
  };
}

/** A write that makes a run: it has no run to lock, so it is on the list with the guard `none`. */
function defineCreate(name, fn) {
  if (WRITES.has(name)) throw new Error(`payroll.lock.defineCreate: "${name}" is already defined`);
  WRITES.set(name, "none");
  return fn;
}

/* ------------------------------------------------------------------ *
 * The two ends of a submitted run
 * ------------------------------------------------------------------ */

/**
 * The approval ended approved: lock the run (§6.9 rule 3), in the transaction the caller owns.
 *
 *   the instalments it froze are applied; a deduction whose last instalment this was is settled, and a fine
 *   among them settled through its owner (`sanctions.fines.settle`); the run is `approved` with who approved
 *   it and when; every payslip that is not excluded is published (its number was given at Compute); and
 *   `payroll_run.approved` and one `payslip.published` per person are emitted. The pay items stay `in_run`.
 *
 * @param {{approver_user_id: string|null}} how  the user who approved it, from the approval's decision
 */
const applyApproval = defineWrite("applyApproval", "submitted", async (client, run, { approver_user_id: approver }) => {
  const runId = run.payroll_run_id;
  await repo.applyInstalments(client, runId);
  for (const d of await repo.settleFinished(client, runId)) {
    if (d.sanction_fine_id) {
      try {
        await fines.settle(client, d.sanction_fine_id, approver);
      } catch (err) {
        // A fine settled or waived by hand in the meantime is not a reason to leave a run unlocked.
        if (err.code !== "FINE_NOT_MOVABLE") throw err;
      }
    }
    await emit(client, {
      key: EVENTS.PAYROLL_DEDUCTION_SETTLED,
      entity: { type: "deduction", id: d.payroll_deduction_id },
      actor: approver,
      after: { status: "settled", source: d.source },
      payload: { payroll_deduction_id: d.payroll_deduction_id, employee_id: d.employee_id, subject_employee_id: d.employee_id, payroll_run_id: runId },
    });
  }
  await repo.setRun(client, runId, { status: "approved", approved_at: "now", approved_by: approver });
  const published = await repo.publishPayslips(client, runId);
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_APPROVED,
    entity: { type: "payroll_run", id: runId },
    actor: approver,
    before: { status: "submitted" },
    after: { status: "approved", headcount: run.headcount },
    payload: { payroll_run_id: runId, number: run.number, period: run.period, headcount: published.length },
  });
  for (const p of published)
    await emit(client, {
      key: EVENTS.PAYSLIP_PUBLISHED,
      entity: { type: "payslip", id: p.payslip_id },
      actor: null,
      after: { status: "published" },
      payload: {
        payslip_id: p.payslip_id,
        payroll_run_id: runId,
        employee_id: p.employee_id,
        subject_employee_id: p.employee_id,
        number: p.number,
        period: run.period,
      },
    });
  return { published: published.length };
});

/**
 * The approver sent the run back or rejected it, or its opener withdrew the approval: everything frozen is
 * released and the run is a Draft again with the reason (§6.9 rule 2). Pay items go back to pending (or
 * confirmed, for overtime) through attendance's own function, instalments back to scheduled. The lines stay
 * as Compute left them; the run says it must be computed again.
 * @param {{reason: string|null, actor?: object|string|null}} how
 */
const returnToDraft = defineWrite("returnToDraft", "submitted", async (client, run, { reason, actor = null }) => {
  const runId = run.payroll_run_id;
  const items = await attendancePay.releaseFromRun(client, runId, actor);
  const instalments = await repo.releaseInstalments(client, runId);
  await repo.setRun(client, runId, { status: "draft", returned_reason: reason || null, submitted_at: null, submitted_by: null });
  await emit(client, {
    key: EVENTS.PAYROLL_RUN_RETURNED,
    entity: { type: "payroll_run", id: runId },
    actor,
    before: { status: "submitted" },
    after: { status: "draft", reason: reason || null },
    payload: {
      payroll_run_id: runId,
      number: run.number,
      period: run.period,
      reason: reason || null,
      items_released: items.released,
      instalments_released: instalments,
    },
  });
  return { items: items.released, instalments };
});

module.exports = { EDITABLE, WRITES, assertEditable, defineWrite, defineCreate, applyApproval, returnToDraft };
