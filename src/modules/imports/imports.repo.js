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

module.exports = { history, get };
