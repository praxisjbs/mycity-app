"use strict";
/**
 * Queue `media-derive`: make a stored document's derived files, by id. Queued by the
 * document.stored trigger for a PDF (its first page as pictures and its page count,
 * services/media/pdf-pipeline.js), and by an operator after a fix (ffmpeg was missing when a
 * voice note arrived, a variant was lost) or any later code that needs a re-derive.
 *
 * Audio and video: the same work as av-transcode. Images: their variants are made when
 * the file is stored (shared/documents/vault.store), and a variant that failed to store
 * only makes a list slower, so there is nothing to queue; the job says so. A PDF the
 * pipeline cannot draw (broken, locked with a password, too heavy for its time) fails at
 * once: trying again draws nothing more, and its card stays a plain file. Anything else
 * has no derived files.
 */
const { UnrecoverableError } = require("bullmq");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const vault = require("../../shared/documents/vault");
const pdf = require("../../services/media/pdf-pipeline");
const { transcode, avKind } = require("./av-transcode");

/** Draw a stored PDF's first page and record it with the page count. */
async function derivePdf(id, doc) {
  if (doc.scan_status === "pending" || doc.scan_status === "infected")
    return { document_id: id, skipped: `scan ${doc.scan_status}` };
  let derived;
  try {
    derived = await pdf.derive({ document_id: id, storage_key: doc.storage_key });
  } catch (err) {
    throw new UnrecoverableError(`media-derive: PDF ${id} could not be drawn: ${String(err.message).slice(0, 200)}`);
  }
  const client = await pool.connect();
  try {
    await atomically(client, () => vault.completePdf(client, id, derived));
  } finally {
    client.release();
  }
  return {
    document_id: id,
    page_count: derived.page_count,
    variants: derived.variants.map((v) => v.kind),
  };
}

module.exports = async function mediaDerive(job) {
  const id = job.data && job.data.document_id;
  if (!id)
    throw new UnrecoverableError("media-derive: the job needs document_id");
  const doc = await vault.get(pool, id);
  if (!doc)
    throw new UnrecoverableError(`media-derive: document ${id} does not exist`);
  if (avKind(doc.mime)) return transcode(id);
  if (doc.mime === "application/pdf") return derivePdf(id, doc);
  if (/^image\//.test(String(doc.mime)))
    return {
      document_id: id,
      skipped: "image variants are made when the file is stored",
    };
  return { document_id: id, skipped: `${doc.mime} has no derived files` };
};
module.exports.derivePdf = derivePdf;
