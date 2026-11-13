"use strict";
/**
 * Payslips' SQL (docs/guides/payroll.md §4, §5, §6.10): the lists and one payslip Payroll readers and the
 * person read, the lines behind it, the pay items behind a grouped line, the person's own deductions, and
 * what the PDF, Email All and Download All walk. Parameterised, no business rules, no events: the rows are
 * written by payroll's Compute and lock (payroll.repo.js), and this file only marks a payslip's PDF and the
 * mail sent for it.
 *
 * Every list pages at 25 through `shared/http/paged.js`. A set that must be held whole (a run's payslips to
 * print, one person's year) is `completeQuery` with its reason and a ceiling, never shown as a list.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** The most payslips one run, or one person's year, holds. */
const MAX_PAYSLIPS = 5000;
/** The most lines a set of payslips printed together may hold (a payslip has a dozen at most). */
const MAX_LINES = MAX_PAYSLIPS * 40;
/** How many payslips one pass of Email All takes (the page size, so a retry never holds a run's worth at once). */
const MAIL_BATCH = 25;

/** The groups: a line whose amount is the sum of several pay items, found again by run, person and kind. */
const GROUPS = Object.freeze({ overtime: "overtime", lateness: "late", early_departure: "early_departure", absence: "absence" });

const PAYSLIP_JOINS = `JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
  JOIN employee e ON e.employee_id = p.employee_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

/** A payslip as a list row shows it (the contract's Payslip, before the service names the salary fields). */
const LIST_COLUMNS = `p.payslip_id, p.number::text AS number, p.payroll_run_id, p.employee_id, r.period::text AS period,
  r.status AS run_status, ${personJson("e", "d")} AS employee, e.staff_number, p.status, p.excluded_reason,
  p.earnings_total::text AS earnings_total, p.deductions_total::text AS deductions_total, p.net_pay::text AS net_pay,
  EXISTS (SELECT 1 FROM payslip_line l WHERE l.payslip_id = p.payslip_id AND l.kind = 'deduction') AS has_deduction,
  p.published_at, p.emailed_at`;

/** What one payslip adds when it is opened: the figures it was computed from and its PDF. */
const DETAIL_COLUMNS = `${LIST_COLUMNS}, p.gross_monthly::text AS gross_monthly, p.working_days, p.working_days_paid, p.bank_name,
  p.account_last4, p.document_id, doc.render_status AS pdf_status, r.paid_on::text AS run_paid_on`;
const DETAIL_JOINS = `${PAYSLIP_JOINS} LEFT JOIN document doc ON doc.document_id = p.document_id`;

/* ------------------------------------------------------------------ *
 * Payroll readers
 * ------------------------------------------------------------------ */

/** The sorts GET /payslips allow-lists. The first is the default order. */
const SORTS = { employee: "e.first_name, e.last_name", net_pay: "p.net_pay", number: "p.number" };

/**
 * GET /payslips: draft, excluded and published alike, within the reader's `payroll` scope.
 * @param {{query: Function}} db
 * @param {object} query  the validated PayslipListQuery
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
function list(db, query, scope) {
  const params = [query.run_id || null, query.period || null, query.employee_id || null, query.status || null, query.q || null];
  const s = scopeClause(scope, { column: "p.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${LIST_COLUMNS}, ${TOTAL_COL}
       FROM payslip p ${PAYSLIP_JOINS}
      WHERE ($1::uuid IS NULL OR p.payroll_run_id = $1)
        AND ($2::date IS NULL OR r.period = $2::date)
        AND ($3::uuid IS NULL OR p.employee_id = $3)
        AND ($4::text IS NULL OR p.status = $4)
        AND ($5::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || p.number) LIKE '%' || search_fold($5) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "p.payslip_id")}`,
    params,
    query,
  );
}

/** One payslip with what its modal shows, or null. */
function get(db, id) {
  return one(db, `SELECT ${DETAIL_COLUMNS} FROM payslip p ${DETAIL_JOINS} WHERE p.payslip_id = $1`, [id]);
}

/** The lines of one payslip in the order the slip prints. A payslip holds a dozen at most. */
async function linesOf(db, payslipId) {
  // pagination:complete the lines of one payslip, printed whole
  const { rows } = await completeQuery(
    db,
    `SELECT l.payslip_line_id, l.position, l.kind, l.code, l.label, l.detail, l.amount::text AS amount, l.source_type, l.source_id,
            (l.source_id IS NULL AND l.code = ANY($2::text[])) AS has_breakdown
       FROM payslip_line l WHERE l.payslip_id = $1 ORDER BY l.position`,
    [payslipId, Object.keys(GROUPS)],
    { label: "The lines of a payslip", ceiling: 200 },
  );
  return rows;
}

/** One line of a payslip with the run and person it belongs to, or null. */
function lineOf(db, payslipId, lineId) {
  return one(
    db,
    `SELECT l.payslip_line_id, l.code, l.label, l.detail, l.amount::text AS amount, l.source_type, l.source_id,
            p.payslip_id, p.employee_id, p.payroll_run_id, r.status AS run_status,
            (date_trunc('month', r.period) + interval '1 month - 1 day')::date::text AS last_day
       FROM payslip_line l JOIN payslip p ON p.payslip_id = l.payslip_id JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
      WHERE l.payslip_id = $1 AND l.payslip_line_id = $2`,
    [payslipId, lineId],
  );
}

/**
 * The pay items behind a grouped line (GET /payslips/:id/lines/:line_id/items), 25 a page, oldest day first:
 * the run's own once Submit froze them, and before that the pending items the next Compute would take (no run,
 * dated up to the month's last day).
 * @param {{payroll_run_id: string, employee_id: string, run_status: string, last_day: string}} line
 * @param {string} kind  the attendance kind the group is
 */
function itemsOf(db, line, kind, query) {
  const open = line.run_status === "draft" || line.run_status === "computed";
  const waiting = kind === "overtime" ? "confirmed" : "pending";
  return pageQuery(
    db,
    `SELECT i.attendance_pay_item_id AS source_id, i.kind, i.work_date::text AS work_date, i.minutes, i.status,
            i.amount::text AS amount, ${TOTAL_COL}
       FROM attendance_pay_item i
      WHERE i.employee_id = $1 AND i.kind = $2
        AND (i.payroll_run_id = $3 OR ($4::boolean AND i.payroll_run_id IS NULL AND i.status = $5 AND i.work_date <= $6::date))
      ORDER BY i.work_date, i.attendance_pay_item_id`,
    [line.employee_id, kind, line.payroll_run_id, open, waiting, line.last_day],
    query,
  );
}

/** The adjustment behind a line, with the reason Payroll readers read. */
function adjustmentBehind(db, id) {
  return one(db, `SELECT payroll_adjustment_id, label, amount::text AS amount, reason, kind FROM payroll_adjustment WHERE payroll_adjustment_id = $1`, [id]);
}

/** The instalment behind a fine's or an advance's line. */
function instalmentBehind(db, id) {
  return one(
    db,
    `SELECT i.payroll_deduction_instalment_id, i.period::text AS period, i.amount::text AS amount, i.status
       FROM payroll_deduction_instalment i WHERE i.payroll_deduction_instalment_id = $1`,
    [id],
  );
}

/* ------------------------------------------------------------------ *
 * The person's own (ESS)
 * ------------------------------------------------------------------ */

/**
 * GET /ess/payslips: the person's published payslips of a year, newest month first. `run_paid_on` rides along
 * for the month's status.
 */
function listOwn(db, employeeId, year, query) {
  return pageQuery(
    db,
    `SELECT ${LIST_COLUMNS}, ${TOTAL_COL}
       FROM payslip p ${PAYSLIP_JOINS}
      WHERE p.employee_id = $1 AND p.status = 'published' AND date_part('year', r.period)::int = $2
      ORDER BY r.period DESC, p.payslip_id`,
    [employeeId, year],
    query,
  );
}

/** One of the person's own published payslips with what its modal shows, or null. */
function getOwn(db, employeeId, id) {
  return one(
    db,
    `SELECT ${DETAIL_COLUMNS} FROM payslip p ${DETAIL_JOINS} WHERE p.payslip_id = $1 AND p.employee_id = $2 AND p.status = 'published'`,
    [id, employeeId],
  );
}

/** The cards above My Payslips: the year's published payslips, summed. */
function summaryOwn(db, employeeId, year) {
  return one(
    db,
    `SELECT count(*)::int AS payslips, COALESCE(sum(p.earnings_total), 0)::numeric(18,2)::text AS earnings_total,
            COALESCE(sum(p.deductions_total), 0)::numeric(18,2)::text AS deductions_total, COALESCE(sum(p.net_pay), 0)::numeric(18,2)::text AS net_pay
       FROM payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
      WHERE p.employee_id = $1 AND p.status = 'published' AND date_part('year', r.period)::int = $2`,
    [employeeId, year],
  );
}

/**
 * `my_pay.summary` (docs/guides/praxis-ai.md §6.13, Finance and pay) in one statement over the person's own
 * published payslips of a year: their count and totals, what fines and advance repayments took, the deduction
 * lines by their code, and each month's gross, deductions and net, oldest first (twelve at most).
 * @param {{query: Function}} db
 * @param {string} employeeId
 * @param {number} year
 */
function myPay(db, employeeId, year) {
  return one(
    db,
    `WITH p AS (
       SELECT p.payslip_id, r.period, p.earnings_total, p.deductions_total, p.net_pay
         FROM payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
        WHERE p.employee_id = $1 AND p.status = 'published' AND date_part('year', r.period)::int = $2
     ), l AS (
       SELECT l.code, l.amount FROM payslip_line l JOIN p ON p.payslip_id = l.payslip_id WHERE l.kind = 'deduction'
     )
     SELECT (SELECT json_build_object('payslips', count(*)::int,
                                      'gross', COALESCE(sum(earnings_total), 0)::numeric(18,2),
                                      'deductions', COALESCE(sum(deductions_total), 0)::numeric(18,2),
                                      'net', COALESCE(sum(net_pay), 0)::numeric(18,2)) FROM p) AS figures,
            (SELECT json_build_object('fines', COALESCE(sum(amount) FILTER (WHERE code = 'fine'), 0)::numeric(18,2),
                                      'advances', COALESCE(sum(amount) FILTER (WHERE code = 'advance'), 0)::numeric(18,2)) FROM l) AS taken,
            (SELECT json_agg(json_build_object('key', code, 'value', amount, 'count', n) ORDER BY amount DESC, code)
               FROM (SELECT code, count(*)::int AS n, sum(amount)::numeric(18,2) AS amount FROM l GROUP BY code) x) AS by_reason,
            (SELECT json_agg(json_build_object('at', to_char(period, 'YYYY-MM'), 'gross', earnings_total, 'deductions', deductions_total, 'net', net_pay) ORDER BY period)
               FROM p) AS points`,
    [employeeId, year],
  );
}

/** Whether the run of a month is paid (Next Payday skips a month that has had its payday). */
async function periodPaid(db, period) {
  const r = await one(db, `SELECT 1 AS paid FROM payroll_run WHERE period = $1::date AND status = 'paid'`, [period]);
  return Boolean(r);
}

/**
 * GET /ess/deductions: every instalment of the person's fines and advances that is not cancelled, newest month
 * first, each naming its query when it is a fine's. `ordinal` is its place among the deduction's live months.
 */
function deductionsOwn(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT i.payroll_deduction_instalment_id, d.source, i.period::text AS period, d.reason, i.amount::text AS amount,
            n.ordinal::int AS ordinal, d.instalments, i.status, q.number AS query_number, q.employee_query_id AS query_id,
            ${TOTAL_COL}
       FROM payroll_deduction_instalment i
       JOIN payroll_deduction d ON d.payroll_deduction_id = i.payroll_deduction_id
       LEFT JOIN sanction_fine f ON f.sanction_fine_id = d.sanction_fine_id
       LEFT JOIN sanction x ON x.sanction_id = f.sanction_id
       LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
       JOIN LATERAL (
         SELECT count(*) AS ordinal FROM payroll_deduction_instalment s
          WHERE s.payroll_deduction_id = i.payroll_deduction_id AND s.status <> 'cancelled' AND s.period <= i.period
       ) n ON true
      WHERE d.employee_id = $1 AND d.status <> 'cancelled' AND i.status <> 'cancelled'
      ORDER BY i.period DESC, d.created_at, i.payroll_deduction_instalment_id`,
    [employeeId],
    query,
  );
}

/* ------------------------------------------------------------------ *
 * The PDF, Email All and Download All
 * ------------------------------------------------------------------ */

/** What a payslip prints: its figures and the person it is for. */
const PRINT_COLUMNS = `p.payslip_id, p.number::text AS number, p.employee_id, r.period::text AS period, r.paid_on::text AS run_paid_on,
  btrim(e.first_name || ' ' || e.last_name) AS employee_name, e.staff_number, e.job_title, d.name AS department,
  p.working_days, p.working_days_paid, p.bank_name, p.account_last4, p.earnings_total::text AS earnings_total,
  p.deductions_total::text AS deductions_total, p.net_pay::text AS net_pay`;

/**
 * The published payslips of a run, to print, in staff-number order (Download All keeps that order, §6.10
 * rule 6). Held whole on purpose: a run is one month's payroll, and a set past the ceiling fails loudly.
 */
async function printRowsOfRun(db, runId) {
  // pagination:complete the published payslips of one run, printed together
  const { rows } = await completeQuery(
    db,
    `SELECT ${PRINT_COLUMNS} FROM payslip p ${PAYSLIP_JOINS}
      WHERE p.payroll_run_id = $1 AND p.status = 'published' ORDER BY e.staff_number, p.payslip_id`,
    [runId],
    { label: "The payslips of a run", ceiling: MAX_PAYSLIPS },
  );
  return rows;
}

/** One person's published payslips of a year, oldest month first, to print together (My Payslips · Download All). */
async function printRowsOfYear(db, employeeId, year) {
  // pagination:complete one person's published payslips of a year, printed together
  const { rows } = await completeQuery(
    db,
    `SELECT ${PRINT_COLUMNS} FROM payslip p ${PAYSLIP_JOINS}
      WHERE p.employee_id = $1 AND p.status = 'published' AND date_part('year', r.period)::int = $2
      ORDER BY r.period, p.payslip_id`,
    [employeeId, year],
    { label: "The payslips of a year", ceiling: 12 * 5 },
  );
  return rows;
}

/** The lines of these payslips, in print order, for the earnings and deductions of each (employer charges never print). */
async function printLinesOf(db, payslipIds) {
  if (!payslipIds.length) return new Map();
  // pagination:complete the printed lines of the payslips being printed together
  const { rows } = await completeQuery(
    db,
    `SELECT l.payslip_id, l.kind, l.label, l.detail, l.amount::text AS amount
       FROM payslip_line l WHERE l.payslip_id = ANY($1::uuid[]) AND l.kind <> 'employer'
      ORDER BY l.payslip_id, l.position`,
    [payslipIds],
    { label: "The lines of the payslips printed together", ceiling: MAX_LINES },
  );
  const by = new Map();
  for (const l of rows) {
    const mine = by.get(l.payslip_id);
    if (mine) mine.push(l);
    else by.set(l.payslip_id, [l]);
  }
  return by;
}

/** Record the PDF a payslip was requested as. */
function setDocument(client, payslipId, documentId) {
  return client.query(`UPDATE payslip SET document_id = $2 WHERE payslip_id = $1`, [payslipId, documentId]);
}

/** A payslip locked for the rest of the transaction, with its run and person, or null (Email a Copy). */
function lockOwn(client, employeeId, id) {
  return one(
    client,
    `SELECT p.payslip_id, p.number::text AS number, p.status, p.emailed_at, p.document_id, p.employee_id, r.period::text AS period,
            doc.render_status AS pdf_status, (p.emailed_at IS NOT NULL AND p.emailed_at > now() - interval '1 minute') AS just_emailed
       FROM payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id LEFT JOIN document doc ON doc.document_id = p.document_id
      WHERE p.payslip_id = $1 AND p.employee_id = $2 FOR UPDATE OF p`,
    [id, employeeId],
  );
}

/** Mark a payslip emailed now; answers its id, or null when it does not exist. */
function markEmailed(client, payslipId) {
  return one(client, `UPDATE payslip SET emailed_at = now() WHERE payslip_id = $1 RETURNING payslip_id`, [payslipId]);
}

/** Put a payslip back to not emailed: its mail could not be sent, so Email All may take it again. */
function clearEmailed(client, payslipId) {
  return client.query(`UPDATE payslip SET emailed_at = NULL WHERE payslip_id = $1`, [payslipId]);
}

/** How many published payslips of a run an Email All would reach now: the ones not yet emailed, or every one on a resend. */
async function countToEmail(db, runId, resend) {
  const r = await one(
    db,
    `SELECT count(*)::int AS n FROM payslip WHERE payroll_run_id = $1 AND status = 'published' AND ($2::boolean OR emailed_at IS NULL)`,
    [runId, resend],
  );
  return r.n;
}

/**
 * The next published payslips of a run to mail, 25 at a time, in staff-number order: those not yet emailed, or on
 * a resend those not emailed since the press (`requested_at`), whose PDF is done. A payslip whose PDF is still
 * rendering waits for the handler's next attempt. Each one the caller marks emailed leaves this set, so the caller
 * asks again for the next 25.
 */
async function nextToEmail(client, runId, { resend, requestedAt }) {
  const { rows } = await client.query(
    `SELECT p.payslip_id, p.number::text AS number, p.employee_id, e.staff_number
       FROM payslip p JOIN employee e ON e.employee_id = p.employee_id JOIN document doc ON doc.document_id = p.document_id
      WHERE p.payroll_run_id = $1 AND p.status = 'published' AND doc.render_status = 'done'
        AND (p.emailed_at IS NULL OR ($2::boolean AND p.emailed_at < $3::timestamptz))
      ORDER BY e.staff_number, p.payslip_id
      LIMIT $4 -- pagination:batch Email All mails a run's payslips 25 at a time, never rows a person reads
    `,
    [runId, resend, requestedAt, MAIL_BATCH],
  );
  return rows;
}

/** How many published payslips of a run still wait for their PDF before they can be mailed. */
async function countRendering(db, runId, { resend, requestedAt }) {
  const r = await one(
    db,
    `SELECT count(*)::int AS n
       FROM payslip p LEFT JOIN document doc ON doc.document_id = p.document_id
      WHERE p.payroll_run_id = $1 AND p.status = 'published' AND (doc.document_id IS NULL OR doc.render_status = 'pending')
        AND (p.emailed_at IS NULL OR ($2::boolean AND p.emailed_at < $3::timestamptz))`,
    [runId, resend, requestedAt],
  );
  return r.n;
}

/** What the mail of a payslip needs: where it goes, which month, and the PDF to attach. */
function mailOf(db, payslipId) {
  return one(
    db,
    `SELECT p.payslip_id, p.payroll_run_id, p.number::text AS number, p.status, p.document_id, doc.render_status AS pdf_status,
            r.period::text AS period, e.employee_id, e.first_name, e.last_name, e.work_email
       FROM payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id JOIN employee e ON e.employee_id = p.employee_id
       LEFT JOIN document doc ON doc.document_id = p.document_id
      WHERE p.payslip_id = $1`,
    [payslipId],
  );
}

module.exports = {
  GROUPS,
  MAX_PAYSLIPS,
  list,
  get,
  linesOf,
  lineOf,
  itemsOf,
  adjustmentBehind,
  instalmentBehind,
  listOwn,
  getOwn,
  summaryOwn,
  myPay,
  periodPaid,
  deductionsOwn,
  printRowsOfRun,
  printRowsOfYear,
  printLinesOf,
  setDocument,
  lockOwn,
  markEmailed,
  clearEmailed,
  countToEmail,
  nextToEmail,
  countRendering,
  mailOf,
};
