"use strict";
/**
 * Reading import batches for the screen: the history, and one batch with the
 * names a person reads rather than the ids the engine works in.
 *
 * The engine (shared/import/engine.js) owns every write and the per-row result;
 * nothing here changes a batch. What it adds is the join the screen needs (who
 * uploaded it) and the filters the history offers, which the engine's own
 * history, written for the command line, does not carry.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const ROW = `b.import_batch_id, b.number, b.importer_key, b.document_id, b.file_name, b.sheet,
  b.header_row, b.mapping, b.options, b.status, b.stats,
  trim(COALESCE(e.first_name || ' ' || e.last_name, '')) AS created_by_name,
  b.created_at, b.previewed_at, b.committed_at, b.reverted_at`;

const FROM = `FROM import_batch b
  LEFT JOIN app_user u ON u.user_id = b.created_by
  LEFT JOIN employee e ON e.employee_id = u.employee_id`;

const SORTS = { created_at: "b.created_at DESC" };

/** One page of the history, newest first. */
function history(db, query) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
     ${FROM}
      WHERE ($1::text IS NULL OR b.importer_key = $1)
        AND ($2::text IS NULL OR b.status = $2)
        AND ($3::text IS NULL OR search_fold(b.number || ' ' || b.file_name) LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, SORTS, "b.import_batch_id")}`,
    [query.importer || null, query.status || null, query.q || null],
    query,
  );
}

/** One batch, with the uploader's name. */
async function get(db, batchId) {
  const { rows } = await db.query(
    `SELECT ${ROW} ${FROM} WHERE b.import_batch_id = $1`,
    [batchId],
  );
  return rows[0] || null;
}

/** A committed batch's rows, as its stats count them. */
const ROWS_OF = (key) => `COALESCE((b.stats ->> '${key}')::int, 0)`;

/**
 * Every import as the history lists them, in figures for the assistant (docs/guides/praxis-ai.md §6.13,
 * Workspace, Knowledge Hub, Community, Home and Settings), in one statement: the imports by status, the
 * records a committed import created and updated, the rows it imported and those it left out (errors and
 * duplicates); by importer with its imported and refused rows for a stacked bar, imports by Lagos month
 * started. A period (the Lagos day started) narrows it only when given. Figures, never a row.
 * @param {{importer?, status?, from?, to?}} q
 */
async function aiSummary(db, q) {
  const { rows } = await db.query(
    `WITH x AS (
       SELECT b.importer_key, b.status, b.created_at,
              CASE WHEN b.status = 'committed' THEN ${ROWS_OF("create")} ELSE 0 END AS created,
              CASE WHEN b.status = 'committed' THEN ${ROWS_OF("update")} ELSE 0 END AS updated,
              CASE WHEN b.status = 'committed' THEN ${ROWS_OF("error")} + ${ROWS_OF("duplicate")} ELSE 0 END AS refused
         FROM import_batch b
        WHERE ($1::text IS NULL OR b.importer_key = $1)
          AND ($2::text IS NULL OR b.status = $2)
          AND ($3::date IS NULL OR (b.created_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN $3::date AND $4::date)
     ), by_importer AS (
       SELECT importer_key AS key, count(*)::int AS count, sum(created + updated)::int AS imported, sum(refused)::int AS refused,
              row_number() OVER (ORDER BY sum(created + updated + refused) DESC, count(*) DESC, importer_key) AS rank
         FROM x GROUP BY importer_key
     )
     SELECT (SELECT json_build_object(
               'imports', count(*), 'committed', count(*) FILTER (WHERE status = 'committed'),
               'reverted', count(*) FILTER (WHERE status = 'reverted'),
               'failed', count(*) FILTER (WHERE status = 'failed'),
               'in_progress', count(*) FILTER (WHERE status IN ('uploaded', 'mapped', 'previewed')),
               'imported', COALESCE(sum(created + updated), 0), 'refused', COALESCE(sum(refused), 0),
               'created', COALESCE(sum(created), 0), 'updated', COALESCE(sum(updated), 0)) FROM x) AS figures,
            (SELECT json_agg(json_build_object('key', status, 'value', n)) FROM (SELECT status, count(*)::int AS n FROM x GROUP BY status) s) AS by_status,
            (SELECT json_agg(json_build_object('key', key, 'count', count, 'imported', imported, 'refused', refused) ORDER BY rank)
               FROM by_importer WHERE rank <= 20) AS by_importer,
            (SELECT json_agg(json_build_object('at', at, 'value', n) ORDER BY at)
               FROM (SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, count(*)::int AS n FROM x GROUP BY 1) m) AS by_month`,
    [q.importer || null, q.status || null, q.from || null, q.to || null],
  );
  const r = rows[0] || {};
  return { figures: r.figures || {}, by_status: r.by_status || [], by_importer: r.by_importer || [], by_month: r.by_month || [] };
}

module.exports = { history, get, aiSummary };
