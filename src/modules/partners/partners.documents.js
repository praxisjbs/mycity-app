"use strict";
/**
 * Every document of a lead or a partner (docs/guides/partnerships.md §2, §6.2, §6.4, §6.6): Upload
 * Document tags a vault upload with its kind (a partner_document_kind code) and, optionally, the
 * deal it is about; a signing's signed copy is kept the same way (origin `signed_copy`), and the
 * proposals and agreements arrive with theirs (M7 PR 6 and PR 7).
 *
 * Each is a `partner_document` row, which the vault names as its entity: a lead's documents follow
 * it to its partner by re-pointing that row, and who may read one is who may see its record (§6.1).
 */
const { pool } = require("../../config/db");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const vault = require("../../shared/documents/vault");
const { EVENTS, DOC_TYPE, ENTITY } = require("./partners.events");
const dealRepo = require("../partner_pipeline/partner_pipeline.repo");
const lists = require("../partner_pipeline/partner_pipeline.lists");

const invalid = (field, message) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, { [field]: [message] });

/** Whether the reader may see the lead or partner. */
async function recordSeen(db, { kind, id }, scope) {
  const alias = kind === "partner" ? "p" : "l";
  const params = [id];
  const seen = dealRepo.recordSeen(scope, { alias, kind }, params);
  const { rows } = await db.query(`SELECT 1 FROM ${kind} ${alias} WHERE ${alias}.${kind}_id = $1 ${seen}`, params);
  return rows.length > 0;
}

/**
 * File a document another module keeps among a record's documents, in the caller's transaction: an
 * agreement's sealed copy (origin `agreement`), which stays the agreement's in the vault (its entity, its
 * read rule) and is listed here beside the uploads. Filed once: a second call changes nothing.
 * @param {{record: {kind: string, id: string}, deal_id?: string|null, document_id: string, origin: "agreement"|"proposal"}} opts
 * @returns {Promise<string|null>} the partner_document id, or null when it was filed already
 */
async function fileIn(client, actor, { record, deal_id = null, document_id, origin }) {
  const { rows } = await client.query(
    `INSERT INTO partner_document (document_id, partner_id, lead_id, deal_id, kind, origin, attached_by)
     VALUES ($1, $2, $3, $4, NULL, $5, $6)
     ON CONFLICT (document_id) DO NOTHING
     RETURNING partner_document_id`,
    [document_id, record.kind === "partner" ? record.id : null, record.kind === "lead" ? record.id : null, deal_id, origin, actor ? actor.user_id : null],
  );
  if (!rows[0]) return null;
  const id = rows[0].partner_document_id;
  await emit(client, {
    key: EVENTS.PARTNER_DOCUMENT_ATTACHED,
    entity: { type: "partner_document", id },
    actor,
    payload: { partner_document_id: id, document_id, [`${record.kind}_id`]: record.id, deal_id, origin },
  });
  return id;
}

/**
 * Tag a staged upload for a lead or a partner, in the caller's transaction.
 * @param {{record: {kind: string, id: string}, deal_id?: string|null, document_id: string, kind?: string|null,
 *          origin?: "upload"|"proposal"|"agreement"|"signed_copy", field?: string}} opts
 * @returns {Promise<string>} the partner_document id
 */
async function attachIn(client, actor, { record, deal_id = null, document_id, kind = null, origin = "upload", field = "document_id" }) {
  const { rows } = await client.query(
    `INSERT INTO partner_document (document_id, partner_id, lead_id, deal_id, kind, origin, attached_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (document_id) DO NOTHING
     RETURNING partner_document_id`,
    [document_id, record.kind === "partner" ? record.id : null, record.kind === "lead" ? record.id : null, deal_id, kind, origin, actor ? actor.user_id : null],
  );
  if (!rows[0]) throw invalid(field, "Already attached");
  const id = rows[0].partner_document_id;
  await vault.claim(client, { document_id, doc_type: DOC_TYPE, entity: { type: ENTITY, id }, actor, field });
  await emit(client, {
    key: EVENTS.PARTNER_DOCUMENT_ATTACHED,
    entity: { type: "partner_document", id },
    actor,
    payload: { partner_document_id: id, document_id, [`${record.kind}_id`]: record.id, deal_id, origin },
  });
  return id;
}

const ROW = `jsonb_build_object('document_id', doc.document_id, 'file_name', COALESCE(doc.original_name, doc.title), 'size_bytes', doc.bytes,
    'mime_type', doc.mime) AS document,
  pd.kind, rv.label AS kind_label, pd.deal_id, pd.origin, btrim(e.first_name || ' ' || e.last_name) AS uploaded_by, pd.created_at`;

const FROM = `FROM partner_document pd
  JOIN document doc ON doc.document_id = pd.document_id
  LEFT JOIN reference_value rv ON rv.domain = 'partner_document_kind' AND rv.code = pd.kind
  LEFT JOIN app_user u ON u.user_id = pd.attached_by
  LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** A page of a record's documents (GET /documents), newest first. */
async function page(query, scope) {
  const record = query.partner_id ? { kind: "partner", id: query.partner_id } : query.lead_id ? { kind: "lead", id: query.lead_id } : null;
  if (!record) throw invalid("partner_id", "Pick the lead or the partner");
  if (!(await recordSeen(pool, record, scope))) throw new AppError("NOT_FOUND", "That record does not exist, or you cannot see it.", 404);
  return pageQuery(
    pool,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE pd.${record.kind}_id = $1 AND doc.is_current
        AND ($2::uuid IS NULL OR pd.deal_id = $2) AND ($3::text IS NULL OR pd.kind = $3)
        AND ($4::text IS NULL OR search_fold(COALESCE(doc.original_name, doc.title)) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, { created_at: "pd.created_at" }, "pd.partner_document_id")}`,
    [record.id, query.deal_id || null, query.kind || null, query.q || null],
    query,
  );
}

/** Upload Document (POST /documents): a vault upload tagged for a record the reader may see, with its kind. */
async function attach(actor, scope, body) {
  const record = body.partner_id ? { kind: "partner", id: body.partner_id } : { kind: "lead", id: body.lead_id };
  const id = await require("../partner_pipeline/partner_pipeline.service").tx(async (client) => {
    if (!(await recordSeen(client, record, scope))) throw invalid(record.kind === "partner" ? "partner_id" : "lead_id", `No such ${record.kind}`);
    if (!(await lists.allActive(client, "partner_document_kind", [body.kind]))) throw invalid("kind", "Pick from the list");
    if (body.deal_id) {
      const { rows } = await client.query(`SELECT 1 FROM partnership_opportunity WHERE partnership_opportunity_id = $1 AND ${record.kind}_id = $2`, [body.deal_id, record.id]);
      if (!rows.length) throw invalid("deal_id", "Not this record's deal");
    }
    return attachIn(client, actor, { record, deal_id: body.deal_id || null, document_id: body.document_id, kind: body.kind });
  });
  const { rows } = await pool.query(`SELECT ${ROW} ${FROM} WHERE pd.partner_document_id = $1`, [id]);
  return rows[0];
}

/** A lead's documents become its partner's (a conversion, §6.4). */
async function moveToPartner(client, leadId, partnerId) {
  await client.query("UPDATE partner_document SET partner_id = $2, lead_id = NULL WHERE lead_id = $1", [leadId, partnerId]);
}

/** The vault's read rule for a record's document: whoever may see its lead or partner (§6.1). */
async function mayRead(client, user, doc) {
  const { scopeFor } = require("../../middleware/rbac");
  const scope = await scopeFor(user, "partnerships", "view");
  if (!scope) return false;
  const { rows } = await client.query("SELECT partner_id, lead_id FROM partner_document WHERE partner_document_id = $1", [doc.entity_id]);
  if (!rows[0]) return false;
  const record = rows[0].partner_id ? { kind: "partner", id: rows[0].partner_id } : { kind: "lead", id: rows[0].lead_id };
  return recordSeen(client, record, scope);
}

module.exports = {
  fileIn, attachIn, attach, page, moveToPartner, mayRead, recordSeen };
