"use strict";
/**
 * Every address a person enters, as the owning module saves and reads it
 * (docs/guides/addresses.md §3, §6). The contract's `PlaceInput` has already checked the token
 * and turned it into the place; this keeps it.
 *
 *   const { line } = await places.save(client, "worksite.address", worksiteId, body.address);
 *   //  the module writes `line` into its own column (its lists, masks and search read that)
 *   await places.remove(client, "worksite.address", worksiteId);      // an optional address cleared
 *   const view = await places.view(db, "worksite.address", worksiteId);   // PlaceView, or null
 *   const byKey = await places.views(db, "worksite.address", ids);       // Map key → PlaceView
 *
 * Rules:
 *  - A pick suits its field's level (owners.js): a home is a door, not a city. A pin or a
 *    device location is a point, so it suits any level.
 *  - One row per field of a record, replaced when the address changes, inside the owner's own
 *    transaction (the owner's event records the change).
 *  - The line is the Details first, then the address: "Flat 3, blue gate, 12 Admiralty Way, ...".
 *    A device location waiting to be named reads "Near 6.43210, 3.42190" until the naming job
 *    gives it a name (nameWaiting below).
 */
const owners = require("./owners");
const token = require("./token");
const { AppError } = require("../errors");

/** The kinds a search pick may not be, by level. */
const TOO_COARSE = {
  address: new Set(["area", "city", "region", "country"]),
  area: new Set(["region", "country"]),
  city: new Set(["building", "street", "landmark", "area", "region", "country"]),
};

/** What the field says when a pick is the wrong size, at most four words. */
const WRONG_LEVEL = {
  address: "Pick a street or building",
  area: "Pick a town or district",
  city: "Pick a city",
};

const fixed = (v) => Number(v).toFixed(5);

/** The readable line for a place: details first, then the address. */
function lineOf(place) {
  const address = place.formatted || (place.lat !== null && place.lat !== undefined ? `Near ${fixed(place.lat)}, ${fixed(place.lon)}` : "");
  return [place.details, address].filter((s) => typeof s === "string" && s.trim()).join(", ");
}

/**
 * Keep an address for one field of one record, in the owner's transaction.
 * @param {{query: Function}} client
 * @param {string} name     the owner (owners.js), e.g. "employee.home_address"
 * @param {string} key      the record's id, or "organisation"
 * @param {object} place    the parsed PlaceInput
 * @param {{field?: string}} [opts]  the body field a refusal lands on; the owner's column unless set
 * @returns {Promise<{line: string, place_id: string}>}
 */
async function save(client, name, key, place, { field } = {}) {
  const def = owners.get(name);
  if (place.source === "search" && TOO_COARSE[def.level].has(place.kind)) {
    const at = field || name.slice(name.indexOf(".") + 1);
    throw new AppError("VALIDATION_FAILED", WRONG_LEVEL[def.level], 422, { [at]: [WRONG_LEVEL[def.level]] });
  }
  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO place (owner, owner_key, source, formatted, details, lat, lon, accuracy_m, provider_id,
                        kind, city, state, country_code, verified, pending, named_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             CASE WHEN $15 THEN NULL ELSE now() END)
     ON CONFLICT (owner, owner_key) DO UPDATE SET
       source = EXCLUDED.source, formatted = EXCLUDED.formatted, details = EXCLUDED.details,
       lat = EXCLUDED.lat, lon = EXCLUDED.lon, accuracy_m = EXCLUDED.accuracy_m,
       provider_id = EXCLUDED.provider_id, kind = EXCLUDED.kind, city = EXCLUDED.city,
       state = EXCLUDED.state, country_code = EXCLUDED.country_code, verified = EXCLUDED.verified,
       pending = EXCLUDED.pending, named_at = EXCLUDED.named_at
     RETURNING place_id`,
    [
      name,
      String(key),
      place.source,
      place.formatted,
      place.details || null,
      place.lat,
      place.lon,
      place.accuracy_m ?? null,
      place.provider_id ?? null,
      place.kind || "unknown",
      place.city ?? null,
      place.state ?? null,
      place.country_code ?? null,
      Boolean(place.verified),
      Boolean(place.pending),
    ],
  );
  return { line: lineOf(place), place_id: row.place_id };
}

/** Forget a record's address for one field (an optional address cleared). */
async function remove(client, name, key) {
  owners.get(name);
  await client.query("DELETE FROM place WHERE owner = $1 AND owner_key = $2", [name, String(key)]);
}

const COLUMNS = `place_id, owner_key, source, formatted, details, lat::float8 AS lat, lon::float8 AS lon,
  accuracy_m::float8 AS accuracy_m, provider_id, kind, city, state, country_code, verified, pending`;

/** A stored row as the contract's PlaceView, with a fresh token to send it back unchanged. */
function viewOf(row) {
  return {
    token: token.sign(row),
    formatted: row.formatted,
    details: row.details,
    lat: row.lat,
    lon: row.lon,
    source: row.source,
    kind: row.kind,
    verified: row.verified,
    pending: row.pending,
  };
}

/** One record's address for one field as an edit form reads it, or null. */
async function view(db, name, key) {
  owners.get(name);
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM place WHERE owner = $1 AND owner_key = $2`, [name, String(key)]);
  return rows[0] ? viewOf(rows[0]) : null;
}

/** Several records' addresses for one field (a page of them): Map of key → PlaceView. */
async function views(db, name, keys) {
  owners.get(name);
  const wanted = [...new Set((keys || []).map(String))];
  if (!wanted.length) return new Map();
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM place WHERE owner = $1 AND owner_key = ANY($2::text[])`, [name, wanted]);
  return new Map(rows.map((r) => [r.owner_key, viewOf(r)]));
}

/**
 * Name the device locations saved while address search was down (§6.5), oldest first, through
 * `nearest` (the maps service). Stops at the first failure, so an outage costs one request a run.
 * Each place is named, and its owner's line rewritten by the owner's own code, in one
 * transaction with `place.named`.
 * @param {{pool: object, nearest: (lat: number, lon: number) => Promise<{place_id: string, formatted: string,
 *          kind: string, city: string|null, state: string|null, country_code: string|null}|null>,
 *          tx: (fn: Function) => Promise<any>, emit: Function, limit?: number}} deps
 * @returns {Promise<{named: number, stopped: boolean}>}
 */
async function nameWaiting({ pool, nearest, tx, emit, limit = 25 }) {
  const { rows } = await pool.query(
    `SELECT place_id, owner, owner_key, details, lat::float8 AS lat, lon::float8 AS lon
       FROM place WHERE pending
      ORDER BY created_at
      LIMIT $1 -- pagination:batch the job's own batch, never a page a person reads`,
    [limit],
  );
  let named = 0;
  for (const row of rows) {
    const rename = owners.renameOf(row.owner);
    // Every owner registers its rename in its module's events file, which the worker loads at
    // boot: one missing is a wiring fault, never a reason to name a place and leave its line.
    if (!rename) throw new Error(`places: ${row.owner} has no rename; its module's events file is not loaded`);
    let found;
    try {
      found = await nearest(row.lat, row.lon);
    } catch {
      return { named, stopped: true };
    }
    const place = {
      formatted: (found && found.formatted) || `${fixed(row.lat)}, ${fixed(row.lon)}`,
      details: row.details,
      lat: row.lat,
      lon: row.lon,
    };
    await tx(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE place SET formatted = $2, provider_id = $3, kind = $4, city = $5, state = $6,
                          country_code = $7, verified = true, pending = false, named_at = now()
          WHERE place_id = $1 AND pending`,
        [
          row.place_id,
          place.formatted,
          (found && found.place_id) || null,
          (found && found.kind) || "unknown",
          (found && found.city) || null,
          (found && found.state) || null,
          (found && found.country_code) || null,
        ],
      );
      if (!rowCount) return;
      await rename(client, row.owner_key, lineOf(place));
      await emit(client, { key: "place.named", entity: { type: "place", id: row.place_id }, payload: { owner: row.owner } });
      named += 1;
    });
  }
  return { named, stopped: false };
}

module.exports = { save, remove, view, views, viewOf, lineOf, nameWaiting, WRONG_LEVEL };
