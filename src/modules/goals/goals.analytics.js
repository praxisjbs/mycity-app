"use strict";
/**
 * Performance Analytics (docs/guides/performance.md §6.21): a quarter's figures and its people,
 * and the score Goals, Analytics and Home all show for an objective.
 *
 *   figures(query, scope)          GET  /performance/analytics
 *   people(query, scope)           GET  /performance/analytics/people, 25 a page, sorted by score
 *   requestExport(actor, body)     POST /performance/analytics/people/export (202, the file pending)
 *   buildExport(event, ctx)        analytics.export_requested, in the worker after commit
 *
 * Every figure is worked out in SQL; nothing is filtered or counted in JavaScript. The OKR
 * figures (scores by month, the company score, key results by status) read the whole tree, the
 * company's shared plan that everyone sees (§8). Scorecards, reviews and commitments are read in
 * the reader's `performance` scope, over the person each is about.
 *
 *   score of a key result   its month's confirmed score, else the proposed one
 *   objective               the mean of its key results, to two places (their sheet)
 *   function, company       the mean of their objectives
 *   by month                each key result's score for that month (Scores by Month)
 *   latest                  each key result at its latest month, as Goals shows it (the Company
 *                           Score tile; Home's Org KPI and goal progress read the same CTE,
 *                           goals.cascade.js objectiveScores)
 *   deadline                the end of its day in Lagos (§6.2); a check-in or review is due once
 *                           that has passed or it is in, a commitment once its original date has
 *   head                    a function's head (department.head_employee_id) checks in by the
 *                           round's head deadline, everyone else by the staff one
 *
 * The rows read are those PR 3 (rounds, reviews, their items) and PR 4 (commitments on tasks)
 * write, as §4 defines them: a review's `check_in_submitted_at`, `closed_at`, `rating` and items'
 * `self_score`, `proposed_score` and final `score`; a commitment's `original_due_at`,
 * `completed_at` and `rescoped_at`.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { scoring } = require("@mycity/contract");
const { atomically } = require("../../shared/db/tx");
const { personJson } = require("../../shared/db/person");
const exportFiles = require("../../shared/documents/exports");
const { defineDocumentType } = require("../../shared/documents/types");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const outbox = require("../../shared/events/outbox");
const { completeQuery, envelope, pageOf, pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const { COMMITMENT_STATE } = require("../tasks/tasks.repo");
const { objectiveScores } = require("./goals.cascade");
const { monthsOf } = require("./goals.periods");
const repo = require("./goals.repo");
const { EVENTS } = require("./goals.events");

/** The people table's file, kept under this document type while it waits to be downloaded. */
const EXPORT_DOC_TYPE = "performance_analytics_export";

defineDocumentType(EXPORT_DOC_TYPE, {
  label: "Performance Analytics export",
  module: "performance",
  sensitivity: "restricted",
  export: true,
});

/** The most people one export holds; a quarter's scorecards are a few dozen. */
const EXPORT_CEILING = 5000;

/** The four ratings, Exceeds first, as the spread lists them. */
const RATINGS = scoring.Rating.options;

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

/** The end of a date's day in Lagos, as SQL: when a deadline on that date has passed. */
const endOfDay = (date) => `((${date})::date + 1)::timestamp AT TIME ZONE 'Africa/Lagos'`;

/** The quarter named, else the current one (active, else the latest being planned); null before the first. */
async function periodFor(db, periodId) {
  if (periodId) {
    const p = await repo.getPeriod(db, periodId);
    if (!p) throw new AppError("NOT_FOUND", "That quarter does not exist", 404);
    return p;
  }
  return repo.currentPeriod(db);
}

/* ------------------------------------------------------------------ *
 * The OKR figures: the whole tree
 * ------------------------------------------------------------------ */

/**
 * Scores by Month: the company's and each function's month scores (one function and the company
 * when one is picked), company first. Months with nothing scored are null.
 */
async function scoresByMonth(db, period, months, departmentId) {
  // pagination:complete the company and the functions with objectives this quarter, a handful
  const { rows } = await completeQuery(
    db,
    `WITH quarter_month AS (
       SELECT g.m::date AS month FROM generate_series($2::date, $3::date, interval '1 month') AS g(m)
     ), key_result_month AS (
       SELECT o.okr_objective_id, o.department_id, qm.month, COALESCE(km.confirmed_score, km.proposed_score) AS score
         FROM okr_objective o
         JOIN okr_key_result k ON k.okr_objective_id = o.okr_objective_id
         CROSS JOIN quarter_month qm
         LEFT JOIN okr_key_result_month km ON km.okr_key_result_id = k.okr_key_result_id AND km.month = qm.month
        WHERE o.performance_period_id = $1
          AND ($4::uuid IS NULL OR o.department_id IS NULL OR o.department_id = $4)
     ), objective_month AS (
       SELECT okr_objective_id, department_id, month, round(avg(score), 2) AS score
         FROM key_result_month GROUP BY okr_objective_id, department_id, month
     ), function_month AS (
       SELECT department_id, month, round(avg(score), 4) AS score
         FROM objective_month GROUP BY department_id, month
     )
     SELECT fm.department_id, d.name AS department,
            json_agg(json_build_object('month', to_char(fm.month, 'YYYY-MM-DD'), 'score', trim_scale(fm.score)::text)
                     ORDER BY fm.month) AS months
       FROM function_month fm
       LEFT JOIN department d ON d.department_id = fm.department_id
      GROUP BY fm.department_id, d.name
      ORDER BY (fm.department_id IS NOT NULL), d.name, fm.department_id`,
    [period.performance_period_id, months[0], months[months.length - 1], departmentId || null],
    { label: "a quarter's scores by month", ceiling: 100 },
  );
  return rows.map((r) => ({ department_id: r.department_id, department: r.department, months: r.months }));
}

/** The company's score as Goals shows it: the mean of the company objectives at their latest. */
async function companyScore(db, period) {
  const { rows } = await db.query(
    `WITH objective_score AS (${objectiveScores("$1")})
     SELECT trim_scale(round(avg(os.score) FILTER (WHERE os.department_id IS NULL), 4))::text AS company_score
       FROM objective_score os`,
    [period.performance_period_id],
  );
  return rows[0] ? rows[0].company_score : null;
}

/**
 * Key results by their latest month's status, the function's or every one; Recovery is a latest
 * score under the quarter's Watch band.
 */
async function keyResultStatuses(db, period, departmentId) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS key_results,
            count(*) FILTER (WHERE km.status = 'not_started')::int AS not_started,
            count(*) FILTER (WHERE km.status = 'on_track')::int AS on_track,
            count(*) FILTER (WHERE km.status = 'at_risk')::int AS at_risk,
            count(*) FILTER (WHERE km.status = 'off_track')::int AS off_track,
            count(*) FILTER (WHERE km.status = 'done')::int AS done,
            count(*) FILTER (WHERE km.status = 'missed')::int AS missed,
            count(*) FILTER (WHERE km.okr_key_result_month_id IS NULL)::int AS awaiting_report,
            count(*) FILTER (WHERE COALESCE(km.confirmed_score, km.proposed_score)
                                   < COALESCE((p.rules -> 'key_results' ->> 'band_watch')::numeric, $3))::int AS recovery
       FROM okr_objective o
       JOIN performance_period p ON p.performance_period_id = o.performance_period_id
       JOIN okr_key_result k ON k.okr_objective_id = o.okr_objective_id
       LEFT JOIN okr_key_result_month km ON km.okr_key_result_id = k.okr_key_result_id
        AND km.month = (SELECT max(kx.month) FROM okr_key_result_month kx WHERE kx.okr_key_result_id = k.okr_key_result_id)
      WHERE o.performance_period_id = $1 AND ($2::uuid IS NULL OR o.department_id = $2)`,
    [period.performance_period_id, departmentId || null, scoring.DEFAULT_RULES.key_results.band_watch],
  );
  return rows[0];
}

/* ------------------------------------------------------------------ *
 * Scorecards, reviews and commitments: the reader's scope
 * ------------------------------------------------------------------ */

/** Scorecards by rating at the latest closed round of the quarter, in scope. */
async function ratingSpread(db, period, departmentId, scope) {
  const params = [period.performance_period_id, departmentId || null, RATINGS];
  const s = scopeClause(scope, { column: "rv.employee_id" }, params);
  const { rows } = await db.query(
    `WITH last_round AS (
       SELECT c.performance_cycle_id, c.month FROM performance_cycle c
        WHERE c.performance_period_id = $1 AND c.status = 'closed'
          AND c.month = (SELECT max(cx.month) FROM performance_cycle cx
                          WHERE cx.performance_period_id = $1 AND cx.status = 'closed')
     ), rated AS (
       SELECT rv.rating FROM performance_review rv
         JOIN last_round lr ON lr.performance_cycle_id = rv.performance_cycle_id
         JOIN scorecard s ON s.scorecard_id = rv.scorecard_id
        WHERE rv.review_kind = 'monthly' AND rv.status = 'closed' AND rv.rating IS NOT NULL
          AND ($2::uuid IS NULL OR s.department_id = $2) ${s.and}
     )
     SELECT (SELECT to_char(lr.month, 'YYYY-MM-DD') FROM last_round lr) AS month,
            json_agg(json_build_object('rating', b.rating,
                                       'count', (SELECT count(*) FROM rated x WHERE x.rating = b.rating)::int)
                     ORDER BY b.n) AS counts
       FROM unnest($3::text[]) WITH ORDINALITY AS b(rating, n)`,
    params,
  );
  return { month: rows[0].month, counts: rows[0].counts };
}

/**
 * Commitments delivered on time (§6.11): each function's, month by month, and the quarter's, counted
 * as the Commitments view and the On-time Commitment Delivery line count them (one state, the tasks
 * module's): the month's approved commitments not rescoped are due, those done by the end of their
 * original date in Lagos on time. A function is the assignee's department.
 */
async function commitments(db, period, months, departmentId, scope) {
  const params = [months[0], months[months.length - 1], departmentId || null];
  const s = scopeClause(scope, { column: "t.primary_assignee_id" }, params);
  const { rows } = await db.query(
    `WITH quarter_month AS (
       SELECT g.m::date AS month FROM generate_series($1::date, $2::date, interval '1 month') AS g(m)
     ), commitment_state AS (
       SELECT e.department_id, t.commitment_month AS month, ${COMMITMENT_STATE("t")} AS state
         FROM task t
         JOIN employee e ON e.employee_id = t.primary_assignee_id
        WHERE t.is_commitment AND t.commitment_month BETWEEN $1::date AND $2::date
          AND ($3::uuid IS NULL OR e.department_id = $3) ${s.and}
     ), committed AS (
       SELECT cs.department_id, cs.month, cs.state = 'on_time' AS on_time
         FROM commitment_state cs
        WHERE cs.state IN ('due', 'on_time', 'late', 'missed')
     ), per_month AS (
       SELECT f.department_id, qm.month,
              count(cm.month)::int AS due,
              count(cm.month) FILTER (WHERE cm.on_time)::int AS on_time
         FROM (SELECT DISTINCT department_id FROM committed) f
         CROSS JOIN quarter_month qm
         LEFT JOIN committed cm ON cm.department_id IS NOT DISTINCT FROM f.department_id AND cm.month = qm.month
        GROUP BY f.department_id, qm.month
     ), per_function AS (
       SELECT pm.department_id, d.name AS department,
              json_agg(json_build_object('month', to_char(pm.month, 'YYYY-MM-DD'), 'due', pm.due, 'on_time', pm.on_time)
                       ORDER BY pm.month) AS months
         FROM per_month pm
         LEFT JOIN department d ON d.department_id = pm.department_id
        GROUP BY pm.department_id, d.name
     )
     SELECT (SELECT count(*) FROM committed)::int AS due,
            (SELECT count(*) FROM committed WHERE on_time)::int AS on_time,
            COALESCE((SELECT json_agg(json_build_object('department_id', pf.department_id, 'department', pf.department,
                                                        'months', pf.months)
                                      ORDER BY pf.department NULLS LAST, pf.department_id)
                        FROM per_function pf), '[]'::json) AS by_function`,
    params,
  );
  const r = rows[0];
  return { total: { due: r.due, on_time: r.on_time }, by_function: r.by_function };
}

/**
 * Check-ins on time (`kind` check_in: in by the staff or head deadline) or reviews closed on time
 * (`kind` close: closed by the round's close deadline), month by month over the quarter's monthly
 * reviews, and the quarter's, in scope.
 */
async function onTime(db, period, months, departmentId, scope, now, kind) {
  const params = [period.performance_period_id, months[0], months[months.length - 1], departmentId || null, now];
  const s = scopeClause(scope, { column: "rv.employee_id" }, params);
  const dueOn =
    kind === "check_in"
      ? `CASE WHEN EXISTS (SELECT 1 FROM department hd WHERE hd.head_employee_id = rv.employee_id)
              THEN c.head_check_in_due_on ELSE c.check_in_due_on END`
      : "c.close_due_on";
  const doneAt = kind === "check_in" ? "rv.check_in_submitted_at" : "rv.closed_at";
  const { rows } = await db.query(
    `WITH quarter_month AS (
       SELECT g.m::date AS month FROM generate_series($2::date, $3::date, interval '1 month') AS g(m)
     ), reviewed AS (
       SELECT c.month, ${dueOn} AS due_on, ${doneAt} AS done_at
         FROM performance_review rv
         JOIN performance_cycle c ON c.performance_cycle_id = rv.performance_cycle_id
         JOIN scorecard s ON s.scorecard_id = rv.scorecard_id
        WHERE c.performance_period_id = $1 AND rv.review_kind = 'monthly'
          -- A withdrawn review (a leaver's, §11) was never due.
          AND rv.status <> 'withdrawn'
          AND ($4::uuid IS NULL OR s.department_id = $4) ${s.and}
     ), marked AS (
       SELECT rd.month,
              (rd.done_at IS NOT NULL OR (rd.due_on IS NOT NULL AND $5::timestamptz >= ${endOfDay("rd.due_on")})) AS is_due,
              (rd.done_at IS NOT NULL AND rd.due_on IS NOT NULL AND rd.done_at < ${endOfDay("rd.due_on")}) AS on_time
         FROM reviewed rd
     )
     SELECT (SELECT count(*) FROM marked WHERE is_due)::int AS due,
            (SELECT count(*) FROM marked WHERE on_time)::int AS on_time,
            (SELECT json_agg(json_build_object('month', to_char(qm.month, 'YYYY-MM-DD'),
                                               'due', (SELECT count(*) FROM marked mk WHERE mk.month = qm.month AND mk.is_due),
                                               'on_time', (SELECT count(*) FROM marked mk WHERE mk.month = qm.month AND mk.on_time))
                             ORDER BY qm.month)
               FROM quarter_month qm) AS by_month`,
    params,
  );
  const r = rows[0];
  return { total: { due: r.due, on_time: r.on_time }, by_month: r.by_month };
}

/**
 * Self Against Final: per function, the mean of (the self score, or the proposed one where the
 * employee left it) less the final score, over the scored lines of closed monthly reviews, in scope.
 */
async function selfAgainstFinal(db, period, departmentId, scope) {
  const params = [period.performance_period_id, departmentId || null];
  const s = scopeClause(scope, { column: "rv.employee_id" }, params);
  // pagination:complete one row a function
  const { rows } = await completeQuery(
    db,
    `SELECT s.department_id, d.name AS department,
            trim_scale(round(avg(COALESCE(i.self_score, i.proposed_score) - i.score), 2))::text AS gap,
            count(*)::int AS lines
       FROM performance_review_item i
       JOIN performance_review rv ON rv.performance_review_id = i.performance_review_id
       JOIN performance_cycle c ON c.performance_cycle_id = rv.performance_cycle_id
       JOIN scorecard s ON s.scorecard_id = rv.scorecard_id
       LEFT JOIN department d ON d.department_id = s.department_id
      WHERE c.performance_period_id = $1 AND rv.review_kind = 'monthly' AND rv.status = 'closed'
        AND i.score IS NOT NULL AND COALESCE(i.self_score, i.proposed_score) IS NOT NULL
        AND ($2::uuid IS NULL OR s.department_id = $2) ${s.and}
      GROUP BY s.department_id, d.name
      ORDER BY d.name NULLS LAST, s.department_id`,
    params,
    { label: "self against final by function", ceiling: 100 },
  );
  return rows;
}

const EMPTY_STATUSES = Object.freeze({
  key_results: 0,
  not_started: 0,
  on_track: 0,
  at_risk: 0,
  off_track: 0,
  done: 0,
  missed: 0,
  awaiting_report: 0,
  recovery: 0,
});

/** What Analytics shows before the first quarter is set up. */
const NOTHING = Object.freeze({
  period: null,
  months: [],
  company_score: null,
  scores: [],
  key_results: EMPTY_STATUSES,
  ratings: { month: null, counts: RATINGS.map((rating) => ({ rating, count: 0 })) },
  commitments: { due: 0, on_time: 0 },
  commitments_by_function: [],
  check_ins: { due: 0, on_time: 0 },
  check_ins_by_month: [],
  reviews_closed: { due: 0, on_time: 0 },
  reviews_closed_by_month: [],
  self_against_final: [],
});

/**
 * GET /performance/analytics (PerformanceAnalytics): the quarter's figures, and one function's
 * where one is picked.
 * @param {{period_id?: string, department_id?: string}} query
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `performance` view scope
 * @param {{now?: Date, db?: {query: Function}}} [at]
 */
async function figures(query, scope, { now = new Date(), db = pool } = {}) {
  const period = await periodFor(db, query.period_id);
  if (!period) return NOTHING;
  const months = monthsOf(day(period.starts_on));
  const dept = query.department_id || null;
  // One read after the other: an Analytics page holds one connection of the pool at a time.
  const scores = await scoresByMonth(db, period, months, dept);
  const company = await companyScore(db, period);
  const statuses = await keyResultStatuses(db, period, dept);
  const ratings = await ratingSpread(db, period, dept, scope);
  const committed = await commitments(db, period, months, dept, scope);
  const checkIns = await onTime(db, period, months, dept, scope, now, "check_in");
  const closed = await onTime(db, period, months, dept, scope, now, "close");
  const gaps = await selfAgainstFinal(db, period, dept, scope);
  return {
    period: {
      performance_period_id: period.performance_period_id,
      name: period.name,
      starts_on: day(period.starts_on),
      ends_on: day(period.ends_on),
    },
    months,
    company_score: company,
    scores,
    key_results: statuses,
    ratings,
    commitments: committed.total,
    commitments_by_function: committed.by_function,
    check_ins: checkIns.total,
    check_ins_by_month: checkIns.by_month,
    reviews_closed: closed.total,
    reviews_closed_by_month: closed.by_month,
    self_against_final: gaps,
  };
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

const SORTS = {
  score_to_date: "s.score_to_date",
  employee: "e.first_name, e.last_name",
};

/** One page of the quarter's scorecards in scope, past draft: the person, function, reviewer, score and rating. */
function peoplePage(db, period, query, scope) {
  const params = [period.performance_period_id, query.department_id || null, query.rating || null, query.q || null];
  const s = scopeClause(scope, { column: "s.employee_id" }, params);
  return pageQuery(
    db,
    `SELECT s.scorecard_id, ${personJson("e", "ed")} AS employee, d.name AS department,
            ${personJson("r", "rd")} AS reviewer, trim_scale(s.score_to_date)::text AS score_to_date, s.rating,
            (SELECT count(*) FROM performance_review rv
              WHERE rv.scorecard_id = s.scorecard_id AND rv.review_kind = 'monthly' AND rv.status = 'closed')::int
              AS months_scored,
            ${TOTAL_COL}
       FROM scorecard s
       JOIN employee e ON e.employee_id = s.employee_id
       LEFT JOIN department ed ON ed.department_id = e.department_id
       LEFT JOIN department d ON d.department_id = s.department_id
       LEFT JOIN employee r ON r.employee_id = s.reviewer_employee_id
       LEFT JOIN department rd ON rd.department_id = r.department_id
      WHERE s.performance_period_id = $1 AND s.status IN ('binding', 'agreed', 'closed')
        AND ($2::uuid IS NULL OR s.department_id = $2)
        AND ($3::text IS NULL OR s.rating = $3)
        AND ($4::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($4) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "s.scorecard_id")}`,
    params,
    query,
  );
}

/**
 * GET /performance/analytics/people (AnalyticsPersonPage).
 * @param {object} query  a validated AnalyticsPeopleQuery
 * @param {{scope: string, scope_ids: string[]|null}} scope  the reader's `performance` view scope
 */
async function people(query, scope, { db = pool } = {}) {
  const period = await periodFor(db, query.period_id);
  if (!period) return envelope([], pageOf(query).number, 0);
  return peoplePage(db, period, query, scope);
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

/**
 * POST /performance/analytics/people/export: reserve the people table's file, filtered as on screen,
 * for the person asking; the worker makes it after commit and their screen downloads it.
 * @returns {Promise<object>} the ExportFile, pending
 */
async function requestExport(actor, filters) {
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: EXPORT_DOC_TYPE,
        entity: { type: EXPORT_DOC_TYPE, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "performance-people", env: config.APP_ENV, extension: "xlsx" }),
        title: "Performance Analytics export",
        actor,
      });
      await emit(client, {
        key: EVENTS.ANALYTICS_EXPORT_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { filters, requested_by: actor.user_id, document_id: doc.document_id },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

/** Every person the filters match in `scope`, a page of 25 at a time, up to the ceiling. */
async function gather(db, filters, scope) {
  const period = await periodFor(db, filters.period_id);
  if (!period) return { period: null, rows: [], total: 0 };
  const rows = [];
  let page = await peoplePage(db, period, { ...filters, sort: { field: "score_to_date", dir: "desc" }, page: 1 }, scope);
  rows.push(...page.data);
  while (page.page.has_next && rows.length < EXPORT_CEILING) {
    page = await peoplePage(db, period, { ...filters, sort: { field: "score_to_date", dir: "desc" }, page: page.page.number + 1 }, scope);
    rows.push(...page.data);
  }
  return { period, rows: rows.slice(0, EXPORT_CEILING), total: page.page.total };
}

const RATING_WORDS = Object.freeze({ exceeds: "Exceeds", meets: "Meets", partly_meets: "Partly Meets", below: "Below" });

const COLUMNS = [
  { key: "employee", header: "Employee", width: 28 },
  { key: "department", header: "Department", width: 28 },
  { key: "reviewer", header: "Reviewer", width: 28 },
  { key: "score_to_date", header: "Score to Date", format: "num", width: 14 },
  { key: "rating", header: "Rating", width: 14 },
  { key: "months_scored", header: "Months Scored", format: "int", width: 14 },
];

/**
 * The outbox handler: the people table made into the file the request reserved, in the scope the
 * person who asked holds now. One no longer active, or no longer able to export Performance, gets a
 * failed file instead.
 * @param {object} event  analytics.export_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildExport(event, ctx) {
  const { buildWorkbook } = require("../../shared/spreadsheet/build");
  const { workbookContext } = require("../../shared/spreadsheet/context");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const { scopeFor } = require("../../middleware/rbac");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");
  const scope = await scopeFor(reader, "performance", "export");
  if (!scope) return exportFiles.fail(p.document_id, "The person who asked may no longer export Performance.");
  const filters = p.filters || {};

  await exportFiles.make(p.document_id, ctx, async () => {
    const { period, rows, total } = await gather(pool, filters, scope);
    return buildWorkbook({
      sheets: [
        {
          name: "People",
          columns: COLUMNS,
          rows: rows.map((r) => ({
            employee: r.employee ? r.employee.display_name : "",
            department: r.department || "",
            reviewer: r.reviewer ? r.reviewer.display_name : "",
            score_to_date: r.score_to_date === null ? null : Number(r.score_to_date),
            rating: r.rating ? RATING_WORDS[r.rating] : "",
            months_scored: r.months_scored,
          })),
          freeze: { y: 1 },
        },
      ],
      context: workbookContext({
        actor: { name: reader.display_name },
        title: "Performance Analytics",
        lines: [
          ["Quarter", period ? period.name : "None set up"],
          ["People", rows.length < total ? `The first ${rows.length} of ${total}.` : String(rows.length)],
        ],
      }),
      cover: true,
    });
  });
}

outbox.register(EVENTS.ANALYTICS_EXPORT_REQUESTED, "goals.analytics_export", (event, ctx) => buildExport(event, ctx));

module.exports = {
  EXPORT_DOC_TYPE,
  EXPORT_CEILING,
  periodFor,
  figures,
  people,
  requestExport,
  gather,
  buildExport,
};
