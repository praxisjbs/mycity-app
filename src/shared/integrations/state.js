"use strict";
/**
 * A connection's row and its state (docs/guides/integrations.md §4, §6.9).
 *
 *   const id = await state.ensure(db, "geoapify");     // the row, made on first need
 *   await state.set(db, "geoapify", { ok: false, error_code: "KEY_REFUSED", at, checked: true });
 *
 * The row is made the first time a connection is saved, checked or used, so a connection
 * added to the registry needs no migration. Its state follows the newest outcome, a check
 * or a real call, whichever happened last (`state_at` decides), so a late flush of
 * yesterday's counts never undoes this morning's passing test.
 *
 * Writes the state columns only. The configuration columns (what was saved, by whom, the
 * daily limit) are the integrations module's service's (src/modules/integrations).
 */
const providers = require("./providers");

/** The connection's row id, made when it has none. */
async function ensure(db, code) {
  const def = providers.get(code);
  await db.query(
    `INSERT INTO integration_connection (code, provider, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING`,
    [def.code, def.provider, def.name],
  );
  const { rows } = await db.query(
    "SELECT integration_connection_id FROM integration_connection WHERE code = $1",
    [def.code],
  );
  return rows[0].integration_connection_id;
}

/**
 * Move a connection's state, unless something newer already has.
 * @param {{query: Function}} db
 * @param {string} code
 * @param {{ok: boolean, error_code?: string|null, at?: Date, checked?: boolean}} outcome
 *   checked  a test ran (sets last_checked_at); false for counted real use
 */
async function set(db, code, { ok, error_code = null, at = new Date(), checked = false }) {
  await ensure(db, code);
  await db.query(
    `UPDATE integration_connection SET
       last_checked_at = CASE WHEN $5 THEN GREATEST(COALESCE(last_checked_at, $4), $4) ELSE last_checked_at END,
       status = CASE WHEN state_at IS NULL OR state_at <= $4
                     THEN (CASE WHEN $2 THEN 'ok' ELSE 'failing' END) ELSE status END,
       last_error_code = CASE WHEN state_at IS NULL OR state_at <= $4
                              THEN (CASE WHEN $2 THEN NULL ELSE $3 END) ELSE last_error_code END,
       last_ok_at = CASE WHEN $2 THEN GREATEST(COALESCE(last_ok_at, $4), $4) ELSE last_ok_at END,
       state_at = GREATEST(COALESCE(state_at, $4), $4)
     WHERE code = $1`,
    [code, Boolean(ok), ok ? null : error_code || "UNAVAILABLE", at, Boolean(checked)],
  );
}

/**
 * A connection as a readiness check (src/http/health.js; Settings · Status): up when it works
 * or has not been checked, degraded when its newest outcome failed or its saved key cannot be
 * read. Not set up reads up with a note, as the stub and captured mail do: nothing is broken,
 * nothing is configured. Reads stored state only; never calls the provider.
 * @param {{query: Function}} db
 * @param {string} code
 */
async function readiness(db, code) {
  const inUse = await require("./settings").of(code, { db });
  if (!inUse) return { status: "up", mode: "not_set_up" };
  if (inUse.unreadable.length) return { status: "degraded", mode: inUse.source, error: "SECRET_UNREADABLE" };
  let row = null;
  try {
    ({ rows: [row] } = await db.query(
      "SELECT status, last_error_code FROM integration_connection WHERE code = $1",
      [code],
    ));
  } catch (err) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  if (row && row.status === "failing")
    return { status: "degraded", mode: inUse.source, error: row.last_error_code || "UNAVAILABLE" };
  return { status: "up", mode: inUse.source, state: row ? row.status : "unchecked" };
}

module.exports = { ensure, set, readiness };
