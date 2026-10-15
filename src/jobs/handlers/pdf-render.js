"use strict";
/**
 * Queue `pdf-render`: a generated document's HTML turned into its PDF
 * (shared/documents/generate.renderPending): rendered in Chromium, stored, hashed,
 * locked, document.generated emitted. Queued by the document.render_requested trigger.
 *
 * A document that is no longer pending (already rendered by an earlier attempt) is left
 * as it is. When the last attempt fails, the document is marked failed
 * (document.render_failed), so the screen stops waiting and says so.
 */
const { UnrecoverableError } = require("bullmq");
const documents = require("../../shared/documents/generate");
const { isLastAttempt } = require("../registry");

module.exports = async function pdfRender(job) {
  const id = job.data && job.data.document_id;
  if (!id)
    throw new UnrecoverableError("pdf-render: the job needs document_id");
  try {
    const doc = await documents.renderPending(id);
    if (!doc) return { document_id: id, skipped: "not pending" };
    return {
      document_id: id,
      number: doc.number,
      bytes: doc.bytes,
      content_hash: doc.content_hash,
    };
  } catch (err) {
    if (isLastAttempt(job) || (err && err.name === "UnrecoverableError"))
      await documents.failRender(id, err);
    throw err;
  }
};
