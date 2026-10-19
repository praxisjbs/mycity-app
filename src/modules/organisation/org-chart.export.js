"use strict";
/**
 * Download PDF's work in the worker (docs/guides/organogram.md §5 to §7), called by the outbox
 * handlers in organisation.events.js after the request has committed:
 *
 *   build(event)          org_chart.export_requested: the tree read as the person asking, laid
 *                         out (org-chart.layout.js) and queued through documents.generate, so
 *                         the pdf-render job draws it. Chromium never runs inside a request.
 *   deliver(documentId)   document.generated for an org_chart PDF: emailed to the person who
 *                         asked, the PDF attached, so it arrives in their Mailbox.
 *   failed(documentId)    document.render_failed for one: they are told, and may ask again.
 *
 * AS THE PERSON ASKING, who is the document's uploader. They must still be active when it is
 * built and when it is sent, or nothing is.
 *
 * SAFE TO RUN TWICE, as every outbox handler is: a request that already has its document is not
 * drawn again, and the email's job id is the document's, so a retry does not send it twice.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const grantsCache = require("../../shared/rbac/grants-cache");
const documents = require("../../shared/documents/generate");
const vault = require("../../shared/documents/vault");
const { layout } = require("./org-chart.layout");
const repo = require("./organisation.repo");
const service = require("./organisation.service");
const { EVENTS, CHART_DOC_TYPE, CHART_EXPORT } = require("./organisation.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** The person who asked, while they may still be sent something; null otherwise. */
async function asker(userId) {
  const user = userId ? await grantsCache.getAuthUser(pool, userId) : null;
  return user && user.status === "active" ? user : null;
}

/** org_chart.export_requested: lay the chart out as the person asking and queue its render. */
async function build(event) {
  const reader = await asker(event.payload.requested_by);
  if (!reader) return;
  if (await repo.documentOf(pool, CHART_EXPORT, event.entity.id)) return;
  const tree = await service.orgChart(pool, { view: event.payload.view });
  await tx((client) =>
    documents.generate(client, {
      doc_type: CHART_DOC_TYPE,
      entity: { type: CHART_EXPORT, id: event.entity.id },
      data: { ...layout(tree.nodes), seats: tree.seats, filled: tree.filled, open: tree.open },
      actor: reader.user_id,
    }),
  );
}

/** The org_chart document with this id, or null. */
async function chartDocument(documentId) {
  const doc = await vault.get(pool, documentId);
  return doc && doc.doc_type === CHART_DOC_TYPE && doc.entity_type === CHART_EXPORT ? doc : null;
}

/** document.generated: email the PDF to the person who asked. */
async function deliver(documentId) {
  const doc = await chartDocument(documentId);
  const reader = doc && (await asker(doc.uploaded_by));
  if (!reader) return;
  const person = reader.employee_id ? await repo.findEmployeeById(pool, reader.employee_id) : null;
  const queues = require("../../jobs/queues");
  await queues.enqueue(
    "email-send",
    "org-chart-export",
    {
      to: { name: reader.display_name, email: reader.email },
      recipient: {
        first_name: (person && (person.preferred_name || person.first_name)) || null,
        last_name: (person && person.last_name) || null,
        email: reader.email,
      },
      template: "org-chart-export",
      data: { as_at: new Date(doc.created_at).toISOString() },
      attachments: [{ document_id: doc.document_id }],
    },
    { jobId: `org-chart-export-${doc.document_id}` },
  );
}

/** document.render_failed: tell the person who asked, so they can press Download PDF again. */
async function failed(documentId) {
  const doc = await chartDocument(documentId);
  if (!doc || !doc.uploaded_by) return;
  await tx((client) =>
    emit(client, {
      key: EVENTS.ORG_CHART_EXPORT_FAILED,
      entity: { type: CHART_EXPORT, id: doc.entity_id },
      actor: null,
      payload: { requested_by: doc.uploaded_by, document_id: doc.document_id },
    }),
  );
}

module.exports = { build, deliver, failed };
