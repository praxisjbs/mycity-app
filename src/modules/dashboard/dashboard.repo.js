"use strict";
/**
 * Home's own cards, the SQL: the cards a role opens Home on (role_kpi) and the cards a
 * person chose for themselves (home_kpi_pick), docs/guides/home.md §4. Writes those two
 * tables and nothing else; never emits (BACKEND_GUIDE §2).
 *
 * A card id is a key of the KPI catalogue (src/modules/dashboard/kpi-catalog), which is
 * code, so there is no foreign key to check it: the service checks every id before it is
 * written, and an id the catalogue no longer has is ignored when it is read.
 *
 * Both are small by nature, a row per person and a row per role, read one person's or one
 * role's at a time, so nothing here pages.
 */

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

const PICK = "home_kpi_pick_id, user_id, kpi_ids";
const ROLE_CARDS = "role_kpi_id, role_id, default_ids, locked_ids, updated_by";

/* ------------------------------------------------------------------ *
 * A person's own pick
 * ------------------------------------------------------------------ */

/**
 * The person's pick, or null when they never chose (no row): they follow their roles. An
 * empty `kpi_ids` is a choice of none, not a missing row.
 * @param {{query: Function}} db
 * @param {string} userId
 * @param {{lock?: boolean}} [opts]  lock: hold the row for the rest of the transaction
 * @returns {Promise<{home_kpi_pick_id: string, user_id: string, kpi_ids: string[]}|null>}
 */
function pickOf(db, userId, { lock = false } = {}) {
  return one(db, `SELECT ${PICK} FROM home_kpi_pick WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId]);
}

/** Save the person's pick in the order given, replacing the one they had. */
function savePick(db, userId, kpiIds) {
  return one(
    db,
    `INSERT INTO home_kpi_pick (user_id, kpi_ids) VALUES ($1, $2::text[])
     ON CONFLICT (user_id) DO UPDATE SET kpi_ids = EXCLUDED.kpi_ids
     RETURNING ${PICK}`,
    [userId, kpiIds],
  );
}

/** Forget the person's pick, so they follow their roles again. The row it removed, or null. */
function deletePick(db, userId) {
  return one(db, `DELETE FROM home_kpi_pick WHERE user_id = $1 RETURNING ${PICK}`, [userId]);
}

/* ------------------------------------------------------------------ *
 * A role's cards
 * ------------------------------------------------------------------ */

/**
 * The cards of the roles with these codes, in the order the codes are given (a person's
 * effective roles, most senior first, as identity reads them). A role with no row of its
 * own is left out: it follows its Home view's defaults. One person holds a handful of roles.
 * @param {{query: Function}} db
 * @param {string[]} codes
 * @returns {Promise<Array<{code: string, default_ids: string[], locked_ids: string[]}>>}
 */
async function roleCardsByCodes(db, codes) {
  if (!codes.length) return [];
  const { rows } = await db.query(
    `SELECT r.code::text AS code, rk.default_ids, rk.locked_ids
       FROM role_kpi rk
       JOIN role r ON r.role_id = rk.role_id
      WHERE r.code::text = ANY($1::text[])
      ORDER BY array_position($1::text[], r.code::text)`,
    [codes],
  );
  return rows;
}

/**
 * One role's cards, or null when it has none of its own.
 * @param {{query: Function}} db
 * @param {string} roleId
 * @param {{lock?: boolean}} [opts]  lock: hold the row for the rest of the transaction
 */
function roleCardsOf(db, roleId, { lock = false } = {}) {
  return one(db, `SELECT ${ROLE_CARDS} FROM role_kpi WHERE role_id = $1${lock ? " FOR UPDATE" : ""}`, [roleId]);
}

/**
 * Save a role's cards, replacing what it had. `updated_by` is the person who set them, or
 * null when the system took cards out (the prune).
 * @param {{query: Function}} db
 * @param {string} roleId
 * @param {{default_ids: string[], locked_ids: string[], updated_by: string|null}} cards
 */
function saveRoleCards(db, roleId, { default_ids: defaults, locked_ids: locked, updated_by: updatedBy }) {
  return one(
    db,
    `INSERT INTO role_kpi (role_id, default_ids, locked_ids, updated_by) VALUES ($1, $2::text[], $3::text[], $4)
     ON CONFLICT (role_id) DO UPDATE SET
       default_ids = EXCLUDED.default_ids, locked_ids = EXCLUDED.locked_ids, updated_by = EXCLUDED.updated_by
     RETURNING ${ROLE_CARDS}`,
    [roleId, defaults, locked, updatedBy],
  );
}

/** Take a role back to its Home view's defaults. The row it removed, or null. */
function deleteRoleCards(db, roleId) {
  return one(db, `DELETE FROM role_kpi WHERE role_id = $1 RETURNING ${ROLE_CARDS}`, [roleId]);
}

module.exports = {
  pickOf,
  savePick,
  deletePick,
  roleCardsByCodes,
  roleCardsOf,
  saveRoleCards,
  deleteRoleCards,
};
