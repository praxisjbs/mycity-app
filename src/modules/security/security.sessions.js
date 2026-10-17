"use strict";
/**
 * Everyone's live sessions, for an administrator on Settings · Security, and ending
 * one remotely (a lost laptop, a shared computer, someone who has left). Identity owns
 * the sessions and writes the change; the person is told, and the session is refused
 * at its next request. Nobody ends their own session here: Sign Out does that.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const identity = require("../identity/identity.service");

/** GET /settings/security/sessions */
const list = (query, actor) => identity.liveSessions(query, actor);

/** POST /settings/security/sessions/:id/end */
async function end(sessionId, actor) {
  const client = await pool.connect();
  let userId;
  try {
    userId = await atomically(client, () => identity.endSessionAsAdmin(client, sessionId, actor));
  } finally {
    client.release();
  }
  if (!userId) throw new AppError("NOT_FOUND", "That session has already ended.", 404);
  await identity.afterSessionsEnded(userId, [sessionId]);
}

module.exports = { list, end };
