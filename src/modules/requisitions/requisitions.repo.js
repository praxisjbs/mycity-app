"use strict";
/**
 * Requisitions: the SQL. Reads the requisitions with how many requests each holds and whether the
 * reader decides it now; writes only `requisition`. The requests it holds are written by the
 * expenses module (expenses.service). Never emits (BACKEND_GUIDE §2).
 *
 * A requisition's status is worked out with its approval, as a request's is: between the CEO's
 * decision and its copy (requisitions.events.js) the row still says `submitted`.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { personJson } = require("../../shared/db/person");
const approvers = require("../../shared/workflow/approvers");

const STATUS = `CASE
  WHEN r.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved') THEN 'approved'
  WHEN r.status = 'submitted' AND wi.state IN ('rejected', 'timeout_rejected') THEN 'rejected'
  WHEN r.status = 'submitted' AND wi.state = 'cancelled' THEN 'cancelled'
  ELSE r.status
END`;

/**
 * The rows, with `can_decide` for the reader: the approval is pending and its stage names them.
 * Appends the reader's parameters to `params`.
 */
async function rowsFor(db, user, params) {
  const roleCodes = await approvers.roleCodesOf(db, (user && user.role_ids) || []);
  const clause = approvers.waitingOnClause("wi", user || { user_id: null }, roleCodes, params);
  return `
  SELECT r.requisition_id, r.number, ${STATUS} AS status,
         (SELECT count(*)::int FROM expense_request er WHERE er.requisition_id = r.requisition_id) AS requests,
         r.total_amount, ${personJson("e", "d")} AS requester, r.workflow_instance_id,
         r.submitted_at, r.approved_at, r.rejected_at,
         (wi.state = 'pending' AND ${clause}) IS TRUE AS can_decide,
         r.created_at, search_fold(r.number) AS haystack
    FROM requisition r
    JOIN employee e ON e.employee_id = r.requester_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = r.workflow_instance_id`;
}

const OUT = `v.requisition_id, v.number, v.status, v.requests, v.total_amount, v.requester, v.workflow_instance_id,
  v.submitted_at, v.approved_at, v.rejected_at, v.can_decide`;

const SORTS = { submitted_at: "v.submitted_at", total_amount: "v.total_amount", number: "v.number" };

/** One page of requisitions, newest first unless sorted. */
async function list(db, query, user) {
  const params = [];
  const rows = await rowsFor(db, user, params);
  params.push(query.status || null, query.q || null);
  const n = params.length;
  const q = query.sort ? query : { ...query, sort: { field: "submitted_at", dir: "desc" } };
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${rows}) v
      WHERE ($${n - 1}::text IS NULL OR v.status = $${n - 1})
        AND ($${n}::text IS NULL OR v.haystack LIKE '%' || search_fold($${n}) || '%')
      ORDER BY ${orderBy(q, SORTS, "v.requisition_id")}`,
    params,
    q,
  );
}

/** One requisition as the list shows it, for this reader, or null. */
async function get(db, id, user) {
  const params = [];
  const rows = await rowsFor(db, user, params);
  params.push(id);
  const { rows: found } = await db.query(`SELECT ${OUT} FROM (${rows}) v WHERE v.requisition_id = $${params.length}`, params);
  return found[0] || null;
}

async function lock(client, id) {
  const { rows } = await client.query("SELECT * FROM requisition WHERE requisition_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO requisition (number, requester_id, status, currency, total_amount, submitted_at)
     VALUES ($1, $2, 'submitted', 'NGN', $3, now())
     RETURNING *`,
    [row.number, row.requester_id, row.total_amount],
  );
  return rows[0];
}

async function setWorkflow(client, id, instanceId) {
  await client.query("UPDATE requisition SET workflow_instance_id = $2, updated_at = now() WHERE requisition_id = $1", [id, instanceId]);
}

async function setTotal(client, id, total) {
  await client.query("UPDATE requisition SET total_amount = $2, updated_at = now() WHERE requisition_id = $1", [id, total]);
}

/** Move a requisition still `submitted` to its outcome; null when it had already moved. */
async function settle(client, id, status) {
  const at = { approved: "approved_at = now(),", rejected: "rejected_at = now()," }[status] || "";
  const { rows } = await client.query(
    `UPDATE requisition SET status = $2, ${at} updated_at = now()
      WHERE requisition_id = $1 AND status = 'submitted'
      RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

/** The login of whoever grouped a requisition, to tell them of a removal. */
async function userOfEmployee(db, employeeId) {
  const { rows } = await db.query("SELECT user_id FROM app_user WHERE employee_id = $1 LIMIT 1", [employeeId]);
  return rows[0] ? rows[0].user_id : null;
}

module.exports = { userOfEmployee, list, get, lock, insert, setWorkflow, setTotal, settle };
