"use strict";
/**
 * What Settings · Performance is judged against, and the levels Status's resource checks
 * alarm at (docs/guides/system-health.md §6). One row, written by Edit Targets; while
 * nobody has saved one, the defaults below are in force, so nothing is seeded (A26).
 *
 *   const levels = await targets.levels();   // Status's checks: cached 60 seconds
 *   const current = await targets.current(); // the screen: always read
 *
 * The readiness checks call `levels()` on every probe, from the API and the worker, so it
 * is kept for a minute and never throws: a database that is down still has its disk and
 * memory checked, at the defaults.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { EVENTS } = require("./system_health.events");

/** The defaults, as TB set them on 20/10/2026: 99.9% up, p95 under 800 ms, under 1% failing. */
const DEFAULTS = Object.freeze({
  availability_pct: "99.90",
  response_p95_ms: 800,
  error_pct: "1.00",
  disk_warn_free_pct: 10,
  disk_down_free_pct: 5,
  memory_warn_pct: 90,
  memory_down_pct: 95,
  cpu_warn_pct: 85,
  cpu_down_pct: 95,
  connections_warn_pct: 80,
  connections_down_pct: 90,
});

const KEYS = Object.keys(DEFAULTS);
const CACHE_MS = 60_000;

let cached = null;
let cachedAt = 0;

/** The row as the wire carries it: numerics as strings with two places, the rest as numbers. */
function present(row) {
  const out = {};
  for (const key of KEYS) {
    const v = row && row[key] !== undefined && row[key] !== null ? row[key] : DEFAULTS[key];
    out[key] = typeof DEFAULTS[key] === "string" ? Number(v).toFixed(2) : Number(v);
  }
  return {
    ...out,
    updated_at: row && row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updated_by_name: (row && row.updated_by_name) || null,
  };
}

async function read(db) {
  const { rows } = await db.query(
    `SELECT t.*, trim(e.first_name || ' ' || e.last_name) AS updated_by_name
       FROM performance_target t
       LEFT JOIN app_user u ON u.user_id = t.updated_by
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE t.singleton
      LIMIT 1`,
  );
  return rows[0] || null;
}

/** GET /system-health/targets: the saved row, or the defaults. */
async function current(db = pool) {
  return present(await read(db));
}

/**
 * The levels the readiness checks use. Cached for a minute and never throws: when the
 * table cannot be read (the database is down, or 9120 has not run) the defaults apply.
 */
async function levels() {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  try {
    cached = present(await read(pool));
  } catch {
    cached = cached || present(null);
  }
  cachedAt = Date.now();
  return cached;
}

/** PUT /system-health/targets: all eleven at once, audited through the event. */
async function save(body, actor) {
  const client = await pool.connect();
  try {
    const saved = await atomically(client, async () => {
      const before = await current(client);
      const values = KEYS.map((k) => body[k]);
      await client.query(
        `INSERT INTO performance_target (singleton, ${KEYS.join(", ")}, updated_by)
         VALUES (true, ${KEYS.map((_, i) => `$${i + 1}`).join(", ")}, $${KEYS.length + 1})
         ON CONFLICT (singleton) DO UPDATE SET
           ${KEYS.map((k) => `${k} = EXCLUDED.${k}`).join(",\n           ")},
           updated_by = EXCLUDED.updated_by`,
        [...values, actor.user_id],
      );
      const after = await current(client);
      await emit(client, {
        key: EVENTS.SYSTEM_HEALTH_TARGETS_CHANGED,
        entity: { type: "performance_target", id: "organisation" },
        actor,
        before,
        after,
        payload: { changed: KEYS.filter((k) => String(before[k]) !== String(after[k])) },
      });
      return after;
    });
    // The next probe reads what was just saved, not the minute-old copy.
    cached = null;
    return saved;
  } finally {
    client.release();
  }
}

/** Tests only. */
function __reset() {
  cached = null;
  cachedAt = 0;
}

module.exports = { DEFAULTS, current, levels, save, present, __reset };
