"use strict";
/**
 * Proposals: the SQL (docs/guides/partnerships.md §4.2, §6.10, §6.11). Proof points (M7 PR 2); Home's
 * read of the proposals out (PR 3, §6.17); the Proposal Studio's proposals, question cards, sources,
 * images, views and saved templates (PR 7). A proposal is seen with its deal, by partner_pipeline.repo's
 * one rule (`dealSeen`, §6.1). Lists show each proposal's newest version. Never emits.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
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

/* ------------------------------------------------------------------ *
 * Proposals (M7 PR 7)
 * ------------------------------------------------------------------ */

const P_FROM = `FROM partnership_proposal pp
  JOIN partnership_opportunity po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
  LEFT JOIN partner p ON p.partner_id = po.partner_id
  LEFT JOIN lead l ON l.lead_id = po.lead_id
  LEFT JOIN employee e ON e.employee_id = po.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const P_ROW = `pp.partnership_proposal_id, pp.number, pp.version, pp.title, pp.status, pp.value, pp.currency::text AS currency,
  CASE WHEN p.partner_id IS NOT NULL THEN json_build_object('type', 'partner', 'id', p.partner_id, 'number', p.number, 'name', p.name)
       ELSE json_build_object('type', 'lead', 'id', l.lead_id, 'number', l.number::text, 'name', l.name) END AS record,
  pp.partnership_opportunity_id AS deal_id, po.title AS deal_title, ${personJson("e", "d")} AS owner,
  pp.sent_at, pp.first_viewed_at, pp.view_count, pp.valid_until, pp.created_at`;

const P_DETAIL = `${P_ROW}, pp.content, pp.design_template_id, COALESCE(pp.sent_to, '{}') AS sent_to, COALESCE(pp.sent_cc, '{}') AS sent_cc,
  pp.last_viewed_at, pp.accepted_at, pp.declined_at, pp.decline_reason, pp.withdrawn_at, pp.supersedes_id, pp.progress,
  pp.link_secret, pp.document_id, pp.ai_run_id, pp.public_token_id, pp.sent_subject, pp.sent_message, pp.created_by,
  po.owner_id, po.lead_id, po.partner_id, e.work_email AS owner_email, e.phone AS owner_phone, e.job_title AS owner_title,
  COALESCE(p.name, l.name) AS partner_name, COALESCE(p.partner_category_id, l.partner_category_id) AS partner_category_id`;

/** The newest version of each proposal: none revises it. */
const NEWEST = "NOT EXISTS (SELECT 1 FROM partnership_proposal nv WHERE nv.supersedes_id = pp.partnership_proposal_id)";

const P_SORTS = { created_at: "pp.created_at", sent_at: "pp.sent_at", value: "pp.value" };

/** A page of proposals the reader may see, the newest version of each. */
function listProposals(db, query, scope) {
  const params = [query.q || null];
  const where = [NEWEST, `($1::text IS NULL OR search_fold(pp.number || ' ' || COALESCE(pp.title, '') || ' ' || po.title || ' ' || COALESCE(p.name, l.name, '')) LIKE '%' || search_fold($1) || '%')`];
  const add = (sql, v) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (query.status) add("pp.status = ?", query.status);
  if (query.deal_id) add("pp.partnership_opportunity_id = ?", query.deal_id);
  if (query.partner_id) add("po.partner_id = ?", query.partner_id);
  if (query.lead_id) add("po.lead_id = ?", query.lead_id);
  if (query.owner_id) add("po.owner_id = ?", query.owner_id);
  const seen = deals.dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT ${P_ROW}, ${TOTAL_COL} ${P_FROM} WHERE ${where.join(" AND ")} ${seen}
      ORDER BY ${orderBy(query, { ...P_SORTS, created_at: "pp.created_at" }, "pp.partnership_proposal_id")}`,
    params,
    query,
  );
}

/** The figures above Proposals, this calendar year in Lagos, within the reader's scope. */
async function proposalFigures(db, scope, year) {
  const params = [year];
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE pp.sent_at IS NOT NULL AND date_part('year', pp.sent_at AT TIME ZONE 'Africa/Lagos') = $1)::int AS sent_this_year,
            count(*) FILTER (WHERE pp.status = 'accepted' AND date_part('year', pp.accepted_at AT TIME ZONE 'Africa/Lagos') = $1)::int AS accepted,
            count(*) FILTER (WHERE pp.status = 'viewed')::int AS viewed_no_reply,
            count(*) FILTER (WHERE pp.status IN ('accepted', 'declined')
                               AND date_part('year', COALESCE(pp.accepted_at, pp.declined_at) AT TIME ZONE 'Africa/Lagos') = $1)::int AS decided
       ${P_FROM} WHERE ${NEWEST} ${seen}`,
    params,
  );
  return rows[0];
}

/** One proposal with what the studio needs, or null; within scope when one is given. */
async function getProposal(db, id, scope = null) {
  const params = [id];
  const seen = scope ? deals.dealSeen(scope, "po", params) : "";
  return one(db, `SELECT ${P_DETAIL} ${P_FROM} WHERE pp.partnership_proposal_id = $1 ${seen}`, params);
}

/** The proposal whose PDF a document is. */
const proposalOfDocument = (db, documentId) =>
  one(db, `SELECT ${P_DETAIL} ${P_FROM} WHERE pp.document_id = $1`, [documentId]);

/** Lock a proposal for a write. */
const lockProposal = (client, id) =>
  one(client, "SELECT partnership_proposal_id, status FROM partnership_proposal WHERE partnership_proposal_id = $1 FOR UPDATE", [id]);

function insertProposal(client, p) {
  return one(
    client,
    `INSERT INTO partnership_proposal (partnership_opportunity_id, number, version, status, value, currency, title, design_template_id,
                                       supersedes_id, content, progress, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING partnership_proposal_id`,
    [
      p.deal_id,
      p.number,
      p.version || 1,
      p.status,
      p.value ?? null,
      p.currency ?? null,
      p.title ?? null,
      p.design_template_id ?? null,
      p.supersedes_id ?? null,
      p.content ? JSON.stringify(p.content) : null,
      p.progress ? JSON.stringify(p.progress) : null,
      p.created_by,
    ],
  );
}

const PROPOSAL_COLUMNS = [
  "status", "title", "content", "progress", "ai_run_id", "valid_until", "public_token_id", "link_secret", "sent_to", "sent_cc",
  "sent_subject", "sent_message", "sent_at", "first_viewed_at", "last_viewed_at", "view_count", "accepted_at", "declined_at",
  "decline_reason", "withdrawn_at", "document_id", "value", "currency", "brief",
];
const JSON_COLUMNS = new Set(["content", "progress", "brief"]);

async function updateProposal(client, id, patch) {
  const params = [id];
  const sets = [];
  for (const column of PROPOSAL_COLUMNS) {
    if (patch[column] === undefined) continue;
    const v = patch[column];
    params.push(JSON_COLUMNS.has(column) && v !== null ? JSON.stringify(v) : v);
    sets.push(`${column} = $${params.length}`);
  }
  if (!sets.length) return;
  await client.query(`UPDATE partnership_proposal SET ${sets.join(", ")} WHERE partnership_proposal_id = $1`, params);
}

/** Every version of a proposal's chain, the newest first (at most twenty). */
async function versionsOf(db, id) {
  const page = await pageQuery(
    db,
    `WITH RECURSIVE up AS (
        SELECT partnership_proposal_id, supersedes_id FROM partnership_proposal WHERE partnership_proposal_id = $1
        UNION ALL SELECT x.partnership_proposal_id, x.supersedes_id FROM partnership_proposal x JOIN up ON x.partnership_proposal_id = up.supersedes_id
      ), root AS (SELECT partnership_proposal_id FROM up WHERE supersedes_id IS NULL),
      down AS (
        SELECT partnership_proposal_id FROM root
        UNION ALL SELECT x.partnership_proposal_id FROM partnership_proposal x JOIN down ON x.supersedes_id = down.partnership_proposal_id
      )
      SELECT pp.partnership_proposal_id, pp.version, pp.status, pp.sent_at, ${TOTAL_COL} FROM partnership_proposal pp
       WHERE pp.partnership_proposal_id IN (SELECT partnership_proposal_id FROM down)
       ORDER BY pp.version DESC, pp.partnership_proposal_id`,
    [id],
    { page: 1 },
  );
  return page.data.slice(0, 20).map(({ partnership_proposal_id, version, status, sent_at }) => ({ partnership_proposal_id, version, status, sent_at }));
}

/** Proposals out past their validity, to be expired by the daily job. */
async function dueToExpire(db, today) {
  const { rows } = await db.query(
    "SELECT partnership_proposal_id FROM partnership_proposal WHERE status IN ('sent', 'viewed') AND valid_until < $1::date ORDER BY valid_until, partnership_proposal_id",
    [today],
  );
  return rows.map((r) => r.partnership_proposal_id);
}

/* Question cards */

const Q_COLS = `proposal_question_id, position, group_key, question, why, answer_kind, options, suggested, suggested_from, required, answer, state, replaces_id`;

async function questionsOf(db, proposalId) {
  const { rows } = await db.query(`SELECT ${Q_COLS} FROM proposal_question WHERE partnership_proposal_id = $1 ORDER BY position, created_at, proposal_question_id`, [proposalId]);
  return rows;
}

const getQuestion = (db, proposalId, qid) =>
  one(db, `SELECT ${Q_COLS} FROM proposal_question WHERE partnership_proposal_id = $1 AND proposal_question_id = $2`, [proposalId, qid]);

function insertQuestion(client, proposalId, q) {
  return one(
    client,
    `INSERT INTO proposal_question (partnership_proposal_id, position, group_key, question, why, answer_kind, options, suggested, suggested_from, required, replaces_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING proposal_question_id`,
    [
      proposalId,
      q.position,
      q.group_key,
      q.question,
      q.why ?? null,
      q.answer_kind,
      q.options ? JSON.stringify(q.options) : null,
      q.suggested === null || q.suggested === undefined ? null : JSON.stringify(q.suggested),
      q.suggested_from ?? null,
      q.required === true,
      q.replaces_id ?? null,
    ],
  );
}

async function updateQuestion(client, qid, { answer, state }) {
  await client.query(
    "UPDATE proposal_question SET answer = $2, state = $3 WHERE proposal_question_id = $1",
    [qid, answer === null || answer === undefined ? null : JSON.stringify(answer), state],
  );
}

/** Drop the open cards of a proposal before Claude asks again (Try Again). */
const clearQuestions = (client, proposalId) => client.query("DELETE FROM proposal_question WHERE partnership_proposal_id = $1", [proposalId]);

/* Sources and images */

function insertSource(client, proposalId, { kind, document_id: documentId = null, text = null }) {
  return client.query("INSERT INTO proposal_source (partnership_proposal_id, kind, document_id, text) VALUES ($1, $2, $3, $4)", [proposalId, kind, documentId, text]);
}

async function sourcesOf(db, proposalId) {
  const { rows } = await db.query(
    `SELECT s.kind, s.text, s.document_id, doc.original_name, doc.mime, doc.bytes
       FROM proposal_source s LEFT JOIN document doc ON doc.document_id = s.document_id
      WHERE s.partnership_proposal_id = $1 ORDER BY s.created_at, s.proposal_source_id`,
    [proposalId],
  );
  return rows;
}

function insertAsset(client, proposalId, a) {
  return one(
    client,
    `INSERT INTO proposal_asset (partnership_proposal_id, document_id, role, section_key, alt, stand_in)
     VALUES ($1, $2, $3, $4, $5, false) RETURNING proposal_asset_id`,
    [proposalId, a.document_id, a.role, a.section_key ?? null, a.alt],
  );
}

async function assetsOf(db, proposalId) {
  const { rows } = await db.query(
    `SELECT a.proposal_asset_id, a.document_id, a.role, a.section_key, a.alt, a.stand_in, doc.original_name, doc.mime, doc.bytes, doc.storage_key
       FROM proposal_asset a JOIN document doc ON doc.document_id = a.document_id
      WHERE a.partnership_proposal_id = $1 ORDER BY a.created_at, a.proposal_asset_id`,
    [proposalId],
  );
  return rows;
}

/** Copy a version's sources, images and answered cards onto its revision. */
async function copyInputs(client, fromId, toId) {
  await client.query(
    `INSERT INTO proposal_source (partnership_proposal_id, kind, document_id, text)
     SELECT $2, kind, document_id, text FROM proposal_source WHERE partnership_proposal_id = $1`,
    [fromId, toId],
  );
  await client.query(
    `INSERT INTO proposal_question (partnership_proposal_id, position, group_key, question, why, answer_kind, options, suggested, suggested_from, required, answer, state)
     SELECT $2, position, group_key, question, why, answer_kind, options, suggested, suggested_from, required, answer, state
       FROM proposal_question WHERE partnership_proposal_id = $1 AND state <> 'replaced'`,
    [fromId, toId],
  );
  const { rows } = await client.query(
    `INSERT INTO proposal_asset (partnership_proposal_id, document_id, role, section_key, alt, stand_in)
     SELECT $2, document_id, role, section_key, alt, stand_in FROM proposal_asset WHERE partnership_proposal_id = $1
     RETURNING proposal_asset_id, document_id`,
    [fromId, toId],
  );
  return rows;
}

/* Views of the public link */

async function recordView(client, proposalId, { ip_hash: ipHash, user_agent: userAgent }) {
  await client.query("INSERT INTO proposal_view (partnership_proposal_id, ip_hash, user_agent) VALUES ($1, $2, $3)", [proposalId, ipHash, userAgent]);
  return one(
    client,
    `UPDATE partnership_proposal
        SET view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = COALESCE(first_viewed_at, now()),
            status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
      WHERE partnership_proposal_id = $1
      RETURNING view_count, (first_viewed_at = last_viewed_at) AS first`,
    [proposalId],
  );
}

/* Saved templates */

const T_COLS = "proposal_template_id, name, partner_category_id, structure, created_from_proposal_id, active";

function listTemplates(db, query) {
  return pageQuery(
    db,
    `SELECT ${T_COLS}, ${TOTAL_COL} FROM proposal_template
      WHERE active AND ($1::uuid IS NULL OR partner_category_id IS NULL OR partner_category_id = $1)
        AND ($2::text IS NULL OR search_fold(name) LIKE '%' || search_fold($2) || '%')
      ORDER BY ${orderBy(query, { name: "name" }, "proposal_template_id")}`,
    [query.partner_category_id || null, query.q || null],
    query,
  );
}

const getTemplate = (db, id) => one(db, `SELECT ${T_COLS} FROM proposal_template WHERE proposal_template_id = $1`, [id]);

function insertTemplate(client, t) {
  return one(
    client,
    `INSERT INTO proposal_template (name, partner_category_id, structure, created_from_proposal_id)
     VALUES ($1, $2, $3, $4) RETURNING ${T_COLS}`,
    [t.name, t.partner_category_id ?? null, JSON.stringify(t.structure), t.created_from_proposal_id ?? null],
  );
}

/** The latest accepted proposals of a category, for Claude's sense of tone (never their facts). */
async function acceptedOfCategory(db, categoryId, exceptId) {
  if (!categoryId) return [];
  const page = await pageQuery(
    db,
    `SELECT pp.content, ${TOTAL_COL} ${P_FROM}
      WHERE pp.status = 'accepted' AND pp.content IS NOT NULL AND pp.partnership_proposal_id <> $2
        AND COALESCE(p.partner_category_id, l.partner_category_id) = $1
      ORDER BY pp.accepted_at DESC, pp.partnership_proposal_id`,
    [categoryId, exceptId],
    { page: 1 },
  );
  return page.data.slice(0, 3).map((r) => r.content);
}

/** The first page of active proof points, in their order: what Claude may cite (25, as every read). */
async function activeProofPoints(db) {
  const page = await pageQuery(db, `SELECT ${PROOF}, ${TOTAL_COL} FROM proof_point p WHERE p.active ORDER BY p.position, p.proof_point_id`, [], { page: 1 });
  return page.data;
}

module.exports = {
  listProofPoints,
  getProofPoint,
  nextProofPosition,
  insertProofPoint,
  updateProofPoint,
  homeOutCount,
  homeOutPage,
  listProposals,
  proposalFigures,
  getProposal,
  proposalOfDocument,
  lockProposal,
  insertProposal,
  updateProposal,
  versionsOf,
  dueToExpire,
  questionsOf,
  getQuestion,
  insertQuestion,
  updateQuestion,
  clearQuestions,
  insertSource,
  sourcesOf,
  insertAsset,
  assetsOf,
  copyInputs,
  recordView,
  listTemplates,
  getTemplate,
  insertTemplate,
  acceptedOfCategory,
  activeProofPoints,
};
