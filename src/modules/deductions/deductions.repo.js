"use strict";
/**
 * Deductions' SQL (docs/guides/payroll.md §4, §6.6): the paged union the tab lists, its figures, and the
 * `payroll_deduction` and `payroll_deduction_instalment` rows a fine's acceptance or an advance writes.
 * Parameterised, no business rules, no events, and never another module's write: a fine moves through
 * `sanctions.fines`, an attendance item through `attendance.pay` (deductions.acceptance.js).
 *
 * The tab is one list over three tables read as their owners read them (§6.6 rule 1): pending attendance
 * deductions, fines (waiting or waived here; accepted or settled through their deduction) and advances. It
 * pages at 25 through `shared/http/paged.js`; its filters and sorts run in SQL.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** An instalment is started once a run holds it or has applied it: from then on nothing releases or cancels it (the SQL names the same two). */
const STARTED = Object.freeze(["in_run", "applied"]);

/**
 * The three sources as one set of rows, each in the shape of the contract's DeductionRow before it is
 * presented. `reason_text` is what the person wrote (a fine's sanction, an advance's reason); an attendance
 * item has none, the service words it from its kind and day. `amount` and the sort keys sit beside it so a
 * filter or an order never reads a presented value.
 */
const UNION = `
  SELECT 'attendance'::text AS source, pi.attendance_pay_item_id AS source_id,
         NULL::uuid AS sanction_fine_id, NULL::uuid AS payroll_deduction_id,
         e.employee_id, ${personJson("e", "d")} AS employee,
         pi.kind AS kind, pi.work_date::text AS work_date, NULL::text AS reason_text,
         pi.amount AS amount, (e.gross_monthly IS NOT NULL) AS salary_set,
         date_trunc('month', pi.work_date)::date::text AS period,
         NULL::int AS instalments, NULL::int AS instalments_applied,
         'pending'::text AS status, NULL::text AS query_number, pi.created_at AS created_at,
         false AS started, e.last_name, e.first_name
    FROM attendance_pay_item pi
    JOIN employee e ON e.employee_id = pi.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
   WHERE pi.kind IN ('late', 'early_departure', 'absence') AND pi.status = 'pending'
  UNION ALL
  SELECT 'fine'::text, f.sanction_fine_id, f.sanction_fine_id, NULL::uuid,
         e.employee_id, ${personJson("e", "d")},
         NULL::text, NULL::text, x.reason,
         f.amount_ngn, true,
         date_trunc('month', x.effective_on)::date::text,
         NULL::int, NULL::int,
         CASE f.settlement_status WHEN 'pending' THEN 'pending' ELSE 'waived' END, q.number::text, f.created_at,
         false, e.last_name, e.first_name
    FROM sanction_fine f
    JOIN sanction x ON x.sanction_id = f.sanction_id
    JOIN employee e ON e.employee_id = x.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
   WHERE x.status = 'issued' AND f.settlement_status IN ('pending', 'waived')
  UNION ALL
  SELECT CASE dd.source WHEN 'sanction_fine' THEN 'fine' ELSE 'advance' END,
         COALESCE(dd.sanction_fine_id, dd.payroll_deduction_id), dd.sanction_fine_id, dd.payroll_deduction_id,
         e.employee_id, ${personJson("e", "d")},
         NULL::text, NULL::text, dd.reason,
         dd.total_amount, true,
         dd.start_period::text,
         dd.instalments::int,
         (SELECT count(*)::int FROM payroll_deduction_instalment i
           WHERE i.payroll_deduction_id = dd.payroll_deduction_id AND i.status = 'applied'),
         dd.status, q.number::text, dd.created_at,
         EXISTS (SELECT 1 FROM payroll_deduction_instalment i
                  WHERE i.payroll_deduction_id = dd.payroll_deduction_id AND i.status IN ('in_run', 'applied')),
         e.last_name, e.first_name
    FROM payroll_deduction dd
    JOIN employee e ON e.employee_id = dd.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN sanction_fine f ON f.sanction_fine_id = dd.sanction_fine_id
    LEFT JOIN sanction x ON x.sanction_id = f.sanction_id
    LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
   WHERE dd.status IN ('active', 'settled')`;

/**
 * What a list may be ordered by. The first is the default, and not the contract's: pending first, then the
 * newest, so the tab opens on what is waiting. `created`, `employee` and `amount` are the contract's own.
 */
const SORTS = {
  queue: "(v.status = 'pending') DESC, v.created_at DESC",
  created: "v.created_at",
  employee: "lower(v.first_name), lower(v.last_name)",
  amount: "v.amount",
};

/**
 * One page of the union: filtered by status, source, person, month (`YYYY-MM` of the row's `period`) and
 * a search over the person's name, the reason and the query number.
 * @param {{query: Function}} db
 * @param {object} query  the validated DeductionListQuery
 */
function list(db, query) {
  const params = [
    query.status || null,
    query.source || null,
    query.employee_id || null,
    query.month || null,
    query.q || null,
  ];
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL} FROM (${UNION}
     ) v
     WHERE ($1::text IS NULL OR v.status = $1)
       AND ($2::text IS NULL OR v.source = $2)
       AND ($3::uuid IS NULL OR v.employee_id = $3::uuid)
       AND ($4::text IS NULL OR left(v.period, 7) = $4)
       AND ($5::text IS NULL OR search_fold(v.first_name || ' ' || v.last_name || ' ' || COALESCE(v.reason_text, '') || ' ' || COALESCE(v.query_number, ''))
                                LIKE '%' || search_fold($5) || '%')
     ORDER BY ${orderBy(query, SORTS, "v.source_id")}`,
    params,
    query,
  );
}

/**
 * One row of the union by its source and id, for an answer: the row a press changed, as the tab now shows it.
 * A fine that was accepted is found by its fine or by its deduction; null once nothing shows it (a released
 * advance, a cancelled one).
 */
async function rowOf(db, source, id) {
  return one(
    db,
    `SELECT v.* FROM (${UNION}
     ) v WHERE v.source = $1 AND (v.source_id = $2::uuid OR v.payroll_deduction_id = $2::uuid)`,
    [source, id],
  );
}

/**
 * The figures above the tab (§10.1): what is waiting and what is being recovered. Each amount is a sum over
 * the rows with one, so an attendance item with no gross counts but adds nothing; `recoveredFrom` is the
 * first day of the Lagos calendar year.
 * @param {{query: Function}} db
 * @param {string} recoveredFrom
 */
async function summary(db, recoveredFrom) {
  const r = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM sanction_fine f JOIN sanction x ON x.sanction_id = f.sanction_id
         WHERE x.status = 'issued' AND f.settlement_status = 'pending') AS fines_count,
       (SELECT COALESCE(sum(f.amount_ngn), 0)::numeric(18,2)::text FROM sanction_fine f JOIN sanction x ON x.sanction_id = f.sanction_id
         WHERE x.status = 'issued' AND f.settlement_status = 'pending') AS fines_amount,
       (SELECT count(*)::int FROM attendance_pay_item
         WHERE kind IN ('late', 'early_departure', 'absence') AND status = 'pending') AS attendance_count,
       (SELECT COALESCE(sum(amount), 0)::numeric(18,2)::text FROM attendance_pay_item
         WHERE kind IN ('late', 'early_departure', 'absence') AND status = 'pending') AS attendance_amount,
       (SELECT count(*)::int FROM payroll_deduction WHERE status = 'active') AS active_count,
       (SELECT COALESCE(sum(i.amount), 0)::numeric(18,2)::text FROM payroll_deduction_instalment i
          JOIN payroll_deduction dd ON dd.payroll_deduction_id = i.payroll_deduction_id
         WHERE dd.status = 'active' AND i.status IN ('scheduled', 'in_run')) AS active_amount,
       (SELECT count(*)::int FROM payroll_deduction_instalment WHERE status = 'applied' AND period >= $1::date) AS recovered_count,
       (SELECT COALESCE(sum(amount), 0)::numeric(18,2)::text FROM payroll_deduction_instalment WHERE status = 'applied' AND period >= $1::date) AS recovered_amount`,
    [recoveredFrom],
  );
  return r;
}

/* ------------------------------------------------------------------ *
 * A fine, for its acceptance
 * ------------------------------------------------------------------ */

/**
 * A fine with its sanction's reason and employee and its query's number, locked while it is accepted,
 * waived or released. Null when it does not exist or its sanction is not issued.
 */
function lockFine(client, id) {
  return one(
    client,
    `SELECT f.sanction_fine_id, f.sanction_id, f.amount_ngn::text AS amount, f.settlement_status,
            x.employee_id, x.reason, q.number::text AS query_number
       FROM sanction_fine f
       JOIN sanction x ON x.sanction_id = f.sanction_id
       LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
      WHERE f.sanction_fine_id = $1 AND x.status = 'issued'
      FOR UPDATE OF f`,
    [id],
  );
}

/** The fine of a sanction and who it is about, for the notice that it waits on payroll. */
function fineOfSanction(db, sanctionId) {
  return one(
    db,
    `SELECT f.sanction_fine_id, x.employee_id, btrim(e.first_name || ' ' || e.last_name) AS employee_name, q.number::text AS query_number
       FROM sanction_fine f
       JOIN sanction x ON x.sanction_id = f.sanction_id
       JOIN employee e ON e.employee_id = x.employee_id
       LEFT JOIN employee_query q ON q.employee_query_id = x.employee_query_id
      WHERE f.sanction_id = $1 AND f.settlement_status = 'pending'`,
    [sanctionId],
  );
}

/* ------------------------------------------------------------------ *
 * A deduction and its instalments
 * ------------------------------------------------------------------ */

/** A person's name and whether they are on payroll at all, for an advance: null when no such employee. */
function employeeOf(db, id) {
  return one(db, `SELECT employee_id, btrim(first_name || ' ' || last_name) AS name FROM employee WHERE employee_id = $1`, [id]);
}

/** Write a deduction. Its instalments follow (`insertInstalments`). */
function insertDeduction(client, d) {
  return one(
    client,
    `INSERT INTO payroll_deduction (employee_id, source, sanction_fine_id, reason, total_amount, instalments, start_period, granted_on, created_by)
     VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::date, $8::date, $9)
     RETURNING payroll_deduction_id, employee_id, source, sanction_fine_id, reason, instalments, start_period::text AS start_period`,
    [d.employee_id, d.source, d.sanction_fine_id || null, d.reason, d.total_amount, d.instalments, d.start_period, d.granted_on || null, d.created_by],
  );
}

/** One instalment a month from `start`, the shares in order: `periods[i]` takes `amounts[i]`. */
async function insertInstalments(client, deductionId, periods, amounts) {
  await client.query(
    `INSERT INTO payroll_deduction_instalment (payroll_deduction_id, period, amount)
     SELECT $1, p.period, p.amount FROM unnest($2::date[], $3::numeric[]) AS p(period, amount)`,
    [deductionId, periods, amounts],
  );
}

const DEDUCTION = `dd.payroll_deduction_id, dd.employee_id, dd.source, dd.sanction_fine_id, dd.reason, dd.status,
  dd.instalments, dd.start_period::text AS start_period`;

/** A deduction as it stands, not locked: what release and cancel read before they take the runs' locks. */
function getDeduction(db, id) {
  return one(db, `SELECT ${DEDUCTION} FROM payroll_deduction dd WHERE dd.payroll_deduction_id = $1`, [id]);
}

/** A deduction locked for the rest of the transaction: taken after the runs of its months, never before. */
function lockDeduction(client, id) {
  return one(client, `SELECT ${DEDUCTION} FROM payroll_deduction dd WHERE dd.payroll_deduction_id = $1 FOR UPDATE`, [id]);
}

/**
 * The months and states of a deduction's live instalments, in month order. `lock` holds them for the rest of
 * the transaction; read once without it to know which runs to take first, then again with it.
 */
async function instalmentsOf(client, deductionId, { lock = false } = {}) {
  // pagination:complete the at most twelve instalments of one deduction
  const { rows } = await completeQuery(
    client,
    `SELECT payroll_deduction_instalment_id, period::text AS period, status
       FROM payroll_deduction_instalment WHERE payroll_deduction_id = $1 AND status <> 'cancelled' ORDER BY period${lock ? " FOR UPDATE" : ""}`,
    [deductionId],
    { label: "The instalments of a deduction", ceiling: 12 },
  );
  return rows;
}

/** Cancel a deduction and every instalment of it, for a release or a cancelled advance. Answers the instalments cancelled. */
async function cancelDeduction(client, id, reason) {
  const { rowCount } = await client.query(
    `UPDATE payroll_deduction_instalment SET status = 'cancelled' WHERE payroll_deduction_id = $1 AND status = 'scheduled'`,
    [id],
  );
  await client.query(
    `UPDATE payroll_deduction SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2 WHERE payroll_deduction_id = $1`,
    [id, reason],
  );
  return rowCount;
}

module.exports = {
  STARTED,
  SORTS,
  list,
  rowOf,
  summary,
  lockFine,
  fineOfSanction,
  employeeOf,
  insertDeduction,
  insertInstalments,
  getDeduction,
  lockDeduction,
  instalmentsOf,
  cancelDeduction,
};
