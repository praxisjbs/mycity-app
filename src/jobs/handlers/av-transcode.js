"use strict";
/**
 * Queue `av-transcode`: a voice note or a video made playable everywhere
 * (services/media/av-pipeline.js): Opus for audio; H.264 MP4 and a poster frame for
 * video. The original stays the master; the variants are recorded with
 * vault.completeAv, which overwrites a variant of the same kind, so a retry is harmless.
 * Queued by the document.stored trigger for audio and video uploads.
 */
const { UnrecoverableError } = require("bullmq");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const vault = require("../../shared/documents/vault");
const av = require("../../services/media/av-pipeline");

/** "audio" | "video" | null, from the stored (sniffed) type. */
function avKind(mime) {
  if (/^audio\//.test(String(mime))) return "audio";
  if (/^video\//.test(String(mime))) return "video";
  return null;
}

/**
 * Derive and record the playable variants of one stored document.
 * @param {string} id
 * @returns {Promise<object>}
 */
async function transcode(id) {
  const doc = await vault.get(pool, id);
  if (!doc)
    throw new UnrecoverableError(`av-transcode: document ${id} does not exist`);
  const kind = avKind(doc.mime);
  if (!kind)
    throw new UnrecoverableError(
      `av-transcode: document ${id} is ${doc.mime}, not audio or video`,
    );
  if (doc.scan_status === "pending" || doc.scan_status === "infected")
    return { document_id: id, skipped: `scan ${doc.scan_status}` };

  const derived = await av.derive({
    document_id: id,
    storage_key: doc.storage_key,
    kind,
  });
  const client = await pool.connect();
  try {
    await atomically(client, () => vault.completeAv(client, id, derived));
  } finally {
    client.release();
  }
  return {
    document_id: id,
    kind,
    duration_ms: derived.duration_ms,
    variants: derived.variants.map((v) => v.kind),
  };
}

module.exports = async function avTranscode(job) {
  const id = job.data && job.data.document_id;
  if (!id)
    throw new UnrecoverableError("av-transcode: the job needs document_id");
  return transcode(id);
};
module.exports.transcode = transcode;
module.exports.avKind = avKind;
