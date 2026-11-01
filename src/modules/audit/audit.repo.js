"use strict";
/**
 * The audit ledger, read (migration 0030; written only by shared/events/emit.js in the
 * transaction of the change it records). Days are Lagos days: "today" and a filter's
 * from and to dates begin at midnight in Lagos.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) =>
  (await db.query(sql, params)).rows[0] || null;

const TZ = "Africa/Lagos";

const ENTRY = `a.audit_ledger_id, a.occurred_at, a.actor_user_id, a.actor_name, a.actor_email::text AS actor_email,
  host(a.actor_ip) AS actor_ip, a.action, a.module_key, a.entity_type, a.entity_id, a.before, a.after,
  a.changed_fields, a.is_sensitive`;

const SORTS = { occurred_at: "a.occurred_at" };

/**
 * The WHERE for the Audit Log's filters, shared by the list and the export.
 * @param {object} f  module, action, actor_user_id, entity_type, entity_id, from, to, q
 * @returns {{sql: string, params: Array}}
 */
function filtersOf(f) {
  const params = [
    f.module || null,
    f.action || null,
    f.actor_user_id || null,
    f.entity_type || null,
    f.entity_id || null,
    f.from || null,
    f.to || null,
    f.q || null,
  ];
  const sql = `($1::text IS NULL OR a.module_key = $1)
     AND ($2::text IS NULL OR a.action = $2)
     AND ($3::uuid IS NULL OR a.actor_user_id = $3)
     AND ($4::text IS NULL OR a.entity_type = $4)
     AND ($5::text IS NULL OR a.entity_id = $5)
     AND ($6::date IS NULL OR a.occurred_at >= ($6::date)::timestamp AT TIME ZONE '${TZ}')
     AND ($7::date IS NULL OR a.occurred_at < ($7::date + 1)::timestamp AT TIME ZONE '${TZ}')
     AND ($8::text IS NULL OR search_fold(
           COALESCE(a.actor_name, '') || ' ' || COALESCE(a.actor_email::text, '') || ' ' || a.action || ' ' ||
           a.entity_type || ' ' || a.entity_id
         ) LIKE '%' || search_fold($8) || '%')`;
  return { sql, params };
}

/** One page of entries, newest first unless sorted otherwise. */
function page(db, query) {
  const { sql, params } = filtersOf(query);
  const sort = query.sort || { field: "occurred_at", dir: "desc" };
  return pageQuery(
    db,
    `SELECT ${ENTRY}, ${TOTAL_COL}
       FROM audit_ledger a
      WHERE ${sql}
      ORDER BY ${orderBy({ sort }, SORTS, "a.audit_ledger_id")}`,
    params,
    query,
  );
}

/**
 * The assistant's Audit Log summary (docs/guides/praxis-ai.md §6.13; foundation.md §9): the entries the
 * filters match, counted in one SQL: by action, by actor, by module or record type, and by Lagos day.
 * Figures, never an entry's words.
 * @param {object} f   the log's filters (filtersOf), the period already closed by the service
 * @param {"module"|"entity_type"} by
 */
async function aiSummary(db, f, by) {
  const { sql, params } = filtersOf(f);
  const third = by === "entity_type" ? "a.entity_type" : "a.module_key";
  const { rows } = await db.query(
    `WITH e AS (
       SELECT a.audit_ledger_id, a.action, a.actor_user_id, COALESCE(a.actor_name, 'System') AS actor_name, a.is_sensitive,
              ${third} AS third_key, (a.occurred_at AT TIME ZONE '${TZ}')::date AS day
         FROM audit_ledger a
        WHERE ${sql}
     ), figures AS (
       SELECT count(*)::int AS entries,
              count(*) FILTER (WHERE is_sensitive)::int AS sensitive,
              count(DISTINCT actor_user_id)::int AS actors,
              count(DISTINCT day)::int AS days,
              count(DISTINCT third_key)::int AS kinds
         FROM e
     ), by_action AS (
       SELECT action, count(*)::int AS n, count(*) FILTER (WHERE is_sensitive)::int AS s,
              row_number() OVER (ORDER BY count(*) DESC, action) AS rank
         FROM e GROUP BY action
     ), by_actor AS (
       SELECT COALESCE(actor_user_id::text, 'system') AS key, min(actor_name) AS label, count(*)::int AS n,
              count(*) FILTER (WHERE is_sensitive)::int AS s,
              row_number() OVER (ORDER BY count(*) DESC, min(actor_name), COALESCE(actor_user_id::text, 'system')) AS rank
         FROM e GROUP BY actor_user_id
     ), by_third AS (
       SELECT third_key AS key, count(*)::int AS n, count(*) FILTER (WHERE is_sensitive)::int AS s,
              row_number() OVER (ORDER BY count(*) DESC, third_key) AS rank
         FROM e GROUP BY third_key
     ), by_day AS (
       SELECT day, count(*)::int AS n, row_number() OVER (ORDER BY day DESC) AS newest FROM e GROUP BY day
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', action, 'label', action, 'value', n, 'count', s) ORDER BY rank) FROM by_action WHERE rank <= 20) AS by_action,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', n, 'count', s) ORDER BY rank) FROM by_actor WHERE rank <= 20) AS by_actor,
            (SELECT json_agg(json_build_object('key', key, 'label', key, 'value', n, 'count', s) ORDER BY rank) FROM by_third WHERE rank <= 20) AS by_third,
            (SELECT json_agg(json_build_object('at', to_char(day, 'YYYY-MM-DD'), 'value', n) ORDER BY day) FROM by_day WHERE newest <= 60) AS by_day`,
    params,
  );
  const r = rows[0];
  return { figures: r.figures, by_action: r.by_action || [], by_actor: r.by_actor || [], by_third: r.by_third || [], by_day: r.by_day || [] };
}

/** Counts for the cards above the log: Lagos today, this week (from Monday), this month. */
async function summary(db) {
  const counts = await one(
    db,
    `WITH lagos AS (SELECT (now() AT TIME ZONE '${TZ}') AS here)
     SELECT count(*) FILTER (WHERE a.occurred_at >= date_trunc('day', here) AT TIME ZONE '${TZ}')::int AS today,
            count(*) FILTER (WHERE a.occurred_at >= date_trunc('week', here) AT TIME ZONE '${TZ}')::int AS this_week,
            count(*)::int AS this_month,
            count(*) FILTER (WHERE a.is_sensitive)::int AS sensitive_this_month
       FROM audit_ledger a, lagos
      WHERE a.occurred_at >= date_trunc('month', here) AT TIME ZONE '${TZ}'`,
  );
  const { rows } = await db.query(
    `SELECT a.module_key, count(*)::int AS entries
       FROM audit_ledger a
      WHERE a.occurred_at >= date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'
      GROUP BY a.module_key
      ORDER BY entries DESC, a.module_key`,
  );
  return { ...counts, by_module: rows };
}

module.exports = { filtersOf, page, summary, aiSummary };
