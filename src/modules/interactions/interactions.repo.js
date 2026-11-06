"use strict";
/**
 * Interactions: the SQL (docs/guides/partnerships.md §4.2, §6.12). An interaction is on a lead or a
 * partner (one of the two), optionally on one of its deals and with one of its contacts. Who sees
 * one is who may see its record (§6.1, partner_pipeline.repo's one rule).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const deals = require("../partner_pipeline/partner_pipeline.repo");

const ROW = `pi.partner_interaction_id, pi.partner_id, pi.lead_id, pi.partnership_opportunity_id AS deal_id,
  CASE WHEN c.partner_contact_id IS NULL THEN NULL
       ELSE json_build_object('partner_contact_id', c.partner_contact_id, 'name', btrim(c.first_name || ' ' || c.last_name)) END AS contact,
  pi.interaction_type, pi.subject, pi.summary, pi.occurred_at, ${personJson("e", "d")} AS owner,
  (pi.mail_message_id IS NOT NULL) AS from_mail, pi.created_at`;

const FROM = `FROM partner_interaction pi
  LEFT JOIN partner p ON p.partner_id = pi.partner_id
  LEFT JOIN lead l ON l.lead_id = pi.lead_id
  LEFT JOIN partner_contact c ON c.partner_contact_id = pi.contact_id
  LEFT JOIN employee e ON e.employee_id = pi.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

/** Seen when its record is: the partner's rule or the lead's. */
function seenOf(scope, params) {
  const p = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  if (!p) return "";
  const l = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  return `AND ((pi.partner_id IS NOT NULL ${p}) OR (pi.lead_id IS NOT NULL ${l}))`;
}

/** A page of interactions the reader may see, newest first unless asked otherwise. */
function list(db, query, scope) {
  const params = [query.partner_id || null, query.lead_id || null, query.deal_id || null, query.interaction_type || null, query.q || null];
  const seen = seenOf(scope, params);
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE ($1::uuid IS NULL OR pi.partner_id = $1) AND ($2::uuid IS NULL OR pi.lead_id = $2)
        AND ($3::uuid IS NULL OR pi.partnership_opportunity_id = $3) AND ($4::text IS NULL OR pi.interaction_type = $4)
        AND ($5::text IS NULL OR search_fold(pi.subject || ' ' || COALESCE(pi.summary, '')) LIKE '%' || search_fold($5) || '%')
        ${seen}
      ORDER BY ${orderBy(query, { occurred_at: "pi.occurred_at" }, "pi.partner_interaction_id")}`,
    params,
    query,
  );
}

/** A record's latest interactions (the first page, newest first). */
function latestOf(db, { kind, id }) {
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM} WHERE pi.${kind}_id = $1 ORDER BY pi.occurred_at DESC, pi.partner_interaction_id`,
    [id],
    { page: 1 },
  );
}

/** One interaction. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${ROW} ${FROM} WHERE pi.partner_interaction_id = $1`, [id]);
  return rows[0] || null;
}

/** A new interaction; returns its id. */
async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO partner_interaction (partner_id, lead_id, partnership_opportunity_id, contact_id, interaction_type, subject, summary, occurred_at, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING partner_interaction_id`,
    [row.partner_id || null, row.lead_id || null, row.deal_id || null, row.contact_id || null, row.interaction_type, row.subject, row.summary, row.occurred_at, row.owner_id || null],
  );
  return rows[0].partner_interaction_id;
}

module.exports = { list, latestOf, get, insert };
