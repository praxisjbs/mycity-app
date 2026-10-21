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
 *                                      `team` holders above the subject (through any vacant
 *                                      seat, employee_effective_manager), the subject for `own`.
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
 * On a phone or computer, notices of one conversation share a notification
 * (docs/guides/notifications.md §6). A declaration may say how, with `push`:
 *
 *   defineNotification("channel_message.posted", {
 *     ...,
 *     push: { tag: (e) => `community_channel:${e.payload.community_channel_id}`, mode: "alert" },
 *   });
 *
 * `tag` names the conversation (default: the notice's record); `mode` is `alert` (a newer
 * notice replaces the shown one and alerts again, the default for a record), `quiet` (it
 * replaces it silently until opened) or `single` (it stands alone).
 *
 * How hard a notice insists (docs/guides/notifications.md §6), with `urgency`: `normal` (the
 * default), `important` (amber) or `urgent` (red, in the urgent bar, alerted again every 30
 * minutes of the working day until it closes), a value or (event) => value. Every Security
 * notice is urgent. `acknowledge: true` (or (event) => boolean) makes an urgent notice close
 * only on Acknowledge, not on opening:
 *
 *   defineNotification("announcement.published", {
 *     ...,
 *     urgency: (e) => e.payload.urgency,
 *     acknowledge: (e) => e.payload.urgency === "urgent",
 *   });
 *
 * People see every declaration in Settings · Notifications (docs/guides/notifications.md §6) and
 * set the company's rule for it (`notification_rule`): Off tells nobody (Security excepted), the
 * urgency replaces a fixed one, the default channels apply where a person has not chosen their
 * own. Two options say how a declaration reads there:
 *
 *   channels  the notice's own default channels, where the category's are wrong for it:
 *             { email: true } on the 24 hour escalation, whose category leaves email off.
 *             A person's own preference and the company's rule still win over it.
 *   who    names an audience the code chooses ({ users }): "The channel's members"
 *   copy   the notice is about someone else, so People may copy it to roles and named people:
 *          true (a copy reads as the notice does) or { title?, body? } (what a copy reads
 *          instead, as "Waiting on its approvers" where the notice says "Waiting on you").
 *          Without it a notice is personal to its audience (a message, mail, an account) and
 *          takes no copies.
 *
 * Tables (migration 0060; BACKEND_STRUCTURE §11.1):
 *   notification             notification_id, user_id, event_id, event_key, category, priority,
 *                            title, body, entity_type, entity_id, channels text[], created_at,
 *                            read_at, delivery_queued_at; UNIQUE (event_id, user_id). From 0470:
 *                            urgency, acknowledge_required, acknowledged_at and the urgent
 *                            repeats' pace (repeat_count, last_alert_at, repeat_day, repeats_on_day)
 *   notification_preference  user_id, category, channel, enabled; PRIMARY KEY (user_id, category, channel)
 *   notification_rule        (0480) event_key, enabled, urgency, in_app, email, push; and
 *   notification_rule_recipient  its copies, role_id or employee_id
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
const PUSH_MODES = ["alert", "quiet", "single"];
const URGENCIES = ["normal", "important", "urgent"];
const TITLE_MAX = 200;
const BODY_MAX = 1000;
const AUDIENCE_KEYS = [
  "permission",
  "subject",
  "approvers",
  "requester",
  "ceo",
  "users",
];

/* ------------------------------------------------------------------ *
 * Declaring
 * ------------------------------------------------------------------ */

function checkAudience(key, a) {
  const where = `defineNotification(${key})`;
  const kinds = Object.keys(a || {}).filter((k) => AUDIENCE_KEYS.includes(k));
  if (kinds.length !== 1 || Object.keys(a).length !== 1)
    throw new Error(
      `${where}: each audience is one of ${AUDIENCE_KEYS.join(", ")}`,
    );
  if (a.permission && typeof a.permission !== "function") {
    const [module, action] = a.permission;
    if (!catalog.isModule(module) || !catalog.isAction(action))
      throw new Error(
        `${where}: permission is [module, action], got ${JSON.stringify(a.permission)}`,
      );
  }
  if (a.users && typeof a.users !== "function")
    throw new Error(`${where}: users is a function (event) => user ids`);
}

/**
 * Declare who an event notifies. One declaration per event key.
 * @param {string} key  a declared event key
 * @param {{to: object[], title: string|Function, body?: string|Function, priority?: "normal"|"high",
 *          include_actor?: boolean}} spec
 */
function defineNotification(key, spec) {
  const where = `defineNotification(${key})`;
  if (!catalogue.has(key))
    throw new Error(`${where}: declare the event with defineEvents() first`);
  if (!spec || !Array.isArray(spec.to) || spec.to.length === 0)
    throw new Error(`${where}: give to: [audiences]`);
  spec.to.forEach((a) => checkAudience(key, a));
  if (!spec.title || !["string", "function"].includes(typeof spec.title))
    throw new Error(`${where}: title is a string or (event) => string`);
  if (
    spec.body !== undefined &&
    !["string", "function"].includes(typeof spec.body)
  )
    throw new Error(`${where}: body is a string or (event) => string`);
  if (spec.priority && !["normal", "high"].includes(spec.priority))
    throw new Error(`${where}: priority is normal or high`);
  if (
    spec.urgency !== undefined &&
    typeof spec.urgency !== "function" &&
    !URGENCIES.includes(spec.urgency)
  )
    throw new Error(`${where}: urgency is ${URGENCIES.join(", ")} or (event) => one of them`);
  if (
    spec.acknowledge !== undefined &&
    !["boolean", "function"].includes(typeof spec.acknowledge)
  )
    throw new Error(`${where}: acknowledge is a boolean or (event) => boolean`);
  if (spec.push !== undefined) {
    const p = spec.push;
    if (!p || typeof p !== "object")
      throw new Error(`${where}: push is { tag?, mode? }`);
    if (p.tag !== undefined && typeof p.tag !== "function")
      throw new Error(`${where}: push.tag is (event) => string`);
    if (p.mode !== undefined && !PUSH_MODES.includes(p.mode))
      throw new Error(`${where}: push.mode is ${PUSH_MODES.join(", ")}`);
  }
  if (spec.channels !== undefined) {
    const c = spec.channels;
    if (!c || typeof c !== "object" || Object.keys(c).some((k) => !categories.CHANNELS.includes(k)))
      throw new Error(`${where}: channels names ${categories.CHANNELS.join(", ")}`);
    for (const k of Object.keys(c))
      if (typeof c[k] !== "boolean")
        throw new Error(`${where}: channels.${k} is a boolean`);
  }
  if (spec.who !== undefined && (typeof spec.who !== "string" || !spec.who.trim()))
    throw new Error(`${where}: who is the words naming its audience`);
  if (spec.copy !== undefined && spec.copy !== true) {
    const c = spec.copy;
    if (!c || typeof c !== "object" || Object.keys(c).some((k) => !["title", "body"].includes(k)))
      throw new Error(`${where}: copy is true or { title?, body? }`);
    for (const k of ["title", "body"])
      if (c[k] !== undefined && !["string", "function"].includes(typeof c[k]))
        throw new Error(`${where}: copy.${k} is a string or (event) => string`);
  }
  const copyTexts = spec.copy && spec.copy !== true ? [spec.copy.title, spec.copy.body] : [];
  for (const text of [spec.title, spec.body, spec.who, ...copyTexts]) {
    if (typeof text === "string" && text.includes("\u2014"))
      throw new Error(`${where}: no em dashes in copy a person reads`);
  }
  const existing = SPECS.get(key);
  if (existing && existing !== spec)
    throw new Error(`${where}: already declared`);
  SPECS.set(key, spec);
}

/**
 * How an event's notices group on a device: `{ tag, mode }` from its declaration, either
 * part null when the declaration leaves it to the record (services/push/payload.styleOf).
 */
function pushStyleOf(event) {
  const spec = SPECS.get(event && event.key);
  const p = spec && spec.push;
  if (!p) return null;
  let tag;
  try {
    tag = p.tag ? String(p.tag(event) || "") || null : null;
  } catch {
    tag = null;
  }
  return { tag, mode: p.mode || null };
}

/**
 * How hard an event's notices insist: Security is always urgent; then the company's rule, for a
 * declaration whose urgency is fixed (an announcement's stays with its poster); otherwise the
 * declaration's `urgency`, else normal. A function that throws or answers something else counts
 * as normal. `acknowledge` holds only for an urgent notice its declaration asks it of.
 */
function urgencyOf(event, spec, security, rule = null) {
  if (security) return { urgency: "urgent", acknowledge: false };
  if (rule && rule.urgency && !(spec && typeof spec.urgency === "function"))
    return { urgency: rule.urgency, acknowledge: false };
  try {
    const u = spec && textOf(spec.urgency, event);
    const urgency = URGENCIES.includes(u) ? u : "normal";
    const acknowledge = urgency === "urgent" && Boolean(spec && textOf(spec.acknowledge, event));
    return { urgency, acknowledge };
  } catch {
    return { urgency: "normal", acknowledge: false };
  }
}

/** Register who sends a notification out (email, push, realtime). The worker does this. */
function onDelivery(fn) {
  if (typeof fn !== "function")
    throw new Error("onDelivery: give a function (rows, event) => Promise");
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
  if (!catalog.isAction(action))
    throw new Error(`fanout: unknown action "${action}"`);
  const { rows } = await client.query(
    `WITH RECURSIVE line AS MATERIALIZED (
       SELECT employee_id, manager_id FROM employee_effective_manager
     ), chain AS (
       SELECT employee_id, manager_id, 0 AS depth FROM line WHERE employee_id = $2::uuid
       UNION ALL
       SELECT l.employee_id, l.manager_id, c.depth + 1
         FROM line l JOIN chain c ON l.employee_id = c.manager_id
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
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE is_ceo = true AND status = 'active' ORDER BY user_id",
  );
  return rows.map((r) => r.user_id);
}

async function audienceUsers(client, audience, event) {
  if (audience.permission) {
    const perm =
      typeof audience.permission === "function"
        ? audience.permission(event)
        : audience.permission;
    if (!perm) return [];
    return permissionHolders(client, perm, subjectOf(event));
  }
  if (audience.subject) {
    const id = subjectOf(event);
    return id ? usersOfEmployees(client, [id]) : [];
  }
  if (audience.approvers)
    return approvers.recipients(
      client,
      (event.payload && event.payload.stage_approvers) || [],
      // The people an approval excludes are never asked to decide it (foundation.md §6.5).
      { excludeEmployees: (event.payload && event.payload.excluded_employee_ids) || [] },
    );
  if (audience.requester) {
    const id = event.payload && event.payload.opened_by;
    return id ? [id] : [];
  }
  if (audience.ceo) return ceoUsers(client);
  if (audience.users) return (await audience.users(event, client)) || [];
  return [];
}

/**
 * The company's rule for one notice (Settings · Notifications), or null when People never changed
 * it: On or Off, the urgency, the default channels, and the roles and people it is copied to.
 */
async function ruleOf(client, eventKey) {
  const { rows } = await client.query(
    `SELECT r.enabled, r.urgency, r.in_app, r.email, r.push,
            COALESCE(array_agg(rr.role_id) FILTER (WHERE rr.role_id IS NOT NULL), '{}') AS role_ids,
            COALESCE(array_agg(rr.employee_id) FILTER (WHERE rr.employee_id IS NOT NULL), '{}') AS employee_ids
       FROM notification_rule r
       LEFT JOIN notification_rule_recipient rr ON rr.notification_rule_id = r.notification_rule_id
      WHERE r.event_key = $1
      GROUP BY r.notification_rule_id`,
    [eventKey],
  );
  return rows[0] || null;
}

/** The active people a rule copies a notice to: its roles' holders and its named people. */
async function copiedTo(client, rule) {
  if (!rule || (rule.role_ids.length === 0 && rule.employee_ids.length === 0)) return [];
  const { rows } = await client.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
      WHERE u.status = 'active'
        AND (u.employee_id = ANY($2::uuid[])
             OR EXISTS (SELECT 1 FROM user_role ur WHERE ur.user_id = u.user_id AND ur.role_id = ANY($1::uuid[])))
      ORDER BY u.user_id`,
    [rule.role_ids, rule.employee_ids],
  );
  return rows.map((r) => r.user_id);
}

/** The people who watch access changes: the CEO and `settings` editors with scope all. */
async function watchers(client) {
  const [ceo, editors] = await Promise.all([
    ceoUsers(client),
    permissionHolders(client, ["settings", "edit"], null),
  ]);
  return [...new Set([...ceo, ...editors])];
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

const clamp = (s, max) => {
  const t = String(s || "")
    .replace(/\u2014/g, ",")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const textOf = (value, event) =>
  typeof value === "function" ? value(event) : value;

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

function channelsFor(category, stored = {}, rule = null, declared = null) {
  return categories.CHANNELS.filter((ch) =>
    categories.isOn(
      category,
      ch,
      stored[ch],
      rule ? rule[ch] : null,
      declared ? declared[ch] : null,
    ),
  );
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
  return {
    title: `Access change: ${entry.summary}`,
    body: `${entry.summary}${who}.`,
  };
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

  const category = security
    ? "security"
    : categories.categoryFor(event.key, event.module);
  // The company's rule (Settings · Notifications): Off tells nobody, but Security stays on.
  const rule = await ruleOf(db, event.key);
  if (rule && !rule.enabled && !security && !categories.isLocked(category))
    return { recipients: 0, inserted: 0, handed_over: 0 };
  const priority = security ? "high" : (spec && spec.priority) || "normal";
  const { urgency, acknowledge } = urgencyOf(event, spec, security, rule);

  // Who, and what each group is told. A security event's watchers get the security
  // message; anyone the module named gets the module's; the roles and people People
  // copied it to get its copy, unless they are already told.
  const messages = new Map();
  if (spec) {
    const title = clamp(textOf(spec.title, event), TITLE_MAX);
    const body =
      spec.body === undefined ? "" : clamp(textOf(spec.body, event), BODY_MAX);
    for (const audience of spec.to) {
      for (const id of await audienceUsers(db, audience, event))
        messages.set(id, { title, body });
    }
    if (!spec.include_actor && event.actor_user_id)
      messages.delete(event.actor_user_id);
    if (spec.copy) {
      const own = spec.copy === true ? {} : spec.copy;
      const copy = {
        title: own.title === undefined ? title : clamp(textOf(own.title, event), TITLE_MAX),
        body: own.body === undefined ? body : clamp(textOf(own.body, event), BODY_MAX),
      };
      for (const id of await copiedTo(db, rule))
        if (!messages.has(id) && id !== event.actor_user_id) messages.set(id, copy);
    }
  }
  if (security) {
    const msg = await securityMessage(db, event, entry);
    for (const id of await watchers(db))
      if (!messages.has(id) && id !== event.actor_user_id)
        messages.set(id, msg);
  }
  if (messages.size === 0)
    return { recipients: 0, inserted: 0, handed_over: 0 };

  const ids = [...messages.keys()];
  const prefs = await preferencesOf(db, ids, category);
  const users = [];
  const chans = [];
  const titles = [];
  const bodies = [];
  for (const id of ids) {
    const channels = channelsFor(category, prefs.get(id), rule, spec && spec.channels);
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
         (user_id, event_id, event_key, category, priority, title, body, entity_type, entity_id, channels,
          urgency, acknowledge_required)
       SELECT t.user_id, $5, $6, $7, $8, t.title, NULLIF(t.body, ''), $9, $10, string_to_array(t.channels, ','),
              $11, $12
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS t(user_id, channels, title, body)
       ON CONFLICT (event_id, user_id) DO NOTHING`,
      [
        users,
        chans,
        titles,
        bodies,
        event.event_id,
        event.key,
        category,
        priority,
        event.entity.type,
        event.entity.id,
        urgency,
        acknowledge,
      ],
    );
    inserted = res.rowCount;
  }

  // Hand over everything for this event not yet handed over, including rows a
  // failed earlier attempt inserted.
  let handedOver = 0;
  if (deliveryHooks.length) {
    const { rows } = await db.query(
      `SELECT notification_id, user_id, category, priority, urgency, acknowledge_required, acknowledged_at,
              repeat_count, title, body, entity_type, entity_id, channels, created_at
         FROM notification
        WHERE event_id = $1 AND delivery_queued_at IS NULL
        ORDER BY notification_id`,
      [event.event_id],
    );
    if (rows.length) {
      for (const hook of deliveryHooks) await hook(rows, event);
      await db.query(
        "UPDATE notification SET delivery_queued_at = now() WHERE notification_id = ANY($1::uuid[])",
        [rows.map((r) => r.notification_id)],
      );
      handedOver = rows.length;
    }
  }

  logger.debug(
    { event_key: event.key, recipients: users.length, inserted },
    "notifications fanned out",
  );
  return { recipients: users.length, inserted, handed_over: handedOver };
}

outbox.register(outbox.ALL, "notifications.fanout", (event, ctx) =>
  handle(event, ctx),
);

/* ------------------------------------------------------------------ *
 * The notices People see in Settings · Notifications
 * ------------------------------------------------------------------ */

const AUDIENCE_WHO = Object.freeze({
  subject: "The employee",
  approvers: "Approvers",
  requester: "Requester",
  ceo: "CEO",
});
const WATCHERS_WHO = ["CEO", "Settings editors"];
const CHOSEN_WHO = "Chosen by the record";

const titleCase = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** Who a declaration tells, as People read it: "Approvers", "People · Approve", its `who`. */
function whoOf(spec, security) {
  const out = [];
  for (const a of (spec && spec.to) || []) {
    if (a.permission && typeof a.permission !== "function") {
      const [module, action] = a.permission;
      out.push(`${catalog.MODULE_META[module].label} · ${titleCase(action)}`);
    } else if (a.permission || a.users) out.push((spec && spec.who) || CHOSEN_WHO);
    else out.push(AUDIENCE_WHO[Object.keys(a)[0]]);
  }
  if (security) out.push(...WATCHERS_WHO);
  return [...new Set(out)];
}

/**
 * Every notice People can set: each declaration, and each Security event that only reaches
 * the access watchers, in the categories' order and then by name. `urgency_default` is null
 * where each notice chooses its own (an announcement's poster).
 * @returns {Array<{event_key: string, name: string, module: string, category: string,
 *   who: string[], locked: boolean, copies: boolean, urgency_default: string|null}>}
 */
function notices() {
  const keys = new Set(SPECS.keys());
  for (const e of catalogue.all()) if (e.security) keys.add(e.key);
  const order = new Map(categories.CATEGORIES.map((c, i) => [c.key, i]));
  const out = [];
  for (const key of keys) {
    const entry = catalogue.get(key);
    const spec = SPECS.get(key);
    const security = Boolean(entry.security);
    const category = security ? "security" : categories.categoryFor(key, entry.module);
    let urgencyDefault = "normal";
    if (security) urgencyDefault = "urgent";
    else if (spec && typeof spec.urgency === "function") urgencyDefault = null;
    else if (spec && spec.urgency) urgencyDefault = spec.urgency;
    out.push({
      event_key: key,
      name: entry.summary,
      module: entry.module,
      category,
      who: whoOf(spec, security),
      locked: security || categories.isLocked(category),
      copies: Boolean(spec && spec.copy),
      urgency_default: urgencyDefault,
      channels: (spec && spec.channels) || null,
    });
  }
  return out.sort(
    (a, b) =>
      (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) ||
      a.name.localeCompare(b.name) ||
      a.event_key.localeCompare(b.event_key),
  );
}

/* ------------------------------------------------------------------ *
 * The shared layer's own events
 * ------------------------------------------------------------------ */

const { WORKFLOW, ALERTS } = catalogue;
const nameOf = (e) => e.payload.definition_name || "A request";
/** How long a reminded stage has waited: "5 hours", "2 days". */
function waited(e) {
  const hours = Math.max(1, Math.round(Number(e.payload.waited_hours) || 1));
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.floor(hours / 24)} days`;
}
const OUTCOME = {
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Withdrawn",
  timeout_approved: "Approved",
  timeout_rejected: "Rejected",
};

defineNotification(WORKFLOW.WORKFLOW_OPENED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "A stage"} is waiting on you.`,
  copy: { body: (e) => `${e.payload.stage_name || "A stage"} is waiting on its approvers.` },
});

defineNotification(WORKFLOW.WORKFLOW_ADVANCED, {
  to: [{ approvers: true }],
  title: (e) => `Approval needed: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "The next stage"} is waiting on you.`,
  copy: { body: (e) => `${e.payload.stage_name || "The next stage"} is waiting on its approvers.` },
});

defineNotification(WORKFLOW.WORKFLOW_CHANGES_REQUESTED, {
  to: [{ requester: true }, { approvers: true }],
  title: (e) => `Changes requested: ${nameOf(e)}`,
  body: (e) =>
    e.payload.reason
      ? `Reason: ${e.payload.reason}`
      : "An approver sent this back.",
  copy: true,
});

defineNotification(WORKFLOW.WORKFLOW_COMPLETED, {
  // Approved on submission (nothing applied) needs no message; every other ending does.
  to: [
    {
      users: (e) =>
        e.payload.auto &&
        e.payload.state === "approved" &&
        !e.payload.decided_stage
          ? []
          : [e.payload.opened_by].filter(Boolean),
    },
  ],
  title: (e) => `${nameOf(e)}: ${OUTCOME[e.payload.state] || "Decided"}`,
  body: (e) =>
    e.payload.reason
      ? `Reason: ${e.payload.reason}`
      : e.payload.auto
        ? "Decided automatically at the time limit."
        : "",
  who: "Requester",
  copy: true,
});

defineNotification(WORKFLOW.WORKFLOW_ESCALATED, {
  to: [{ ceo: true }, { approvers: true }],
  title: (e) => `Overdue approval: ${nameOf(e)}`,
  body: (e) =>
    `${e.payload.stage_name || "A stage"} passed its time limit without a decision.`,
  priority: "high",
  // Past its time limit, an approval stays red and repeats until opened (TB, 19/10/2026).
  urgency: "urgent",
  copy: true,
});

/** Approvals Waiting (Settings · Notifications): the stage's approvers, again, while it waits. */
defineNotification(WORKFLOW.WORKFLOW_REMINDED, {
  to: [{ approvers: true }],
  title: (e) => `Reminder: ${nameOf(e)}`,
  body: (e) => `${e.payload.stage_name || "A stage"} has waited ${waited(e)} on you.`,
  urgency: "important",
  copy: { body: (e) => `${e.payload.stage_name || "A stage"} has waited ${waited(e)} on its approvers.` },
});

defineNotification(WORKFLOW.WORKFLOW_CANCELLED, {
  to: [
    {
      users: (e, client) =>
        approvers.recipients(client, e.payload.withdrawn_from || []),
    },
  ],
  title: (e) => `Withdrawn: ${nameOf(e)}`,
  body: "The requester withdrew this before it was decided.",
  who: "Approvers it was waiting on",
  copy: true,
});

/**
 * The holders of an alert rule's grant over the person the alert is about, never that person:
 * nobody but the CEO sees or clears an alert about themselves (shared/alerts mayClear).
 */
async function alertClearers(event, client) {
  const subject = subjectOf(event);
  const holders = await permissionHolders(client, event.payload.clear_permission, subject);
  if (!subject) return holders;
  const { rows } = await client.query(
    "SELECT user_id FROM app_user WHERE employee_id = $1::uuid AND is_ceo IS NOT TRUE",
    [subject],
  );
  const own = new Set(rows.map((r) => r.user_id));
  return holders.filter((id) => !own.has(id));
}

defineNotification(ALERTS.HOME_ALERT_RAISED, {
  to: [{ users: alertClearers }],
  title: (e) => `Alert: ${e.payload.title}`,
  body: (e) => e.payload.trigger || "",
  priority: "normal",
  who: "Those who can clear it",
  copy: true,
});

defineNotification(ALERTS.HOME_ALERT_ESCALATED, {
  to: [{ ceo: true }],
  title: (e) => `Escalated alert: ${e.payload.title}`,
  body: (e) => `Open for ${e.payload.age_days} days without being cleared.`,
  priority: "high",
  copy: true,
});

/** Tests only. */
function __hooks() {
  return deliveryHooks;
}

module.exports = {
  defineNotification,
  onDelivery,
  pushStyleOf,
  handle,
  watchers,
  permissionHolders,
  notices,
  SPECS,
  __hooks,
};
