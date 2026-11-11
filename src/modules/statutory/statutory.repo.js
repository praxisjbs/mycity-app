"use strict";
/**
 * Statutory rates' SQL (docs/guides/payroll.md §4.2, §6.12): read as of a day, listed 25 a page, and the rows a run
 * and the report read, each with its legal source. Parameterised, no business rules, no events. A version is written
 * and taken back by statutory.rates.js through shared/db/effective-dated (addVersionSet, removeVersion), never here.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { asOf } = require("../../shared/db/effective-dated");

/** The order the items read in, the screen's and the report's: §6.12's table. */
const ITEM_ORDER = `array_position(ARRAY['paye', 'pension_employee', 'pension_employer', 'nhf', 'relief', 'itf', 'nsitf']::text[], r.item)`;

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
      WHERE ($1::text IS NULL OR r.item = $1)
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
 * Every row in force on a day, of every item: what a run is computed with (its last day) and what Switch On checks
 * (its first day). Seven items and a PAYE table: a handful of rows.
 */
async function inForce(db, date) {
  // pagination:complete the statutory rows in force on one day: at most seven items and twelve PAYE bands
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} FROM statutory_rate r ${JOINS} WHERE ${asOf("r", 1)} ORDER BY ${ITEM_ORDER}, r.position NULLS FIRST`,
    [date],
    { label: "The statutory rates in force on a day", ceiling: 100 },
  );
  return rows;
}

/** The rows of each item's next version: the one with the earliest first day after `date`. */
async function nextVersions(db, date) {
  // pagination:complete the next version of each of seven items: at most seven items and twelve PAYE bands
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} FROM statutory_rate r ${JOINS}
      WHERE r.effective_from = (SELECT min(n.effective_from) FROM statutory_rate n WHERE n.item = r.item AND n.effective_from > $1::date)
      ORDER BY ${ITEM_ORDER}, r.position NULLS FIRST`,
    [date],
    { label: "The next statutory versions", ceiling: 100 },
  );
  return rows;
}

/** The most statutory lines one run carries: six items for each person a run can pay. */
const MAX_REPORT_LINES = 30000;

/**
 * Every statutory line of a run's payslips that are not excluded, item by item in §6.12's order and each item's people
 * in staff-number order, with the base its rate was applied to and the person's tax and pension numbers: the
 * statutory report's rows (§6.12 rule 6). Read whole: a report is of the whole run.
 */
async function reportLines(db, runId) {
  // pagination:complete every statutory line of one run, for its report; never a list on a screen
  const { rows } = await completeQuery(
    db,
    `SELECT l.code, l.kind, l.detail, l.amount::text AS amount, l.base_amount::text AS base_amount,
            p.employee_id, e.staff_number::text AS staff_number, btrim(e.first_name || ' ' || e.last_name) AS employee_name,
            e.tax_id, e.pension_pin, e.pension_administrator, e.nhf_number
       FROM payslip_line l
       JOIN payslip p ON p.payslip_id = l.payslip_id
       JOIN employee e ON e.employee_id = p.employee_id
      WHERE p.payroll_run_id = $1 AND p.status <> 'excluded'
        AND l.code IN ('paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf')
      ORDER BY array_position(ARRAY['paye', 'pension_employee', 'pension_employer', 'nhf', 'itf', 'nsitf']::text[], l.code),
               e.staff_number, e.employee_id`,
    [runId],
    { label: "The statutory lines of a run", ceiling: MAX_REPORT_LINES },
  );
  return rows;
}

module.exports = { list, versionRows, inForce, nextVersions, reportLines };
