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
         dr.remaining AS department_remaining,
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
    LEFT JOIN budget_line bl ON bl.budget_line_id = er.budget_line_id
    LEFT JOIN LATERAL (
      SELECT sum(x.amount - x.committed_amount - x.spent_amount)::numeric(18,2) AS remaining
        FROM budget b2 JOIN budget_line x ON x.budget_id = b2.budget_id
       WHERE b2.department_id = er.department_id AND b2.status <> 'closed'
         AND (COALESCE(er.submitted_at, now()) AT TIME ZONE 'Africa/Lagos')::date BETWEEN b2.starts_on AND b2.ends_on
    ) dr ON true`;

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
  v.approval_state, v.approval_opened_by, v.budget_line_id, v.budget_remaining, v.department_remaining, v.approved_at,
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
  if (query.in_flight !== undefined)
    parts.push(`(v.status = ANY(ARRAY['submitted', 'sent_back', 'approved', 'in_requisition', 'authorised'])) = ${add(query.in_flight)}::boolean`);
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
  if (query.disbursed_from)
    parts.push(`v.status = 'disbursed' AND (v.disbursed_at AT TIME ZONE 'Africa/Lagos')::date >= ${add(query.disbursed_from)}::date`);
  if (query.approved_by_me_from)
    parts.push(`EXISTS (SELECT 1 FROM workflow_decision dd JOIN workflow_instance di ON di.workflow_instance_id = dd.workflow_instance_id
                 WHERE di.definition_key = 'expenses.request' AND di.entity_id = v.expense_request_id::text AND dd.decision = 'approve'
                   AND dd.actor_id = ${add(query.reader_user_id || null)}::uuid
                   AND (dd.decided_at AT TIME ZONE 'Africa/Lagos')::date >= ${add(query.approved_by_me_from)}::date)`);
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

/** The groupings the assistant's requests summary offers beside its status: the SQL of each row's key and words. */
const SUMMARY_DIMS = Object.freeze({
  category: { key: "x.expense_category_id::text", label: "x.category" },
  department: { key: "COALESCE(x.department_id::text, 'none')", label: "COALESCE(x.department, 'No department')" },
  project: { key: "COALESCE(x.project_id::text, 'none')", label: "COALESCE(x.project, 'No project')" },
  payee_type: { key: "x.payee_type", label: "x.payee_type" },
});

/**
 * The assistant's requests summary (docs/guides/praxis-ai.md §6.13, Finance and pay) in one statement:
 * the requests of the reader's audience (their own with `mine`; those whose approval's stage names them
 * now with `waiting_on_me`, as waitingOn() reads them; otherwise those within their scope, somebody
 * else's draft left out, as list() does), sent within the period (a draft by the day it was made), with
 * the list's filters. The figures, the requests by status, by `dim` with what is paid, approved and
 * waiting, the top ten requesters, and asked and paid by month. Groups cut to 20 by row_number().
 * Figures, never a row.
 * @param {{query: Function}} db
 * @param {object} q  ExpenseSummaryQuery with `dim`, and the period the service worked out (`from` and `to`, or neither)
 * @param {{user_id: string, employee_id?: string|null, role_ids?: string[], is_ceo?: boolean}} user
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function aiSummary(db, q, user, scope) {
  const dim = SUMMARY_DIMS[q.dim] || SUMMARY_DIMS.category;
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  let audience;
  if (q.mine) audience = `AND er.employee_id = ${add(user.employee_id || null)}::uuid`;
  else if (q.waiting_on_me) {
    const roleCodes = await approvers.roleCodesOf(db, user.role_ids || []);
    const clause = approvers.waitingOnClause("wi", user, roleCodes, params);
    audience = `AND er.status = 'submitted' AND wi.state = 'pending' AND wi.definition_key = 'expenses.request' AND ${clause}`;
  } else {
    const s = scopeClause(scope, { column: "er.employee_id" }, params);
    audience = `AND (er.status <> 'draft' OR er.employee_id = ${add(user.employee_id || null)}::uuid) ${s.and}`;
  }
  const period = q.from
    ? `AND (COALESCE(er.submitted_at, er.created_at) AT TIME ZONE 'Africa/Lagos')::date BETWEEN ${add(q.from)}::date AND ${add(q.to)}::date`
    : "";
  const where = [];
  if (q.status) where.push(`x.status = ${add(q.status)}`);
  if (q.expense_category_id) where.push(`x.expense_category_id = ${add(q.expense_category_id)}::uuid`);
  if (q.project_id) where.push(`x.project_id = ${add(q.project_id)}::uuid`);
  if (q.department_id) where.push(`x.department_id = ${add(q.department_id)}::uuid`);
  if (q.payee_type) where.push(`x.payee_type = ${add(q.payee_type)}`);
  if (q.over_budget !== undefined) where.push(`x.over_budget = ${add(q.over_budget)}::boolean`);
  const { rows } = await db.query(
    `WITH x AS (
       SELECT er.expense_request_id, er.employee_id, er.amount, ${STATUS} AS status,
              er.expense_category_id, ec.name AS category, er.project_id, pr.name AS project,
              er.department_id, rd.name AS department, er.payee_type, er.over_budget,
              er.submitted_at, er.disbursed_at, COALESCE(wi.stage_entered_at, er.submitted_at) AS waiting_since,
              btrim(e.first_name || ' ' || e.last_name) AS requester
         FROM expense_request er
         JOIN employee e ON e.employee_id = er.employee_id
         JOIN expense_category ec ON ec.expense_category_id = er.expense_category_id
         LEFT JOIN project pr ON pr.project_id = er.project_id
         LEFT JOIN department rd ON rd.department_id = er.department_id
         LEFT JOIN requisition r ON r.requisition_id = er.requisition_id
         LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = er.workflow_instance_id
         LEFT JOIN workflow_instance rwi ON rwi.workflow_instance_id = r.workflow_instance_id
        WHERE true ${audience} ${period}
     ), f AS (
       SELECT x.* FROM x WHERE true ${where.length ? `AND ${where.join(" AND ")}` : ""}
     ), figures AS (
       SELECT count(*)::int AS requests,
              COALESCE(sum(amount) FILTER (WHERE status NOT IN ('draft', 'cancelled')), 0)::numeric(18,2) AS asked,
              COALESCE(sum(amount) FILTER (WHERE status IN ('approved', 'in_requisition', 'authorised')), 0)::numeric(18,2) AS approved,
              COALESCE(sum(amount) FILTER (WHERE status = 'disbursed'), 0)::numeric(18,2) AS paid,
              count(*) FILTER (WHERE status = 'submitted')::int AS waiting,
              COALESCE(sum(amount) FILTER (WHERE status = 'submitted'), 0)::numeric(18,2) AS waiting_amount,
              count(*) FILTER (WHERE status = 'sent_back')::int AS sent_back,
              count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
              count(*) FILTER (WHERE over_budget AND status NOT IN ('draft', 'cancelled', 'rejected'))::int AS over_budget,
              floor(extract(epoch FROM now() - min(waiting_since) FILTER (WHERE status = 'submitted')) / 86400)::int AS oldest_waiting_days
         FROM f
     ), by_dim AS (
       SELECT ${dim.key} AS key, min(${dim.label}) AS label, count(*)::int AS n,
              COALESCE(sum(x.amount) FILTER (WHERE x.status = 'disbursed'), 0)::numeric(18,2) AS paid,
              COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('approved', 'in_requisition', 'authorised')), 0)::numeric(18,2) AS approved,
              COALESCE(sum(x.amount) FILTER (WHERE x.status IN ('submitted', 'sent_back')), 0)::numeric(18,2) AS waiting,
              row_number() OVER (ORDER BY COALESCE(sum(x.amount) FILTER (WHERE x.status NOT IN ('draft', 'cancelled', 'rejected')), 0) DESC,
                                          count(*) DESC, min(${dim.label}), ${dim.key}) AS rank
         FROM f x GROUP BY ${dim.key}
     ), requesters AS (
       SELECT employee_id::text AS key, min(requester) AS label, count(*)::int AS n,
              COALESCE(sum(amount) FILTER (WHERE status NOT IN ('draft', 'cancelled')), 0)::numeric(18,2) AS asked,
              row_number() OVER (ORDER BY COALESCE(sum(amount) FILTER (WHERE status NOT IN ('draft', 'cancelled')), 0) DESC,
                                          count(*) DESC, min(requester), employee_id) AS rank
         FROM f GROUP BY employee_id
     )
     SELECT (SELECT row_to_json(t) FROM figures t) AS figures,
            (SELECT json_agg(json_build_object('key', status, 'value', amount, 'count', n) ORDER BY n DESC, status)
               FROM (SELECT status, count(*)::int AS n, COALESCE(sum(amount), 0)::numeric(18,2) AS amount FROM f GROUP BY status) s) AS by_status,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'count', n, 'paid', paid, 'approved', approved, 'waiting', waiting) ORDER BY rank)
               FROM by_dim WHERE rank <= 20) AS by_dim,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', asked, 'count', n) ORDER BY rank)
               FROM requesters WHERE rank <= 10) AS requesters,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at)
               FROM (SELECT to_char(submitted_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, sum(amount)::numeric(18,2) AS value
                       FROM f WHERE submitted_at IS NOT NULL AND status NOT IN ('draft', 'cancelled') GROUP BY 1) a) AS asked,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at)
               FROM (SELECT to_char(disbursed_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, sum(amount)::numeric(18,2) AS value
                       FROM f WHERE status = 'disbursed' AND disbursed_at IS NOT NULL GROUP BY 1) p) AS paid`,
    params,
  );
  const row = rows[0] || {};
  return {
    figures: row.figures || {},
    by_status: row.by_status || [],
    by_dim: row.by_dim || [],
    requesters: row.requesters || [],
    asked: row.asked || [],
    paid: row.paid || [],
  };
}

/** One request with what its modal and the service need, or null. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${FULL_OUT} FROM (${ROWS}) v WHERE v.expense_request_id = $1`, [id]);
  if (!rows[0]) return null;
  return { ...rows[0], lines: await lines(db, id), possible_duplicates: await duplicatesOf(db, id) };
}

/**
 * One page of a request's history, newest first: what was done to the request itself (raised,
 * sent, each decision of its approval, sent back, cancelled, withdrawn), and what was done to its
 * requisition or its disbursement that names it (grouped, removed by the CEO, authorised or
 * rejected, paid, reference added). Audit F3: a removal is an event on the requisition, so the
 * history reads the event's own payload too.
 */
function historyOf(db, id, query) {
  return pageQuery(
    db,
    `SELECT a.occurred_at AS at, a.action, a.actor_name AS by, NULLIF(btrim(ev.payload ->> 'reason'), '') AS reason, ${TOTAL_COL}
       FROM audit_ledger a
       JOIN event_log ev ON ev.event_id = a.event_id
      WHERE (a.entity_type = 'expense' AND a.entity_id = $1)
         OR (a.entity_type IN ('requisition', 'disbursement')
             AND (ev.payload ->> 'expense_request_id' = $1 OR COALESCE(ev.payload -> 'expense_request_ids', '[]'::jsonb) ? $1))
      ORDER BY a.occurred_at DESC, a.event_id`,
    [id],
    query,
  );
}

/** STATUS for the other request `o`, its approval `owi` and its requisition's `orwi`. */
const OTHER_STATUS = STATUS.replace(/\brwi\./g, "orwi.").replace(/\bwi\./g, "owi.").replace(/\ber\./g, "o.");

/** How many possible duplicates a request shows: a warning, never a list a person pages. */
const DUPLICATES_SHOWN = 5;

/**
 * Other requests sent within 30 days either side of this one, to the same payee (the same account
 * number, or the same payee name with case and accents set aside) for the same amount (guide §6.8).
 * A draft has none; a cancelled or rejected one is still shown, as a request sent again.
 */
async function duplicatesOf(db, id) {
  const { rows } = await db.query(
    `SELECT o.expense_request_id, o.number, o.purpose, o.amount, ${OTHER_STATUS} AS status, o.submitted_at,
            o.employee_id, o.workflow_instance_id, owi.state AS approval_state
       FROM expense_request er
       JOIN expense_request o ON o.expense_request_id <> er.expense_request_id AND o.amount = er.amount
            AND o.submitted_at IS NOT NULL
            AND o.submitted_at BETWEEN COALESCE(er.submitted_at, now()) - interval '30 days' AND COALESCE(er.submitted_at, now()) + interval '30 days'
            AND ((o.account_number IS NOT NULL AND o.account_number = er.account_number)
                 OR (o.payee_name IS NOT NULL AND search_fold(o.payee_name) = search_fold(er.payee_name)))
       LEFT JOIN workflow_instance owi ON owi.workflow_instance_id = o.workflow_instance_id
       LEFT JOIN requisition orq ON orq.requisition_id = o.requisition_id
       LEFT JOIN workflow_instance orwi ON orwi.workflow_instance_id = orq.workflow_instance_id
      WHERE er.expense_request_id = $1 AND er.status <> 'draft'
      ORDER BY o.submitted_at DESC, o.expense_request_id
      LIMIT ${DUPLICATES_SHOWN} -- pagination:batch the few possible duplicates a request's modal warns of`,
    [id],
  );
  return rows;
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

/**
 * Over Budget worked out again for the requests still deciding on these lines (status
 * `submitted`), against each line as it stands now, so the flag the approvers see is never older
 * than the line's own figures (guide §6.6 rule 3). A request already approved counts in the line's
 * committed and keeps the flag it was decided with.
 */
async function refreshOverBudget(client, lineIds) {
  const ids = [...new Set((lineIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  const { rowCount } = await client.query(
    `UPDATE expense_request er
        SET over_budget = er.amount > (bl.amount - bl.committed_amount - bl.spent_amount), updated_at = now()
       FROM budget_line bl
      WHERE bl.budget_line_id = er.budget_line_id AND er.budget_line_id = ANY($1::uuid[])
        AND er.status = 'submitted'
        AND er.over_budget IS DISTINCT FROM (er.amount > (bl.amount - bl.committed_amount - bl.spent_amount))`,
    [ids],
  );
  return rowCount;
}

/**
 * A budget set after requests were sent: each sent request of its department, in its year and in
 * a category it now has a line for, counts against that line. Answers the lines that gained one.
 */
/** A budget line taken away: the requests that named it and no longer count let go of it. */
async function detachLine(client, lineId) {
  await client.query("UPDATE expense_request SET budget_line_id = NULL, updated_at = now() WHERE budget_line_id = $1", [lineId]);
}

async function attachToBudget(client, budgetId) {
  const { rows } = await client.query(
    `UPDATE expense_request er
        SET budget_line_id = bl.budget_line_id, updated_at = now()
       FROM budget_line bl JOIN budget b ON b.budget_id = bl.budget_id
      WHERE b.budget_id = $1 AND er.budget_line_id IS NULL AND er.status <> 'draft'
        AND er.department_id = b.department_id AND er.expense_category_id = bl.expense_category_id
        AND er.submitted_at IS NOT NULL
        AND (er.submitted_at AT TIME ZONE 'Africa/Lagos')::date BETWEEN b.starts_on AND b.ends_on
      RETURNING er.budget_line_id`,
    [budgetId],
  );
  return [...new Set(rows.map((r) => r.budget_line_id))];
}

async function projectName(db, id) {
  const { rows } = await db.query("SELECT name FROM project WHERE project_id = $1", [id]);
  return rows[0] ? rows[0].name : null;
}

/**
 * One page of the banks New Request suggests: `common` (the service's list) and every bank a request
 * has named, one row a name whatever its case, most used first. `q` narrows by what the name
 * contains. Only the bank's name is read, never an account, and no request is named.
 * @param {object} query  ExpenseBankListQuery
 * @param {string[]} common  the common banks, offered before any request names them
 */
function banks(db, query, common) {
  return pageQuery(
    db,
    // A common bank keeps its own spelling ("GTBank", not a request's "gtbank"); any other name
    // reads as its first spelling byte by byte, so the answer never turns on the database's collation.
    `SELECT (array_agg(b.name ORDER BY b.common DESC, b.name COLLATE "C"))[1] AS bank_name, sum(b.used)::int AS uses, ${TOTAL_COL}
       FROM (SELECT btrim(n) AS name, 0 AS used, true AS common FROM unnest($2::text[]) n
             UNION ALL SELECT btrim(bank_name), 1, false FROM expense_request WHERE bank_name IS NOT NULL) b
      WHERE b.name <> ''
        AND ($1::text IS NULL OR strpos(search_fold(b.name), search_fold($1)) > 0)
      GROUP BY lower(b.name)
      ORDER BY sum(b.used) DESC, lower(b.name) COLLATE "C"`,
    [query.q || null, common],
    query,
  );
}

/**
 * Requests sent within 30 days of now to a payee (the same account number, or the same name with case
 * and accents set aside) for an amount: what an invoice attached on Praxis AI might repeat
 * (praxis-ai.md §6.18; guide §6.8). The service names only those the reader may open.
 */
async function duplicatesFor(db, { account_number: accountNumber, payee_name: payeeName, amount }) {
  const { rows } = await db.query(
    `SELECT o.expense_request_id, o.number, o.purpose, o.amount, ${OTHER_STATUS} AS status, o.submitted_at,
            o.employee_id, o.workflow_instance_id, owi.state AS approval_state
       FROM expense_request o
       LEFT JOIN workflow_instance owi ON owi.workflow_instance_id = o.workflow_instance_id
       LEFT JOIN requisition orq ON orq.requisition_id = o.requisition_id
       LEFT JOIN workflow_instance orwi ON orwi.workflow_instance_id = orq.workflow_instance_id
      WHERE o.amount = $3::numeric AND o.submitted_at >= now() - interval '30 days'
        AND (($1::text IS NOT NULL AND o.account_number = $1::text)
             OR ($2::text IS NOT NULL AND o.payee_name IS NOT NULL AND search_fold(o.payee_name) = search_fold($2::text)))
      ORDER BY o.submitted_at DESC, o.expense_request_id
      LIMIT ${DUPLICATES_SHOWN} -- pagination:batch the few possible duplicates an attached invoice warns of`,
    [accountNumber || null, payeeName || null, amount],
  );
  return rows;
}

/** A running project by its name, case and accents set aside: one, or null when none or several match. */
async function projectIdByName(db, name) {
  const { rows } = await db.query(
    `SELECT project_id FROM project
      WHERE status NOT IN ('archived', 'cancelled') AND search_fold(name) = search_fold($1::text)
      ORDER BY project_id
      LIMIT 2 -- pagination:batch one match, or a second to say the name is not one project's`,
    [name],
  );
  return rows.length === 1 ? rows[0].project_id : null;
}

async function departmentName(db, id) {
  const { rows } = await db.query("SELECT name FROM department WHERE department_id = $1", [id]);
  return rows[0] ? rows[0].name : null;
}

module.exports = {
  banks,
  historyOf,
  duplicatesOf,
  duplicatesFor,
  projectIdByName,
  refreshOverBudget,
  attachToBudget,
  detachLine,
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
  aiSummary,
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
