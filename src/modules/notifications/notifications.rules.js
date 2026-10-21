"use strict";
/**
 * Settings · Notifications (docs/guides/notifications.md §2, §6): the company's rule per notice,
 * and its reminders. Holders of `settings` view read them; holders of `settings` edit change them
 * (the routes check it). The notices are the code's declarations (fanout.notices()); a rule row
 * exists only where People changed something, so a notice nobody touched behaves exactly as
 * declared, and Reset to Default deletes the row.
 */
const fs = require("node:fs");
const path = require("node:path");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const { AppError } = require("../../shared/errors");
const categories = require("../../shared/notifications/categories");
const fanout = require("../../shared/notifications/fanout");
const { EVENTS } = require("./notifications.events");
const reminders = require("./notifications.reminders");
const repo = require("./notifications.repo");

const MODULES_DIR = path.resolve(__dirname, "..");
const LABELS = new Map(categories.CATEGORIES.map((c) => [c.key, c.label]));
const three = (fn) => ({ in_app: fn("in_app"), email: fn("email"), push: fn("push") });
const invalid = (fields) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, fields);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

let loaded = false;
/**
 * Every notice, with every module's declarations loaded, so the API lists exactly what the
 * worker sends (the worker loads each <module>.events.js at boot; the API only those its routes
 * reach).
 */
function notices() {
  if (!loaded) {
    for (const name of fs.readdirSync(MODULES_DIR).sort()) {
      const file = path.join(MODULES_DIR, name, `${name}.events.js`);
      if (fs.existsSync(file) && fs.statSync(file).size > 0) require(file);
    }
    loaded = true;
  }
  return fanout.notices();
}

function noticeOf(key) {
  const notice = notices().find((n) => n.event_key === key);
  if (!notice) throw new AppError("NOT_FOUND", "There is no such notice.", 404);
  return notice;
}

/** A notice as Settings shows it: what the code declares, with the company's rule applied. */
function present(notice, rule, roles = [], people = []) {
  const urgency =
    notice.urgency_default === null ? null : (!notice.locked && rule && rule.urgency) || notice.urgency_default;
  return {
    event_key: notice.event_key,
    name: notice.name,
    category: notice.category,
    category_label: LABELS.get(notice.category) || notice.category,
    who: notice.who,
    locked: notice.locked,
    copies: notice.copies,
    enabled: notice.locked || !rule ? true : rule.enabled,
    urgency,
    urgency_default: notice.urgency_default,
    channels: three((ch) =>
      categories.isOn(notice.category, ch, undefined, rule ? rule[ch] : null, notice.channels ? notice.channels[ch] : null),
    ),
    // What the notice falls back to with no company rule: its own declared channels
    // where it has them (the 24 hour escalation declares email), else its category's.
    defaults: three((ch) =>
      notice.channels && notice.channels[ch] !== undefined && notice.channels[ch] !== null
        ? notice.channels[ch] === true
        : categories.defaultOn(notice.category, ch),
    ),
    roles: roles.map((r) => ({ code: r.code, name: r.name })),
    people,
    changed: Boolean(rule),
    updated_at: rule ? new Date(rule.updated_at).toISOString() : null,
  };
}

async function presentOne(db, notice) {
  const rule = await repo.ruleOf(db, notice.event_key);
  if (!rule) return present(notice, null);
  const [roles, people] = await Promise.all([
    repo.copiedRoles(db, [rule.notification_rule_id]),
    repo.copiedPeople(db, [rule.notification_rule_id]),
  ]);
  return present(notice, rule, roles, people.map((p) => p.person));
}

/** A page of notices with their rules, in category order. */
async function list(query) {
  const all = notices();
  const byKey = new Map(all.map((n) => [n.event_key, n]));
  const page = await repo.rulePage(pool, all, query);
  const ids = page.data.map((r) => r.notification_rule_id).filter(Boolean);
  const [roles, people] = await Promise.all([repo.copiedRoles(pool, ids), repo.copiedPeople(pool, ids)]);
  return {
    data: page.data.map((r) => {
      const id = r.notification_rule_id;
      return present(
        byKey.get(r.event_key),
        id ? r : null,
        roles.filter((x) => x.notification_rule_id === id),
        people.filter((x) => x.notification_rule_id === id).map((x) => x.person),
      );
    }),
    page: page.page,
  };
}

/**
 * Set the company's rule for one notice. What equals the code's default is stored as null, so a
 * notice saved back to its defaults has no rule at all.
 */
async function save(actor, key, body) {
  const notice = noticeOf(key);
  const category = notice.category;
  if (notice.locked) {
    const off = !body.enabled || categories.CHANNELS.some((ch) => categories.defaultOn(category, ch) && !body[ch]);
    const changedLevel = body.urgency !== null && body.urgency !== notice.urgency_default;
    if (off || changedLevel) throw new AppError("NOTICE_LOCKED", "Security notices stay on, as they are.", 422);
  }
  if (notice.urgency_default === null && body.urgency !== null)
    throw new AppError("URGENCY_SET_BY_POSTER", "Its poster chooses the level.", 422);
  const codes = [...new Set(body.role_codes.map((c) => c.toLowerCase()))];
  const employeeIds = [...new Set(body.employee_ids)];
  if (!notice.copies && (codes.length || employeeIds.length))
    throw new AppError("NOTICE_TAKES_NO_COPIES", "This notice is for one person and takes no copies.", 422);

  return tx(async (client) => {
    const roles = await repo.rolesByCode(client, codes);
    if (roles.length !== codes.length) throw invalid({ role_codes: ["Role not found"] });
    const current = await repo.currentEmployees(client, employeeIds);
    if (current.length !== employeeIds.length) throw invalid({ employee_ids: ["Person not found"] });

    const rule = {
      enabled: notice.locked ? true : body.enabled,
      urgency: body.urgency === null || body.urgency === notice.urgency_default ? null : body.urgency,
      ...three((ch) => (body[ch] === categories.defaultOn(category, ch) ? null : body[ch])),
    };
    const plain =
      rule.enabled && rule.urgency === null && categories.CHANNELS.every((ch) => rule[ch] === null) &&
      roles.length === 0 && current.length === 0;
    const before = await repo.ruleOf(client, key, { lock: true });
    if (plain) await repo.deleteRule(client, key);
    else {
      const saved = await repo.saveRule(client, { eventKey: key, ...rule, updatedBy: actor.user_id });
      await repo.replaceCopies(client, saved.notification_rule_id, {
        roleIds: roles.map((r) => r.role_id),
        employeeIds: current,
      });
    }
    await emit(client, {
      key: EVENTS.NOTIFICATION_RULE_CHANGED,
      entity: { type: "notification_rule", id: key },
      actor,
      before: before || null,
      after: { event_key: key, ...rule },
      payload: {
        event_key: key,
        reset: plain,
        enabled: rule.enabled,
        urgency: rule.urgency,
        role_codes: roles.map((r) => r.code),
        employee_ids: current,
      },
    });
    return presentOne(client, notice);
  });
}

/** Reset to Default: the notice behaves as the code declares it again. */
async function reset(actor, key) {
  const notice = noticeOf(key);
  return tx(async (client) => {
    const before = await repo.ruleOf(client, key, { lock: true });
    if (before) {
      await repo.deleteRule(client, key);
      await emit(client, {
        key: EVENTS.NOTIFICATION_RULE_CHANGED,
        entity: { type: "notification_rule", id: key },
        actor,
        before,
        after: null,
        payload: { event_key: key, reset: true },
      });
    }
    return present(notice, null);
  });
}

/* ------------------------------------------------------------------ *
 * The company's reminders
 * ------------------------------------------------------------------ */

/** The three reminders as Settings shows them, defaults applied. */
async function remindersOf(db = pool) {
  const r = await reminders.rules(db);
  return {
    approvals: { enabled: r.approvals.enabled, every_hours: r.approvals.every_hours },
    probation: { enabled: r.probation.enabled, days_ahead: r.probation.days_ahead },
    digest: { enabled: r.digest.enabled, at_time: r.digest.at_time },
  };
}

/** Save all three; a new approval interval moves the next reminder of every approval waiting. */
async function saveReminders(actor, body, now = new Date()) {
  return tx(async (client) => {
    const before = await remindersOf(client);
    await repo.saveReminderRule(client, { key: "approvals", ...body.approvals, updatedBy: actor.user_id });
    await repo.saveReminderRule(client, { key: "probation", ...body.probation, updatedBy: actor.user_id });
    await repo.saveReminderRule(client, { key: "digest", ...body.digest, updatedBy: actor.user_id });
    if (before.approvals.every_hours !== body.approvals.every_hours)
      await repo.repaceReminders(client, reminders.APPROVAL, body.approvals.every_hours * 60, now);
    await emit(client, {
      key: EVENTS.NOTIFICATION_REMINDER_CHANGED,
      entity: { type: "notification_reminder", id: "company" },
      actor,
      before,
      after: body,
      payload: body,
    });
    return remindersOf(client);
  });
}

module.exports = { notices, list, save, reset, remindersOf, saveReminders };
