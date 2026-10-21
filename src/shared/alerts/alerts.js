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
 * the engine behind them, so every alert is raised, cleared and aged the same way. Home's
 * metric registry (src/modules/alerts/alerts.metrics.js) reads each breach in its daily
 * sweep, and attendance raises each breach of its policy's rules as it commits (through
 * alerts.service raisePolicyBreach); both call raise() for the rule:
 *
 *   const alerts = require("../../shared/alerts/alerts");
 *
 *   await atomically(client, async () => {
 *     await alerts.raise(client, {
 *       rule,                                      // a home_alert_rule row
 *       subject: { type: "employee", id: employeeId },
 *       value: 4,                                  // 4 late arrivals in the rule's window
 *       title: "Ada Obi: 4 late arrivals in 30 days",
 *       trigger: "Late on 2, 6, 9 and 13 October",
 *       subject_employee_id: employeeId,           // stored, and `team` holders above Ada see it
 *       since: lastLateClockIn,                    // the breach's latest evidence
 *     });
 *   });
 *
 * Rules:
 *  - A rule is data (home_alert_rule): a metric, a threshold, a window, a severity
 *    and the permission that may clear it ("people.approve"). Changing a number needs
 *    no deploy.
 *  - A metric is read one of two ways (`kind`). A count breaches when its value reaches
 *    the threshold, and over_by is how far past it. A deadline's value is the days left
 *    before a date: it breaches at the threshold's days or fewer, and over_by holds the
 *    days left: 0 on the day itself, below 0 once the date has passed (-2 two days after).
 *  - One open alert per (rule, subject). Raising again while it is open updates how
 *    far past the threshold it is (over_by) and when it was last seen; it does not
 *    stack a second alert. After it is closed, a new breach raises a new one; the same
 *    breach seen again by the next sweep does not (`since`: when the latest closure was a
 *    person's, at or after the breach's latest evidence, it already dealt with it). A
 *    deadline's evidence is also its date (`due_on`): a person who cleared it dealt with
 *    that date, so a changed date raises it again, a return to an earlier date included.
 *  - Below the threshold nothing is raised. An alert never closes itself: a person
 *    clears it (dealt with) or dismisses it (not worth acting on), with a note.
 *  - Only the CEO or a holder of the rule's permission whose scope reaches the person the
 *    alert is about may clear or dismiss it; one about no one in particular needs `all`
 *    scope. Nobody but the CEO clears an alert about themselves, as nobody decides their
 *    own request. Clearing twice is not an error; the second call returns the alert as it is.
 *  - Switching a rule off dismisses its open alerts as the rule change itself
 *    (closeForRule): no clearing right is needed and no person is recorded as closing
 *    them (cleared_by stays empty; the audit entry names who switched it off), so a rule
 *    switched back on raises what still breaches. A raise reads the rule again in its own
 *    transaction, so a sweep that loaded the rule before it was switched off raises nothing.
 *  - A high alert left open 14 days escalates to the CEO once (escalateAged, run by
 *    the alert-ageing scheduler).
 *
 * Every raise, clear and escalation goes through emit(), so it is audited and the
 * people who can clear it are notified (shared/notifications/fanout.js).
 *
 * Tables (Home's M1 migrations; BACKEND_STRUCTURE §11.1):
 *   home_alert_rule  home_alert_rule_id, key UNIQUE, name, metric, threshold numeric, window_days,
 *                    severity ('low' | 'medium' | 'high'), permission_key, enabled
 *   home_alert       home_alert_id, home_alert_rule_id, subject_type, subject_id, title, trigger,
 *                    severity, over_by numeric, raised_at, last_seen_at, escalated_at, cleared_at,
 *                    cleared_by, outcome ('cleared' | 'dismissed'), note, subject_employee_id (1150: the
 *                    employee the alert is about, which scopes Home's Alerts list; NULL when it is about
 *                    no one person), due_on (1151: the date a deadline alert is about; NULL for a count);
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
/** How a metric's value is read against a rule's threshold (evaluate). */
const KINDS = ["count", "deadline"];
const ESCALATE_AFTER_DAYS = 14;
const OUTCOMES = new Set(["cleared", "dismissed"]);
/** The note a switched-off rule leaves on the alerts it dismisses. */
const RULE_OFF_NOTE = "Rule switched off";
const ALERT_COLUMNS = `home_alert_id, home_alert_rule_id, subject_type, subject_id, subject_employee_id, title, trigger,
  severity, over_by, due_on, raised_at, last_seen_at, escalated_at, cleared_at, cleared_by, outcome, note`;

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

/** A figure to two decimal places, as home_alert.over_by keeps it. */
const twoPlaces = (n) => Math.round(n * 100) / 100;

/**
 * Is `value` past the rule's threshold, and by how much? Counts, days and percentages,
 * compared to two decimal places.
 *
 *   count     the value reaching the threshold breaches it; over_by is the value less the
 *             threshold (4 late arrivals against 3: +1)
 *   deadline  the value is the days left before a date and the threshold the days ahead it
 *             warns: the days left reaching the threshold or fewer breach it; over_by is the
 *             days left, 0 on the day and below 0 once the date has passed, so the day itself
 *             and a date gone by read apart
 *
 * @param {{threshold: string|number}} rule
 * @param {number|string} value
 * @param {"count"|"deadline"} [kind]
 * @returns {{breached: boolean, over_by: number}}
 */
function evaluate(rule, value, kind = "count") {
  const v = Number(value);
  const t = Number(rule.threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t))
    throw new Error("alerts.evaluate: value and threshold are numbers");
  if (!KINDS.includes(kind))
    throw new Error(`alerts.evaluate: kind is ${KINDS.join(" or ")}, not "${kind}"`);
  if (kind === "deadline") return { breached: v <= t, over_by: twoPlaces(v) };
  return { breached: v >= t, over_by: twoPlaces(v - t) };
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
 * Has a person already dealt with this breach? The rule and subject's most recent closure was
 * a person's, at or after `since` (the breach's latest evidence), about the same date when the
 * breach is a deadline's (`dueOn`), and none is open now. Only the most recent closure answers:
 * a date that moved to another and came back is new evidence, though a person cleared it the
 * first time. A rule switched off closed its alerts as no one (closeForRule), so such a
 * closure is not dealt with.
 */
async function dealtWith(client, rule, subject, since, dueOn) {
  const { rows } = await client.query(
    `SELECT COALESCE((SELECT cleared_by IS NOT NULL AND cleared_at >= $4::timestamptz
                             AND due_on IS NOT DISTINCT FROM $5::date
                        FROM home_alert
                       WHERE home_alert_rule_id = $1 AND subject_type = $2 AND subject_id = $3
                         AND cleared_at IS NOT NULL
                       ORDER BY cleared_at DESC, raised_at DESC
                       LIMIT 1), false)
        AND NOT EXISTS (SELECT 1 FROM home_alert
                         WHERE home_alert_rule_id = $1 AND subject_type = $2 AND subject_id = $3
                           AND cleared_at IS NULL) AS dealt`,
    [rule.home_alert_rule_id, subject.type, String(subject.id), since, dueOn],
  );
  return rows[0].dealt;
}

/**
 * Is the rule still switched on, read in this transaction? A sweep or a signal loads its rules
 * before it raises. FOR SHARE waits for a switch-off being saved (updateRule holds the row FOR
 * UPDATE) and then reads what it saved, so a switch-off that commits first wins; one that comes
 * after waits for this raise and dismisses what it raised (closeForRule).
 */
async function stillOn(client, rule) {
  const { rows } = await client.query(
    "SELECT enabled FROM home_alert_rule WHERE home_alert_rule_id = $1 FOR SHARE",
    [rule.home_alert_rule_id],
  );
  return Boolean(rows[0] && rows[0].enabled);
}

/**
 * Raise or refresh the alert for (rule, subject) when `value` crosses the threshold.
 *
 * `since` is when the breach's latest evidence came (the last late clock-in, the day a
 * date came within the rule's days). A sweep sees the same breach every morning; once a
 * person has cleared or dismissed its alert, the breach is not raised again until newer
 * evidence comes. Without `since`, every breach seen after a closure raises a new alert.
 * `due_on` is the date a deadline breach is about (YYYY-MM-DD), stored on the alert: a
 * closure dealt with that date only, so the same breach with another date is raised again.
 *
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{rule: object, subject: {type: string, id: string}, value: number|string, title: string,
 *          trigger?: string, subject_employee_id?: string|null, kind?: "count"|"deadline",
 *          since?: Date|string|null, due_on?: string|null, actor?: object|null}} opts
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
    kind = "count",
    since = null,
    due_on: dueOn = null,
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

  const { breached, over_by: overBy } = evaluate(rule, value, kind);
  if (!breached) return { raised: false, created: false, alert: null };
  if (!(await stillOn(client, rule))) return { raised: false, created: false, alert: null };
  if (since && (await dealtWith(client, rule, subject, since, dueOn)))
    return { raised: false, created: false, alert: null };

  const { rows } = await client.query(
    `INSERT INTO home_alert
       (home_alert_rule_id, subject_type, subject_id, title, trigger, severity, over_by, subject_employee_id,
        due_on, raised_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, now(), now())
     ON CONFLICT (home_alert_rule_id, subject_type, subject_id) WHERE cleared_at IS NULL
     DO UPDATE SET over_by = EXCLUDED.over_by, title = EXCLUDED.title, trigger = EXCLUDED.trigger,
                   subject_employee_id = COALESCE(EXCLUDED.subject_employee_id, home_alert.subject_employee_id),
                   due_on = EXCLUDED.due_on, last_seen_at = now()
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
      dueOn,
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
 * May this user clear alerts of this rule? The CEO, or a holder of the rule's permission.
 * Given the person an alert is about, their scope on that permission must reach them too
 * (`all` for an alert about no one in particular), and it must not be the user themselves:
 * nobody but the CEO clears an alert about themselves, as Attendance's exceptions and the
 * workflow's approvers refuse one's own record. Without a subject, any scope answers for the
 * rule at large.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id?: string|null, role_ids?: string[], is_ceo?: boolean}} user
 * @param {{permission_key: string}} rule
 * @param {string|null} [subjectEmployeeId]  the alert's subject_employee_id
 */
async function mayClear(client, user, rule, subjectEmployeeId) {
  if (!user || !user.user_id) return false;
  if (user.is_ceo === true) return true;
  if (subjectEmployeeId && user.employee_id && subjectEmployeeId === user.employee_id) return false;
  const [module, action] = parsePermission(rule.permission_key);
  const rows = await grantsCache.getGrants(client, {
    role_ids: user.role_ids || [],
    module,
  });
  const granted = scopeFromGrants(rows, action);
  if (!granted) return false;
  if (subjectEmployeeId === undefined) return true;
  const scope = catalog.OWN_ONLY.has(module) ? "own" : granted;
  if (scope === "all") return true;
  if (!subjectEmployeeId || !user.employee_id) return false;
  // `own` reaches the holder alone, and an alert about the holder is not theirs to clear.
  if (scope === "own") return false;
  const team = await grantsCache.getTeamEmployeeIds(client, user.employee_id);
  return team.includes(subjectEmployeeId);
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
    `SELECT a.home_alert_id, a.home_alert_rule_id, a.subject_type, a.subject_id, a.subject_employee_id, a.title,
            a.trigger, a.severity, a.over_by, a.due_on, a.raised_at, a.last_seen_at, a.escalated_at, a.cleared_at,
            a.cleared_by, a.outcome, a.note, r.key AS rule_key, r.permission_key
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
  if (!(await mayClear(client, actor, rule, before.subject_employee_id))) {
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
 * Dismiss every open alert of a rule that was switched off, as the rule change itself: the
 * person switching it off needs no right to clear them, and is not recorded as having closed
 * them (cleared_by stays empty, so a breach still there raises again if the rule is switched
 * back on). Each is audited as dismissed (`home.alert_cleared`, with `rule_off`), the actor
 * being who switched the rule off. Runs in the transaction that switches the rule off.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{rule_id: string, actor?: object|null, note?: string}} opts
 * @returns {Promise<number>} how many alerts it dismissed
 */
async function closeForRule(client, { rule_id: ruleId, actor = null, note = RULE_OFF_NOTE }) {
  if (!inTransaction(client))
    throw new Error("alerts.closeForRule must run inside atomically()");
  const { rows: rules } = await client.query(
    "SELECT key, permission_key FROM home_alert_rule WHERE home_alert_rule_id = $1",
    [ruleId],
  );
  if (!rules[0]) throw new AppError("NOT_FOUND", "Rule not found", 404);
  const { rows: open } = await client.query(
    `SELECT ${ALERT_COLUMNS} FROM home_alert
      WHERE home_alert_rule_id = $1 AND cleared_at IS NULL
      ORDER BY home_alert_id
      FOR UPDATE`,
    [ruleId],
  );
  if (!open.length) return 0;
  const { rows: done } = await client.query(
    `UPDATE home_alert SET cleared_at = now(), cleared_by = NULL, outcome = 'dismissed', note = $2
      WHERE home_alert_id = ANY($1::uuid[])
      RETURNING ${ALERT_COLUMNS}`,
    [open.map((a) => a.home_alert_id), note],
  );
  const before = new Map(open.map((a) => [a.home_alert_id, a]));
  for (const alert of done) {
    await emit(client, {
      key: ALERTS.HOME_ALERT_CLEARED,
      entity: { type: "home_alert", id: alert.home_alert_id },
      actor,
      before: before.get(alert.home_alert_id),
      after: alert,
      payload: payloadOf(alert, rules[0], { outcome: "dismissed", rule_off: true }),
    });
  }
  return done.length;
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
  KINDS,
  ESCALATE_AFTER_DAYS,
  RULE_OFF_NOTE,
  parsePermission,
  evaluate,
  ageDays,
  ruleByKey,
  raise,
  mayClear,
  clear,
  closeForRule,
  escalateAged,
};
