"use strict";
/**
 * Offers: the SQL (docs/guides/offers.md §4, §6). Writes offer and offer_pay_line, and the setting
 * row recruitment.offer_signatory; reads the application, candidate, vacancy, department and the
 * interview round they belong to. Never emits (BACKEND_GUIDE §2).
 *
 * Who sees an offer: the reader's `recruitment` scope over the vacancy's hiring manager, as the
 * candidates board (guide §8).
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

/** Who signs offers for the company (Offers settings). */
const SIGNATORY_SETTING = "recruitment.offer_signatory";

/** Every offer with what the list and the record show. */
const ROWS = `
  SELECT o.offer_id, o.number::text AS number, o.application_id, o.status, o.job_title, o.department_id,
         o.worksite_id, o.start_date, o.expires_at, o.currency::text AS currency,
         o.annual_compensation::text AS annual_compensation, o.terms, o.document_id, o.approved_by, o.approved_at,
         o.accepted_at, o.declined_at, o.created_by, o.created_at, o.updated_at, o.job_description, o.working_hours,
         o.probation_months, o.workflow_instance_id, o.signature_request_id, o.score_snapshot::float AS score_snapshot,
         o.decision_snapshot, o.sent_at, o.withdrawn_at, o.end_reason, o.reports_to, o.role_function, o.role_scope,
         o.employment_type, o.work_pattern, o.office_days, o.annual_leave_days, o.incentives, o.outside_range,
         o.range_reason, o.additional_terms, o.terms_version, o.submitted_at,
         a.vacancy_id, a.stage AS application_stage, a.status AS application_status,
         btrim(k.first_name || ' ' || k.last_name) AS candidate_name, k.first_name AS candidate_first_name,
         k.last_name AS candidate_last_name, k.email::text AS candidate_email, k.phone AS candidate_phone,
         v.title AS vacancy_title, v.hiring_manager_id, v.salary_min::text AS salary_min, v.salary_max::text AS salary_max,
         v.location AS vacancy_location,
         d.name AS department, w.name AS worksite_name,
         doc.title AS document_title, doc.original_name AS document_name, doc.mime AS document_mime,
         doc.bytes AS document_bytes, doc.render_status AS document_render_status,
         search_fold(o.number || ' ' || k.first_name || ' ' || k.last_name || ' ' || o.job_title || ' ' || v.title) AS haystack
    FROM offer o
    JOIN application a ON a.application_id = o.application_id
    JOIN candidate k ON k.candidate_id = a.candidate_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN department d ON d.department_id = o.department_id
    LEFT JOIN worksite w ON w.worksite_id = o.worksite_id
    LEFT JOIN document doc ON doc.document_id = o.document_id`;

/** Newest first unless asked. */
const SORTS = {
  newest: "x.created_at DESC",
  created_at: "x.created_at",
  expires_at: "x.expires_at",
  number: "x.number",
  annual_compensation: "x.annual_compensation::numeric",
};

/** One page of offers in scope. */
function list(db, query, scope) {
  const params = [query.status || null, query.vacancy_id || null, query.q || null, query.application_id || null];
  const s = scopeClause(scope, { column: "x.hiring_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL}
       FROM (${ROWS}) x
      WHERE ($1::text IS NULL OR x.status = $1)
        AND ($2::uuid IS NULL OR x.vacancy_id = $2)
        AND ($3::text IS NULL OR x.haystack LIKE '%' || search_fold($3) || '%')
        AND ($4::uuid IS NULL OR x.application_id = $4)
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "x.offer_id")}`,
    params,
    query,
  );
}

/** One offer, or null. `lock` holds the row for a write. */
async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM offer WHERE offer_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.offer_id = $1`, [id]);
  return rows[0] || null;
}

/**
 * When the mail server last refused this address for good, if that was at or after `since` (the
 * System Sender's Refused Addresses, shared/integrations/refusals.js). Mail accepted for the address
 * takes it off that list, so a row means it is still refused.
 */
async function refusedSince(db, email, since) {
  if (!email || !since) return null;
  const { rows } = await db.query(
    "SELECT last_refused_at FROM mail_refusal WHERE email = $1::citext AND last_refused_at >= $2",
    [email, since],
  );
  return rows[0] ? rows[0].last_refused_at : null;
}

/** The offer a signature request is for. */
async function bySignatureRequest(db, requestId) {
  const { rows } = await db.query("SELECT offer_id FROM offer WHERE signature_request_id = $1", [requestId]);
  return rows[0] ? rows[0].offer_id : null;
}

/** The application's offers still open (Not Progressing withdraws them). */
async function openFor(db, applicationId) {
  // pagination:complete one application's open offers: one at most (offer_one_open_per_application)
  const { rows } = await completeQuery(
    db,
    `SELECT offer_id FROM offer WHERE application_id = $1 AND status IN ('draft', 'approval', 'approved', 'sent')
      ORDER BY created_at, offer_id`,
    [applicationId],
  );
  return rows.map((r) => r.offer_id);
}

/** The figures above the list, in scope. */
async function summary(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE o.status = 'draft')::int AS drafts,
            count(*) FILTER (WHERE o.status = 'approval')::int AS with_approval,
            count(*) FILTER (WHERE o.status = 'approved')::int AS to_send,
            count(*) FILTER (WHERE o.status = 'sent')::int AS with_candidates,
            count(*) FILTER (WHERE o.status = 'accepted'
                               AND date_trunc('month', o.accepted_at AT TIME ZONE 'Africa/Lagos')
                                 = date_trunc('month', now() AT TIME ZONE 'Africa/Lagos'))::int AS accepted_this_month
       FROM offer o
       JOIN application a ON a.application_id = o.application_id
       JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      ${s.where}`,
    params,
  );
  return rows[0];
}

/** The pay lines in order. */
async function payLines(db, offerId) {
  // pagination:complete an offer's pay lines, twelve at most (OfferFields)
  const { rows } = await completeQuery(
    db,
    `SELECT offer_pay_line_id, position, name, monthly_amount::text AS monthly_amount
       FROM offer_pay_line WHERE offer_id = $1 ORDER BY position, offer_pay_line_id`,
    [offerId],
  );
  return rows;
}

/** Replace the pay lines. */
async function setPayLines(client, offerId, lines) {
  await client.query("DELETE FROM offer_pay_line WHERE offer_id = $1", [offerId]);
  let position = 0;
  for (const l of lines) {
    position += 1;
    await client.query(
      "INSERT INTO offer_pay_line (offer_id, position, name, monthly_amount) VALUES ($1, $2, $3, $4::numeric)",
      [offerId, position, l.name, l.monthly_amount],
    );
  }
}

const COLUMNS = [
  "job_title",
  "department_id",
  "worksite_id",
  "start_date",
  "reports_to",
  "role_function",
  "role_scope",
  "employment_type",
  "work_pattern",
  "office_days",
  "annual_leave_days",
  "incentives",
  "range_reason",
  "working_hours",
  "probation_months",
  "job_description",
  "additional_terms",
  "annual_compensation",
  "outside_range",
  "terms",
];

async function insert(client, o) {
  const cols = ["application_id", "number", "currency", "created_by", "score_snapshot", "decision_snapshot", ...COLUMNS];
  const values = cols.map((k) => (k === "terms" ? JSON.stringify(o.terms || {}) : o[k] === undefined ? null : o[k]));
  const { rows } = await client.query(
    `INSERT INTO offer (${cols.join(", ")}) VALUES (${cols.map((k, i) => (k === "terms" ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(", ")})
     RETURNING offer_id`,
    values,
  );
  return rows[0].offer_id;
}

/** Write the given terms of a draft. */
async function update(client, id, patch) {
  const keys = COLUMNS.filter((k) => patch[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k, i) => (k === "terms" ? `terms = $${i + 2}::jsonb` : `${k} = $${i + 2}`));
  await client.query(`UPDATE offer SET ${sets.join(", ")} WHERE offer_id = $1`, [
    id,
    ...keys.map((k) => (k === "terms" ? JSON.stringify(patch[k]) : patch[k])),
  ]);
}

/**
 * Move an offer from one of `from` to `to` with the stamps given; false when it was not in `from`
 * (a second press, or an outbox handler run again).
 */
async function setStatus(client, id, from, to, stamps = {}) {
  const keys = Object.keys(stamps);
  const sets = keys.map((k, i) => `${k} = $${i + 4}`);
  const { rowCount } = await client.query(
    `UPDATE offer SET status = $3${sets.length ? `, ${sets.join(", ")}` : ""}
      WHERE offer_id = $1 AND status = ANY($2::text[])`,
    [id, from, to, ...keys.map((k) => stamps[k])],
  );
  return rowCount === 1;
}

/** Stamps that do not move the status (the request and the document opened at approval). */
async function stamp(client, id, stamps) {
  const keys = Object.keys(stamps);
  if (!keys.length) return;
  await client.query(`UPDATE offer SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE offer_id = $1`, [
    id,
    ...keys.map((k) => stamps[k]),
  ]);
}

/** The application an offer is made for: its stage, its candidate and its vacancy's hiring manager. */
async function application(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM application WHERE application_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(
    `SELECT a.application_id, a.stage, a.status, a.vacancy_id, v.hiring_manager_id,
            btrim(k.first_name || ' ' || k.last_name) AS candidate_name
       FROM application a
       JOIN candidate k ON k.candidate_id = a.candidate_id
       JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE a.application_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** The latest reported interview decision of an application, for the offer's snapshot. */
async function interviewDecision(db, applicationId) {
  const { rows } = await db.query(
    `SELECT r.decision FROM interview_round r
      WHERE r.application_id = $1 AND r.decision IS NOT NULL
      ORDER BY r.reported_at DESC NULLS LAST, r.round_number DESC
      LIMIT 1`,
    [applicationId],
  );
  return rows[0] ? rows[0].decision : null;
}

/** The vacancy's terms New Offer starts from. */
async function vacancyTerms(db, vacancyId) {
  const { rows } = await db.query(
    `SELECT v.vacancy_id, v.title, v.department_id, v.worksite_id, v.reports_to, v.employment_type, v.work_pattern,
            v.probation_months, v.target_start_on, v.salary_min::text AS salary_min, v.salary_max::text AS salary_max,
            v.description, v.location
       FROM vacancy v WHERE v.vacancy_id = $1`,
    [vacancyId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * Offers settings
 * ------------------------------------------------------------------ */

/** The Offer Signatory: the employee named, their login and job title, or null. */
async function signatory(db) {
  const { rows } = await db.query(
    `SELECT e.employee_id, u.user_id, btrim(e.first_name || ' ' || e.last_name) AS name, e.job_title,
            u.email::text AS email, s.updated_at, ${personJson("e", "d")} AS person
       FROM setting s
       JOIN employee e ON e.employee_id = (s.value ->> 'employee_id')::uuid
       LEFT JOIN department d ON d.department_id = e.department_id
       LEFT JOIN app_user u ON u.employee_id = e.employee_id AND u.status = 'active'
      WHERE s.key = $1`,
    [SIGNATORY_SETTING],
  );
  return rows[0] || null;
}

async function putSignatory(client, employeeId, userId) {
  await client.query(
    `INSERT INTO setting (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [SIGNATORY_SETTING, JSON.stringify({ employee_id: employeeId }), userId],
  );
}

/** An active employee, for naming the signatory. */
async function employee(db, employeeId) {
  const { rows } = await db.query(
    "SELECT employee_id FROM employee WHERE employee_id = $1 AND status NOT IN ('archived', 'left')",
    [employeeId],
  );
  return rows[0] || null;
}

/** When the offer letter's wording was last saved. */
async function letterSavedAt(db, kind, key) {
  const { rows } = await db.query(
    "SELECT created_at FROM template_version WHERE kind = $1 AND key = $2 ORDER BY version DESC LIMIT 1",
    [kind, key],
  );
  return rows[0] ? rows[0].created_at : null;
}

module.exports = {
  refusedSince,
  SIGNATORY_SETTING,
  list,
  get,
  bySignatureRequest,
  openFor,
  summary,
  payLines,
  setPayLines,
  insert,
  update,
  setStatus,
  stamp,
  application,
  interviewDecision,
  vacancyTerms,
  signatory,
  putSignatory,
  employee,
  letterSavedAt,
};
