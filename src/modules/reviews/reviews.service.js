"use strict";
/**
 * Reviews: the one write path for review cycles and reviews (A17, A18;
 * docs/guides/performance.md §3 steps 8 to 10, §6).
 *
 *   createCycle()  a cycle with its questions (the last cycle's when none are given); it opens at
 *                  once when its day is today, else at 06:00 on the day (openDue)
 *   closeCycle()   no more reviews written in it
 *   save()         a reviewer's draft: overall rating, summary, a rating and comment per KPI,
 *                  an answer per question (a dictation kept only when the save names it)
 *   submit()       a self review is handed in; a manager review, once the self review is in,
 *                  goes to `performance.review`: the reviewer's line manager, then Operations & People
 *   decide()       approve or return at the stage; Operations & People's approval closes it
 *   settle()       the review's status from where its approval stands, after any move
 *   remind()       the 08:00 reminders for reviews due within 3 days or overdue
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const engine = require("../../shared/workflow/engine");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const score = require("../kpis/kpis.score");
const repo = require("./reviews.repo");
const cycleOpen = require("./reviews.cycle");
const sequence = require("./reviews.sequence");
const metrics = require("./reviews.metrics");
const { EVENTS, DEFINITION_KEY } = require("./reviews.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That review does not exist", 404);
const conflict = (code, message) => new AppError(code, message, 409);
const EDITABLE = new Set(["draft", "returned"]);
const REMIND_WITHIN_DAYS = 3;

/* ------------------------------------------------------------------ *
 * Cycles
 * ------------------------------------------------------------------ */

async function toCycle(client, row) {
  return {
    performance_cycle_id: row.performance_cycle_id,
    name: row.name,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    status: row.status,
    self_review_opens_at: iso(row.self_review_opens_at),
    closes_at: iso(row.closes_at),
    questions: await repo.questions(client, row.performance_cycle_id),
    reviews: row.reviews,
    closed_reviews: row.closed_reviews,
    created_at: iso(row.created_at),
  };
}

async function listCycles(query) {
  const page = await repo.listCycles(pool, query);
  const data = [];
  for (const row of page.data) data.push(await toCycle(pool, row));
  return { ...page, data };
}

/** Open a cycle now: its reviews, its status, one event. */
async function open(client, cycleId, actor, today = lagos.today()) {
  const cycle = await repo.getCycle(client, cycleId, { lock: true });
  if (!cycle || (cycle.status !== "scheduled" && cycle.status !== "draft")) return 0;
  const made = await cycleOpen.populate(client, cycle, today);
  await repo.setCycleStatus(client, cycleId, "open");
  await emit(client, {
    key: EVENTS.REVIEW_CYCLE_OPENED,
    entity: { type: "performance_cycle", id: cycleId },
    actor,
    payload: { performance_cycle_id: cycleId, name: cycle.name, reviews: made },
  });
  return made;
}

async function createCycle(actor, body) {
  const today = lagos.today();
  if (body.closes_on < today) throw new AppError("VALIDATION_FAILED", "Closes in the past", 422, { closes_on: ["In the past"] });
  const id = await tx(async (client) => {
    const questions = body.questions && body.questions.length ? body.questions : await repo.lastQuestions(client);
    const cycleId = await repo.insertCycle(client, {
      name: body.name,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      status: "scheduled",
      opens_at: lagos.instant(body.opens_on, "06:00"),
      closes_at: lagos.instant(body.closes_on, "17:00"),
      opened_by: actor.user_id,
      questions,
    });
    if (body.opens_on <= today) await open(client, cycleId, actor, today);
    return cycleId;
  });
  return toCycle(pool, await repo.getCycle(pool, id));
}

async function closeCycle(actor, id) {
  await tx(async (client) => {
    const cycle = await repo.getCycle(client, id, { lock: true });
    if (!cycle) throw new AppError("NOT_FOUND", "That cycle does not exist", 404);
    if (cycle.status === "closed") throw conflict("CYCLE_CLOSED", "This cycle is already closed");
    await repo.setCycleStatus(client, id, "closed");
    await emit(client, {
      key: EVENTS.REVIEW_CYCLE_CLOSED,
      entity: { type: "performance_cycle", id },
      actor,
      before: { status: cycle.status },
      after: { status: "closed" },
      payload: { performance_cycle_id: id, name: cycle.name },
    });
  });
  return toCycle(pool, await repo.getCycle(pool, id));
}

/** The 06:00 job: open every scheduled cycle whose day has come. */
async function openDue(now = new Date()) {
  const ids = await repo.cyclesDue(pool, now);
  let opened = 0;
  for (const id of ids) {
    await tx(async (client) => {
      if (await open(client, id, null, lagos.today(now))) opened += 1;
    });
  }
  return { opened };
}

/* ------------------------------------------------------------------ *
 * Reading a review
 * ------------------------------------------------------------------ */

/** A review's halves as the contract's ReviewForm. `prefill` fills the manager's KPI ratings. */
async function toForm(client, review, { prefill = false, cal }) {
  const today = lagos.today();
  const rows = await repo.items(client, review.performance_review_id);
  const answers = await repo.answers(client, review);
  return {
    performance_review_id: review.performance_review_id,
    review_type: review.review_type,
    reviewer: review.reviewer,
    status: review.status,
    overall_score: review.overall_score === null ? null : Math.round(review.overall_score),
    summary: review.summary,
    items: rows.map((r) => {
      const att = score.COUNTED.includes(r.kpi_status) ? score.attainment(r) : null;
      const { first, last } = score.monthRange(r.month);
      return {
        employee_target_id: r.employee_target_id,
        title: r.title,
        weight: r.weight,
        target_value: r.target_value,
        actual_value: r.actual_value,
        attainment: att === null ? null : Math.round(att * 10000) / 10000,
        progress_status: score.statusOf(att, score.elapsed(first, last, today, cal)),
        score: r.score !== null ? r.score : prefill ? score.ratingOf(att) : null,
        comment: r.comment,
      };
    }),
    answers: answers.map((a) => ({
      performance_cycle_question_id: a.performance_cycle_question_id,
      prompt: a.prompt,
      answer_text: a.answer_text,
      dictated: Boolean(a.dictation_document_id),
    })),
    submitted_at: iso(review.submitted_at),
  };
}

/** Where a manager review's approval stands, for its screen. */
async function approvalOf(client, review, actor) {
  const workflow = require("../workflow/workflow.service");
  const v = review.workflow_instance_id ? await workflow.approvalOf(client, review.workflow_instance_id, actor) : null;
  return v || { route: [], decisions: [], can_decide: false, state: null };
}

/**
 * The review as the caller may see it. A reviewer sees their own half and, for a manager
 * review, the self review beside it once it is in; the employee sees their self review and,
 * once closed, the manager's; the second level, Operations & People and the CEO read both.
 */
async function detail(id, actor, client = pool) {
  const review = await repo.getReview(client, id);
  if (!review) throw notFound();
  let standing = await sequence.standing(client, review, actor);
  const other = await repo.counterpart(client, review);
  // A manager reads the self review they are answering, once it is in.
  if (!standing && review.review_type === "self" && other && other.reviewer_employee_id === actor.employee_id)
    standing = review.submitted_at ? "reader" : null;
  if (!standing) throw notFound();

  const cal = await workingWeek.loadCalendar(client);
  const cycle = await toCycle(client, await repo.getCycle(client, review.performance_cycle_id));
  const view = await approvalOf(client, review, actor);
  const isManagerReview = review.review_type !== "self";
  const selfIn = isManagerReview ? Boolean(other && other.submitted_at) : Boolean(review.submitted_at);

  let form = null;
  let beside = null;
  let waiting = false;
  if (isManagerReview) {
    if (standing === "employee") {
      form = review.status === "closed" ? await toForm(client, review, { cal }) : null;
    } else if (!selfIn && standing === "reviewer") {
      waiting = true;
    } else {
      form = await toForm(client, review, { prefill: standing === "reviewer" && EDITABLE.has(review.status), cal });
      beside = other && other.submitted_at ? await toForm(client, other, { cal }) : null;
    }
  } else {
    form = await toForm(client, review, { cal });
    const manager = other;
    const managerReadable = manager && (standing !== "employee" || manager.status === "closed") && manager.submitted_at;
    beside = managerReadable ? await toForm(client, manager, { cal }) : null;
  }

  const mine = standing === "reviewer";
  return {
    performance_review_id: review.performance_review_id,
    cycle,
    employee: review.employee,
    review_type: review.review_type,
    status: review.status,
    form,
    other: beside,
    waiting_for_self: waiting,
    route: view.route,
    decisions: view.decisions,
    // Once closed, everyone who reads the review reads its PDF, the employee included.
    document:
      review.status === "closed"
        ? await repo.documentRef(client, isManagerReview ? review.document_id : other && other.document_id)
        : null,
    can_edit: mine && EDITABLE.has(review.status) && cycle.status === "open" && (!isManagerReview || selfIn),
    can_submit: mine && EDITABLE.has(review.status) && cycle.status === "open" && (!isManagerReview || selfIn),
    can_decide: review.status !== "closed" && Boolean(view.can_decide),
  };
}

/* ------------------------------------------------------------------ *
 * Lists
 * ------------------------------------------------------------------ */

const STAGE_NAMES = { second_level: "Second Level", operations_people: "Operations & People" };

async function list(query, scope, actor) {
  const page = await repo.listReviews(pool, query, scope);
  return {
    ...page,
    data: page.data.map((r) => {
      const own = actor && actor.employee_id === r.employee_id && r.review_type !== "self";
      return {
        performance_review_id: r.performance_review_id,
        performance_cycle_id: r.performance_cycle_id,
        cycle: r.cycle,
        employee: r.employee,
        reviewer: r.reviewer,
        review_type: r.review_type,
        status: r.status,
        self_rating: r.review_type === "self" ? (r.submitted_at ? r.overall_score : null) : r.self_rating,
        manager_rating:
          r.review_type === "self" || !r.submitted_at || (own && r.status !== "closed") ? null : r.overall_score,
        waiting_on: r.current_stage ? STAGE_NAMES[r.current_stage] || null : null,
        submitted_at: iso(r.submitted_at),
        closes_at: iso(r.closes_at),
      };
    }),
  };
}

async function summary(scope) {
  const current = await repo.currentCycle(pool);
  if (!current)
    return { cycle: null, last_cycle: null, average_rating: null, self_done: 0, manager_done: 0, closed: 0, total: 0 };
  const f = await repo.cycleFigures(pool, current.performance_cycle_id, scope);
  const { rows } = await pool.query(
    `SELECT name FROM performance_cycle WHERE starts_on < $1::date AND status = 'closed'
      ORDER BY starts_on DESC LIMIT 1`,
    [current.starts_on],
  );
  return {
    cycle: await toCycle(pool, current),
    last_cycle: rows[0] ? rows[0].name : null,
    average_rating: f.average_rating === null ? null : Math.round(f.average_rating * 100) / 100,
    self_done: f.self_done,
    manager_done: f.manager_done,
    closed: f.closed,
    total: f.total,
  };
}

/* ------------------------------------------------------------------ *
 * Writing a review
 * ------------------------------------------------------------------ */

/** Load a review for its reviewer to change, or say why not. */
async function forReviewer(client, id, actor) {
  const review = await repo.getReview(client, id, { lock: true });
  if (!review) throw notFound();
  if (review.reviewer_employee_id !== actor.employee_id) {
    if (await sequence.standing(client, review, actor)) throw new AppError("PERMISSION_DENIED", "Only its reviewer writes this review", 403);
    throw notFound();
  }
  const cycle = await repo.getCycle(client, review.performance_cycle_id);
  if (cycle.status !== "open") throw conflict("CYCLE_NOT_OPEN", "This cycle is not open");
  if (!EDITABLE.has(review.status)) throw conflict("REVIEW_NOT_EDITABLE", "This review is already handed in");
  if (review.review_type !== "self") {
    const self = await repo.counterpart(client, review);
    if (self && !self.submitted_at) throw sequence.selfFirst();
  }
  return review;
}

const payloadOf = (review, extra = {}) => ({
  performance_review_id: review.performance_review_id,
  performance_cycle_id: review.performance_cycle_id,
  cycle: review.cycle,
  employee_id: review.employee_id,
  subject_employee_id: review.employee_id,
  employee_name: review.employee ? review.employee.display_name : null,
  reviewer_employee_id: review.reviewer_employee_id,
  review_type: review.review_type,
  ...extra,
});

async function write(client, review, body) {
  await repo.saveHeader(client, review.performance_review_id, body);
  for (const item of body.items || []) {
    if (!(await repo.saveItem(client, review.performance_review_id, item)))
      throw new AppError("VALIDATION_FAILED", "Not a KPI on this review", 422, { items: ["Not on this review"] });
  }
  const questionIds = new Set((await repo.answers(client, review)).map((a) => a.performance_cycle_question_id));
  for (const answer of body.answers || []) {
    if (!questionIds.has(answer.performance_cycle_question_id))
      throw new AppError("VALIDATION_FAILED", "Not a question of this cycle", 422, { answers: ["Not in this cycle"] });
    await repo.saveAnswer(client, review.performance_review_id, answer);
  }
}

async function save(id, actor, body) {
  await tx(async (client) => {
    const review = await forReviewer(client, id, actor);
    await write(client, review, body);
    await emit(client, {
      key: EVENTS.REVIEW_SAVED,
      entity: { type: "review", id },
      actor,
      payload: payloadOf(review),
    });
  });
  return detail(id, actor);
}

async function submit(id, actor) {
  await tx(async (client) => {
    const review = await forReviewer(client, id, actor);
    const form = await toForm(client, review, { prefill: review.review_type !== "self", cal: await workingWeek.loadCalendar(client) });
    if (!review.overall_score)
      throw new AppError("VALIDATION_FAILED", "Give an overall rating", 422, { overall_score: ["Required"] });

    if (review.review_type === "self") {
      await repo.setReview(client, id, { status: "submitted", submitted: true });
      const manager = await repo.counterpart(client, review);
      await emit(client, {
        key: EVENTS.REVIEW_SELF_SUBMITTED,
        entity: { type: "review", id },
        actor,
        before: { status: review.status },
        after: { status: "submitted" },
        payload: payloadOf(review, { manager_reviewer_id: manager ? manager.reviewer_employee_id : null }),
      });
      return;
    }

    // The manager's prefilled ratings are kept as they stood when handed in.
    for (const item of form.items) {
      if (item.score !== null) await repo.saveItem(client, id, { employee_target_id: item.employee_target_id, score: item.score, comment: item.comment });
    }
    const instance = await engine.openInstance(client, {
      definition_key: DEFINITION_KEY,
      entity: { type: "review", id },
      subject_employee_id: review.reviewer_employee_id,
      context: {},
      actor,
    });
    const status = statusOf(instance);
    await repo.setReview(client, id, {
      status,
      submitted: true,
      closed: status === "closed",
      workflowInstanceId: instance.workflow_instance_id,
    });
    await emit(client, {
      key: EVENTS.REVIEW_SUBMITTED,
      entity: { type: "review", id },
      actor,
      before: { status: review.status },
      after: { status },
      payload: payloadOf(review),
    });
    if (status === "closed") await closed(client, review, actor);
  });
  return detail(id, actor);
}

/** A manager review's status from where its approval stands. */
function statusOf(instance) {
  if (!instance) return null;
  if (instance.state === "pending") return instance.current_stage === "operations_people" ? "with_hr" : "second_level";
  if (instance.state === "approved" || instance.state === "timeout_approved") return "closed";
  if (instance.state === "rejected" || instance.state === "timeout_rejected") return "returned";
  if (instance.state === "cancelled") return "draft";
  return null;
}

/** HR has it: the review closes, the self review with it, and the employee hears. */
async function closed(client, review, actor) {
  await repo.setReview(client, review.performance_review_id, { status: "closed", closed: true });
  const self = await repo.counterpart(client, review);
  if (self) await repo.setReview(client, self.performance_review_id, { status: "closed", closed: true });
  await emit(client, {
    key: EVENTS.REVIEW_CLOSED,
    entity: { type: "review", id: review.performance_review_id },
    actor,
    payload: payloadOf(review),
  });
}

async function decide(id, actor, { decision, reason = null }) {
  await tx(async (client) => {
    const review = await repo.getReview(client, id, { lock: true });
    if (!review) throw notFound();
    if (!review.workflow_instance_id || !["second_level", "with_hr"].includes(review.status))
      throw conflict("REVIEW_NOT_PENDING", "This review is not waiting for approval");
    const instance = await engine.act(client, {
      instance_id: review.workflow_instance_id,
      actor,
      decision: decision === "return" ? "reject" : "approve",
      reason,
    });
    await apply(client, review, instance, actor, reason);
  });
  return detail(id, actor);
}

/** Write what the approval's state means; idempotent. */
async function apply(client, review, instance, actor, reason = null) {
  const status = statusOf(instance);
  if (!status || status === review.status) return;
  if (status === "closed") return closed(client, review, actor);
  await repo.setReview(client, review.performance_review_id, { status });
  await emit(client, {
    key: status === "returned" ? EVENTS.REVIEW_RETURNED : EVENTS.REVIEW_DECIDED,
    entity: { type: "review", id: review.performance_review_id },
    actor,
    before: { status: review.status },
    after: { status },
    payload: payloadOf(review, { reason }),
  });
}

/** The approval moved away from the review's screen (a timeout, My Approvals): catch up. */
async function settle(id) {
  await tx(async (client) => {
    const review = await repo.getReview(client, id, { lock: true });
    if (!review || !review.workflow_instance_id || review.status === "closed") return;
    const instance = await engine.getInstance(client, review.workflow_instance_id);
    await apply(client, review, instance, null);
  });
}

/* ------------------------------------------------------------------ *
 * Reminders
 * ------------------------------------------------------------------ */

async function remind(now = new Date()) {
  const cal = await workingWeek.loadCalendar(pool);
  const today = lagos.today(now);
  if (!workingWeek.isWorkingDay(today, cal)) return { reminded: 0 };
  const until = lagos.instant(lagos.addDays(today, REMIND_WITHIN_DAYS), "23:59");
  const due = await repo.dueReviews(pool, until);
  await tx(async (client) => {
    for (const r of due) {
      await emit(client, {
        key: EVENTS.REVIEW_REMINDER,
        entity: { type: "review", id: r.performance_review_id },
        actor: null,
        payload: {
          performance_review_id: r.performance_review_id,
          reviewer_employee_id: r.reviewer_employee_id,
          review_type: r.review_type,
          cycle: r.cycle,
          employee_name: r.employee_name,
          overdue: new Date(r.closes_at) < now,
        },
      });
    }
  });
  return { reminded: due.length };
}

/* ------------------------------------------------------------------ *
 * Analytics
 * ------------------------------------------------------------------ */

async function analytics(query, scope) {
  const goals = require("../goals/goals.service");
  const cycle = query.performance_cycle_id
    ? await repo.getCycle(pool, query.performance_cycle_id)
    : await repo.currentCycle(pool);
  const year = query.year || (cycle ? Number(cycle.starts_on.slice(0, 4)) : Number(lagos.today().slice(0, 4)));
  const goalFigures = await goals.summary({ year });
  const r = cycle
    ? await metrics.ratings(pool, cycle.performance_cycle_id, scope)
    : { total: 0, closed: 0, self: null, manager: null, gap: [] };
  return {
    cycle: cycle ? cycle.name : null,
    year,
    goals_on_track: goalFigures.on_track,
    goals_total: goalFigures.progress.length,
    reviews_completed: r.closed,
    reviews_total: r.total,
    average_self: r.self,
    average_manager: r.manager,
    completion: await metrics.completion(pool, year, scope),
    by_department: await metrics.byDepartment(pool, year, scope),
    gap: r.gap,
  };
}

/* ------------------------------------------------------------------ *
 * The employee's own review (ESS · My Performance)
 * ------------------------------------------------------------------ */

async function openSelf(actor) {
  const id = await repo.openSelfReview(pool, actor.employee_id);
  return id ? detail(id, actor) : null;
}

async function ownOpenId(actor) {
  const id = await repo.openSelfReview(pool, actor.employee_id);
  if (!id) throw new AppError("NO_OPEN_REVIEW", "No review is open for you", 404);
  return id;
}

module.exports = {
  listCycles,
  createCycle,
  closeCycle,
  openDue,
  detail,
  list,
  summary,
  save,
  submit,
  decide,
  settle,
  remind,
  analytics,
  forReviewer,
  openSelf,
  ownOpenId,
  toCycle,
};
