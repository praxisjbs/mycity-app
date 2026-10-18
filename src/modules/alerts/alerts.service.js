"use strict";
/**
 * Home · Alerts (docs/guides/home.md §2, §3 steps 5 and 6, §5, §6 Alerts): the alerts a reader
 * may see and clear, the counts above them, and the rules that raise them.
 *
 *   list()          GET  /home/alerts               a page of 25, open unless `state` says otherwise
 *   summary()       GET  /home/alerts/summary       Open, Needs You, Overdue 7 Days +, Cleared This Week,
 *                                                   the category chips, Alert Sources 30 Days
 *   get()           GET  /home/alerts/:id           404 when the reader may not see it
 *   clear()         POST /home/alerts/:id/clear     cleared or dismissed; twice is the same answer
 *   rules()         GET  /home/alert-rules          a page of 25
 *   rule()          GET  /home/alert-rules/:id
 *   createRule()    POST /home/alert-rules          its key made here from the metric and the name
 *   updateRule()    PATCH /home/alert-rules/:id     anything but the metric; off dismisses its open alerts
 *
 *   openToClear()   the Overview's alerts beside Need You (dashboard.service)
 *   highOpen(), highPage()   the Open High Alerts card and its records (kpi-catalog/tiles/work.js)
 *   forAssistant()  the assistant's `alerts.mine` (alerts.ai.js)
 *
 * WHO SEES AN ALERT (home.md §6): a holder of `alerts.clear` or `alerts.manage` sees the
 * alerts of the rules whose permission_key they hold, about people within their scope on
 * that grant; an alert about no one in particular only with `all` scope; never one about
 * themselves; the CEO every one. readerOf() works that out once per request and
 * alerts.repo.js seenWhere() turns it into the one condition every read here, the Overview
 * and ⌘K use.
 *
 * CLEARING takes both checks: `alerts.clear` (the route) and the rule's grant reaching the
 * person the alert is about (the shared engine's mayClear, which an alert the reader may see
 * passes). `can_clear` on a row says the same, so the screen offers Clear Alert only where it
 * will work.
 *
 * Every write runs in one transaction with its event (BACKEND_GUIDE §3.4); saving a rule as
 * it already is writes and records nothing (home.md §11, Double submit).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { envelope, pageOf } = require("../../shared/http/paged");
const grantsCache = require("../../shared/rbac/grants-cache");
const catalog = require("../../shared/access/access.catalog");
const alerts = require("../../shared/alerts/alerts");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const rbac = require("../../middleware/rbac");
const metrics = require("./alerts.metrics");
const repo = require("./alerts.repo");
const { EVENTS } = require("./alerts.events");

/** An open alert older than this is overdue (Overdue 7 Days +, and the card's caption). */
const OVERDUE_DAYS = 7;
/** Alert Sources counts what was raised over this many days. */
const SOURCES_DAYS = 30;
const DAY_MS = 86_400_000;
/** The most Alert Sources lists (HomeAlertSummary). */
const SOURCES_SHOWN = 25;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = (what = "Alert") => new AppError("NOT_FOUND", `${what} not found`, 404);
const invalid = (fields) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, fields);

/* ------------------------------------------------------------------ *
 * Who the reader is
 * ------------------------------------------------------------------ */

/** "people.approve" → ["people", "approve"] when the access catalogue knows both, else null. */
function grantOf(permissionKey) {
  const [module, action, extra] = String(permissionKey || "").split(".");
  return extra === undefined && catalog.isModule(module) && catalog.isAction(action) ? [module, action] : null;
}

/** How a person reads each action's holders on Who Can Clear. */
const HOLDERS = Object.freeze({
  view: "Viewers",
  create: "Creators",
  edit: "Editors",
  delete: "Deleters",
  approve: "Approvers",
  export: "Exporters",
});

/** A rule's grant as a person reads it: "people.approve" → "People Approvers". */
function whoCanClear(permissionKey) {
  const grant = grantOf(permissionKey);
  if (!grant) return permissionKey;
  return `${catalog.MODULE_META[grant[0]].label} ${HOLDERS[grant[1]]}`;
}

/**
 * What the reader may do here and which alerts they see: their two capabilities, their scope
 * on each grant the rules use, and who they are, since an alert about the reader is not
 * theirs to see or clear. The CEO sees every alert and holds every capability.
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 * @returns {Promise<{user: object, may_clear: boolean, may_manage: boolean, seen: object}>}
 */
async function readerOf(db, user) {
  if (user.is_ceo === true) return { user, may_clear: true, may_manage: true, seen: { all: true, grants: [] } };
  const held = await grantsCache.getCapabilities(db, user.user_id);
  const may = { may_clear: held.includes("alerts.clear"), may_manage: held.includes("alerts.manage") };
  // Without either capability the tab is closed, so no grant is worth asking about.
  if (!may.may_clear && !may.may_manage) return { user, ...may, seen: { all: false, grants: [], self: null } };
  const grants = [];
  for (const key of await repo.permissionKeys(db)) {
    const grant = grantOf(key);
    if (!grant) continue; // a grant the catalogue does not know reaches nobody but the CEO
    const scope = await rbac.scopeFor(user, grant[0], grant[1]);
    if (scope) grants.push({ permission_key: key, scope });
  }
  return { user, ...may, seen: { all: false, grants, self: user.employee_id || null } };
}

/** Readers who hold neither capability see no alerts, whatever their grants. */
const opensTab = (reader) => reader.may_clear || reader.may_manage;

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

/** What an alert's over_by holds, from its rule's metric: past a count's threshold, or a deadline's days left. */
function overByKind(metricKey) {
  const metric = metrics.metricOf(metricKey);
  return metric ? (metric.kind === "deadline" ? "days_left" : "over") : null;
}

/** "4.00" as a person reads it: 4, "2.50" is 2.5, thousands grouped. Read from the digits, never through a float. */
function figure(value) {
  const text = String(value).trim();
  const [whole, fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const kept = fraction.replace(/0+$/, "");
  return `${text.startsWith("-") ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${kept ? `.${kept}` : ""}`;
}

/**
 * Over By as the Alerts tab's list reads it (home.md §10.1): "+1" past a count's threshold,
 * "12 days left" before a deadline, Due Today on the day itself (0) and Expired once the date
 * has passed (below 0); the figure alone for a metric no longer listed. The Open High Alerts
 * card's records carry it as text, so the card and the tab read the same.
 * @param {string|number|null} overBy  home_alert.over_by
 * @param {"over"|"days_left"|null} kind  overByKind()
 */
function overByText(overBy, kind) {
  if (overBy === null || overBy === undefined) return null;
  if (kind === "days_left") {
    const left = Number(overBy);
    if (left < 0) return "Expired";
    if (left === 0) return "Due Today";
    return `${figure(overBy)} ${left === 1 ? "day" : "days"} left`;
  }
  return kind === "over" ? `+${figure(overBy)}` : figure(overBy);
}

/** An alert row as the contract shapes it (HomeAlert), for this reader. */
function present(row, reader) {
  const metric = metrics.metricOf(row.metric);
  const link = routeMap.linkFor(row.subject_type, row.subject_id, {
    self: Boolean(row.subject_employee_id) && row.subject_employee_id === reader.user.employee_id,
  });
  return {
    home_alert_id: row.home_alert_id,
    home_alert_rule_id: row.home_alert_rule_id,
    rule_name: row.rule_name,
    metric: row.metric,
    category: metric ? metric.category : null,
    subject_type: row.subject_type,
    subject_id: row.subject_id,
    subject_employee_id: row.subject_employee_id,
    title: row.title,
    trigger: row.trigger,
    severity: row.severity,
    over_by: row.over_by,
    over_by_kind: overByKind(row.metric),
    threshold: row.threshold,
    permission_key: row.permission_key,
    who_can_clear: whoCanClear(row.permission_key),
    raised_at: row.raised_at,
    last_seen_at: row.last_seen_at,
    escalated_at: row.escalated_at,
    cleared_at: row.cleared_at,
    cleared_by: row.cleared_by,
    cleared_by_name: row.cleared_by_name,
    outcome: row.outcome,
    note: row.note,
    link: link ? link.path : null,
    can_clear: row.cleared_at === null && reader.may_clear,
  };
}

const agedBefore = (now) => new Date(now.getTime() - OVERDUE_DAYS * DAY_MS);

/**
 * A page of the alerts a reader may see (HomeAlertPage).
 * @param {object} reader  readerOf()
 * @param {object} query  a validated HomeAlertQuery
 */
async function pageFor(db, reader, query, { now = new Date() } = {}) {
  const mine = query.mine === "true";
  if (!opensTab(reader) || (mine && !reader.may_clear)) return envelope([], pageOf(query).number, 0);
  const page = await repo.alertPage(db, reader.seen, query, {
    metrics: query.category ? metrics.metricsIn(query.category) : null,
    mine,
    agedBefore: agedBefore(now),
  });
  return { ...page, data: page.data.map((row) => present(row, reader)) };
}

/** GET /home/alerts */
async function list(user, query, { now = new Date() } = {}) {
  return pageFor(pool, await readerOf(pool, user), query, { now });
}

/** GET /home/alerts/summary (HomeAlertSummary): every count over the alerts the reader may see. */
async function summary(user, { now = new Date() } = {}) {
  const reader = await readerOf(pool, user);
  if (!opensTab(reader))
    return { open: 0, needs_you: 0, overdue: 0, cleared_this_week: 0, categories: [], sources: [] };
  const today = lagos.today(now);
  const monday = lagos.addDays(today, 1 - lagos.weekday(today));
  const [n, open, raised] = await Promise.all([
    repo.counts(pool, reader.seen, { agedBefore: agedBefore(now), clearedSince: lagos.startOfDay(monday) }),
    repo.byMetric(pool, reader.seen),
    repo.byMetric(pool, reader.seen, { raisedSince: new Date(now.getTime() - SOURCES_DAYS * DAY_MS) }),
  ]);
  const byCategory = new Map();
  for (const { metric: key, count } of open) {
    const metric = metrics.metricOf(key);
    if (metric) byCategory.set(metric.category, (byCategory.get(metric.category) || 0) + count);
  }
  return {
    open: n.open,
    needs_you: reader.may_clear ? n.open : 0,
    overdue: n.overdue,
    cleared_this_week: n.cleared,
    categories: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    sources: raised.slice(0, SOURCES_SHOWN).map(({ metric, count }) => ({ metric, count })),
  };
}

/** GET /home/alerts/:id: one alert the reader may see, in any state. */
async function get(user, id) {
  const reader = await readerOf(pool, user);
  const row = opensTab(reader) ? await repo.alertById(pool, reader.seen, id) : null;
  if (!row) throw notFound();
  return present(row, reader);
}

/**
 * POST /home/alerts/:id/clear. The route has checked `alerts.clear`; an alert the reader may
 * not see is a 404, and the engine checks the rule's grant reaches its subject. An alert
 * already closed is answered as it stands, with no second audit entry.
 * @param {object} actor  withActor(req)
 * @param {string} id
 * @param {{outcome: "cleared"|"dismissed", note?: string|null}} body  a validated HomeAlertClear
 */
async function clear(actor, id, { outcome, note = null }) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    if (!(await repo.alertById(client, reader.seen, id))) throw notFound();
    await alerts.clear(client, { alert_id: id, actor, outcome, note });
    return present(await repo.alertById(client, reader.seen, id), reader);
  });
}

/**
 * How many open alerts, of any severity, the reader may clear: the alerts beside Need You's
 * requests (HomeOverview `alerts_to_clear`), or null for a reader without `alerts.clear`.
 * @param {{query: Function}} db
 * @param {object} user  req.user
 * @returns {Promise<number|null>}
 */
async function openToClear(db, user) {
  const reader = await readerOf(db, user);
  if (!reader.may_clear) return null;
  return (await repo.counts(db, reader.seen, { agedBefore: new Date() })).open;
}

/**
 * The open high alerts the reader may see, and how many of them are overdue: the Open High
 * Alerts card's figure. Its eligibility (the card's `alerts.clear`) is the catalogue's.
 * @param {{query: Function}} db
 * @param {object} user  req.user
 * @param {{now: Date}} at
 * @returns {Promise<{value: number, aged: number}>}
 */
async function highOpen(db, user, { now }) {
  const reader = await readerOf(db, user);
  const n = await repo.counts(db, reader.seen, { agedBefore: agedBefore(now), severity: "high" });
  return { value: n.open, aged: n.overdue };
}

/**
 * One page of the open high alerts the reader may see, the longest open first: the records
 * behind the Open High Alerts card, each with its Over By as the Alerts tab reads it.
 */
async function highPage(db, user, query) {
  const reader = await readerOf(db, user);
  const page = await repo.openPage(db, reader.seen, { severity: "high" }, query);
  return { ...page, data: page.data.map((row) => ({ ...row, over_by_text: overByText(row.over_by, overByKind(row.metric)) })) };
}

/**
 * The assistant's `alerts.mine`: a page of the open alerts the asker may clear, as Needs You
 * lists them, or an empty page for someone without `alerts.clear`. The assistant checks only
 * the `home` grant, which every login holds, so the capability is checked here.
 * @param {{query: Function}} db  the client the assistant reads with
 * @param {object} actor  req.user with the assistant's scope
 * @param {object} query  a validated HomeAlertQuery
 */
async function forAssistant(db, actor, query) {
  const reader = await readerOf(db, actor);
  if (!reader.may_clear) return envelope([], pageOf(query).number, 0);
  return pageFor(db, reader, { ...query, state: "open", mine: "true" });
}

/**
 * ⌘K's alerts: a page of the open alerts the reader may see whose title or trigger matches,
 * newest first; nothing for a reader without `alerts.clear` or `alerts.manage`.
 * @param {{query: Function}} db  the search's client
 * @param {object} user  req.user
 * @param {{term: string, page: number}} search
 */
async function searchAlerts(db, user, { term, page }) {
  return pageFor(db, await readerOf(db, user), { q: term, page, state: "open" });
}

/**
 * ⌘K's alert rules: a page of the rules whose name or key matches, for a holder of
 * `alerts.manage`; nothing for anyone else.
 * @param {{query: Function}} db  the search's client
 * @param {object} user  req.user
 * @param {{term: string, page: number}} search
 */
async function searchRules(db, user, { term, page }) {
  const reader = await readerOf(db, user);
  if (!reader.may_manage) return envelope([], pageOf({ page }).number, 0);
  const found = await repo.rulePage(db, { q: term, page }, { metrics: null });
  return { ...found, data: found.data.map(presentRule) };
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/** A rule row as the contract shapes it (HomeAlertRule). */
function presentRule(row) {
  const metric = metrics.metricOf(row.metric);
  return {
    home_alert_rule_id: row.home_alert_rule_id,
    key: row.key,
    name: row.name,
    metric: row.metric,
    category: metric ? metric.category : null,
    kind: metric ? metric.kind : null,
    threshold: row.threshold,
    window_days: row.window_days,
    severity: row.severity,
    permission_key: row.permission_key,
    who_can_clear: whoCanClear(row.permission_key),
    enabled: row.enabled,
    open_alerts: row.open_alerts,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** GET /home/alert-rules */
async function rules(query) {
  const page = await repo.rulePage(pool, query, {
    metrics: query.category ? metrics.metricsIn(query.category) : null,
  });
  return { ...page, data: page.data.map(presentRule) };
}

/** GET /home/alert-rules/:id */
async function rule(id) {
  const row = await repo.ruleById(pool, id);
  if (!row) throw notFound("Rule");
  return presentRule(row);
}

/** Longest a key's name part may be. */
const SLUG_MAX = 40;

/** A rule's name as the second half of its key: "Late Arrivals: 3 in 30" → "late_arrivals_3_in_30". */
function slugOf(name) {
  const slug = String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, SLUG_MAX)
    .replace(/^_+|_+$/g, "");
  return slug || "rule";
}

/**
 * A rule's key: `<metric>.<slug of the name>`, with `_2`, `_3` ... on the end when that is
 * taken (keys compare without case).
 * @param {string} metric
 * @param {string} name
 * @param {Iterable<string>} taken  keys already in use, lower case
 */
function keyFor(metric, name, taken) {
  const used = new Set(taken);
  const base = `${metric}.${slugOf(name)}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Tries at taking a key a rule made at the same moment took first. */
const KEY_TRIES = 5;

/** A threshold the access catalogue's grant check, the metric's window and its kind accept, or a 422. */
function checkRule(metric, { permission_key: permissionKey, threshold, window_days: windowDays }) {
  const fields = {};
  if (permissionKey !== undefined && !grantOf(permissionKey)) fields.permission_key = ["Choose who clears"];
  if (metric && threshold !== undefined && metric.kind === "deadline" && !/^\d+(\.0{1,2})?$/.test(threshold))
    fields.threshold = ["Whole days only"];
  if (metric && metric.window && windowDays === null) fields.window_days = ["Enter the days"];
  if (metric && !metric.window && windowDays !== undefined && windowDays !== null)
    fields.window_days = ["Not for this metric"];
  if (Object.keys(fields).length) throw invalid(fields);
}

/** A deadline's threshold as whole days ("30.00" → "30"); any other kept as written. */
const thresholdOf = (metric, threshold) =>
  metric && metric.kind === "deadline" ? threshold.replace(/\.0{1,2}$/, "") : threshold;

/**
 * POST /home/alert-rules. Who Can Clear defaults to the metric's on the form; the server
 * holds it to the access catalogue. A new rule is first read at the next sweep or signal.
 * @param {object} actor  withActor(req)
 * @param {object} body  a validated HomeAlertRuleCreate
 */
async function createRule(actor, body) {
  const metric = metrics.metricOf(body.metric);
  checkRule(metric, { ...body, window_days: body.window_days === undefined ? null : body.window_days });
  return tx(async (client) => {
    let id = null;
    for (let attempt = 0; attempt < KEY_TRIES && !id; attempt += 1) {
      const base = `${body.metric}.${slugOf(body.name)}`;
      const key = keyFor(body.metric, body.name, await repo.keysLike(client, base));
      id = await repo.insertRule(client, {
        key,
        name: body.name,
        metric: body.metric,
        threshold: thresholdOf(metric, body.threshold),
        window_days: body.window_days === undefined ? null : body.window_days,
        severity: body.severity,
        permission_key: body.permission_key,
        created_by: actor.user_id || null,
      });
    }
    if (!id) throw new AppError("RULE_KEY_TAKEN", "Another rule took that name just now. Try again.", 409);
    const created = await repo.ruleById(client, id);
    await emit(client, {
      key: EVENTS.HOME_ALERT_RULE_CREATED,
      entity: { type: "home_alert_rule", id },
      actor,
      after: created,
    });
    return presentRule(created);
  });
}

/** A rule's fields a change compares and writes. Thresholds compare as numbers ("3" is "3.00"). */
const SAME = Object.freeze({
  name: (a, b) => a === b,
  threshold: (a, b) => Number(a) === Number(b),
  window_days: (a, b) => a === b,
  severity: (a, b) => a === b,
  permission_key: (a, b) => a === b,
  enabled: (a, b) => a === b,
});

/**
 * PATCH /home/alert-rules/:id: any field but the metric. Switching a rule off dismisses its
 * open alerts in the same transaction, as the rule change (no clearing right needed), and
 * those do not count as cleared. A change to nothing writes and records nothing.
 * @param {object} actor  withActor(req)
 * @param {string} id
 * @param {object} body  a validated HomeAlertRuleUpdate
 */
async function updateRule(actor, id, body) {
  return tx(async (client) => {
    const before = await repo.ruleById(client, id, { lock: true });
    if (!before) throw notFound("Rule");
    const metric = metrics.metricOf(before.metric);
    checkRule(metric, body);
    const changes = {};
    for (const [field, same] of Object.entries(SAME)) {
      if (body[field] === undefined) continue;
      const value = field === "threshold" ? thresholdOf(metric, body.threshold) : body[field];
      if (!same(value, before[field])) changes[field] = value;
    }
    if (!Object.keys(changes).length) return presentRule(before);

    await repo.updateRule(client, id, changes, actor.user_id || null);
    const dismissed =
      before.enabled && changes.enabled === false ? await alerts.closeForRule(client, { rule_id: id, actor }) : 0;
    const after = await repo.ruleById(client, id);
    await emit(client, {
      key: EVENTS.HOME_ALERT_RULE_UPDATED,
      entity: { type: "home_alert_rule", id },
      actor,
      before,
      after,
      payload: { changed: Object.keys(changes), dismissed },
    });
    return presentRule(after);
  });
}

module.exports = {
  OVERDUE_DAYS,
  whoCanClear,
  overByText,
  readerOf,
  list,
  summary,
  get,
  clear,
  openToClear,
  highOpen,
  highPage,
  forAssistant,
  searchAlerts,
  searchRules,
  rules,
  rule,
  slugOf,
  keyFor,
  createRule,
  updateRule,
};
