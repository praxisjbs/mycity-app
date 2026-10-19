"use strict";
/**
 * Home · Team (docs/guides/home.md §2, §5, §6 Team): today's roster for the people in the
 * reader's `home` scope, the tab's four cards and Attendance This Month. Every figure and
 * every row is the shared attendance roster's (src/modules/attendance/attendance.roster.js),
 * so the tab says what People · Attendance and My Attendance say.
 *
 *   summary()     GET /home/team/summary      the scope and the four cards
 *   roster()      GET /home/team              today's roster, a page of 25
 *   month()       GET /home/team/attendance   this month so far, one row a person, a page of 25
 *   forAssistant  the assistant's `team.today` (dashboard.ai.js)
 *
 * The routes check `home` view, which sets the scope (all: the whole organisation; team: the
 * reader and everyone below them on the solid line; own: the reader alone), then `home.team`,
 * which opens the tab and sets no scope. The assistant checks only the module grant, so
 * forAssistant() checks the capability itself, as requireCapability does.
 *
 * The four cards are the KPI catalogue's Team cards, computed in the same scope as the
 * roster, so each card's figure is the number of records its own list (GET /home/kpi/:key)
 * holds. A card whose figure cannot be read is left out, never shown as 0 (home.md §6).
 *
 * KPI and Open Tasks on a roster row are null until M2 builds performance scores and tasks
 * (home.md §6 Team, §13).
 */
const { pool } = require("../../config/db");
const { envelope, pageOf } = require("../../shared/http/paged");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");
const attendance = require("../attendance/attendance.roster");
const kpi = require("./kpi-catalog");
const resolve = require("./kpi-catalog/resolve");

/** The authority that opens the Team tab (access.catalog.js CAPABILITY_CATALOG). */
const CAPABILITY = "home.team";

/** The tab's cards, in the order the tab shows them. */
const CARDS = Object.freeze([
  "team_present",
  "team_on_site",
  "team_remote",
  "team_flags",
]);

/**
 * The tab computes its cards with the `home` scope alone, which holds only while each is a
 * live `home` card behind this capability, with no sensitive field and kept off the Overview
 * picker. A catalogue that drifts from that stops the require, as the catalogue's own check does.
 */
function assertCards() {
  const problems = [];
  for (const id of CARDS) {
    const e = kpi.BY_ID.get(id);
    if (!e) problems.push(`"${id}" is not in the KPI catalogue`);
    else if (
      e.status !== "live" ||
      e.module !== "home" ||
      e.capability !== CAPABILITY ||
      e.sensitive_field ||
      e.pickable
    )
      problems.push(
        `"${id}" must be a live home card behind ${CAPABILITY}, unmasked and not pickable`,
      );
  }
  if (problems.length)
    throw new Error(`dashboard.team:\n  ${problems.join("\n  ")}`);
}

const display = (first, last) => `${first} ${last}`.trim();

/** A roster person as the contract names one (PersonRef). */
const personOf = (r) => ({
  employee_id: r.employee_id,
  display_name: display(r.first_name, r.last_name),
  job_title: r.job_title,
  department: r.department,
  photo_url: r.photo_url ?? null,
});

/**
 * The roster's filters for a validated HomeTeamQuery, on `date`. The query string carries
 * the yes-or-no filter as "true" or "false".
 * @param {{status?: string, department_id?: string, q?: string, no_clock_out_yesterday?: "true"|"false"}} query
 * @param {string} date  YYYY-MM-DD
 */
function filtersOf(query, date) {
  const flag = query.no_clock_out_yesterday;
  return {
    date,
    status: query.status,
    department_id: query.department_id,
    q: query.q,
    no_clock_out_yesterday: flag === undefined ? undefined : flag === "true",
  };
}

/** A roster row as the Team Roster shows it (HomeTeamRow). */
const rowOf = (r) => ({
  employee: personOf(r),
  department_id: r.department_id,
  status: r.status,
  clock_in_at: r.clock_in_at,
  clock_out_at: r.clock_out_at,
  worksite: r.worksite,
  no_clock_out_yesterday: r.no_clock_out_yesterday,
  kpi_percent: null,
  open_tasks: null,
});

/** A person's month as Attendance This Month shows it (HomeTeamAttendanceRow). */
const monthRowOf = (r) => ({
  employee: personOf(r),
  expected: r.expected,
  on_time: r.on_time,
  late: r.late,
  absent: r.absent,
  on_leave: r.on_leave,
});

/**
 * GET /home/team/summary (HomeTeamSummary): whose people these are, and the tab's four cards
 * with today's figures in that scope.
 * @param {object} user  req.user
 * @param {{scope: string, scope_ids: string[]|null, employee_id?: string|null}} scope  the `home` view scope
 * @param {{now?: Date, db?: {query: Function}}} [at]  the moment it is read; now unless a test says otherwise
 */
async function summary(user, scope, { now = new Date(), db = pool } = {}) {
  const today = lagos.today(now);
  const ctx = kpi.context({
    user,
    scopes: new Map([["home", scope]]),
    today,
    now,
  });
  const { cards } = resolve.paintCards(
    CARDS,
    await kpi.figuresFor(db, CARDS, ctx),
  );
  return { date: today, scope: scope.scope, cards };
}

/**
 * GET /home/team (HomeTeamPage): one page of today's roster in the scope, filtered, searched
 * and sorted in SQL.
 * @param {{scope: string, scope_ids: string[]|null}} scope  the `home` view scope
 * @param {object} query  a validated HomeTeamQuery
 * @param {{now?: Date, db?: {query: Function}}} [at]
 */
async function roster(scope, query, { now = new Date(), db = pool } = {}) {
  const page = await attendance.page(
    db,
    filtersOf(query, lagos.today(now)),
    scope,
    query,
  );
  return { data: page.data.map(rowOf), page: page.page };
}

/**
 * GET /home/team/attendance (HomeTeamAttendancePage): one page of the people in the scope,
 * each with their days from the 1st of this month to today (Lagos), as My Attendance counts them.
 * @param {{scope: string, scope_ids: string[]|null}} scope  the `home` view scope
 * @param {object} query  a validated HomeTeamAttendanceQuery
 * @param {{now?: Date, db?: {query: Function}}} [at]
 */
async function month(scope, query, { now = new Date(), db = pool } = {}) {
  const today = lagos.today(now);
  const page = await attendance.month(
    db,
    {
      from: lagos.monthBounds(today).first,
      to: today,
      department_id: query.department_id,
      q: query.q,
    },
    scope,
    query,
  );
  return { data: page.data.map(monthRowOf), page: page.page };
}

/** Whether the reader holds the Team tab's capability; the CEO always does. */
async function mayOpen(db, user) {
  if (user.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(db, user.user_id)).includes(
    CAPABILITY,
  );
}

/**
 * The assistant's `team.today`: today's roster as the asker's Team tab shows it, in their
 * `home` scope, or an empty page when they do not hold the capability that opens the tab.
 * @param {{query: Function}} db  the client the assistant reads with
 * @param {object} actor  req.user with the assistant's scope for `home` view
 * @param {object} query  a validated HomeTeamQuery
 */
async function forAssistant(db, actor, query, { now = new Date() } = {}) {
  if (!(await mayOpen(db, actor))) return envelope([], pageOf(query).number, 0);
  return roster(actor.scope, query, { now, db });
}

assertCards();

module.exports = {
  CAPABILITY,
  CARDS,
  filtersOf,
  rowOf,
  monthRowOf,
  summary,
  roster,
  month,
  mayOpen,
  forAssistant,
};
