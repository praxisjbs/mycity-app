"use strict";
/**
 * Home on staging (docs/guides/home.md §11; decisions O11 and D12): enough of the
 * organisation's day that every card, chart, list and tab on Home shows figures when the
 * client is shown it, before the modules Home reads are built.
 *
 * Run by `scripts/db/seed.js --staging` after 10_staff.js, never on production: the runner
 * refuses production three ways, and this file asks the same three questions again before it
 * writes anything, so requiring it from anywhere else cannot reach production either.
 *
 * What it writes, in order, always hung off MyCity's real staff found by post (lib/staff.js):
 *
 *   attendance     today and the 14 working days before it, through the attendance module's
 *                  own day writer and day-close (lib/attendance.js)
 *   forward rows   goals and targets, a review cycle, partners and their pipeline, expenses
 *                  and budgets, and vacancies for the open seats, by SQL with fixed ids
 *                  listed in HOME_STAGING_ROWS (lib/home-staging-rows.js), which says
 *                  how each owning milestone takes them away when its own seed lands (M2's
 *                  tasks and calendar come from 40_workspace.js)
 *   alert rules    two rules through the alerts service, made by this seed (the audit says so).
 *                  Attendance's alerts are the Attendance policy's breaches, raised by the
 *                  attendance module as they happen, so no attendance rule is made here
 *   alerts         the morning sweep itself (alerts.sweeps.js), so every alert is a real breach
 *                  of the rows above, raised through the shared alert engine
 *   reports        four reports through the reports service, each made by the person who owns
 *                  it: a daily schedule whose last slot is fired as the scheduler fires it, a
 *                  paused weekly one, and two on demand, each Run Now once
 *
 * Idempotent: run twice at the same moment, it leaves the same state. Punches and runs are
 * found by their keys, rules by their key, reports by their owner and name, forward rows by
 * their ids, and the sweep refreshes the alerts it raised. Run on a later day it adds that
 * day's attendance and closes the days before it, moves the forward rows' dates with the day,
 * and raises what newly breaches: staging keeps showing this week. Run after the organisation
 * changed (a seat filled, someone moved or left), the forward rows follow it, and one with
 * nobody left to hang off is deleted with the alerts about it. A record someone changed on
 * staging is never written over, except a forward row, which no screen can change yet.
 *
 * On staging, as the 06:00 sweep and the scheduler would, the alerts notify their holders and
 * the runs are built and emailed by the worker, marked as staging mail (A4).
 */
const c = require("@mycity/contract");
const runner = require("../../scripts/db/seed");
const { atomically } = require("../../src/shared/db/tx");
const grantsCache = require("../../src/shared/rbac/grants-cache");
const lagos = require("../../src/shared/time/lagos");
const workingWeek = require("../../src/shared/time/working-week");
const alertsService = require("../../src/modules/alerts/alerts.service");
const sweeps = require("../../src/modules/alerts/alerts.sweeps");
const reports = require("../../src/modules/reports/reports.service");
const reportSchedule = require("../../src/modules/reports/reports.schedule");
const { realStaff } = require("./lib/staff");
const { seedAttendance } = require("./lib/attendance");
const forward = require("./lib/forward-rows");

/** The alert rules a demonstration needs: quiet partners and a budget running out. */
const RULES = Object.freeze([
  { name: "Quiet Partners", metric: "partner_inactivity", threshold: "30", severity: "high" },
  { name: "Budget Nearly Spent", metric: "budget_threshold", threshold: "80", severity: "high" },
]);

/**
 * The reports, by owner's post (lib/forward-rows.js personOf). `schedule.to` are the posts that
 * receive it; `paused` saves it and pauses it; `run` presses Run Now once, in that format;
 * `department` filters it to its owner's department.
 */
const REPORTS = Object.freeze([
  {
    owner: "operations",
    name: "Daily Attendance",
    report_key: "daily_attendance",
    shared: true,
    schedule: { recurrence: { freq: "daily", working_days_only: true }, run_time: "18:00", formats: ["pdf", "xlsx"], to: ["operations"] },
  },
  {
    owner: "ceo",
    name: "Weekly Headcount",
    report_key: "headcount",
    shared: true,
    paused: true,
    schedule: { recurrence: { freq: "weekly", by_weekday: [1], working_days_only: true }, run_time: "08:00", formats: ["xlsx"], to: ["ceo", "operations"] },
  },
  { owner: "operations", name: "High Alerts", report_key: "open_alerts", filters: { severity: "high" }, run: "xlsx" },
  { owner: "head", name: "Team Attendance", report_key: "daily_attendance", department: true, run: "pdf" },
]);

/** How far back a seeded schedule starts. */
const SCHEDULE_SINCE_DAYS = 14;

/**
 * Refuse unless the runner's three checks say this database is not production.
 * @param {{query: Function}} db
 */
async function guard(db) {
  const { config } = require("../../src/config/env");
  const problems = runner.refusals({
    mode: "staging",
    appEnv: config.APP_ENV,
    dbName: config.DB_NAME,
    marker: await runner.readMarker(db),
  });
  if (!problems.length) return;
  const err = new Error(`Refusing to seed Home:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  err.code = "SEED_REFUSED";
  err.problems = problems;
  throw err;
}

/** A person as a service's caller (req.user), or null when they have no login. */
async function callerOf(db, person) {
  if (!person || !person.user_id) return null;
  const user = await grantsCache.getAuthUser(db, person.user_id);
  return user ? { ...user, ip: null } : null;
}

/* ------------------------------------------------------------------ *
 * Alert rules and alerts
 * ------------------------------------------------------------------ */

/** Make each rule no rule holds the key of yet. */
async function seedRules(db, actor, log) {
  let made = 0;
  for (const rule of RULES) {
    const key = `${rule.metric}.${alertsService.slugOf(rule.name)}`;
    const { rows } = await db.query("SELECT home_alert_rule_id FROM home_alert_rule WHERE key = $1", [key]);
    if (rows.length) continue;
    const body = c.alerts.HomeAlertRuleCreate.parse({
      ...rule,
      permission_key: c.alerts.HOME_ALERT_METRICS[rule.metric].permission_key,
    });
    await alertsService.createRule(actor, body);
    made += 1;
  }
  log(`alerts: ${made} rules made, ${RULES.length - made} already there`);
}

/* ------------------------------------------------------------------ *
 * Reports and runs
 * ------------------------------------------------------------------ */

/** The last slot of a schedule at or before `now`, or null when it has not fired yet. */
function lastSlot(fields, now, cal) {
  let slot = null;
  let next = reportSchedule.nextSlot(fields, new Date(lagos.startOfDay(fields.starts_on).getTime() - 1), cal);
  while (next && next <= now) {
    slot = next;
    next = reportSchedule.nextSlot(fields, next, cal);
  }
  return slot;
}

/** The owner's report of this name, in any state, or null. */
async function reportNamed(db, ownerUserId, name) {
  const { rows } = await db.query(
    `SELECT saved_report_id FROM saved_report
      WHERE owner_user_id = $1 AND lower(name) = lower($2) AND report_key <> 'overview'`,
    [ownerUserId, name],
  );
  return rows[0] ? rows[0].saved_report_id : null;
}

/**
 * Make a report as its owner. A schedule is saved as it would have been just before its last
 * slot, so that slot is due now and is fired below as the scheduler fires a slot it missed.
 */
async function makeReport(db, spec, owner, staff, { now, cal }) {
  const filters = { ...(spec.filters || {}) };
  if (spec.department) {
    if (!owner.department_id) return null;
    filters.department_id = owner.department_id;
  }
  let schedule = null;
  let savedAt = now;
  if (spec.schedule) {
    const recipients = spec.schedule.to.map((post) => forward.personOf(staff, post));
    if (!recipients.every((p) => p && p.user_id)) return null;
    schedule = {
      recurrence: spec.schedule.recurrence,
      starts_on: lagos.addDays(lagos.today(now), -SCHEDULE_SINCE_DAYS),
      run_time: spec.schedule.run_time,
      formats: spec.schedule.formats,
      recipient_user_ids: recipients.map((p) => p.user_id),
    };
    const slot = spec.paused ? null : lastSlot(schedule, now, cal);
    if (slot) savedAt = new Date(slot.getTime() - 1);
  }
  const body = c.reports.HomeReportCreate.parse({
    name: spec.name,
    report_key: spec.report_key,
    filters,
    shared: spec.shared === true,
    schedule,
  });
  const created = await reports.create(owner.caller, body, { now: savedAt });
  if (spec.paused) await reports.setActive(owner.caller, created.saved_report_id, { active: false }, { now });
  return created.saved_report_id;
}

/** Fire a running schedule's slot that is due, as the `scheduled-report` job does. */
async function fireDue(db, reportId, now) {
  const { rows } = await db.query(
    "SELECT report_schedule_id, next_run_at FROM report_schedule WHERE saved_report_id = $1 AND active",
    [reportId],
  );
  const due = rows[0];
  if (!due || !due.next_run_at || new Date(due.next_run_at) > now) return 0;
  return (await reports.fireSlot(due.report_schedule_id, new Date(due.next_run_at), { now })).runs;
}

/** Run Now once: unless the owner already has a file of the report in that format. */
async function runOnce(db, reportId, owner, format) {
  const { rows } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM home_report_run
                     WHERE saved_report_id = $1 AND recipient_user_id = $2 AND format = $3) AS made`,
    [reportId, owner.user_id, format],
  );
  if (rows[0].made) return 0;
  await reports.runNow(owner.caller, reportId, { format });
  return 1;
}

async function seedReports(db, staff, { now, log }) {
  const cal = await workingWeek.loadCalendar(db);
  let made = 0;
  let runs = 0;
  for (const spec of REPORTS) {
    const person = forward.personOf(staff, spec.owner);
    const caller = await callerOf(db, person);
    if (!caller) continue;
    const owner = { ...person, caller };
    let id = await reportNamed(db, owner.user_id, spec.name);
    if (!id) {
      id = await makeReport(db, spec, owner, staff, { now, cal });
      if (!id) continue;
      made += 1;
    }
    runs += await fireDue(db, id, now);
    if (spec.run) runs += await runOnce(db, id, owner, spec.run);
  }
  log(`reports: ${made} made, ${runs} runs queued`);
}

/* ------------------------------------------------------------------ *
 * The seed
 * ------------------------------------------------------------------ */

/**
 * @param {{pool: import("pg").Pool, actor?: object, log?: Function, now?: Date}} opts
 *   pool   the app's own pool, as the runner passes it: the services write through the same one
 *   actor  the seed itself, as the runner names it (scripts/db/seed.js ACTOR): the rules' author
 *   now    the moment the seed runs as; now, unless a test pins it
 */
async function seed({ pool, actor = runner.ACTOR, log = () => {}, now = new Date() }) {
  await guard(pool);
  const staff = await realStaff(pool);
  if (!staff.everyone.length) {
    log("home: nobody is on the register yet, so there is nothing to hang Home's records off");
    return;
  }
  await seedAttendance({ db: pool, people: staff.everyone, now, log: (m) => log(`home: ${m}`) });

  const client = await pool.connect();
  try {
    await atomically(client, () => forward.writeForwardRows({ db: client, staff, now, log: (m) => log(`home: ${m}`) }));
  } finally {
    client.release();
  }

  await seedRules(pool, actor, (m) => log(`home: ${m}`));
  const swept = await sweeps.sweep({ now, db: pool });
  log(`home: alerts swept, ${swept.raised} raised, ${swept.refreshed} refreshed, ${swept.failed} failed`);

  await seedReports(pool, staff, { now, log: (m) => log(`home: ${m}`) });
}

module.exports = seed;
module.exports.HOME_STAGING_ROWS = forward.HOME_STAGING_ROWS;
module.exports.RULES = RULES;
module.exports.REPORTS = REPORTS;
module.exports.guard = guard;
