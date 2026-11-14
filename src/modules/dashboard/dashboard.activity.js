"use strict";
/**
 * Activity Today on the Overview: what happened across the organisation today (Lagos), as
 * the reader may see it (docs/guides/home.md §6 Overview).
 *
 * Read from event_log, the record every write leaves (shared/events/emit.js), through an
 * ALLOW-LIST. A key not listed here never reaches the Overview, so a new event is private
 * until someone decides it belongs on everyone's Home: no mail, no message, no sign-in, no
 * audit before-and-after value. Each listed key names the module whose `view` grant opens
 * it, and how far it travels:
 *
 *   person   about one employee (the payload's subject_employee_id or employee_id, or the
 *            employee itself), so it follows the reader's scope on the module: a line
 *            manager sees their team's, `all` sees everyone's, and an event about nobody
 *            in particular reaches `all` only
 *   public   posted where everyone holding the module already sees it (#general), so any
 *            holder of `view` sees it
 *
 * The server sends the key, the module, when, who did it, who it is about and where it
 * opens (shared/route-map.js); the screen words each key. At most 25, newest first: the
 * first page of the same paged query, never a longer list.
 *
 * The assistant's `activity.list` (dashboard.ai.js) reads the same events by the same rules,
 * for any one Lagos day and, when asked, one person: what they did and what is about them.
 */
const { envelope, pageOf, pageQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const rbac = require("../../middleware/rbac");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");

/** event_key → the module that opens it, and whether it follows the reader's scope. */
const ALLOWED = Object.freeze({
  "employee.created": Object.freeze({ module: "people", reach: "person" }),
  "leave_request.approved": Object.freeze({ module: "people", reach: "person" }),
  "leave_request.recorded": Object.freeze({ module: "people", reach: "person" }),
  "attendance.review_required": Object.freeze({ module: "people", reach: "person" }),
  "recognition.posted": Object.freeze({ module: "community", reach: "public" }),
  "celebration.posted": Object.freeze({ module: "community", reach: "public" }),
});

/** The modules the allow-list reads. */
const MODULES = Object.freeze([...new Set(Object.values(ALLOWED).map((a) => a.module))]);

/** The employee an event is about: its payload's, or the employee record itself. */
const SUBJECT = `COALESCE(l.payload ->> 'subject_employee_id', l.payload ->> 'employee_id',
  CASE WHEN l.entity_type = 'employee' THEN l.entity_id END)`;

const nameOf = (alias) =>
  `CASE WHEN ${alias}.employee_id IS NULL THEN NULL ELSE btrim(${alias}.first_name || ' ' || ${alias}.last_name) END`;

/**
 * The condition that keeps the events the reader may see, appending its values to `params`,
 * or null when they may open none of the allow-list's modules.
 * @param {Map<string, {scope: string, scope_ids: string[]|null}>} scopes  the reader's, by module
 * @param {Array} params
 */
function visibleWhere(scopes, params) {
  const parts = [];
  for (const module of MODULES) {
    const scope = scopes.get(module);
    if (!scope) continue;
    for (const reach of ["person", "public"]) {
      const keys = Object.keys(ALLOWED).filter((k) => ALLOWED[k].module === module && ALLOWED[k].reach === reach);
      if (!keys.length) continue;
      params.push(module, keys);
      const n = params.length;
      const s = reach === "person" ? scopeClause(scope, { column: "se.employee_id" }, params) : { and: "" };
      parts.push(`(l.module_key = $${n - 1} AND l.event_key = ANY($${n}::text[]) ${s.and})`);
    }
  }
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

/** The reader's scope on each module the allow-list reads, where they hold `view`. */
async function scopesOf(user) {
  const found = await Promise.all(MODULES.map((module) => rbac.scopeFor(user, module, "view")));
  return new Map(MODULES.map((module, i) => [module, found[i]]).filter(([, scope]) => scope));
}

/**
 * One Lagos day's events the reader may see, newest first, a page of 25; null when the reader
 * may open none of the modules they come from. With `employeeId`, or `q` (part of a name), only
 * what that person did (the event's actor) or what is about them (its subject).
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 * @param {{date: string, employeeId?: string|null, q?: string|null}} on
 * @param {{page?: number}} query
 */
async function eventsOn(client, user, { date, employeeId = null, q = null }, query) {
  const params = [lagos.startOfDay(date), lagos.endOfDayExclusive(date)];
  const visible = visibleWhere(await scopesOf(user), params);
  if (!visible) return null;
  let person = "";
  if (employeeId) {
    params.push(employeeId);
    person += ` AND (ae.employee_id = $${params.length}::uuid OR se.employee_id = $${params.length}::uuid)`;
  }
  if (q) {
    params.push(q);
    const like = `LIKE '%' || search_fold($${params.length}) || '%'`;
    person += ` AND (search_fold(${nameOf("ae")}) ${like} OR search_fold(${nameOf("se")}) ${like})`;
  }
  return pageQuery(
    client,
    `SELECT l.event_id, l.event_key, l.module_key, l.occurred_at, l.entity_type, l.entity_id,
            ae.employee_id AS actor_employee_id, ${nameOf("ae")} AS actor_name,
            se.employee_id AS subject_employee_id, ${nameOf("se")} AS subject,
            ${TOTAL_COL}
       FROM event_log l
       LEFT JOIN app_user au ON au.user_id = l.actor_user_id
       LEFT JOIN employee ae ON ae.employee_id = au.employee_id
       LEFT JOIN employee se ON se.employee_id::text = ${SUBJECT}
      WHERE l.occurred_at >= $1::timestamptz AND l.occurred_at < $2::timestamptz
        AND ${visible}${person}
      ORDER BY l.occurred_at DESC, l.event_id`,
    params,
    query,
  );
}

/** Where an event opens for this reader: their own view when it is about them. */
function linkOf(r, user) {
  const link = routeMap.linkFor(r.entity_type, r.entity_id, {
    self: Boolean(user.employee_id) && r.subject_employee_id === user.employee_id,
  });
  return link ? link.path : null;
}

/**
 * Today's activity for the reader, newest first, at most 25 (HomeActivityItem); null when
 * the reader may open none of the modules it comes from.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 * @param {{today: string}} on  today in Lagos
 * @returns {Promise<object[]|null>}
 */
async function today(client, user, { today: date }) {
  const page = await eventsOn(client, user, { date }, { page: 1 });
  if (!page) return null;
  return page.data.map((r) => ({
    event_id: r.event_id,
    event_key: r.event_key,
    module_key: r.module_key,
    occurred_at: new Date(r.occurred_at).toISOString(),
    actor_name: r.actor_name,
    subject: r.subject,
    link: linkOf(r, user),
  }));
}

/**
 * The assistant's `activity.list`: a day's events (today in Lagos unless `date` is given) by
 * the same allow-list and scopes as Activity Today, optionally one person's (`employee_id`, or
 * `q` matching the name of who did it or who it is about), 25 a page. Each
 * row names the record it is about, so the answer can cite it; an empty page for a reader who
 * may open none of the modules.
 * @param {{query: Function}} client
 * @param {object} actor  req.user, as the assistant's read passes it
 * @param {{date?: string, employee_id?: string, page?: number}} query  HomeActivityQuery
 */
async function forAssistant(client, actor, query, { now = new Date() } = {}) {
  const date = query.date || lagos.today(now);
  const page = await eventsOn(client, actor, { date, employeeId: query.employee_id || null, q: query.q || null }, query);
  if (!page) return envelope([], pageOf(query).number, 0);
  return {
    ...page,
    data: page.data.map((r) => ({
      event_key: r.event_key,
      module_key: r.module_key,
      occurred_at: new Date(r.occurred_at).toISOString(),
      actor_name: r.actor_name,
      actor_employee_id: r.actor_employee_id,
      subject: r.subject,
      subject_employee_id: r.subject_employee_id,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      link: linkOf(r, actor),
    })),
  };
}

/** Each allow-listed event as a person reads it, in the assistant's summary. */
const KIND_WORDS = Object.freeze({
  "employee.created": "New Employee",
  "leave_request.approved": "Leave Approved",
  "leave_request.recorded": "Leave Recorded",
  "attendance.review_required": "Attendance To Review",
  "recognition.posted": "Recognition",
  "celebration.posted": "Celebration",
});

/**
 * Activity Today's events in figures for the assistant (docs/guides/praxis-ai.md §6.13, Workspace,
 * Knowledge Hub, Community, Home and Settings), by the same allow-list and the reader's scope on each
 * module (visibleWhere), in one statement: the events, the people who acted and those they were
 * about; by kind, by module, by who acted (the ten most), by Lagos day and by Lagos hour. With
 * `employeeId`, only what that person did or what is about them. Null when the reader may open none of
 * the modules. Figures, never a row.
 * @param {{query: Function}} client
 * @param {object} user  the asking person
 * @param {{from: Date, to: Date, employeeId?: string|null}} on  the instants, the second not kept
 */
async function summaryOf(client, user, { from, to, employeeId = null }) {
  const params = [from, to];
  const visible = visibleWhere(await scopesOf(user), params);
  if (!visible) return null;
  let person = "";
  if (employeeId) {
    params.push(employeeId);
    person = ` AND (ae.employee_id = $${params.length}::uuid OR se.employee_id = $${params.length}::uuid)`;
  }
  const { rows } = await client.query(
    `WITH x AS (
       SELECT l.event_key, l.module_key, l.occurred_at, ae.employee_id AS actor_id, ${nameOf("ae")} AS actor_name,
              se.employee_id AS subject_id
         FROM event_log l
         LEFT JOIN app_user au ON au.user_id = l.actor_user_id
         LEFT JOIN employee ae ON ae.employee_id = au.employee_id
         LEFT JOIN employee se ON se.employee_id::text = ${SUBJECT}
        WHERE l.occurred_at >= $1::timestamptz AND l.occurred_at < $2::timestamptz
          AND ${visible}${person}
     ), by_person AS (
       SELECT actor_id::text AS key, min(actor_name) AS label, count(*)::int AS value,
              row_number() OVER (ORDER BY count(*) DESC, min(actor_name), actor_id) AS rank
         FROM x WHERE actor_id IS NOT NULL GROUP BY actor_id
     )
     SELECT (SELECT json_build_object('events', count(*), 'actors', count(DISTINCT actor_id),
                                      'subjects', count(DISTINCT subject_id), 'kinds', count(DISTINCT event_key)) FROM x) AS figures,
            (SELECT json_agg(json_build_object('key', event_key, 'value', n) ORDER BY n DESC, event_key)
               FROM (SELECT event_key, count(*)::int AS n FROM x GROUP BY event_key) k) AS by_kind,
            (SELECT json_agg(json_build_object('key', module_key, 'value', n) ORDER BY n DESC, module_key)
               FROM (SELECT module_key, count(*)::int AS n FROM x GROUP BY module_key) m) AS by_module,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'value', value) ORDER BY rank)
               FROM by_person WHERE rank <= 10) AS by_person,
            (SELECT json_agg(json_build_object('at', at, 'value', n) ORDER BY at)
               FROM (SELECT to_char(occurred_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS at, count(*)::int AS n FROM x GROUP BY 1) d) AS by_day,
            (SELECT json_agg(json_build_object('at', at, 'value', n) ORDER BY at)
               FROM (SELECT to_char(occurred_at AT TIME ZONE 'Africa/Lagos', 'HH24') || ':00' AS at, count(*)::int AS n FROM x GROUP BY 1) h) AS by_hour`,
    params,
  );
  const r = rows[0] || {};
  return {
    figures: r.figures || {},
    by_kind: r.by_kind || [],
    by_module: r.by_module || [],
    by_person: r.by_person || [],
    by_day: r.by_day || [],
    by_hour: r.by_hour || [],
  };
}

/**
 * The assistant's `activity.summary`: Activity Today's events in figures, for one Lagos day (today
 * unless `date`) or, when one is asked, a period of at most a year; one person's with `employee_id`.
 * By kind always, then by module, by who acted or by day when asked; by hour of the day for one day,
 * by day for a period. No figures for a reader who may open none of the modules.
 * @param {{query: Function}} client
 * @param {object} actor  the asking person
 * @param {object} params  HomeActivitySummaryQuery, parsed
 */
async function aiSummary(client, actor, params, { now = new Date() } = {}) {
  const { figure, group, top, series, periodOf } = require("../../shared/ai/summary");
  const catalog = require("../../shared/access/access.catalog");
  const day = params.date || lagos.today(now);
  const days = params.from || params.to || params.month ? periodOf(params, now) : { from: day, to: day };
  const r = await summaryOf(client, actor, {
    from: lagos.startOfDay(days.from),
    to: lagos.endOfDayExclusive(days.to),
    employeeId: params.employee_id || null,
  });
  if (!r) return { figures: [], groups: [], series: [], total: 0 };
  const f = r.figures;
  const dayLabel = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const moduleWord = (key) => (catalog.MODULE_META[key] && catalog.MODULE_META[key].label) || key;
  const groups = [group("kind", "Events by kind", r.by_kind.map((x) => ({ key: x.key, label: KIND_WORDS[x.key] || x.key, value: x.value })))];
  if (params.by === "module") groups.unshift(group("module", "Events by module", r.by_module.map((x) => ({ key: x.key, label: moduleWord(x.key), value: x.value }))));
  if (params.by === "person") groups.unshift(top("person", "Events by who acted", r.by_person));
  if (params.by === "day") groups.unshift(group("day", "Events by day", r.by_day.slice(-20).map((x) => ({ key: x.at, label: dayLabel(x.at), value: x.value }))));
  return {
    figures: [
      figure("events", "Events", f.events || 0),
      figure("actors", "People who acted", f.actors || 0),
      figure("subjects", "People they were about", f.subjects || 0),
      figure("kinds", "Kinds", f.kinds || 0),
    ],
    groups,
    series: [days.from === days.to ? series("hour", "Events by hour", r.by_hour) : series("day", "Events by day", r.by_day)],
    total: f.events || 0,
  };
}

module.exports = { ALLOWED, MODULES, KIND_WORDS, visibleWhere, today, forAssistant, aiSummary };
