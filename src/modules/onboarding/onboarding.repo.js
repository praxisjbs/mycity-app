"use strict";
/**
 * Onboarding: the SQL (docs/guides/offers.md §4, §6). Writes onboarding_case and
 * onboarding_checklist_item; reads the active document requirements the checklist is built from.
 * Never emits (BACKEND_GUIDE §2).
 *
 * PR 5 opens a case at the offer's acceptance. The uploads, verifications and the documentation
 * gate come with the onboarding backend (PR 6).
 */

/** The case, with who it is for. */
const ROWS = `
  SELECT oc.onboarding_case_id, oc.application_id, oc.offer_id, oc.employee_id, oc.owner_id,
         oc.status, oc.starts_on, oc.completed_at, oc.privacy_acknowledged_at,
         oc.documentation_completed_at, oc.cancelled_at, oc.end_reason, oc.created_at, oc.updated_at,
         ou.user_id AS owner_user_id,
         btrim(e.first_name || ' ' || e.last_name) AS employee_name
    FROM onboarding_case oc
    LEFT JOIN employee e ON e.employee_id = oc.employee_id
    LEFT JOIN employee owner ON owner.employee_id = oc.owner_id
    LEFT JOIN app_user ou ON ou.employee_id = owner.employee_id AND ou.status = 'active'`;

async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM onboarding_case WHERE onboarding_case_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.onboarding_case_id = $1`, [id]);
  return rows[0] || null;
}

/** The offer's case: one an offer (the table's UNIQUE). */
async function byOffer(db, offerId) {
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.offer_id = $1`, [offerId]);
  return rows[0] || null;
}

async function insertCase(client, row) {
  const { rows } = await client.query(
    `INSERT INTO onboarding_case (application_id, offer_id, employee_id, owner_id, status, starts_on)
     VALUES ($1, $2, $3, $4, 'documentation', $5)
     RETURNING onboarding_case_id`,
    [row.application_id, row.offer_id, row.employee_id, row.owner_id || null, row.starts_on || null],
  );
  return rows[0].onboarding_case_id;
}

/**
 * The document requirements a new case's checklist is built from: the active ones, in the order the
 * Checklist settings put them. Every case takes the whole list; `required` says which hold the gate.
 */
async function activeRequirements(db) {
  // pagination:complete the Checklist settings' own list, a few dozen rows, copied whole onto a case
  const { rows } = await db.query(
    `SELECT document_requirement_id, name, required, display_order
       FROM document_requirement
      WHERE active = true
      ORDER BY display_order, name`,
  );
  return rows;
}

/** How many active requirements are required: Send Offer is refused while there are none (guide §11). */
async function requiredCount(db) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM document_requirement WHERE active = true AND required = true",
  );
  return rows[0].n;
}

/** The case's checklist, one item a requirement. */
async function insertItems(client, caseId, requirements) {
  for (const r of requirements) {
    await client.query(
      `INSERT INTO onboarding_checklist_item (onboarding_case_id, document_requirement_id, title, status, display_order)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [caseId, r.document_requirement_id, r.name, r.display_order || 0],
    );
  }
  return requirements.length;
}

module.exports = { ROWS, get, byOffer, insertCase, activeRequirements, requiredCount, insertItems };
