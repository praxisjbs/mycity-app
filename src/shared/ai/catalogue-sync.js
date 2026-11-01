"use strict";
/**
 * ai_catalogue made equal to the manifests in the running code (BACKEND_STRUCTURE
 * §14.4), so the assistant's tool list and the spend screen's list of AI reads always
 * describe the build that is deployed.
 *
 *   node src/shared/ai/catalogue-sync.js     deploy-gate runs this after migrating
 *
 * Upserts a row per read, summary, action and route (registry.catalogue()), and deletes rows
 * the build no longer has, in one transaction. Rows record the build they came from.
 *
 * Table (migration 0095, widened by 10330; BACKEND_STRUCTURE §11.1):
 *   ai_catalogue  key PK, kind ('read' | 'route' | 'summary' | 'action'), module_key, description,
 *                 permission, risk (an action's class), params_schema jsonb, screen, path,
 *                 build_sha, synced_at
 */
const { atomically } = require("../db/tx");
const { buildInfo } = require("../../config/build-info");
const registry = require("./registry");

/**
 * @param {import("pg").Pool} db
 * @returns {Promise<{upserted: number, removed: number}>}
 */
async function sync(db) {
  const rows = registry.catalogue();
  const sha = (buildInfo() && buildInfo().sha) || null;
  const client = await db.connect();
  try {
    return await atomically(client, async () => {
      for (const r of rows) {
        await client.query(
          `INSERT INTO ai_catalogue (key, kind, module_key, description, permission, risk, params_schema, screen, path, build_sha, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (key) DO UPDATE
             SET kind = EXCLUDED.kind, module_key = EXCLUDED.module_key, description = EXCLUDED.description,
                 permission = EXCLUDED.permission, risk = EXCLUDED.risk, params_schema = EXCLUDED.params_schema,
                 screen = EXCLUDED.screen, path = EXCLUDED.path, build_sha = EXCLUDED.build_sha, synced_at = now()`,
          [
            r.key,
            r.kind,
            r.module_key,
            r.description,
            r.permission,
            r.risk,
            r.params_schema ? JSON.stringify(r.params_schema) : null,
            r.screen,
            r.path,
            sha,
          ],
        );
      }
      const { rowCount } = await client.query(
        "DELETE FROM ai_catalogue WHERE NOT (key = ANY($1::text[]))",
        [rows.map((r) => r.key)],
      );
      return { upserted: rows.length, removed: rowCount };
    });
  } finally {
    client.release();
  }
}

if (require.main === module) {
  process.env.MYCITY_PROCESS =
    process.env.MYCITY_PROCESS || "mycity-catalogue-sync";
  const { pool, closeDb } = require("../../config/db");
  sync(pool)
    .then((r) => {
      console.log(
        `[ai-catalogue] ${r.upserted} entries synced, ${r.removed} removed`,
      );
      return closeDb().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error(`[ai-catalogue] ${err.message}`);
      process.exit(1);
    });
}

module.exports = { sync };
