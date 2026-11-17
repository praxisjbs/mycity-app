"use strict";
/**
 * Reading and writing the Document Centre (docs/guides/document-centre.md §5, §6): one page of the
 * documents a reader may open, the figures above them and one document; and the company's own
 * documents, their categories and tags.
 *
 * A library row is a current file of the vault's `document` table, and who sees it is the one
 * condition shared/documents/library.js builds from every module's source (`readable`): the list,
 * the figures and one document all read through `rows()` below, so they can never disagree about
 * what a reader may see. A company document's own facts (category, tags) and the file's text
 * (document_text, §6.7) are joined to every row; the text never leaves this file except as the few
 * words around a match.
 *
 * The writes are company_document, document_category and document_category_role, from
 * library.service in its transaction. `document` is the vault's alone.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { escapeLike } = require("../../shared/search/provider");
const library = require("../../shared/documents/library");

/** The most words of a search each held to the row; the rest are ignored. */
const MAX_WORDS = 8;
/** The words shown around a match in the file's text. */
const AROUND = 160;

const SORTS = { created_at: "x.created_at", title: "x.title_fold", expires_on: "x.expires_on" };
const NEWEST = { sort: { field: "created_at", dir: "desc" } };

/** What a row carries out of rows(): everything but the file's text. */
const OUT = `x.document_id, x.title, x.original_name, x.doc_type, x.type_label, x.area, x.area_label,
  x.record_type, x.record_id, x.record_label, x.record_ref, x.number, x.mime, x.bytes, x.page_count, x.version,
  x.expires_on, x.locked_at, x.created_at, x.subject_employee_id, x.added_by_name, x.expiring, x.archived_at,
  x.company_document_id, x.document_category_id, x.category_name, x.tags, x.description, x.company_created_by`;

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
                 ${c.number} AS number, d.mime, d.bytes::int AS bytes, d.page_count, d.version,
                 ${c.expires_on} AS expires_on, d.locked_at, d.created_at, d.subject_employee_id,
                 NULLIF(trim(COALESCE(ue.first_name || ' ' || ue.last_name, '')), '') AS added_by_name,
                 COALESCE(${c.expires_on} <= CURRENT_DATE + ${window}, FALSE) AS expiring,
                 search_fold(COALESCE(NULLIF(d.title, ''), d.original_name, ${c.type_label})) AS title_fold,
                 cd.archived_at, cd.company_document_id, cd.document_category_id, dc.name::text AS category_name,
                 cd.tags, cd.description, cd.created_by AS company_created_by,
                 dt.text AS file_text
            FROM document d
            LEFT JOIN app_user uu ON uu.user_id = d.uploaded_by
            LEFT JOIN employee ue ON ue.employee_id = uu.employee_id
            LEFT JOIN company_document cd
                   ON cd.company_document_id = CASE WHEN d.entity_type = 'company_document' THEN d.entity_id::uuid END
            LEFT JOIN document_category dc ON dc.document_category_id = cd.document_category_id
            LEFT JOIN document_text dt ON dt.document_id = d.document_id AND dt.status = 'done'
           WHERE ${seen}`;
}

/** What a person searches a row by: its title, file name, number, type, the record it belongs to and its tags. */
const HAYSTACK = `search_fold(concat_ws(' ', x.title, x.original_name, x.number, x.type_label, x.record_label, x.record_ref,
  array_to_string(x.tags, ' ')))`;
/** And the file's own text (§6.7). */
const TEXT = "search_fold(COALESCE(x.file_text, ''))";

/** A search's words, at most MAX_WORDS. */
const wordsOf = (q) => String(q || "").split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);

/**
 * The list's filters as SQL over `x`, appending their parameters, and the expression of the words
 * around the first word found only in the file's text (null when none is).
 */
function filters(query, params, { types = null, since = null, archived = false } = {}) {
  const out = [];
  const bind = (value, cast) => {
    params.push(value);
    return `$${params.length}::${cast}`;
  };
  const found = [];
  for (const word of wordsOf(query.q)) {
    const like = bind(`%${escapeLike(word)}%`, "text");
    out.push(`(${HAYSTACK} LIKE search_fold(${like}) OR ${TEXT} LIKE search_fold(${like}))`);
    found.push({ like, raw: bind(word, "text") });
  }
  if (types) out.push(`x.doc_type = ANY(${bind(types, "text[]")})`);
  if (query.doc_type) out.push(`x.doc_type = ${bind(query.doc_type, "text")}`);
  if (query.status === "signed") out.push("x.locked_at IS NOT NULL");
  if (query.status === "expiring") out.push("x.expiring");
  if (since) out.push(`x.created_at >= ${bind(since, "timestamptz")}`);
  if (query.category_id) out.push(`x.document_category_id = ${bind(query.category_id, "uuid")}`);
  if (query.tag) out.push(`x.tags @> ARRAY[${bind(query.tag, "text")}]`);
  out.push(archived ? "x.archived_at IS NOT NULL" : "x.archived_at IS NULL");
  const matched = found.length
    ? `CASE ${found
        .map(
          (w) => `WHEN NOT (${HAYSTACK} LIKE search_fold(${w.like})) AND ${TEXT} LIKE search_fold(${w.like})
                  THEN trim(regexp_replace(substring(x.file_text FROM greatest(1, strpos(${TEXT}, search_fold(${w.raw})) - 60) FOR ${AROUND}), '\\s+', ' ', 'g'))`,
        )
        .join(" ")} END`
    : "NULL::text";
  return { where: `WHERE ${out.join(" AND ")}`, matched };
}

/**
 * One page of the library.
 * @param {{query: Function}} db
 * @param {{sql: string, params: Array}} seen        library.readable() for this reader, with its parameters
 * @param {object} query                              the validated LibraryListQuery
 * @param {{types?: string[]|null, since?: Date|null, archived?: boolean, expiringWithinDays: number}} opts
 */
function list(db, seen, query, { types = null, since = null, archived = false, expiringWithinDays }) {
  const params = seen.params.slice();
  const from = rows(seen.sql, params, expiringWithinDays);
  const { where, matched } = filters(query, params, { types, since, archived });
  return pageQuery(
    db,
    `SELECT ${OUT}, ${matched} AS matched_text, ${TOTAL_COL}
       FROM (${from}) x
       ${where}
      ORDER BY ${orderBy(query.sort ? query : NEWEST, SORTS, "x.document_id")}`,
    params,
    query,
  );
}

/**
 * The figures above the list, over every current document the reader may see, not the page.
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
       FROM (${from}) x
      WHERE x.archived_at IS NULL`,
    params,
  );
  return found[0];
}

/** One document the reader may see, archived or not, or null. */
async function get(db, seen, documentId, { expiringWithinDays }) {
  const params = seen.params.slice();
  const from = rows(seen.sql, params, expiringWithinDays);
  params.push(documentId);
  const { rows: found } = await db.query(
    `SELECT ${OUT}, NULL::text AS matched_text FROM (${from}) x WHERE x.document_id = $${params.length}::uuid`,
    params,
  );
  return found[0] || null;
}

/** The doc types the reader holds at least one current document of, for the filters' options. */
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

/* ------------------------------------------------------------------ *
 * Company documents (§6.4, §6.5)
 * ------------------------------------------------------------------ */

const COMPANY = `cd.company_document_id, cd.number::text AS number, cd.document_id, cd.document_category_id, cd.title,
  cd.description, cd.tags, cd.archived_at, cd.archived_by, cd.created_by, cd.created_at, cd.updated_at`;

/** The company document whose file (any version of it) is this document, locked for the change; null when it is not one. */
async function companyByFile(client, documentId, { lock = false } = {}) {
  const { rows: found } = await client.query(
    `SELECT ${COMPANY} FROM company_document cd
      WHERE cd.company_document_id = (SELECT CASE WHEN d.entity_type = 'company_document' THEN d.entity_id::uuid END
                                        FROM document d WHERE d.document_id = $1)
      ${lock ? "FOR UPDATE OF cd" : ""}`,
    [documentId],
  );
  return found[0] || null;
}

async function companyById(client, companyDocumentId) {
  const { rows: found } = await client.query(`SELECT ${COMPANY} FROM company_document cd WHERE cd.company_document_id = $1`, [companyDocumentId]);
  return found[0] || null;
}

async function insertCompany(client, row) {
  const { rows: found } = await client.query(
    `INSERT INTO company_document (number, document_id, document_category_id, title, description, tags, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::text[], $7)
     RETURNING ${COMPANY.replace(/cd\./g, "")}`,
    [row.number, row.document_id, row.document_category_id, row.title, row.description ?? null, row.tags || [], row.created_by],
  );
  return found[0];
}

/** Change a company document's own columns; only those given. */
async function updateCompany(client, companyDocumentId, changes) {
  const allowed = ["document_id", "document_category_id", "title", "description", "tags", "archived_at", "archived_by"];
  const sets = [];
  const params = [companyDocumentId];
  for (const key of allowed) {
    if (changes[key] === undefined) continue;
    params.push(changes[key]);
    sets.push(`${key} = $${params.length}${key === "tags" ? "::text[]" : ""}`);
  }
  if (sets.length === 0) return companyById(client, companyDocumentId);
  const { rows: found } = await client.query(
    `UPDATE company_document SET ${sets.join(", ")} WHERE company_document_id = $1 RETURNING ${COMPANY.replace(/cd\./g, "")}`,
    params,
  );
  return found[0] || null;
}

/** A current, unarchived company document whose file has these bytes (Already in library). */
async function sameFile(client, contentHash, { except = null } = {}) {
  const { rows: found } = await client.query(
    `SELECT cd.company_document_id
       FROM company_document cd JOIN document d ON d.document_id = cd.document_id
      WHERE d.content_hash = $1 AND cd.archived_at IS NULL
        AND ($2::uuid IS NULL OR cd.company_document_id <> $2::uuid)
      LIMIT 1`,
    [contentHash, except],
  );
  return found[0] || null;
}

/* ------------------------------------------------------------------ *
 * Categories (§6.4)
 * ------------------------------------------------------------------ */

const CATEGORY = `dc.document_category_id, dc.name::text AS name, dc.description, dc.audience, dc.archived_at,
  dc.created_at, dc.updated_at,
  COALESCE((SELECT json_agg(json_build_object('role_id', r.role_id, 'name', r.name::text) ORDER BY r.name)
              FROM document_category_role dcr JOIN role r ON r.role_id = dcr.role_id
             WHERE dcr.document_category_id = dc.document_category_id), '[]'::json) AS roles,
  (SELECT count(*)::int FROM company_document cd
    WHERE cd.document_category_id = dc.document_category_id AND cd.archived_at IS NULL) AS documents`;

const CATEGORY_SORTS = { name: "lower(dc.name::text)", created_at: "dc.created_at" };

/**
 * The SQL condition a category passes for a reader who does not keep the library: seen by
 * everyone, or by one of their roles.
 */
function categorySeen(roleIds, params) {
  params.push(roleIds || []);
  return `(dc.audience = 'everyone' OR EXISTS (SELECT 1 FROM document_category_role dcr
             WHERE dcr.document_category_id = dc.document_category_id AND dcr.role_id = ANY($${params.length}::uuid[])))`;
}

/**
 * One page of categories: every one for a keeper of the library, the ones the reader sees otherwise.
 * @param {{all: boolean, role_ids: string[]}} reader
 */
function listCategories(db, query, reader) {
  const params = [];
  const where = [query.archived === "true" ? "dc.archived_at IS NOT NULL" : "dc.archived_at IS NULL"];
  if (!reader.all) {
    // Archived categories are for those who keep the library alone.
    if (query.archived === "true") where.push("FALSE");
    where.push(categorySeen(reader.role_ids, params));
  }
  if (query.q) {
    params.push(`%${escapeLike(query.q)}%`);
    where.push(`search_fold(dc.name::text) LIKE search_fold($${params.length})`);
  }
  return pageQuery(
    db,
    `SELECT ${CATEGORY}, ${TOTAL_COL}
       FROM document_category dc
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy(query.sort ? query : { sort: { field: "name", dir: "asc" } }, CATEGORY_SORTS, "dc.document_category_id")}`,
    params,
    query,
  );
}

/** One category, or null. */
async function getCategory(db, id, { lock = false } = {}) {
  const { rows: found } = await db.query(
    `SELECT ${CATEGORY} FROM document_category dc WHERE dc.document_category_id = $1 ${lock ? "FOR UPDATE OF dc" : ""}`,
    [id],
  );
  return found[0] || null;
}

/** Whether a reader who does not keep the library sees this category. */
async function categoryVisible(db, id, roleIds) {
  const params = [id];
  const { rows: found } = await db.query(
    `SELECT 1 FROM document_category dc WHERE dc.document_category_id = $1 AND ${categorySeen(roleIds, params)}`,
    params,
  );
  return found.length > 0;
}

/** A category of this name, any case, other than `except`. */
async function categoryNamed(db, name, except = null) {
  const { rows: found } = await db.query(
    `SELECT document_category_id FROM document_category WHERE name = $1::citext AND ($2::uuid IS NULL OR document_category_id <> $2::uuid)`,
    [name, except],
  );
  return found[0] || null;
}

async function insertCategory(client, row) {
  const { rows: found } = await client.query(
    `INSERT INTO document_category (name, description, audience, created_by) VALUES ($1, $2, $3, $4) RETURNING document_category_id`,
    [row.name, row.description ?? null, row.audience, row.created_by],
  );
  return found[0].document_category_id;
}

async function updateCategory(client, id, changes) {
  const sets = [];
  const params = [id];
  for (const key of ["name", "description", "audience", "archived_at"]) {
    if (changes[key] === undefined) continue;
    params.push(changes[key]);
    sets.push(`${key} = $${params.length}`);
  }
  if (sets.length) await client.query(`UPDATE document_category SET ${sets.join(", ")} WHERE document_category_id = $1`, params);
}

/** A category's roles, replaced whole; none for an everyone audience. */
async function setCategoryRoles(client, id, roleIds) {
  await client.query("DELETE FROM document_category_role WHERE document_category_id = $1 AND NOT (role_id = ANY($2::uuid[]))", [id, roleIds]);
  await client.query(
    `INSERT INTO document_category_role (document_category_id, role_id)
     SELECT $1, r.role_id FROM role r WHERE r.role_id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [id, roleIds],
  );
}

/** The roles that exist, of those named. */
async function rolesThatExist(db, roleIds) {
  const { rows: found } = await db.query("SELECT role_id FROM role WHERE role_id = ANY($1::uuid[])", [roleIds]);
  return found.map((r) => r.role_id);
}

/** Categories the assistant may name, by name: a page of 25 the reader sees. */
function categoryNames(db, reader) {
  return listCategories(db, { page: 1 }, reader);
}

/* ------------------------------------------------------------------ *
 * Tags
 * ------------------------------------------------------------------ */

/** One page of the tags in use on the current company documents the reader sees, the most used first. */
function listTags(db, seen, query) {
  const params = seen.params.slice();
  const where = [seen.sql, "cd.archived_at IS NULL"];
  if (query.q) {
    params.push(`%${escapeLike(String(query.q).toLowerCase())}%`);
    where.push(`t.tag LIKE $${params.length}`);
  }
  const order = query.sort ? orderBy(query, { tag: "t.tag" }, "t.tag") : "count(*) DESC, t.tag";
  return pageQuery(
    db,
    `SELECT t.tag, count(*)::int AS documents, ${TOTAL_COL}
       FROM document d
       JOIN company_document cd ON cd.document_id = d.document_id
       CROSS JOIN LATERAL unnest(cd.tags) AS t(tag)
      WHERE ${where.join(" AND ")}
      GROUP BY t.tag
      ORDER BY ${order}`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Expiry (§6.9)
 * ------------------------------------------------------------------ */

/** Current, unarchived company documents whose file expires on or before `until`, from `from` on. */
async function expiringBetween(db, from, until) {
  const { rows: found } = await db.query(
    `SELECT cd.company_document_id, cd.title, d.expires_on::text AS expires_on, d.document_id
       FROM company_document cd JOIN document d ON d.document_id = cd.document_id
      WHERE cd.archived_at IS NULL AND d.is_current AND d.expires_on IS NOT NULL
        AND d.expires_on BETWEEN $1::date AND $2::date
      ORDER BY d.expires_on, cd.company_document_id
      LIMIT 2000 -- pagination:batch one day's expiry reminders, a bound and not a page`,
    [from, until],
  );
  return found;
}

/** A company document as its reminder reads it, or null when archived or gone. */
async function expiryFacts(db, companyDocumentId) {
  const { rows: found } = await db.query(
    `SELECT cd.company_document_id, cd.title, cd.number::text AS number, d.expires_on::text AS expires_on, d.document_id
       FROM company_document cd JOIN document d ON d.document_id = cd.document_id
      WHERE cd.company_document_id = $1 AND cd.archived_at IS NULL AND d.is_current`,
    [companyDocumentId],
  );
  return found[0] || null;
}

/**
 * Who is told a company document is expiring: its uploader and every active holder of
 * documents.manage (given directly, by a role, or by General Management, as grants-cache reads it).
 */
async function expiryAudience(db, companyDocumentId) {
  const { GENERAL_MANAGEMENT_CAPABILITIES } = require("../../shared/access/access.catalog");
  const { rows: found } = await db.query(
    `SELECT u.user_id
       FROM app_user u
      WHERE u.status = 'active'
        AND (u.user_id = (SELECT cd.created_by FROM company_document cd WHERE cd.company_document_id = $1)
             OR EXISTS (SELECT 1 FROM user_capability uc JOIN capability c ON c.capability_id = uc.capability_id
                         WHERE uc.user_id = u.user_id AND c.code = 'documents.manage'
                           AND (uc.expires_at IS NULL OR uc.expires_at > now()))
             OR EXISTS (SELECT 1 FROM role_capability rc JOIN capability c ON c.capability_id = rc.capability_id
                          JOIN user_role ur ON ur.role_id = rc.role_id
                         WHERE ur.user_id = u.user_id AND c.code = 'documents.manage'
                           AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE))
             OR ('documents.manage' = ANY($2::text[]) AND EXISTS (
                   SELECT 1 FROM employee mine
                     JOIN app_user boss ON boss.is_ceo
                     JOIN employee ceo ON ceo.employee_id = boss.employee_id
                    WHERE mine.employee_id = u.employee_id AND mine.department_id = ceo.department_id)))
      ORDER BY u.user_id
      LIMIT 500 -- pagination:batch the people one notice reaches, a bound and not a page`,
    [companyDocumentId, GENERAL_MANAGEMENT_CAPABILITIES || []],
  );
  return found.map((r) => r.user_id);
}

module.exports = {
  SORTS,
  MAX_WORDS,
  list,
  summary,
  get,
  typesHeld,
  headOf,
  companyByFile,
  companyById,
  insertCompany,
  updateCompany,
  sameFile,
  listCategories,
  getCategory,
  categoryVisible,
  categoryNamed,
  insertCategory,
  updateCategory,
  setCategoryRoles,
  rolesThatExist,
  categoryNames,
  listTags,
  expiringBetween,
  expiryFacts,
  expiryAudience,
};
