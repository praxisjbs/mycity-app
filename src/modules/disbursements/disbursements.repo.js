"use strict";
/**
 * Disbursements: the SQL. Reads the transfers with their request, payee, reference and receipt;
 * writes only `disbursement`. The request it pays is moved by the expenses module
 * (expenses.service). Never emits (BACKEND_GUIDE §2).
 *
 * A null payment_reference is Reference Missing (decision 2 of 04/11/2026): nothing in the
 * database refuses it, and Add Reference fills it.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const expensesRepo = require("../expenses/expenses.repo");

const ROWS = `
  SELECT ds.disbursement_id, ds.number, ds.expense_request_id, er.number AS request_number, er.purpose,
         ds.recipient_type, ds.recipient_name, ds.bank_name, ds.account_name, ds.account_number, ds.amount,
         ds.payment_reference, (ds.payment_reference IS NULL) AS reference_missing,
         CASE WHEN doc.document_id IS NULL THEN NULL ELSE json_build_object(
           'document_id', doc.document_id, 'file_name', COALESCE(doc.original_name, doc.title, 'receipt'),
           'size_bytes', doc.bytes, 'mime_type', doc.mime) END AS receipt,
         ds.paid_on, ds.paid_at,
         NULLIF(btrim(COALESCE(pe.first_name, '') || ' ' || COALESCE(pe.last_name, '')), '') AS processed_by,
         er.employee_id, ds.receipt_document_id,
         search_fold(ds.number || ' ' || er.number || ' ' || er.purpose || ' ' || ds.recipient_name || ' ' || COALESCE(ds.payment_reference, '')) AS haystack
    FROM disbursement ds
    JOIN expense_request er ON er.expense_request_id = ds.expense_request_id
    LEFT JOIN document doc ON doc.document_id = ds.receipt_document_id
    LEFT JOIN app_user pu ON pu.user_id = ds.processed_by
    LEFT JOIN employee pe ON pe.employee_id = pu.employee_id`;

const OUT = `v.disbursement_id, v.number, v.expense_request_id, v.request_number, v.purpose, v.recipient_type,
  v.recipient_name, v.bank_name, v.account_name, v.account_number, v.amount, v.payment_reference,
  v.reference_missing, v.receipt, v.paid_on, v.paid_at, v.processed_by`;

const SORTS = { paid_at: "v.paid_at", amount: "v.amount", number: "v.number" };

/** One page of disbursements within the reader's scope (on the request's requester), newest first unless sorted. */
function list(db, query, scope) {
  const params = [query.reference_missing === undefined ? null : query.reference_missing, query.q || null];
  const s = scopeClause(scope, { column: "v.employee_id" }, params);
  const q = query.sort ? query : { ...query, sort: { field: "paid_at", dir: "desc" } };
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::boolean IS NULL OR v.reference_missing = $1)
        AND ($2::text IS NULL OR v.haystack LIKE '%' || search_fold($2) || '%')
        ${s.and}
      ORDER BY ${orderBy(q, SORTS, "v.disbursement_id")}`,
    params,
    q,
  );
}

/** The groupings the assistant's disbursements summary offers: the SQL of each row's key and words. */
const SUMMARY_DIMS = Object.freeze({
  category: { key: "d.expense_category_id::text", label: "d.category" },
  department: { key: "COALESCE(d.department_id::text, 'none')", label: "COALESCE(d.department, 'No department')" },
  payee_type: { key: "d.payee_type", label: "d.payee_type" },
});

/** A series' bucket: a day, the Monday of a week, or a month. */
const BUCKETS = Object.freeze({
  day: "d.paid_day::text",
  week: "to_char(date_trunc('week', d.paid_day), 'YYYY-MM-DD')",
  month: "to_char(d.paid_day, 'YYYY-MM')",
});

/**
 * The assistant's disbursements summary (docs/guides/praxis-ai.md §6.13, Finance and pay) in one
 * statement, within the reader's scope on the request's requester as list() applies it: the transfers
 * paid within the period (the day paid), with or without a reference if asked; their figures, by
 * `dim`, and amount paid by `bucket`; and the requests authorised and not yet paid, whenever authorised
 * (the status worked out with the CEO's approval, as the requests list does). Groups cut to 20 and the
 * series to its newest 60 buckets by row_number(). Figures, never a row.
 * @param {{query: Function}} db
 * @param {{reference_missing?: boolean, from: string, to: string, dim: string, bucket: string}} q
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
async function aiSummary(db, q, scope) {
  const dim = SUMMARY_DIMS[q.dim] || SUMMARY_DIMS.category;
  const bucket = BUCKETS[q.bucket] || BUCKETS.month;
  const params = [q.reference_missing === undefined ? null : q.reference_missing, q.from, q.to];
  const s = scopeClause(scope, { column: "er.employee_id" }, params);
  const { rows } = await db.query(
    `WITH d AS (
       SELECT ds.disbursement_id, ds.amount, (ds.payment_reference IS NULL) AS reference_missing,
              COALESCE(ds.paid_on, (ds.paid_at AT TIME ZONE 'Africa/Lagos')::date) AS paid_day,
              extract(epoch FROM ds.paid_at - er.authorised_at) / 86400 AS days_to_pay,
              er.expense_category_id, ec.name AS category, er.department_id, rd.name AS department, er.payee_type
         FROM disbursement ds
         JOIN expense_request er ON er.expense_request_id = ds.expense_request_id
         JOIN expense_category ec ON ec.expense_category_id = er.expense_category_id
         LEFT JOIN department rd ON rd.department_id = er.department_id
        WHERE COALESCE(ds.paid_on, (ds.paid_at AT TIME ZONE 'Africa/Lagos')::date) BETWEEN $2::date AND $3::date
          AND ($1::boolean IS NULL OR (ds.payment_reference IS NULL) = $1)
          ${s.and}
     ), waiting AS (
       SELECT count(*)::int AS n, COALESCE(sum(er.amount), 0)::numeric(18,2) AS amount
         FROM expense_request er
         LEFT JOIN requisition r ON r.requisition_id = er.requisition_id
         LEFT JOIN workflow_instance wi ON wi.workflow_instance_id = er.workflow_instance_id
         LEFT JOIN workflow_instance rwi ON rwi.workflow_instance_id = r.workflow_instance_id
        WHERE er.status IN ('in_requisition', 'authorised') AND ${expensesRepo.STATUS} = 'authorised'
          ${s.and}
     ), by_dim AS (
       SELECT ${dim.key} AS key, min(${dim.label}) AS label, count(*)::int AS n, sum(d.amount)::numeric(18,2) AS amount,
              row_number() OVER (ORDER BY sum(d.amount) DESC, count(*) DESC, min(${dim.label}), ${dim.key}) AS rank
         FROM d GROUP BY ${dim.key}
     ), points AS (
       SELECT ${bucket} AS at, sum(d.amount)::numeric(18,2) AS value,
              row_number() OVER (ORDER BY ${bucket} DESC) AS newest
         FROM d GROUP BY ${bucket}
     )
     SELECT (SELECT json_build_object(
               'payments', count(*)::int,
               'paid', COALESCE(sum(amount), 0)::numeric(18,2),
               'reference_missing', count(*) FILTER (WHERE reference_missing)::int,
               'average_days', round(avg(days_to_pay)::numeric, 1)) FROM d) AS figures,
            (SELECT row_to_json(w) FROM waiting w) AS waiting,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', amount, 'count', n) ORDER BY rank)
               FROM by_dim WHERE rank <= 20) AS by_dim,
            (SELECT json_agg(json_build_object('at', at, 'value', value) ORDER BY at) FROM points WHERE newest <= 60) AS points`,
    params,
  );
  const row = rows[0] || {};
  return { figures: row.figures || {}, waiting: row.waiting || {}, by_dim: row.by_dim || [], points: row.points || [] };
}

/** One disbursement, with the requester's id for scope and the mask, or null. */
async function get(db, id) {
  const { rows } = await db.query(`SELECT ${OUT}, v.employee_id, v.receipt_document_id FROM (${ROWS}) v WHERE v.disbursement_id = $1`, [id]);
  return rows[0] || null;
}

async function lock(client, id) {
  const { rows } = await client.query("SELECT * FROM disbursement WHERE disbursement_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO disbursement (number, expense_request_id, requisition_id, recipient_type, recipient_name, bank_name,
                               account_name, account_number, amount, currency, status, payment_reference,
                               receipt_document_id, paid_on, paid_at, processed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'NGN', 'paid', $10, $11, $12, now(), $13)
     RETURNING *`,
    [
      row.number,
      row.expense_request_id,
      row.requisition_id,
      row.recipient_type,
      row.recipient_name,
      row.bank_name,
      row.account_name,
      row.account_number,
      row.amount,
      row.payment_reference,
      row.receipt_document_id,
      row.paid_on,
      row.processed_by,
    ],
  );
  return rows[0];
}

/** Add Reference: only while it is missing; null when somebody added one meanwhile. */
async function addReference(client, id, reference, receiptId) {
  const { rows } = await client.query(
    `UPDATE disbursement SET payment_reference = $2, receipt_document_id = COALESCE($3, receipt_document_id), updated_at = now()
      WHERE disbursement_id = $1 AND payment_reference IS NULL
      RETURNING *`,
    [id, reference, receiptId || null],
  );
  return rows[0] || null;
}

/** At most this many requests a receipt is offered against: the answers to tap under one question. */
const MATCHES_SHOWN = 6;

/**
 * The requests a payment receipt attached on Praxis AI may have paid (praxis-ai.md §6.18, decision
 * 46), in the reader's scope: of `statuses`, for the receipt's amount, whose account number equals the
 * beneficiary's, or (when none does) whose payee's name equals it, case and accents set aside. A paid
 * one carries its disbursement's number.
 * @param {{query: Function}} db
 * @param {{account_number: string|null, beneficiary_name: string|null, amount: string}} receipt
 * @param {{scope: string, scope_ids: string[]|null}} scope
 * @param {string[]} statuses
 */
async function requestsPaidBy(db, receipt, scope, statuses) {
  const run = async (by) => {
    const params = [statuses, receipt.amount, by === "account" ? receipt.account_number : receipt.beneficiary_name];
    const s = scopeClause(scope, { column: "er.employee_id" }, params);
    const match = by === "account" ? "er.account_number = $3::text" : "er.payee_name IS NOT NULL AND search_fold(er.payee_name) = search_fold($3::text)";
    const { rows } = await db.query(
      `SELECT er.expense_request_id, er.number, er.purpose, er.status, d.number AS disbursement_number, d.paid_on
         FROM expense_request er
         LEFT JOIN disbursement d ON d.expense_request_id = er.expense_request_id
        WHERE er.status = ANY($1::text[]) AND er.amount = $2::numeric AND ${match} ${s.and}
        ORDER BY er.submitted_at DESC NULLS LAST, er.expense_request_id
        LIMIT ${MATCHES_SHOWN} -- pagination:batch the few requests one receipt is offered against`,
      params,
    );
    return rows;
  };
  if (receipt.account_number) {
    const byAccount = await run("account");
    if (byAccount.length) return byAccount;
  }
  return receipt.beneficiary_name ? run("name") : [];
}

module.exports = {
  requestsPaidBy, list, aiSummary, get, lock, insert, addReference };
