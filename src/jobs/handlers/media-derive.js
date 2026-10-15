"use strict";
/**
 * Queue `media-derive`: make a stored document's derived files again, by id. For an
 * operator after a fix (ffmpeg was missing when a voice note arrived, a variant was
 * lost) and for any later code that needs a re-derive.
 *
 * Audio and video: the same work as av-transcode. Images: their variants are made when
 * the file is stored (shared/documents/vault.store), and a variant that failed to store
 * only makes a list slower, so there is nothing to queue; the job says so. Anything else
 * has no derived files.
 */
const { UnrecoverableError } = require("bullmq");
const { pool } = require("../../config/db");
const vault = require("../../shared/documents/vault");
const { transcode, avKind } = require("./av-transcode");

module.exports = async function mediaDerive(job) {
  const id = job.data && job.data.document_id;
  if (!id)
    throw new UnrecoverableError("media-derive: the job needs document_id");
  const doc = await vault.get(pool, id);
  if (!doc)
    throw new UnrecoverableError(`media-derive: document ${id} does not exist`);
  if (avKind(doc.mime)) return transcode(id);
  if (/^image\//.test(String(doc.mime)))
    return {
      document_id: id,
      skipped: "image variants are made when the file is stored",
    };
  return { document_id: id, skipped: `${doc.mime} has no derived files` };
};
