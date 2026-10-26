"use strict";
/**
 * A sanction's letter (docs/guides/queries.md §6.7): generated from its rung's letter
 * template when the sanction is issued, in the same transaction, filed to the employee's
 * documents and emailed with the PDF once the worker has rendered it.
 *
 * A sanction with a fine has a second letter, the Salary Deduction letter (§6.6), generated
 * beside the first from the same facts. Both leave in one email, sent when the last of the
 * two PDFs is rendered.
 */
const { pool } = require("../../config/db");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const storage = require("../../services/storage/storage.service");
const templates = require("../templates/templates.service");
const {
  SANCTION_LETTER,
  FINE_LETTER_KEY,
} = require("../templates/templates.events");
const repo = require("./sanctions.repo");

/** Who signs a sanction letter without a drawn signature on it (one proposed before 3020). */
const SIGNER = Object.freeze({
  name: "Operations & People",
  role: "Operations & People",
});

/**
 * The person who proposed the sanction signs its letters (guide §6.4): their name, job title
 * and the signature they drew, read back from the vault.
 */
async function signerOf(db, row) {
  if (!row.signature_document_id) return SIGNER;
  const doc = await vault.get(db, row.signature_document_id);
  const bytes = doc ? await storage.get(doc.storage_key).catch(() => null) : null;
  return {
    name: row.decided_by_name || SIGNER.name,
    role: row.decided_by_title || SIGNER.role,
    signature: bytes ? `data:image/png;base64,${bytes.toString("base64")}` : null,
  };
}

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
  const key = await templates.usable(client, row.letter_template, "sanction", {
    field: "consequence_step_id",
  });
  const fineKey = row.fine_amount
    ? await templates.usable(client, FINE_LETTER_KEY, "fine", {
        field: "fine_amount",
      })
    : null;
  const person = await employeeOf(client, row.employee_id);
  // The policy the query cited, quoted again (queries guide §6.2), named by the policies service.
  const cited = row.query_policy_version_id
    ? await require("../policies/policies.service").citationOfVersion(client, row.query_policy_version_id)
    : null;
  const data = {
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
    policy: cited
      ? { number: cited.number, title: cited.title, version: cited.version, clause: row.query_policy_clause || null }
      : null,
    signer: await signerOf(client, row),
  };
  const letter = (template) =>
    documents.generate(client, {
      doc_type: SANCTION_LETTER,
      template,
      entity: { type: "sanction", id: row.sanction_id },
      subject_employee_id: row.employee_id,
      data,
      actor,
    });
  const doc = await letter(key);
  await repo.insertLetter(client, {
    sanction_id: row.sanction_id,
    document_id: doc.document_id,
    letter_type: key,
  });
  if (fineKey) {
    const fine = await letter(fineKey);
    await repo.insertLetter(client, {
      sanction_id: row.sanction_id,
      document_id: fine.document_id,
      letter_type: fineKey,
    });
  }
  return { ...doc, number };
}

/**
 * document.generated for a sanction letter: email the employee once every letter of the
 * sanction is rendered, all of them attached (the rung's, and the deduction letter).
 */
async function emailLetter(documentId) {
  const doc = await vault.get(pool, documentId);
  if (
    !doc ||
    doc.doc_type !== SANCTION_LETTER ||
    doc.entity_type !== "sanction"
  )
    return;
  const row = await repo.get(pool, doc.entity_id);
  if (!row || row.status !== "issued") return;
  const ids = [row.letter_document_id, row.fine_letter_document_id].filter(
    Boolean,
  );
  if (!ids.includes(documentId)) return;
  for (const id of ids) {
    const other = id === documentId ? doc : await vault.get(pool, id);
    if (!other || other.render_status !== "done") return;
  }
  const person = await employeeOf(pool, row.employee_id);
  if (!person || !person.work_email) return;
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    "sanction-issued",
    {
      to: { name: person.display_name, email: person.work_email },
      recipient: {
        first_name: person.called,
        last_name: null,
        email: person.work_email,
      },
      template: "sanction-issued",
      data: {
        sanction_number: row.number,
        step_name: row.step_name,
        query_number: row.query_number,
        fine_amount: row.fine_amount || null,
      },
      attachments: ids.map((id) => ({ document_id: id })),
    },
    // One email a sanction, whichever of its letters is rendered last.
    { jobId: `sanction-letter-${row.sanction_id}` },
  );
}

module.exports = { generate, emailLetter, daysOf };
