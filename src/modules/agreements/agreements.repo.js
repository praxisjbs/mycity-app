"use strict";
/**
 * Partnerships · agreements' SQL (docs/guides/partnerships.md §4.2, §6.1, §6.8). Writes only
 * `partnership_agreement`; reads the deal it is on, its lead or partner, its owner, its documents and
 * its approval. An agreement follows its deal (§6.1): it is seen by whoever sees the deal, through
 * partner_pipeline.repo's one rule (its owner, its team, or the owner of its lead or partner). Money is
 * numeric(18,2), read as its two-place string. Never emits.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const { dealSeen } = require("../partner_pipeline/partner_pipeline.repo");
const lagos = require("../../shared/time/lagos");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** Lagos' today, as SQL compares it with a `date`. */
const TODAY = "(now() AT TIME ZONE 'Africa/Lagos')::date";

const FROM = `FROM partnership_agreement a
  LEFT JOIN partnership_opportunity po ON po.partnership_opportunity_id = a.partnership_opportunity_id
  LEFT JOIN partner p ON p.partner_id = a.partner_id
  LEFT JOIN lead l ON l.lead_id = a.lead_id
  LEFT JOIN employee e ON e.employee_id = a.owner_id
  LEFT JOIN department d ON d.department_id = e.department_id`;

const RECORD = `CASE WHEN p.partner_id IS NOT NULL THEN json_build_object('type', 'partner', 'id', p.partner_id, 'number', p.number, 'name', p.name)
       ELSE json_build_object('type', 'lead', 'id', l.lead_id, 'number', l.number::text, 'name', l.name) END`;

const ROW = `a.partnership_agreement_id, a.number, a.title, a.kind, a.status, ${RECORD} AS record,
  a.partnership_opportunity_id AS deal_id, a.starts_on, a.ends_on,
  CASE WHEN a.ends_on IS NULL THEN NULL ELSE a.ends_on - a.renewal_notice_days END AS renewal_on,
  a.value, btrim(a.currency) AS currency, ${personJson("e", "d")} AS owner, a.signed_at`;

const DETAIL = `${ROW}, a.partner_id, a.lead_id, a.owner_id, a.proposal_id, a.template_key::text AS template_key, a.template_version,
  a.fields, a.body, a.workflow_instance_id, a.document_id, a.signature_request_id, a.signed_document_id, a.signed_outside,
  a.renewal_notice_days, a.renews_agreement_id, a.closed_at, a.close_reason, a.returned_reason, a.returned_at, a.created_at,
  po.number AS deal_number, po.title AS deal_title, po.owner_id AS deal_owner_id,
  COALESCE(p.partner_category_id, l.partner_category_id) AS partner_category_id, e.department_id AS owner_department_id`;

const SORTS = { starts_on: "a.starts_on", ends_on: "a.ends_on", created_at: "a.created_at", number: "a.number" };

/** The filters the list takes, as SQL; appends params. */
function filters(query, params) {
  const out = [];
  const add = (v) => {
    params.push(v);
    return params.length;
  };
  if (query.status) out.push(`a.status = $${add(query.status)}`);
  if (query.kind) out.push(`a.kind = $${add(query.kind)}`);
  if (query.partner_id) out.push(`a.partner_id = $${add(query.partner_id)}`);
  if (query.lead_id) out.push(`a.lead_id = $${add(query.lead_id)}`);
  if (query.deal_id) out.push(`a.partnership_opportunity_id = $${add(query.deal_id)}`);
  if (query.owner_id) out.push(`a.owner_id = $${add(query.owner_id)}`);
  if (query.q) {
    const n = add(query.q);
    out.push(`search_fold(a.number || ' ' || a.title || ' ' || COALESCE(p.name, l.name, '')) LIKE '%' || search_fold($${n}) || '%'`);
  }
  return out.map((s) => `AND ${s}`).join("\n        ");
}

/** A page of the agreements the reader may see, newest first unless sorted. */
function list(db, query, scope) {
  const params = [];
  const where = filters(query, params);
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT ${ROW}, ${TOTAL_COL}
       ${FROM}
      WHERE TRUE ${where} ${seen}
      ORDER BY ${query.sort ? orderBy(query, SORTS, "a.partnership_agreement_id") : "a.created_at DESC, a.partnership_agreement_id"}`,
    params,
    query,
  );
}

/** One agreement whole, seen by the reader (null for none), or by anyone when `scope` is null. */
async function get(db, id, scope = null, { lock = false } = {}) {
  const params = [id];
  const seen = scope ? dealSeen(scope, "po", params) : "";
  return one(db, `SELECT ${DETAIL} ${FROM} WHERE a.partnership_agreement_id = $1 ${seen}${lock ? " FOR UPDATE OF a" : ""}`, params);
}

/** The cards above Contracts & MOUs, within scope. */
async function summary(db, scope) {
  const params = [];
  const seen = dealSeen(scope, "po", params);
  return one(
    db,
    `SELECT count(*) FILTER (WHERE a.status IN ('active', 'expiring'))::int AS active,
            count(*) FILTER (WHERE a.status IN ('review', 'approval') AND a.workflow_instance_id IS NOT NULL
                              AND EXISTS (SELECT 1 FROM workflow_instance wi WHERE wi.workflow_instance_id = a.workflow_instance_id AND wi.state = 'pending'))::int AS in_approval,
            count(*) FILTER (WHERE a.status IN ('sent', 'viewed'))::int AS awaiting_signature,
            count(*) FILTER (WHERE a.status IN ('signed', 'active', 'expiring') AND a.ends_on IS NOT NULL
                              AND a.ends_on - a.renewal_notice_days <= ${TODAY} + 180 AND a.ends_on >= ${TODAY})::int AS renewals_180
       ${FROM}
      WHERE TRUE ${seen}`,
    params,
  );
}

/** Renewals due: signed agreements ending within `days`, the soonest renewal first. */
function renewals(db, query, scope) {
  const params = [query.within_days || 180];
  const seen = dealSeen(scope, "po", params);
  return pageQuery(
    db,
    `SELECT a.partnership_agreement_id, a.number, a.title, ${RECORD} AS record, a.ends_on,
            a.ends_on - a.renewal_notice_days AS renewal_on, (a.ends_on - a.renewal_notice_days) - ${TODAY} AS days_left,
            ${personJson("e", "d")} AS owner, ${TOTAL_COL}
       ${FROM}
      WHERE a.status IN ('signed', 'active', 'expiring') AND a.ends_on IS NOT NULL
        AND a.ends_on >= ${TODAY} AND a.ends_on <= ${TODAY} + $1::int ${seen}
      ORDER BY a.ends_on - a.renewal_notice_days, a.partnership_agreement_id`,
    params,
    query,
  );
}

/** A deal's facts an agreement is filled from, whoever reads it (the caller has checked the reader sees it). */
const dealFacts = (db, dealId) =>
  one(
    db,
    `SELECT po.partnership_opportunity_id AS deal_id, po.number, po.title, po.lead_id, po.partner_id, po.owner_id, po.status,
            po.event_title, po.event_starts_on, po.event_ends_on, po.objective, po.expected_attendance, po.comments,
            po.validity_days, po.valid_until, po.estimated_value, btrim(po.currency) AS currency, po.commission_pct,
            po.commission_deviates, po.custom AS deal_custom, po.signed_at,
            COALESCE(p.partner_category_id, l.partner_category_id) AS partner_category_id,
            COALESCE(p.name, l.name) AS record_name, p.legal_name, COALESCE(p.custom, l.custom) AS record_custom,
            COALESCE(p.region_scope, l.region_scope) AS region_scope
       FROM partnership_opportunity po
       LEFT JOIN partner p ON p.partner_id = po.partner_id
       LEFT JOIN lead l ON l.lead_id = po.lead_id AND po.partner_id IS NULL
      WHERE po.partnership_opportunity_id = $1`,
    [dealId],
  );

/** The contact an agreement is addressed to and signed by: the record's signatory, else its first. */
const signatoryOf = (db, { partner_id: partnerId, lead_id: leadId }) =>
  one(
    db,
    `SELECT c.partner_contact_id, btrim(c.first_name || ' ' || c.last_name) AS full_name, c.job_title, c.email::text AS email,
            COALESCE(NULLIF(c.phones, '{}'), CASE WHEN c.phone IS NULL THEN '{}'::text[] ELSE ARRAY[c.phone] END) AS phones
       FROM partner_contact c
      WHERE ${partnerId ? "c.partner_id = $1" : "c.lead_id = $1"}
      ORDER BY c.signatory DESC, c.primary_contact DESC, c.created_at, c.partner_contact_id
      LIMIT 1`,
    [partnerId || leadId],
  );

async function insert(client, row) {
  const cols = Object.keys(row);
  const { rows } = await client.query(
    `INSERT INTO partnership_agreement (${cols.join(", ")}) VALUES (${cols.map((c, i) => (c === "fields" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")})
     RETURNING partnership_agreement_id`,
    cols.map((c) => (c === "fields" ? JSON.stringify(row[c]) : row[c])),
  );
  return rows[0].partnership_agreement_id;
}

/** Change columns of an agreement in one of `from`, true when it moved. A null `from` is any status. */
async function set(client, id, from, changes) {
  const cols = Object.keys(changes);
  const params = [id, ...cols.map((c) => (c === "fields" ? JSON.stringify(changes[c]) : changes[c]))];
  const guard = from ? ` AND status = ANY($${params.push(from)}::text[])` : "";
  const { rowCount } = await client.query(
    `UPDATE partnership_agreement SET ${cols.map((c, i) => `${c} = $${i + 2}${c === "fields" ? "::jsonb" : ""}`).join(", ")}
      WHERE partnership_agreement_id = $1${guard}`,
    params,
  );
  return rowCount === 1;
}

/** The agreement a signature request is for (its subject), locked. */
const bySignatureRequest = (client, requestId) =>
  one(client, "SELECT partnership_agreement_id FROM partnership_agreement WHERE signature_request_id = $1 FOR UPDATE", [requestId]);

/** The agreement a renewal follows on from: the earlier one this renews, locked. */
const renewedBy = (client, id) =>
  one(client, "SELECT renews_agreement_id FROM partnership_agreement WHERE partnership_agreement_id = $1", [id]);

/** The users an agreement's owner signs in as (for a notification), or none. */
async function userOf(db, employeeId) {
  if (!employeeId) return null;
  const r = await one(db, "SELECT user_id, email::text AS email FROM app_user WHERE employee_id = $1 AND status = 'active'", [employeeId]);
  return r || null;
}

/** The owner as the sealed copy is mailed to them: their name and work email. */
const ownerContact = (db, employeeId) =>
  one(
    db,
    `SELECT btrim(e.first_name || ' ' || e.last_name) AS name, e.work_email::text AS email
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );

/* ------------------------------------------------------------------ *
 * The daily job (agreement-renewals, §6.8)
 * ------------------------------------------------------------------ */

const ids = async (db, sql) => (await db.query(sql)).rows.map((r) => r.partnership_agreement_id);

/** Signed agreements whose term has begun: Active from their start. */
const dueToActivate = (db) =>
  ids(
    db,
    `SELECT partnership_agreement_id FROM partnership_agreement
      WHERE status = 'signed' AND starts_on IS NOT NULL AND starts_on <= ${TODAY}
      ORDER BY starts_on, partnership_agreement_id
      LIMIT 500 -- pagination:batch the daily sweep moves at most 500 a run; the rest wait for the next`,
  );

/** Active (or signed, past their start) agreements at their notice date: Expiring. */
const dueToExpire = (db) =>
  ids(
    db,
    `SELECT partnership_agreement_id FROM partnership_agreement
      WHERE status IN ('signed', 'active') AND ends_on IS NOT NULL AND ends_on - renewal_notice_days <= ${TODAY}
        AND (starts_on IS NULL OR starts_on <= ${TODAY})
      ORDER BY ends_on, partnership_agreement_id
      LIMIT 500 -- pagination:batch the daily sweep moves at most 500 a run; the rest wait for the next`,
  );

/** Expiring agreements not yet past their end: the renewal reminder's candidates. */
const expiringOpen = (db) =>
  db.query(
    `SELECT partnership_agreement_id, number, title, ends_on, owner_id FROM partnership_agreement
      WHERE status = 'expiring' AND ends_on >= ${TODAY}
      ORDER BY ends_on, partnership_agreement_id
      LIMIT 500 -- pagination:batch the reminder looks at most 500 a run; the rest wait for the next`,
  );

/** Lagos' today as the job reads it (a test moves the clock through lagos). */
const today = () => lagos.today();

module.exports = {
  list,
  get,
  summary,
  renewals,
  dealFacts,
  signatoryOf,
  insert,
  set,
  bySignatureRequest,
  renewedBy,
  userOf,
  ownerContact,
  dueToActivate,
  dueToExpire,
  expiringOpen,
  today,
};
