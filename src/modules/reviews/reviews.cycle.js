"use strict";
/**
 * Monthly rounds (docs/guides/performance.md §3.3 step 1, §6.2, §6.12, §7).
 *
 * A month's round opens on the first business day after the month ends (October's on 2 November),
 * from the `review-cycles` job at 06:00 Lagos, or by hand (Open Round) for a late start. It holds
 * one review per scorecard that binds at that moment, each with an item per line, and the deadlines
 * of the quarter's rules: the check-in by the month after's 2nd business day (3rd for a function's
 * head), the reviewer by the 5th, the second level by the 7th, Operations & People by the 10th. A
 * scorecard reviewed in a month had bound by its end; one that binds later starts with the next
 * month, and one that binds after its month's round opened waits for the next round (§11).
 *
 * Opening is idempotent: a round is made once per quarter and month, a review once per scorecard in
 * it. Each person is told their check-in is due, and reminded 2 business days before and on the day.
 */
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { formatMonth } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const { scoring } = require("@mycity/contract");
const reminders = require("../notifications/notifications.reminders");
const targetsRepo = require("../targets/targets.repo");
const progress = require("../targets/targets.progress");
const periods = require("../goals/goals.periods");
const repo = require("./reviews.repo");
const { EVENTS, CHECK_IN_REMINDER, REVIEW_REMINDER, CLOSE_REMINDER } = require("./reviews.events");

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
/** When a reminder fires on its day: 09:00 Lagos (§7). */
const AT = "09:00";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** A quarter's rules, with the code's defaults for anything it does not carry. */
const rulesOf = (period) => scoring.ScoringRules.safeParse(period && period.rules).success ? period.rules : scoring.DEFAULT_RULES;

/** A month's deadlines (§6.2, G2, G3): the quarter's rules counted in business days (goals.periods.js). */
function deadlines(month, rules, cal) {
  const { opens_on: opensOn, ...due } = periods.roundDates(day(month), rules, cal);
  return { opens_on: opensOn, ...due };
}

/** The months of a quarter, as their first days. */
const monthsOf = (period) => periods.monthsOf(day(period.starts_on));

/** A round as the contract's Round. */
function roundView(r, counts = null) {
  const zero = { total: 0, check_in: 0, with_reviewer: 0, second_level: 0, with_hr: 0, closed: 0 };
  const c = counts || zero;
  return {
    performance_cycle_id: r.performance_cycle_id,
    performance_period_id: r.performance_period_id,
    name: r.name,
    month: day(r.month),
    status: r.status,
    check_in_due_on: day(r.check_in_due_on),
    head_check_in_due_on: day(r.head_check_in_due_on),
    review_due_on: day(r.review_due_on),
    second_level_due_on: day(r.second_level_due_on),
    close_due_on: day(r.close_due_on),
    closes_at: iso(r.closes_at),
    counts: {
      total: c.total,
      check_in: c.check_in,
      with_reviewer: c.with_reviewer,
      second_level: c.second_level,
      with_hr: c.with_hr,
      closed: c.closed,
    },
  };
}

/** The reviewer a scorecard's review opens with, and its type (§6.13). Null when nobody can review it. */
async function reviewerFor(db, card) {
  if (card.is_ceo) return { reviewer_employee_id: card.employee_id, review_type: "self" };
  if (card.reviewer_employee_id) {
    const named = Boolean(card.reviewer_reason) || card.reviewer_employee_id !== card.effective_manager_id;
    return { reviewer_employee_id: card.reviewer_employee_id, review_type: named ? "designated" : "manager" };
  }
  if (card.reviewer_role_code) {
    // A role reviewer: its first active holder by name, until whichever holder scores first takes it.
    const holders = (await targetsRepo.roleHolders(db, card.reviewer_role_code)).filter((e) => e !== card.employee_id);
    if (holders.length) return { reviewer_employee_id: holders[0], review_type: "designated" };
  }
  if (card.effective_manager_id) return { reviewer_employee_id: card.effective_manager_id, review_type: "manager" };
  return null;
}

/**
 * The items a review of a scorecard opens with: one per line, the automatic ones filled.
 * In the caller's transaction.
 */
async function writeItems(client, reviewId, review, lines, rules) {
  const auto = await progress.automatic(client, review, lines, { rules });
  for (const line of lines) {
    const figures = auto.get(line.employee_target_id);
    await repo.insertItem(client, {
      performance_review_id: reviewId,
      employee_target_id: line.employee_target_id,
      kpi_definition_id: line.kpi_definition_id || null,
      auto: Boolean(figures),
      // An automatic line's evidence is its record; a person's own line waits for theirs (§6.14).
      assessable: Boolean(figures),
      actual_value: figures ? figures.actual_value : undefined,
      actual_text: figures ? figures.actual_text : undefined,
      proposed_score: figures ? figures.proposed_score : undefined,
    });
  }
}

/** Schedule a review's check-in reminders: 2 business days before its due date, and on it. */
async function scheduleCheckIn(client, reviewId, dueOn, cal, now = new Date()) {
  if (!dueOn) return;
  for (const [occurrence, date] of [
    ["before", workingWeek.addBusinessDays(dueOn, -2, cal)],
    ["due", dueOn],
  ]) {
    const at = lagos.instant(date, AT);
    if (at <= now) continue;
    await reminders.schedule(client, { key: CHECK_IN_REMINDER, entity: { type: "performance_review", id: reviewId }, occurrence, at, payload: {} });
  }
}

/**
 * Open a month's round of a quarter, with its reviews, in the caller's transaction.
 * @returns {Promise<{performance_cycle_id: string, created: boolean, reviews: number}>}
 */
async function openRound(client, actor, period, month) {
  const rules = rulesOf(period);
  const cal = await workingWeek.loadCalendar(client);
  const { opens_on: _opens, ...due } = deadlines(month, rules, cal);
  const { last } = lagos.monthBounds(month);
  const name = periods.roundName(month);
  const id = await repo.insertRound(client, {
    performance_period_id: period.performance_period_id,
    name,
    month,
    starts_on: month,
    ends_on: last,
    ...due,
    closes_at: lagos.endOfDayExclusive(due.close_due_on),
  });
  if (!id) return { performance_cycle_id: (await repo.roundOf(client, period.performance_period_id, month)).performance_cycle_id, created: false, reviews: 0 };

  const heads = new Set(
    (await client.query("SELECT head_employee_id FROM department WHERE head_employee_id IS NOT NULL")).rows.map((r) => r.head_employee_id),
  );
  const cards = await repo.bindingScorecards(client, period.performance_period_id, lagos.endOfDayExclusive(last));
  const opened = [];
  for (const card of cards) {
    const who = await reviewerFor(client, card);
    if (!who) {
      logger.warn({ scorecard_id: card.scorecard_id }, "review round: a scorecard with nobody to review it was left out");
      continue;
    }
    const reviewId = await repo.insert(client, {
      performance_cycle_id: id,
      scorecard_id: card.scorecard_id,
      employee_id: card.employee_id,
      ...who,
      review_kind: "monthly",
      status: "check_in",
      dotted_employee_id: card.dotted_employee_id || null,
    });
    if (!reviewId) continue;
    const head = heads.has(card.employee_id);
    const checkInDue = head ? due.head_check_in_due_on : due.check_in_due_on;
    await writeItems(
      client,
      reviewId,
      { employee_id: card.employee_id, performance_cycle_id: id, month, live_from: period.live_from, check_in_due: checkInDue },
      await targetsRepo.lines(client, card.scorecard_id),
      rules,
    );
    await scheduleCheckIn(client, reviewId, checkInDue, cal);
    opened.push(card.employee_id);
  }
  await emit(client, {
    key: EVENTS.REVIEW_ROUND_OPENED,
    entity: { type: "performance_cycle", id },
    actor,
    after: { name, month, reviews: opened.length },
    payload: {
      performance_cycle_id: id,
      round_name: name,
      month,
      check_in_due_on: due.check_in_due_on,
      reviews: opened.length,
      employee_ids: opened,
    },
  });
  return { performance_cycle_id: id, created: true, reviews: opened.length };
}

/**
 * The job: every month of a quarter being run that has ended, whose round is not open yet, opens
 * on or after the first business day of the month after it. Months that ended before the quarter
 * went live (`live_from`) are left to a person.
 * @param {string} [today]  a Lagos day; today when absent
 * @returns {Promise<string>} what it did, for the scheduler's log
 */
async function openDueRounds(today = lagos.today()) {
  const cal = await workingWeek.loadCalendar(pool);
  const done = [];
  for (const period of await repo.runningPeriods(pool)) {
    for (const month of monthsOf(period)) {
      const { last } = lagos.monthBounds(month);
      if (last >= today) continue;
      if (period.live_from && last < day(period.live_from)) continue;
      if (today < deadlines(month, rulesOf(period), cal).opens_on) continue;
      if (await repo.roundOf(pool, period.performance_period_id, month)) continue;
      const r = await tx((client) => openRound(client, null, period, month));
      if (r.created) done.push(`${formatMonth(month)} (${r.reviews} reviews)`);
    }
  }
  return done.length ? `opened ${done.join(", ")}` : "no round due";
}

/** POST /performance/rounds: open a month's round by hand, for a late start. */
async function createRound(actor, body) {
  const period = await require("../goals/goals.plans").periodOf(pool, body.performance_period_id);
  const month = day(body.month);
  if (!monthsOf(period).includes(month))
    throw new AppError("VALIDATION_FAILED", "Pick a month of the quarter", 422, { month: ["Not this quarter"] });
  if (period.status === "planning")
    throw new AppError("PERIOD_NOT_ACTIVE", "The quarter is still being planned", 409);
  if (lagos.monthBounds(month).last >= lagos.today())
    throw new AppError("VALIDATION_FAILED", "The month has not ended", 422, { month: ["Not ended yet"] });
  if (await repo.roundOf(pool, period.performance_period_id, month))
    throw new AppError("ROUND_EXISTS", "That month's round is already open", 409);
  const r = await tx((client) => openRound(client, actor, period, month));
  return roundView(await repo.getRound(pool, r.performance_cycle_id));
}

/** POST /performance/rounds/:id/close. Reviews still open finish as they are. */
async function closeRound(actor, id) {
  const round = await repo.getRound(pool, id);
  if (!round) throw new AppError("NOT_FOUND", "That round does not exist", 404);
  if (round.status !== "closed")
    await tx(async (client) => {
      await repo.setRoundStatus(client, id, "closed");
      await emit(client, {
        key: EVENTS.REVIEW_ROUND_CLOSED,
        entity: { type: "performance_cycle", id },
        actor,
        before: { status: round.status },
        after: { status: "closed" },
        payload: { performance_cycle_id: id, round_name: round.name },
      });
    });
  return roundView(await repo.getRound(pool, id));
}

/** GET /performance/rounds, each with its reviews counted by stage within what the reader may list. */
async function listRounds(query, actor, scope) {
  const page = await repo.listRounds(pool, query);
  const roleCodes = await repo.roleCodesOfUser(pool, actor && actor.user_id);
  const counts = await repo.roundCounts(pool, page.data.map((r) => r.performance_cycle_id), scope, actor || {}, roleCodes);
  const by = new Map(counts.map((c) => [c.performance_cycle_id, c]));
  return { ...page, data: page.data.map((r) => roundView(r, by.get(r.performance_cycle_id))) };
}

/* ------------------------------------------------------------------ *
 * The reminders' checks (reviews.events.js), each in its firing's transaction
 * ------------------------------------------------------------------ */

/** check_in_due: still waiting for the check-in. */
async function checkInReminder(client, row) {
  const r = await repo.get(client, row.entity_id);
  if (!r || r.status !== "check_in") return null;
  return {
    entity: { type: "performance_review", id: r.performance_review_id },
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      subject_employee_id: r.employee_id,
      round_name: r.round_name,
      due_on: day(r.due_on),
    },
  };
}

/** Who reviews a review now: the reviewer, or every holder of its reviewing role. */
async function reviewerIds(db, r) {
  if (r.reviewer_role_code) return (await targetsRepo.roleHolders(db, r.reviewer_role_code)).filter((e) => e !== r.employee_id);
  return [r.reviewer_employee_id];
}

/** review_due: still with the reviewer. */
async function reviewReminder(client, row) {
  const r = await repo.get(client, row.entity_id);
  if (!r || !["with_reviewer", "returned"].includes(r.status)) return null;
  return {
    entity: { type: "performance_review", id: r.performance_review_id },
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      employee_name: r.employee.display_name,
      reviewer_employee_ids: await reviewerIds(client, r),
      due_on: day(r.due_on),
    },
  };
}

/** review_close_due: still with Operations & People. */
async function closeReminder(client, row) {
  const r = await repo.get(client, row.entity_id);
  if (!r || r.status !== "with_hr") return null;
  return {
    entity: { type: "performance_review", id: r.performance_review_id },
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      employee_name: r.employee.display_name,
      hr_employee_ids: (await targetsRepo.roleHolders(client, "operations_people")).filter((e) => e !== r.employee_id),
      due_on: day(r.close_due_on),
    },
  };
}

/** Schedule the reviewer's reminders when a check-in comes in: the next business day and the due date. */
async function scheduleReview(client, review, cal, now = new Date()) {
  const dueOn = day(review.review_due_on);
  const next = workingWeek.addBusinessDays(lagos.today(now), 1, cal);
  for (const [occurrence, date] of [["after", next], ["due", dueOn]]) {
    if (!date) continue;
    const at = lagos.instant(date, AT);
    if (at <= now) continue;
    await reminders.schedule(client, { key: REVIEW_REMINDER, entity: { type: "performance_review", id: review.performance_review_id }, occurrence, at, payload: {} });
  }
}

/** Schedule Operations & People's reminder when a review reaches them: on its close date. */
async function scheduleClose(client, review, now = new Date()) {
  const dueOn = day(review.close_due_on);
  if (!dueOn) return;
  const at = lagos.instant(dueOn, AT);
  await reminders.schedule(client, {
    key: CLOSE_REMINDER,
    entity: { type: "performance_review", id: review.performance_review_id },
    occurrence: "close",
    at: at > now ? at : now,
    payload: {},
  });
}

/**
 * kr_report_due's `find`: on the 2nd and 3rd business days of a month, from 09:00, each function
 * whose key results are not reported for the month just ended, once.
 */
async function reportsDue(client, now = new Date()) {
  const today = lagos.today(now);
  const cal = await workingWeek.loadCalendar(client);
  const thisMonth = today.slice(0, 7);
  const second = workingWeek.nthBusinessDay(thisMonth, 2, cal);
  const third = workingWeek.nthBusinessDay(thisMonth, 3, cal);
  if (today < second || today > third || lagos.timeOf(now) < AT) return [];
  const month = lagos.addMonths(`${thisMonth}-01`, -1);
  return (await repo.unreportedByFunction(client, month)).map((r) => ({
    entity_type: "department",
    entity_id: r.department_id,
    occurrence: month,
    due_at: now,
  }));
}

/** kr_report_due's `check`: still unreported, and who heads the function now. */
async function reportReminder(client, row) {
  const left = await repo.unreportedOf(client, row.entity_id, row.occurrence);
  if (!left) return null;
  const head = await require("../organisation/organisation.service").headOf(client, row.entity_id);
  if (!head) return null;
  return {
    entity: { type: "department", id: row.entity_id },
    payload: {
      department_id: row.entity_id,
      department: left.department,
      month: row.occurrence,
      unreported: left.unreported,
      head_employee_ids: [head],
    },
  };
}

module.exports = {
  deadlines,
  monthsOf,
  rulesOf,
  roundView,
  reviewerFor,
  writeItems,
  scheduleCheckIn,
  scheduleReview,
  scheduleClose,
  openRound,
  openDueRounds,
  createRound,
  closeRound,
  listRounds,
  checkInReminder,
  reviewReminder,
  closeReminder,
  reviewerIds,
  reportsDue,
  reportReminder,
};
