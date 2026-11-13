"use strict";
/**
 * The Talent Pool: the SQL (docs/guides/recruitment.md §4, §6.9). Writes talent_pool_entry; reads the
 * candidate, the application an entry came from, its vacancy and the vacancy they were invited to.
 * Never emits (BACKEND_GUIDE §2).
 *
 * Scope is the hiring manager of the vacancy the person applied for (the application they were added
 * from), as on Candidates; an entry whose application is gone is seen with `all` only. A removed
 * entry is not listed.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

/** Every live entry with what the list shows. */
const ROWS = `
  SELECT t.talent_pool_entry_id, t.candidate_id, t.application_id, t.reason, t.created_at, t.expires_at,
         t.invited_at, t.invited_vacancy_id, t.removed_at, t.added_by,
         btrim(k.first_name || ' ' || k.last_name) AS name, k.email::text AS email,
         v.vacancy_id AS applied_vacancy_id, v.number::text AS applied_number, v.title AS applied_title, v.hiring_manager_id,
         iv.number::text AS invited_number, iv.title AS invited_title, iv.hiring_manager_id AS invited_hiring_manager_id,
         a.screening_score, a.provisional_score, COALESCE(a.screening_score, a.provisional_score) AS score,
         NULLIF(btrim(COALESCE(ae.first_name, '') || ' ' || COALESCE(ae.last_name, '')), '') AS added_by_name,
         EXISTS (SELECT 1 FROM application h
                  WHERE h.candidate_id = t.candidate_id AND h.source = 'pool' AND h.created_at > t.created_at
                    AND (h.stage = 'hired' OR h.status = 'hired')) AS hired_from_pool,
         search_fold(k.first_name || ' ' || k.last_name || ' ' || k.email || ' ' || COALESCE(v.title, '')) AS haystack
    FROM talent_pool_entry t
    JOIN candidate k ON k.candidate_id = t.candidate_id
    LEFT JOIN application a ON a.application_id = t.application_id
    LEFT JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN vacancy iv ON iv.vacancy_id = t.invited_vacancy_id
    LEFT JOIN app_user au ON au.user_id = t.added_by
    LEFT JOIN employee ae ON ae.employee_id = au.employee_id
   WHERE t.removed_at IS NULL AND t.expires_at > now()`;

const SORTS = { created_at: "x.created_at", score: "x.score", expires_at: "x.expires_at" };

/** One page of the pool in scope. */
function list(db, query, scope) {
  const params = [query.invited === undefined ? null : query.invited === "true", query.q || null];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${ROWS}) x
      WHERE ($1::boolean IS NULL OR (x.invited_at IS NOT NULL) = $1)
        AND ($2::text IS NULL OR x.haystack LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "x.talent_pool_entry_id")}`,
    params,
    query,
  );
}

/** One live entry, or null. `lock` holds it for a write. */
async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM talent_pool_entry WHERE talent_pool_entry_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.talent_pool_entry_id = $1`, [id]);
  return rows[0] || null;
}

/** The person's live entry, held, if they are in the pool. */
async function liveFor(client, candidateId) {
  const { rows } = await client.query(
    `SELECT t.talent_pool_entry_id, v.hiring_manager_id
       FROM talent_pool_entry t
       LEFT JOIN application a ON a.application_id = t.application_id
       LEFT JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE t.candidate_id = $1 AND t.removed_at IS NULL
        FOR UPDATE OF t`,
    [candidateId],
  );
  return rows[0] || null;
}

/** Into the pool for 24 months from now. */
async function insert(client, { candidate_id: candidateId, application_id: applicationId, reason, added_by: by }) {
  const { rows } = await client.query(
    `INSERT INTO talent_pool_entry (candidate_id, application_id, reason, added_by, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '24 months')
     ON CONFLICT (candidate_id) WHERE removed_at IS NULL DO NOTHING
     RETURNING talent_pool_entry_id`,
    [candidateId, applicationId, reason, by],
  );
  return rows[0] ? rows[0].talent_pool_entry_id : null;
}

/** Added again: the new reason and application, and 24 months from now. */
async function renew(client, id, { application_id: applicationId, reason, added_by: by }) {
  await client.query(
    `UPDATE talent_pool_entry SET application_id = $2, reason = $3, added_by = $4, expires_at = now() + interval '24 months'
      WHERE talent_pool_entry_id = $1`,
    [id, applicationId, reason, by],
  );
}

/** The latest invite on the entry (what the list shows), and the invite itself kept for Apply. */
async function setInvited(client, id, vacancyId, by) {
  await client.query("UPDATE talent_pool_entry SET invited_at = now(), invited_vacancy_id = $2 WHERE talent_pool_entry_id = $1", [
    id,
    vacancyId,
  ]);
  await client.query(
    `INSERT INTO talent_pool_invite (talent_pool_entry_id, vacancy_id, invited_by) VALUES ($1, $2, $3)
     ON CONFLICT (talent_pool_entry_id, vacancy_id) DO UPDATE SET invited_by = EXCLUDED.invited_by`,
    [id, vacancyId, by],
  );
}

async function remove(client, id, reason) {
  await client.query(
    "UPDATE talent_pool_entry SET removed_at = now(), removed_reason = $2 WHERE talent_pool_entry_id = $1 AND removed_at IS NULL",
    [id, reason],
  );
}

/** The four figures above the list, in scope. */
async function summary(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*)::int AS in_pool,
            count(*) FILTER (WHERE x.invited_at IS NOT NULL)::int AS invited_back,
            count(*) FILTER (WHERE x.hired_from_pool)::int AS hired_from_pool,
            round(avg(x.score), 1)::float AS average_score
       FROM (${ROWS}) x
      WHERE true ${s.and}`,
    params,
  );
  return rows[0];
}

/**
 * The pool in figures for the assistant (docs/guides/praxis-ai.md §6.13, Recruitment and onboarding), in
 * one statement over the live entries the reader may list (the hiring manager of the vacancy each
 * applied for, as list() applies it): the counts, those leaving within 30 days and the average shown
 * score; by role applied for (20); by why kept, the reason as written (top 10); kept by Lagos month. A
 * period (added) narrows it only when `from` and `to` are given. Figures, never a row.
 * @param {{invited?: string, from?: string, to?: string}} q
 */
async function aiSummary(db, q, scope) {
  const params = [q.invited === undefined ? null : q.invited === "true", q.from || null, q.to || null];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `WITH y AS (
       SELECT x.* FROM (${ROWS}) x
        WHERE ($1::boolean IS NULL OR (x.invited_at IS NOT NULL) = $1)
          AND ($2::date IS NULL OR (x.created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $2::date AND $3::date)
          ${s.and}
     ), figures AS (
       SELECT count(*)::int AS kept,
              count(*) FILTER (WHERE invited_at IS NOT NULL)::int AS invited,
              count(*) FILTER (WHERE hired_from_pool)::int AS hired,
              count(*) FILTER (WHERE expires_at <= now() + interval '30 days')::int AS leaving_soon,
              round(avg(score), 1)::float AS average_score
         FROM y
     ), by_role AS (
       SELECT COALESCE(applied_vacancy_id::text, 'none') AS key,
              COALESCE(min(applied_number) || ', ' || min(applied_title), 'No role') AS label, count(*)::int AS value,
              row_number() OVER (ORDER BY count(*) DESC, min(applied_title), applied_vacancy_id) AS rank
         FROM y GROUP BY applied_vacancy_id
     ), by_reason AS (
       SELECT lower(btrim(reason)) AS key, min(btrim(reason)) AS label, count(*)::int AS value,
              row_number() OVER (ORDER BY count(*) DESC, lower(btrim(reason))) AS rank
         FROM y GROUP BY lower(btrim(reason))
     ), months AS (
       SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, count(*)::int AS value FROM y GROUP BY 1
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value) ORDER BY rank) FROM by_role WHERE rank <= 20) AS by_role,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value) ORDER BY rank) FROM by_reason WHERE rank <= 10) AS by_reason,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM months) AS months`,
    params,
  );
  const row = rows[0] || {};
  return { figures: row.figures || {}, by_role: row.by_role || [], by_reason: row.by_reason || [], months: row.months || [] };
}

/** One entry still in the pool, held, whatever its time: the purge reads it so (the list hides it once past). */
async function lockLive(client, id) {
  const { rows } = await client.query(
    "SELECT talent_pool_entry_id, candidate_id, expires_at FROM talent_pool_entry WHERE talent_pool_entry_id = $1 AND removed_at IS NULL FOR UPDATE",
    [id],
  );
  return rows[0] || null;
}

/** Entries past their 24 months, at most 200 a run (talent-pool-purge). */
async function expired(db) {
  const { rows } = await db.query(
    `SELECT talent_pool_entry_id, candidate_id FROM talent_pool_entry
      WHERE removed_at IS NULL AND expires_at <= now()
      ORDER BY expires_at, talent_pool_entry_id
      LIMIT 200 -- pagination:batch the purge takes at most 200 a run; the rest wait for the next`,
  );
  return rows;
}

module.exports = { list, get, liveFor, insert, renew, setInvited, remove, summary, aiSummary, lockLive, expired };
