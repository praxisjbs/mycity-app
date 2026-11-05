"use strict";
/**
 * Expense requests: the SQL. Reads the requests with their lines, payee, invoice, approval and
 * budget line; writes only expense_request and expense_request_line. Never emits (BACKEND_GUIDE §2).
 *
 * A request's status as a person reads it is worked out with its approvals. The `expenses.request`
 * approval decides a sent request and the requisition's approval decides a grouped one; each
 * outcome is copied onto the request after commit (expenses.events.js, requisitions.events.js), so
 * between a decision and its copy the row still says `submitted` or `in_requisition`. Every read
 * uses STATUS below, which takes the approval's outcome when the copy has not landed yet.
 *
 * Bank details leave here unmasked: the controllers mask them for a reader without
 * `employee.bank`, never the requester's own (shared/rbac/field-mask).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const approvers = require("../../shared/workflow/approvers");

const STATUS = `CASE
  WHEN er.status = 'submitted' AND wi.state IN ('approved', 'timeout_approved') THEN 'approved'
  WHEN er.status = 'submitted' AND wi.state IN ('rejected', 'timeout_rejected') THEN 'rejected'
  WHEN er.status = 'in_requisition' AND rwi.state IN ('approved', 'timeout_approved') THEN 'authorised'
  WHEN er.status = 'in_requisition' AND rwi.state IN ('rejected', 'timeout_rejected') THEN 'approved'
  ELSE er.status
END`;

/** The name a pending approval's current stage goes by. An aggregate, as these rows are paged. */
const stageName = (alias) => `CASE WHEN ${alias}.state = 'pending' THEN (
  SELECT min(s ->> 'name') FROM workflow_definition wd, jsonb_array_elements(wd.stages) s
   WHERE wd.workflow_definition_id = ${alias}.workflow_definition_id AND s ->> 'key' = ${alias}.current_stage
) END`;

const ROWS = `
  SELECT er.expense_request_id, er.number, er.purpose, er.amount, er.currency,
         ${STATUS} AS status,
         ${stageName("wi")} AS request_stage, ${stageName("rwi")} AS requisition_stage,
         ec.name AS category, pr.name AS project,
         ${personJson("e", "d")} AS requester,
         er.payee_type, er.over_budget, er.submitted_at,
         er.employee_id, er.expense_category_id, er.project_id, er.department_id, rd.name AS department,
         er.payee_name, er.bank_name, er.account_name, er.account_number, er.uses_profile_account,
         CASE WHEN doc.document_id IS NULL THEN NULL ELSE json_build_object(
           'document_id', doc.document_id, 'file_name', COALESCE(doc.original_name, doc.title, 'invoice'),
           'size_bytes', doc.bytes, 'mime_type', doc.mime) END AS invoice,
         er.invoice_document_id, er.needed_on, er.requisition_id, r.number AS requisition_number,
         er.workflow_instance_id, wi.state AS approval_state, wi.opened_by AS approval_opened_by,
         er.budget_line_id,
         CASE WHEN bl.budget_line_id IS NULL THEN NULL
              ELSE (bl.amount - bl.committed_amount - bl.spent_amount)::numeric(18,2) END AS budget_remaining,
         er.approved_at, er.authorised_at, er.disbursed_at, er.rejected_at, er.cancelled_at, er.sent_back_at,
         er.created_at,
         search_fold(er.number || ' ' || er.purpose || ' ' || e.first_name || ' ' || e.last_name || ' ' || ec.name
                     || ' ' || COALESCE(er.payee_name, '')) AS haystack
    FROM expense_request er
    JOIN employee e ON e.employee_id = er.employee_id
    LEFT JOIN department d ON d.department_id = e.department_id
    LEFT JOIN department rd ON rd.department_id = er.department_id
    JOIN expense_category ec ON ec.expense_category_id = er.expense_category_id
    LEFT JOIN project pr ON pr.project_id = er.project_id
    LEFT JOIN document doc ON doc.document_id = er.invoice_document_id
    LEFT JOIN requisition r ON r.requisition_id = er.requisition_id
    LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = er.workflow_instance_id
    LEFT JOIN workflow_instance rwi ON rwi.workflow_instance_id = r.workflow_instance_id
    LEFT JOIN budget_line bl ON bl.budget_line_id = er.budget_line_id`;

/** Who a request waits on now, as the list's Stage reads it. */
const WAITING_ON = `CASE v.status
  WHEN 'submitted' THEN v.request_stage
  WHEN 'sent_back' THEN 'Requester'
  WHEN 'approved' THEN 'Operations & People'
  WHEN 'in_requisition' THEN COALESCE(v.requisition_stage, 'CEO')
  WHEN 'authorised' THEN 'Operations & People'
END`;

/** The keys of ExpenseRow. */
const ROW_OUT = `v.expense_request_id, v.number, v.purpose, v.amount, v.status, ${WAITING_ON} AS waiting_on,
  v.category, v.project, v.requester, v.payee_type, v.over_budget, v.submitted_at`;

/** ExpenseRow's keys and what ExpenseRequest adds, with what the service needs to decide. */
const FULL_OUT = `${ROW_OUT}, v.expense_category_id, v.project_id, v.department_id, v.department, v.currency,
  v.payee_name, v.bank_name, v.account_name, v.account_number, v.uses_profile_account, v.invoice,
  v.invoice_document_id, v.needed_on, v.requisition_id, v.requisition_number, v.workflow_instance_id,
  v.approval_state, v.approval_opened_by, v.budget_line_id, v.budget_remaining, v.approved_at,
  v.authorised_at, v.disbursed_at, v.rejected_at, v.cancelled_at, v.created_at, v.employee_id`;

/** The SQL for each field ExpenseListQuery allow-lists; the first is the default order. */
const SORTS = { submitted_at: "v.submitted_at", amount: "v.amount", number: "v.number", created_at: "v.created_at" };

/** The list's filters over v, appended to `params`, as one AND chain. */
function filters(query, params) {
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const parts = [];
  if (query.status) parts.push(`v.status = ${add(query.status)}`);
  if (query.statuses) parts.push(`v.status = ANY(${add(query.statuses)}::text[])`);
  if (query.expense_category_id) parts.push(`v.expense_category_id = ${add(query.expense_category_id)}::uuid`);
  if (query.project_id) parts.push(`v.project_id = ${add(query.project_id)}::uuid`);
  if (query.department_id) parts.push(`v.department_id = ${add(query.department_id)}::uuid`);
  if (query.payee_type) parts.push(`v.payee_type = ${add(query.payee_type)}`);
  if (query.over_budget !== undefined) parts.push(`v.over_budget = ${add(query.over_budget)}::boolean`);
  if (query.employee_id) parts.push(`v.employee_id = ${add(query.employee_id)}::uuid`);
  if (query.requisition_id) parts.push(`v.requisition_id = ${add(query.requisition_id)}::uuid`);
  if (query.ungrouped) parts.push("v.requisition_id IS NULL");
  // Somebody else's draft is theirs alone until it is sent.
  if (query.reader_employee_id !== undefined)
    parts.push(`(v.status <> 'draft' OR v.employee_id = ${add(query.reader_employee_id)}::uuid)`);
  if (query.q) parts.push(`v.haystack LIKE '%' || search_fold(${add(query.q)}) || '%'`);
  return parts.length ? `AND ${parts.join(" AND ")}` : "";
}

/**
 * One page of requests as list rows.
 * @param {{query: Function}} db
 * @param {object} query   ExpenseListQuery, plus the service's own: employee_id, statuses,
 *                         requisition_id, ungrouped, reader_employee_id
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
function list(db, query, scope) {
  const params = [];
  const where = filters(query, params);
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT ${ROW_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE true ${where} ${s.and}
      ORDER BY ${orderBy(query, SORTS, "v.expense_request_id")}`,
    params,
    query,
  );
}

/**
 * The requests whose approval waits on this person now (Expenses · Approvals), oldest sent first:
 * the stage names them, a role of theirs or their login; never their own (the engine's rule).
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id?: string|null, role_ids?: string[], is_ceo?: boolean}} user
 */
async function waitingOn(db, user, query) {
  const roleCodes = await approvers.roleCodesOf(db, user.role_ids || []);
  const params = [];
  const where = filters(query, params);
  const clause = approvers.waitingOnClause("wq", user, roleCodes, params);
  return pageQuery(
    db,
    `SELECT ${ROW_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
       JOIN workflow_instance wq ON wq.workflow_instance_id = v.workflow_instance_id
      WHERE wq.state = 'pending' AND wq.definition_key = 'expenses.request' AND v.status = 'submitted'
        AND ${clause} ${where}
      ORDER BY ${orderBy(query, SORTS, "v.expense_request_id")}`,
    params,
    query,
  );
}

/** The four figures above Expenses · Approvals, for this person. */
async function approvalsSummary(db, user, monthStart) {
  const roleCodes = await approvers.roleCodesOf(db, user.role_ids || []);
  const params = [];
  const clause = approvers.waitingOnClause("wq", user, roleCodes, params);
  params.push(user.user_id, monthStart);
  const n = params.length;
  const { rows } = await db.query(
    `SELECT
       (SELECT count(*)::int FROM expense_request er JOIN workflow_instance wq ON wq.workflow_instance_id = er.workflow_instance_id
         WHERE er.status = 'submitted' AND wq.state = 'pending' AND wq.definition_key = 'expenses.request' AND ${clause}) AS with_you,
       (SELECT COALESCE(sum(er.amount), 0)::numeric(18,2) FROM expense_request er JOIN workflow_instance wq ON wq.workflow_instance_id = er.workflow_instance_id
         WHERE er.status = 'submitted' AND wq.state = 'pending' AND wq.definition_key = 'expenses.request' AND ${clause}) AS total_value,
       (SELECT floor(extract(epoch FROM now() - min(wq.stage_entered_at)) / 86400)::int FROM expense_request er JOIN workflow_instance wq ON wq.workflow_instance_id = er.workflow_instance_id
         WHERE er.status = 'submitted' AND wq.state = 'pending' AND wq.definition_key = 'expenses.request' AND ${clause}) AS oldest_days,
       (SELECT count(DISTINCT dd.workflow_instance_id)::int FROM workflow_decision dd
          JOIN workflow_instance di ON di.workflow_instance_id = dd.workflow_instance_id
         WHERE di.definition_key = 'expenses.request' AND dd.decision = 'approve' AND dd.actor_id = $${n - 1}::uuid
           AND (dd.decided_at AT TIME ZONE 'Africa/Lagos')::date >= $${n}::date) AS approved_this_month`,
    params,
  );
  return rows[0];
}

/** The four figures above ESS · My Requests: this year in Lagos, the person's own. */
async function mineSummary(db, employeeId, yearStart) {
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE er.status IN ('submitted', 'sent_back', 'approved', 'in_requisition', 'authorised'))::int AS in_flight,
            COALESCE(sum(er.amount) FILTER (WHERE er.status = 'disbursed'
              AND (er.disbursed_at AT TIME ZONE 'Africa/Lagos')::date >= $2::date), 0)::numeric(18,2) AS disbursed_this_year,
            round(avg(extract(epoch FROM er.disbursed_at - er.submitted_at) / 86400) FILTER (WHERE er.status = 'disbursed'
              AND (er.disbursed_at AT TIME ZONE 'Africa/Lagos')::date >= $2::date)::numeric, 1)::float8 AS average_turnaround_days,
            count(*) FILTER (WHERE er.status = 'rejected'
              AND (er.rejected_at AT TIME ZONE 'Africa/Lagos')::date >= $2::date)::int AS rejected
       FROM expense_request er
      WHERE er.employee_id = $1`,
    [employeeId, yearStart],
  );
  return rows[0];
}

/** One request with what its modal and the service need, or null. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${FULL_OUT} FROM (${ROWS}) v WHERE v.expense_request_id = $1`, [id]);
  if (!rows[0]) return null;
  return { ...rows[0], lines: await lines(db, id) };
}

/** A request's lines, in order. At most 25 (the contract's limit), never a list a person pages. */
async function lines(db, id) {
  const { rows } = await db.query(
    `SELECT expense_request_line_id, position, description, quantity::text AS quantity, unit_price, amount
       FROM expense_request_line
      WHERE expense_request_id = $1
      ORDER BY position, expense_request_line_id`,
    [id],
  );
  return rows;
}

/** The stored row, locked for the transaction's change. */
async function lock(client, id) {
  const { rows } = await client.query("SELECT * FROM expense_request WHERE expense_request_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

/** Several stored rows, locked, in a fixed order so two transactions never wait on each other. */
async function lockMany(client, ids) {
  const { rows } = await client.query(
    "SELECT * FROM expense_request WHERE expense_request_id = ANY($1::uuid[]) ORDER BY expense_request_id FOR UPDATE",
    [ids],
  );
  return rows;
}

/** The request's own fields, as the service worked them out. */
const FIELDS = [
  "purpose",
  "expense_category_id",
  "project_id",
  "department_id",
  "needed_on",
  "amount",
  "payee_type",
  "uses_profile_account",
  "payee_name",
  "bank_name",
  "account_name",
  "account_number",
  "invoice_document_id",
];

async function insert(client, row) {
  const cols = ["number", "employee_id", "currency", "status", ...FIELDS];
  const values = cols.map((k) => (row[k] === undefined ? null : row[k]));
  const { rows } = await client.query(
    `INSERT INTO expense_request (${cols.join(", ")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
     RETURNING *`,
    values,
  );
  return rows[0];
}

/** Write every field FIELDS names (the form sends them all again). */
async function updateFields(client, id, row) {
  const sets = FIELDS.map((k, i) => `${k} = $${i + 2}`);
  const { rows } = await client.query(
    `UPDATE expense_request SET ${sets.join(", ")}, updated_at = now()
      WHERE expense_request_id = $1
      RETURNING *`,
    [id, ...FIELDS.map((k) => (row[k] === undefined ? null : row[k]))],
  );
  return rows[0];
}

/** Replace a request's lines with these, numbered from 1. */
async function replaceLines(client, id, items) {
  await client.query("DELETE FROM expense_request_line WHERE expense_request_id = $1", [id]);
  for (const [i, l] of items.entries()) {
    await client.query(
      `INSERT INTO expense_request_line (expense_request_id, position, description, quantity, unit_price, amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, i + 1, l.description, l.quantity, l.unit_price, l.amount],
    );
  }
}

/**
 * Move a request from one of `from` to `to`, setting the given columns; null when it was in none
 * of them (decided meanwhile), so a second copy of an outcome changes nothing.
 * @param {object} [set]  columns to set beside the status: { submitted_at: "now", ... }
 */
async function move(client, id, from, to, set = {}) {
  const params = [id, from, to];
  const extra = Object.entries(set).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`expenses.repo.move: ${k} is not a column`);
    if (v === "now") return `${k} = now()`;
    params.push(v);
    return `${k} = $${params.length}`;
  });
  const { rows } = await client.query(
    `UPDATE expense_request SET status = $3${extra.length ? `, ${extra.join(", ")}` : ""}, updated_at = now()
      WHERE expense_request_id = $1 AND status = ANY($2::text[])
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** The payee details sending fixes on a request, and its budget line and flag. */
async function setSending(client, id, s) {
  await client.query(
    `UPDATE expense_request
        SET payee_name = $2, bank_name = $3, account_name = $4, account_number = $5,
            budget_line_id = $6, over_budget = $7, workflow_instance_id = $8, updated_at = now()
      WHERE expense_request_id = $1`,
    [id, s.payee_name, s.bank_name, s.account_name, s.account_number, s.budget_line_id, s.over_budget, s.workflow_instance_id],
  );
}

/** The bank details on a person's employee record, and their names. */
async function employeeOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, e.department_id, e.status, btrim(e.first_name || ' ' || e.last_name) AS display_name,
            e.bank_name, e.account_number,
            EXISTS (SELECT 1 FROM employee_effective_manager m JOIN employee r ON r.employee_id = m.employee_id
                     WHERE m.manager_id = e.employee_id AND r.status = 'active') AS manages_people
       FROM employee e WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

async function departmentExists(db, id) {
  const { rows } = await db.query("SELECT 1 FROM department WHERE department_id = $1", [id]);
  return rows.length > 0;
}

/** A project a request may name: one that exists and is not archived. */
async function projectOf(db, id) {
  const { rows } = await db.query("SELECT project_id, status FROM project WHERE project_id = $1", [id]);
  return rows[0] || null;
}

/** Put locked, approved requests into a requisition. */
async function group(client, ids, requisitionId) {
  const { rows } = await client.query(
    `UPDATE expense_request SET status = 'in_requisition', requisition_id = $2, updated_at = now()
      WHERE expense_request_id = ANY($1::uuid[]) AND status = 'approved' AND requisition_id IS NULL
      RETURNING expense_request_id`,
    [ids, requisitionId],
  );
  return rows.length;
}

/**
 * Every request a requisition still holds moves on: `authorised` when the CEO approved it, back to
 * `approved` and out of it when the CEO rejected it.
 */
async function settleRequisition(client, requisitionId, outcome) {
  const sql =
    outcome === "authorised"
      ? `UPDATE expense_request SET status = 'authorised', authorised_at = now(), updated_at = now()
          WHERE requisition_id = $1 AND status = 'in_requisition' RETURNING expense_request_id, employee_id, number, amount`
      : `UPDATE expense_request SET status = 'approved', requisition_id = NULL, updated_at = now()
          WHERE requisition_id = $1 AND status = 'in_requisition' RETURNING expense_request_id, employee_id, number, amount`;
  const { rows } = await client.query(sql, [requisitionId]);
  return rows;
}

/** How many requests a requisition holds now, and their total. */
async function requisitionTotal(client, requisitionId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::numeric(18,2) AS total
       FROM expense_request WHERE requisition_id = $1 AND status = 'in_requisition'`,
    [requisitionId],
  );
  return rows[0];
}

async function projectName(db, id) {
  const { rows } = await db.query("SELECT name FROM project WHERE project_id = $1", [id]);
  return rows[0] ? rows[0].name : null;
}

async function departmentName(db, id) {
  const { rows } = await db.query("SELECT name FROM department WHERE department_id = $1", [id]);
  return rows[0] ? rows[0].name : null;
}

module.exports = {
  group,
  settleRequisition,
  requisitionTotal,
  projectName,
  departmentName,
  STATUS,
  list,
  waitingOn,
  approvalsSummary,
  mineSummary,
  get,
  lines,
  lock,
  lockMany,
  insert,
  updateFields,
  replaceLines,
  move,
  setSending,
  employeeOf,
  departmentExists,
  projectOf,
};
