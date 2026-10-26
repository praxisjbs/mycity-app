"use strict";
/**
 * Home · Alerts, the SQL: the alerts a reader may see (the list, one alert, the counts) and
 * the rules that raise them (docs/guides/home.md §4, §5, §6 Alerts). Never emits
 * (BACKEND_GUIDE §2). An alert is written only by the shared alert engine
 * (src/shared/alerts/alerts.js); this file writes rules, and nothing else.
 *
 * WHO SEES AN ALERT is one condition, `seenWhere()`, used by the list, one alert, the
 * counts, the Overview's alerts beside Need You and its Open High Alerts card, ⌘K and the
 * assistant, so they can never disagree. An alert is seen by whoever may clear its rule's
 * alerts (the rule's permission_key, as alerts.mayClear() reads it), about a person within
 * their scope on that grant; an alert about no one in particular only with `all` scope; never
 * an alert about the reader themselves, the CEO excepted. The service works out the grants
 * the reader holds and who the reader is (`seen`); this file turns them into SQL.
 *
 * THE KEPT RULES. The rules the system keeps for the Attendance policy (metric
 * `attendance_policy`, home.md §6 Alerts) are made here (keptRule) on their first breach and never
 * listed on Alert Rules, edited or swept: rulePage and enabledRules leave them out.
 */
const c = require("@mycity/contract");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");

const POLICY_METRIC = c.alerts.HOME_ALERT_POLICY_METRIC;

const one = async (db, sql, params) => (await db.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------------ *
 * Who sees an alert
 * ------------------------------------------------------------------ */

const ALERTS_FROM = `FROM home_alert a
  JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id`;

/**
 * The grants the rules ask for: every permission_key in use, a handful (a module and an
 * action each), so the service asks the reader's scope on each once.
 * @param {{query: Function}} db
 * @returns {Promise<string[]>}
 */
async function permissionKeys(db) {
  // pagination:complete the distinct grants alert rules use: at most one per module and action
  const { rows } = await completeQuery(
    db,
    "SELECT DISTINCT permission_key FROM home_alert_rule ORDER BY permission_key",
    [],
    { label: "alert rule grants", ceiling: 200 },
  );
  return rows.map((r) => r.permission_key);
}

/**
 * The alerts a reader may see, as a condition on `a` (home_alert) and `r` (home_alert_rule)
 * that appends its values to `params`. An alert about the reader is left out: nobody but the
 * CEO sees or clears an alert about themselves (alerts.mayClear()).
 * @param {{all: boolean, grants: Array<{permission_key: string, scope: {scope: string, scope_ids: string[]|null}}>,
 *          self?: string|null}} seen  self: the reader's own employee_id
 * @param {Array} params
 * @returns {string}  "true" for the CEO, "false" for a reader who holds none of the grants
 */
function seenWhere(seen, params) {
  if (seen.all) return "true";
  const parts = seen.grants.map(({ permission_key: key, scope }) => {
    params.push(key);
    const k = `$${params.length}`;
    const s = scopeClause(scope, { column: "a.subject_employee_id" }, params);
    return `(r.permission_key = ${k} ${s.and})`;
  });
  if (!parts.length) return "false";
  if (!seen.self) return `(${parts.join(" OR ")})`;
  params.push(seen.self);
  return `((${parts.join(" OR ")}) AND a.subject_employee_id IS DISTINCT FROM $${params.length}::uuid)`;
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

const OPEN = "a.cleared_at IS NULL";

const ALERT_SELECT = `SELECT a.home_alert_id, a.home_alert_rule_id, r.name AS rule_name, r.metric, a.subject_type,
       a.subject_id, a.subject_employee_id, a.title, a.trigger, a.severity, a.over_by, r.threshold::text AS threshold,
       r.permission_key, a.raised_at, a.last_seen_at, a.escalated_at, a.cleared_at, a.cleared_by,
       NULLIF(trim(concat_ws(' ', ce.first_name, ce.last_name)), '') AS cleared_by_name, a.outcome, a.note`;

const ALERT_JOINS = `${ALERTS_FROM}
  LEFT JOIN app_user cu ON cu.user_id = a.cleared_by
  LEFT JOIN employee ce ON ce.employee_id = cu.employee_id`;

/** High first when sorted by severity going down. */
const SEVERITY_RANK = "CASE a.severity WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END";

/** The SQL for each field HomeAlertQuery sorts by; `cleared_at` is the closed lists' own default. */
const ALERT_SORTS = { raised_at: "a.raised_at", severity: SEVERITY_RANK, cleared_at: "a.cleared_at" };

/** Each state as a condition on `a`. */
const STATE = Object.freeze({
  open: OPEN,
  cleared: "a.outcome = 'cleared'",
  dismissed: "a.outcome = 'dismissed'",
});

/**
 * One page of the alerts a reader may see: open ones newest first unless `state` asks for
 * the cleared or the dismissed (most recently closed first).
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {object} query  a validated HomeAlertQuery
 * @param {{metrics: string[]|null, mine: boolean, agedBefore: Date}} opts
 *   metrics: the category's metrics, or null for every one; mine: open alerts only, the ones
 *   the reader may clear (the service has checked they may clear at all); agedBefore: raised
 *   at or before it is overdue
 */
function alertPage(db, seen, query, { metrics, mine, agedBefore }) {
  const state = query.state || "open";
  const params = [
    query.q || null,
    query.severity || null,
    metrics,
    query.home_alert_rule_id || null,
    query.overdue === "true" ? agedBefore : null,
  ];
  const seenSql = seenWhere(seen, params);
  const sort = query.sort || { field: state === "open" ? "raised_at" : "cleared_at", dir: "desc" };
  return pageQuery(
    db,
    `${ALERT_SELECT}, ${TOTAL_COL}
       ${ALERT_JOINS}
      WHERE ${STATE[state]} AND ${seenSql}
        ${mine ? `AND ${OPEN}` : ""}
        AND ($1::text IS NULL OR search_fold(a.title || ' ' || coalesce(a.trigger, '')) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR a.severity = $2)
        AND ($3::text[] IS NULL OR r.metric = ANY($3::text[]))
        AND ($4::uuid IS NULL OR a.home_alert_rule_id = $4::uuid)
        AND ($5::timestamptz IS NULL OR (${OPEN} AND a.raised_at <= $5::timestamptz))
      ORDER BY ${orderBy({ sort }, ALERT_SORTS, "a.home_alert_id")}`,
    params,
    query,
  );
}

/**
 * One alert the reader may see, in any state, or null.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {string} id
 */
function alertById(db, seen, id) {
  const params = [id];
  const seenSql = seenWhere(seen, params);
  return one(db, `${ALERT_SELECT} ${ALERT_JOINS} WHERE a.home_alert_id = $1 AND ${seenSql}`, params);
}

/**
 * Over the alerts the reader may see: the open ones, those open since before `agedBefore`,
 * and those cleared (not dismissed) since `clearedSince`; with `severity`, open ones of that
 * severity only.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {{agedBefore: Date, clearedSince?: Date|null, severity?: string|null}} opts
 * @returns {Promise<{open: number, overdue: number, cleared: number}>}
 */
function counts(db, seen, { agedBefore, clearedSince = null, severity = null }) {
  const params = [agedBefore, clearedSince, severity];
  const seenSql = seenWhere(seen, params);
  return one(
    db,
    `SELECT count(*) FILTER (WHERE ${OPEN})::int AS open,
            count(*) FILTER (WHERE ${OPEN} AND a.raised_at <= $1::timestamptz)::int AS overdue,
            count(*) FILTER (WHERE a.outcome = 'cleared' AND a.cleared_at >= $2::timestamptz)::int AS cleared
       ${ALERTS_FROM}
      WHERE ${seenSql} AND ($3::text IS NULL OR a.severity = $3)
        AND (${OPEN} OR ($2::timestamptz IS NOT NULL AND a.cleared_at >= $2::timestamptz))`,
    params,
  );
}

/**
 * How many alerts the reader may see, by the rule's metric: the open ones, or every one
 * raised since `raisedSince` whatever became of it. One row a metric in use, a handful.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {{raisedSince?: Date|null}} [opts]  open alerts when absent
 * @returns {Promise<Array<{metric: string, count: number}>>}
 */
async function byMetric(db, seen, { raisedSince = null } = {}) {
  const params = [raisedSince];
  const seenSql = seenWhere(seen, params);
  // pagination:complete one row per metric rules use, the nine of the registry and any kept from before it
  const { rows } = await completeQuery(
    db,
    `SELECT r.metric, count(*)::int AS count
       ${ALERTS_FROM}
      WHERE ${seenSql}
        AND (CASE WHEN $1::timestamptz IS NULL THEN ${OPEN} ELSE a.raised_at >= $1::timestamptz END)
      GROUP BY r.metric
      ORDER BY count(*) DESC, r.metric`,
    params,
    { label: "alerts by metric", ceiling: 200 },
  );
  return rows;
}

/**
 * One page of the open alerts of a severity the reader may see, the longest open first: the
 * records behind the Open High Alerts card.
 * @param {{query: Function}} db
 * @param {object} seen  see seenWhere()
 * @param {{severity: string}} which
 * @param {{page?: number, q?: string, sort?: object}} query
 */
function openPage(db, seen, { severity }, query) {
  const params = [query.q || null, severity];
  const seenSql = seenWhere(seen, params);
  return pageQuery(
    db,
    `SELECT a.home_alert_id, a.title, a.raised_at, a.over_by, r.metric, ${TOTAL_COL}
       ${ALERTS_FROM}
      WHERE ${OPEN} AND a.severity = $2 AND ${seenSql}
        AND ($1::text IS NULL OR search_fold(a.title) LIKE '%' || search_fold($1) || '%')
      ORDER BY ${orderBy(query, { raised_at: "a.raised_at" }, "a.home_alert_id")}`,
    params,
    query,
  );
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

const RULE_SELECT = `SELECT r.home_alert_rule_id, r.key::text AS key, r.name, r.metric, r.threshold::text AS threshold,
       r.window_days, r.severity, r.permission_key, r.enabled, r.created_by, r.updated_by, r.created_at, r.updated_at,
       (SELECT count(*)::int FROM home_alert a WHERE a.home_alert_rule_id = r.home_alert_rule_id AND a.cleared_at IS NULL)
         AS open_alerts`;

/** The SQL for each field HomeAlertRuleQuery sorts by. The first is the default order. */
const RULE_SORTS = { name: "lower(r.name)", created_at: "r.created_at" };

/**
 * One page of the rules: by name unless sorted otherwise.
 * @param {{query: Function}} db
 * @param {object} query  a validated HomeAlertRuleQuery
 * @param {{metrics: string[]|null}} opts  the category's metrics, or null for every one
 */
function rulePage(db, query, { metrics }) {
  return pageQuery(
    db,
    `${RULE_SELECT}, ${TOTAL_COL}
       FROM home_alert_rule r
      WHERE ($1::text IS NULL OR search_fold(r.name || ' ' || r.key::text) LIKE '%' || search_fold($1) || '%')
        AND ($2::text IS NULL OR r.metric = $2)
        AND ($3::text[] IS NULL OR r.metric = ANY($3::text[]))
        AND ($4::boolean IS NULL OR r.enabled = $4)
        AND r.metric <> $5
      ORDER BY ${orderBy(query, RULE_SORTS, "r.home_alert_rule_id")}`,
    [query.q || null, query.metric || null, metrics, query.enabled === undefined ? null : query.enabled === "true", POLICY_METRIC],
    query,
  );
}

/**
 * One rule, or null.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {{lock?: boolean}} [opts]  lock: hold the row for the rest of the transaction
 */
function ruleById(db, id, { lock = false } = {}) {
  return one(
    db,
    `${RULE_SELECT} FROM home_alert_rule r WHERE r.home_alert_rule_id = $1${lock ? " FOR UPDATE OF r" : ""}`,
    [id],
  );
}

/**
 * The keys already taken that a new rule's key could collide with: `base` itself and
 * `base_<n>`. Keys compare without case (citext).
 * @param {{query: Function}} db
 * @param {string} base  lower case
 * @returns {Promise<string[]>}
 */
async function keysLike(db, base) {
  // pagination:complete the keys one rule name has produced, a handful
  const { rows } = await completeQuery(
    db,
    `SELECT lower(key::text) AS key FROM home_alert_rule
      WHERE lower(key::text) = $1 OR starts_with(lower(key::text), $1 || '_')
      ORDER BY 1`,
    [base],
    { label: "alert rule keys", ceiling: 1000 },
  );
  return rows.map((r) => r.key);
}

/**
 * A new rule under `key`, or null when the key was taken meanwhile.
 * @param {{query: Function}} db
 * @param {{key: string, name: string, metric: string, threshold: string, window_days: number|null,
 *          severity: string, permission_key: string, created_by: string|null}} rule
 * @returns {Promise<string|null>} its id
 */
async function insertRule(db, rule) {
  const row = await one(
    db,
    `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, enabled,
                                  created_by, updated_by)
     VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, true, $8, $8)
     ON CONFLICT (key) DO NOTHING
     RETURNING home_alert_rule_id`,
    [
      rule.key,
      rule.name,
      rule.metric,
      rule.threshold,
      rule.window_days,
      rule.severity,
      rule.permission_key,
      rule.created_by,
    ],
  );
  return row ? row.home_alert_rule_id : null;
}

/** The columns a rule's change may set, and their casts. */
const RULE_COLUMNS = Object.freeze({
  name: "",
  threshold: "::numeric",
  window_days: "::int",
  severity: "",
  permission_key: "",
  enabled: "::boolean",
});

/**
 * Change a rule's fields, and record who changed it.
 * @param {{query: Function}} db
 * @param {string} id
 * @param {Partial<Record<keyof RULE_COLUMNS, *>>} changes  only the fields that change
 * @param {string|null} updatedBy
 */
async function updateRule(db, id, changes, updatedBy) {
  const params = [id, updatedBy];
  const sets = Object.entries(changes).map(([column, value]) => {
    if (!Object.prototype.hasOwnProperty.call(RULE_COLUMNS, column))
      throw new Error(`alerts.repo.updateRule: "${column}" is not a rule field`);
    params.push(value);
    return `${column} = $${params.length}${RULE_COLUMNS[column]}`;
  });
  await db.query(
    `UPDATE home_alert_rule SET ${sets.join(", ")}, updated_by = $2, updated_at = now()
      WHERE home_alert_rule_id = $1`,
    params,
  );
}

/**
 * Every switched-on rule, a sweep's list: tens of rows, rules being a business's own few.
 * @param {{query: Function}} db
 */
async function enabledRules(db) {
  // pagination:complete the switched-on alert rules a sweep runs, tens of rows
  const { rows } = await completeQuery(
    db,
    `SELECT home_alert_rule_id, key::text AS key, name, metric, threshold::text AS threshold, window_days, severity,
            permission_key, enabled
       FROM home_alert_rule
      WHERE enabled AND metric <> $1
      ORDER BY key, home_alert_rule_id`,
    [POLICY_METRIC],
    { label: "switched-on alert rules", ceiling: 1000 },
  );
  return rows;
}

/**
 * The rule the system keeps for one of the Attendance policy's consequence rules, made the first
 * time it is needed (home.md §6 Alerts): threshold 1, no window, its severity and Who Can Clear,
 * switched on, by nobody. Made at the same moment by another breach, it is read as that one made it.
 * @param {{query: Function}} db  inside the raise's transaction
 * @param {{key: string, name: string, threshold: string, severity: string, permission_key: string}} rule
 */
async function keptRule(db, rule) {
  await db.query(
    `INSERT INTO home_alert_rule (key, name, metric, threshold, window_days, severity, permission_key, enabled)
     VALUES ($1, $2, $3, $4::numeric, NULL, $5, $6, true)
     ON CONFLICT (key) DO NOTHING`,
    [rule.key, rule.name, POLICY_METRIC, rule.threshold, rule.severity, rule.permission_key],
  );
  return one(
    db,
    `SELECT home_alert_rule_id, key::text AS key, name, metric, threshold::text AS threshold, window_days, severity,
            permission_key, enabled
       FROM home_alert_rule WHERE key = $1 AND metric = $2`,
    [rule.key, POLICY_METRIC],
  );
}

/**
 * The open alerts of each kept rule of a metric, by the rule's key: the Attendance policy's five,
 * for Alert Rules' read-only card.
 * @param {{query: Function}} db
 * @param {string} metric
 * @returns {Promise<Record<string, number>>}
 */
async function openByKey(db, metric) {
  // pagination:complete one count per kept rule of the metric, five at most
  const { rows } = await completeQuery(
    db,
    `SELECT r.key::text AS key, count(a.home_alert_id)::int AS n
       FROM home_alert_rule r
       LEFT JOIN home_alert a ON a.home_alert_rule_id = r.home_alert_rule_id AND a.cleared_at IS NULL
      WHERE r.metric = $1
      GROUP BY r.key
      ORDER BY r.key`,
    [metric],
    { label: "open alerts of the kept rules", ceiling: 20 },
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

/** Each of these alerts' rule metric, and whether it is open: where it waits on Home · Alerts (alerts.views.js). */
async function placesOf(db, ids) {
  const { rows } = await db.query(
    `SELECT a.home_alert_id AS id, r.metric, (${OPEN}) AS open, a.outcome
       FROM home_alert a
       JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
      WHERE a.home_alert_id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

module.exports = {
  placesOf,
  permissionKeys,
  seenWhere,
  alertPage,
  alertById,
  counts,
  byMetric,
  openPage,
  rulePage,
  ruleById,
  keysLike,
  insertRule,
  updateRule,
  enabledRules,
  keptRule,
  openByKey,
};
