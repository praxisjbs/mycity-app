"use strict";
/**
 * KPIs: the SQL. Writes kpi_definition and kpi_month; reads the scorecard lines that use a KPI.
 * Never emits (BACKEND_GUIDE §2).
 */
const { pageQuery, completeQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** A month as the contract gives it, with who recorded it. */
const MONTH = `m.kpi_month_id, m.kpi_definition_id, m.month, m.result, trim_scale(m.actual_value)::text AS actual_value,
  m.actual_text, m.comment, m.recorded_at,
  (SELECT ${personJson("re", "rd")} FROM app_user ru
     JOIN employee re ON re.employee_id = ru.employee_id
     LEFT JOIN department rd ON rd.department_id = re.department_id
    WHERE ru.user_id = m.recorded_by) AS recorded_by`;

/** A KPI with its latest month (on or before `$1`, the month the reader is looking at). */
const ROW = `k.kpi_definition_id, k.code::text AS code, k.name, k.description, k.department_id, d.name AS department,
  k.formula, k.unit, k.direction, k.target_text, trim_scale(k.target_value)::text AS target_value, k.frequency,
  k.data_source, k.starts_period_id, k.active, k.created_at, k.updated_at,
  (SELECT row_to_json(x) FROM (SELECT ${MONTH} FROM kpi_month m
     WHERE m.kpi_definition_id = k.kpi_definition_id
       AND m.month = (SELECT max(m2.month) FROM kpi_month m2
                       WHERE m2.kpi_definition_id = k.kpi_definition_id
                         AND ($1::date IS NULL OR m2.month <= $1::date))) x) AS latest`;

const FROM = `FROM kpi_definition k LEFT JOIN department d ON d.department_id = k.department_id`;

const SORTS = { code: "k.code", name: "k.name" };

/**
 * One page of KPIs.
 * @param {object} query  KpiListQuery; `until` the last month the reader looks at (a quarter's end)
 */
function list(db, query, until = null) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE k.department_id IS NOT NULL
        AND ($2::uuid IS NULL OR k.department_id = $2)
        AND ($3::boolean IS NULL OR k.active = $3)
        AND ($4::text IS NULL OR search_fold(k.code || ' ' || k.name) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, SORTS, "k.kpi_definition_id")}`,
    [until, query.department_id || null, query.active === undefined ? null : query.active === "true", query.q || null],
    query,
  );
}

/** The KPIs figures: active KPIs, and how many met, did not meet or await `month`. One row. */
const summary = (db, { department_id: departmentId, month }) =>
  one(
    db,
    `SELECT count(*)::int AS kpis,
            count(*) FILTER (WHERE m.result = 'met')::int AS met,
            count(*) FILTER (WHERE m.result = 'not_met')::int AS not_met,
            count(*) FILTER (WHERE m.kpi_month_id IS NULL)::int AS awaiting
       FROM kpi_definition k
       LEFT JOIN kpi_month m ON m.kpi_definition_id = k.kpi_definition_id AND m.month = $2::date
      WHERE k.department_id IS NOT NULL AND k.active AND ($1::uuid IS NULL OR k.department_id = $1)`,
    [departmentId, month],
  );

const get = (db, id, until = null) => one(db, `SELECT ${ROW} ${FROM} WHERE k.kpi_definition_id = $2`, [until, id]);

/** Every KPI of a function, for a plan (bounded by the function's own list). */
async function ofDepartment(db, departmentId) {
  // pagination:complete a plan binds every KPI of its function at once; a function holds a few dozen
  const { rows } = await completeQuery(
    db,
    `SELECT ${ROW} ${FROM} WHERE k.department_id = $2 AND k.active ORDER BY k.code, k.kpi_definition_id`,
    [null, departmentId],
    { label: "a function's KPIs" },
  );
  return rows;
}

/** A KPI's months, oldest first, from `from` (a quarter's start) when given. */
async function months(db, id, from = null) {
  // pagination:complete one row a month; a KPI's panel shows its months side by side
  const { rows } = await completeQuery(
    db,
    `SELECT ${MONTH} FROM kpi_month m
      WHERE m.kpi_definition_id = $1 AND ($2::date IS NULL OR m.month >= $2::date)
      ORDER BY m.month, m.kpi_month_id`,
    [id, from],
    { label: "a KPI's months", ceiling: 120 },
  );
  return rows;
}

/** The scorecard lines scored from a KPI. */
async function lines(db, id) {
  // pagination:complete the lines one KPI feeds: at most one per person on the function's scorecards
  const { rows } = await completeQuery(
    db,
    `SELECT t.employee_target_id, t.scorecard_id, ${personJson("e", "d")} AS employee, t.title, trim_scale(t.weight)::text AS weight
       FROM employee_target t
       JOIN employee e ON e.employee_id = t.employee_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE t.kpi_definition_id = $1 AND t.scorecard_id IS NOT NULL
      ORDER BY e.first_name, e.last_name, t.employee_target_id`,
    [id],
    { label: "the lines a KPI feeds" },
  );
  return rows;
}

/** The codes a function's KPIs already use, for the next free one. */
async function codesWithPrefix(db, prefix) {
  const { rows } = await db.query("SELECT code::text AS code FROM kpi_definition WHERE code ILIKE $1 || '-K%'", [prefix]);
  return rows.map((r) => r.code);
}

const WRITABLE = [
  "code", "name", "description", "department_id", "formula", "unit", "direction", "target_text",
  "target_value", "frequency", "data_source", "starts_period_id", "active",
];

async function insert(client, row) {
  const keys = WRITABLE.filter((k) => row[k] !== undefined);
  const { rows } = await client.query(
    `INSERT INTO kpi_definition (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING kpi_definition_id`,
    keys.map((k) => row[k]),
  );
  return rows[0].kpi_definition_id;
}

async function update(client, id, patch) {
  const keys = WRITABLE.filter((k) => patch[k] !== undefined && k !== "code" && k !== "department_id");
  if (!keys.length) return;
  await client.query(
    `UPDATE kpi_definition SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE kpi_definition_id = $1`,
    [id, ...keys.map((k) => patch[k])],
  );
}

/** Record a month's actual: one per KPI per month. */
function upsertMonth(client, id, m, userId) {
  return one(
    client,
    `INSERT INTO kpi_month (kpi_definition_id, month, result, actual_value, actual_text, comment, recorded_by, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (kpi_definition_id, month) DO UPDATE SET
       result = EXCLUDED.result, actual_value = EXCLUDED.actual_value, actual_text = EXCLUDED.actual_text,
       comment = EXCLUDED.comment, recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING kpi_month_id`,
    [id, m.month, m.result, m.actual_value ?? null, m.actual_text ?? null, m.comment ?? null, userId || null],
  );
}

const month = (db, id, monthStart) =>
  one(db, `SELECT ${MONTH} FROM kpi_month m WHERE m.kpi_definition_id = $1 AND m.month = $2`, [id, monthStart]);

const findByCode = (db, code) => one(db, "SELECT kpi_definition_id, department_id FROM kpi_definition WHERE code = $1", [code]);

/** Does a scorecard line or a review item score from this KPI? */
const inUse = async (db, id) =>
  Boolean(
    await one(
      db,
      `SELECT 1 AS x WHERE EXISTS (SELECT 1 FROM employee_target WHERE kpi_definition_id = $1)
          OR EXISTS (SELECT 1 FROM performance_review_item WHERE kpi_definition_id = $1)`,
      [id],
    ),
  );

/** A KPI gone with an import that is reverted; its months and former codes go with it (ON DELETE CASCADE). */
const remove = (client, id) => client.query("DELETE FROM kpi_definition WHERE kpi_definition_id = $1", [id]);

module.exports = { list, summary, get, ofDepartment, months, lines, codesWithPrefix, insert, update, upsertMonth, month, findByCode, inUse, remove };
