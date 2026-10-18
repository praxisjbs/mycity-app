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
 */
const { pageQuery, TOTAL_COL } = require("../../shared/http/paged");
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
 * Today's activity for the reader, newest first, at most 25 (HomeActivityItem); null when
 * the reader may open none of the modules it comes from.
 * @param {{query: Function}} client
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 * @param {{today: string}} on  today in Lagos
 * @returns {Promise<object[]|null>}
 */
async function today(client, user, { today: date }) {
  const params = [lagos.startOfDay(date), lagos.endOfDayExclusive(date)];
  const visible = visibleWhere(await scopesOf(user), params);
  if (!visible) return null;
  const page = await pageQuery(
    client,
    `SELECT l.event_id, l.event_key, l.module_key, l.occurred_at, l.entity_type, l.entity_id,
            ${nameOf("ae")} AS actor_name, se.employee_id AS subject_employee_id, ${nameOf("se")} AS subject,
            ${TOTAL_COL}
       FROM event_log l
       LEFT JOIN app_user au ON au.user_id = l.actor_user_id
       LEFT JOIN employee ae ON ae.employee_id = au.employee_id
       LEFT JOIN employee se ON se.employee_id::text = ${SUBJECT}
      WHERE l.occurred_at >= $1::timestamptz AND l.occurred_at < $2::timestamptz
        AND ${visible}
      ORDER BY l.occurred_at DESC, l.event_id`,
    params,
    { page: 1 },
  );
  return page.data.map((r) => {
    const link = routeMap.linkFor(r.entity_type, r.entity_id, {
      self: Boolean(user.employee_id) && r.subject_employee_id === user.employee_id,
    });
    return {
      event_id: r.event_id,
      event_key: r.event_key,
      module_key: r.module_key,
      occurred_at: new Date(r.occurred_at).toISOString(),
      actor_name: r.actor_name,
      subject: r.subject,
      link: link ? link.path : null,
    };
  });
}

module.exports = { ALLOWED, MODULES, visibleWhere, today };
