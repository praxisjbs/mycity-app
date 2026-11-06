"use strict";
/**
 * CVs nobody applied with (docs/guides/recruitment.md §6.2, §13): a CV sent on an Apply link is kept
 * against the link until the application is made. When the link ends without one (it lapsed, was
 * revoked, or a second application from the same email spent it), apply-cv-purge removes the CV a
 * day later, nightly: the vault row with `document.removed` on the record, then the file (GE,
 * 05/11/2026). One transaction each, so one that cannot be removed stops nobody else.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const vault = require("../../shared/documents/vault");
const repo = require("./candidates.repo");
const { APPLY_LINK } = require("./candidates.events");

const REASON = "CV on an Apply link that ended without an application";

/** How long one run may keep going, batch after batch, before it leaves the rest to tomorrow. */
const BUDGET_MS = 5 * 60_000;

async function purge({ db = pool } = {}) {
  let removed = 0;
  const until = Date.now() + BUDGET_MS;
  for (;;) {
    const batch = await repo.leftCvs(db, APPLY_LINK);
    const before = removed;
    for (const id of batch) if (await removeOne(db, id)) removed += 1;
    // Caught up, or nothing could be removed this time (each failure is logged), or out of time.
    if (batch.length < 200 || removed === before || Date.now() > until) break;
  }
  return { removed };
}

async function removeOne(db, id) {
  const client = await db.connect();
  let keys;
  try {
    keys = await atomically(client, () => vault.remove(client, id, { reason: REASON }));
  } catch (err) {
    logger.warn({ err: err.code || err.message, document_id: id }, "apply-cv-purge: a CV could not be removed");
    return false;
  } finally {
    client.release();
  }
  if (!keys) return false;
  await vault.removeFiles(keys);
  return true;
}

module.exports = { purge, REASON };
