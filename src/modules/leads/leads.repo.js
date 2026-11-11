"use strict";
/**
 * Leads: the SQL (docs/guides/partnerships.md §4.2, §6.1, §6.4). A lead's status, stage and
 * health are its one deal's (the deal it was captured with); its status column is kept in step
 * by the service in the same transaction as every stage move.
 *
 * Who sees a lead: its owner in the reader's scope, or a reader who may see its deal (§6.1),
 * through partner_pipeline.repo's one rule.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const deals = require("../partner_pipeline/partner_pipeline.repo");

/** The lead's one deal (a lead has the one it was captured with, §6.4), its stage's label and meaning. */
const FROM = `FROM lead l
  LEFT JOIN partnership_opportunity dl ON dl.lead_id = l.lead_id
  LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = dl.stage
  LEFT JOIN partner_category pc ON pc.partner_category_id = l.partner_category_id
  LEFT JOIN employee e ON e.employee_id = l.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const ROW = `l.lead_id, l.number::text AS number, l.name, l.partner_category_id, pc.name::text AS category,
  ${deals.regionLabel("l.region_scope", "lead.cities", "l.lead_id")} AS region, l.status,
  COALESCE(rv.metadata->>'meaning' = 'on_hold', false) AS on_hold, COALESCE(rv.label, dl.stage) AS stage_label, dl.health,
  ${personJson("e", "d")} AS owner, ${deals.lastContact("lead", "l.lead_id")} AS last_contact_at, l.identified_on, l.created_at`;

const DETAIL = `${ROW}, l.industry, l.website, l.objective, l.source, src.label AS source_label, l.region_scope,
  COALESCE(l.impact, '{}') AS impact, l.impact_rating, l.impact_note, l.comments, l.custom, l.lost_reason,
  l.converted_partner_id, l.converted_at, l.owner_id, dl.partnership_opportunity_id AS deal_id`;

const SORTS = { name: "l.name", identified_on: "l.identified_on", created_at: "l.created_at" };

/**
 * A page of leads the reader may see. Without a status, every lead but the lost ones.
 * @param {object} query  LeadListQuery
 */
function list(db, query, scope, { customSql = "", params: start = [] } = {}) {
  const params = [...start];
  const add = (v) => {
    params.push(v);
    return params.length;
  };
  const where = [];
  where.push(query.status ? `l.status = $${add(query.status)}` : "l.status <> 'lost'");
  if (query.partner_category_id) where.push(`l.partner_category_id = $${add(query.partner_category_id)}`);
  if (query.owner_id) where.push(`l.owner_id = $${add(query.owner_id)}`);
  if (query.source) where.push(`l.source = $${add(query.source)}`);
  if (query.region_scope) where.push(`l.region_scope = $${add(query.region_scope)}`);
  if (query.region_city) where.push(deals.regionHasCity("lead.cities", "l.lead_id", add(query.region_city)));
  if (query.stage) where.push(`dl.stage = $${add(query.stage)}`);
  if (query.health) where.push(`dl.health = $${add(query.health)}`);
  if (query.q) {
    const n = add(query.q);
    where.push(`(search_fold(l.number::text || ' ' || l.name) LIKE '%' || search_fold($${n}) || '%'
      OR EXISTS (SELECT 1 FROM partner_contact pc2 WHERE pc2.lead_id = l.lead_id
                  AND search_fold(pc2.first_name || ' ' || pc2.last_name || ' ' || COALESCE(pc2.email::text, '')) LIKE '%' || search_fold($${n}) || '%'))`);
  }
  const seen = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE ${where.join(" AND ")} ${customSql} ${seen}
      ORDER BY ${orderBy(query, SORTS, "l.lead_id")}`,
    params,
    query,
  );
}

/** One lead the reader may see, whole, or null. Without a scope, whoever asks (a service in its own transaction). */
async function get(db, id, scope) {
  const params = [id];
  const seen = scope ? deals.recordSeen(scope, { alias: "l", kind: "lead" }, params) : "";
  const { rows } = await db.query(
    `SELECT ${DETAIL} ${FROM} LEFT JOIN reference_value src ON src.domain = 'lead_source' AND src.code = l.source
      WHERE l.lead_id = $1 ${seen}`,
    params,
  );
  return rows[0] || null;
}

/** The figures above Leads, within scope: by status, converted this month, and by source. */
async function summary(db, scope, { monthStart }) {
  const params = [monthStart];
  const seen = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE l.status = 'new')::int AS new,
            count(*) FILTER (WHERE l.status = 'contacted')::int AS contacted,
            count(*) FILTER (WHERE l.status = 'qualified')::int AS qualified,
            count(*) FILTER (WHERE l.status = 'converted' AND l.converted_at >= $1::timestamptz)::int AS converted_this_month
       FROM lead l WHERE TRUE ${seen}`,
    params,
  );
  const sp = [];
  const seen2 = deals.recordSeen(scope, { alias: "l", kind: "lead" }, sp);
  const bySource = await pageQuery(
    db,
    `SELECT l.source, COALESCE(rv.label, 'No Source') AS label, count(*)::int AS leads, ${TOTAL_COL}
       FROM lead l LEFT JOIN reference_value rv ON rv.domain = 'lead_source' AND rv.code = l.source
      WHERE l.status <> 'lost' ${seen2}
      GROUP BY l.source, rv.label
      ORDER BY count(*) DESC, COALESCE(rv.label, 'No Source'), l.source`,
    sp,
    { page: 1 },
  );
  return { ...rows[0], by_source: bySource.data.map((r) => ({ source: r.source ? String(r.source) : null, label: r.label, leads: r.leads })) };
}

const COLUMNS = ["name", "partner_category_id", "industry", "region_scope", "website", "objective", "source", "owner_id", "identified_on", "impact", "impact_rating", "impact_note", "comments", "custom"];

/** A new lead; returns its id. */
async function insert(client, row) {
  const cols = ["number", "status", ...COLUMNS];
  const { rows } = await client.query(
    `INSERT INTO lead (${cols.join(", ")}) VALUES (${cols.map((k, i) => (k === "custom" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")}) RETURNING lead_id`,
    cols.map((k) => (k === "custom" ? JSON.stringify(row.custom || {}) : row[k] === undefined ? null : row[k])),
  );
  return rows[0].lead_id;
}

/** Change a lead's own columns (only those given). */
async function update(client, id, changes) {
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  await client.query(`UPDATE lead SET ${keys.map((k, i) => (k === "custom" ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`)).join(", ")} WHERE lead_id = $1`, [
    id,
    ...keys.map((k) => (k === "custom" ? JSON.stringify(changes[k] || {}) : changes[k])),
  ]);
}

/** A lead locked for a change. */
async function lock(client, id) {
  const { rows } = await client.query(
    `SELECT lead_id, number::text AS number, name, status, owner_id, partner_category_id, custom, converted_partner_id,
            industry, region_scope, website, lost_reason
       FROM lead WHERE lead_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** Remove a lead an import made and nothing uses (reverting its import); its contacts go with it. */
async function remove(client, id) {
  await client.query("DELETE FROM lead WHERE lead_id = $1", [id]);
}

module.exports = { list, get, summary, insert, update, lock, remove, COLUMNS };
