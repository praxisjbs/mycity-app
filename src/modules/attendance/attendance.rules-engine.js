"use strict";
/**
 * The Attendance policy's consequence rules, counted per person (docs/guides/attendance.md §6.16;
 * TB's decisions of 20/10/2026, T1, T3, T5).
 *
 *   countDay()   in the transaction that recalculated a person's day (a punch, a decision, a system
 *                clock-out, the day-close), after their lock: each of the five rules in force on that
 *                day counted over its period, from the day after the person's last breach of the
 *                same rule in that period. Each breach is recorded once and `attendance.rule_breached`
 *                is emitted with it; its Home alert follows after commit (attendance.events.js
 *                `attendance.raise_breach_alert`)
 *   wordsOf()    what a breach's alert says: "Ada Obi: 3 late arrivals this month", the days
 *
 * What each rule counts, from what this module records:
 *   late_rule        the days recorded late, and their late minutes
 *   early_rule       the days with early minutes, and those minutes
 *   absence_rule     the days closed absent
 *   forgotten_rule   the days with a system clock-out that counts, or the day-close's missing
 *                    clock-out, once a day
 *   location_rule    the outside exceptions that still count (attendance.repo.js locationFlags)
 *
 * A breach is the count reaching N, or the minutes reaching H hours, whichever first
 * (shared/rules/window-counter `breaches`); its days are never counted again, so three late
 * arrivals give one breach and the sixth the next. A rule switched off counts nothing from its
 * version's first day; breaches already made stay, and keep their days when one stops counting.
 * Nothing here reads a salary, and an event carries ids, dates, the counts and the switches.
 */
const { emit } = require("../../shared/events/emit");
const windowCounter = require("../../shared/rules/window-counter");
const { formatDate } = require("../../shared/time/day-first");
const policies = require("../policies/policies.service");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

/**
 * The five rules: the breach's name for each (attendance_rule_breach.rule), the policy's key, what
 * counts toward it, and the words its alert uses.
 */
const RULES = Object.freeze({
  late: Object.freeze({
    key: "late_rule",
    read: repo.lateDays,
    hours: true,
    one: "late arrival",
    many: "late arrivals",
    hoursText: "hours late",
    on: "Late on",
  }),
  early_departure: Object.freeze({
    key: "early_rule",
    read: repo.earlyDays,
    hours: true,
    one: "early departure",
    many: "early departures",
    hoursText: "hours left early",
    on: "Left early on",
  }),
  absence: Object.freeze({ key: "absence_rule", read: repo.absentDays, hours: false, one: "absence", many: "absences", on: "Absent on" }),
  forgotten_clock_out: Object.freeze({
    key: "forgotten_rule",
    read: repo.forgottenDays,
    hours: false,
    one: "forgotten clock-out",
    many: "forgotten clock-outs",
    on: "No clock-out on",
  }),
  location_flag: Object.freeze({
    key: "location_rule",
    read: repo.locationFlags,
    hours: false,
    one: "location flag",
    many: "location flags",
    on: "Outside on",
  }),
});

/** The breach's rule by the policy's key: late_rule → late. */
const BY_POLICY_KEY = Object.freeze(Object.fromEntries(Object.entries(RULES).map(([name, r]) => [r.key, name])));

/** "this week", "this month", "in 30 days" */
const PERIOD_TEXT = Object.freeze({ week: "this week", month: "this month", days_30: "in 30 days" });

/** "5", "2.5" from minutes, to the tenth of an hour. */
const hoursOf = (minutes) => String(Math.round((minutes / 60) * 10) / 10);

/** "Late on 09/10/2026, 12/10/2026 and 14/10/2026"; for many days "Late on 6 days, last on 14/10/2026". */
function onDays(lead, dates) {
  const shown = [...new Set(dates)].map(formatDate);
  if (shown.length > 3) return `${lead} ${shown.length} days, last on ${shown[shown.length - 1]}`;
  if (shown.length === 1) return `${lead} ${shown[0]}`;
  return `${lead} ${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

/** What a breach counted, in words: "3 late arrivals this month", "5 hours late in 30 days". Pure. */
function countedOf(breach) {
  const r = RULES[breach.rule];
  const what =
    breach.reached === "hours" && r.hours
      ? `${hoursOf(breach.minutes)} ${r.hoursText}`
      : `${breach.count} ${breach.count === 1 ? r.one : r.many}`;
  return `${what} ${PERIOD_TEXT[breach.period]}`;
}

/**
 * What a breach's alert says (§6.16; home.md §6): the title counts what was reached ("Ada Obi: 3 late
 * arrivals this month", or "Ada Obi: 5 hours late this month"); the trigger names the days. The
 * query, when Raise Query is on, is Queries & Sanctions' own (queries.md §6.2). Pure.
 * @param {{rule: string, period: string, count: number, minutes: number, reached: "count"|"hours",
 *          days: string[], raise_query: boolean}} breach
 * @param {string} name  the person's display name
 * @returns {{title: string, trigger: string}}
 */
function wordsOf(breach, name) {
  return { title: `${name}: ${countedOf(breach)}`, trigger: onDays(RULES[breach.rule].on, breach.days) };
}

/**
 * What the query a breach raises says (queries.md §6.2), in MyCity's words for it (its QUERY
 * NOTIFICATION sample): the subject counts what was reached, the details name the days, and each
 * counted day is evidence. Pure.
 * @returns {{subject: string, details: string, evidence: Array<{label: string, date: string}>}}
 */
function queryWordsOf(breach) {
  const r = RULES[breach.rule];
  const counted = countedOf(breach);
  const label = `${r.one[0].toUpperCase()}${r.one.slice(1)}`;
  return {
    subject: `${counted[0].toUpperCase()}${counted.slice(1)}`,
    details: `Our attendance records show ${counted}. ${onDays(r.on, breach.days)}.`,
    evidence: [...new Set(breach.days)].map((date) => ({ label, date })),
  };
}

/**
 * The breaches of one rule for a person, counted over the period that holds `date`, up to `date`:
 * a day counts toward the breaches it can cross, and a later day is counted when it comes. Only
 * what came after the last breach of the same rule within the period counts.
 */
async function breachesOf(client, employeeId, name, rule, date) {
  const { from, to } = windowCounter.periodBounds(rule.period, date);
  const last = await repo.latestBreach(client, employeeId, name, from);
  const events = await RULES[name].read(client, employeeId, from, to < date ? to : date);
  const limit = RULES[name].hours && rule.hours ? Math.round(rule.hours * 60) : null;
  const found = windowCounter.breaches({ count: rule.count, limit }, events, { after: last ? last.last_day : null });
  return found.map((b) => ({ ...b, from, to }));
}

/**
 * Count a person's five rules on a date, in the caller's transaction (after the person's lock):
 * the rules of the version in force on `date` count the period; a breach is recorded only when
 * the version in force on the day that crossed it has the rule on, and does what that version says
 * (§6.16). Each breach found is recorded and emitted once.
 * @param {import("pg").PoolClient} client
 * @param {{employee_id: string, ref: {display_name: string}}} person  repo.person()
 * @param {string} date  the day just recalculated
 * @returns {Promise<Array<object>>} the breaches recorded now
 */
async function countDay(client, person, date) {
  const { policy_version_id: versionId, rules: r } = await policies.rulesFor(client, "attendance", date);
  const made = [];
  for (const [name, def] of Object.entries(RULES)) {
    const rule = r[def.key];
    if (!rule || !rule.on) continue;
    for (const b of await breachesOf(client, person.employee_id, name, rule, date)) {
      const crossing = b.last === date ? { policy_version_id: versionId, rules: r } : await policies.rulesFor(client, "attendance", b.last);
      const then = crossing.rules[def.key];
      if (!then || !then.on) continue;
      const breach = {
        employee_id: person.employee_id,
        rule: name,
        policy_version_id: crossing.policy_version_id,
        period: rule.period,
        period_start: b.from,
        period_end: b.to,
        count: b.count,
        minutes: def.hours ? b.total : 0,
        reached: b.reached === "limit" ? "hours" : "count",
        days: b.dates,
        last_day: b.last,
        alert: Boolean(then.alert),
        raise_query: Boolean(then.query),
      };
      const row = await repo.insertBreach(client, breach);
      if (!row) continue;
      const id = row.attendance_rule_breach_id;
      await emit(client, {
        key: EVENTS.ATTENDANCE_RULE_BREACHED,
        entity: { type: "attendance_rule_breach", id },
        actor: null,
        after: { rule: name, period: rule.period, count: breach.count, minutes: breach.minutes, reached: breach.reached, days: breach.days },
        payload: {
          attendance_rule_breach_id: id,
          employee_id: person.employee_id,
          subject_employee_id: person.employee_id,
          rule: name,
          policy_rule: def.key,
          policy_version_id: breach.policy_version_id,
          period: rule.period,
          period_start: b.from,
          period_end: b.to,
          count: breach.count,
          minutes: breach.minutes,
          reached: breach.reached,
          days: breach.days,
          last_day: breach.last_day,
          alert: breach.alert,
          raise_query: breach.raise_query,
        },
        dedup_key: `attendance-breach:${id}`,
      });
      made.push({ attendance_rule_breach_id: id, ...breach });
    }
  }
  return made;
}

module.exports = { RULES, BY_POLICY_KEY, PERIOD_TEXT, wordsOf, queryWordsOf, onDays, countDay };
