"use strict";
/**
 * Turning an event into notifications: who is told, what it says, on which channels.
 *
 * Runs in the worker as ONE outbox handler for every event ("notifications.fanout"),
 * after the change has committed. A module never writes a notification row itself;
 * it declares, in its events file, which of its events notify whom:
 *
 *   const { defineNotification } = require("../../shared/notifications/fanout");
 *
 *   defineNotification("leave_request.submitted", {
 *     to: [{ permission: ["people", "approve"] }],          // RBAC holders, scope-aware
 *     title: "Leave request",
 *     body: (e) => `${e.payload.employee_name} asked for ${e.payload.days} days`,
 *   });
 *
 *   defineNotification("payslip.published", {
 *     to: [{ subject: true }],                               // the employee it is about
 *     title: "Your payslip is ready",
 *   });
 *
 * Audiences (`to`, any number, joined):
 *
 *   { permission: [module, action] }   active users whose roles grant the action. When the
 *                                      event has a subject employee (payload.subject_employee_id
 *                                      or payload.employee_id), scope applies: `all` holders,
 *                                      `team` holders above the subject, the subject for `own`.
 *                                      Without a subject, only `all` holders. Also a function
 *                                      (event) => [module, action] for a rule-chosen permission.
 *   { subject: true }                  the subject employee's login
 *   { approvers: true }                the current stage's approvers (workflow events)
 *   { requester: true }                whoever opened the approval (payload.opened_by)
 *   { ceo: true }                      the CEO
 *   { users: (event) => ids }          anyone else, chosen from the event
 *
 * Rules:
 *  - The person who acted is not told about their own action (include_actor: true to
 *    override, e.g. a confirmation).
 *  - Events marked `security` in the catalogue also reach the access watchers (the CEO
 *    and holders of `settings` edit with scope all), and their preferences cannot
 *    silence it (shared/notifications/categories.js).
 *  - The CEO is not added to every permission audience. The CEO passes every check,
 *    but being told of every leave request is noise; the CEO is told what names them.
 *  - Preferences decide channels per (category, channel). A person with every
 *    channel off for a category gets no row.
 *  - At least once, idempotent: one row per (event, user) (UNIQUE), so a retried
 *    event inserts nothing twice.
 *  - The link is not stored. The inbox derives it from entity_type and entity_id
 *    through shared/route-map.js when it is read.
 *
 * Delivery (email, push, the realtime bell) is registered with onDelivery() by the
 * worker. Rows are handed over once (delivery_queued_at), and a failed hand-over is
 * retried with the event.
 *
 * Tables (migration 0060; BACKEND_STRUCTURE §11.1):
 *   notification             notification_id, user_id, event_id, event_key, category, priority,
 *                            title, body, entity_type, entity_id, channels text[], created_at,
 *                            read_at, delivery_queued_at; UNIQUE (event_id, user_id)
 *   notification_preference  user_id, category, channel, enabled; PRIMARY KEY (user_id, category, channel)
 */
const { pool: defaultPool } = require("../../config/db");
const { logger } = require("../../config/logger");
const catalog = require("../access/access.catalog");
const catalogue = require("../events/catalogue");
const outbox = require("../events/outbox");
const approvers = require("../workflow/approvers");
const categories = require("./categories");

const SPECS = new Map();
const deliveryHooks = [];
const TITLE_MAX = 200;
const BODY_MAX = 1000;
const AUDIENCE_KEYS = ["permission", "subject", "approvers", "requester", "ceo", "users"];

/* ------------------------------------------------------------------ *
 * Declaring
 * ------------------------------------------------------------------ */

function checkAudience(key, a) {
  const where = `defineNotification(${key})`;
  const kinds = Object.keys(a || {}).filter((k) => AUDIENCE_KEYS.includes(k));
  if (kinds.length !== 1 || Object.keys(a).length !== 1) throw new Error(`${where}: each audience is one of ${AUDIENCE_KEYS.join(", ")}`);
  if (a.permission && typeof a.permission !== "function") {
    const [module, action] = a.permission;
    if (!catalog.isModule(module) || !catalog.isAction(action)) throw new Error(`${where}: permission is [module, action], got ${JSON.stringify(a.permission)}`);
  }
  if (a.users && typeof a.users !== "function") throw new Error(`${where}: users is a function (event) => user ids`);
}

/**
 * Declare who an event notifies. One declaration per event key.
 * @param {string} key  a declared event key
 * @param {{to: object[], title: string|Function, body?: string|Function, priority?: "normal"|"high",
 *          include_actor?: boolean}} spec
 */
function defineNotification(key, spec) {
  const where = `defineNotification(${key})`;
  if (!catalogue.has(key)) throw new Error(`${where}: declare the event with defineEvents() first`);
  if (!spec || !Array.isArray(spec.to) || spec.to.length === 0) throw new Error(`${where}: give to: [audiences]`);
  spec.to.forEach((a) => checkAudience(key, a));
  if (!spec.title || !["string", "function"].includes(typeof spec.title)) throw new Error(`${where}: title is a string or (event) => string`);
  if (spec.body !== undefined && !["string", "function"].includes(typeof spec.body)) throw new Error(`${where}: body is a string or (event) => string`);
  if (spec.priority && !["normal", "high"].includes(spec.priority)) throw new Error(`${where}: priority is normal or high`);
  for (const text of [spec.title, spec.body]) {
    if (typeof text === "string" && text.includes("\u2014")) throw new Error(`${where}: no em dashes in copy a person reads`);
  }
  const existing = SPECS.get(key);
  if (existing && existing !== spec) throw new Error(`${where}: already declared`);
  SPECS.set(key, spec);
}

/** Register who sends a notification out (email, push, realtime). The worker does this. */
function onDelivery(fn) {
  if (typeof fn !== "function") throw new Error("onDelivery: give a function (rows, event) => Promise");
  if (!deliveryHooks.includes(fn)) deliveryHooks.push(fn);
}

/* ------------------------------------------------------------------ *
 * Recipients
 * ------------------------------------------------------------------ */

function subjectOf(event) {
  const p = event.payload || {};
  return p.subject_employee_id || p.employee_id || null;
}

async function permissionHolders(client, [module, action], subjectId) {
  const column = `can_${action}`;
  if (!catalog.isAction(action)) throw new Error(`fanout: unknown action "${action}"`);
  const { rows } = await client.query(
    `WITH RECURSIVE chain AS (
       SELECT employee_id, line_manager_id, 0 AS depth FROM employee WHERE employee_id = $2::uuid
       UNION ALL
       SELECT e.employee_id, e.line_manager_id, c.depth + 1
         FROM employee e JOIN chain c ON e.employee_id = c.line_manager_id
        WHERE c.depth < 20
     ), holders AS (
       SELECT u.user_id, u.employee_id, p.scope
         FROM app_user u
         JOIN user_role ur ON ur.user_id = u.user_id
         JOIN permission p ON p.role_id = ur.role_id AND p.module_key = $1 AND p."${column}" = true
        WHERE u.status = 'active'
     )
     SELECT DISTINCT h.user_id
       FROM holders h
      WHERE h.scope = 'all'
         OR ($2::uuid IS NOT NULL AND h.scope = 'team' AND h.employee_id IN (SELECT employee_id FROM chain))
         OR ($2::uuid IS NOT NULL AND h.scope = 'own' AND h.employee_id = $2::uuid)
      ORDER BY h.user_id`,
    [module, subjectId],
  );
  return rows.map((r) => r.user_id);
}

async function usersOfEmployees(client, employeeIds) {
  if (employeeIds.length === 0) return [];
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = ANY($1::uuid[]) AND status = 'active' ORDER BY user_id",
    [employeeIds],
  );
  return rows.map((r) => r.user_id);
}

async function ceoUsers(client) {
  const { rows } = await client.query("SELECT user_id FROM app_user WHERE is_ceo = true AND status = 'active' ORDER BY user_id");
  return rows.map((r) => r.user_id);
}

async function audienceUsers(client, audience, event) {
  if (audience.permission) {
    const perm = typeof audience.permission === "function" ? audience.permission(event) : audience.permission;
    if (!perm) return [];
    return permissionHolders(client, perm, subjectOf(event));
  }
  if (audience.subject) {
    const id = subjectOf(event);
    return id ? usersOfEmployees(client, [id]) : [];
  }
  if (audience.approvers) return approvers.recipients(client, (event.payload && event.payload.stage_approvers) || []);
  if (audience.requester) {
    const id = event.payload && event.payload.opened_by;
    return id ? [id] : [];
  }
  if (audience.ceo) return ceoUsers(client);
  if (audience.users) return (await audience.users(event, client)) || [];
  return [];
}

/** The people who watch access changes: the CEO and `settings` editors with scope all. */
async function watchers(client) {
  const [ceo, editors] = await Promise.all([ceoUsers(client), permissionHolders(client, ["settings", "edit"], null)]);
  return [...new Set([...ceo, ...editors])];
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const clamp = (s, max) => {
  const t = String(s || "").replace(/\u2014/g, ",").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const textOf = (value, event) => (typeof value === "function" ? value(event) : value);

async function preferencesOf(client, userIds, category) {
  const { rows } = await client.query(
    "SELECT user_id, channel, enabled FROM notification_preference WHERE user_id = ANY($1::uuid[]) AND category = $2",
    [userIds, category],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.user_id)) out.set(r.user_id, {});
    out.get(r.user_id)[r.channel] = r.enabled;
  }
  return out;
}

function channelsFor(category, stored = {}) {
  return categories.CHANNELS.filter((ch) => categories.isOn(category, ch, stored[ch]));
}

async function securityMessage(client, event, entry) {
  let who = "";
  if (event.actor_user_id) {
    const { rows } = await client.query(
      `SELECT trim(e.first_name || ' ' || e.last_name) AS name
         FROM app_user u JOIN employee e ON e.employee_id = u.employee_id
        WHERE u.user_id = $1`,
      [event.actor_user_id],
    );
    who = rows[0] ? ` by ${rows[0].name}` : "";
  }
  return { title: `Access change: ${entry.summary}`, body: `${entry.summary}${who}.` };
}

/**
 * The outbox handler. Exposed for tests and for the worker's registration.
 * @param {object} event  from the outbox
 * @param {object} [_ctx]
 * @param {{db?: import("pg").Pool}} [opts]
 * @returns {Promise<{recipients: number, inserted: number, handed_over: number}>}
 */
async function handle(event, _ctx, { db = defaultPool } = {}) {
  const spec = SPECS.get(event.key);
  const entry = catalogue.get(event.key);
  const security = Boolean(entry && entry.security);
  if (!spec && !security) return { recipients: 0, inserted: 0, handed_over: 0 };

  const category = security ? "security" : categories.categoryFor(event.key, event.module);
  const priority = security ? "high" : (spec && spec.priority) || "normal";

  // Who, and what each group is told. A security event's watchers get the security
  // message; anyone the module named gets the module's.
  const messages = new Map();
  if (spec) {
    const title = clamp(textOf(spec.title, event), TITLE_MAX);
    const body = spec.body === undefined ? "" : clamp(textOf(spec.body, event), BODY_MAX);
    for (const audience of spec.to) {
      for (const id of await audienceUsers(db, audience, event)) messages.set(id, { title, body });
    }
    if (!spec.include_actor && event.actor_user_id) messages.delete(event.actor_user_id);
  }
  if (security) {
    const msg = await securityMessage(db, event, entry);
    for (const id of await watchers(db)) if (!messages.has(id) && id !== event.actor_user_id) messages.set(id, msg);
  }
  if (messages.size === 0) return { recipients: 0, inserted: 0, handed_over: 0 };

  const ids = [...messages.keys()];
  const prefs = await preferencesOf(db, ids, category);
  const users = [];
  const chans = [];
  const titles = [];
  const bodies = [];
  for (const id of ids) {
    const channels = channelsFor(category, prefs.get(id));
    if (channels.length === 0) continue;
    users.push(id);
    chans.push(channels.join(","));
    titles.push(messages.get(id).title);
    bodies.push(messages.get(id).body);
  }

  let inserted = 0;
  if (users.length) {
    const res = await db.query(
      `INSERT INTO notification
         (user_id, event_id, event_key, category, priority, title, body, entity_type, entity_id, channels)
       SELECT t.user_id, $5, $6, $7, $8, t.title, NULLIF(t.body, ''), $9, $10, string_to_array(t.channels, ',')
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS t(user_id, channels, title, body)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [users, chans, titles, bodies, event.event_id, event.key, category, priority, event.entity.type, event.entity.id],
    );
    inserted = res.rowCount;
  }

  // Hand over everything for this event not yet handed over, including rows a
  // failed earlier attempt inserted.
  let handedOver = 0;
  if (deliveryHooks.length) {
    const { rows } = await db.query(
      `SELECT notification_id, user_id, category, priority, title, body, entity_type, entity_id, channels
         FROM notification
        WHERE event_id = $1 AND delivery_queued_at IS NULL
        ORDER BY notification_id`,
      [event.event_id],
    );
    if (rows.length) {
      for (const hook of deliveryHooks) await hook(rows, event);
      await db.query("UPDATE notification SET delivery_queued_at = now() WHERE notification_id = ANY($1::uuid[])", [
        rows.map((r) => r.notification_id),
      ]);
      handedOver = rows.length;
    }
  }

  logger.debug({ event_key: event.key, recipients: users.length, inserted }, "notifications fanned out");
  return { recipients: users.length, inserted, handed_over: handedOver };
}

outbox.register(outbox.ALL, "notifications.fanout", (event, ctx) => handle(event, ctx));

/* ------------------------------------------------------------------ *
 * The shared layer's own events
 * ------------------------------------------------------------------ */

const { WORKFLOW, ALERTS } = catalogue;
const nameOf = (e) => e.payload.definition_name || "A request";
const OUTCOME = { approved: "Approved", rejected: "Rejected", cancelled: "Withdrawn", timeout_approved: "Approved", timeout_rejected: "Rejected" };

defineNotification(WORKFLOW.WORKFLOW_OPENED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "A stage"} is waiting on you.`,
});

defineNotification(WORKFLOW.WORKFLOW_ADVANCED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "The next stage"} is waiting on you.`,
});

defineNotification(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, {
  to: [{ requester: true }, { approvers: true }],
  title: (e) => `Changes requested: ${nameOf(e)}`,
  body: (e) => (e.payload.reason ? `Reason: ${e.payload.reason}` : "An approver sent this back."),
});

defineNotification(WORKFLOW.WORKFLOW_COMPLETED, {
  // Approved on submission (nothing applied) needs no message; every other ending does.
  to: [{ users: (e) => (e.payload.auto && e.payload.state === "approved" && !e.payload.decided_stage ? [] : [e.payload.opened_by].filter(Boolean)) }],
  title: (e) => `${nameOf(e)}: ${OUTCOME[e.payload.state] || "Decided"}`,
  body: (e) => (e.payload.reason ? `Reason: ${e.payload.reason}` : e.payload.auto ? "Decided automatically at the time limit." : ""),
});

defineNotification(WORKFLOW.WORKFLOW_ESCALATED, {
  to: [{ ceo: true }, { approvers: true }],
  title: (e) => `Overdue approval: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "A stage"} passed its time limit without a decision.`,
  priority: "high",
});

defineNotification(WORKFLOW.WORKFLOW_CANCELLED, {
  to: [{ users: (e, client) => approvers.recipients(client, e.payload.withdrawn_from || []) }],
  title: (e) => `Withdrawn: ${nameOf(e)}`,
  body: "The requester withdrew this before it was decided.",
});

defineNotification(ALERTS.HOME_ALERT_RAISED, {
  to: [{ permission: (e) => e.payload.clear_permission }],
  title: (e) => `Alert: ${e.payload.title}`,
  body: (e) => e.payload.trigger || "",
  priority: "normal",
});

defineNotification(ALERTS.HOME_ALERT_ESCALATED, {
  to: [{ ceo: true }],
  title: (e) => `Escalated alert: ${e.payload.title}`,
  body: (e) => `Open for ${e.payload.age_days} days without being cleared.`,
  priority: "high",
});

/** Tests only. */
function __hooks() {
  return deliveryHooks;
}

module.exports = { defineNotification, onDelivery, handle, watchers, permissionHolders, SPECS, __hooks };
