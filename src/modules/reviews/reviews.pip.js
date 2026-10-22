"use strict";
/**
 * Performance improvement plans (docs/guides/performance.md §6.16; P21).
 *
 * Operations & People start one from a closed review rated Below: the lines to improve and their
 * targets, the period (30 days unless given), the review date (its end unless given) and a summary.
 * Each line becomes a task for the employee, pointing at the plan. A reminder reaches Operations &
 * People and the reviewer 3 business days before the review date. Close PIP records Passed, Not
 * Met or Extended (with new dates, and the plan runs on), with a note. What follows a plan not met
 * is HR's, outside the system. A plan is reached from its review, never from search.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { formatDate } = require("../../shared/time/day-first");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const reminders = require("../notifications/notifications.reminders");
const targetsRepo = require("../targets/targets.repo");
const repo = require("./reviews.repo");
const { EVENTS, PIP_REMINDER } = require("./reviews.events");

/** A plan's length when none is given (§6.16). */
const DEFAULT_DAYS = 30;
const OUTCOME = { passed: "Passed", not_met: "Not Met", extended: "Extended" };
const ALL = Object.freeze({ scope: "all", scope_ids: null });

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const notFound = () => new AppError("NOT_FOUND", "That improvement plan does not exist", 404);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

function view(p) {
  return {
    improvement_plan_id: p.improvement_plan_id,
    employee: p.employee,
    performance_review_id: p.performance_review_id,
    starts_on: day(p.starts_on),
    ends_on: day(p.ends_on),
    review_on: day(p.review_on),
    summary: p.summary,
    status: p.status,
    outcome_note: p.outcome_note,
    decided_at: iso(p.decided_at),
    lines: (p.lines || []).map((l) => ({ ...l, position: Number(l.position) })),
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

/** GET /performance/pips */
async function list(query, scope) {
  const page = await repo.listPips(pool, query, scope);
  return { ...page, data: page.data.map(view) };
}

async function load(db, id, scope) {
  const p = await repo.getPip(db, id);
  if (!p) throw notFound();
  if (scope) assertInScope(scope, p.employee_id);
  return p;
}

/** The reminder 3 business days before the review date, at 09:00; moved when the date moves. */
async function scheduleReminder(client, id, reviewOn) {
  const cal = await workingWeek.loadCalendar(client);
  const date = workingWeek.addBusinessDays(reviewOn, -3, cal);
  const now = new Date();
  const at = lagos.instant(date, "09:00");
  await reminders.cancel(client, { key: PIP_REMINDER, entity: { type: "improvement_plan", id } });
  await reminders.schedule(client, {
    key: PIP_REMINDER,
    entity: { type: "improvement_plan", id },
    occurrence: reviewOn,
    at: at > now ? at : now,
    payload: {},
  });
}

/** Each line's task for the employee, pointing at the plan. In the caller's transaction. */
async function lineTasks(client, actor, plan, lines) {
  const tasks = require("../tasks/tasks.service");
  for (const l of lines)
    await tasks.create(
      actor,
      ALL,
      {
        title: `Improve: ${l.text}`.slice(0, 200),
        description: l.target_text || undefined,
        due_on: plan.review_on,
        primary_assignee_id: plan.employee_id,
        entity_type: "improvement_plan",
        entity_id: plan.improvement_plan_id,
      },
      { client },
    );
}

/** The lines a plan names must be lines of the person's own scorecards. */
async function checkLines(db, employeeId, lines) {
  for (const [i, l] of lines.entries()) {
    if (!l.employee_target_id) continue;
    const t = await db.query("SELECT employee_id FROM employee_target WHERE employee_target_id = $1", [l.employee_target_id]);
    if (!t.rows[0] || t.rows[0].employee_id !== employeeId)
      throw new AppError("VALIDATION_FAILED", "Pick one of their lines", 422, { [`lines.${i}.employee_target_id`]: ["Not their line"] });
  }
}

/** POST /performance/pips: Start PIP, from a closed review rated Below. */
async function create(actor, scope, body) {
  const id = await tx(async (client) => {
    const r = await repo.get(client, body.performance_review_id);
    if (!r) throw new AppError("VALIDATION_FAILED", "Pick a review", 422, { performance_review_id: ["Not a review"] });
    assertInScope(scope, r.employee_id);
    if (r.status !== "closed" || r.rating !== "below")
      throw new AppError("REVIEW_NOT_BELOW", "A plan starts from a closed review rated Below", 409);
    if (actor && r.employee_id === actor.employee_id) throw new AppError("PERMISSION_DENIED", "Nobody starts their own plan", 403);
    const held = await repo.pipOfReview(client, r.performance_review_id);
    if (held && ["open", "extended"].includes(held.status)) throw new AppError("PIP_EXISTS", "A plan is already open from this review", 409);
    await checkLines(client, r.employee_id, body.lines);
    const startsOn = body.starts_on;
    const endsOn = body.ends_on || lagos.addDays(startsOn, DEFAULT_DAYS);
    const reviewOn = body.review_on || endsOn;
    if (endsOn < startsOn) throw new AppError("VALIDATION_FAILED", "Check the dates", 422, { ends_on: ["After the start"] });
    const planId = await repo.insertPip(client, {
      employee_id: r.employee_id,
      performance_review_id: r.performance_review_id,
      starts_on: startsOn,
      ends_on: endsOn,
      review_on: reviewOn,
      summary: body.summary || null,
      status: "open",
      created_by: actor.user_id,
    });
    await repo.setPipLines(client, planId, body.lines);
    await lineTasks(client, actor, { improvement_plan_id: planId, employee_id: r.employee_id, review_on: reviewOn }, body.lines);
    await scheduleReminder(client, planId, reviewOn);
    await emit(client, {
      key: EVENTS.IMPROVEMENT_PLAN_STARTED,
      entity: { type: "improvement_plan", id: planId },
      actor,
      after: { starts_on: startsOn, ends_on: endsOn, review_on: reviewOn, lines: body.lines.length },
      payload: {
        improvement_plan_id: planId,
        employee_id: r.employee_id,
        subject_employee_id: r.employee_id,
        reviewer_employee_id: r.reviewer_employee_id,
        review_on: reviewOn,
      },
    });
    return planId;
  });
  return view(await load(pool, id, null));
}

/** PATCH /performance/pips/:id: its dates, summary or lines while it runs. */
async function edit(actor, scope, id, patch) {
  await tx(async (client) => {
    const p = await load(client, id, scope);
    if (!["open", "extended"].includes(p.status)) throw new AppError("PIP_CLOSED", "This plan is closed", 409);
    const endsOn = patch.ends_on || day(p.ends_on);
    const reviewOn = patch.review_on || day(p.review_on);
    if (endsOn < day(p.starts_on)) throw new AppError("VALIDATION_FAILED", "Check the dates", 422, { ends_on: ["After the start"] });
    if (patch.lines) await checkLines(client, p.employee_id, patch.lines);
    await repo.updatePip(client, id, { ends_on: endsOn, review_on: reviewOn, summary: patch.summary === undefined ? undefined : patch.summary });
    if (patch.lines) await repo.setPipLines(client, id, patch.lines);
    if (patch.review_on) await scheduleReminder(client, id, reviewOn);
    await emit(client, {
      key: EVENTS.IMPROVEMENT_PLAN_CHANGED,
      entity: { type: "improvement_plan", id },
      actor,
      before: { ends_on: day(p.ends_on), review_on: day(p.review_on) },
      after: { ends_on: endsOn, review_on: reviewOn },
      payload: { improvement_plan_id: id, employee_id: p.employee_id, subject_employee_id: p.employee_id },
    });
  });
  return view(await load(pool, id, null));
}

/** POST /performance/pips/:id/close: Passed, Not Met, or Extended with new dates. */
async function close(actor, scope, id, body) {
  await tx(async (client) => {
    const p = await load(client, id, scope);
    if (!["open", "extended"].includes(p.status)) throw new AppError("PIP_CLOSED", "This plan is closed", 409);
    const extended = body.status === "extended";
    await repo.updatePip(client, id, {
      status: body.status,
      outcome_note: body.outcome_note,
      decided_by: actor.user_id,
      decided_at: new Date(),
      ends_on: extended ? body.ends_on : undefined,
      review_on: extended ? body.review_on : undefined,
    });
    if (extended) await scheduleReminder(client, id, body.review_on);
    else await reminders.cancel(client, { key: PIP_REMINDER, entity: { type: "improvement_plan", id } });
    await emit(client, {
      key: EVENTS.IMPROVEMENT_PLAN_CLOSED,
      entity: { type: "improvement_plan", id },
      actor,
      before: { status: p.status },
      after: { status: body.status },
      payload: {
        improvement_plan_id: id,
        employee_id: p.employee_id,
        subject_employee_id: p.employee_id,
        reviewer_employee_id: p.reviewer_employee_id,
        status: body.status,
        outcome_label: extended ? `Extended to ${formatDate(body.ends_on)}` : OUTCOME[body.status],
      },
    });
  });
  return view(await load(pool, id, null));
}

/** pip_review_due's check, in the firing's transaction: still running, and who to remind. */
async function reviewReminder(client, row) {
  const p = await repo.getPip(client, row.entity_id);
  if (!p || !["open", "extended"].includes(p.status) || day(p.review_on) !== row.occurrence) return null;
  const hr = (await targetsRepo.roleHolders(client, "operations_people")).filter((e) => e !== p.employee_id);
  return {
    entity: { type: "improvement_plan", id: p.improvement_plan_id },
    payload: {
      improvement_plan_id: p.improvement_plan_id,
      employee_id: p.employee_id,
      employee_name: p.employee.display_name,
      review_on: day(p.review_on),
      remind_employee_ids: [...new Set([...hr, p.reviewer_employee_id].filter(Boolean))],
    },
  };
}

module.exports = { DEFAULT_DAYS, view, list, create, edit, close, reviewReminder };
