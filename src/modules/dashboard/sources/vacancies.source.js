"use strict";
/**
 * Vacancies, as Home reads them: the open vacancies behind the Open Vacancies card.
 *
 * OWNED BY the `vacancies` module, M4 Recruitment, TB (migration 4000).
 *
 * Home reads this table before the module that owns it is built, so this file is the one
 * place Home names it. The M4 pull request that builds `vacancies` MUST, in the same PR,
 * move or replace these queries with its own reads, keep `tables` true to every column they
 * name, and clear `owes` as it pays each item (docs/guides/home.md §4.1,
 * docs/DATABASE_SCHEMA.md M4 Owes). A unit test holds `tables` to the migrated schema and
 * the queries to `tables`.
 *
 * A vacancy is its hiring manager's: scope runs on v.hiring_manager_id, so a vacancy with
 * no hiring manager is seen only with `all` scope. Open is the status `open` of the
 * vacancy lifecycle (draft, open, paused, closed; reference data 4099).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../../shared/http/paged");
const { scopeClause } = require("../../../shared/rbac/scope");
const { PERSON } = require("../kpi-catalog/shared");

/** The forward tables and the columns these queries read. */
const TABLES = Object.freeze({
  vacancy: ["vacancy_id", "number", "title", "status", "department_id", "hiring_manager_id", "positions", "closes_at"],
});

/** What M4 still owes these queries. */
const OWES = Object.freeze([
  "The vacancy lifecycle (README vacancies.lifecycle): its statuses have no CHECK yet; Home counts `open`.",
  "Index vacancy (status), for the open count (asked by Home).",
]);

/**
 * How many vacancies are open, within the scope.
 * @param {{query: Function}} client
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @returns {Promise<number>}
 */
async function openCount(client, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM vacancy v WHERE v.status = 'open' ${s.and}`,
    params,
  );
  return rows[0].n;
}

/** One page of the open vacancies, within the scope, soonest closing first. */
function openPage(client, scope, query) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  return pageQuery(
    client,
    `SELECT v.vacancy_id, v.number, v.title, vd.name AS department, v.positions, v.closes_at,
            ${PERSON("e", "d")} AS hiring_manager, ${TOTAL_COL}
       FROM vacancy v
       LEFT JOIN department vd ON vd.department_id = v.department_id
       LEFT JOIN employee e ON e.employee_id = v.hiring_manager_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE v.status = 'open'
        AND ($1::text IS NULL OR search_fold(v.title) LIKE '%' || search_fold($1) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, { closes_at: "v.closes_at" }, "v.vacancy_id")}`,
    params,
    query,
  );
}

module.exports = {
  module: "vacancies",
  milestone: "M4",
  owner: "TB",
  tables: TABLES,
  owes: OWES,
  openCount,
  openPage,
};
