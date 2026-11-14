"use strict";
/**
 * Partners and the contacts of leads and partners: the SQL (docs/guides/partnerships.md §4.2, §6.1,
 * §6.2, §6.6). Who sees a partner: its owner in the reader's scope, or a reader who may see one of
 * its deals (partner_pipeline.repo's one rule).
 *
 * A partner's list row carries its furthest open or live deal (the stage furthest along MyCity's
 * list) with that deal's health, and its last contact (its latest interaction).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const deals = require("../partner_pipeline/partner_pipeline.repo");

/** The partner's furthest open or live deal. */
const FROM = `FROM partner p
  LEFT JOIN LATERAL (SELECT (array_agg(po.stage ORDER BY rvs.display_order DESC NULLS LAST, po.created_at DESC))[1] AS stage,
                            (array_agg(po.health ORDER BY rvs.display_order DESC NULLS LAST, po.created_at DESC))[1] AS health,
                            (array_agg(rvs.label ORDER BY rvs.display_order DESC NULLS LAST, po.created_at DESC))[1] AS stage_label
                       FROM partnership_opportunity po
                       LEFT JOIN reference_value rvs ON rvs.domain = 'partnership_stage' AND rvs.code = po.stage
                      WHERE po.partner_id = p.partner_id AND po.status IN ('open', 'live')) fd ON TRUE
  LEFT JOIN partner_category pc ON pc.partner_category_id = p.partner_category_id
  LEFT JOIN employee e ON e.employee_id = p.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const ROW = `p.partner_id, p.number, p.name, p.partner_category_id, pc.name::text AS category,
  ${deals.regionLabel("p.region_scope", "partner.cities", "p.partner_id")} AS region, p.status,
  COALESCE(fd.stage_label, fd.stage) AS stage_label, fd.health, ${personJson("e", "d")} AS owner,
  ${deals.lastContact("partner", "p.partner_id")} AS last_contact_at, p.since`;

const DETAIL = `${ROW}, p.legal_name, p.industry, p.website, p.country_code::text AS country_code, p.region_scope,
  p.logo_document_id, p.lead_id, p.custom, p.closed_at, p.close_reason,
  COALESCE((p.metadata->>'signed_before_hub')::boolean, false) AS signed_outside, p.created_at, p.owner_id`;

const SORTS = { name: "p.name", last_contact_at: "last_contact_at", since: "p.since", created_at: "p.created_at" };

/** A live partner with no contact since `$quietFrom` (Lagos start of day, §6.12): one never contacted counts from when it was made. */
const QUIET = (n) => `p.status = 'active' AND COALESCE(${deals.lastContact("partner", "p.partner_id")}, p.created_at) < $${n}::timestamptz`;

/**
 * A page of partners the reader may see.
 * @param {object} query  PartnerListQuery
 * @param {{quietFrom: Date}} on
 */
function list(db, query, scope, { quietFrom, customSql = "", params: start = [] }) {
  const params = [...start];
  const add = (v) => {
    params.push(v);
    return params.length;
  };
  const where = ["TRUE"];
  if (query.status) where.push(`p.status = $${add(query.status)}`);
  if (query.partner_category_id) where.push(`p.partner_category_id = $${add(query.partner_category_id)}`);
  if (query.owner_id) where.push(`p.owner_id = $${add(query.owner_id)}`);
  if (query.region_scope) where.push(`p.region_scope = $${add(query.region_scope)}`);
  if (query.region_city) where.push(deals.regionHasCity("partner.cities", "p.partner_id", add(query.region_city)));
  if (query.stage) where.push(`EXISTS (SELECT 1 FROM partnership_opportunity sx WHERE sx.partner_id = p.partner_id AND sx.status IN ('open', 'live') AND sx.stage = $${add(query.stage)})`);
  if (query.health) where.push(`EXISTS (SELECT 1 FROM partnership_opportunity hx WHERE hx.partner_id = p.partner_id AND hx.status IN ('open', 'live') AND hx.health = $${add(query.health)})`);
  if (query.quiet === true) where.push(QUIET(add(quietFrom)));
  if (query.q) {
    const n = add(query.q);
    where.push(`(search_fold(p.number || ' ' || p.name || ' ' || COALESCE(p.legal_name, '')) LIKE '%' || search_fold($${n}) || '%'
      OR EXISTS (SELECT 1 FROM partner_contact pc2 WHERE pc2.partner_id = p.partner_id
                  AND search_fold(pc2.first_name || ' ' || pc2.last_name || ' ' || COALESCE(pc2.email::text, '')) LIKE '%' || search_fold($${n}) || '%'))`);
  }
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL} ${FROM}
      WHERE ${where.join(" AND ")} ${customSql} ${seen}
      ORDER BY ${orderBy(query, SORTS, "p.partner_id")}`,
    params,
    query,
  );
}

/** One partner the reader may see, whole, or null; without a scope, whoever asks. */
async function get(db, id, scope) {
  const params = [id];
  const seen = scope ? deals.recordSeen(scope, { alias: "p", kind: "partner" }, params) : "";
  const { rows } = await db.query(`SELECT ${DETAIL} ${FROM} WHERE p.partner_id = $1 ${seen}`, params);
  return rows[0] || null;
}

/** The cards above Partners, within scope. */
async function summary(db, scope, { quietFrom }) {
  const params = [quietFrom];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE p.status = 'active')::int AS active,
            count(*) FILTER (WHERE p.status = 'dormant')::int AS dormant,
            count(*) FILTER (WHERE ${QUIET(1)})::int AS quiet,
            COALESCE(sum((SELECT count(*) FROM partnership_opportunity lv WHERE lv.partner_id = p.partner_id AND lv.status = 'live')), 0)::int AS live_deals,
            COALESCE(sum((SELECT sum(${deals.signedValue("sv")}) FROM partnership_opportunity sv
                           WHERE sv.partner_id = p.partner_id AND sv.currency = 'NGN' AND sv.signed_at IS NOT NULL)), 0)::numeric(18,2)::text AS signed_value
       FROM partner p WHERE TRUE ${seen}`,
    params,
  );
  return rows[0];
}

/**
 * A partner's figures for its 360, over the deals the reader sees (§6.1): signed value, the year's
 * returns and downloads, live deals.
 * @param {object|null} scope  null: every deal
 */
async function figures(db, id, { yearStart, yearEnd }, scope = null) {
  const params = [id, yearStart, yearEnd];
  const seen = scope ? deals.dealSeen(scope, "po", params) : "";
  const { rows } = await db.query(
    `WITH sv AS (SELECT po.* FROM partnership_opportunity po WHERE po.partner_id = $1 ${seen})
     SELECT COALESCE((SELECT sum(${deals.signedValue("sv")}) FROM sv
                       WHERE sv.currency = 'NGN' AND sv.signed_at IS NOT NULL), 0)::numeric(18,2)::text AS signed_value,
            COALESCE((SELECT sum(r.mycity_commission) FROM deal_return r JOIN sv ON sv.partnership_opportunity_id = r.deal_id
                       WHERE r.month BETWEEN $2::date AND $3::date), 0)::numeric(18,2)::text AS returns_this_year,
            COALESCE((SELECT sum(r.downloads) FROM deal_return r JOIN sv ON sv.partnership_opportunity_id = r.deal_id
                       WHERE r.month BETWEEN $2::date AND $3::date), 0)::int AS downloads_this_year,
            (SELECT count(*) FROM sv WHERE sv.status = 'live')::int AS active_deals`,
    params,
  );
  return rows[0];
}

/** The assistant summary's second grouping: the key, name and order each `by` maps to (never the caller's words). */
const SUMMARY_BY = Object.freeze({
  category: { key: "x.partner_category_id", label: "x.category", none: "No Category", order: "count(*) DESC, min(x.category)" },
  region: { key: "x.region", label: "x.region", none: "No Region", order: "count(*) DESC, min(x.region)" },
  owner: { key: "x.owner_id", label: "x.owner", none: "No Owner", order: "count(*) DESC, min(x.owner)" },
  health: {
    key: "x.health",
    label: "x.health",
    none: "No Open Deal",
    order: "min(CASE x.health WHEN 'on_track' THEN 1 WHEN 'follow_up_required' THEN 2 WHEN 'stalled' THEN 3 ELSE 4 END)",
  },
});

/**
 * The partners in figures for the assistant (docs/guides/praxis-ai.md §6.13, Partnerships), in one
 * statement with the reader's scope as list() applies it (§6.1): the counts by status, the quiet ones by the
 * list's own rule (§6.12, `$quietFrom`), those with a live deal; by status; by category, region as the list
 * shows it, owner, or the health of the partner's furthest open or live deal as the list shows it, each row's
 * statuses for a stacked bar (20); partners added (since, else made) by Lagos month. A period on the day
 * added narrows it only when `from` and `to` are given. Figures, never a row.
 * @param {{quietFrom: Date}} on
 */
async function aiSummary(db, q, scope, { quietFrom }) {
  const dim = SUMMARY_BY[q.by] || SUMMARY_BY.category;
  const params = [quietFrom, q.status || null, q.partner_category_id || null, q.owner_id || null, q.region_scope || null, q.stage || null, q.health || null, q.quiet === true, q.from || null, q.to || null, dim.none];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const added = "COALESCE(p.since, (p.created_at AT TIME ZONE 'Africa/Lagos')::date)";
  const { rows } = await db.query(
    `WITH x AS (
       SELECT p.partner_id, p.status, p.partner_category_id, pc.name::text AS category,
              ${deals.regionLabel("p.region_scope", "partner.cities", "p.partner_id")} AS region,
              p.owner_id, NULLIF(btrim(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')), '') AS owner,
              fd.health, ${added} AS added, (${QUIET(1)}) AS quiet,
              EXISTS (SELECT 1 FROM partnership_opportunity lv WHERE lv.partner_id = p.partner_id AND lv.status = 'live') AS live
         ${FROM}
        WHERE ($2::text IS NULL OR p.status = $2)
          AND ($3::uuid IS NULL OR p.partner_category_id = $3)
          AND ($4::uuid IS NULL OR p.owner_id = $4)
          AND ($5::text IS NULL OR p.region_scope = $5)
          AND ($6::text IS NULL OR EXISTS (SELECT 1 FROM partnership_opportunity sx WHERE sx.partner_id = p.partner_id AND sx.status IN ('open', 'live') AND sx.stage = $6))
          AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM partnership_opportunity hx WHERE hx.partner_id = p.partner_id AND hx.status IN ('open', 'live') AND hx.health = $7))
          AND (NOT $8::boolean OR (${QUIET(1)}))
          AND ($9::date IS NULL OR ${added} BETWEEN $9::date AND $10::date)
          ${seen}
     ), figures AS (
       SELECT count(*)::int AS partners,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              count(*) FILTER (WHERE status = 'dormant')::int AS dormant,
              count(*) FILTER (WHERE status = 'closed')::int AS closed,
              count(*) FILTER (WHERE quiet)::int AS quiet,
              count(*) FILTER (WHERE live)::int AS live
         FROM x
     ), by_dim AS (
       SELECT COALESCE(${dim.key}::text, 'none') AS key, COALESCE(min(${dim.label}), $11) AS label,
              count(*) FILTER (WHERE x.status = 'active')::int AS active,
              count(*) FILTER (WHERE x.status = 'dormant')::int AS dormant,
              count(*) FILTER (WHERE x.status = 'closed')::int AS closed,
              row_number() OVER (ORDER BY ${dim.order}, ${dim.key}) AS rank
         FROM x GROUP BY ${dim.key}
     ), added AS (
       SELECT to_char(added, 'YYYY-MM') AS at, count(*)::int AS value FROM x GROUP BY 1
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', status, 'value', n)) FROM (SELECT status, count(*)::int AS n FROM x GROUP BY status) s) AS by_status,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'active', active, 'dormant', dormant, 'closed', closed) ORDER BY rank)
               FROM by_dim WHERE rank <= 20) AS by_dim,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM added) AS added`,
    params,
  );
  const row = rows[0] || {};
  return { figures: row.figures || {}, by_status: row.by_status || [], by_dim: row.by_dim || [], added: row.added || [] };
}

const COLUMNS = ["name", "legal_name", "partner_category_id", "region_scope", "industry", "website", "logo_document_id", "owner_id", "since", "custom", "lead_id"];

/** A new partner; returns its id. */
async function insert(client, row) {
  const cols = ["number", "status", "metadata", ...COLUMNS];
  const { rows } = await client.query(
    `INSERT INTO partner (${cols.join(", ")}) VALUES (${cols.map((k, i) => (["custom", "metadata"].includes(k) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")}) RETURNING partner_id`,
    cols.map((k) => (["custom", "metadata"].includes(k) ? JSON.stringify(row[k] || {}) : row[k] === undefined ? null : row[k])),
  );
  return rows[0].partner_id;
}

/** Change a partner's own columns (only those given). */
async function update(client, id, changes) {
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  await client.query(`UPDATE partner SET ${keys.map((k, i) => (k === "custom" ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`)).join(", ")} WHERE partner_id = $1`, [
    id,
    ...keys.map((k) => (k === "custom" ? JSON.stringify(changes[k] || {}) : changes[k])),
  ]);
}

/** A partner locked for a change. */
async function lock(client, id) {
  const { rows } = await client.query(
    `SELECT partner_id, number, name, status, owner_id, partner_category_id, custom, closed_at
       FROM partner WHERE partner_id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] || null;
}

/** Remove a partner an import made and nothing uses (reverting its import); its contacts go with it. */
async function remove(client, id) {
  await client.query("DELETE FROM partner WHERE partner_id = $1", [id]);
}

/* ------------------------------------------------------------------ *
 * The Partnership Tracker import (M7 PR 4)
 * ------------------------------------------------------------------ */

/**
 * The lead or partner a tracker row names, by one match key, whatever the importer's scope (as the
 * duplicate check reads, §6.1): the name as written (case and spaces aside), the website's host, or
 * the primary contact's email. A closed partner or a lost lead still counts, so a second import of
 * the same file makes nothing twice.
 * @returns {Promise<{kind: "lead"|"partner", id: string, number: string}|null>}
 */
async function trackerMatch(db, key, value) {
  const host = (col) => `NULLIF(split_part(split_part(regexp_replace(regexp_replace(lower(COALESCE(${col}, '')), '^[a-z]+://', ''), '^www\\.', ''), '/', 1), ':', 1), '')`;
  const where = {
    name: (a) => `lower(btrim(regexp_replace(${a}.name, '\\s+', ' ', 'g'))) = lower(btrim(regexp_replace($1, '\\s+', ' ', 'g')))`,
    website: (a) => `${host(`${a}.website`)} = $1`,
    email: (a, kind) => `EXISTS (SELECT 1 FROM partner_contact c WHERE c.${kind}_id = ${a}.${kind}_id AND c.primary_contact AND lower(c.email::text) = lower($1))`,
  }[key];
  if (!where || value === null || value === undefined || value === "") return null;
  const { rows } = await db.query(
    `SELECT 'partner' AS kind, p.partner_id AS id, p.number FROM partner p WHERE ${where("p", "partner")}
     UNION ALL
     SELECT 'lead', l.lead_id, l.number::text FROM lead l WHERE l.status <> 'converted' AND ${where("l", "lead")}
     ORDER BY kind DESC, number LIMIT 1`,
    [String(value)],
  );
  return rows[0] || null;
}

/**
 * Whether a record the tracker import made is in use, so reverting the import would lose work: an
 * interaction, a proposal, an agreement, a document, a linked mail, a month of returns, or a stage or
 * health line that did not come from the import.
 */
async function trackerInUse(db, kind, id) {
  const col = `${kind}_id`;
  const { rows } = await db.query(
    `WITH deals AS (SELECT partnership_opportunity_id AS id FROM partnership_opportunity WHERE ${col} = $1)
     SELECT EXISTS (SELECT 1 FROM partner_interaction WHERE ${col} = $1 OR partnership_opportunity_id IN (SELECT id FROM deals))
         OR EXISTS (SELECT 1 FROM partnership_proposal WHERE partnership_opportunity_id IN (SELECT id FROM deals))
         OR EXISTS (SELECT 1 FROM partnership_agreement WHERE ${col} = $1 OR partnership_opportunity_id IN (SELECT id FROM deals))
         OR EXISTS (SELECT 1 FROM partner_document WHERE ${col} = $1)
         OR EXISTS (SELECT 1 FROM partner_mail_thread WHERE ${col} = $1)
         OR EXISTS (SELECT 1 FROM deal_return WHERE deal_id IN (SELECT id FROM deals))
         OR EXISTS (SELECT 1 FROM partnership_stage_history WHERE partnership_opportunity_id IN (SELECT id FROM deals) AND source IS DISTINCT FROM 'import')
         ${kind === "lead" ? "OR EXISTS (SELECT 1 FROM lead WHERE lead_id = $1 AND status = 'converted')" : ""} AS used`,
    [id],
  );
  return rows[0].used;
}

/**
 * The working employee a tracker's Lead Owner names, as the growth team writes one ("JOHN", "Mr. John",
 * "Ada Obi"): the whole name, else a first name only one person here has; null when none or several.
 */
async function employeeNamed(db, words) {
  const bare = String(words || "")
    .replace(/\b(mr|mrs|ms|miss|dr|engr|chief|sir|madam)\b\.?/gi, " ")
    .replace(/[^A-Za-z\s'-]/g, " ")
    .trim();
  if (!bare) return null;
  const { rows } = await db.query(
    `SELECT employee_id, count(*) OVER () AS n FROM employee
      WHERE status = 'active'
        AND (regexp_replace(lower($1), '[^a-z]', '', 'g') IN (
               regexp_replace(lower(first_name || last_name), '[^a-z]', '', 'g'),
               regexp_replace(lower(first_name || coalesce(middle_name, '') || last_name), '[^a-z]', '', 'g'))
             OR ($2 AND regexp_replace(lower(first_name), '[^a-z]', '', 'g') = regexp_replace(lower($1), '[^a-z]', '', 'g')))
      ORDER BY employee_id LIMIT 1`,
    [bare, !/\s/.test(bare)],
  );
  return rows[0] && Number(rows[0].n) === 1 ? rows[0].employee_id : null;
}

/** A working employee's name by their id, or null (Map Values' label for a Lead Owner). */
async function employeeLabel(db, id) {
  const { rows } = await db.query("SELECT btrim(first_name || ' ' || last_name) AS name FROM employee WHERE employee_id::text = $1 AND status = 'active'", [String(id)]);
  return rows[0] ? rows[0].name : null;
}

/** Whether an id is a partner's or a lead's, for reverting an import that made either. */
async function kindOf(db, id) {
  const { rows } = await db.query("SELECT 'partner' AS kind FROM partner WHERE partner_id::text = $1 UNION ALL SELECT 'lead' FROM lead WHERE lead_id::text = $1", [String(id)]);
  return rows[0] ? rows[0].kind : null;
}

/**
 * The tracker's columns for some partners, leads or deals the reader's list already chose (exports
 * in the tracker's columns, §6.13): the record, its primary contact, and the deal the row is about
 * (a record's open or live deal, else its latest). Money is never among them.
 * @param {"partner"|"lead"|"deal"} kind
 * @param {string[]} ids  ids of `kind`
 */
async function trackerRows(db, kind, ids) {
  if (!ids.length) return [];
  const record = (alias, k) => `${alias}.${k}_id`;
  const pick = (r) => `
    r_number, r_name, r_industry, r_region, r_custom, r_kind,
    (SELECT name::text FROM partner_category WHERE partner_category_id = r_category) AS category,
    (SELECT btrim(first_name || ' ' || last_name) FROM employee WHERE employee_id = r_owner) AS owner_name,
    ct.first_name, ct.last_name, ct.job_title, ct.email::text AS email,
    COALESCE(ct.phones, CASE WHEN ct.phone IS NULL THEN '{}'::text[] ELSE ARRAY[ct.phone] END) AS phones,
    d.number AS deal_number, d.title AS deal_title, d.objective, d.identified_on, d.next_action, d.expected_close_on, d.health, d.status AS deal_status,
    d.comments, d.custom AS deal_custom, d.impact_rating, d.impact_note,
    (SELECT label FROM reference_value WHERE domain = 'partnership_stage' AND code = d.stage) AS stage_label,
    (SELECT string_agg(label, ', ' ORDER BY display_order) FROM reference_value WHERE domain = 'partnership_impact' AND code = ANY(d.impact::citext[])) AS impact_labels,
    ${r} AS row_id`;
  const contactOf = (k) => `LEFT JOIN LATERAL (SELECT * FROM partner_contact c WHERE c.${k}_id = r.r_id ORDER BY c.primary_contact DESC, c.created_at LIMIT 1) ct ON true`;
  const base = (k, alias) => `SELECT ${alias}.${k}_id AS r_id, ${alias}.number::text AS r_number, ${alias}.name AS r_name, ${alias}.industry AS r_industry,
      ${deals.regionLabel(`${alias}.region_scope`, `${k}.cities`, `${alias}.${k}_id`)} AS r_region, ${alias}.custom AS r_custom, '${k}' AS r_kind,
      ${alias}.partner_category_id AS r_category, ${alias}.owner_id AS r_owner FROM ${k} ${alias}`;
  if (kind === "deal") {
    const { rows } = await db.query(
      `SELECT ${pick("d.partnership_opportunity_id")}
         FROM partnership_opportunity d
         JOIN (${base("partner", "p")} UNION ALL ${base("lead", "l")}) r ON r.r_id = COALESCE(d.partner_id, d.lead_id)
         LEFT JOIN LATERAL (SELECT * FROM partner_contact c
                             WHERE (r.r_kind = 'partner' AND c.partner_id = r.r_id) OR (r.r_kind = 'lead' AND c.lead_id = r.r_id)
                             ORDER BY c.primary_contact DESC, c.created_at LIMIT 1) ct ON true
        WHERE d.partnership_opportunity_id = ANY($1::uuid[])`,
      [ids],
    );
    return rows;
  }
  const { rows } = await db.query(
    `SELECT ${pick("r.r_id")}
       FROM (${base(kind, "x")}) r
       ${contactOf(kind)}
       LEFT JOIN LATERAL (SELECT * FROM partnership_opportunity o WHERE ${record("o", kind)} = r.r_id
                           ORDER BY (o.status IN ('open', 'live')) DESC, o.created_at DESC LIMIT 1) d ON true
      WHERE r.r_id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/* ------------------------------------------------------------------ *
 * Contacts
 * ------------------------------------------------------------------ */

const CONTACT = `partner_contact_id, partner_id, lead_id, first_name, last_name, job_title, email::text AS email,
  COALESCE(phones, CASE WHEN phone IS NULL THEN '{}'::text[] ELSE ARRAY[phone] END) AS phones, primary_contact, signatory, created_at`;

/** A record's first 25 contacts, the primary first. */
async function contactsOf(db, { kind, id }) {
  const page = await pageQuery(
    db,
    `SELECT ${CONTACT}, ${TOTAL_COL} FROM partner_contact WHERE ${kind}_id = $1
      ORDER BY primary_contact DESC, first_name, last_name, partner_contact_id`,
    [id],
    { page: 1 },
  );
  return page.data;
}

/** One contact, or null. */
async function contact(db, id) {
  const { rows } = await db.query(`SELECT ${CONTACT} FROM partner_contact WHERE partner_contact_id = $1`, [id]);
  return rows[0] || null;
}

/** A new contact; returns it. */
async function insertContact(client, row) {
  const { rows } = await client.query(
    `INSERT INTO partner_contact (partner_id, lead_id, first_name, last_name, job_title, email, phone, phones, primary_contact, signatory)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING partner_contact_id`,
    [row.partner_id || null, row.lead_id || null, row.first_name, row.last_name, row.job_title || null, row.email || null, (row.phones || [])[0] || null, row.phones && row.phones.length ? row.phones : null, Boolean(row.primary_contact), Boolean(row.signatory)],
  );
  return rows[0].partner_contact_id;
}

/** Change a contact's own columns. */
async function updateContact(client, id, changes) {
  const keys = Object.keys(changes).filter((k) => changes[k] !== undefined);
  if (!keys.length) return;
  await client.query(`UPDATE partner_contact SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE partner_contact_id = $1`, [id, ...keys.map((k) => changes[k])]);
}

/** Only one primary contact a record: the others lose it. */
async function clearPrimary(client, { kind, id }, keepId) {
  await client.query(`UPDATE partner_contact SET primary_contact = false WHERE ${kind}_id = $1 AND partner_contact_id <> $2 AND primary_contact`, [id, keepId]);
}

/** Whether a record already has a contact with this email. */
async function emailTaken(db, { kind, id }, email, exceptId = null) {
  if (!email) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM partner_contact WHERE ${kind}_id = $1 AND email = $2 AND ($3::uuid IS NULL OR partner_contact_id <> $3) LIMIT 1`,
    [id, email, exceptId],
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ *
 * Home's reads (docs/guides/home.md §4.1; partnerships.md §6.12, §6.17), through its partners
 * adapter and Home's Partner Inactivity alerts
 * ------------------------------------------------------------------ */

/** When a partner was last in contact: its latest interaction, else when it was added. */
const LAST_SEEN = `COALESCE(${deals.lastContact("partner", "p.partner_id")}, p.created_at)`;
const homeSearch = (n) => `($${n}::text IS NULL OR search_fold(p.name) LIKE '%' || search_fold($${n}) || '%')`;

/** How many partners are active, within the scope (Active Partnerships). */
async function homeActiveCount(db, scope) {
  const params = [];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM partner p WHERE p.status = 'active' ${seen}`, params);
  return rows[0].n;
}

/** A page of the active partners, within the scope, by name, with their category and last contact. */
function homeActivePage(db, scope, query) {
  const params = [query.q || null];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  return pageQuery(
    db,
    `SELECT p.partner_id, p.name, pc.name::text AS category, ${LAST_SEEN} AS last_contact_at, ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       FROM partner p
       LEFT JOIN partner_category pc ON pc.partner_category_id = p.partner_category_id
       LEFT JOIN employee e ON e.employee_id = p.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE p.status = 'active' AND ${homeSearch(1)} ${seen}
      ORDER BY ${orderBy(query, { name: "p.name" }, "p.partner_id")}`,
    params,
    query,
  );
}

/** How many active partners have had no contact since an instant, within the scope. */
async function homeQuietCount(db, since, scope) {
  const params = [since];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM partner p WHERE p.status = 'active' AND ${LAST_SEEN} < $1::timestamptz ${seen}`, params);
  return rows[0].n;
}

/** A page of the quiet partners, within the scope, the longest quiet first. */
function homeQuietPage(db, since, scope, query) {
  const params = [since, query.q || null];
  const seen = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  return pageQuery(
    db,
    `SELECT p.partner_id, p.name, ${LAST_SEEN} AS last_contact_at, ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       FROM partner p
       LEFT JOIN employee e ON e.employee_id = p.owner_id
       LEFT JOIN department d ON d.department_id = e.department_id
      WHERE p.status = 'active' AND ${LAST_SEEN} < $1::timestamptz AND ${homeSearch(2)} ${seen}
      ORDER BY ${orderBy(query, { last_contact_at: "last_contact_at" }, "p.partner_id")}`,
    params,
    query,
  );
}

/**
 * The active partners last in contact before `before`, a batch of at most `size` after `after` (by
 * id): Home's Partner Inactivity rules read them in their daily sweep, whatever the owner.
 */
async function homeQuietBatch(db, { before, after = null, size }) {
  const { rows } = await db.query(
    `SELECT q.partner_id, q.name, q.last_contact_at
       FROM (SELECT p.partner_id, p.name, ${LAST_SEEN} AS last_contact_at
               FROM partner p
              WHERE p.status = 'active' AND ($2::uuid IS NULL OR p.partner_id > $2::uuid)) q
      WHERE q.last_contact_at < $1::timestamptz
      ORDER BY q.partner_id
      LIMIT $3 -- pagination:batch the partners one step of Home's alert sweep reads`,
    [before, after, size],
  );
  return rows;
}

/** How many contacts are named so among the records the reader may see, and one of them (a Praxis AI card's words). */
async function contactsNamed(db, words, scope) {
  const params = [String(words).trim()];
  const p = deals.recordSeen(scope, { alias: "p", kind: "partner" }, params);
  const l = deals.recordSeen(scope, { alias: "l", kind: "lead" }, params);
  const { rows } = await db.query(
    `SELECT count(*)::int AS n, min(c.partner_contact_id::text) AS id FROM partner_contact c
       LEFT JOIN partner p ON p.partner_id = c.partner_id
       LEFT JOIN lead l ON l.lead_id = c.lead_id
      WHERE search_fold(c.first_name || ' ' || c.last_name) = search_fold($1)
        AND ((c.partner_id IS NOT NULL ${p}) OR (c.lead_id IS NOT NULL ${l}))`,
    params,
  );
  return rows[0];
}

module.exports = {
  aiSummary,
  remove,
  trackerRows,
  employeeNamed,
  employeeLabel,
  kindOf,
  trackerMatch,
  trackerInUse,
  contactsNamed,
  homeActiveCount,
  homeActivePage,
  homeQuietCount,
  homeQuietPage,
  homeQuietBatch,
  list,
  get,
  summary,
  figures,
  insert,
  update,
  lock,
  contactsOf,
  contact,
  insertContact,
  updateContact,
  clearPrimary,
  emailTaken,
  SORTS,
};
