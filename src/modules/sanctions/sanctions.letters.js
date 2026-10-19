"use strict";
/**
 * A sanction's letter (docs/guides/queries.md §6.7): generated from its rung's letter
 * template when the sanction is issued, in the same transaction, filed to the employee's
 * documents and emailed with the PDF once the worker has rendered it.
 */
const { pool } = require("../../config/db");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const templates = require("../templates/templates.service");
const { SANCTION_LETTER } = require("../templates/templates.events");
const repo = require("./sanctions.repo");

/** Who signs a sanction letter: the function that approved it. */
const SIGNER = Object.freeze({ name: "Operations & People", role: "Operations & People" });

async function employeeOf(db, employeeId) {
  const { rows } = await db.query(
    `SELECT e.employee_id, COALESCE(e.preferred_name, e.first_name) AS called,
            btrim(e.first_name || ' ' || e.last_name) AS display_name, e.job_title, d.name AS department,
            e.work_email::text AS work_email
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

/** Inclusive days of a sanction with an end (a suspension). */
function daysOf(row) {
  if (!row.ends_on) return null;
  return lagos.daysBetween(row.effective_on, row.ends_on) + 1;
}

/**
 * Generate the letter of a sanction being issued, on the caller's transaction.
 * @param {object} row  the sanction (repo.get), number set
 */
async function generate(client, row, number, actor) {
  const key = await templates.usable(client, row.letter_template, "sanction", { field: "consequence_step_id" });
  const person = await employeeOf(client, row.employee_id);
  const doc = await documents.generate(client, {
    doc_type: SANCTION_LETTER,
    template: key,
    entity: { type: "sanction", id: row.sanction_id },
    subject_employee_id: row.employee_id,
    data: {
      employee: {
        display_name: person.display_name,
        first_name: person.called,
        job_title: person.job_title,
        department: person.department,
      },
      query_number: row.query_number,
      subject: row.query_subject,
      details: row.query_details,
      reason: row.reason,
      step_name: row.step_name,
      raised_on: lagos.dateOf(row.query_raised_at),
      effective_on: row.effective_on,
      ends_on: row.ends_on,
      days: daysOf(row),
      fine_amount: row.fine_amount || null,
      signer: SIGNER,
    },
    actor,
  });
  await repo.insertLetter(client, { sanction_id: row.sanction_id, document_id: doc.document_id, letter_type: key });
  return { ...doc, number };
}

/** document.generated for a sanction letter: email it to the employee, with the PDF. */
async function emailLetter(documentId) {
  const doc = await vault.get(pool, documentId);
  if (!doc || doc.doc_type !== SANCTION_LETTER || doc.entity_type !== "sanction") return;
  const row = await repo.get(pool, doc.entity_id);
  if (!row || row.status !== "issued" || row.letter_document_id !== documentId) return;
  const person = await employeeOf(pool, row.employee_id);
  if (!person || !person.work_email) return;
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    "sanction-issued",
    {
      to: { name: person.display_name, email: person.work_email },
      recipient: { first_name: person.called, last_name: null, email: person.work_email },
      template: "sanction-issued",
      data: { sanction_number: row.number, step_name: row.step_name, query_number: row.query_number },
      attachments: [{ document_id: documentId }],
    },
    { jobId: `sanction-letter-${documentId}` },
  );
}

module.exports = { generate, emailLetter, daysOf };
