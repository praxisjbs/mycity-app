"use strict";
/**
 * Goals: the SQL. Quarters (performance_period) in PR 1; organisational goals, objectives, key
 * results, their months, plans and target changes join them in PR 2 (docs/guides/performance.md
 * §12). Writes only the goals module's own rows. Never emits (BACKEND_GUIDE §2).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** A quarter as the service turns it into PerformancePeriod. */
const PERIOD = `p.performance_period_id, p.name, p.starts_on, p.ends_on, p.plan_year_starts_on,
  p.targets_lock_on, p.live_from, p.status, p.rules, p.created_at, p.updated_at`;

const PERIOD_SORTS = { starts_on: "p.starts_on" };

/** One page of quarters, the latest first unless sorted otherwise. */
function listPeriods(db, query) {
  const sorted = query.sort ? query : { ...query, sort: { field: "starts_on", dir: "desc" } };
  return pageQuery(
    db,
    `SELECT ${PERIOD}, ${TOTAL_COL}
       FROM performance_period p
      WHERE ($1::text IS NULL OR p.status = $1)
        AND ($2::text IS NULL OR search_fold(p.name) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(sorted, PERIOD_SORTS, "p.performance_period_id")}`,
    [query.status || null, query.q || null],
    query,
  );
}

const getPeriod = (db, id) =>
  one(db, `SELECT ${PERIOD} FROM performance_period p WHERE p.performance_period_id = $1`, [id]);

/** The active quarter, else the latest one still being planned. */
const currentPeriod = (db) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p
      WHERE p.status IN ('active', 'planning')
      ORDER BY (p.status = 'active') DESC, p.starts_on DESC
      LIMIT 1`,
    [],
  );

/** The latest quarter starting before a date: the one whose rules a new quarter copies. */
const periodBefore = (db, startsOn) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p WHERE p.starts_on < $1 ORDER BY p.starts_on DESC LIMIT 1`,
    [startsOn],
  );

const periodStarting = (db, startsOn) =>
  one(db, `SELECT ${PERIOD} FROM performance_period p WHERE p.starts_on = $1`, [startsOn]);

/** Another active quarter than this one, if any. */
const otherActive = (db, id) =>
  one(
    db,
    `SELECT ${PERIOD} FROM performance_period p WHERE p.status = 'active' AND p.performance_period_id <> $1`,
    [id],
  );

function insertPeriod(client, p) {
  return one(
    client,
    `INSERT INTO performance_period
       (name, starts_on, ends_on, plan_year_starts_on, targets_lock_on, live_from, status, rules)
     VALUES ($1, $2, $3, $4, $5, $6, 'planning', $7::jsonb)
     RETURNING performance_period_id`,
    [p.name, p.starts_on, p.ends_on, p.plan_year_starts_on, p.targets_lock_on, p.live_from, JSON.stringify(p.rules)],
  );
}

const PERIOD_WRITABLE = ["name", "targets_lock_on", "live_from", "status", "rules"];

async function updatePeriod(client, id, patch) {
  const keys = PERIOD_WRITABLE.filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  const vals = keys.map((k) => (k === "rules" ? JSON.stringify(patch[k]) : patch[k]));
  await client.query(
    `UPDATE performance_period SET ${keys.map((k, i) => `${k} = $${i + 2}${k === "rules" ? "::jsonb" : ""}`).join(", ")}
      WHERE performance_period_id = $1`,
    [id, ...vals],
  );
}

module.exports = {
  listPeriods,
  getPeriod,
  currentPeriod,
  periodBefore,
  periodStarting,
  otherActive,
  insertPeriod,
  updatePeriod,
};
