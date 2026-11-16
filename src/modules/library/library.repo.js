"use strict";
/**
 * Reading the Document Centre's Library (docs/guides/document-centre.md §5, §6): one page of the
 * documents a reader may open, the figures above them, and one document.
 *
 * The library writes nothing. A row is a current file of the vault's `document` table, and who sees
 * it is the one condition shared/documents/library.js builds from every module's source
 * (`readable`): the list, the figures and one document all read through `ROWS` below, so they can
 * never disagree about what a reader may see.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { escapeLike } = require("../../shared/search/provider");
const library = require("../../shared/documents/library");

/** The most words of a search each held to the row; the rest are ignored. */
const MAX_WORDS = 8;

const SORTS = { created_at: "x.created_at", title: "x.title_fold", expires_on: "x.expires_on" };
const NEWEST = { sort: { field: "created_at", dir: "desc" } };

/**
 * Every row the reader may see, as a subquery the list, the figures and one document read from.
 * `params` already holds what `seen` binds; the window is bound here.
 */
function rows(seen, params, expiringWithinDays) {
  const c = library.columns();
  params.push(expiringWithinDays);
  const window = `$${params.length}::int`;
  return `SELECT d.document_id,
                 COALESCE(NULLIF(d.title, ''), d.original_name, ${c.type_label}) AS title,
                 d.original_name, d.doc_type,
                 ${c.type_label} AS type_label, ${c.area} AS area, ${c.area_label} AS area_label,
                 ${c.record_type} AS record_type, ${c.record_id} AS record_id,
                 ${c.record_label} AS record_label, ${c.record_ref} AS record_ref,
                 d.number, d.mime, d.bytes::int AS bytes, d.page_count, d.version,
                 ${c.expires_on} AS expires_on, d.locked_at, d.created_at, d.subject_employee_id,
                 NULLIF(trim(COALESCE(ue.first_name || ' ' || ue.last_name, '')), '') AS added_by_name,
                 COALESCE(${c.expires_on} <= CURRENT_DATE + ${window}, FALSE) AS expiring,
                 search_fold(COALESCE(NULLIF(d.title, ''), d.original_name, ${c.type_label})) AS title_fold
            FROM document d
            LEFT JOIN app_user uu ON uu.user_id = d.uploaded_by
            LEFT JOIN employee ue ON ue.employee_id = uu.employee_id
           WHERE ${seen}`;
}

/** What a person searches a row by: its title, file name, number, type, and the record it belongs to. */
const HAYSTACK = `search_fold(concat_ws(' ', x.title, x.original_name, x.number, x.type_label, x.record_label, x.record_ref))`;

/** The list's filters as SQL over `x`, appending their parameters. */
function filters(query, params, { types = null, since = null } = {}) {
  const out = [];
  const bind = (value, cast) => {
    params.push(value);
    return `$${params.length}::${cast}`;
  };
  for (const word of String(query.q || "").split(/\s+/).filter(Boolean).slice(0, MAX_WORDS))
    out.push(`${HAYSTACK} LIKE search_fold(${bind(`%${escapeLike(word)}%`, "text")})`);
  if (types) out.push(`x.doc_type = ANY(${bind(types, "text[]")})`);
  if (query.doc_type) out.push(`x.doc_type = ${bind(query.doc_type, "text")}`);
  if (query.status === "signed") out.push("x.locked_at IS NOT NULL");
  if (query.status === "expiring") out.push("x.expiring");
  if (since) out.push(`x.created_at >= ${bind(since, "timestamptz")}`);
  return out.length ? `WHERE ${out.join(" AND ")}` : "";
}

/**
 * One page of the library.
 * @param {{query: Function}} db
 * @param {{sql: string, params: Array}} seen        library.readable() for this reader, with its parameters
 * @param {object} query                              the validated LibraryListQuery
 * @param {{types?: string[]|null, since?: Date|null, expiringWithinDays: number}} opts
 */
function list(db, seen, query, { types = null, since = null, expiringWithinDays }) {
  const params = seen.params.slice();
  const from = rows(seen.sql, params, expiringWithinDays);
  const where = filters(query, params, { types, since });
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${from}) x
       ${where}
      ORDER BY ${orderBy(query.sort ? query : NEWEST, SORTS, "x.document_id")}`,
    params,
    query,
  );
}

/**
 * The figures above the list, over every document the reader may see, not the page.
 * @param {Date} monthStart  the first instant of this month, Lagos time
 */
async function summary(db, seen, { monthStart, expiringWithinDays }) {
  const params = seen.params.slice();
  const from = rows(seen.sql, params, expiringWithinDays);
  params.push(monthStart);
  const { rows: found } = await db.query(
    `SELECT count(*)::int AS documents,
            count(*) FILTER (WHERE x.created_at >= $${params.length}::timestamptz)::int AS added_this_month,
            count(*) FILTER (WHERE x.expiring)::int AS expiring,
            count(*) FILTER (WHERE x.locked_at IS NOT NULL)::int AS signed
       FROM (${from}) x`,
    params,
  );
  return found[0];
}

/** One document the reader may see, or null. */
async function get(db, seen, documentId, { expiringWithinDays }) {
  const params = seen.params.slice();
  const from = rows(seen.sql, params, expiringWithinDays);
  params.push(documentId);
  const { rows: found } = await db.query(`SELECT x.* FROM (${from}) x WHERE x.document_id = $${params.length}::uuid`, params);
  return found[0] || null;
}

/** The doc types the reader holds at least one document of, for the filters' options. */
async function typesHeld(db, seen) {
  const { rows: found } = await db.query(`SELECT DISTINCT d.doc_type FROM document d WHERE ${seen.sql}`, seen.params);
  return found.map((r) => r.doc_type);
}

/** The current version at the head of a document's chain, found from any version in it; the id itself when it has none. */
async function headOf(db, documentId) {
  const { rows: found } = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT document_id, is_current, 0 AS depth FROM document WHERE document_id = $1
       UNION ALL
       SELECT d.document_id, d.is_current, c.depth + 1
         FROM document d JOIN chain c ON d.supersedes_id = c.document_id
        WHERE c.depth < 200
     )
     SELECT document_id FROM chain WHERE is_current ORDER BY depth DESC LIMIT 1`,
    [documentId],
  );
  return found[0] ? found[0].document_id : documentId;
}

module.exports = { SORTS, MAX_WORDS, list, summary, get, typesHeld, headOf };
