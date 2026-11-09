"use strict";
/**
 * Deductions: the transaction around each press and what a reader is shown (docs/guides/payroll.md §3.3,
 * §3.4, §5, §6.6). The rules are deductions.acceptance.js, the SQL deductions.repo.js; this file owns the
 * transaction and the events they emit commit with.
 *
 *   list, summary                               what the tab reads: the union, 25 a page, and the figures
 *   acceptFine, waiveFine, releaseFine,
 *   recordAdvance, cancelAdvance                what its buttons do; each answers the row as the tab now shows it
 *   fineWaiting                                 after a sanction with a fine is issued: tell payroll
 *
 * The salary-derived amounts leave under the name the salary mask governs (`pay_amount`); the controller
 * masks them for a reader without `employee.salary`, so they reach the screen as Restricted. `can_*` says what
 * this reader may press now: their grant, the row's state, and never their own (§6.6 rule 8).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const lock = require("../payroll/payroll.lock");
const repo = require("./deductions.repo");
const acceptance = require("./deductions.acceptance");
const { EVENTS } = require("./deductions.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (at) => (at ? new Date(at).toISOString() : null);

/** What an attendance item is called in the list: its kind and its day. */
const ATTENDANCE_WORDS = Object.freeze({ late: "Late arrival", early_departure: "Early departure", absence: "Absence" });

/** What the reader may press: their grants on payroll (the row's state is the other half). */
async function grantsOf(user) {
  const edit = await scopeFor(user, "payroll", "edit");
  return { edit: Boolean(edit) };
}

/**
 * A repo row as the contract's DeductionRow. An attendance row is listed here but waived on People ·
 * Attendance, so it offers nothing. A fine offers Accept and Waive while it waits and Release while it is
 * accepted and no month of it is started; an advance offers Cancel on the same rule; none to the person it
 * is about.
 */
function present(row, { grants, reader }) {
  const mine = row.employee_id === reader.employee_id;
  const may = grants.edit && !mine;
  const fine = row.source === "fine";
  const waiting = row.status === "pending" && fine;
  const running = row.status === "active" && !row.started;
  return {
    source: row.source,
    source_id: row.source_id,
    sanction_fine_id: row.sanction_fine_id,
    payroll_deduction_id: row.payroll_deduction_id,
    employee: row.employee,
    reason: row.source === "attendance" ? `${ATTENDANCE_WORDS[row.kind]}, ${formatDate(row.work_date)}` : row.reason_text,
    pay_amount: row.amount,
    salary_set: row.salary_set,
    period: row.period,
    instalments: row.instalments,
    instalments_applied: row.instalments_applied,
    status: row.status,
    query_number: row.query_number,
    created_at: iso(row.created_at),
    can_accept: may && waiting,
    can_waive: may && waiting,
    can_release: may && fine && running,
    can_cancel: may && row.source === "advance" && running,
  };
}

/* ------------------------------------------------------------------ *
 * What the tab reads
 * ------------------------------------------------------------------ */

/** GET /deductions: one page of the union, 25 a page. */
async function list(user, query) {
  const [page, grants] = await Promise.all([repo.list(pool, query), grantsOf(user)]);
  return { ...page, data: page.data.map((r) => present(r, { grants, reader: user })) };
}

/** GET /deductions/summary: Pending Fines, Pending Attendance, Active, Recovered This Year, and the open month. */
async function summary() {
  const year = lagos.today().slice(0, 4);
  const [r, open] = await Promise.all([repo.summary(pool, `${year}-01-01`), lock.openPeriod(pool)]);
  const figure = (count, amount) => ({ count, pay_amount: amount });
  return {
    open_period: open,
    pending_fines: figure(r.fines_count, r.fines_amount),
    pending_attendance: figure(r.attendance_count, r.attendance_amount),
    active: figure(r.active_count, r.active_amount),
    recovered_this_year: figure(r.recovered_count, r.recovered_amount),
  };
}

/** The row a press changed, as the tab now shows it, for the press's answer. */
async function answer(user, { source, id }) {
  const [row, grants] = await Promise.all([repo.rowOf(pool, source, id), grantsOf(user)]);
  if (!row) throw new AppError("NOT_FOUND", "That deduction is no longer listed", 404);
  return present(row, { grants, reader: user });
}

/* ------------------------------------------------------------------ *
 * What its buttons do
 * ------------------------------------------------------------------ */

/** Accept This Month, or Spread Over Months from the month picked. */
async function acceptFine(actor, fineId, body) {
  return answer(actor, await tx((client) => acceptance.acceptFine(client, actor, fineId, body)));
}

/** Waive a pending fine with a reason. */
async function waiveFine(actor, fineId, body) {
  return answer(actor, await tx((client) => acceptance.waiveFine(client, actor, fineId, body)));
}

/** Release an accepted fine back to waiting. */
async function releaseFine(actor, deductionId, body) {
  return answer(actor, await tx((client) => acceptance.releaseFine(client, actor, deductionId, body)));
}

/** Record Advance. */
async function recordAdvance(actor, body) {
  return answer(actor, await tx((client) => acceptance.recordAdvance(client, actor, body)));
}

/** Cancel an advance recorded in error. It is no longer listed once cancelled, so the answer is the advance as it stood. */
async function cancelAdvance(actor, deductionId, body) {
  const before = await repo.rowOf(pool, "advance", deductionId);
  await tx((client) => acceptance.cancelAdvance(client, actor, deductionId, body));
  const grants = await grantsOf(actor);
  const row = { ...before, status: before.status, started: false };
  return { ...present(row, { grants, reader: actor }), can_cancel: false };
}

/* ------------------------------------------------------------------ *
 * After a sanction with a fine is issued (deductions.events.js)
 * ------------------------------------------------------------------ */

/**
 * Tell the people who accept fines that one is waiting. Runs after the sanction commits, from its outbox
 * handler; the event it writes carries the person and the query, never the amount, and a retry writes one
 * notice once (`dedup_key`).
 * @param {{sanction_id: string}} payload  the sanction.issued payload
 */
async function fineWaiting(payload) {
  await tx(async (client) => {
    const fine = await repo.fineOfSanction(client, payload.sanction_id);
    if (!fine) return;
    await emit(client, {
      key: EVENTS.PAYROLL_DEDUCTION_FINE_PENDING,
      entity: { type: "deduction", id: fine.sanction_fine_id },
      actor: null,
      payload: {
        sanction_fine_id: fine.sanction_fine_id,
        sanction_id: payload.sanction_id,
        employee_name: fine.employee_name,
        query_number: fine.query_number,
      },
      dedup_key: `deductions.fine_pending:${fine.sanction_fine_id}`,
    });
  });
}

module.exports = { present, list, summary, acceptFine, waiveFine, releaseFine, recordAdvance, cancelAdvance, fineWaiting };
