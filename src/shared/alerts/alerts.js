"use strict";
/**
 * Alerts: work nobody has done yet. Not notifications (MILESTONES §18.1).
 *
 *   a notification  something happened to you; read once, then gone
 *   an alert        a threshold was crossed and someone must deal with it; it stays on
 *                   Home, Alerts and ages until a person allowed to clear it does
 *
 * Merging the two produces a list that cannot be cleared and is therefore ignored.
 *
 * Home owns the screen, the rules and the tables (docs/guides/home.md). This file is
 * the engine behind them, so every module raises alerts the same way. An owning
 * module emits its signal ("attendance.rule_breached"); Home's outbox handler reads
 * the matching rule and calls raise():
 *
 *   const alerts = require("../../shared/alerts/alerts");
 *
 *   await atomically(client, async () => {
 *     const rule = await alerts.ruleByKey(client, "attendance.late_arrivals");
 *     await alerts.raise(client, {
 *       rule,
 *       subject: { type: "employee", id: employeeId },
 *       value: 4,                                  // 4 late arrivals in the rule's window
 *       title: "Ada Obi: 4 late arrivals in 30 days",
 *       trigger: "Late on 2, 6, 9 and 13 October",
 *       subject_employee_id: employeeId,           // stored, and `team` holders above Ada are told
 *     });
 *   });
 *
 * Rules:
 *  - A rule is data (home_alert_rule): a metric, a threshold, a window, a severity
 *    and the permission that may clear it ("people.approve"). Changing a number needs
 *    no deploy.
 *  - One open alert per (rule, subject). Raising again while it is open updates how
 *    far past the threshold it is (over_by) and when it was last seen; it does not
 *    stack a second alert. After it is cleared, a new breach raises a new one.
 *  - Below the threshold nothing is raised. An alert never closes itself: a person
 *    clears it (dealt with) or dismisses it (not worth acting on), with a note.
 *  - Only the CEO or a holder of the rule's permission may clear or dismiss. Clearing
 *    twice is not an error; the second call returns the alert as it is.
 *  - A high alert left open 14 days escalates to the CEO once (escalateAged, run by
 *    the alert-ageing scheduler).
 *
 * Every raise, clear and escalation goes through emit(), so it is audited and the
 * people who can clear it are notified (shared/notifications/fanout.js).
 *
 * Tables (Home's M1 migration; BACKEND_STRUCTURE §11.1):
 *   home_alert_rule  home_alert_rule_id, key UNIQUE, metric, threshold numeric, window_days,
 *                    severity ('low' | 'medium' | 'high'), permission_key, enabled
 *   home_alert       home_alert_id, home_alert_rule_id, subject_type, subject_id, title, trigger,
 *                    severity, over_by numeric, raised_at, last_seen_at, escalated_at, cleared_at,
 *                    cleared_by, outcome ('cleared' | 'dismissed'), note, subject_employee_id (1150: the
 *                    employee the alert is about, which scopes Home's Alerts list; NULL when it is about
 *                    no one person);
 *                    UNIQUE (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL
 */
const { AppError } = require("../errors");
const { atomically, inTransaction } = require("../db/tx");
const { emit } = require("../events/emit");
const { ALERTS } = require("../events/catalogue");
const catalog = require("../access/access.catalog");
const grantsCache = require("../rbac/grants-cache");
const { scopeFromGrants } = require("../../middleware/rbac");

const SEVERITIES = ["low", "medium", "high"];
const ESCALATE_AFTER_DAYS = 14;
const OUTCOMES = new Set(["cleared", "dismissed"]);
const ALERT_COLUMNS = `home_alert_id, home_alert_rule_id, subject_type, subject_id, title, trigger, severity, over_by,
  raised_at, last_seen_at, escalated_at, cleared_at, cleared_by, outcome, note`;

/** "people.approve" → ["people", "approve"]; throws on anything else. */
function parsePermission(key) {
  const [module, action, extra] = String(key || "").split(".");
  if (
    extra !== undefined ||
    !catalog.isModule(module) ||
    !catalog.isAction(action)
  ) {
    throw new Error(
      `alerts: permission_key "${key}" is not "<module>.<action>" from the access catalogue`,
    );
  }
  return [module, action];
}

/**
 * Is `value` past the rule's threshold, and by how much? Counts, days and
 * percentages, compared to two decimal places.
 * @param {{threshold: string|number}} rule
 * @param {number|string} value
 * @returns {{breached: boolean, over_by: number}}
 */
function evaluate(rule, value) {
  const v = Number(value);
  const t = Number(rule.threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t))
    throw new Error("alerts.evaluate: value and threshold are numbers");
  const over = Math.round((v - t) * 100) / 100;
  return { breached: v >= t, over_by: over };
}

/** Whole days an alert has been open at `now`. */
function ageDays(alert, now = new Date()) {
  const raised = new Date(alert.raised_at).getTime();
  return Math.max(0, Math.floor((now.getTime() - raised) / 86_400_000));
}

/** An enabled rule by key, or null. */
async function ruleByKey(client, key) {
  const { rows } = await client.query(
    `SELECT home_alert_rule_id, key, metric, threshold, window_days, severity, permission_key, enabled
       FROM home_alert_rule WHERE key = $1 AND enabled = true`,
    [key],
  );
  return rows[0] || null;
}

function payloadOf(alert, rule, extra = {}) {
  return {
    rule_key: rule.key,
    title: alert.title,
    trigger: alert.trigger,
    severity: alert.severity,
    over_by: alert.over_by === null ? null : String(alert.over_by),
    subject_type: alert.subject_type,
    subject_id: alert.subject_id,
    clear_permission: parsePermission(rule.permission_key),
    ...extra,
  };
}

/**
 * Raise or refresh the alert for (rule, subject) when `value` crosses the threshold.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{rule: object, subject: {type: string, id: string}, value: number|string, title: string,
 *          trigger?: string, subject_employee_id?: string|null, actor?: object|null}} opts
 * @returns {Promise<{raised: boolean, created: boolean, alert: object|null}>}
 */
async function raise(
  client,
  {
    rule,
    subject,
    value,
    title,
    trigger = null,
    subject_employee_id: subjectEmployeeId = null,
    actor = null,
  },
) {
  if (!inTransaction(client))
    throw new Error("alerts.raise must run inside atomically()");
  if (!rule || !rule.home_alert_rule_id)
    throw new Error("alerts.raise: give the rule row (ruleByKey)");
  if (!rule.enabled) return { raised: false, created: false, alert: null };
  if (!subject || !subject.type || !subject.id)
    throw new Error("alerts.raise: subject { type, id } is required");
  if (!title || !String(title).trim())
    throw new Error("alerts.raise: title is required");
  if (!SEVERITIES.includes(rule.severity))
    throw new Error(
      `alerts.raise: rule ${rule.key} has severity "${rule.severity}"`,
    );
  parsePermission(rule.permission_key);

  const { breached, over_by: overBy } = evaluate(rule, value);
  if (!breached) return { raised: false, created: false, alert: null };

  const { rows } = await client.query(
    `INSERT INTO home_alert
       (home_alert_rule_id, subject_type, subject_id, title, trigger, severity, over_by, subject_employee_id,
        raised_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL
     DO UPDATE SET over_by = EXCLUDED.over_by, title = EXCLUDED.title, trigger = EXCLUDED.trigger,
                   subject_employee_id = COALESCE(EXCLUDED.subject_employee_id, home_alert.subject_employee_id),
                   last_seen_at = now()
     RETURNING ${ALERT_COLUMNS}, (xmax = 0) AS created`,
    [
      rule.home_alert_rule_id,
      subject.type,
      String(subject.id),
      String(title).trim(),
      trigger,
      rule.severity,
      overBy,
      subjectEmployeeId,
    ],
  );
  const { created, ...alert } = rows[0];
  if (created) {
    await emit(client, {
      key: ALERTS.HOME_ALERT_RAISED,
      entity: { type: "home_alert", id: alert.home_alert_id },
      actor,
      after: alert,
      payload: payloadOf(alert, rule, {
        subject_employee_id: subjectEmployeeId,
      }),
    });
  }
  return { raised: true, created, alert };
}

/**
 * May this user clear alerts of this rule? The CEO, or a holder of the rule's
 * permission (any scope).
 * @param {{query: Function}} client
 * @param {{user_id: string, role_ids?: string[], is_ceo?: boolean}} user
 * @param {{permission_key: string}} rule
 */
async function mayClear(client, user, rule) {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  const [module, action] = parsePermission(rule.permission_key);
  const rows = await grantsCache.getGrants(client, {
    role_ids: user.role_ids || [],
    module,
  });
  return Boolean(scopeFromGrants(rows, action));
}

/**
 * Clear (dealt with) or dismiss (not worth acting on) an open alert.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{alert_id: string, actor: object, outcome?: "cleared"|"dismissed", note?: string|null}} opts
 * @returns {Promise<object>} the alert
 */
async function clear(
  client,
  { alert_id: id, actor, outcome = "cleared", note = null },
) {
  if (!inTransaction(client))
    throw new Error("alerts.clear must run inside atomically()");
  if (!OUTCOMES.has(outcome))
    throw new AppError(
      "INVALID_OUTCOME",
      "An alert is cleared or dismissed",
      422,
    );
  const { rows } = await client.query(
    `SELECT a.home_alert_id, a.home_alert_rule_id, a.subject_type, a.subject_id, a.title, a.trigger, a.severity,
            a.over_by, a.raised_at, a.last_seen_at, a.escalated_at, a.cleared_at, a.cleared_by, a.outcome, a.note,
            r.key AS rule_key, r.permission_key
       FROM home_alert a JOIN home_alert_rule r ON r.home_alert_rule_id = a.home_alert_rule_id
      WHERE a.home_alert_id = $1
      FOR UPDATE OF a`,
    [id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "Alert not found", 404);
  const {
    rule_key: ruleKey,
    permission_key: permissionKey,
    ...before
  } = rows[0];
  const rule = { key: ruleKey, permission_key: permissionKey };
  if (!(await mayClear(client, actor, rule))) {
    throw new AppError("PERMISSION_DENIED", "You cannot clear this alert", 403);
  }
  if (before.cleared_at) return before;

  const { rows: done } = await client.query(
    `UPDATE home_alert SET cleared_at = now(), cleared_by = $2, outcome = $3, note = $4
      WHERE home_alert_id = $1
      RETURNING ${ALERT_COLUMNS}`,
    [id, actor.user_id, outcome, note ? String(note).trim() || null : null],
  );
  await emit(client, {
    key: ALERTS.HOME_ALERT_CLEARED,
    entity: { type: "home_alert", id },
    actor,
    before,
    after: done[0],
    payload: payloadOf(done[0], rule, { outcome }),
  });
  return done[0];
}

/**
 * Escalate high alerts open longer than `days`, once each. The alert-ageing
 * scheduler calls this; each alert is its own transaction.
 * @param {{db?: import("pg").Pool, days?: number, limit?: number}} [opts]
 * @returns {Promise<{escalated: number}>}
 */
async function escalateAged({
  db = require("../../config/db").pool,
  days = ESCALATE_AFTER_DAYS,
  limit = 200,
} = {}) {
  const { rows } = await db.query(
    `SELECT a.home_alert_id FROM home_alert a
      WHERE a.cleared_at IS NULL AND a.escalated_at IS NULL AND a.severity = 'high'
        AND a.raised_at <= now() - make_interval(days => $1)
      ORDER BY a.raised_at, a.home_alert_id
      LIMIT $2 -- pagination:batch alerts one ageing run escalates`,
    [days, limit],
  );
  let escalated = 0;
  for (const { home_alert_id: id } of rows) {
    const client = await db.connect();
    try {
      await atomically(client, async () => {
        const { rows: up } = await client.query(
          `UPDATE home_alert a SET escalated_at = now()
             FROM home_alert_rule r
            WHERE a.home_alert_id = $1 AND a.escalated_at IS NULL AND a.cleared_at IS NULL
              AND r.home_alert_rule_id = a.home_alert_rule_id
            RETURNING a.home_alert_id, a.home_alert_rule_id, a.subject_type, a.subject_id, a.title, a.trigger,
                      a.severity, a.over_by, a.raised_at, a.last_seen_at, a.escalated_at, a.cleared_at,
                      a.cleared_by, a.outcome, a.note, r.key AS rule_key, r.permission_key`,
          [id],
        );
        if (!up[0]) return;
        const {
          rule_key: ruleKey,
          permission_key: permissionKey,
          ...alert
        } = up[0];
        await emit(client, {
          key: ALERTS.HOME_ALERT_ESCALATED,
          entity: { type: "home_alert", id },
          actor: null,
          payload: payloadOf(
            alert,
            { key: ruleKey, permission_key: permissionKey },
            { age_days: ageDays(alert) },
          ),
        });
        escalated += 1;
      });
    } finally {
      client.release();
    }
  }
  return { escalated };
}

module.exports = {
  SEVERITIES,
  ESCALATE_AFTER_DAYS,
  parsePermission,
  evaluate,
  ageDays,
  ruleByKey,
  raise,
  mayClear,
  clear,
  escalateAged,
};
