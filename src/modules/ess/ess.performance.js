"use strict";
/**
 * My Performance: the caller's own month and reviews (docs/guides/performance.md §2, §10;
 * docs/guides/ess.md §5), read and written through the KPIs and reviews modules with the
 * caller's own scope, so nothing here reaches another person's record.
 *
 *   summary()   the month's KPIs, score, what each rolls up to, the reviews and the next cycle
 *   review()    the open self review, or 404 NO_OPEN_REVIEW when no cycle waits on the caller
 *   save(), submit(), dictate()  that review, by the caller as its reviewer
 */
const { pool } = require("../../config/db");
const lagos = require("../../shared/time/lagos");
const kpis = require("../kpis/kpis.service");
const reviews = require("../reviews/reviews.service");
const reviewsRepo = require("../reviews/reviews.repo");
const dictation = require("../reviews/reviews.dictation");

/** The caller's own records, and nobody else's. */
const ownScope = (user) => ({ scope: "own", scope_ids: [user.employee_id], employee_id: user.employee_id });

async function lastRating(employeeId) {
  const { rows } = await pool.query(
    `SELECT r.overall_score::float8 AS rating FROM performance_review r
       JOIN performance_cycle c ON c.performance_cycle_id = r.performance_cycle_id
      WHERE r.employee_id = $1 AND r.review_type <> 'self' AND r.status = 'closed'
      ORDER BY c.starts_on DESC, r.closed_at DESC LIMIT 1`,
    [employeeId],
  );
  return rows[0] ? rows[0].rating : null;
}

async function summary(user) {
  const scope = ownScope(user);
  const month = lagos.today().slice(0, 7);
  const mine = await kpis.ofEmployee(user.employee_id, { month }, scope, user);
  const counted = mine.items.filter((k) => k.attainment !== null);
  const traces = [];
  for (const k of mine.items) traces.push(await kpis.trace(k.employee_target_id, scope));
  const page = await reviews.list({ page: 1 }, scope, user);
  const current = await reviewsRepo.currentCycle(pool);
  const setter = mine.items.find((k) => k.set_by);
  return {
    month,
    set_by: setter ? setter.set_by.display_name : null,
    kpi_score: mine.kpi_score,
    on_track: counted.filter((k) => k.progress_status === "on_track" || k.progress_status === "met").length,
    kpi_count: mine.items.length,
    weight_assigned: mine.total_weight,
    last_review: await lastRating(user.employee_id),
    next_cycle: current && current.status !== "closed" ? await reviews.toCycle(pool, current) : null,
    kpis: mine.items,
    traces,
    reviews: page.data,
    open_review_id: await reviewsRepo.openSelfReview(pool, user.employee_id),
  };
}

async function review(user) {
  return reviews.detail(await reviews.ownOpenId(user), user);
}

async function save(user, body) {
  return reviews.save(await reviews.ownOpenId(user), user, body);
}

async function submit(user) {
  return reviews.submit(await reviews.ownOpenId(user), user);
}

async function dictate(user, file, body) {
  return dictation.dictate(await reviews.ownOpenId(user), user, file, body);
}

module.exports = { summary, review, save, submit, dictate };
