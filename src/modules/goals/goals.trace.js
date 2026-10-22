"use strict";
/**
 * What a key result rolls up to (docs/guides/performance.md §5, Trace): the key result, the
 * company key results it feeds, their objectives, and the organisational goals those serve. A
 * company key result rolls up through its own objective.
 */
const { completeQuery } = require("../../shared/http/paged");

/**
 * @param {{query: Function}} db
 * @param {string} keyResultId
 * @returns {Promise<{steps: Array<{kind: string, id: string, code: string|null, title: string}>}>}
 */
async function traceOf(db, keyResultId) {
  // pagination:complete one key result's path to the top: a handful of rows
  const { rows } = await completeQuery(
    db,
    `WITH start AS (
       SELECT kr.okr_key_result_id, kr.code::text AS code, kr.statement, o.department_id, o.okr_objective_id
         FROM okr_key_result kr JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
        WHERE kr.okr_key_result_id = $1
     ), company AS (
       SELECT c.okr_key_result_id, c.code::text AS code, c.statement, c.okr_objective_id
         FROM start s
         JOIN okr_key_result_link l ON l.okr_key_result_id = s.okr_key_result_id
         JOIN okr_key_result c ON c.okr_key_result_id = l.company_key_result_id
       UNION
       SELECT s.okr_key_result_id, s.code, s.statement, s.okr_objective_id FROM start s WHERE s.department_id IS NULL
     ), objectives AS (
       SELECT DISTINCT o.okr_objective_id, o.code::text AS code, o.title, o.organisational_goal_id
         FROM okr_objective o WHERE o.okr_objective_id IN (SELECT okr_objective_id FROM company)
     )
     SELECT 1 AS step, 'key_result' AS kind, okr_key_result_id AS id, code, statement AS title FROM start
     UNION ALL
     SELECT 2, 'company_key_result', okr_key_result_id, code, statement FROM company
      WHERE okr_key_result_id NOT IN (SELECT okr_key_result_id FROM start)
     UNION ALL
     SELECT 3, 'objective', okr_objective_id, code, title FROM objectives
     UNION ALL
     SELECT DISTINCT 4, 'organisational_goal', g.organisational_goal_id, g.code::text, g.title
       FROM objectives ob JOIN organisational_goal g ON g.organisational_goal_id = ob.organisational_goal_id
     ORDER BY 1, 4, 3`,
    [keyResultId],
    { label: "a key result's trace" },
  );
  return { steps: rows.map((r) => ({ kind: r.kind, id: r.id, code: r.code, title: r.title })) };
}

module.exports = { traceOf };
