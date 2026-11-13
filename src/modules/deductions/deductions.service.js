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
const { canSee } = require("../../shared/rbac/field-mask");
const lagos = require("../../shared/time/lagos");
const { formatDate, formatMonth } = require("../../shared/time/day-first");
const { oneNamed } = require("../../shared/ai/named");
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

/** A row's source and status in words, as the tab's chips read them. */
const SOURCE_WORDS = Object.freeze({ attendance: "Attendance", fine: "Fines", advance: "Salary advances" });
const STATUS_WORDS = Object.freeze({ pending: "Waiting", active: "Active", settled: "Settled", waived: "Waived" });

/**
 * The deductions in figures for the assistant (docs/guides/praxis-ai.md §6.13, Finance and pay), over what
 * the tab lists with its filters and within the reader's `payroll` scope. The amounts are salary-derived, so a
 * reader who sees them Restricted on the tab is given counts alone (decision 58): no amount figure, each group
 * row's value its count, and deductions rather than naira by month. The grouping asked comes first.
 * @param {{query: Function}} client
 * @param {object} params  DeductionSummaryQuery, parsed
 * @param {object} actor   the asking person with their `payroll` scope
 */
async function aiSummary(client, params, actor, now = new Date()) {
  const { figure, group, series } = require("../../shared/ai/summary");
  const m = require("../../shared/money/money");
  const [r, salary] = await Promise.all([
    repo.aiSummary(client, { ...params, yearStart: `${lagos.today(now).slice(0, 4)}-01-01` }, actor.scope),
    canSee(client, actor, "employee.salary"),
  ]);
  const f = r.figures;
  const money = (v) => m.toWire(v || "0.00");
  const valueOf = (x) => (salary ? money(x.amount) : x.count);
  const figures = [figure("deductions", "Deductions", f.deductions || 0)];
  if (salary) figures.push(figure("amount", "Amount", money(f.amount), "ngn"));
  figures.push(figure("waiting", "Waiting", f.waiting || 0), figure("waived", "Waived", f.waived || 0));
  if (salary)
    figures.push(
      figure("scheduled", "Scheduled ahead", money(r.instalments.scheduled), "ngn"),
      figure("recovered", "Recovered this year", money(r.instalments.recovered), "ngn"),
      figure("advances", "Advances outstanding", money(r.instalments.advances), "ngn"),
    );
  const by = {
    source: group("source", "Deductions by source", r.by_source.map((x) => ({ key: x.key, label: SOURCE_WORDS[x.key] || x.key, value: valueOf(x), count: x.count }))),
    status: group("status", "Deductions by status", r.by_status.map((x) => ({ key: x.key, label: STATUS_WORDS[x.key] || x.key, value: valueOf(x), count: x.count }))),
    department: group("department", "Deductions by department", r.by_department.map((x) => ({ key: x.key, label: x.label, value: valueOf(x), count: x.count }))),
  };
  const first = by[params.by] ? params.by : "source";
  return {
    figures,
    groups: [by[first], ...Object.keys(by).filter((k) => k !== first).map((k) => by[k])],
    series: [
      salary
        ? series("amount", "Amount by month", r.by_month.map((p) => ({ at: p.at, value: money(p.amount) })))
        : series("deductions", "Deductions by month", r.by_month.map((p) => ({ at: p.at, value: p.count }))),
    ],
    total: f.deductions || 0,
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
  return { ...present(before, { grants: await grantsOf(actor), reader: actor }), can_cancel: false };
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

/* ------------------------------------------------------------------ *
 * What the assistant reads and checks (deductions.ai.js, guide §9)
 * ------------------------------------------------------------------ */

/** A fine as a card and its answers name it: the person and the query ("Ada Obi, QRY-0019"), never an amount. */
const fineLabel = (row) => `${row.employee.display_name}, ${row.query_number || row.reason_text}`;

/** The fine a card names, for its chip. Nothing for one that does not exist. */
async function cardFine(db, id) {
  const row = id ? await repo.rowOf(db, "fine", id) : null;
  return row ? [{ type: "deduction", id: row.sanction_fine_id || row.source_id, label: fineLabel(row) }] : [];
}

/**
 * Before the press: the fine still waits (409 FINE_NOT_MOVABLE otherwise, as accepting or waiving says) and is not the
 * asker's own (403 OWN_RECORD, §6.6 rule 8), so a card that cannot go through is refused when it is drawn.
 */
async function assertCardFine(db, id, actor) {
  const row = await repo.rowOf(db, "fine", id);
  if (!row) throw new AppError("NOT_FOUND", "That fine does not exist", 404);
  if (row.employee_id === actor.employee_id) throw new AppError("OWN_RECORD", "Someone else settles your own fine", 403);
  if (row.status !== "pending") throw new AppError("FINE_NOT_MOVABLE", "This fine is no longer waiting", 409);
}

/** Before the press: the person an advance is for exists and is not the asker (403 OWN_RECORD). */
async function assertCardAdvance(db, values, actor) {
  const person = await repo.employeeOf(db, values.employee_id);
  if (!person) throw new AppError("NOT_FOUND", "That person does not exist", 404, { employee_id: ["Pick a person"] });
  if (person.employee_id === actor.employee_id) throw new AppError("OWN_RECORD", "Someone else records your own advance", 403);
}

/** The twelve months a fine or an advance may start in, from the open month (§6.6 rule 2): each month's first day and how a person says it. */
async function startMonths(db) {
  const open = await lock.openPeriod(db);
  return Array.from({ length: 12 }, (_, i) => {
    const period = lagos.addMonths(open, i);
    return { period, name: formatMonth(period) };
  });
}

/** The months to tap under "Which month does it start?": the open month first, as a person names a month ("October 2026"). */
async function startMonthChoices(db) {
  return (await startMonths(db)).map((m) => m.name);
}

/**
 * A start month as a person writes it ("October 2026", "2026-10") or as the form sends it ("2026-10-01"), as its first day;
 * left as written when it is none of the twelve, so the field marks it. A month before the open one is the service's refusal.
 */
async function startMonthOf(db, words) {
  const said = String(words || "").trim();
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(said)) return `${said}-01`;
  const found = oneNamed(await startMonths(db), said, (m) => [m.name, m.period.slice(0, 7)]);
  return found ? found.period : null;
}

module.exports = {
  present,
  list,
  summary,
  aiSummary,
  acceptFine,
  waiveFine,
  releaseFine,
  recordAdvance,
  cancelAdvance,
  fineWaiting,
  fineLabel,
  cardFine,
  assertCardFine,
  assertCardAdvance,
  startMonthChoices,
  startMonthOf,
};
