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

module.exports = { list, get, lock, insert, addReference };
