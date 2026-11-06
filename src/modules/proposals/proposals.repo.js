"use strict";
/**
 * Proposals: the SQL. M7 PR 2 writes proof_point only (docs/guides/partnerships.md §4.2, §6.11); the
 * studio's tables arrive with PR 7. M7 PR 3 adds Home's read of the proposals out (§6.17): a proposal
 * `sent` or `viewed`, seen with its deal (partner_pipeline.repo's one rule). Never emits.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const deals = require("../partner_pipeline/partner_pipeline.repo");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const PROOF = `p.proof_point_id, p.kind, p.label, p.value, p.detail, p.document_id, p.source_note, p.position, p.active`;
const SORTS = { position: "p.position", label: "p.label" };

function listProofPoints(db, query) {
  return pageQuery(
    db,
    `SELECT ${PROOF}, ${TOTAL_COL}
       FROM proof_point p
      WHERE ($1::text IS NULL OR p.kind = $1)
        AND ($2::boolean IS NULL OR p.active = $2)
        AND ($3::text IS NULL OR search_fold(p.label || ' ' || COALESCE(p.value, '') || ' ' || COALESCE(p.detail, ''))
                                 LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, SORTS, "p.proof_point_id")}`,
    [query.kind || null, query.active === undefined ? null : query.active, query.q || null],
    query,
  );
}

const getProofPoint = (db, id) => one(db, `SELECT ${PROOF} FROM proof_point p WHERE p.proof_point_id = $1`, [id]);

const nextProofPosition = async (db) =>
  Number((await one(db, "SELECT COALESCE(max(position), 0) + 10 AS next FROM proof_point", [])).next);

function insertProofPoint(client, p) {
  return one(
    client,
    `INSERT INTO proof_point (kind, label, value, detail, source_note, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING proof_point_id`,
    [p.kind, p.label, p.value ?? null, p.detail ?? null, p.source_note ?? null, p.position],
  );
}

async function updateProofPoint(client, id, patch) {
  const params = [id];
  const sets = [];
  for (const [field, column] of Object.entries({
    label: "label",
    value: "value",
    detail: "detail",
    document_id: "document_id",
    source_note: "source_note",
    position: "position",
    active: "active",
  })) {
    if (patch[field] === undefined) continue;
    params.push(patch[field]);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE proof_point SET ${sets.join(", ")} WHERE proof_point_id = $1`, params);
}

/* ------------------------------------------------------------------ *
 * Home's proposals out (M7 PR 3)
 * ------------------------------------------------------------------ */

const OUT = "pp.status IN ('sent', 'viewed')";

/** How many proposals are out, within the scope of their deals. */
async function homeOutCount(db, scope) {
  const params = [];
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM partnership_proposal pp
       JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
      WHERE ${OUT} ${seen}`,
    params,
  );
  return rows[0].n;
}

/** A page of the proposals out, within the scope, the longest out first. */
function homeOutPage(db, scope, query) {
  const params = [query.q || null];
  const seen = deals.dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT pp.partnership_proposal_id, pp.number, po.title AS opportunity, COALESCE(p.name, l.name) AS partner, pp.sent_at,
            pp.value, pp.currency, ${TOTAL_COL}
       FROM partnership_proposal pp
       JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
       LEFT JOIN partner p ON p.partner_id = po.partner_id
       LEFT JOIN lead l ON l.lead_id = po.lead_id
      WHERE ${OUT} AND ($1::text IS NULL OR search_fold(po.title || ' ' || COALESCE(p.name, l.name, '')) LIKE '%' || search_fold($1) || '%')
        ${seen}
      ORDER BY ${orderBy(query, { sent_at: "pp.sent_at" }, "pp.partnership_proposal_id")}`,
    params,
    query,
  );
}

module.exports = { listProofPoints, getProofPoint, nextProofPosition, insertProofPoint, updateProofPoint, homeOutCount, homeOutPage };
