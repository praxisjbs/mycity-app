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
  COALESCE(l.impact, '{}') AS impact, ${deals.impactLabels("l.impact")} AS impact_labels, l.impact_rating, l.impact_note, l.comments, l.custom, l.lost_reason,
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

/** The assistant summary's second grouping: the key, name and order each `by` maps to (never the caller's words). */
const SUMMARY_BY = Object.freeze({
  stage: { key: "x.stage", label: "x.stage_label", none: "No Stage", order: "min(x.stage_order) NULLS LAST, min(x.stage_label)" },
  category: { key: "x.partner_category_id", label: "x.category", none: "No Category", order: "count(*) DESC, min(x.category)" },
  region: { key: "x.region", label: "x.region", none: "No Region", order: "count(*) DESC, min(x.region)" },
  owner: { key: "x.owner_id", label: "x.owner", none: "No Owner", order: "count(*) DESC, min(x.owner)" },
  source: { key: "x.source", label: "x.source_label", none: "No Source", order: "count(*) DESC, min(x.source_label)" },
});

/**
 * The leads in figures for the assistant (docs/guides/praxis-ai.md §6.13, Partnerships), in one statement
 * with the reader's scope as list() applies it (§6.1): the counts by status (lost ones too, which the list
 * hides unless asked); by status; by stage (in the list's order), category, region as the list shows it,
 * owner or source, each row's statuses for a stacked bar (20); identified and converted by Lagos month. A
 * period on the day identified (else made) narrows it only when `from` and `to` are given. Figures, never a row.
 * @param {{status?: string, partner_category_id?: string, owner_id?: string, source?: string, region_scope?: string, stage?: string, health?: string, from?: string, to?: string, by: string}} q
 */
async function aiSummary(db, q, scope) {
  const dim = SUMMARY_BY[q.by] || SUMMARY_BY.stage;
  const params = [q.status || null, q.partner_category_id || null, q.owner_id || null, q.source || null, q.region_scope || null, q.stage || null, q.health || null, q.from || null, q.to || null, dim.none];
  const seen = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  const { rows } = await db.query(
    `WITH x AS (
       SELECT DISTINCT ON (l.lead_id) l.lead_id, l.status, dl.stage, COALESCE(rv.label, dl.stage) AS stage_label, rv.display_order AS stage_order,
              l.partner_category_id, pc.name::text AS category,
              ${deals.regionLabel("l.region_scope", "lead.cities", "l.lead_id")} AS region,
              l.owner_id, NULLIF(btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS owner,
              l.source, COALESCE(src.label, l.source) AS source_label,
              COALESCE(l.identified_on, (l.created_at AT TIME ZONE 'Africa/Lagos')::date) AS identified, l.converted_at
         FROM lead l
         LEFT JOIN partnership_opportunity dl ON dl.lead_id = l.lead_id
         LEFT JOIN reference_value rv ON rv.domain = 'partnership_stage' AND rv.code = dl.stage
         LEFT JOIN reference_value src ON src.domain = 'lead_source' AND src.code = l.source
         LEFT JOIN partner_category pc ON pc.partner_category_id = l.partner_category_id
         LEFT JOIN employee e ON e.employee_id = l.owner_id
        WHERE ($1::text IS NULL OR l.status = $1)
          AND ($2::uuid IS NULL OR l.partner_category_id = $2)
          AND ($3::uuid IS NULL OR l.owner_id = $3)
          AND ($4::text IS NULL OR l.source = $4)
          AND ($5::text IS NULL OR l.region_scope = $5)
          AND ($6::text IS NULL OR dl.stage = $6)
          AND ($7::text IS NULL OR dl.health = $7)
          AND ($8::date IS NULL OR COALESCE(l.identified_on, (l.created_at AT TIME ZONE 'Africa/Lagos')::date) BETWEEN $8::date AND $9::date)
          ${seen}
        ORDER BY l.lead_id, dl.created_at
     ), figures AS (
       SELECT count(*)::int AS leads,
              count(*) FILTER (WHERE status = 'new')::int AS new,
              count(*) FILTER (WHERE status = 'contacted')::int AS contacted,
              count(*) FILTER (WHERE status = 'qualified')::int AS qualified,
              count(*) FILTER (WHERE status = 'converted')::int AS converted,
              count(*) FILTER (WHERE status = 'lost')::int AS lost
         FROM x
     ), by_dim AS (
       SELECT COALESCE(${dim.key}::text, 'none') AS key, COALESCE(min(${dim.label}), $10) AS label,
              count(*) FILTER (WHERE x.status = 'new')::int AS new,
              count(*) FILTER (WHERE x.status = 'contacted')::int AS contacted,
              count(*) FILTER (WHERE x.status = 'qualified')::int AS qualified,
              count(*) FILTER (WHERE x.status = 'converted')::int AS converted,
              count(*) FILTER (WHERE x.status = 'lost')::int AS lost,
              row_number() OVER (ORDER BY ${dim.order}, ${dim.key}) AS rank
         FROM x GROUP BY ${dim.key}
     ), identified AS (
       SELECT to_char(identified, 'YYYY-MM') AS at, count(*)::int AS value FROM x GROUP BY 1
     ), converted AS (
       SELECT to_char(converted_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, count(*)::int AS value
         FROM x WHERE status = 'converted' AND converted_at IS NOT NULL GROUP BY 1
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', status, 'value', n)) FROM (SELECT status, count(*)::int AS n FROM x GROUP BY status) s) AS by_status,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'new', new, 'contacted', contacted, 'qualified', qualified,
                                               'converted', converted, 'lost', lost) ORDER BY rank)
               FROM by_dim WHERE rank <= 20) AS by_dim,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM identified) AS identified,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM converted) AS converted`,
    params,
  );
  const row = rows[0] || {};
  return { figures: row.figures || {}, by_status: row.by_status || [], by_dim: row.by_dim || [], identified: row.identified || [], converted: row.converted || [] };
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

module.exports = { list, get, summary, aiSummary, insert, update, lock, remove, COLUMNS };
