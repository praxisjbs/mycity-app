"use strict";
/**
 * Letter templates: the SQL (docs/guides/queries.md §4, §6.7). Writes only
 * letter_template; the wording is template_version, written by
 * shared/templates/template-store. Never emits.
 *
 * A template's status as a person reads it:
 *   retired          letter_template.status = retired
 *   awaiting_sample  no saved version and an empty shipped file (the caller passes the
 *                    keys whose shipped file has wording, `shipped`)
 *   draft, active    letter_template.status
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

/** The highest saved version of each document template. */
const VERSIONS = `SELECT key, max(version)::int AS version, max(created_at) AS saved_at
    FROM template_version WHERE kind = 'document' GROUP BY key`;

/** $1 is the shipped keys with wording (text[]). */
const ROWS = `
  SELECT lt.letter_template_id, lt.key::text AS key, lt.name, lt.purpose,
         CASE
           WHEN lt.status = 'retired' THEN 'retired'
           WHEN v.version IS NULL AND NOT (lt.key::text = ANY($1::text[])) THEN 'awaiting_sample'
           ELSE lt.status
         END AS status,
         COALESCE(v.version, 0) AS version,
         ARRAY(
           SELECT u.name FROM (
             SELECT s.name, s.position AS o FROM consequence_step s WHERE s.letter_template = lt.key
             UNION ALL
             SELECT r.name, 1000 AS o FROM query_rule r WHERE r.letter_template = lt.key
           ) u ORDER BY u.o, u.name
         ) AS used_by,
         GREATEST(lt.updated_at, v.saved_at) AS updated_at,
         lt.status AS stored_status,
         search_fold(lt.name || ' ' || lt.key) AS haystack
    FROM letter_template lt
    LEFT JOIN (${VERSIONS}) v ON v.key = lt.key`;

const OUT = `v.letter_template_id, v.key, v.name, v.purpose, v.status, v.version,
  v.used_by[1:25] AS used_by, v.updated_at`;

const SORTS = { name: "v.name", updated_at: "v.updated_at" };

/**
 * @param {{query: Function}} db
 * @param {{purpose?: string, status?: string, q?: string, page?: number, sort?: object}} query
 * @param {string[]} shipped
 */
function list(db, query, shipped) {
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($2::text IS NULL OR v.purpose = $2)
        AND ($3::text IS NULL OR v.status = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, SORTS, "v.letter_template_id")}`,
    [shipped, query.purpose || null, query.status || null, query.q || null],
    query,
  );
}

async function get(db, id, shipped) {
  const { rows } = await db.query(
    `SELECT ${OUT}, v.stored_status FROM (${ROWS}) v WHERE v.letter_template_id = $2`,
    [shipped, id],
  );
  return rows[0] || null;
}

async function getByKey(db, key, shipped) {
  const { rows } = await db.query(
    `SELECT ${OUT}, v.stored_status FROM (${ROWS}) v WHERE v.key = $2::citext::text`,
    [shipped, key],
  );
  return rows[0] || null;
}

async function keyExists(db, key) {
  const { rows } = await db.query("SELECT 1 FROM letter_template WHERE key = $1", [key]);
  return rows.length > 0;
}

async function insert(db, row) {
  const { rows } = await db.query(
    `INSERT INTO letter_template (key, name, purpose, status, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING letter_template_id`,
    [row.key, row.name, row.purpose, row.status || "draft", row.created_by || null],
  );
  return rows[0].letter_template_id;
}

async function setStatus(db, id, status) {
  await db.query("UPDATE letter_template SET status = $2 WHERE letter_template_id = $1", [id, status]);
}

/** A letter's name and what it is used for. */
async function update(db, id, { name, purpose }) {
  await db.query(
    `UPDATE letter_template SET name = COALESCE($2, name), purpose = COALESCE($3, purpose), updated_at = now()
      WHERE letter_template_id = $1`,
    [id, name ?? null, purpose ?? null],
  );
}

/** Touch the row so its updated_at follows an edit of the wording. */
async function touch(db, id) {
  await db.query("UPDATE letter_template SET updated_at = now() WHERE letter_template_id = $1", [id]);
}

/** The figures above Letter Templates. Letters sent: query and sanction letters in 90 days. */
async function summary(db, shipped) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS templates,
            count(*) FILTER (WHERE v.status = 'active')::int AS active,
            count(*) FILTER (WHERE v.status = 'awaiting_sample')::int AS awaiting_sample,
            (SELECT count(*)::int FROM document d
              WHERE d.doc_type IN ('query_letter', 'sanction_letter')
                AND d.created_at >= now() - interval '90 days') AS sent_90d
       FROM (${ROWS}) v`,
    [shipped],
  );
  return rows[0];
}

module.exports = { list, get, getByKey, keyExists, insert, setStatus, update, touch, summary };
