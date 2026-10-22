"use strict";
/**
 * Reminders (docs/guides/notifications.md §6, §7.1): one engine for everything that comes back
 * to someone at a time, so no module writes its own clock for one.
 *
 * A module declares a reminder once, beside the event it emits (declared in its events file,
 * with the notice that says who is told and what):
 *
 *   reminders.defineReminder("task_due_soon", {
 *     event: EVENTS.TASK_DUE_SOON,
 *     module: "workspace",
 *     check: async (client, row) => ...,   // before each firing, in its transaction:
 *                                          //   null ends it, { later } moves it,
 *                                          //   { entity, payload } fires the event
 *     find: async (client, { now, rule }) => [...],   // optional: occurrences due by date alone
 *   });
 *
 * and, inside its own transaction, schedules or cancels occurrences:
 *
 *   await reminders.schedule(client, { key, entity: { type, id }, occurrence, at,
 *                                      every_minutes, work_hours, payload });
 *   await reminders.cancel(client, { key, entity, occurrence });
 *
 * The `reminders` scheduler calls tick() every 5 minutes. Each declaration's `find` adds what
 * has come due (once: an occurrence is unique per key, record and occurrence), then every due
 * occurrence is fired in its own transaction: a work-hours one waits for 08:00 to 18:00 Lagos;
 * its `check` decides; a fired one emits its event through emit(), so the fan-out tells whoever
 * its notice names, on every device, with its urgency; a repeating one moves `every_minutes`
 * on, any other is done.
 *
 * The company's reminders (Settings · Notifications) are declared here and switched by their
 * notification_reminder_rule: Approvals Waiting and Probation Ending; and the daily digest,
 * queued per person on the `reminders` queue from the digest's time (jobs/handlers/reminders.js).
 *
 * Table (migration 0480): reminder  reminder_id, reminder_key, entity_type, entity_id,
 * occurrence, due_at, every_minutes, work_hours, payload, fired_count, last_fired_at, state.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const c = require("@mycity/contract");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const catalogue = require("../../shared/events/catalogue");
const { defineEvents } = catalogue;
const access = require("../../shared/access/access.catalog");
const { defineNotification } = require("../../shared/notifications/fanout");
const definitions = require("../../shared/workflow/definitions");
const cond = require("../../shared/workflow/conditions");
const routeMap = require("../../shared/route-map");
const variables = require("../../shared/templates/variables");
const { formatDate } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const repo = require("./notifications.repo");

const SPECS = new Map();
const KEY_RE = /^[a-z][a-z0-9_]*$/;
/** The working day a work-hours reminder keeps to, Lagos time. */
const WORK = Object.freeze({ from: "08:00", until: "18:00" });
const HOUR_MS = 3600 * 1000;
const DIGEST_TEMPLATE = "digest";
/** The digest lists what arrived in this window before it is sent. */
const DIGEST_WINDOW_MS = 24 * HOUR_MS;

/** The company's reminders before People change them (docs/guides/notifications.md §6). */
const DEFAULTS = Object.freeze({
  approvals: Object.freeze({ enabled: true, every_hours: 24 }),
  probation: Object.freeze({ enabled: true, days_ahead: 14 }),
  digest: Object.freeze({ enabled: true, at_time: "07:30" }),
});
const PROBATION_AT = "09:00";

/* ------------------------------------------------------------------ *
 * Declaring, scheduling, cancelling
 * ------------------------------------------------------------------ */

/**
 * Declare a reminder. `rule` names the company reminder that switches it (`approvals`,
 * `probation`); a module's own reminders have none.
 * @param {string} key
 * @param {{event: string, module: string, check: Function, find?: Function, rule?: string}} spec
 */
function defineReminder(key, spec) {
  const where = `defineReminder(${key})`;
  if (!KEY_RE.test(String(key || ""))) throw new Error(`${where}: a key is lower snake_case`);
  if (!spec || !catalogue.has(spec.event)) throw new Error(`${where}: event is a declared event key`);
  if (!access.isModule(spec.module)) throw new Error(`${where}: module is a permission key`);
  if (typeof spec.check !== "function") throw new Error(`${where}: check is (client, row, ctx) => decision`);
  if (spec.find !== undefined && typeof spec.find !== "function")
    throw new Error(`${where}: find is (client, { now, rule }) => occurrences`);
  if (spec.rule !== undefined && !Object.hasOwn(DEFAULTS, spec.rule))
    throw new Error(`${where}: rule is one of ${Object.keys(DEFAULTS).join(", ")}`);
  const existing = SPECS.get(key);
  if (existing && existing !== spec) throw new Error(`${where}: already declared`);
  SPECS.set(key, spec);
}

function known(key, where) {
  if (!SPECS.has(key)) throw new Error(`reminders.${where}: "${key}" is not declared with defineReminder()`);
}

/**
 * Schedule an occurrence inside the caller's transaction, or move it and start its count again.
 * @param {import("pg").PoolClient} client
 * @param {{key: string, entity: {type: string, id: string}, occurrence?: string, at: Date,
 *          every_minutes?: number, work_hours?: boolean, payload?: object}} r
 */
async function schedule(client, r) {
  known(r.key, "schedule");
  if (r.every_minutes !== undefined && r.every_minutes !== null && !(Number.isInteger(r.every_minutes) && r.every_minutes >= 5))
    throw new Error(`reminders.schedule(${r.key}): every_minutes is a whole number, at least 5`);
  return repo.scheduleReminder(client, {
    key: r.key,
    entity_type: r.entity.type,
    entity_id: r.entity.id,
    occurrence: r.occurrence,
    due_at: r.at,
    every_minutes: r.every_minutes,
    work_hours: r.work_hours,
    payload: r.payload,
  });
}

/** Cancel a record's pending occurrences of a reminder (only `occurrence` when given). */
async function cancel(client, { key, entity, occurrence = null }) {
  known(key, "cancel");
  return repo.cancelReminders(client, { key, entityType: entity.type, entityId: entity.id, occurrence });
}

/** A record's pending occurrences of a reminder, for a screen that shows them. */
async function pendingFor(db, { key, entity }) {
  known(key, "pendingFor");
  return repo.pendingReminders(db, { key, entityType: entity.type, entityId: entity.id });
}

/* ------------------------------------------------------------------ *
 * The company's reminder rules
 * ------------------------------------------------------------------ */

/** The three company reminders, defaults applied. */
async function rules(db = pool) {
  const out = {
    approvals: { ...DEFAULTS.approvals },
    probation: { ...DEFAULTS.probation },
    digest: { ...DEFAULTS.digest },
  };
  for (const r of await repo.reminderRules(db)) {
    const rule = out[r.reminder_key];
    if (!rule) continue;
    rule.enabled = r.enabled;
    if (r.reminder_key === "approvals" && r.every_hours) rule.every_hours = r.every_hours;
    if (r.reminder_key === "probation" && r.days_ahead) rule.days_ahead = r.days_ahead;
    if (r.reminder_key === "digest" && r.at_time) rule.at_time = r.at_time;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Time
 * ------------------------------------------------------------------ */

/** The first instant at or after `at` inside 08:00 to 18:00 Lagos. */
function inWorkHours(at) {
  const time = lagos.timeOf(at);
  const day = lagos.dateOf(at);
  if (time < WORK.from) return lagos.instant(day, WORK.from);
  if (time >= WORK.until) return lagos.instant(lagos.addDays(day, 1), WORK.from);
  return at;
}

const later = (a, b) => (a.getTime() >= b.getTime() ? a : b);

/* ------------------------------------------------------------------ *
 * The tick
 * ------------------------------------------------------------------ */

/**
 * Fire one due occurrence in its own transaction.
 * @returns {Promise<"fired"|"moved"|"finished"|"skipped">}
 */
async function fireOne(client, id, spec, ctx) {
  const row = await repo.reminderForFiring(client, id, ctx.now);
  if (!row) return "skipped";
  if (row.work_hours) {
    const slot = inWorkHours(ctx.now);
    if (slot.getTime() > ctx.now.getTime()) {
      await repo.moveReminder(client, id, { dueAt: slot });
      return "moved";
    }
  }
  const decided = await spec.check(client, row, ctx);
  if (!decided) {
    await repo.finishReminder(client, id);
    return "finished";
  }
  if (decided.later) {
    await repo.moveReminder(client, id, {
      dueAt: row.work_hours ? inWorkHours(decided.later) : decided.later,
      payload: decided.payload || null,
      everyMinutes: decided.every_minutes ?? null,
    });
    return "moved";
  }
  await emit(client, {
    key: spec.event,
    entity: decided.entity,
    module: spec.module,
    actor: null,
    payload: { ...decided.payload, reminder_id: row.reminder_id, round: row.fired_count + 1 },
  });
  const every = decided.every_minutes ?? row.every_minutes;
  let next = null;
  if (every) {
    next = new Date(ctx.now.getTime() + every * 60 * 1000);
    if (row.work_hours) next = inWorkHours(next);
  }
  await repo.reminderFired(client, id, { now: ctx.now, next, everyMinutes: decided.every_minutes ?? null });
  return "fired";
}

/**
 * The `reminders` scheduler's work: find what has come due, fire every due occurrence, and queue
 * the day's digests once their time has come. Safe to run again: an occurrence is found once,
 * fired under its row lock, and a digest is queued once a day.
 * @param {{db?: import("pg").Pool, now?: Date}} [opts]
 */
async function tick({ db = pool, now = new Date() } = {}) {
  const company = await rules(db);
  const out = { found: 0, fired: 0, moved: 0, finished: 0, failed: 0, digests: 0 };
  const live = [...SPECS].filter(([, spec]) => !spec.rule || company[spec.rule].enabled);

  for (const [key, spec] of live) {
    if (!spec.find) continue;
    for (const o of await spec.find(db, { now, rule: spec.rule ? company[spec.rule] : null })) {
      if (await repo.addReminder(db, { key, ...o })) out.found += 1;
    }
  }

  const byKey = new Map(live);
  for (const { reminder_id: id, reminder_key: key } of await repo.dueReminders(db, now, [...byKey.keys()])) {
    const spec = byKey.get(key);
    const ctx = { now, rule: spec.rule ? company[spec.rule] : null };
    const client = await db.connect();
    try {
      const done = await atomically(client, () => fireOne(client, id, spec, ctx));
      if (done !== "skipped") out[done] += 1;
    } catch (err) {
      out.failed += 1;
      logger.error({ err, reminder_id: id, reminder_key: key }, "reminder failed");
    } finally {
      client.release();
    }
  }

  out.digests = await queueDigests(db, now, company.digest);
  return out;
}

/* ------------------------------------------------------------------ *
 * Approvals Waiting
 * ------------------------------------------------------------------ */

const APPROVAL = "approval_waiting";

defineReminder(APPROVAL, {
  event: catalogue.WORKFLOW.WORKFLOW_REMINDED,
  module: "settings",
  rule: "approvals",
  // Every pending approval gets one occurrence, counted from when its stage started.
  find: async (client, { rule }) =>
    (await repo.approvalsToRemind(client)).map((a) => ({
      entity_type: "workflow_instance",
      entity_id: a.workflow_instance_id,
      due_at: new Date(new Date(a.stage_entered_at).getTime() + rule.every_hours * HOUR_MS),
      every_minutes: rule.every_hours * 60,
      work_hours: true,
      payload: { stage: a.current_stage, since: new Date(a.stage_entered_at).toISOString() },
    })),
  check: async (client, row, { now, rule }) => {
    const a = await repo.approvalOf(client, row.entity_id);
    if (!a || a.state !== "pending") return null;
    const since = new Date(a.stage_entered_at);
    const every = rule.every_hours * 60;
    // A new stage (or the same one entered again) counts from its own start.
    if (a.current_stage !== row.payload.stage || since.toISOString() !== row.payload.since) {
      return {
        later: later(new Date(since.getTime() + rule.every_hours * HOUR_MS), now),
        payload: { stage: a.current_stage, since: since.toISOString() },
        every_minutes: every,
      };
    }
    const def = await definitions.findById(client, a.workflow_definition_id);
    const stage = def ? cond.stageByKey(def, a.current_stage) : null;
    return {
      entity: { type: a.entity_type, id: a.entity_id },
      every_minutes: every,
      payload: {
        instance_id: a.workflow_instance_id,
        definition_key: a.definition_key,
        definition_name: def ? def.name : null,
        stage: a.current_stage,
        stage_name: stage ? stage.name : null,
        stage_approvers: a.stage_approvers || [],
        subject_employee_id: a.subject_employee_id,
        opened_by: a.opened_by,
        excluded_employee_ids: a.excluded_employee_ids || [],
        waited_hours: Math.floor((now.getTime() - since.getTime()) / HOUR_MS),
      },
    };
  },
});

/* ------------------------------------------------------------------ *
 * Probation Ending
 * ------------------------------------------------------------------ */

const PROBATION = "probation_ending";

const PEOPLE_EVENTS = defineEvents("people", {
  "employee.probation_ending": { summary: "A probation is about to end" },
});

defineNotification(PEOPLE_EVENTS.EMPLOYEE_PROBATION_ENDING, {
  to: [{ permission: ["people", "approve"] }],
  title: (e) => `Probation ending: ${e.payload.display_name}`,
  body: (e) => `Confirmation is due on ${formatDate(e.payload.confirmation_due_on)}.`,
  copy: true,
});

defineReminder(PROBATION, {
  event: PEOPLE_EVENTS.EMPLOYEE_PROBATION_ENDING,
  module: "people",
  rule: "probation",
  // Each confirmation date within the window, once: at 09:00 Lagos, or now if that has passed.
  find: async (client, { now, rule }) => {
    const today = lagos.today(now);
    const at = later(lagos.instant(today, PROBATION_AT), now);
    return (await repo.probationsToRemind(client, { from: today, until: lagos.addDays(today, rule.days_ahead) })).map(
      (p) => ({ entity_type: "employee", entity_id: p.employee_id, occurrence: p.due_on, due_at: at }),
    );
  },
  check: async (client, row) => {
    const p = await repo.probationOf(client, row.entity_id);
    if (!p || p.confirmed_on || p.status === "archived" || p.due_on !== row.occurrence) return null;
    return {
      entity: { type: "employee", id: p.employee_id },
      payload: {
        employee_id: p.employee_id,
        subject_employee_id: p.employee_id,
        display_name: p.display_name,
        confirmation_due_on: p.due_on,
      },
    };
  },
});

/* ------------------------------------------------------------------ *
 * The daily digest
 * ------------------------------------------------------------------ */

variables.defineVariables("email", DIGEST_TEMPLATE, c.notifications.NotificationDigestEmailVars);

/** From the digest's time each Lagos day, each person's digest queued once (as many as are due). */
async function queueDigests(db, now, rule) {
  if (!rule.enabled || lagos.timeOf(now) < rule.at_time) return 0;
  const queues = require("../../jobs/queues");
  const day = lagos.today(now);
  let queued = 0;
  for (let batch = 0; batch < 50; batch += 1) {
    const due = await repo.digestsDue(db, day);
    for (const userId of due) {
      // Queued first, then noted: a digest that was noted but never queued would be lost.
      await queues.enqueue(
        "reminders",
        "digest",
        { user_id: userId, day, until: now.toISOString() },
        { jobId: `digest-${userId}-${day}` },
      );
      if (await repo.markDigest(db, userId, day)) queued += 1;
    }
    if (due.length < 200) break;
  }
  return queued;
}

const linkOf = (row) => {
  const link = routeMap.linkFor(row.entity_type, row.entity_id);
  return link ? new URL(link.path, config.STAFF_ORIGIN).href : null;
};

/**
 * One person's digest (the `reminders` job `digest`): the bell notices that arrived in the 24
 * hours before it was queued and are still unread, newest first, at most 25 listed. Nothing is
 * sent when there are none, when the person or the company turned the digest off meanwhile,
 * to someone who has never signed in, or while system mail is paused (the day's digest is
 * dropped, not kept: docs/guides/integrations.md §6.15).
 * @returns {Promise<{sent: boolean, count?: number, reason?: string}>}
 */
async function sendDigest({ user_id: userId, until }, { db = pool } = {}) {
  const company = await rules(db);
  if (!company.digest.enabled) return { sent: false, reason: "company_off" };
  const person = await repo.digestPerson(db, userId);
  if (!person || !person.email) return { sent: false, reason: "no_person" };
  if (!person.digest) return { sent: false, reason: "person_off" };
  if (!person.signed_in) return { sent: false, reason: "never_signed_in" };
  const systemMail = require("../../services/mail/system-mail.service");
  if (await systemMail.paused()) return { sent: false, reason: "mail_paused" };
  const end = until ? new Date(until) : new Date();
  const page = await repo.digestPage(db, userId, { from: new Date(end.getTime() - DIGEST_WINDOW_MS), until: end });
  if (page.data.length === 0) return { sent: false, reason: "nothing_unread" };
  await systemMail.send({
    to: { name: `${person.first_name} ${person.last_name}`.trim(), email: person.email },
    recipient: { first_name: person.first_name, last_name: person.last_name, email: person.email },
    template: DIGEST_TEMPLATE,
    data: {
      count: page.page.total,
      more: Math.max(0, page.page.total - page.data.length),
      items: page.data.map((n) => ({
        title: n.title,
        body: n.body || "",
        when: new Date(n.created_at).toISOString(),
        link_url: linkOf(n),
      })),
      open_url: new URL("/?pane=notifications", config.STAFF_ORIGIN).href,
    },
  });
  return { sent: true, count: page.page.total };
}

module.exports = {
  defineReminder,
  schedule,
  cancel,
  pendingFor,
  tick,
  rules,
  sendDigest,
  inWorkHours,
  DEFAULTS,
  WORK,
  APPROVAL,
  PROBATION,
  PEOPLE_EVENTS,
  SPECS,
};
