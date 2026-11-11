"use strict";
/**
 * Salary structure's SQL (docs/guides/payroll.md §4.2, §6.11 rules 5 and 6): grades, where people are placed and their
 * pay splits, read as of a day. Parameterised, no business rules, no events. Versions are written through
 * shared/db/effective-dated by the service, never here.
 *
 * A placement points at any version of a grade; the band it is read against is the version of that grade's code in
 * force on the day asked, so a grade's new band from a date applies to everyone placed in it without moving them.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { asOf } = require("../../shared/db/effective-dated");
const { personJson } = require("../../shared/db/person");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** The people a structure is about: paid now, as payroll pays them (active or suspended). */
const PAID_NOW = `e.status IN ('active', 'suspended')`;

/* ------------------------------------------------------------------ *
 * Grades
 * ------------------------------------------------------------------ */

const GRADE = `g.salary_grade_id, g.code::text AS code, g.name, g.minimum::text AS minimum, g.maximum::text AS maximum,
  g.effective_from::text AS effective_from, g.effective_to::text AS effective_to, g.created_at`;

const GRADE_SORTS = { minimum: "g.minimum", code: "g.code", name: "g.name" };

/**
 * GET /salary-structure/grades: with `as_of`, the versions in force that day; without, those in force `today` and those
 * that start later. Each with how many people paid now are placed in its code today, and how many of them earn below
 * its minimum or above its maximum.
 */
function listGrades(db, query, today) {
  const sorted = query.sort ? query : { ...query, sort: { field: "minimum", dir: "asc" } };
  return pageQuery(
    db,
    `SELECT ${GRADE}, COALESCE(n.staff, 0)::int AS staff, COALESCE(n.below, 0)::int AS below_minimum,
            COALESCE(n.above, 0)::int AS above_maximum, ${TOTAL_COL}
       FROM salary_grade g
       LEFT JOIN LATERAL (
         SELECT count(*) AS staff,
                count(*) FILTER (WHERE e.gross_monthly < g.minimum) AS below,
                count(*) FILTER (WHERE e.gross_monthly > g.maximum) AS above
           FROM employee_salary_grade p
           JOIN salary_grade pg ON pg.salary_grade_id = p.salary_grade_id
           JOIN employee e ON e.employee_id = p.employee_id
          WHERE pg.code = g.code AND ${asOf("p", 2)} AND ${PAID_NOW}
       ) n ON true
      WHERE (CASE WHEN $1::date IS NULL THEN (g.effective_to IS NULL OR g.effective_to > $2::date) ELSE ${asOf("g", 1)} END)
      ORDER BY ${orderBy(sorted, GRADE_SORTS, "g.salary_grade_id")}`,
    [query.as_of || null, today],
    sorted,
  );
}

/** One version of a grade with its counts today, or null. */
async function gradeRow(db, id, today) {
  return one(
    db,
    `SELECT ${GRADE},
            (SELECT count(*)::int FROM employee_salary_grade p JOIN salary_grade pg ON pg.salary_grade_id = p.salary_grade_id
               JOIN employee e ON e.employee_id = p.employee_id
              WHERE pg.code = g.code AND ${asOf("p", 2)} AND ${PAID_NOW}) AS staff,
            (SELECT count(*)::int FROM employee_salary_grade p JOIN salary_grade pg ON pg.salary_grade_id = p.salary_grade_id
               JOIN employee e ON e.employee_id = p.employee_id
              WHERE pg.code = g.code AND ${asOf("p", 2)} AND ${PAID_NOW} AND e.gross_monthly < g.minimum) AS below_minimum,
            (SELECT count(*)::int FROM employee_salary_grade p JOIN salary_grade pg ON pg.salary_grade_id = p.salary_grade_id
               JOIN employee e ON e.employee_id = p.employee_id
              WHERE pg.code = g.code AND ${asOf("p", 2)} AND ${PAID_NOW} AND e.gross_monthly > g.maximum) AS above_maximum
       FROM salary_grade g WHERE g.salary_grade_id = $1`,
    [id, today],
  );
}

/** The version of a grade's code in force on a day, given any version of it, or null. */
function gradeInForce(db, anyVersionId, date) {
  return one(
    db,
    `SELECT ${GRADE} FROM salary_grade g
      WHERE g.code = (SELECT code FROM salary_grade WHERE salary_grade_id = $1) AND ${asOf("g", 2)}`,
    [anyVersionId, date],
  );
}

/** Whether any version of a grade exists by this id. */
function gradeExists(db, id) {
  return one(db, `SELECT salary_grade_id FROM salary_grade WHERE salary_grade_id = $1`, [id]);
}

/* ------------------------------------------------------------------ *
 * Placements: people against their bands
 * ------------------------------------------------------------------ */

/** Where a person's gross stands against a band: SQL over the aliases e (employee) and b (the band in force). */
const POSITION = `CASE WHEN b.salary_grade_id IS NULL OR e.gross_monthly IS NULL THEN NULL
  WHEN e.gross_monthly < b.minimum THEN 'below' WHEN e.gross_monthly > b.maximum THEN 'above' ELSE 'within' END`;

const PLACEMENT = `e.employee_id, ${personJson("e", "d")} AS employee, e.gross_monthly::text AS gross_monthly,
  b.salary_grade_id, b.code::text AS grade_code, b.name AS grade_name, ${POSITION} AS band_position,
  p.effective_from::text AS effective_from,
  EXISTS (SELECT 1 FROM employee_pay_component c WHERE c.employee_id = e.employee_id AND ${asOf("c", 1)}) AS has_pay_split`;

/** The placement in force on $1 and the band of its grade's code in force that day. */
const PLACEMENT_JOINS = `
  JOIN department d ON d.department_id = e.department_id
  LEFT JOIN employee_salary_grade p ON p.employee_id = e.employee_id AND ${asOf("p", 1)}
  LEFT JOIN salary_grade pg ON pg.salary_grade_id = p.salary_grade_id
  LEFT JOIN salary_grade b ON b.code = pg.code AND ${asOf("b", 1)}`;

const PLACEMENT_SORTS = {
  employee: "btrim(e.first_name || ' ' || e.last_name)",
  grade: "b.minimum",
};

/**
 * GET /salary-structure/placements: everyone paid now, placed or not, against the band in force `today`. A filter by
 * grade matches its code, whichever version was named.
 */
function listPlacements(db, query, today) {
  const sorted = query.sort ? query : { ...query, sort: { field: "employee", dir: "asc" } };
  return pageQuery(
    db,
    `SELECT ${PLACEMENT}, ${TOTAL_COL}
       FROM employee e ${PLACEMENT_JOINS}
      WHERE ${PAID_NOW}
        AND ($2::uuid IS NULL OR pg.code = (SELECT code FROM salary_grade WHERE salary_grade_id = $2))
        AND ($3::text IS NULL OR ($3 = 'unplaced' AND p.employee_salary_grade_id IS NULL) OR (${POSITION}) = $3)
        AND ($4::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name || ' ' || e.staff_number) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(sorted, PLACEMENT_SORTS, "e.employee_id")}`,
    [today, query.salary_grade_id || null, query.band_position || null, query.q || null],
    sorted,
  );
}

/** One person against their band `today`, whatever their status, or null when there is no such person. */
function placementOf(db, employeeId, today) {
  return one(db, `SELECT ${PLACEMENT} FROM employee e ${PLACEMENT_JOINS} WHERE e.employee_id = $2`, [today, employeeId]);
}

/* ------------------------------------------------------------------ *
 * Pay components
 * ------------------------------------------------------------------ */

const COMPONENT = `c.employee_pay_component_id, c.employee_id, c.code::text AS code, c.label, c.amount::text AS amount,
  c.pensionable, c.effective_from::text AS effective_from, c.effective_to::text AS effective_to`;

/** The most rows one person's split holds at once. */
const MAX_COMPONENTS = 10;

/** A person's split in force on a day, basic first. */
async function splitOn(db, employeeId, date) {
  // pagination:complete one person's pay split on one day: at most ten components
  const { rows } = await completeQuery(
    db,
    `SELECT ${COMPONENT} FROM employee_pay_component c WHERE c.employee_id = $1 AND ${asOf("c", 2)}
      ORDER BY (c.code <> 'basic'), c.created_at, c.code`,
    [employeeId, date],
    { label: "A person's pay split", ceiling: MAX_COMPONENTS },
  );
  return rows;
}

/** A person's split that starts after a day (the next version), basic first. */
async function splitAfter(db, employeeId, date) {
  // pagination:complete one person's next pay split: at most ten components
  const { rows } = await completeQuery(
    db,
    `SELECT ${COMPONENT} FROM employee_pay_component c
      WHERE c.employee_id = $1
        AND c.effective_from = (SELECT min(effective_from) FROM employee_pay_component WHERE employee_id = $1 AND effective_from > $2::date)
      ORDER BY (c.code <> 'basic'), c.created_at, c.code`,
    [employeeId, date],
    { label: "A person's next pay split", ceiling: MAX_COMPONENTS },
  );
  return rows;
}

/**
 * The splits in force on a day for every person a run pays (§6.11 rule 6), basic first: read whole, as a run reads
 * everything it is computed from.
 */
async function splitsFor(db, employeeIds, date) {
  if (!employeeIds.length) return [];
  // pagination:complete the pay splits of the people one run pays, on its last day
  const { rows } = await completeQuery(
    db,
    `SELECT ${COMPONENT} FROM employee_pay_component c WHERE c.employee_id = ANY($1::uuid[]) AND ${asOf("c", 2)}
      ORDER BY c.employee_id, (c.code <> 'basic'), c.created_at, c.code`,
    [employeeIds, date],
    { label: "The pay splits of a run", ceiling: 5000 * MAX_COMPONENTS },
  );
  return rows;
}

/** A person as a PersonRef with their monthly gross, or null. */
function personOf(db, employeeId) {
  return one(
    db,
    `SELECT e.employee_id, ${personJson("e", "d")} AS employee, e.gross_monthly::text AS gross_monthly
       FROM employee e JOIN department d ON d.department_id = e.department_id WHERE e.employee_id = $1`,
    [employeeId],
  );
}

module.exports = {
  listGrades,
  gradeRow,
  gradeInForce,
  gradeExists,
  listPlacements,
  placementOf,
  splitOn,
  splitAfter,
  splitsFor,
  personOf,
};
