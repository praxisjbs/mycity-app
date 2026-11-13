"use strict";
/**
 * Statutory rates' SQL (docs/guides/payroll.md §4.2, §6.12): read as of a day, listed 25 a page, and the rows a run
 * and the report read, each with its legal source; and a person's Pay to Date (§13.1 item 42). Parameterised, no
 * business rules, no events. A version is written and taken back by statutory.rates.js through shared/db/effective-dated
 * (addVersionSet, removeVersion), never here. The retired `relief` (§13.1 item 41) is never read: every query of the rates
 * names the items the code knows.
 */
const c = require("@mycity/contract");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { asOf } = require("../../shared/db/effective-dated");

/** The items the code knows, in §6.12's order: the screen's, the engine's and the report's. */
const ITEMS = c.statutory.StatutoryItem.options;

/** The order the items read in. */
const ITEM_ORDER = `array_position(ARRAY['${ITEMS.join("', '")}']::text[], r.item)`;

/** Only the items the code knows: a retired item's rows stay in the table, unread. */
const KNOWN = `r.item = ANY(ARRAY['${ITEMS.join("', '")}']::text[])`;

const ROW = `r.statutory_rate_id, r.item, r.kind, r.base, r.rate::text AS rate, r.band_from::text AS band_from,
  r.band_to::text AS band_to, r.flat_amount::text AS flat_amount, r.position, r.effective_from::text AS effective_from,
  r.effective_to::text AS effective_to, r.created_at,
  r.source_title, r.source_section, r.source_url, r.source_document_id, r.source_checked_on::text AS source_checked_on,
  r.no_legal_source, r.no_source_reason,
  CASE WHEN e.employee_id IS NULL THEN NULL ELSE btrim(e.first_name || ' ' || e.last_name) END AS created_by_name`;

const JOINS = `LEFT JOIN app_user u ON u.user_id = r.created_by LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** What the list may be sorted by; with no sort, by item, then the version's first day, then the band. */
const SORTS = { item: ITEM_ORDER, effective_from: "r.effective_from" };

/**
 * GET /statutory/rates: with `as_of`, the rows in force that day; without, those in force today and those that start
 * later (`today`, the Lagos date the service passes).
 */
function list(db, query, today) {
  const params = [query.item || null, query.as_of || null, today];
  const order = query.sort
    ? `${orderBy(query, SORTS, "r.statutory_rate_id")}`
    : `${ITEM_ORDER}, r.effective_from, r.position NULLS FIRST, r.statutory_rate_id`;
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       FROM statutory_rate r ${JOINS}
      WHERE ($1::text IS NULL OR r.item = $1) AND ${KNOWN}
        AND (CASE WHEN $2::date IS NULL THEN (r.effective_to IS NULL OR r.effective_to > $3::date) ELSE ${asOf("r", 2)} END)
      ORDER BY ${order}`,
    params,
    query,
  );
}

/** The rows of one item's version that starts on a day, one page (a PAYE table has at most twelve bands). */
function versionRows(db, item, from) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       FROM statutory_rate r ${JOINS}
      WHERE r.item = $1 AND r.effective_from = $2::date
      ORDER BY r.position NULLS FIRST, r.statutory_rate_id`,
    [item, from],
    { page: 1 },
  );
}

/**
 * Every row in force on a day, of every item the code knows: what a run is computed with (its last day) and what Switch
 * On checks (its first day). Eight items and a PAYE table: a handful of rows.
 */
async function inForce(db, date) {
  // pagination:complete the statutory rows in force on one day: at most eight items and twelve PAYE bands
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} FROM statutory_rate r ${JOINS} WHERE ${asOf("r", 1)} AND ${KNOWN} ORDER BY ${ITEM_ORDER}, r.position NULLS FIRST`,
    [date],
    { label: "The statutory rates in force on a day", ceiling: 100 },
  );
  return rows;
}

/** The rows of each item's next version: the one with the earliest first day after `date`. */
async function nextVersions(db, date) {
  // pagination:complete the next version of each of eight items: at most eight items and twelve PAYE bands
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} FROM statutory_rate r ${JOINS}
      WHERE r.effective_from = (SELECT min(n.effective_from) FROM statutory_rate n WHERE n.item = r.item AND n.effective_from > $1::date)
        AND ${KNOWN}
      ORDER BY ${ITEM_ORDER}, r.position NULLS FIRST`,
    [date],
    { label: "The next statutory versions", ceiling: 100 },
  );
  return rows;
}

/** The statutory line codes a report prints, in its order: PAYE and its refund, then the rest as §6.12's table. */
const REPORT_CODES = ["paye", "paye_refund", "pension_employee", "pension_employer", "nhf", "itf", "nsitf"];

/** The most statutory lines one run carries: seven codes for each person a run can pay. */
const MAX_REPORT_LINES = 35000;

/**
 * Every statutory line of a run's payslips that are not excluded, item by item in the report's order and each item's
 * people by the State they live in and then staff number, with the base its rate was applied to, the person's tax and
 * pension numbers and their State (read as it stands, as the numbers are): the statutory report's rows (§6.12 rule 6).
 * Read whole: a report is of the whole run.
 */
async function reportLines(db, runId) {
  // pagination:complete every statutory line of one run, for its report; never a list on a screen
  const { rows } = await completeQuery(
    db,
    `SELECT l.code, l.kind, l.detail, l.amount::text AS amount, l.base_amount::text AS base_amount,
            p.employee_id, e.staff_number::text AS staff_number, btrim(e.first_name || ' ' || e.last_name) AS employee_name,
            e.tax_id, e.pension_pin, e.pension_administrator, e.nhf_number, e.state_of_residence
       FROM payslip_line l
       JOIN payslip p ON p.payslip_id = l.payslip_id
       JOIN employee e ON e.employee_id = p.employee_id
      WHERE p.payroll_run_id = $1 AND p.status <> 'excluded'
        AND l.code = ANY($2::text[])
      ORDER BY array_position($2::text[], l.code), e.state_of_residence NULLS LAST, e.staff_number, e.employee_id`,
    [runId, REPORT_CODES],
    { label: "The statutory lines of a run", ceiling: MAX_REPORT_LINES },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * A person's Pay to Date (§6.12 rule 11, §13.1 item 42)
 * ------------------------------------------------------------------ */

const PAY_TO_DATE = `t.employee_pay_to_date_id, t.employee_id, t.year, t.taxable_pay::text AS taxable_pay,
  t.tax_paid::text AS tax_paid, t.document_id, t.updated_at,
  CASE WHEN e.employee_id IS NULL THEN NULL ELSE btrim(e.first_name || ' ' || e.last_name) END AS entered_by_name`;
const PAY_TO_DATE_JOINS = `LEFT JOIN app_user u ON u.user_id = t.entered_by LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** GET /statutory/employees/:employee_id/pay-to-date: one person's years, newest first, 25 a page. */
function payToDatePage(db, employeeId, query) {
  return pageQuery(
    db,
    `SELECT ${PAY_TO_DATE}, ${TOTAL_COL}
       FROM employee_pay_to_date t ${PAY_TO_DATE_JOINS}
      WHERE t.employee_id = $1
      ORDER BY t.year DESC, t.employee_pay_to_date_id`,
    [employeeId],
    query,
  );
}

/** One person's Pay to Date of one year, or null. */
async function payToDateOf(db, employeeId, year) {
  const { rows } = await db.query(
    `SELECT ${PAY_TO_DATE} FROM employee_pay_to_date t ${PAY_TO_DATE_JOINS} WHERE t.employee_id = $1 AND t.year = $2`,
    [employeeId, year],
  );
  return rows[0] || null;
}

/** The year's figures made or replaced, inside the caller's transaction; the row as it now stands. */
async function writePayToDate(client, { employee_id: employeeId, year, taxable_pay: taxable, tax_paid: tax, document_id: doc, entered_by: by }) {
  const { rows } = await client.query(
    `INSERT INTO employee_pay_to_date (employee_id, year, taxable_pay, tax_paid, document_id, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (employee_id, year) DO UPDATE
        SET taxable_pay = EXCLUDED.taxable_pay, tax_paid = EXCLUDED.tax_paid, document_id = EXCLUDED.document_id,
            entered_by = EXCLUDED.entered_by
     RETURNING employee_pay_to_date_id, (xmax = 0) AS created`,
    [employeeId, year, taxable, tax, doc || null, by || null],
  );
  return rows[0];
}

/** The year's figures taken away, inside the caller's transaction; the row that was, or null. */
async function deletePayToDate(client, employeeId, year) {
  const { rows } = await client.query(
    `DELETE FROM employee_pay_to_date WHERE employee_id = $1 AND year = $2 RETURNING employee_pay_to_date_id, document_id`,
    [employeeId, year],
  );
  return rows[0] || null;
}

/**
 * The Pay to Date of the people a run pays, for one year: what Compute adds to each person's year to date.
 * @returns {Promise<Map<string, {taxable_pay: string, tax: string}>>}
 */
async function payToDateFor(db, employeeIds, year) {
  if (!employeeIds.length) return new Map();
  // pagination:complete one row a person a year, for the people one run pays
  const { rows } = await completeQuery(
    db,
    `SELECT employee_id, taxable_pay::text AS taxable_pay, tax_paid::text AS tax
       FROM employee_pay_to_date WHERE employee_id = ANY($1::uuid[]) AND year = $2
      ORDER BY employee_id`,
    [employeeIds, year],
    { label: "The Pay to Date of a run's people", ceiling: MAX_REPORT_LINES },
  );
  return new Map(rows.map((r) => [r.employee_id, { taxable_pay: r.taxable_pay, tax: r.tax }]));
}

module.exports = {
  ITEMS,
  REPORT_CODES,
  list,
  versionRows,
  inForce,
  nextVersions,
  reportLines,
  payToDatePage,
  payToDateOf,
  writePayToDate,
  deletePayToDate,
  payToDateFor,
};
