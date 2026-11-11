"use strict";
/**
 * Employment contracts: the SQL (docs/guides/offers.md §4, §6). Writes employment_contract; reads
 * the onboarding case, the offer it follows, the hire's employee record and the document it is
 * rendered into. Never emits (BACKEND_GUIDE §2).
 *
 * Who sees a contract: the reader's `recruitment` scope over its vacancy's hiring manager, as the
 * offer it follows (guide §8).
 */
const { personJson } = require("../../shared/db/person");

/**
 * Every contract with what its record shows. `terms_version` is the document's own
 * `template_version`: the standard wording in force when the contract was generated, so an edit
 * made later never changes a contract already sent or signed (guide §6).
 */
const ROWS = `
  SELECT ct.employment_contract_id, ct.onboarding_case_id, ct.employee_id, ct.number::text AS number,
         ct.status, ct.starts_on, ct.ends_on, ct.document_id, ct.signature_request_id,
         ct.created_at, ct.updated_at,
         oc.offer_id, oc.application_id, oc.owner_id, oc.status AS case_status,
         o.number::text AS offer_number, o.job_title,
         e.first_name AS employee_first_name, e.last_name AS employee_last_name,
         btrim(e.first_name || ' ' || e.last_name) AS employee_name,
         e.work_email::text AS employee_email, e.staff_number::text AS staff_number,
         ou.user_id AS owner_user_id,
         v.hiring_manager_id,
         doc.template_version AS terms_version, doc.render_status AS document_render_status,
         ${personJson("e", "d")} AS person
    FROM employment_contract ct
    JOIN onboarding_case oc ON oc.onboarding_case_id = ct.onboarding_case_id
    JOIN offer o ON o.offer_id = oc.offer_id
    JOIN application a ON a.application_id = oc.application_id
    JOIN vacancy v ON v.vacancy_id = a.vacancy_id
    LEFT JOIN employee e ON e.employee_id = ct.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN employee owner ON owner.employee_id = oc.owner_id
    LEFT JOIN app_user ou ON ou.employee_id = owner.employee_id AND ou.status = 'active'
    LEFT JOIN document doc ON doc.document_id = ct.document_id`;

/** One contract, or null. `lock` holds the row for a write. */
async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM employment_contract WHERE employment_contract_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.employment_contract_id = $1`, [id]);
  return rows[0] || null;
}

/** The case's contract: one a case (guide §6). */
async function byCase(db, caseId) {
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.onboarding_case_id = $1`, [caseId]);
  return rows[0] || null;
}

/** The contract a signature request is for. */
async function bySignatureRequest(db, requestId) {
  const { rows } = await db.query(
    "SELECT employment_contract_id FROM employment_contract WHERE signature_request_id = $1",
    [requestId],
  );
  return rows[0] ? rows[0].employment_contract_id : null;
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO employment_contract (onboarding_case_id, employee_id, number, status, starts_on, ends_on, document_id)
     VALUES ($1, $2, $3, 'draft', $4, $5, $6)
     RETURNING employment_contract_id`,
    [row.onboarding_case_id, row.employee_id, row.number, row.starts_on, row.ends_on || null, row.document_id],
  );
  return rows[0].employment_contract_id;
}

/**
 * Move the status, only from one of `from`. Returns false when the row had moved on already, so a
 * hook that runs twice writes once (BACKEND_GUIDE §5.3).
 */
async function setStatus(client, id, from, to, patch = {}) {
  const sets = ["status = $3", "updated_at = now()"];
  const params = [id, from, to];
  for (const [col, value] of Object.entries(patch)) {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  const { rowCount } = await client.query(
    `UPDATE employment_contract SET ${sets.join(", ")}
      WHERE employment_contract_id = $1 AND status = ANY($2::text[])`,
    params,
  );
  return rowCount > 0;
}

/** The document and the signature request, once they exist. */
async function stamp(client, id, { document_id: documentId, signature_request_id: requestId }) {
  await client.query(
    `UPDATE employment_contract
        SET document_id = COALESCE($2, document_id),
            signature_request_id = COALESCE($3, signature_request_id),
            updated_at = now()
      WHERE employment_contract_id = $1`,
    [id, documentId || null, requestId || null],
  );
}

module.exports = { ROWS, get, byCase, bySignatureRequest, insert, setStatus, stamp };
