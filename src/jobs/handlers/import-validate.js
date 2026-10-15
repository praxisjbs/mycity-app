"use strict";
/**
 * Queue `import-validate`: an import's preview run in the background, for a file too
 * large to preview inside a request (BACKEND_STRUCTURE §9.3). The preview is the whole
 * commit run and rolled back (shared/import/engine.preview); its per-row result is saved
 * on the batch, which the screen reads.
 *
 *   await queues.enqueue("import-validate", batch.number, {
 *     import_batch_id, user_id: req.user.user_id, create_missing,
 *   });
 *
 * The import runs as the person who asked: their permission is checked again here (a
 * grant removed in the meantime stops it), and every audit row names them. A refusal
 * the person must act on (mapping invalid, no permission, the batch moved on) fails the
 * job at once; the batch keeps its status and the screen shows the reason.
 */
const { UnrecoverableError } = require("bullmq");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const grantsCache = require("../../shared/rbac/grants-cache");
const engine = require("../../shared/import/engine");

/** The person the job runs as, re-read now. */
async function actorFor(userId) {
  const user = userId ? await grantsCache.getAuthUser(pool, userId) : null;
  if (!user || user.status !== "active")
    throw new UnrecoverableError(
      `import: user ${userId} is not an active user`,
    );
  return {
    user_id: user.user_id,
    employee_id: user.employee_id,
    email: user.email,
    display_name: user.display_name,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
  };
}

/** A refusal the engine raised for a reason a retry cannot change. */
function final(err) {
  return err instanceof AppError
    ? new UnrecoverableError(`${err.code}: ${err.message}`)
    : err;
}

module.exports = async function importValidate(job) {
  const {
    import_batch_id: id,
    user_id: userId,
    create_missing: createMissing,
  } = job.data || {};
  if (!id)
    throw new UnrecoverableError(
      "import-validate: the job needs import_batch_id",
    );
  const actor = await actorFor(userId);
  try {
    const r = await engine.preview(id, {
      actor,
      create_missing: createMissing || {},
    });
    return { import_batch_id: id, status: r.batch.status, stats: r.stats };
  } catch (err) {
    throw final(err);
  }
};
module.exports.actorFor = actorFor;
module.exports.final = final;
