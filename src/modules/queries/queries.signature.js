"use strict";
/**
 * My Signature (docs/guides/queries.md §6.9): the signature a person draws once on Letter
 * Templates (Edit Signature) and their letters start from. Raise a Query and Approve Sanction open
 * their pad with it, and a letter preview shows it; each letter still keeps its own copy in the
 * vault, so saving a new one never changes a letter already sent.
 *
 *   mine(user)         GET /queries/my-signature: the PNG as a data URL, or null
 *   save(user, body)   PUT /queries/my-signature: kept through the vault, replacing the last
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const vault = require("../../shared/documents/vault");
const storage = require("../../services/storage/storage.service");
const { EVENTS } = require("./queries.events");

/** The saved signature of a login, as a PNG data URL, or null. */
async function dataUrlOf(db, userId) {
  const { rows } = await db.query("SELECT document_id, updated_at FROM letter_signature WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  const doc = await vault.get(db, rows[0].document_id);
  const bytes = doc ? await storage.get(doc.storage_key).catch(() => null) : null;
  return bytes ? { signature: `data:image/png;base64,${bytes.toString("base64")}`, updated_at: rows[0].updated_at } : null;
}

async function mine(user) {
  return (await dataUrlOf(pool, user.user_id)) || { signature: null, updated_at: null };
}

async function save(user, body) {
  const client = await pool.connect();
  try {
    await atomically(client, async () => {
      const documentId = await require("./queries.service").storeSignature(client, body.signature, { type: "user", id: user.user_id }, user);
      await client.query(
        `INSERT INTO letter_signature (user_id, document_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET document_id = EXCLUDED.document_id`,
        [user.user_id, documentId],
      );
      await emit(client, {
        key: EVENTS.LETTER_SIGNATURE_SAVED,
        entity: { type: "user", id: user.user_id },
        actor: user,
        payload: { user_id: user.user_id, document_id: documentId },
      });
    });
  } finally {
    client.release();
  }
  return mine(user);
}

module.exports = { mine, save, dataUrlOf };
