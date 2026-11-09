"use strict";
/**
 * Payroll's SQL (docs/guides/payroll.md §4): runs, a run's payslips and their lines, adjustments, the
 * instalments a run freezes and applies, and the problems a run reports. Parameterised, no business
 * rules, no events, never another module's write: attendance's items and a fine are asked of their owners
 * (payroll.run.js, payroll.lock.js).
 *
 * Every list pages at 25 through `shared/http/paged.js`. A set a run must hold whole (its payslips, to
 * compute them) is `completeQuery` with its reason and a ceiling.
 *
 * A run's problems are worked out on read, never stored (§6.15): from its payslips as Compute left them,
 * from the live items that are still waiting (overtime, fines) and from the person's contract. A run that
 * has left Draft and Computed reports none: the people reading it have moved on to the approval.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** The most payslips one run holds (one per person paid). */
const MAX_PAYSLIPS = 5000;

const nameOf = (alias) => `CASE WHEN ${alias}.employee_id IS NULL THEN NULL ELSE btrim(${alias}.first_name || ' ' || ${alias}.last_name) END`;

/** A run with who submitted, approved and paid it. */
const RUN = `r.payroll_run_id, r.number::text AS number, r.period::text AS period, r.status, r.advanced, r.headcount,
  r.earnings_total::text AS earnings_total, r.deductions_total::text AS deductions_total, r.net_total::text AS net_total,
  r.employer_total::text AS employer_total, r.computed_at, r.submitted_at, r.approved_at, r.paid_on::text AS paid_on,
  r.payment_reference, r.returned_reason, r.workflow_instance_id, r.config_snapshot, r.created_at,
  r.submitted_by, r.approved_by, r.paid_by,
  ${nameOf("se")} AS submitted_by_name, ${nameOf("ae")} AS approved_by_name, ${nameOf("pe")} AS paid_by_name`;

const RUN_JOINS = `LEFT JOIN app_user su ON su.user_id = r.submitted_by LEFT JOIN employee se ON se.employee_id = su.employee_id
  LEFT JOIN app_user au ON au.user_id = r.approved_by LEFT JOIN employee ae ON ae.employee_id = au.employee_id
  LEFT JOIN app_user pu ON pu.user_id = r.paid_by LEFT JOIN employee pe ON pe.employee_id = pu.employee_id`;

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/** Run History: newest month first unless sorted. */
const RUN_SORTS = { period: "r.period", status: "r.status" };

/** GET /payroll/runs. The default order is the newest month: the contract's `sort` reverses it. */
function listRuns(db, query) {
  const params = [query.status || null, query.year || null];
  const sorted = query.sort ? query : { ...query, sort: { field: "period", dir: "desc" } };
  return pageQuery(
    db,
    `SELECT ${RUN}, ${TOTAL_COL}
       FROM payroll_run r ${RUN_JOINS}
      WHERE ($1::text IS NULL OR r.status = $1)
        AND ($2::int IS NULL OR extract(year FROM r.period)::int = $2)
      ORDER BY ${orderBy(sorted, RUN_SORTS, "r.payroll_run_id")}`,
    params,
    sorted,
  );
}

/** One run with the names, or null. */
function getRun(db, id) {
  return one(db, `SELECT ${RUN} FROM payroll_run r ${RUN_JOINS} WHERE r.payroll_run_id = $1`, [id]);
}

/** One run locked for the rest of the transaction: two people pressing at once queue (§6.9 rule 6). */
function lockRun(client, id) {
  return one(client, `SELECT ${RUN} FROM payroll_run r ${RUN_JOINS} WHERE r.payroll_run_id = $1 FOR UPDATE OF r`, [id]);
}

/** The run of a month, or null. */
function runOfPeriod(client, period) {
  return one(client, `SELECT payroll_run_id, status FROM payroll_run WHERE period = $1::date`, [period]);
}

/** The period of the newest run still a Draft or a Computed one: the month deductions are accepted into (§6.6 rule 2). */
async function newestOpenPeriod(db) {
  const r = await one(db, `SELECT period::text AS period FROM payroll_run WHERE status IN ('draft', 'computed') ORDER BY period DESC LIMIT 1`, []);
  return r ? r.period : null;
}

/**
 * The runs of the months named, locked for the rest of the transaction and in month order, so a deduction
 * scheduled, released or cancelled in a month queues behind a Compute or a Submit of that month's run and
 * never lands between its read and its freeze (deductions.acceptance, payroll.lock.lockMonths).
 * @param {string[]} periods  months' first days
 */
async function lockRunsOfPeriods(client, periods) {
  // pagination:complete the runs of the at most twelve months one deduction's instalments fall in
  const { rows } = await completeQuery(
    client,
    `SELECT payroll_run_id, period::text AS period, status FROM payroll_run
      WHERE period = ANY($1::date[]) ORDER BY period FOR UPDATE`,
    [periods],
    { label: "The runs of a deduction's months", ceiling: 24 },
  );
  return rows;
}

/** The first month anyone started: no run is opened for an earlier month (§5, PERIOD_NOT_ALLOWED). */
async function earliestStart(client) {
  const r = await one(client, `SELECT date_trunc('month', min(start_date))::date::text AS first FROM employee`, []);
  return r ? r.first : null;
}

function insertRun(client, { number, period }) {
  return one(client, `INSERT INTO payroll_run (number, period) VALUES ($1, $2::date) RETURNING payroll_run_id`, [number, period]);
}

/** Columns the run's own moves may set, so a patch never writes a key it was not meant to. */
const RUN_WRITABLE = new Set([
  "status",
  "advanced",
  "headcount",
  "earnings_total",
  "deductions_total",
  "net_total",
  "employer_total",
  "computed_at",
  "submitted_at",
  "approved_at",
  "submitted_by",
  "approved_by",
  "paid_on",
  "payment_reference",
  "paid_by",
  "returned_reason",
  "workflow_instance_id",
  "config_snapshot",
]);
const AS_NOW = "now";

/**
 * Set columns on a run. A value of `"now"` for a timestamp column sets it to the transaction's clock; a
 * config snapshot is written as JSON.
 * @param {import("pg").PoolClient} client
 * @param {string} id
 * @param {Record<string, unknown>} patch
 */
async function setRun(client, id, patch) {
  const sets = [];
  const params = [id];
  for (const [key, value] of Object.entries(patch)) {
    if (!RUN_WRITABLE.has(key)) throw new Error(`payroll.repo.setRun: "${key}" is not a column the run's moves set`);
    if (value === AS_NOW) sets.push(`${key} = now()`);
    else if (key === "config_snapshot") {
      params.push(JSON.stringify(value));
      sets.push(`${key} = $${params.length}::jsonb`);
    } else {
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return null;
  return one(client, `UPDATE payroll_run SET ${sets.join(", ")} WHERE payroll_run_id = $1 RETURNING payroll_run_id`, params);
}

function deleteRun(client, id) {
  return client.query(`DELETE FROM payroll_run WHERE payroll_run_id = $1`, [id]);
}

/** The run to show first: the newest not yet paid, else the latest (§5, the summary). */
function currentRun(db) {
  return one(
    db,
    `SELECT ${RUN} FROM payroll_run r ${RUN_JOINS}
      ORDER BY (r.status <> 'paid') DESC, r.period DESC, r.payroll_run_id
      LIMIT 1`,
    [],
  );
}

/** Runs by status, all of them. */
async function countsByStatus(db) {
  const { rows } = await db.query(`SELECT status, count(*)::int AS n FROM payroll_run GROUP BY status`);
  const out = { draft: 0, computed: 0, submitted: 0, approved: 0, paid: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** The last twelve months' net, oldest first: an approved or paid run per month, at most twelve. */
async function trend(db, fromPeriod) {
  // pagination:complete one run a month for the twelve months from a date
  const { rows } = await completeQuery(
    db,
    `SELECT period::text AS period, net_total::text AS net_total FROM payroll_run
      WHERE status IN ('approved', 'paid') AND period >= $1::date
      ORDER BY period`,
    [fromPeriod],
    { label: "The last twelve months' net", ceiling: 12 },
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Payslips and lines
 * ------------------------------------------------------------------ */

const PAYSLIP = `p.payslip_id, p.number::text AS number, p.payroll_run_id, p.employee_id, p.status, p.excluded_reason,
  p.gross_monthly::text AS gross_monthly, p.working_days, p.working_days_paid, p.earnings_total::text AS earnings_total,
  p.deductions_total::text AS deductions_total, p.net_pay::text AS net_pay, p.employer_total::text AS employer_total,
  p.bank_name, p.account_last4, p.document_id, p.published_at, p.emailed_at`;

/** Every payslip of a run, to compute them: one per person, whole. */
async function payslipsOf(client, runId) {
  // pagination:complete the payslips of one run, rebuilt for everyone paid in the month
  const { rows } = await completeQuery(
    client,
    `SELECT ${PAYSLIP} FROM payslip p WHERE p.payroll_run_id = $1 ORDER BY p.number`,
    [runId],
    { label: "The payslips of a run", ceiling: MAX_PAYSLIPS },
  );
  return rows;
}

/** One payslip of a run for a person, or null. */
function payslipOf(client, runId, employeeId) {
  return one(client, `SELECT ${PAYSLIP} FROM payslip p WHERE p.payroll_run_id = $1 AND p.employee_id = $2`, [runId, employeeId]);
}

/**
 * Write the computed payslips of a run in one statement: a new person gets the number allocated for them,
 * an existing payslip keeps its own (and its status: excluded stays excluded). Answers each person's
 * payslip id. A row is `{ employee_id, number, status, gross_monthly, working_days, working_days_paid,
 * earnings_total, deductions_total, net_pay, employer_total, bank_name, account_last4 }`.
 */
async function upsertPayslips(client, runId, rows) {
  if (!rows.length) return new Map();
  const col = (name) => rows.map((r) => r[name] ?? null);
  const { rows: written } = await client.query(
    `INSERT INTO payslip (payroll_run_id, employee_id, number, status, excluded_reason, gross_monthly, working_days,
                          working_days_paid, earnings_total, deductions_total, net_pay, employer_total, bank_name, account_last4)
     SELECT $1, x.employee_id, x.number, x.status, x.excluded_reason, x.gross_monthly, x.working_days, x.working_days_paid,
            x.earnings_total, x.deductions_total, x.net_pay, x.employer_total, x.bank_name, x.account_last4
       FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::int[], $8::int[], $9::numeric[],
                   $10::numeric[], $11::numeric[], $12::numeric[], $13::text[], $14::text[])
            AS x(employee_id, number, status, excluded_reason, gross_monthly, working_days, working_days_paid,
                 earnings_total, deductions_total, net_pay, employer_total, bank_name, account_last4)
     ON CONFLICT (payroll_run_id, employee_id) DO UPDATE
        SET status = EXCLUDED.status, excluded_reason = EXCLUDED.excluded_reason, gross_monthly = EXCLUDED.gross_monthly,
            working_days = EXCLUDED.working_days, working_days_paid = EXCLUDED.working_days_paid,
            earnings_total = EXCLUDED.earnings_total, deductions_total = EXCLUDED.deductions_total,
            net_pay = EXCLUDED.net_pay, employer_total = EXCLUDED.employer_total, bank_name = EXCLUDED.bank_name,
            account_last4 = EXCLUDED.account_last4
     RETURNING payslip_id, employee_id`,
    [
      runId,
      col("employee_id"),
      col("number"),
      col("status"),
      col("excluded_reason"),
      col("gross_monthly"),
      col("working_days"),
      col("working_days_paid"),
      col("earnings_total"),
      col("deductions_total"),
      col("net_pay"),
      col("employer_total"),
      col("bank_name"),
      col("account_last4"),
    ],
  );
  return new Map(written.map((r) => [r.employee_id, r.payslip_id]));
}

/** Remove the payslips of people no longer paid in the month (their lines go with them). */
function deletePayslips(client, runId, employeeIds) {
  if (!employeeIds.length) return null;
  return client.query(`DELETE FROM payslip WHERE payroll_run_id = $1 AND employee_id = ANY($2::uuid[])`, [runId, employeeIds]);
}

/** Replace every line of a run's payslips with the computed ones, in two statements for the whole run. */
async function replaceLines(client, runId, lines) {
  await client.query(`DELETE FROM payslip_line WHERE payslip_id IN (SELECT payslip_id FROM payslip WHERE payroll_run_id = $1)`, [runId]);
  if (!lines.length) return;
  const col = (name) => lines.map((l) => l[name] ?? null);
  await client.query(
    `INSERT INTO payslip_line (payslip_id, position, kind, code, label, detail, amount, source_type, source_id)
     SELECT * FROM unnest($1::uuid[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::text[], $9::uuid[])`,
    [col("payslip_id"), col("position"), col("kind"), col("code"), col("label"), col("detail"), col("amount"), col("source_type"), col("source_id")],
  );
}

/**
 * Put a person's payslip out of the run, or back (Exclude, Include). The payslip is made when there is
 * none, with the number allocated for it, so an exclusion before the first Compute is kept.
 */
async function setExcluded(client, runId, employeeId, { number, reason }) {
  if (reason) {
    await client.query(`DELETE FROM payslip_line WHERE payslip_id IN (SELECT payslip_id FROM payslip WHERE payroll_run_id = $1 AND employee_id = $2)`, [
      runId,
      employeeId,
    ]);
    return one(
      client,
      `INSERT INTO payslip (payroll_run_id, employee_id, number, status, excluded_reason)
       VALUES ($1, $2, $3, 'excluded', $4)
       ON CONFLICT (payroll_run_id, employee_id) DO UPDATE
          SET status = 'excluded', excluded_reason = EXCLUDED.excluded_reason, earnings_total = 0, deductions_total = 0,
              net_pay = 0, employer_total = 0
       RETURNING payslip_id`,
      [runId, employeeId, number, reason],
    );
  }
  return one(
    client,
    `UPDATE payslip SET status = 'draft', excluded_reason = NULL
      WHERE payroll_run_id = $1 AND employee_id = $2 AND status = 'excluded' RETURNING payslip_id`,
    [runId, employeeId],
  );
}

/** A run's totals from its payslips: what the run row shows (§6.8 rule 2). */
async function totalsOfRun(client, runId) {
  return one(
    client,
    `SELECT count(*) FILTER (WHERE status <> 'excluded')::int AS headcount,
            COALESCE(sum(earnings_total) FILTER (WHERE status <> 'excluded'), 0)::text AS earnings_total,
            COALESCE(sum(deductions_total) FILTER (WHERE status <> 'excluded'), 0)::text AS deductions_total,
            COALESCE(sum(net_pay) FILTER (WHERE status <> 'excluded'), 0)::text AS net_total,
            COALESCE(sum(employer_total) FILTER (WHERE status <> 'excluded'), 0)::text AS employer_total
       FROM payslip WHERE payroll_run_id = $1`,
    [runId],
  );
}

/** Publish every payslip that is not excluded; answers each (id, person) in staff-number order. */
async function publishPayslips(client, runId) {
  const { rows } = await client.query(
    `UPDATE payslip p SET status = 'published', published_at = now()
       FROM employee e
      WHERE p.payroll_run_id = $1 AND p.status = 'draft' AND e.employee_id = p.employee_id
      RETURNING p.payslip_id, p.employee_id, p.number::text AS number, e.staff_number`,
    [runId],
  );
  return rows.sort((a, b) => String(a.staff_number).localeCompare(String(b.staff_number)));
}

/** Whether every payslip of a run is published or excluded (the lock's last check). */
async function unpublishedCount(client, runId) {
  const r = await one(client, `SELECT count(*)::int AS n FROM payslip WHERE payroll_run_id = $1 AND status = 'draft'`, [runId]);
  return r.n;
}

/* ------------------------------------------------------------------ *
 * Adjustments
 * ------------------------------------------------------------------ */

const ADJUSTMENT = `a.payroll_adjustment_id, a.payroll_run_id, a.employee_id, a.kind, a.label, a.amount::text AS amount,
  a.reason, a.created_at, ${nameOf("ce")} AS created_by_name, ${personJson("pe", "pd")} AS employee`;
const ADJUSTMENT_JOINS = `JOIN employee pe ON pe.employee_id = a.employee_id LEFT JOIN department pd ON pd.department_id = pe.department_id
  LEFT JOIN app_user cu ON cu.user_id = a.created_by LEFT JOIN employee ce ON ce.employee_id = cu.employee_id`;

/** A run's adjustments, to compute: whole, grouped by the caller. */
async function adjustmentsOf(client, runId) {
  // pagination:complete the adjustments of one run, added to payslips that Compute rebuilds
  const { rows } = await completeQuery(
    client,
    `SELECT a.payroll_adjustment_id, a.employee_id, a.kind, a.label, a.amount::text AS amount
       FROM payroll_adjustment a WHERE a.payroll_run_id = $1 ORDER BY a.created_at, a.payroll_adjustment_id`,
    [runId],
    { label: "The adjustments of a run", ceiling: MAX_PAYSLIPS * 5 },
  );
  return rows;
}

/** GET /payroll/runs/:id/adjustments: newest first. */
function pageAdjustments(db, runId, query) {
  return pageQuery(
    db,
    `SELECT ${ADJUSTMENT}, ${TOTAL_COL}
       FROM payroll_adjustment a ${ADJUSTMENT_JOINS}
      WHERE a.payroll_run_id = $1
        AND ($2::text IS NULL OR search_fold(pe.first_name || ' ' || pe.last_name || ' ' || a.label) LIKE '%' || search_fold($2) || '%')
      ORDER BY a.created_at DESC, a.payroll_adjustment_id`,
    [runId, query.q || null],
    query,
  );
}

function getAdjustment(db, id) {
  return one(db, `SELECT ${ADJUSTMENT} FROM payroll_adjustment a ${ADJUSTMENT_JOINS} WHERE a.payroll_adjustment_id = $1`, [id]);
}

function insertAdjustment(client, x) {
  return one(
    client,
    `INSERT INTO payroll_adjustment (payroll_run_id, employee_id, kind, label, amount, reason, created_by)
     VALUES ($1, $2, $3, $4, $5::numeric, $6, $7) RETURNING payroll_adjustment_id`,
    [x.payroll_run_id, x.employee_id, x.kind, x.label, x.amount, x.reason, x.created_by],
  );
}

/** Remove an adjustment of a run; answers its person, or null when the run has none by that id. */
function deleteAdjustment(client, runId, id) {
  return one(
    client,
    `DELETE FROM payroll_adjustment WHERE payroll_run_id = $1 AND payroll_adjustment_id = $2
     RETURNING payroll_adjustment_id, employee_id, kind, label`,
    [runId, id],
  );
}

/* ------------------------------------------------------------------ *
 * Instalments a run freezes, applies and gives back (§6.6 rule 7, §6.9)
 * ------------------------------------------------------------------ */

/** Freeze the named instalments into the run: scheduled → in_run. Answers how many were frozen. */
async function freezeInstalments(client, runId, ids) {
  if (!ids.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE payroll_deduction_instalment SET status = 'in_run', payroll_run_id = $2
      WHERE payroll_deduction_instalment_id = ANY($1::uuid[]) AND status = 'scheduled'`,
    [ids, runId],
  );
  return rowCount;
}

/** A Send Back gives them back: in_run → scheduled, no run. */
async function releaseInstalments(client, runId) {
  const { rowCount } = await client.query(
    `UPDATE payroll_deduction_instalment SET status = 'scheduled', payroll_run_id = NULL
      WHERE payroll_run_id = $1 AND status = 'in_run'`,
    [runId],
  );
  return rowCount;
}

/** The lock applies them: in_run → applied. */
async function applyInstalments(client, runId) {
  const { rowCount } = await client.query(
    `UPDATE payroll_deduction_instalment SET status = 'applied' WHERE payroll_run_id = $1 AND status = 'in_run'`,
    [runId],
  );
  return rowCount;
}

/**
 * Settle the deductions whose last instalment this run applied: active, none still to come, one applied
 * in this run. Answers each with its fine, so the lock settles the fine through its owner.
 */
async function settleFinished(client, runId) {
  const { rows } = await client.query(
    `UPDATE payroll_deduction d SET status = 'settled', settled_at = now()
      WHERE d.status = 'active'
        AND EXISTS (SELECT 1 FROM payroll_deduction_instalment i WHERE i.payroll_deduction_id = d.payroll_deduction_id AND i.payroll_run_id = $1)
        AND NOT EXISTS (SELECT 1 FROM payroll_deduction_instalment i
                         WHERE i.payroll_deduction_id = d.payroll_deduction_id AND i.status IN ('scheduled', 'in_run'))
      RETURNING d.payroll_deduction_id, d.employee_id, d.source, d.sanction_fine_id`,
    [runId],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Problems (§6.15)
 * ------------------------------------------------------------------ */

/**
 * The problems of the runs named in $1, as rows. Only a Draft or Computed run reports any. A person
 * with no payslip line is still one with a payslip (No Salary Set has none). `n` counts what a message
 * names (the overtime items, the fines).
 */
/** The CTE the problems come out of, named once so a query reading it is not mistaken for one reading a table. */
const FOUND = "found";
const PROBLEMS = `
  WITH base AS (
    SELECT p.payslip_id, p.payroll_run_id, p.employee_id, p.gross_monthly, p.net_pay, p.bank_name, p.account_last4,
           r.period, COALESCE((r.config_snapshot->>'require_bank_details')::boolean, false) AS require_bank,
           (date_trunc('month', r.period) + interval '1 month - 1 day')::date AS last_day
      FROM payslip p JOIN payroll_run r ON r.payroll_run_id = p.payroll_run_id
     WHERE p.payroll_run_id = ANY($1::uuid[]) AND r.status IN ('draft', 'computed') AND p.status <> 'excluded'
  ), found AS (
    SELECT 'NO_SALARY' AS code, 'blocking' AS severity, 0 AS weight, b.payroll_run_id, b.employee_id, b.payslip_id, 1 AS n
      FROM base b WHERE b.gross_monthly IS NULL
    UNION ALL
    SELECT 'NEGATIVE_NET', 'blocking', 1, b.payroll_run_id, b.employee_id, b.payslip_id, 1
      FROM base b WHERE b.net_pay < 0
    UNION ALL
    SELECT 'NO_BANK', CASE WHEN b.require_bank THEN 'blocking' ELSE 'warning' END, CASE WHEN b.require_bank THEN 2 ELSE 5 END,
           b.payroll_run_id, b.employee_id, b.payslip_id, 1
      FROM base b WHERE b.bank_name IS NULL OR b.account_last4 IS NULL
    UNION ALL
    SELECT 'CONTRACT_ENDED', 'warning', 6, b.payroll_run_id, b.employee_id, b.payslip_id, 1
      FROM base b JOIN employee e ON e.employee_id = b.employee_id
     WHERE e.status = 'active' AND e.contract_ends_on IS NOT NULL AND e.contract_ends_on < b.last_day
    UNION ALL
    SELECT 'OVERTIME_WAITING', 'warning', 3, b.payroll_run_id, b.employee_id, b.payslip_id, w.n::int
      FROM base b
      JOIN LATERAL (SELECT count(*) AS n FROM attendance_pay_item i
                     WHERE i.employee_id = b.employee_id AND i.kind = 'overtime' AND i.status = 'pending'
                       AND i.payroll_run_id IS NULL AND i.work_date <= b.last_day) w ON w.n > 0
    UNION ALL
    SELECT 'FINE_WAITING', 'warning', 4, b.payroll_run_id, b.employee_id, b.payslip_id, w.n::int
      FROM base b
      JOIN LATERAL (SELECT count(*) AS n FROM sanction_fine f JOIN sanction x ON x.sanction_id = f.sanction_id
                     WHERE x.employee_id = b.employee_id AND x.status = 'issued' AND f.settlement_status = 'pending') w ON w.n > 0
    UNION ALL
    SELECT 'NO_RATES', 'blocking', 0, r.payroll_run_id, NULL::uuid, NULL::uuid, 1
      FROM payroll_run r WHERE r.payroll_run_id = ANY($1::uuid[]) AND r.advanced AND r.status IN ('draft', 'computed')
  )`;

/** GET /payroll/runs/:id/problems: blocking first, then the warnings, each naming the person. */
function pageProblems(db, runId, query) {
  return pageQuery(
    db,
    `${PROBLEMS}
     SELECT f.code, f.severity, f.payslip_id, f.n, f.employee_id, btrim(e.first_name || ' ' || e.last_name) AS display_name,
            ${personJson("e", "d")} AS employee, ${TOTAL_COL}
       FROM ${FOUND} f
       LEFT JOIN employee e ON e.employee_id = f.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      ORDER BY f.weight, f.code, e.first_name, e.last_name, f.employee_id NULLS FIRST, f.payslip_id`,
    [[runId]],
    query,
  );
}

/** How many blocking problems and warnings each of these runs reports. */
async function problemCounts(db, runIds) {
  if (!runIds.length) return new Map();
  const { rows } = await db.query(
    `${PROBLEMS}
     SELECT payroll_run_id, count(*) FILTER (WHERE severity = 'blocking')::int AS blocking,
            count(*) FILTER (WHERE severity = 'warning')::int AS warnings
       FROM ${FOUND} GROUP BY payroll_run_id`,
    [runIds],
  );
  return new Map(rows.map((r) => [r.payroll_run_id, { blocking: r.blocking, warnings: r.warnings }]));
}

/* ------------------------------------------------------------------ *
 * Reads the service needs
 * ------------------------------------------------------------------ */

/** The decision that approved a pending instance: who approved it (the lock records them). */
function approverOf(db, instanceId) {
  return one(
    db,
    `SELECT d.actor_id FROM workflow_decision d
      WHERE d.workflow_instance_id = $1 AND d.decision = 'approve'
      ORDER BY d.decided_at DESC, d.workflow_decision_id LIMIT 1`,
    [instanceId],
  );
}

module.exports = {
  listRuns,
  getRun,
  lockRun,
  runOfPeriod,
  newestOpenPeriod,
  lockRunsOfPeriods,
  earliestStart,
  insertRun,
  setRun,
  deleteRun,
  currentRun,
  countsByStatus,
  trend,
  payslipsOf,
  payslipOf,
  upsertPayslips,
  deletePayslips,
  replaceLines,
  setExcluded,
  totalsOfRun,
  publishPayslips,
  unpublishedCount,
  adjustmentsOf,
  pageAdjustments,
  getAdjustment,
  insertAdjustment,
  deleteAdjustment,
  freezeInstalments,
  releaseInstalments,
  applyInstalments,
  settleFinished,
  pageProblems,
  problemCounts,
  approverOf,
};
