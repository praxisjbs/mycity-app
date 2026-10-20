"use strict";
/**
 * Integrations' SQL (migrations 0090, 9000, 9200, 9210, 9220; docs/guides/integrations.md §4):
 * each connection's saved settings, plan and state, its secrets as far as they are ever shown,
 * its checks and its use, the AI connections' model lists and the exchange rates.
 *
 * A secret's ciphertext is written here and never read back here: shared/integrations/
 * settings.js is its one reader. The state columns are shared/integrations/state.js's.
 */
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/** A person's name as the Audit Log shows it, from a user id column. */
const NAME = (alias) => `trim(${alias}.first_name || ' ' || ${alias}.last_name)`;

/* ------------------------------------------------------------------ *
 * Connections
 * ------------------------------------------------------------------ */

const CONNECTION = `c.integration_connection_id, c.code::text AS code, c.provider, c.display_name,
  c.status, c.configuration, c.saved_at, c.saved_by, c.daily_limit, c.plan, c.state_at, c.last_checked_at,
  c.last_ok_at, c.last_error_code, c.quota_warned_on, c.updated_at`;

/**
 * Every connection that has a row, with today's units: the registry's handful, merged with
 * it whole by the service.
 * @param {{query: Function}} db
 * @param {string} day  today, Lagos
 */
async function connections(db, day) {
  // pagination:complete one row per connection of the registry, a handful, merged with it whole
  const { rows } = await completeQuery(
    db,
    `SELECT ${CONNECTION},
            COALESCE((SELECT SUM(u.units) FROM integration_usage u
                       WHERE u.integration_connection_id = c.integration_connection_id AND u.day = $1::date), 0)::float8 AS units_today
       FROM integration_connection c
      ORDER BY c.code`,
    [day],
    { label: "integration connections", ceiling: 100 },
  );
  return rows;
}

/** One connection's row with who saved it, or null when it has none yet. */
function connection(db, code) {
  return one(
    db,
    `SELECT ${CONNECTION}, ${NAME("se")} AS saved_by_name
       FROM integration_connection c
       LEFT JOIN app_user su ON su.user_id = c.saved_by
       LEFT JOIN employee se ON se.employee_id = su.employee_id
      WHERE c.code = $1`,
    [code],
  );
}

/** The row, locked for a save or a removal. */
function connectionForUpdate(db, code) {
  return one(db, `SELECT ${CONNECTION} FROM integration_connection c WHERE c.code = $1 FOR UPDATE`, [code]);
}

/** Keep a save: the configuration, who saved it and when, the daily limit and the plan. */
function saveConnection(db, { code, provider, name, configuration, daily_limit, plan = null, by }) {
  return one(
    db,
    `INSERT INTO integration_connection (code, provider, display_name, configuration, saved_at, saved_by, daily_limit, plan)
     VALUES ($1, $2, $3, $4::jsonb, now(), $5, $6, $7)
     ON CONFLICT (code) DO UPDATE SET
       provider = EXCLUDED.provider,
       display_name = EXCLUDED.display_name,
       configuration = EXCLUDED.configuration,
       saved_at = EXCLUDED.saved_at,
       saved_by = EXCLUDED.saved_by,
       daily_limit = EXCLUDED.daily_limit,
       plan = EXCLUDED.plan
     RETURNING ${CONNECTION.replace(/c\./g, "")}`,
    [code, provider, name, JSON.stringify(configuration), by || null, daily_limit ?? null, plan],
  );
}

/** Forget a save: the server file applies again. The row and its history stay. */
function clearSaved(db, code) {
  return one(
    db,
    `UPDATE integration_connection
        SET configuration = '{}'::jsonb, saved_at = NULL, saved_by = NULL, daily_limit = NULL, plan = NULL
      WHERE code = $1
      RETURNING integration_connection_id, configuration, saved_at`,
    [code],
  );
}

/* ------------------------------------------------------------------ *
 * Secrets: written here, never read back here
 * ------------------------------------------------------------------ */

/** What may be shown of a connection's secrets: set or not, the hint, who and when. */
async function secretStates(db, code) {
  const { rows } = await db.query(
    `SELECT s.key, (s.active AND s.ciphertext <> '') AS set, s.hint,
            COALESCE(s.rotated_at, s.created_at) AS set_at, ${NAME("e")} AS set_by_name
       FROM integration_secret s
       LEFT JOIN app_user u ON u.user_id = COALESCE(s.set_by, s.created_by)
       LEFT JOIN employee e ON e.employee_id = u.employee_id
      WHERE s.provider = $1`,
    [code],
  );
  return rows;
}

/** Keep one secret, encrypted by the caller; replaces what was there. */
function putSecret(db, { code, key, ciphertext, hint, by }) {
  return db.query(
    `INSERT INTO integration_secret (provider, key, ciphertext, hint, set_by, created_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (provider, key) DO UPDATE SET
       ciphertext = EXCLUDED.ciphertext,
       hint = EXCLUDED.hint,
       set_by = EXCLUDED.set_by,
       active = true,
       rotated_at = now()`,
    [code, key, ciphertext, hint, by || null],
  );
}

/** Delete a connection's secrets, except those kept whatever is saved (a key pair the app made). */
function dropSecrets(db, code, keep = []) {
  return db.query("DELETE FROM integration_secret WHERE provider = $1 AND NOT (key = ANY($2::text[]))", [code, keep]);
}

/* ------------------------------------------------------------------ *
 * Checks
 * ------------------------------------------------------------------ */

const CHECK = `k.integration_check_id, c.code::text AS code, k.kind, k.ok, k.steps, k.error_code,
  k.checked_by, ${NAME("ke")} AS checked_by_name, k.created_at`;
const CHECK_FROM = `integration_check k
  JOIN integration_connection c ON c.integration_connection_id = k.integration_connection_id
  LEFT JOIN app_user ku ON ku.user_id = k.checked_by
  LEFT JOIN employee ke ON ke.employee_id = ku.employee_id`;

function insertCheck(db, { connectionId, kind, ok, steps, error_code, by }) {
  return one(
    db,
    `INSERT INTO integration_check (integration_connection_id, kind, ok, steps, error_code, checked_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING integration_check_id`,
    [connectionId, kind, ok, JSON.stringify(steps), error_code || null, by || null],
  );
}

function checkById(db, id) {
  return one(db, `SELECT ${CHECK} FROM ${CHECK_FROM} WHERE k.integration_check_id = $1`, [id]);
}

/** The newest check of a connection, or null. */
function lastCheck(db, connectionId) {
  return one(
    db,
    `SELECT ${CHECK} FROM ${CHECK_FROM}
      WHERE k.integration_connection_id = $1
      ORDER BY k.created_at DESC, k.integration_check_id DESC
      LIMIT 1`,
    [connectionId],
  );
}

const CHECK_SORTS = { created_at: "k.created_at DESC" };

/** A connection's checks, newest first, 25 a page. Filters: kind, ok. */
function checkPage(db, connectionId, query) {
  return pageQuery(
    db,
    `SELECT ${CHECK}, ${TOTAL_COL}
       FROM ${CHECK_FROM}
      WHERE k.integration_connection_id = $1
        AND ($2::text IS NULL OR k.kind = $2)
        AND ($3::boolean IS NULL OR k.ok = $3)
      ORDER BY ${orderBy(query, CHECK_SORTS, "k.integration_check_id DESC")}`,
    [connectionId, query.kind || null, query.ok === undefined ? null : query.ok === "true"],
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Use
 * ------------------------------------------------------------------ */

/** Each day from `from` to `to` (Lagos), every kind added together; days with no use are absent. */
async function usageDays(db, connectionId, from, to) {
  // pagination:complete one row per day of a seven-day chart
  const { rows } = await completeQuery(
    db,
    `SELECT to_char(u.day, 'YYYY-MM-DD') AS day, SUM(u.calls)::int AS calls, SUM(u.failures)::int AS failures,
            SUM(u.units)::float8 AS units
       FROM integration_usage u
      WHERE u.integration_connection_id = $1 AND u.day BETWEEN $2::date AND $3::date
      GROUP BY u.day
      ORDER BY u.day`,
    [connectionId, from, to],
    { label: "a connection's week of use", ceiling: 31 },
  );
  return rows;
}

/** Set today's warning once: true for the one caller that set it. */
async function markWarned(db, code, day) {
  const row = await one(
    db,
    `UPDATE integration_connection SET quota_warned_on = $2::date
      WHERE code = $1 AND quota_warned_on IS DISTINCT FROM $2::date
      RETURNING integration_connection_id`,
    [code, day],
  );
  return row ? row.integration_connection_id : null;
}

/** Checks past 90 days and use past 30 go (guide §3 step 13). */
async function purge(db, { checkDays = 90, usageDays: keepDays = 30 } = {}) {
  const checks = await db.query("DELETE FROM integration_check WHERE created_at < now() - make_interval(days => $1)", [checkDays]);
  const usage = await db.query("DELETE FROM integration_usage WHERE day < (now() AT TIME ZONE 'Africa/Lagos')::date - $1::int", [keepDays]);
  return { checks: checks.rowCount, usage: usage.rowCount };
}

/* ------------------------------------------------------------------ *
 * The model list of an AI connection (ai_model, 9210)
 * ------------------------------------------------------------------ */

const MODEL = `m.ai_model_id, m.provider, m.model::text AS model, m.display_name, m.capabilities, m.available,
  m.source, m.endpoint_url, m.input_usd_per_million::text AS input_usd_per_million,
  m.output_usd_per_million::text AS output_usd_per_million, m.audio_usd_per_million::text AS audio_usd_per_million,
  m.usd_per_audio_hour::text AS usd_per_audio_hour, m.seen_at, ${NAME("me")} AS added_by_name, m.created_at`;
const MODEL_FROM = `ai_model m
  LEFT JOIN app_user mu ON mu.user_id = m.added_by
  LEFT JOIN employee me ON me.employee_id = mu.employee_id`;

/** Usable first (the key can use it, or it is not known yet), then by name. */
const MODEL_SORTS = { display_name: "(m.available IS FALSE), m.display_name" };

/** One provider's models, 25 a page. Filters: capability, available, q (id or name). */
function modelPage(db, provider, query) {
  return pageQuery(
    db,
    `SELECT ${MODEL}, ${TOTAL_COL}
       FROM ${MODEL_FROM}
      WHERE m.provider = $1
        AND ($2::text IS NULL OR $2 = ANY(m.capabilities))
        AND ($3::boolean IS NULL OR m.available IS NOT DISTINCT FROM $3)
        AND ($4::text IS NULL OR search_fold(m.model || ' ' || m.display_name) LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, MODEL_SORTS, "m.ai_model_id")}`,
    [provider, query.capability || null, query.available === undefined ? null : query.available === "true", query.q || null],
    query,
  );
}

function modelById(db, provider, id) {
  return one(db, `SELECT ${MODEL} FROM ${MODEL_FROM} WHERE m.provider = $1 AND m.ai_model_id = $2`, [provider, id]);
}

/** How many models a provider's list holds, and how many the key in use can use. */
function modelCounts(db, provider) {
  return one(
    db,
    `SELECT count(*)::int AS models, count(*) FILTER (WHERE available)::int AS available
       FROM ai_model WHERE provider = $1`,
    [provider],
  );
}

/**
 * Keep what a key's list says (a save or a test): each model on it is available and seen now,
 * and joins the list when it is new; a model it no longer names is not available, except one
 * added by hand with its own endpoint, which the provider's list cannot speak for. A seeded or
 * hand-added model keeps its name; a model the provider added takes the provider's.
 * @param {{query: Function}} db
 * @param {string} provider
 * @param {Array<{model: string, display_name: string, capabilities: string[]}>} models
 */
async function keepModels(db, provider, models) {
  if (models.length)
    await db.query(
      `INSERT INTO ai_model (provider, model, display_name, capabilities, source, available, seen_at)
       SELECT $1, x.model, x.display_name, string_to_array(x.capabilities, ','), 'provider', true, now()
         FROM unnest($2::text[], $3::text[], $4::text[]) AS x (model, display_name, capabilities)
       ON CONFLICT (provider, model) DO UPDATE SET
         available = true,
         seen_at = now(),
         display_name = CASE WHEN ai_model.source = 'provider' THEN EXCLUDED.display_name ELSE ai_model.display_name END`,
      [
        provider,
        models.map((m) => m.model),
        models.map((m) => m.display_name),
        models.map((m) => m.capabilities.join(",")),
      ],
    );
  await db.query(
    `UPDATE ai_model SET available = false
      WHERE provider = $1
        AND NOT (model = ANY($2::citext[]))
        AND NOT (source = 'added' AND endpoint_url IS NOT NULL)
        AND available IS DISTINCT FROM false`,
    [provider, models.map((m) => m.model)],
  );
}

/** Add Model. Null when the provider's list already holds that id. */
function addModel(db, { provider, model, display_name, capabilities, endpoint_url, by }) {
  return one(
    db,
    `INSERT INTO ai_model (provider, model, display_name, capabilities, source, endpoint_url, added_by)
     VALUES ($1, $2, $3, $4::text[], 'added', $5, $6)
     ON CONFLICT (provider, model) DO NOTHING
     RETURNING ai_model_id`,
    [provider, model, display_name, capabilities, endpoint_url, by || null],
  );
}

/** Remove a model added by hand; a seeded or listed one stays. Its row, or null. */
function removeModel(db, provider, id) {
  return one(
    db,
    `DELETE FROM ai_model WHERE provider = $1 AND ai_model_id = $2 AND source = 'added'
     RETURNING ai_model_id, model::text AS model, display_name`,
    [provider, id],
  );
}

/* ------------------------------------------------------------------ *
 * Exchange rates (exchange_rate, 9220): written here, read by shared/money/fx.js
 * ------------------------------------------------------------------ */

/**
 * Keep one fetched table for a Lagos day; a second fetch the same day replaces it.
 * @param {{query: Function}} db
 * @param {{day: string, base: string, rates: Record<string, string>, updated_at: Date|null}} t
 */
async function putRates(db, { day, base, rates, updated_at }) {
  const codes = Object.keys(rates);
  if (!codes.length) return 0;
  const r = await db.query(
    `INSERT INTO exchange_rate (day, base, currency, rate, provider_updated_at)
     SELECT $1::date, $2, x.currency, x.rate::numeric, $5
       FROM unnest($3::text[], $4::text[]) AS x (currency, rate)
     ON CONFLICT (day, base, currency) DO UPDATE SET
       rate = EXCLUDED.rate,
       provider_updated_at = EXCLUDED.provider_updated_at`,
    [day, base, codes, codes.map((c) => rates[c]), updated_at],
  );
  return r.rowCount;
}

/** Has today's table been kept? */
async function hasRates(db, day, base = "USD") {
  return Boolean(await one(db, "SELECT 1 AS yes FROM exchange_rate WHERE day = $1::date AND base = $2 LIMIT 1", [day, base]));
}

module.exports = {
  connections,
  connection,
  connectionForUpdate,
  saveConnection,
  clearSaved,
  secretStates,
  putSecret,
  dropSecrets,
  insertCheck,
  checkById,
  lastCheck,
  checkPage,
  usageDays,
  markWarned,
  purge,
  modelPage,
  modelById,
  modelCounts,
  keepModels,
  addModel,
  removeModel,
  putRates,
  hasRates,
};
