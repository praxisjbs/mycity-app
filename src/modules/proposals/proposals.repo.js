"use strict";
/**
 * Proposals: the SQL (docs/guides/partnerships.md §4.2, §6.10). The Proposal Studio's reads and
 * writes arrive with M7 PR 7; until then this file holds Home's read of the proposals out (§6.17):
 * a proposal `sent` or `viewed`, seen with its deal (partner_pipeline.repo's one rule).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const deals = require("../partner_pipeline/partner_pipeline.repo");

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

module.exports = { homeOutCount, homeOutPage };
