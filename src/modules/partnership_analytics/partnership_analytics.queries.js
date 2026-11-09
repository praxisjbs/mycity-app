"use strict";
/**
 * Partnership Analytics: the SQL (docs/guides/partnerships.md §6.18). Every figure is counted in the
 * database, within the reader's scope by the one rule the lists keep (§6.1: partner_pipeline.repo's
 * dealSeen and recordSeen), over Lagos days. Reads only; never emits (BACKEND_GUIDE §2).
 *
 * `range` is { from, to } (ISO days, both inclusive). `q.partner_category_id` narrows every figure
 * to one category (a lead's or partner's category; a deal's is its record's).
 */
const { personJson } = require("../../shared/db/person");
const deals = require("../partner_pipeline/partner_pipeline.repo");

/** A timestamp's Lagos day. */
const day = (at) => `(${at} AT TIME ZONE 'Africa/Lagos')::date`;

/** A deal with its record and the record's category. */
const DEAL_FROM = `FROM partnership_opportunity po
  LEFT JOIN partner p ON p.partner_id = po.partner_id
  LEFT JOIN lead l ON l.lead_id = po.lead_id`;
const DEAL_CATEGORY = "COALESCE(p.partner_category_id, l.partner_category_id)";

/** `$n` holding the category filter, or null. */
const categoryParam = (q, params) => {
  params.push(q.partner_category_id || null);
  return `$${params.length}::uuid`;
};

/**
 * A deal was signed in the hub, not brought in signed by the tracker import: no import line moved it
 * into a signed meaning (§6.18, "imported history excluded").
 */
const NOT_IMPORTED_SIGNING = `NOT EXISTS (
  SELECT 1 FROM partnership_stage_history ih
    JOIN reference_value irv ON irv.domain = 'partnership_stage' AND irv.code = ih.to_stage
   WHERE ih.partnership_opportunity_id = po.partnership_opportunity_id AND ih.kind = 'stage' AND ih.source = 'import'
     AND irv.metadata->>'meaning' IN ('signed', 'active'))`;

/**
 * The per-owner measures in one statement: each measure counted by its own owner (a lead's, an
 * interaction's or an event's, the deal's, the partner's), then joined into one row a person.
 * @returns {Promise<Array<{owner_id: string|null, owner: object|null, new_prospects: number, meetings_held: number, proposals_sent: number, partnerships_signed: number, active_partnerships: number, downloads: number, vendor_leads: number}>>}
 */
async function byOwner(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const leadSeen = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  const partnerSeen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const leadSeenI = deals.recordSeen(scope, { alias: "il", kind: "lead" }, params);
  const partnerSeenI = deals.recordSeen(scope, { alias: "ip", kind: "partner" }, params);
  const dealSeen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `WITH prospects AS (
       SELECT l.owner_id, count(*)::int AS new_prospects,
              count(*) FILTER (WHERE pc.counts_as_vendor)::int AS vendor_leads
         FROM lead l LEFT JOIN partner_category pc ON pc.partner_category_id = l.partner_category_id
        WHERE COALESCE(l.identified_on, ${day("l.created_at")}) BETWEEN $1::date AND $2::date
          AND (${cat} IS NULL OR l.partner_category_id = ${cat}) ${leadSeen}
        GROUP BY l.owner_id
     ), meetings AS (
       SELECT owner_id, count(*)::int AS meetings_held FROM (
         SELECT pi.owner_id
           FROM partner_interaction pi
           LEFT JOIN partner ip ON ip.partner_id = pi.partner_id
           LEFT JOIN lead il ON il.lead_id = pi.lead_id
          WHERE pi.interaction_type = 'meeting' AND ${day("pi.occurred_at")} BETWEEN $1::date AND $2::date
            AND (${cat} IS NULL OR COALESCE(ip.partner_category_id, il.partner_category_id) = ${cat})
            AND ((pi.partner_id IS NOT NULL ${partnerSeenI}) OR (pi.lead_id IS NOT NULL ${leadSeenI}))
         UNION ALL
         SELECT ce.owner_employee_id
           FROM calendar_event ce
           LEFT JOIN partner ip ON ip.partner_id = ce.partner_id
           LEFT JOIN lead il ON il.lead_id = ce.lead_id
          WHERE ce.event_type = 'meeting' AND ce.cancelled_at IS NULL AND (ce.partner_id IS NOT NULL OR ce.lead_id IS NOT NULL)
            AND ce.starts_at <= now() AND ${day("ce.starts_at")} BETWEEN $1::date AND $2::date
            AND (${cat} IS NULL OR COALESCE(ip.partner_category_id, il.partner_category_id) = ${cat})
            AND ((ce.partner_id IS NOT NULL ${partnerSeenI}) OR (ce.lead_id IS NOT NULL ${leadSeenI}))
       ) m GROUP BY owner_id
     ), deals_in AS (
       SELECT po.* ${DEAL_FROM}
        WHERE (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${dealSeen}
     ), sent AS (
       SELECT po.owner_id, count(*)::int AS proposals_sent
         FROM partnership_proposal pp JOIN deals_in po ON po.partnership_opportunity_id = pp.partnership_opportunity_id
        WHERE pp.sent_at IS NOT NULL AND ${day("pp.sent_at")} BETWEEN $1::date AND $2::date
        GROUP BY po.owner_id
     ), signed AS (
       SELECT po.owner_id, count(*)::int AS partnerships_signed
         FROM deals_in po
        WHERE po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING}
        GROUP BY po.owner_id
     ), active AS (
       SELECT p.owner_id, count(DISTINCT p.partner_id)::int AS active_partnerships
         FROM partner p JOIN deals_in po ON po.partner_id = p.partner_id
        WHERE po.signed_at IS NOT NULL AND ${day("po.signed_at")} <= $2::date
          AND (po.completed_at IS NULL OR ${day("po.completed_at")} > $2::date)
          AND (po.status <> 'lost' OR (po.closed_at IS NOT NULL AND ${day("po.closed_at")} > $2::date))
          AND (p.closed_at IS NULL OR ${day("p.closed_at")} > $2::date) ${partnerSeen}
        GROUP BY p.owner_id
     ), downloads AS (
       SELECT po.owner_id, COALESCE(sum(dr.downloads), 0)::int AS downloads
         FROM deal_return dr JOIN deals_in po ON po.partnership_opportunity_id = dr.deal_id
        WHERE dr.month BETWEEN date_trunc('month', $1::date)::date AND $2::date
        GROUP BY po.owner_id
     ), owners AS (
       SELECT owner_id FROM prospects UNION SELECT owner_id FROM meetings UNION SELECT owner_id FROM sent
       UNION SELECT owner_id FROM signed UNION SELECT owner_id FROM active UNION SELECT owner_id FROM downloads
     )
     SELECT * FROM (
     SELECT o.owner_id, ${personJson("e", "d")} AS owner,
            COALESCE(pr.new_prospects, 0) AS new_prospects, COALESCE(m.meetings_held, 0) AS meetings_held,
            COALESCE(s.proposals_sent, 0) AS proposals_sent, COALESCE(sg.partnerships_signed, 0) AS partnerships_signed,
            COALESCE(a.active_partnerships, 0) AS active_partnerships, COALESCE(dl.downloads, 0) AS downloads,
            COALESCE(pr.vendor_leads, 0) AS vendor_leads,
            row_number() OVER (ORDER BY (o.owner_id IS NULL), e.first_name, e.last_name, o.owner_id) AS rank
       FROM owners o
       LEFT JOIN employee e ON e.employee_id = o.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN prospects pr ON pr.owner_id IS NOT DISTINCT FROM o.owner_id
       LEFT JOIN meetings m ON m.owner_id IS NOT DISTINCT FROM o.owner_id
       LEFT JOIN sent s ON s.owner_id IS NOT DISTINCT FROM o.owner_id
       LEFT JOIN signed sg ON sg.owner_id IS NOT DISTINCT FROM o.owner_id
       LEFT JOIN active a ON a.owner_id IS NOT DISTINCT FROM o.owner_id
       LEFT JOIN downloads dl ON dl.owner_id IS NOT DISTINCT FROM o.owner_id
     ) x WHERE rank <= 200 ORDER BY rank`,
    params,
  );
  return rows;
}

/** Deals signed in each month of the range (how many, and their Naira signed value), oldest first. */
async function signedPerMonth(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', po.signed_at AT TIME ZONE 'Africa/Lagos'), 'YYYY-MM') AS month,
            count(*)::int AS signed,
            COALESCE(sum(${deals.signedValue("po")}) FILTER (WHERE po.currency = 'NGN'), 0)::numeric(18,2)::text AS value
       ${DEAL_FROM}
      WHERE po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING}
        AND (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
      GROUP BY 1 ORDER BY 1`,
    params,
  );
  return rows;
}

/** Returns in each month of the range (gross, MyCity's commission, downloads), oldest first. */
async function returnsPerMonth(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT to_char(dr.month, 'YYYY-MM') AS month,
            COALESCE(sum(dr.gross_sales), 0)::numeric(18,2)::text AS gross_sales,
            COALESCE(sum(dr.mycity_commission), 0)::numeric(18,2)::text AS mycity_commission,
            COALESCE(sum(dr.downloads), 0)::int AS downloads
       FROM deal_return dr
       JOIN partnership_opportunity po ON po.partnership_opportunity_id = dr.deal_id
       LEFT JOIN partner p ON p.partner_id = po.partner_id
       LEFT JOIN lead l ON l.lead_id = po.lead_id
      WHERE dr.month BETWEEN date_trunc('month', $1::date)::date AND $2::date
        AND (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
      GROUP BY dr.month ORDER BY dr.month`,
    params,
  );
  return rows;
}

/** By category: open deals now, and deals signed in the range with their Naira value. */
async function byCategory(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `SELECT partner_category_id, name, open, signed, value FROM (
     SELECT pc.partner_category_id, COALESCE(pc.name::text, 'No Category') AS name,
            count(*) FILTER (WHERE po.status = 'open')::int AS open,
            count(*) FILTER (WHERE po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING})::int AS signed,
            COALESCE(sum(${deals.signedValue("po")}) FILTER (WHERE po.currency = 'NGN' AND po.signed_at IS NOT NULL
              AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING}), 0)::numeric(18,2)::text AS value,
            row_number() OVER (ORDER BY pc.display_order NULLS LAST, pc.name NULLS LAST) AS rank
       ${DEAL_FROM}
       LEFT JOIN partner_category pc ON pc.partner_category_id = ${DEAL_CATEGORY}
      WHERE (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
      GROUP BY pc.partner_category_id, pc.name, pc.display_order
     HAVING count(*) FILTER (WHERE po.status = 'open') > 0
         OR count(*) FILTER (WHERE po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date) > 0
     ) x WHERE rank <= 100 ORDER BY rank`,
    params,
  );
  return rows;
}

/**
 * By region: each city a record names (as the address search names it), or its scope (National,
 * Africa, Worldwide); a record in two cities counts in each. Open deals now and deals signed in the
 * range.
 */
async function byRegion(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `WITH d AS (
       SELECT po.partnership_opportunity_id, po.status,
              (po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING}) AS signed_in,
              COALESCE(p.region_scope, l.region_scope) AS region_scope,
              CASE WHEN p.partner_id IS NOT NULL THEN 'partner.cities' ELSE 'lead.cities' END AS owner,
              COALESCE(p.partner_id, l.lead_id) AS record_id
         ${DEAL_FROM}
        WHERE (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
     ), r AS (
       SELECT d.partnership_opportunity_id, d.status, d.signed_in,
              CASE d.region_scope WHEN 'national' THEN 'National' WHEN 'africa' THEN 'Africa' WHEN 'worldwide' THEN 'Worldwide'
                   ELSE COALESCE(pl.city, pl.formatted, 'No Region') END AS region
         FROM d
         LEFT JOIN place pl ON d.region_scope = 'cities' AND pl.owner = d.owner AND pl.owner_key LIKE d.record_id::text || ':%'
     ), g AS (
       SELECT region, count(DISTINCT partnership_opportunity_id) FILTER (WHERE status = 'open')::int AS open,
              count(DISTINCT partnership_opportunity_id) FILTER (WHERE signed_in)::int AS signed
         FROM r GROUP BY region
       HAVING count(*) FILTER (WHERE status = 'open' OR signed_in) > 0
     )
     SELECT region, open, signed FROM (
       SELECT g.*, row_number() OVER (ORDER BY open DESC, signed DESC, region) AS rank FROM g
     ) x WHERE rank <= 100 ORDER BY rank`,
    params,
  );
  return rows;
}

/**
 * Stage to stage: for each deal moved in the range or made in it, the furthest of MyCity's forward
 * stages it reached (by the list's order; On Hold and Closed Lost are not a step forward). Returns
 * each forward stage with how many of those deals reached it.
 * @returns {Promise<Array<{code: string, label: string, reached: number}>>}
 */
async function stageReach(db, range, q, scope) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const { rows } = await db.query(
    `WITH stages AS (
       SELECT code, label, row_number() OVER (ORDER BY display_order, code) AS pos
         FROM reference_value
        WHERE domain = 'partnership_stage' AND active AND COALESCE(metadata->>'meaning', '') NOT IN ('closed_lost', 'on_hold')
     ), d AS (
       SELECT po.partnership_opportunity_id, po.stage ${DEAL_FROM}
        WHERE (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
          AND (${day("po.created_at")} BETWEEN $1::date AND $2::date
               OR EXISTS (SELECT 1 FROM partnership_stage_history h WHERE h.partnership_opportunity_id = po.partnership_opportunity_id
                            AND h.kind = 'stage' AND ${day("h.changed_at")} BETWEEN $1::date AND $2::date))
     ), furthest AS (
       SELECT d.partnership_opportunity_id, max(s.pos) AS pos
         FROM d
         JOIN LATERAL (SELECT d.stage AS code UNION
                       SELECT h.to_stage FROM partnership_stage_history h
                        WHERE h.partnership_opportunity_id = d.partnership_opportunity_id AND h.kind = 'stage') hs ON TRUE
         JOIN stages s ON s.code = hs.code
        GROUP BY d.partnership_opportunity_id
     )
     SELECT s.code, s.label, (SELECT count(*) FROM furthest f WHERE f.pos >= s.pos)::int AS reached
       FROM stages s WHERE s.pos <= 41 ORDER BY s.pos`,
    params,
  );
  return rows;
}

/** What the assistant's summary groups by: the key and label of each, from this file's own map. */
const GROUPS = {
  stage: { key: "po.stage", label: "COALESCE(rv.label, po.stage)" },
  category: { key: `${DEAL_CATEGORY}::text`, label: "COALESCE(pc.name::text, 'No Category')" },
  region: {
    key: `COALESCE(CASE WHEN p.partner_id IS NOT NULL THEN ${deals.regionLabel("p.region_scope", "partner.cities", "p.partner_id")}
                     ELSE ${deals.regionLabel("l.region_scope", "lead.cities", "l.lead_id")} END, 'No Region')`,
  },
  partner: { key: "COALESCE(p.partner_id, l.lead_id)::text", label: "COALESCE(p.name, l.name)" },
  owner: { key: "po.owner_id::text", label: "COALESCE(btrim(e.first_name || ' ' || e.last_name), 'No Owner')" },
};
GROUPS.region.label = GROUPS.region.key;

/**
 * The assistant's partnership summary (§9): open deals and their projected value now, deals signed in
 * the range and their signed value (Naira), and both grouped by `q.by`, the 20 largest each.
 * @returns {Promise<{figures: object, open: Array, signed: Array}>}
 */
async function summary(db, range, q, scope) {
  const g = GROUPS[q.by] || GROUPS.stage;
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const signedIn = `po.signed_at IS NOT NULL AND ${day("po.signed_at")} BETWEEN $1::date AND $2::date AND ${NOT_IMPORTED_SIGNING}`;
  const { rows } = await db.query(
    `WITH d AS (
       SELECT ${g.key} AS gkey, ${g.label} AS glabel, po.status, po.health, po.estimated_value, po.currency,
              (${signedIn}) AS signed_in, ${deals.signedValue("po")} AS signed_value
         ${DEAL_FROM}
         LEFT JOIN partner_category pc ON pc.partner_category_id = ${DEAL_CATEGORY}
         LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = po.stage
         LEFT JOIN employee e ON e.employee_id = po.owner_id
        WHERE (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
     ), open_g AS (
       SELECT gkey AS key, min(glabel) AS label, count(*)::int AS value,
              row_number() OVER (ORDER BY count(*) DESC, min(glabel)) AS rank
         FROM d WHERE status IN ('open', 'live') GROUP BY gkey
     ), signed_g AS (
       SELECT gkey AS key, min(glabel) AS label,
              COALESCE(sum(signed_value) FILTER (WHERE currency = 'NGN'), 0)::numeric(18,2)::text AS value, count(*)::int AS count,
              row_number() OVER (ORDER BY COALESCE(sum(signed_value) FILTER (WHERE currency = 'NGN'), 0) DESC, count(*) DESC, min(glabel)) AS rank
         FROM d WHERE signed_in GROUP BY gkey
     )
     SELECT (SELECT json_build_object(
               'open_deals', count(*) FILTER (WHERE status = 'open'),
               'live_deals', count(*) FILTER (WHERE status = 'live'),
               'stalled', count(*) FILTER (WHERE status IN ('open', 'live') AND health = 'stalled'),
               'open_value', COALESCE(sum(estimated_value) FILTER (WHERE status = 'open' AND currency = 'NGN'), 0)::numeric(18,2)::text,
               'signed', count(*) FILTER (WHERE signed_in),
               'signed_value', COALESCE(sum(signed_value) FILTER (WHERE signed_in AND currency = 'NGN'), 0)::numeric(18,2)::text)
               FROM d) AS figures,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value, 'count', NULL) ORDER BY rank) FROM open_g WHERE rank <= 20) AS open,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value, 'count', count) ORDER BY rank) FROM signed_g WHERE rank <= 20) AS signed`,
    params,
  );
  const r = rows[0];
  return { figures: r.figures, open: r.open || [], signed: r.signed || [] };
}

/**
 * The assistant's returns summary (§9): the range's returns, totalled and grouped by partner (the 20
 * largest by MyCity's commission, else downloads) or by month (oldest first). `money` false leaves
 * every amount out and ranks by downloads.
 */
async function returnsSummary(db, range, q, scope, money) {
  const params = [range.from, range.to];
  const cat = categoryParam(q, params);
  const seen = deals.dealSeen(scope, "po", params);
  const byMonth = q.by === "month";
  const key = byMonth ? "to_char(dr.month, 'YYYY-MM')" : "COALESCE(p.partner_id, l.lead_id)::text";
  const label = byMonth ? "to_char(dr.month, 'YYYY-MM')" : "COALESCE(p.name, l.name)";
  // Over r, whose rows are deal_return's columns with the grouping's key and label.
  const value = money ? "COALESCE(sum(mycity_commission), 0)::numeric(18,2)::text" : "COALESCE(sum(downloads), 0)::int";
  const rank = byMonth ? "min(month)" : money ? "COALESCE(sum(mycity_commission), 0) DESC, min(glabel)" : "COALESCE(sum(downloads), 0) DESC, min(glabel)";
  const { rows } = await db.query(
    `WITH r AS (
       SELECT ${key} AS gkey, ${label} AS glabel, dr.*
         FROM deal_return dr
         JOIN partnership_opportunity po ON po.partnership_opportunity_id = dr.deal_id
         LEFT JOIN partner p ON p.partner_id = po.partner_id
         LEFT JOIN lead l ON l.lead_id = po.lead_id
        WHERE dr.month BETWEEN date_trunc('month', $1::date)::date AND $2::date
          AND (${cat} IS NULL OR ${DEAL_CATEGORY} = ${cat}) ${seen}
     ), g AS (
       SELECT gkey AS key, min(glabel) AS label, ${value} AS value, count(*)::int AS count,
              row_number() OVER (ORDER BY ${rank}) AS rank
         FROM r GROUP BY gkey
     )
     SELECT (SELECT json_build_object(
               'months', count(DISTINCT month), 'deals', count(DISTINCT deal_id),
               'gross_sales', COALESCE(sum(gross_sales), 0)::numeric(18,2)::text,
               'mycity_commission', COALESCE(sum(mycity_commission), 0)::numeric(18,2)::text,
               'paid_to_partner', COALESCE(sum(paid_to_partner), 0)::numeric(18,2)::text,
               'units_sold', COALESCE(sum(units_sold), 0), 'downloads', COALESCE(sum(downloads), 0)) FROM r) AS figures,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value, 'count', count) ORDER BY rank) FROM g WHERE rank <= ${byMonth ? 60 : 20}) AS rows`,
    params,
  );
  const r = rows[0];
  return { figures: r.figures, rows: r.rows || [] };
}

module.exports = { byOwner, signedPerMonth, returnsPerMonth, byCategory, byRegion, stageReach, summary, returnsSummary };
