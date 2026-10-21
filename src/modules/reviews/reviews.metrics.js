"use strict";
/**
 * Performance · Analytics (docs/guides/performance.md §2, §10): the figures over a year's KPIs
 * and a cycle's reviews, within the reader's `performance` scope on the person.
 *
 *   completion      the mean attainment of each month's approved KPIs, January to December
 *   by_department   the mean attainment of the year's approved KPIs, by the person's department
 *   averages, gap   a cycle's self and manager ratings, overall and by department; the gap is
 *                   manager minus self
 */
const { scopeClause } = require("../../shared/rbac/scope");
const { ATTAINMENT_SQL, COUNTED } = require("../kpis/kpis.score");

const round = (v, places = 4) => (v === null || v === undefined ? null : Math.round(Number(v) * 10 ** places) / 10 ** places);

/** Mean attainment of approved KPIs by month of a year. */
async function completion(client, year, scope) {
  const params = [`${year}-01-01`, `${year}-12-01`, COUNTED];
  const s = scopeClause(scope, { column: "t.employee_id" }, params);
  const { rows } = await client.query(
    `SELECT to_char(m.month, 'YYYY-MM') AS month, avg(${ATTAINMENT_SQL("t")})::float8 AS attainment
       FROM generate_series($1::date, $2::date, interval '1 month') AS m(month)
       LEFT JOIN employee_target t ON t.month = m.month AND t.status = ANY($3::text[]) ${s.and}
      GROUP BY m.month ORDER BY m.month`,
    params,
  );
  return rows.map((r) => ({ month: r.month, attainment: round(r.attainment) }));
}

/** Mean attainment of a year's approved KPIs, by the person's department. */
async function byDepartment(client, year, scope) {
  const params = [`${year}-01-01`, `${year}-12-31`, COUNTED];
  const s = scopeClause(scope, { column: "t.employee_id" }, params);
  const { rows } = await client.query(
    `SELECT d.department_id, d.name AS department, avg(${ATTAINMENT_SQL("t")})::float8 AS attainment
       FROM employee_target t
       JOIN employee e ON e.employee_id = t.employee_id
       JOIN department d ON d.department_id = e.department_id
      WHERE t.month BETWEEN $1::date AND $2::date AND t.status = ANY($3::text[]) ${s.and}
      GROUP BY d.department_id, d.name ORDER BY d.name, d.department_id`,
    params,
  );
  return rows.map((r) => ({ department_id: r.department_id, department: r.department, attainment: round(r.attainment) }));
}

/** A cycle's reviews: how many closed, and the self and manager ratings overall and by department. */
async function ratings(client, cycleId, scope) {
  const params = [cycleId];
  const s = scopeClause(scope, { column: "r.employee_id" }, params);
  const { rows } = await client.query(
    `WITH r AS (
       SELECT r.*, e.department_id FROM performance_review r JOIN employee e ON e.employee_id = r.employee_id
        WHERE r.performance_cycle_id = $1 ${s.and}
     ), self AS (
       SELECT department_id, overall_score FROM r WHERE review_type = 'self' AND submitted_at IS NOT NULL
     ), mgr AS (
       SELECT department_id, overall_score FROM r WHERE review_type <> 'self' AND status = 'closed'
     )
     SELECT NULL::uuid AS department_id, NULL::text AS department,
            (SELECT count(*)::int FROM r WHERE review_type <> 'self') AS total,
            (SELECT count(*)::int FROM mgr) AS closed,
            (SELECT avg(overall_score)::float8 FROM self) AS self,
            (SELECT avg(overall_score)::float8 FROM mgr) AS manager
     UNION ALL
     SELECT d.department_id, d.name,
            NULL, NULL,
            (SELECT avg(overall_score)::float8 FROM self WHERE self.department_id = d.department_id),
            (SELECT avg(overall_score)::float8 FROM mgr WHERE mgr.department_id = d.department_id)
       FROM department d WHERE d.department_id IN (SELECT department_id FROM r)
     ORDER BY department NULLS FIRST, department_id`,
    params,
  );
  const [all, ...departments] = rows;
  return {
    total: all.total,
    closed: all.closed,
    self: round(all.self, 2),
    manager: round(all.manager, 2),
    gap: departments.map((d) => ({
      department_id: d.department_id,
      department: d.department,
      self: round(d.self, 2),
      manager: round(d.manager, 2),
      gap: d.self === null || d.manager === null ? null : round(d.manager - d.self, 2),
    })),
  };
}

module.exports = { completion, byDepartment, ratings };
