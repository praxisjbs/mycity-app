"use strict";
/**
 * Queue `import-commit`: a previewed import committed in the background
 * (shared/import/engine.commit). Every row is written through the owning module's
 * service, in one transaction, all or nothing unless the person chose "commit valid rows
 * only" (`valid_only`).
 *
 *   await queues.enqueue("import-commit", batch.number, {
 *     import_batch_id, user_id: req.user.user_id, valid_only, create_missing,
 *   }, { attempts: 1 });
 *
 * Runs as the person who asked (see import-validate). A commit refused because rows have
 * problems fails the job at once; the preview result is saved on the batch for the
 * error file. A retry after a crash is safe: a batch already committed is refused by the
 * engine ("Preview the import before committing it"), never written twice.
 */
const { UnrecoverableError } = require("bullmq");
const engine = require("../../shared/import/engine");
const { actorFor, final } = require("./import-validate");

module.exports = async function importCommit(job) {
  const {
    import_batch_id: id,
    user_id: userId,
    valid_only: validOnly,
    create_missing: createMissing,
  } = job.data || {};
  if (!id)
    throw new UnrecoverableError(
      "import-commit: the job needs import_batch_id",
    );
  const actor = await actorFor(userId);
  try {
    const r = await engine.commit(id, {
      actor,
      valid_only: validOnly === true,
      create_missing: createMissing || {},
    });
    return { import_batch_id: id, status: r.batch.status, stats: r.stats };
  } catch (err) {
    throw final(err);
  }
};
