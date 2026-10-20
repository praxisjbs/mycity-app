"use strict";
/**
 * Has a connection on the Free plan used its daily limit? (docs/guides/integrations.md §1.2
 * decisions 4 and 7). On Free the limit is a hard stop: the call is not made, and a chain (voice
 * note transcription) moves to its next provider. On Paid, or with no limit set, it never stops a
 * call; the limit counts and warns instead.
 *
 *   if (await quota.spent("groq")) skipToNext();
 *
 * Today's use is what is written (integration_usage, Lagos day) plus what this process has
 * counted and not yet written, so a burst of calls inside one flush still stops at the limit.
 * The row is read at most every 10 seconds per connection.
 */
const lagos = require("../time/lagos");
const providers = require("./providers");
const usage = require("./usage");

const TTL_MS = 10_000;
const cache = new Map();

const pool = () => require("../../config/db").pool;

/** The plan in force: the one IT set on the page, else the one the registry starts it on. */
const planOf = (def, row) => (def.limited ? (row && row.plan) || def.plan : null);

async function rowOf(db, code, day) {
  const hit = cache.get(code);
  if (hit && hit.day === day && Date.now() - hit.at < TTL_MS) return hit.row;
  let row = null;
  try {
    ({ rows: [row] } = await db.query(
      `SELECT c.plan, c.daily_limit,
              COALESCE((SELECT SUM(u.units) FROM integration_usage u
                         WHERE u.integration_connection_id = c.integration_connection_id AND u.day = $2::date), 0)::float8 AS units_today
         FROM integration_connection c WHERE c.code = $1`,
      [code, day],
    ));
  } catch (err) {
    if (!(err && (err.code === "42P01" || err.code === "42703"))) throw err;
  }
  cache.set(code, { at: Date.now(), day, row: row || null });
  return row || null;
}

/**
 * True when the connection is on the Free plan and today's use has reached its daily limit.
 * @param {string} code
 * @param {{db?: {query: Function}}} [opts]
 */
async function spent(code, { db } = {}) {
  const def = providers.get(code);
  if (!def.limited) return false;
  const day = lagos.today();
  const row = await rowOf(db || pool(), code, day);
  if (planOf(def, row) !== "free" || !row || !row.daily_limit) return false;
  const waiting = usage
    .pending()
    .filter((c) => c.code === code && c.day === day)
    .reduce((n, c) => n + c.units, 0);
  return Number(row.units_today) + waiting >= Number(row.daily_limit);
}

/** After a save changes a plan or a limit; tests. */
function forget(code) {
  if (code) cache.delete(code);
  else cache.clear();
}

module.exports = { spent, planOf, forget };
