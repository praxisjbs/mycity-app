"use strict";
/**
 * Onboarding: the SQL (docs/guides/offers.md §4, §6). Writes onboarding_case,
 * onboarding_checklist_item, onboarding_guarantor, document_requirement, onboarding_plan,
 * onboarding_plan_step and onboarding_case_step; reads the hire's offer, employee, department and documents, and the SOPs a
 * plan step points to. Never emits (BACKEND_GUIDE §2).
 *
 * Scope: a case belongs to its owner, the vacancy's hiring manager (onboarding_case.owner_id), as an
 * offer and a contract do; `team` holders see the cases of the people below them.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

/* ------------------------------------------------------------------ *
 * Cases
 * ------------------------------------------------------------------ */

/** The case, with who it is for and what the offer says of the role. */
const ROWS = `
  SELECT oc.onboarding_case_id, oc.application_id, oc.offer_id, oc.employee_id, oc.owner_id,
         oc.status, oc.starts_on, oc.completed_at, oc.privacy_acknowledged_at,
         oc.documentation_completed_at, oc.cancelled_at, oc.end_reason, oc.created_at, oc.updated_at,
         ou.user_id AS owner_user_id,
         btrim(e.first_name || ' ' || e.last_name) AS employee_name,
         e.first_name AS employee_first_name, e.last_name AS employee_last_name,
         -- Mail to the hire goes to their own address: the work email is a placeholder until Complete.
         COALESCE(e.personal_email, e.work_email)::text AS employee_email,
         o.job_title, o.department_id, d.name AS department
    FROM onboarding_case oc
    JOIN offer o ON o.offer_id = oc.offer_id
    LEFT JOIN department d ON d.department_id = o.department_id
    LEFT JOIN employee e ON e.employee_id = oc.employee_id
    LEFT JOIN employee owner ON owner.employee_id = oc.owner_id
    LEFT JOIN app_user ou ON ou.employee_id = owner.employee_id AND ou.status = 'active'`;

/** Required items not yet verified: what the list counts as outstanding. */
const OUTSTANDING = `
  (SELECT count(*)::int FROM onboarding_checklist_item i
     LEFT JOIN document_requirement r ON r.document_requirement_id = i.document_requirement_id
    WHERE i.onboarding_case_id = x.onboarding_case_id AND COALESCE(r.required, true) AND i.status <> 'verified')`;

async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM onboarding_case WHERE onboarding_case_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT x.*, ${OUTSTANDING} AS items_outstanding FROM (${ROWS}) x WHERE x.onboarding_case_id = $1`, [id]);
  return rows[0] || null;
}

/** The offer's case: one an offer (the table's UNIQUE). */
async function byOffer(db, offerId) {
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.offer_id = $1`, [offerId]);
  return rows[0] || null;
}

/** The application's case, if it has one (an application has at most one, the table's UNIQUE). */
async function byApplication(db, applicationId) {
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) x WHERE x.application_id = $1`, [applicationId]);
  return rows[0] || null;
}

const SORTS = { starts_on: "x.starts_on", created_at: "x.created_at" };

/** Recruitment · Onboarding's list, 25 a page, within the reader's scope. */
function list(db, query, scope) {
  const params = [query.status ?? null, query.department_id ?? null, query.q ?? null];
  const s = scopeClause(scope, { column: "x.owner_id" }, params);
  return pageQuery(
    db,
    `SELECT x.onboarding_case_id, x.employee_name AS hire_name, x.job_title, x.department, x.status,
            x.starts_on, ${OUTSTANDING} AS items_outstanding, x.created_at, ${TOTAL_COL}
       FROM (${ROWS}) x
      WHERE ($1::text IS NULL OR x.status = $1)
        AND ($2::uuid IS NULL OR x.department_id = $2)
        AND ($3::text IS NULL OR search_fold(coalesce(x.employee_name, '') || ' ' || x.job_title) LIKE '%' || search_fold($3) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "x.onboarding_case_id")}`,
    params,
    query,
  );
}

/**
 * The figures above the list, over the cases in the reader's scope: each open status, the items sent
 * and waiting for a check, the pending steps past their due day, and the cases completed this month.
 */
async function summary(db, scope, today) {
  const params = [today];
  const s = scopeClause(scope, { column: "oc.owner_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE oc.status = 'documentation')::int AS documentation,
            COALESCE(sum((SELECT count(*) FROM onboarding_checklist_item i
                           WHERE i.onboarding_case_id = oc.onboarding_case_id AND i.status = 'uploaded'))
                     FILTER (WHERE oc.status = 'documentation'), 0)::int AS to_verify,
            count(*) FILTER (WHERE oc.status = 'pre_onboarding')::int AS pre_onboarding,
            count(*) FILTER (WHERE oc.status = 'onboarding')::int AS onboarding,
            COALESCE(sum((SELECT count(*) FROM onboarding_case_step st
                           WHERE st.onboarding_case_id = oc.onboarding_case_id AND st.status = 'pending'
                             AND st.due_on < $1::date))
                     FILTER (WHERE oc.status = 'onboarding'), 0)::int AS overdue_steps,
            count(*) FILTER (WHERE oc.status = 'completed'
                               AND date_trunc('month', oc.completed_at AT TIME ZONE 'Africa/Lagos')
                                 = date_trunc('month', now() AT TIME ZONE 'Africa/Lagos'))::int AS completed_this_month
       FROM onboarding_case oc
      ${s.where}`,
    params,
  );
  return rows[0];
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

/** Move a case on, only from the statuses given. True when it moved. */
async function setStatus(client, id, from, to, { documentationCompleted = false } = {}) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_case
        SET status = $3,
            documentation_completed_at = CASE WHEN $4 THEN now() ELSE documentation_completed_at END
      WHERE onboarding_case_id = $1 AND status = ANY($2::text[])`,
    [id, from, to, documentationCompleted],
  );
  return rowCount === 1;
}

/** Complete Onboarding: from onboarding only. True when it moved. */
async function setCompleted(client, id) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_case SET status = 'completed', completed_at = now()
      WHERE onboarding_case_id = $1 AND status = 'onboarding'`,
    [id],
  );
  return rowCount === 1;
}

/** Withdraw: from any status before completion, with the reason kept. True when it moved. */
async function setCancelled(client, id, reason) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_case SET status = 'cancelled', cancelled_at = now(), end_reason = $2
      WHERE onboarding_case_id = $1 AND status IN ('documentation', 'pre_onboarding', 'onboarding')`,
    [id, reason],
  );
  return rowCount === 1;
}

/** Cases at pre-onboarding whose start date has come: what onboarding-dispatch starts. */
async function dueToStart(db, today) {
  const { rows } = await db.query(
    `SELECT onboarding_case_id FROM onboarding_case
      WHERE status = 'pre_onboarding' AND starts_on IS NOT NULL AND starts_on <= $1::date
      ORDER BY starts_on, onboarding_case_id
      LIMIT 200 -- pagination:batch the dispatch starts at most 200 a run; the rest wait for the next`,
    [today],
  );
  return rows.map((r) => r.onboarding_case_id);
}

/**
 * Who holds each step role for a case, among people who work here now. The line manager is the
 * hire's own when their record names one; until hireIn fills their seat it does not, so it is read
 * from the vacancy's Organogram seat: the person the seat reports to, or the holder of the seat it
 * reports to, climbing through vacant seats (as employee_effective_manager does, migration 1160).
 * The head is their department's. The case's owner and the hire are on the case row itself.
 */
async function roleHolders(db, { employeeId, departmentId, applicationId }) {
  const { rows } = await db.query(
    `WITH RECURSIVE up AS (
       SELECT s.line_manager_id AS manager_id, s.line_manager_seat_id AS next_seat_id, 0 AS hops
         FROM application a
         JOIN vacancy v ON v.vacancy_id = a.vacancy_id
         JOIN org_seat s ON s.org_seat_id = v.org_seat_id
        WHERE a.application_id = $3
       UNION ALL
       SELECT COALESCE(s.filled_by_employee_id, s.line_manager_id),
              CASE WHEN s.filled_by_employee_id IS NULL THEN s.line_manager_seat_id END, up.hops + 1
         FROM up
         JOIN org_seat s ON s.org_seat_id = up.next_seat_id
        WHERE up.manager_id IS NULL AND up.hops < 32
     ),
     seat_manager AS (
       SELECT up.manager_id FROM up WHERE up.manager_id IS NOT NULL ORDER BY up.hops LIMIT 1
     )
     SELECT COALESCE(lm.employee_id, sm.employee_id) AS line_manager, hd.employee_id AS head_of_department
       FROM (SELECT 1) one
       LEFT JOIN employee e ON e.employee_id = $1
       LEFT JOIN employee lm ON lm.employee_id = e.line_manager_id AND lm.status = 'active'
       LEFT JOIN seat_manager smx ON true
       LEFT JOIN employee sm ON sm.employee_id = smx.manager_id AND sm.status = 'active'
       LEFT JOIN department d ON d.department_id = COALESCE($2, e.department_id)
       LEFT JOIN employee hd ON hd.employee_id = d.head_employee_id AND hd.status = 'active'`,
    [employeeId || null, departmentId || null, applicationId || null],
  );
  return rows[0] || { line_manager: null, head_of_department: null };
}

/** Whether the case's application is still active (a Not Progressing one is not started). */
async function applicationActive(db, applicationId) {
  const { rows } = await db.query("SELECT status FROM application WHERE application_id = $1", [applicationId]);
  return Boolean(rows[0] && rows[0].status === "active");
}

/** Why an application was not progressed, for the case it ends. */
async function applicationEndReason(db, applicationId) {
  const { rows } = await db.query("SELECT rejection_reason FROM application WHERE application_id = $1", [applicationId]);
  return rows[0] ? rows[0].rejection_reason : null;
}

/** The active login of an employee, to tell them something; null when they have none. */
async function loginOf(db, employeeId) {
  if (!employeeId) return null;
  const { rows } = await db.query("SELECT user_id FROM app_user WHERE employee_id = $1 AND status = 'active'", [employeeId]);
  return rows[0] ? rows[0].user_id : null;
}

/** The hire accepted the privacy notice; the first time is kept. */
async function acknowledgePrivacy(client, id) {
  await client.query(
    "UPDATE onboarding_case SET privacy_acknowledged_at = COALESCE(privacy_acknowledged_at, now()) WHERE onboarding_case_id = $1",
    [id],
  );
}

/* ------------------------------------------------------------------ *
 * The checklist
 * ------------------------------------------------------------------ */

/**
 * The document requirements a new case's checklist is built from: the active ones, in the order the
 * Checklist settings put them. Every case takes the whole list; `required` says which hold the gate.
 */
async function activeRequirements(db) {
  // pagination:complete the Checklist settings' own list, a few dozen rows, copied whole onto a case
  const { rows } = await completeQuery(
    db,
    `SELECT document_requirement_id, name, required, display_order
       FROM document_requirement
      WHERE active = true
      ORDER BY display_order, name, document_requirement_id`,
    [],
    { label: "The document requirements" },
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
async function insertItems(client, caseId, wanted) {
  for (const r of wanted) {
    await client.query(
      `INSERT INTO onboarding_checklist_item (onboarding_case_id, document_requirement_id, title, status, display_order)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [caseId, r.document_requirement_id, r.name, r.display_order || 0],
    );
  }
  return wanted.length;
}

const ITEM = `
  SELECT i.onboarding_checklist_item_id, i.onboarding_case_id, i.document_requirement_id, i.title,
         COALESCE(r.kind, 'file') AS kind, COALESCE(r.required, true) AS required, i.status,
         i.document_id, i.entered_value, i.uploaded_at, i.verified_at, i.verified_by, i.rejected_reason,
         i.display_order, d.original_name, d.bytes, d.mime, d.scan_status
    FROM onboarding_checklist_item i
    LEFT JOIN document_requirement r ON r.document_requirement_id = i.document_requirement_id
    LEFT JOIN document d ON d.document_id = i.document_id`;

/** A case's checklist in the settings' order. */
async function items(db, caseId) {
  // pagination:complete one case's checklist, one item a requirement (a few dozen at most)
  const { rows } = await completeQuery(
    db,
    `${ITEM} WHERE i.onboarding_case_id = $1 ORDER BY i.display_order, i.title, i.onboarding_checklist_item_id`,
    [caseId],
    { label: "A checklist" },
  );
  return rows;
}

async function item(db, caseId, itemId, { lock = false } = {}) {
  if (lock)
    await db.query("SELECT 1 FROM onboarding_checklist_item WHERE onboarding_checklist_item_id = $1 FOR UPDATE", [itemId]);
  const { rows } = await db.query(`${ITEM} WHERE i.onboarding_case_id = $1 AND i.onboarding_checklist_item_id = $2`, [caseId, itemId]);
  return rows[0] || null;
}

/** The hire sent an item: the file, the typed value or both; back to `uploaded` for checking again. */
async function itemUploaded(client, itemId, { document_id: documentId, entered_value: value }) {
  await client.query(
    `UPDATE onboarding_checklist_item
        SET status = 'uploaded', document_id = $2, entered_value = $3, uploaded_at = now(),
            verified_at = NULL, verified_by = NULL, rejected_reason = NULL
      WHERE onboarding_checklist_item_id = $1`,
    [itemId, documentId || null, value || null],
  );
}

async function itemVerified(client, itemId, userId) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_checklist_item
        SET status = 'verified', verified_at = now(), verified_by = $2, rejected_reason = NULL
      WHERE onboarding_checklist_item_id = $1 AND status = 'uploaded'`,
    [itemId, userId || null],
  );
  return rowCount === 1;
}

async function itemRejected(client, itemId, reason) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_checklist_item
        SET status = 'rejected', rejected_reason = $2, verified_at = NULL, verified_by = NULL
      WHERE onboarding_checklist_item_id = $1 AND status IN ('uploaded', 'verified')`,
    [itemId, reason],
  );
  return rowCount === 1;
}

/** A file the hire sent through this case's link: on their employee record, from no signed-in user. */
async function strangerDocument(db, documentId, employeeId) {
  const { rows } = await db.query(
    `SELECT document_id, original_name, bytes, mime, scan_status
       FROM document
      WHERE document_id = $1 AND entity_type = 'employee' AND entity_id = $2::text
        AND uploaded_by IS NULL AND is_current`,
    [documentId, employeeId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * The case's plan steps (copied on the start date)
 * ------------------------------------------------------------------ */

const CASE_STEP = `
  SELECT s.onboarding_case_step_id, s.onboarding_case_id, s.position, s.title, s.description, s.owner_role,
         s.owner_id, btrim(oe.first_name || ' ' || oe.last_name) AS owner_name, s.due_on, s.sop_id, s.status,
         s.done_by, s.done_at, s.reminded_at
    FROM onboarding_case_step s
    LEFT JOIN employee oe ON oe.employee_id = s.owner_id`;

/** A case's steps in the plan's order. */
async function caseSteps(db, caseId) {
  // pagination:complete one case's steps, forty at most (OnboardingPlanSave caps a plan's steps)
  const { rows } = await completeQuery(
    db,
    `${CASE_STEP} WHERE s.onboarding_case_id = $1 ORDER BY s.position, s.onboarding_case_step_id`,
    [caseId],
    { label: "A case's steps" },
  );
  return rows;
}

async function caseStep(db, caseId, stepId, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM onboarding_case_step WHERE onboarding_case_step_id = $1 FOR UPDATE", [stepId]);
  const { rows } = await db.query(`${CASE_STEP} WHERE s.onboarding_case_id = $1 AND s.onboarding_case_step_id = $2`, [caseId, stepId]);
  return rows[0] || null;
}

/** The plan's steps onto the case, once: a position already there is left as it is. */
async function insertCaseSteps(client, caseId, given) {
  let added = 0;
  for (const s of given) {
    const { rowCount } = await client.query(
      `INSERT INTO onboarding_case_step (onboarding_case_id, onboarding_plan_step_id, position, title, description,
                                         owner_role, owner_id, due_on, sop_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (onboarding_case_id, position) DO NOTHING`,
      [caseId, s.onboarding_plan_step_id, s.position, s.title, s.description || null, s.owner_role, s.owner_id || null, s.due_on, s.sop_id || null],
    );
    added += rowCount;
  }
  return added;
}

/** Mark Step Done: a pending step only. True when it changed. */
async function stepDone(client, stepId, userId) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_case_step SET status = 'done', done_by = $2, done_at = now()
      WHERE onboarding_case_step_id = $1 AND status = 'pending'`,
    [stepId, userId || null],
  );
  return rowCount === 1;
}

/** How many of a case's steps are still pending. */
async function openSteps(db, caseId) {
  const { rows } = await db.query(
    "SELECT count(*)::int AS n FROM onboarding_case_step WHERE onboarding_case_id = $1 AND status = 'pending'",
    [caseId],
  );
  return rows[0].n;
}

/** Pending steps due before today on cases at onboarding whose owner has not been reminded yet. */
async function overdueSteps(db, today) {
  const { rows } = await db.query(
    `SELECT s.onboarding_case_step_id, s.onboarding_case_id
       FROM onboarding_case_step s
       JOIN onboarding_case oc ON oc.onboarding_case_id = s.onboarding_case_id AND oc.status = 'onboarding'
      WHERE s.status = 'pending' AND s.reminded_at IS NULL AND s.due_on < $1::date
      ORDER BY s.due_on, s.onboarding_case_step_id
      LIMIT 500 -- pagination:batch the dispatch reminds at most 500 steps a run; the rest wait for the next`,
    [today],
  );
  return rows;
}

/** The owner was reminded of an overdue step: once. True the first time. */
async function markReminded(client, stepId) {
  const { rowCount } = await client.query(
    `UPDATE onboarding_case_step SET reminded_at = now()
      WHERE onboarding_case_step_id = $1 AND reminded_at IS NULL AND status = 'pending'`,
    [stepId],
  );
  return rowCount === 1;
}

/* ------------------------------------------------------------------ *
 * Guarantors
 * ------------------------------------------------------------------ */

const GUARANTOR = `
  SELECT g.onboarding_guarantor_id, g.onboarding_case_id, g.position, g.kind, g.full_name, g.relationship,
         g.organisation, g.job_title, g.phone, g.email::text AS email, g.years_known, g.form_document_id,
         g.date_of_birth, g.contact_address, g.residential_address, g.convicted, g.conviction_details,
         g.recommends, g.id_document_id,
         g.check_status, g.check_note, g.checked_at, d.original_name, d.bytes, d.mime,
         idd.original_name AS id_original_name, idd.bytes AS id_bytes, idd.mime AS id_mime
    FROM onboarding_guarantor g
    LEFT JOIN document d ON d.document_id = g.form_document_id
    LEFT JOIN document idd ON idd.document_id = g.id_document_id`;

async function guarantors(db, caseId) {
  // pagination:complete one case's guarantors, two at most (the table's CHECK on position)
  const { rows } = await completeQuery(db, `${GUARANTOR} WHERE g.onboarding_case_id = $1 ORDER BY g.position`, [caseId], {
    label: "A case's guarantors",
  });
  return rows;
}

async function guarantor(db, caseId, guarantorId, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM onboarding_guarantor WHERE onboarding_guarantor_id = $1 FOR UPDATE", [guarantorId]);
  const { rows } = await db.query(`${GUARANTOR} WHERE g.onboarding_case_id = $1 AND g.onboarding_guarantor_id = $2`, [caseId, guarantorId]);
  return rows[0] || null;
}

/** The hire enters or corrects a guarantor; a correction waits for its check again. */
async function saveGuarantor(client, caseId, g) {
  const { rows } = await client.query(
    `INSERT INTO onboarding_guarantor (onboarding_case_id, position, kind, full_name, relationship, organisation,
                                       job_title, phone, email, years_known, form_document_id, date_of_birth,
                                       contact_address, residential_address, convicted, conviction_details,
                                       recommends, id_document_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     ON CONFLICT (onboarding_case_id, position) DO UPDATE
        SET kind = EXCLUDED.kind, full_name = EXCLUDED.full_name, relationship = EXCLUDED.relationship,
            organisation = EXCLUDED.organisation, job_title = EXCLUDED.job_title, phone = EXCLUDED.phone,
            email = EXCLUDED.email, years_known = EXCLUDED.years_known, form_document_id = EXCLUDED.form_document_id,
            date_of_birth = EXCLUDED.date_of_birth, contact_address = EXCLUDED.contact_address,
            residential_address = EXCLUDED.residential_address, convicted = EXCLUDED.convicted,
            conviction_details = EXCLUDED.conviction_details, recommends = EXCLUDED.recommends,
            id_document_id = EXCLUDED.id_document_id,
            check_status = 'pending', check_note = NULL, checked_by = NULL, checked_at = NULL
     RETURNING onboarding_guarantor_id`,
    [
      caseId,
      g.position,
      g.kind,
      g.full_name,
      g.relationship,
      g.organisation || null,
      g.job_title || null,
      g.phone,
      g.email || null,
      g.years_known ?? null,
      g.form_document_id || null,
      g.date_of_birth || null,
      g.contact_address_line || null,
      g.residential_address_line || null,
      g.convicted ?? null,
      g.convicted ? g.conviction_details || null : null,
      g.recommends ?? null,
      g.id_document_id || null,
    ],
  );
  return rows[0].onboarding_guarantor_id;
}

/** A guarantor's address line rewritten when its waiting place is named (places.owner rename). */
async function setGuarantorAddressLine(client, column, guarantorId, line) {
  if (column === "contact_address")
    await client.query("UPDATE onboarding_guarantor SET contact_address = $2, updated_at = now() WHERE onboarding_guarantor_id = $1", [guarantorId, line]);
  else if (column === "residential_address")
    await client.query("UPDATE onboarding_guarantor SET residential_address = $2, updated_at = now() WHERE onboarding_guarantor_id = $1", [guarantorId, line]);
  else throw new Error(`onboarding: no address column ${column}`);
}

/** Whether the hire's home address is on their employee record (the gate's `address`). */
async function addressEntered(db, employeeId) {
  const { rows } = await db.query("SELECT home_address IS NOT NULL AND btrim(home_address) <> '' AS entered FROM employee WHERE employee_id = $1", [employeeId]);
  return Boolean(rows[0] && rows[0].entered);
}

async function recordCheck(client, guarantorId, { check_status: status, check_note: note }, userId) {
  await client.query(
    `UPDATE onboarding_guarantor
        SET check_status = $2, check_note = $3, checked_by = $4, checked_at = now()
      WHERE onboarding_guarantor_id = $1`,
    [guarantorId, status, note || null, userId || null],
  );
}

/* ------------------------------------------------------------------ *
 * The Checklist settings
 * ------------------------------------------------------------------ */

const REQUIREMENT = `
  SELECT document_requirement_id, code::text AS code, name, description, kind, required, expires, active, display_order
    FROM document_requirement`;
const REQUIREMENT_SORTS = { display_order: "x.display_order", name: "x.name" };

function requirements(db, query) {
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL} FROM (${REQUIREMENT}) x
      WHERE ($1::text IS NULL OR search_fold(x.name || ' ' || x.code) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, REQUIREMENT_SORTS, "x.document_requirement_id")}`,
    [query.q ?? null],
    query,
  );
}

async function requirement(db, id) {
  const { rows } = await db.query(`${REQUIREMENT} WHERE document_requirement_id = $1`, [id]);
  return rows[0] || null;
}

async function requirementByCode(db, code) {
  const { rows } = await db.query(`${REQUIREMENT} WHERE code = $1`, [code]);
  return rows[0] || null;
}

/** A new requirement goes last unless the settings place it. */
async function insertRequirement(client, r) {
  const { rows } = await client.query(
    `INSERT INTO document_requirement (code, name, description, kind, required, expires, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(max(display_order), 0) + 10 FROM document_requirement))
     RETURNING document_requirement_id`,
    [r.code, r.name, r.description || null, r.kind, r.required, r.expires],
  );
  return rows[0].document_requirement_id;
}

const REQUIREMENT_EDITABLE = ["name", "description", "kind", "required", "expires", "active", "display_order"];

async function updateRequirement(client, id, patch) {
  const keys = REQUIREMENT_EDITABLE.filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  await client.query(
    `UPDATE document_requirement SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now()
      WHERE document_requirement_id = $1`,
    [id, ...keys.map((k) => (k === "description" ? patch[k] || null : patch[k]))],
  );
}

/* ------------------------------------------------------------------ *
 * The Plans settings
 * ------------------------------------------------------------------ */

const PLAN = `
  SELECT p.onboarding_plan_id, p.department_id, d.name AS department, p.name, p.active, p.updated_at,
         (SELECT count(*)::int FROM onboarding_plan_step s WHERE s.onboarding_plan_id = p.onboarding_plan_id) AS step_count
    FROM onboarding_plan p
    LEFT JOIN department d ON d.department_id = p.department_id`;
const PLAN_SORTS = { name: "x.name", updated_at: "x.updated_at" };

function plans(db, query) {
  return pageQuery(
    db,
    `SELECT x.*, ${TOTAL_COL} FROM (${PLAN}) x
      WHERE ($1::text IS NULL OR search_fold(x.name || ' ' || coalesce(x.department, '')) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, PLAN_SORTS, "x.onboarding_plan_id")}`,
    [query.q ?? null],
    query,
  );
}

async function plan(db, id) {
  const { rows } = await db.query(`${PLAN} WHERE p.onboarding_plan_id = $1`, [id]);
  return rows[0] || null;
}

/** The plan a department's hire follows: its own while active, else the company's default. */
async function planFor(db, departmentId) {
  const { rows } = await db.query(
    `${PLAN} WHERE p.active AND (p.department_id = $1 OR p.department_id IS NULL)
      ORDER BY (p.department_id IS NULL), p.onboarding_plan_id LIMIT 1`,
    [departmentId || null],
  );
  return rows[0] || null;
}

/** The plan already kept for a department (or the default, for null). */
async function planOfDepartment(db, departmentId) {
  const { rows } = await db.query(
    "SELECT onboarding_plan_id FROM onboarding_plan WHERE department_id IS NOT DISTINCT FROM $1",
    [departmentId || null],
  );
  return rows[0] ? rows[0].onboarding_plan_id : null;
}

async function insertPlan(client, p, userId) {
  const { rows } = await client.query(
    `INSERT INTO onboarding_plan (department_id, name, active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING onboarding_plan_id`,
    [p.department_id || null, p.name, p.active, userId || null],
  );
  return rows[0].onboarding_plan_id;
}

async function updatePlan(client, id, p, userId) {
  await client.query(
    `UPDATE onboarding_plan SET department_id = $2, name = $3, active = $4, updated_by = $5, updated_at = now()
      WHERE onboarding_plan_id = $1`,
    [id, p.department_id || null, p.name, p.active, userId || null],
  );
}

/** A plan's steps, saved whole in the order given. Cases keep the copies they were given. */
async function replaceSteps(client, planId, given) {
  await client.query("DELETE FROM onboarding_plan_step WHERE onboarding_plan_id = $1", [planId]);
  let position = 0;
  for (const s of given) {
    position += 1;
    await client.query(
      `INSERT INTO onboarding_plan_step (onboarding_plan_id, position, title, description, owner_role, due_offset_days, sop_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [planId, position, s.title, s.description || null, s.owner_role, s.due_offset_days, s.sop_id || null],
    );
  }
}

async function steps(db, planId) {
  // pagination:complete one plan's steps, forty at most (OnboardingPlanSave)
  const { rows } = await completeQuery(
    db,
    `SELECT s.onboarding_plan_step_id, s.position, s.title, s.description, s.owner_role, s.due_offset_days, s.sop_id
       FROM onboarding_plan_step s
      WHERE s.onboarding_plan_id = $1
      ORDER BY s.position, s.onboarding_plan_step_id`,
    [planId],
    { label: "A plan's steps" },
  );
  return rows;
}

/** The SOPs the steps name, as M10's knowledge base keeps them; only those still in force. */
async function sops(db, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];
  // pagination:complete the SOPs one plan names, forty at most (one a step)
  const { rows } = await completeQuery(
    db,
    "SELECT sop_id, number::text AS number, title, department_id FROM sop WHERE sop_id = ANY($1::uuid[]) AND status = 'active' ORDER BY number, sop_id",
    [wanted],
    { label: "A plan's SOPs" },
  );
  return rows;
}

async function departmentExists(db, id) {
  const { rows } = await db.query("SELECT 1 FROM department WHERE department_id = $1 AND active IS NOT FALSE", [id]);
  return rows.length === 1;
}

module.exports = {
  ROWS,
  get,
  byOffer,
  byApplication,
  list,
  summary,
  insertCase,
  setStatus,
  setCompleted,
  setCancelled,
  dueToStart,
  roleHolders,
  applicationActive,
  applicationEndReason,
  loginOf,
  caseSteps,
  caseStep,
  insertCaseSteps,
  stepDone,
  openSteps,
  overdueSteps,
  markReminded,
  acknowledgePrivacy,
  activeRequirements,
  requiredCount,
  insertItems,
  items,
  item,
  itemUploaded,
  itemVerified,
  itemRejected,
  strangerDocument,
  guarantors,
  guarantor,
  saveGuarantor,
  setGuarantorAddressLine,
  addressEntered,
  recordCheck,
  requirements,
  requirement,
  requirementByCode,
  insertRequirement,
  updateRequirement,
  plans,
  plan,
  planFor,
  planOfDepartment,
  insertPlan,
  updatePlan,
  replaceSteps,
  steps,
  sops,
  departmentExists,
};
