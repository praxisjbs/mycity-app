"use strict";
/**
 * Queue `media-scan`: a file someone outside sent (a CV, a candidate's document) scanned
 * by clamd before anyone opens it (BACKEND_STRUCTURE §5.2). Queued by the
 * document.stored trigger when the upload needs a scan.
 *
 * Clean: the vault processes it and moves it out of quarantine. Infected: it stays in
 * quarantine, marked, never served. Either way vault.completeScan records the verdict
 * and emits document.scanned. A document already decided is left alone, so a retry is
 * harmless. clamd unreachable is retried with a long backoff (TRIGGERS opts); until a
 * verdict, the file is not served.
 */
const { UnrecoverableError } = require("bullmq");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const vault = require("../../shared/documents/vault");
const scan = require("../../services/media/scan");
const storage = require("../../services/storage/storage.service");

module.exports = async function mediaScan(job) {
  const id = job.data && job.data.document_id;
  if (!id)
    throw new UnrecoverableError("media-scan: the job needs document_id");
  const doc = await vault.get(pool, id);
  if (!doc)
    throw new UnrecoverableError(`media-scan: document ${id} does not exist`);
  if (doc.scan_status !== "pending")
    return { document_id: id, skipped: doc.scan_status };

  const verdict = await scan.scanFile(storage.absPath(doc.storage_key));
  const client = await pool.connect();
  try {
    const row = await atomically(client, () =>
      vault.completeScan(client, id, verdict),
    );
    return {
      document_id: id,
      clean: verdict.clean,
      scan_status: row ? row.scan_status : null,
    };
  } finally {
    client.release();
  }
};
