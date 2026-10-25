"use strict";
/**
 * Undo a committed import (BACKEND_STRUCTURE §9.2): records it created are archived,
 * records it updated are restored from the before-snapshot taken at commit.
 *
 *   await revert(batchId, { actor });
 *
 * Refused, as a whole, when any of its records has changed since the import or is now
 * referenced elsewhere, listing which rows: reverting over someone's later edit would
 * silently throw their work away. "Changed since" is read from the event log: an event
 * on the record after the commit that did not come from this batch.
 *
 * The undo goes through the importer's own archive() and restore(), so it is audited
 * and its events fire exactly like any other change, carrying the batch id.
 */
const { AppError } = require("../errors");
const { atomically } = require("../db/tx");
const requestContext = require("../../config/request-context");
const { emit } = require("../events/emit");
const engine = require("./engine");

/**
 * Rows whose record was changed after the commit by anything but this batch. `entityTypes` is
 * every kind of record the importer writes (a staff row is a person, or a VACANT row's seat).
 */
async function changedSince(client, batch, entityTypes, ids) {
  if (ids.length === 0) return new Set();
  const { rows } = await client.query(
    `SELECT DISTINCT entity_id FROM event_log
      WHERE entity_type = ANY($1::text[]) AND entity_id = ANY($2::text[]) AND occurred_at > $3
        AND import_batch_id IS DISTINCT FROM $4`,
    [[].concat(entityTypes), ids, batch.committed_at, batch.import_batch_id],
  );
  return new Set(rows.map((r) => r.entity_id));
}

/**
 * @param {string} batchId
 * @param {{actor: object, db?: import("pg").Pool}} opts
 * @returns {Promise<{batch: object, archived: number, restored: number}>}
 */
async function revert(
  batchId,
  { actor, db = require("../../config/db").pool },
) {
  const client = await db.connect();
  try {
    return await requestContext.run(
      { ...(requestContext.get() || {}), importBatchId: batchId },
      () =>
        atomically(client, async () => {
          const batch = await engine.loadBatch(client, batchId, {
            forUpdate: true,
          });
          if (batch.status !== "committed")
            throw new AppError(
              "IMPORT_NOT_COMMITTED",
              `Only a committed import can be reverted; this one is ${batch.status}`,
              409,
            );
          const imp = engine.importerOf(batch.importer_key);
          await engine.assertMay(client, actor, imp);

          // pagination:complete every row the batch wrote must be undone, or none
          const { rows } = await require("../http/paged").completeQuery(
            client,
            `SELECT row_number, action, target_id, "before" FROM import_row
            WHERE import_batch_id = $1 AND action IN ('create', 'update') AND status IN ('ok', 'warning')
            ORDER BY row_number DESC`,
            [batchId],
            { label: "import rows to revert", ceiling: 100000 },
          );
          const changed = await changedSince(
            client,
            batch,
            [imp.entity, ...(imp.alsoEntities || [])],
            rows.map((r) => r.target_id),
          );
          const blocked = [];
          for (const r of rows) {
            if (changed.has(r.target_id))
              blocked.push(`row ${r.row_number} was changed after the import`);
            // Only a record the revert would archive matters here: an updated one stays.
            else if (
              r.action === "create" &&
              imp.isReferenced &&
              (await imp.isReferenced(client, r.target_id, { batch }))
            )
              blocked.push(`row ${r.row_number} is now used elsewhere`);
          }
          if (blocked.length) {
            throw new AppError(
              "IMPORT_REVERT_BLOCKED",
              `This import cannot be reverted: ${blocked.slice(0, 5).join("; ")}${blocked.length > 5 ? ` and ${blocked.length - 5} more` : ""}.`,
              409,
              {
                rows: blocked,
              },
            );
          }

          const ctx = { actor, batch, importer: imp, reverting: true };
          let archived = 0;
          let restored = 0;
          for (const r of rows) {
            if (r.action === "create") {
              await imp.archive(client, r.target_id, ctx);
              archived += 1;
            } else {
              await imp.restore(client, r.target_id, r.before, ctx);
              restored += 1;
            }
          }
          const { rows: up } = await client.query(
            `UPDATE import_batch SET status = 'reverted', reverted_at = now(), reverted_by = $2
            WHERE import_batch_id = $1 RETURNING ${engine.BATCH_COLUMNS}`,
            [batchId, actor ? actor.user_id : null],
          );
          await emit(client, {
            key: engine.EVENTS.IMPORT_REVERTED,
            entity: { type: "import_batch", id: batchId },
            module: imp.permission[0],
            actor,
            payload: {
              import_batch_id: batchId,
              importer_key: imp.key,
              archived,
              restored,
            },
          });
          return { batch: up[0], archived, restored };
        }),
    );
  } finally {
    client.release();
  }
}

module.exports = { revert, changedSince };
