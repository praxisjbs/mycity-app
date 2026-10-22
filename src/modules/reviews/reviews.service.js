"use strict";
/**
 * Monthly and probation reviews: the one write path for a check-in, the reviewer's scores and the
 * review's way through its chain (docs/guides/performance.md §3.3, §6.9, §6.10, §6.12 to §6.16).
 *
 *   check_in     the employee enters each line's actual, evidence and action; the system proposes
 *                each score and fills the automatic lines; the employee may change a proposed
 *                score with a reason. Submit Check-In sends it to the reviewer (A17)
 *   with_reviewer  the reviewer sets each final score (a reason where it differs from the proposed,
 *                or where a line could not be assessed), a corrective action for each missed line,
 *                a comment; may return the check-in, or ask the dotted manager for input. Submit
 *                Review opens `performance.review`: the reviewer's own line manager, unless the
 *                reviewer is the CEO, then Operations & People; the reviewee decides no stage
 *   closed       Operations & People's approval closes it: the month's score, the score to date and
 *                the rating (capped at Partly Meets by a conduct breach) are written to the review
 *                and its scorecard, the PDF is made, the employee is told. A probation review's
 *                outcome is applied through organisation.service
 *
 * A line is "missed" in a month when its final score is under 1 and the month is its last chance:
 * a milestone, standard or binary line every month, a numeric (Results) line in the quarter's last
 * month only, because October and November are progress against the quarter (P3). The CEO's own
 * review (the Board's) closes on the CEO's check-in, scored on their own figures.
 *
 * Two ways a review leaves the usual path (§11). Once the check-in's due date has passed and it is
 * not in, the reviewer may Score Without Check-In, with a reason: the employee is told, their own
 * lines are Not Assessable (their drafts stay theirs) and Monthly Update On Time scores 0. And a
 * review ends Withdrawn at HR's stage, without a score: when its person leaves (People archive
 * them, or on their leaving date when it is still ahead, through the reminder engine), which also
 * closes their scorecard, or when Operations & People withdraw it with a reason.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const routeMap = require("../../shared/route-map");
const lagos = require("../../shared/time/lagos");
const { formatDate } = require("../../shared/time/day-first");
const workingWeek = require("../../shared/time/working-week");
const workflow = require("../../shared/workflow/engine");
const approvers = require("../../shared/workflow/approvers");
const vault = require("../../shared/documents/vault");
const { scoring } = require("@mycity/contract");
const reminders = require("../notifications/notifications.reminders");
const targetsRepo = require("../targets/targets.repo");
const progress = require("../targets/targets.progress");
const cycle = require("./reviews.cycle");
const sequence = require("./reviews.sequence");
const pdf = require("./reviews.pdf");
const repo = require("./reviews.repo");
const { EVENTS, REVIEW_FLOW, CHECK_IN_REMINDER, REVIEW_REMINDER, CLOSE_REMINDER, LEAVER_REMINDER } = require("./reviews.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);
const invalid = (fields, message = "Check the highlighted lines") => new AppError("VALIDATION_FAILED", message, 422, fields);
const ALL = Object.freeze({ scope: "all", scope_ids: null });

/** The month a review is about: its round's, or for a probation review the month it opened in. */
const monthOfReview = (r) => day(r.month) || `${lagos.dateOf(r.created_at ? new Date(r.created_at) : new Date()).slice(0, 7)}-01`;

/** The quarter's rules a review is scored by. */
const rulesOf = (r) => cycle.rulesOf({ rules: r.rules });

/** The person's check-in deadline: a function head's falls on the later day (§6.2). */
const checkInDueOf = (r) => day(r.is_head ? r.head_check_in_due_on : r.check_in_due_on);

/** Has a review's check-in deadline ended (Lagos) with the check-in still not in (§11)? */
const checkInLate = (r, now = new Date()) =>
  r.status === "check_in" && Boolean(checkInDueOf(r)) && now >= lagos.endOfDayExclusive(checkInDueOf(r));

/* ------------------------------------------------------------------ *
 * Views
 * ------------------------------------------------------------------ */

function reviewView(r) {
  return {
    performance_review_id: r.performance_review_id,
    performance_cycle_id: r.performance_cycle_id,
    round_name: r.round_name,
    month: day(r.month),
    scorecard_id: r.scorecard_id,
    review_kind: r.review_kind,
    review_type: r.review_type,
    status: r.status,
    employee: r.employee,
    reviewer: r.reviewer,
    check_in_submitted_at: iso(r.check_in_submitted_at),
    submitted_at: iso(r.submitted_at),
    closed_at: iso(r.closed_at),
    score_month: r.score_month,
    score_to_date: r.score_to_date,
    rating: r.rating,
    due_on: day(r.due_on),
    waiting_on_me: Boolean(r.waiting_on_me),
  };
}

function itemView(i) {
  return {
    performance_review_item_id: i.performance_review_item_id,
    employee_target_id: i.employee_target_id,
    criterion: i.criterion,
    line: i.line,
    actual_value: i.actual_value,
    actual_text: i.actual_text,
    achieved_on: day(i.achieved_on),
    evidence_kind: i.evidence_kind,
    evidence_entity_type: i.evidence_entity_type,
    evidence_entity_id: i.evidence_entity_id,
    evidence_document_id: i.evidence_document_id,
    evidence_url: i.evidence_url,
    evidence_note: i.evidence_note,
    evidence_link: i.evidence_entity_type ? routeMap.linkFor(i.evidence_entity_type, i.evidence_entity_id) : null,
    action_text: i.action_text,
    action_transcript: i.action_transcript,
    action_document_id: i.action_document_id,
    proposed_score: i.proposed_score,
    self_score: i.self_score,
    self_reason: i.self_reason,
    score: i.score,
    override_reason: i.override_reason,
    comment: i.comment,
    assessable: Boolean(i.assessable),
    auto: Boolean(i.auto),
  };
}

const taskView = (t) => ({
  task_id: t.task_id,
  number: t.number,
  title: t.title,
  status: t.status,
  due_at: iso(t.due_at),
  completed_at: iso(t.completed_at),
  employee_target_id: t.employee_target_id,
  bucket: t.bucket,
});

/** The month's tasks of the review's employee, each bucket's first 25 and its total. */
async function tasksOf(db, r) {
  const { first, from, to } = progress.monthOf(monthOfReview(r));
  const next = lagos.monthBounds(lagos.addMonths(first, 1)).last;
  const m = { from, to, next_to: lagos.endOfDayExclusive(next) };
  // One after another: `db` may be the closing transaction's client.
  const done = await repo.taskBucket(db, r.employee_id, "done", m);
  const ongoing = await repo.taskBucket(db, r.employee_id, "ongoing", m);
  const nextMonth = await repo.taskBucket(db, r.employee_id, "next_month", m);
  return {
    tasks: [...done.data, ...ongoing.data, ...nextMonth.data].map(taskView),
    task_counts: { done: done.page.total, ongoing: ongoing.page.total, next_month: nextMonth.page.total },
  };
}

/** The month around the review (G6): attendance from the shared roster and recognitions received. */
async function contextOf(db, r) {
  const m = progress.monthOf(monthOfReview(r));
  const today = lagos.today();
  const roster = require("../attendance/attendance.roster");
  let totals = { on_time: 0, late: 0, absent: 0 };
  if (m.first <= today) {
    const p = await roster.personal(db, { employee_id: r.employee_id, from: m.first, to: m.last < today ? m.last : today, today });
    totals = p.totals;
  }
  return { on_time: totals.on_time, late: totals.late, absent: totals.absent, recognitions: await repo.recognitions(db, r.employee_id, m) };
}

const actionsOf = (items) =>
  items
    .filter((i) => i.corrective_title && i.corrective_owner)
    .map((i) => ({
      performance_review_item_id: i.performance_review_item_id,
      title: i.corrective_title,
      owner: i.corrective_owner,
      due_on: day(i.corrective_due_on),
      task_id: i.corrective_task_id,
      task_number: i.task_number,
      task_status: i.task_status,
    }));

/** The review's chain: Check-In, Reviewer, Second Level, HR, each done, current, waiting or skipped. */
function chainOf(r, decisions) {
  const lastApproval = (stage) => [...decisions].reverse().find((d) => d.stage_key === stage && d.decision === "approve") || null;
  const order = ["check_in", "with_reviewer", "second_level", "with_hr", "closed"];
  const at = r.status === "returned" ? 1 : order.indexOf(r.status);
  const second = lastApproval("second_level");
  const hr = lastApproval("operations_people");
  const selfReview = r.review_type === "self";
  const skipSecond = selfReview || (r.submitted_at && !r.second_level_employee_id);
  // Withdrawn ends at HR's stage: the steps that happened stay done, the rest are skipped.
  const withdrawn = r.status === "withdrawn";
  const state = (i, happened) => (withdrawn ? (happened ? "done" : "skipped") : at > i ? "done" : at === i ? "current" : "waiting");
  return [
    { key: "check_in", state: state(0, Boolean(r.check_in_submitted_at)), person: r.employee.display_name, at: iso(r.check_in_submitted_at) },
    { key: "reviewer", state: selfReview ? "skipped" : state(1, Boolean(r.submitted_at)), person: r.reviewer.display_name, at: iso(r.submitted_at) },
    {
      key: "second_level",
      state: skipSecond ? "skipped" : state(2, Boolean(second)),
      person: second ? second.name : r.second_level ? r.second_level.display_name : null,
      at: second ? iso(second.decided_at) : null,
    },
    {
      key: "hr",
      state: selfReview && !withdrawn ? "skipped" : state(3, true),
      person: hr ? hr.name : "Operations & People",
      at: withdrawn ? iso(r.withdrawn_at) : hr ? iso(hr.decided_at) : null,
    },
  ];
}

/**
 * A review as one reader may see it (ReviewDetail): only the parts §6.12 allows them, and what
 * they may do now.
 */
async function detail(db, r, actor, roles) {
  const parts = sequence.partsFor(r, roles);
  const rows = await repo.items(db, r.performance_review_id);
  const [month, decisions, pip, instance] = await Promise.all([
    parts.check_in ? tasksOf(db, r) : Promise.resolve({ tasks: [], task_counts: { done: 0, ongoing: 0, next_month: 0 } }),
    repo.decisions(db, r.performance_review_id),
    repo.pipOfReview(db, r.performance_review_id),
    r.workflow_instance_id ? workflow.getInstance(db, r.workflow_instance_id).catch(() => null) : Promise.resolve(null),
  ]);
  const decide =
    Boolean(instance && instance.state === "pending") && (await approvers.canAct(db, instance.stage_approvers, actor, instance));
  return {
    ...reviewView(r),
    dotted: r.dotted,
    second_level: r.second_level,
    dotted_input: parts.input ? r.dotted_input : null,
    dotted_input_at: parts.input ? iso(r.dotted_input_at) : null,
    conduct_breach: parts.conduct ? Boolean(r.conduct_breach) : false,
    conduct_note: parts.conduct ? r.conduct_note : null,
    probation_outcome: r.probation_outcome,
    returned_reason: roles.named ? r.returned_reason : null,
    no_check_in_at: iso(r.no_check_in_at),
    no_check_in_reason: roles.named ? r.no_check_in_reason : null,
    withdrawn_at: iso(r.withdrawn_at),
    withdrawn_reason: roles.named ? r.withdrawn_reason : null,
    document_id: r.status === "closed" && (roles.named || roles.in_scope) ? r.document_id : null,
    workflow_instance_id: r.workflow_instance_id,
    items: rows.map((i) => sequence.itemFor(itemView(i), parts)),
    tasks: month.tasks,
    task_counts: month.task_counts,
    actions: parts.reviewer_notes ? actionsOf(rows) : [],
    chain: chainOf(r, decisions),
    context: parts.context ? await contextOf(db, r) : null,
    improvement_plan_id: pip && (roles.full || roles.employee || roles.reviewer) ? pip.improvement_plan_id : null,
    can: sequence.allowed(r, roles, { decide, has_pip: Boolean(pip), late: checkInLate(r) }),
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

const roleCodes = (actor) => repo.roleCodesOfUser(pool, actor && actor.user_id);

/** GET /performance/reviews */
async function list(actor, query, scope) {
  const page = await repo.list(pool, query, scope, actor || {}, await roleCodes(actor));
  return { ...page, data: page.data.map(reviewView) };
}

/** Load a review and who the reader is to it, refusing what they may not open. */
async function loadFor(db, id, actor, scope) {
  const r = await repo.get(db, id, actor, await repo.roleCodesOfUser(db, actor && actor.user_id));
  if (!r) throw sequence.notFound();
  const roles = await sequence.rolesOf(db, r, actor, scope);
  sequence.assertMayRead(r, roles, { late: checkInLate(r) });
  return { r, roles };
}

/** GET /performance/reviews/:id */
async function get(actor, scope, id) {
  const { r, roles } = await loadFor(pool, id, actor, scope);
  return detail(pool, r, actor, roles);
}

/* ------------------------------------------------------------------ *
 * Proposed scores and the automatic lines
 * ------------------------------------------------------------------ */

/**
 * Work out each item's proposed score and the automatic lines' figures, and store them.
 * In the caller's transaction. `now` is when the check-in is being judged (its submit).
 */
async function refreshScores(client, r, { now = new Date(), submittedAt = r.check_in_submitted_at } = {}) {
  const rows = await repo.items(client, r.performance_review_id);
  const rules = rulesOf(r);
  const cal = await workingWeek.loadCalendar(client);
  const month = monthOfReview(r);
  const lines = r.scorecard_id ? await targetsRepo.lines(client, r.scorecard_id) : [];
  const auto = await progress.automatic(
    client,
    { ...r, month, check_in_due: checkInDueOf(r), check_in_submitted_at: submittedAt },
    lines,
    { rules, now },
  );
  for (const i of rows) {
    if (!i.employee_target_id) continue;
    const figures = auto.get(i.employee_target_id);
    if (figures) {
      await repo.updateItem(client, i.performance_review_item_id, { ...figures, assessable: true, auto: true });
      continue;
    }
    // Scored without the check-in (§11): the employee's own lines had no check-in to assess.
    const p = r.no_check_in_at ? { proposed_score: null, assessable: false } : progress.proposeOwn(i, i, { rules, cal, month, now });
    await repo.updateItem(client, i.performance_review_item_id, { ...p, auto: false });
  }
}

/** The figures an automatic line reads, without storing them: an open check-in as it would score now. */
async function withLiveFigures(db, r, items) {
  if (r.status !== "check_in" || !r.scorecard_id) return items;
  const lines = await targetsRepo.lines(db, r.scorecard_id);
  const auto = await progress.automatic(db, { ...r, month: monthOfReview(r), check_in_due: checkInDueOf(r) }, lines, { rules: rulesOf(r) });
  return items.map((i) => {
    const f = i.employee_target_id ? auto.get(i.employee_target_id) : null;
    return f ? { ...i, ...f, assessable: true, auto: true } : i;
  });
}

/* ------------------------------------------------------------------ *
 * The check-in (ESS · My Performance)
 * ------------------------------------------------------------------ */

const NO_CHECK_IN = () => new AppError("NO_OPEN_CHECK_IN", "No check-in is open", 404);

/** The caller's open review and their own view of it. */
async function myOpen(db, actor) {
  if (!actor || !actor.employee_id) throw NO_CHECK_IN();
  const r = await repo.openOfEmployee(db, actor.employee_id);
  if (!r) throw NO_CHECK_IN();
  return r;
}

async function checkInView(db, r) {
  const roles = { employee: true, named: true };
  const parts = sequence.partsFor(r, roles);
  const items = await withLiveFigures(db, r, await repo.items(db, r.performance_review_id));
  const month = await tasksOf(db, r);
  return {
    performance_review_id: r.performance_review_id,
    round_name: r.round_name,
    month: day(r.month),
    due_on: checkInDueOf(r),
    status: r.status,
    check_in_submitted_at: iso(r.check_in_submitted_at),
    returned_reason: r.status === "check_in" ? r.returned_reason : null,
    reviewer: r.reviewer,
    items: items.map((i) => sequence.itemFor(itemView(i), parts)),
    tasks: month.tasks,
    task_counts: month.task_counts,
  };
}

/** GET /ess/performance/check-in */
async function myCheckIn(actor) {
  return checkInView(pool, await myOpen(pool, actor));
}

/** One item's evidence, checked: a record the route map opens, a file of this check-in, a link or a note. */
async function evidenceOf(db, r, save, held, at) {
  const kind = save.evidence_kind !== undefined ? save.evidence_kind : held.evidence_kind;
  const out = {
    evidence_kind: kind || null,
    evidence_entity_type: null,
    evidence_entity_id: null,
    evidence_document_id: null,
    evidence_url: null,
    evidence_note: null,
  };
  if (!kind) return out;
  const value = (k) => (save[k] !== undefined ? save[k] : held[k]) || null;
  const problems = {};
  if (kind === "record") {
    out.evidence_entity_type = value("evidence_entity_type");
    out.evidence_entity_id = value("evidence_entity_id");
    if (!out.evidence_entity_type || !routeMap.hasRoute(out.evidence_entity_type) || !out.evidence_entity_id)
      problems[`${at}.evidence_entity_id`] = ["Pick a record"];
  } else if (kind === "document") {
    out.evidence_document_id = value("evidence_document_id");
    const doc = out.evidence_document_id
      ? (await db.query("SELECT entity_type, entity_id FROM document WHERE document_id = $1", [out.evidence_document_id])).rows[0]
      : null;
    if (!doc || doc.entity_type !== "performance_review" || doc.entity_id !== r.performance_review_id)
      problems[`${at}.evidence_document_id`] = ["Add the file"];
  } else if (kind === "link") {
    out.evidence_url = value("evidence_url");
    if (!out.evidence_url) problems[`${at}.evidence_url`] = ["Add the link"];
  } else if (kind === "note") {
    out.evidence_note = value("evidence_note");
    if (!out.evidence_note) problems[`${at}.evidence_note`] = ["Name the source"];
  }
  if (Object.keys(problems).length) throw invalid(problems);
  return out;
}

/** PUT /ess/performance/check-in: Save Draft. */
async function saveCheckIn(actor, body) {
  const r0 = await myOpen(pool, actor);
  const id = r0.performance_review_id;
  await tx(async (client) => {
    await repo.lock(client, id);
    const r = await repo.get(client, id);
    if (r.status !== "check_in") throw new AppError("CHECK_IN_SENT", "Your check-in is already sent", 409);
    const held = new Map((await repo.items(client, id)).map((i) => [i.performance_review_item_id, i]));
    const rules = rulesOf(r);
    const cal = await workingWeek.loadCalendar(client);
    const month = monthOfReview(r);
    const problems = {};
    for (const [n, save] of body.items.entries()) {
      const at = `items.${n}`;
      const item = held.get(save.performance_review_item_id);
      if (!item) throw invalid({ [`${at}.performance_review_item_id`]: ["Not this check-in's"] });
      const patch = {};
      for (const k of ["actual_value", "actual_text", "achieved_on", "action_text", "action_transcript", "action_document_id", "action_ai_run_id", "self_score", "self_reason"])
        if (save[k] !== undefined) patch[k] = save[k];
      if (!item.auto) Object.assign(patch, await evidenceOf(client, r, save, item, at));
      const next = { ...item, ...patch };
      if (item.employee_target_id && !item.auto) Object.assign(patch, progress.proposeOwn(next, next, { rules, cal, month }));
      if (!item.employee_target_id) {
        patch.assessable = true;
        patch.proposed_score = null;
      }
      const proposed = patch.proposed_score !== undefined ? patch.proposed_score : item.proposed_score;
      const self = next.self_score;
      if (self !== null && self !== undefined && proposed !== null && Number(self) !== Number(proposed) && !next.self_reason)
        problems[`${at}.self_reason`] = ["Give a reason"];
      await repo.updateItem(client, item.performance_review_item_id, patch);
    }
    if (Object.keys(problems).length) throw invalid(problems);
    await emit(client, {
      key: EVENTS.REVIEW_CHECK_IN_SAVED,
      entity: { type: "performance_review", id },
      actor,
      payload: { performance_review_id: id, employee_id: r.employee_id, items: body.items.length },
    });
  });
  return checkInView(pool, await repo.get(pool, id));
}

/** POST /ess/performance/check-in/evidence: a file kept as one line's evidence. */
async function addEvidence(actor, file, body) {
  const r = await myOpen(pool, actor);
  if (r.status !== "check_in") throw new AppError("CHECK_IN_SENT", "Your check-in is already sent", 409);
  const item = (await repo.items(pool, r.performance_review_id)).find((i) => i.performance_review_item_id === body.performance_review_item_id);
  if (!item) throw invalid({ performance_review_item_id: ["Not this check-in's"] });
  return tx(async (client) => {
    const doc = await vault.store(client, {
      file,
      purpose: "performance_evidence",
      doc_type: "performance_evidence",
      entity: { type: "performance_review", id: r.performance_review_id },
      subject_employee_id: r.employee_id,
      sensitivity: "personal",
      actor,
    });
    const next = { ...item, evidence_kind: "document", evidence_document_id: doc.document_id };
    const p = item.employee_target_id
      ? progress.proposeOwn(next, next, { rules: rulesOf(r), cal: await workingWeek.loadCalendar(client), month: monthOfReview(r) })
      : {};
    await repo.updateItem(client, item.performance_review_item_id, {
      evidence_kind: "document",
      evidence_document_id: doc.document_id,
      evidence_entity_type: null,
      evidence_entity_id: null,
      evidence_url: null,
      evidence_note: null,
      ...p,
    });
    await emit(client, {
      key: EVENTS.REVIEW_EVIDENCE_ADDED,
      entity: { type: "performance_review", id: r.performance_review_id },
      actor,
      payload: { performance_review_id: r.performance_review_id, performance_review_item_id: item.performance_review_item_id, document_id: doc.document_id },
    });
    return require("../documents/documents.service").refOf(doc);
  });
}

/** POST /ess/performance/check-in/submit */
async function submitCheckIn(actor) {
  const r0 = await myOpen(pool, actor);
  const id = r0.performance_review_id;
  await tx(async (client) => {
    await repo.lock(client, id);
    const r = await repo.get(client, id);
    if (r.status !== "check_in") throw new AppError("CHECK_IN_SENT", "Your check-in is already sent", 409);
    const now = new Date();
    await refreshScores(client, r, { now, submittedAt: now });
    await reminders.cancel(client, { key: CHECK_IN_REMINDER, entity: { type: "performance_review", id } });
    if (r.review_type === "self") {
      // The CEO's own (the Board's): closed on the check-in, on the CEO's own figures.
      for (const i of await repo.items(client, id))
        await repo.updateItem(client, i.performance_review_item_id, { score: i.self_score ?? i.proposed_score ?? null });
      await repo.update(client, id, { check_in_submitted_at: now, submitted_at: now, returned_reason: null });
      await closeReview(client, await repo.get(client, id), actor);
      return;
    }
    await repo.update(client, id, { status: "with_reviewer", check_in_submitted_at: now, returned_reason: null });
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.REVIEW_CHECK_IN_SUBMITTED,
      entity: { type: "performance_review", id },
      actor,
      payload: {
        performance_review_id: id,
        employee_id: r.employee_id,
        employee_name: r.employee.display_name,
        round_name: r.round_name,
        reviewer_employee_ids: await cycle.reviewerIds(client, r),
      },
    });
    if (r.dotted_employee_id) await askedInput(client, after, actor);
    await cycle.scheduleReview(client, after, await workingWeek.loadCalendar(client), now);
  });
  return checkInView(pool, await repo.get(pool, id));
}

/* ------------------------------------------------------------------ *
 * The reviewer
 * ------------------------------------------------------------------ */

/** Load a review for its reviewer to act on, locked; refuse anyone else and the wrong stage. */
async function forReviewer(client, id, actor, scope) {
  await repo.lock(client, id);
  const { r, roles } = await loadFor(client, id, actor, scope);
  if (!roles.reviewer) throw new AppError("PERMISSION_DENIED", "Only the reviewer can do that", 403);
  // A late check-in is opened, not scored, until the reviewer chooses Score Without Check-In (§11).
  if (r.status === "check_in") throw sequence.checkInFirst();
  if (!sequence.WITH_REVIEWER.includes(r.status)) throw new AppError("REVIEW_NOT_WITH_REVIEWER", "This review is not with its reviewer", 409);
  return { r, roles };
}

/** A role reviewer's first holder to act becomes the review's reviewer (§6.13). */
async function takeReview(client, r, actor) {
  if (r.reviewer_employee_id === actor.employee_id) return r;
  await repo.update(client, r.performance_review_id, { reviewer_employee_id: actor.employee_id });
  return repo.get(client, r.performance_review_id);
}

/** Is an item missed this month: under 1 at its last chance (see the header)? */
function missed(item, r) {
  const s = scoring.num(item.score);
  if (s === null || s >= 1 || !item.employee_target_id) return false;
  if (item.measure !== "numeric") return true;
  const { last } = progress.monthOf(monthOfReview(r));
  return Boolean(r.period_ends_on) && last >= day(r.period_ends_on);
}

/** PUT /performance/reviews/:id/scores */
async function saveScores(actor, scope, id, body) {
  await tx(async (client) => {
    let { r } = await forReviewer(client, id, actor, scope);
    r = await takeReview(client, r, actor);
    const held = new Map((await repo.items(client, id)).map((i) => [i.performance_review_item_id, i]));
    const problems = {};
    for (const [n, save] of body.items.entries()) {
      const item = held.get(save.performance_review_item_id);
      if (!item) throw invalid({ [`items.${n}.performance_review_item_id`]: ["Not this review's"] });
      const differs = save.score !== null && (item.proposed_score === null || Number(save.score) !== Number(item.proposed_score));
      if (differs && !save.override_reason) problems[`items.${n}.override_reason`] = ["Give a reason"];
      await repo.updateItem(client, item.performance_review_item_id, {
        score: save.score,
        override_reason: save.override_reason ?? null,
        comment: save.comment ?? null,
      });
    }
    const acted = new Set();
    for (const [n, a] of body.actions.entries()) {
      const item = held.get(a.performance_review_item_id);
      if (!item) throw invalid({ [`actions.${n}.performance_review_item_id`]: ["Not this review's"] });
      acted.add(item.performance_review_item_id);
      if (item.corrective_task_id) continue;
      await repo.updateItem(client, item.performance_review_item_id, {
        corrective_title: a.title,
        corrective_owner_id: a.owner_employee_id,
        corrective_due_on: a.due_on,
      });
    }
    for (const item of held.values())
      if (!acted.has(item.performance_review_item_id) && item.corrective_title && !item.corrective_task_id)
        await repo.updateItem(client, item.performance_review_item_id, { corrective_title: null, corrective_owner_id: null, corrective_due_on: null });
    if (Object.keys(problems).length) throw invalid(problems);
    await emit(client, {
      key: EVENTS.REVIEW_SCORES_SAVED,
      entity: { type: "performance_review", id },
      actor,
      payload: { performance_review_id: id, employee_id: r.employee_id, items: body.items.length, actions: body.actions.length },
    });
  });
  return get(actor, scope, id);
}

/** POST /performance/reviews/:id/submit: Submit Review, opening `performance.review`. */
async function submit(actor, scope, id) {
  await tx(async (client) => {
    let { r } = await forReviewer(client, id, actor, scope);
    r = await takeReview(client, r, actor);
    await refreshScores(client, r);
    const items = await repo.items(client, id);
    const problems = {};
    for (const [n, i] of items.entries()) {
      // An automatic line with no eligible cases this month is blank, never scored (§6.9).
      const blank = i.auto && i.proposed_score === null;
      if (i.assessable && !blank && i.score === null) problems[`items.${n}.score`] = ["Give a score"];
      if (!i.assessable && i.score !== null && !i.override_reason) problems[`items.${n}.override_reason`] = ["Give a reason"];
    }
    if (Object.keys(problems).length) throw new AppError("SCORES_MISSING", "Score every line first", 422, problems);
    const missing = items.filter((i) => missed(i, r) && !(i.corrective_title && i.corrective_owner_id && i.corrective_due_on));
    if (missing.length)
      throw new AppError(
        "CORRECTIVE_ACTION_REQUIRED",
        "Add a corrective action to each missed line",
        422,
        Object.fromEntries(missing.map((i) => [`actions.${items.indexOf(i)}`, ["Add an action"]])),
      );
    // Each corrective action becomes a task for its owner, pointing at the review (§6.16).
    const tasks = require("../tasks/tasks.service");
    for (const i of items) {
      if (!i.corrective_title || i.corrective_task_id || !i.corrective_owner_id) continue;
      const task = await tasks.create(
        actor,
        ALL,
        {
          title: i.corrective_title.slice(0, 200),
          due_on: day(i.corrective_due_on),
          primary_assignee_id: i.corrective_owner_id,
          employee_target_id: i.corrective_owner_id === r.employee_id ? i.employee_target_id || undefined : undefined,
          entity_type: "performance_review",
          entity_id: id,
        },
        { client },
      );
      await repo.updateItem(client, i.performance_review_item_id, { corrective_task_id: task.task_id });
    }
    const reviewerIsCeo = await repo.isCeoEmployee(client, r.reviewer_employee_id);
    let second = reviewerIsCeo ? null : await repo.effectiveManagerOf(client, r.reviewer_employee_id);
    if (second === r.employee_id) second = null;
    const instance = await workflow.openInstance(client, {
      definition_key: REVIEW_FLOW,
      entity: { type: "performance_review", id },
      subject_employee_id: r.employee_id,
      context: { reviewer_is_ceo: reviewerIsCeo, ...(second ? { second_level_employee_id: second } : {}) },
      actor,
      exclude_employee_ids: [r.employee_id],
    });
    const status = instance.state === "approved" ? "with_hr" : instance.current_stage === "second_level" ? "second_level" : "with_hr";
    await repo.update(client, id, {
      status,
      submitted_at: new Date(),
      returned_reason: null,
      second_level_employee_id: second,
      workflow_instance_id: instance.workflow_instance_id,
    });
    await reminders.cancel(client, { key: REVIEW_REMINDER, entity: { type: "performance_review", id } });
    const after = await repo.get(client, id);
    if (status === "with_hr") await cycle.scheduleClose(client, after);
    await emit(client, {
      key: EVENTS.REVIEW_SUBMITTED,
      entity: { type: "performance_review", id },
      actor,
      payload: {
        performance_review_id: id,
        employee_id: r.employee_id,
        subject_employee_id: r.employee_id,
        second_level_employee_id: second,
        status,
      },
    });
  });
  return get(actor, scope, id);
}

/**
 * POST /performance/reviews/:id/return: the check-in goes back to the employee, with the reason.
 * Answers with the review's row: the reviewer sees nothing of it again until it is resubmitted.
 */
async function returnCheckIn(actor, scope, id, body) {
  await tx(async (client) => {
    const { r } = await forReviewer(client, id, actor, scope);
    await repo.update(client, id, { status: "check_in", check_in_submitted_at: null, returned_reason: body.returned_reason });
    await reminders.cancel(client, { key: REVIEW_REMINDER, entity: { type: "performance_review", id } });
    await emit(client, {
      key: EVENTS.REVIEW_RETURNED,
      entity: { type: "performance_review", id },
      actor,
      payload: { performance_review_id: id, employee_id: r.employee_id, reviewer_employee_id: r.reviewer_employee_id, employee_name: r.employee.display_name, to: "employee", reason: body.returned_reason },
    });
  });
  return reviewView(await repo.get(pool, id));
}

/**
 * POST /performance/reviews/:id/score-without-check-in (§11): the check-in's due date has passed and
 * it is not in, so the reviewer scores without it. The review goes to the reviewer with the reason
 * kept; the employee's own lines are Not Assessable and Monthly Update On Time scores 0; the
 * employee is told.
 */
async function scoreWithoutCheckIn(actor, scope, id, body) {
  await tx(async (client) => {
    await repo.lock(client, id);
    const { r, roles } = await loadFor(client, id, actor, scope);
    if (!roles.reviewer || roles.employee) throw new AppError("PERMISSION_DENIED", "Only the reviewer can do that", 403);
    if (r.status !== "check_in") throw new AppError("CHECK_IN_SENT", "The check-in is already in", 409);
    if (!checkInLate(r)) throw new AppError("CHECK_IN_NOT_LATE", "The check-in is not due yet", 409);
    const now = new Date();
    await repo.update(client, id, {
      status: "with_reviewer",
      no_check_in_at: now,
      no_check_in_reason: body.no_check_in_reason,
      returned_reason: null,
      ...(r.reviewer_employee_id === actor.employee_id ? {} : { reviewer_employee_id: actor.employee_id }),
    });
    const after = await repo.get(client, id);
    await refreshScores(client, after, { now, submittedAt: null });
    await reminders.cancel(client, { key: CHECK_IN_REMINDER, entity: { type: "performance_review", id } });
    await emit(client, {
      key: EVENTS.REVIEW_SCORED_WITHOUT_CHECK_IN,
      entity: { type: "performance_review", id },
      actor,
      before: { status: "check_in" },
      after: { status: "with_reviewer" },
      payload: {
        performance_review_id: id,
        employee_id: r.employee_id,
        subject_employee_id: r.employee_id,
        round_name: r.round_name,
        reason: body.no_check_in_reason,
      },
    });
    await cycle.scheduleReview(client, after, await workingWeek.loadCalendar(client), now);
  });
  return get(actor, scope, id);
}

/** The dotted manager asked for input, in the caller's transaction. */
async function askedInput(client, r, actor) {
  await emit(client, {
    key: EVENTS.REVIEW_INPUT_ASKED,
    entity: { type: "performance_review", id: r.performance_review_id },
    actor,
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      employee_name: r.employee.display_name,
      dotted_employee_id: r.dotted_employee_id,
      round_name: r.round_name,
    },
  });
}

/** POST /performance/reviews/:id/ask-input */
async function askInput(actor, scope, id) {
  await tx(async (client) => {
    const { r } = await forReviewer(client, id, actor, scope);
    if (!r.dotted_employee_id) throw new AppError("NO_DOTTED_MANAGER", "Nobody gives input to this review", 409);
    if (r.dotted_input) throw new AppError("INPUT_GIVEN", "Input is already given", 409);
    await askedInput(client, r, actor);
  });
  return get(actor, scope, id);
}

/** POST /performance/reviews/:id/input: the dotted manager's input, before the reviewer scores. */
async function giveInput(actor, scope, id, body) {
  await tx(async (client) => {
    await repo.lock(client, id);
    const { r, roles } = await loadFor(client, id, actor, scope);
    if (!sequence.allowed(r, roles).give_input) throw new AppError("PERMISSION_DENIED", "Only the dotted-line manager gives input now", 403);
    await repo.update(client, id, { dotted_input: body.dotted_input, dotted_input_at: new Date() });
    await emit(client, {
      key: EVENTS.REVIEW_INPUT_GIVEN,
      entity: { type: "performance_review", id },
      actor,
      payload: {
        performance_review_id: id,
        employee_id: r.employee_id,
        employee_name: r.employee.display_name,
        reviewer_employee_id: r.reviewer_employee_id,
        dotted_name: r.dotted ? r.dotted.display_name : null,
      },
    });
  });
  return get(actor, scope, id);
}

/** The rating a score earns, capped by a conduct breach (§6.15). */
const ratingOf = (score, breach, r) => scoring.rating(score, { conduct_breach: breach }, rulesOf(r).bands);

/** POST /performance/reviews/:id/conduct: Operations & People mark a confirmed breach, or clear it. */
async function markConduct(actor, scope, id, body) {
  await tx(async (client) => {
    await repo.lock(client, id);
    const { r, roles } = await loadFor(client, id, actor, scope);
    if (!sequence.allowed(r, roles).mark_conduct) throw new AppError("PERMISSION_DENIED", "Operations & People mark conduct", 403);
    const patch = { conduct_breach: body.conduct_breach, conduct_note: body.conduct_note };
    if (r.status === "closed") {
      patch.rating = ratingOf(r.score_to_date, body.conduct_breach, r);
      if (r.scorecard_id && r.review_kind === "monthly")
        await repo.setScorecardScore(client, r.scorecard_id, { score_to_date: r.score_to_date, rating: patch.rating });
    }
    await repo.update(client, id, patch);
    await emit(client, {
      key: EVENTS.REVIEW_CONDUCT_MARKED,
      entity: { type: "performance_review", id },
      actor,
      before: { conduct_breach: Boolean(r.conduct_breach), rating: r.rating },
      after: { conduct_breach: body.conduct_breach, rating: patch.rating ?? r.rating },
      payload: { performance_review_id: id, employee_id: r.employee_id, conduct_breach: body.conduct_breach },
    });
  });
  return get(actor, scope, id);
}

/** POST /performance/reviews/:id/probation-outcome: chosen at HR's stage; Close Review applies it. */
async function setProbationOutcome(actor, scope, id, body) {
  await tx(async (client) => {
    await repo.lock(client, id);
    const { r, roles } = await loadFor(client, id, actor, scope);
    if (!sequence.allowed(r, roles).decide_probation)
      throw new AppError("REVIEW_NOT_WITH_HR", "Choose the outcome when the review is with Operations & People", 409);
    if (body.probation_outcome === "extend" && (await repo.extendedBefore(client, r.employee_id, id)))
      throw new AppError("EXTENDED_BEFORE", "Probation was extended once already", 409, { probation_outcome: ["Extended once already"] });
    await repo.update(client, id, { probation_outcome: body.probation_outcome });
    await emit(client, {
      key: EVENTS.REVIEW_OUTCOME_SET,
      entity: { type: "performance_review", id },
      actor,
      after: { probation_outcome: body.probation_outcome },
      payload: { performance_review_id: id, employee_id: r.employee_id, probation_outcome: body.probation_outcome, note: body.note || null },
    });
  });
  return get(actor, scope, id);
}

/* ------------------------------------------------------------------ *
 * Closing, and the approval's other outcomes (after commit, reviews.events.js)
 * ------------------------------------------------------------------ */

/** The month's score and the score to date of a review being closed. */
async function scoresOf(client, r, items) {
  const weighted = items.map((i) => ({ weight: i.weight === null || i.weight === undefined ? 1 : i.weight, score: i.score }));
  const month = scoring.scoreToDate(weighted);
  if (!(r.scorecard_id && r.review_kind === "monthly")) return { month, toDate: month };
  const lines = await targetsRepo.lines(client, r.scorecard_id);
  const months = await repo.closedMonths(client, r.scorecard_id);
  const thisMonth = day(r.month);
  const toDate = scoring.scoreToDate(
    lines.map((l) => {
      const scores = months
        .filter((m) => m.employee_target_id === l.employee_target_id && day(m.month) !== thisMonth)
        .map((m) => ({ month: day(m.month), score: m.score }));
      const mine = items.find((i) => i.employee_target_id === l.employee_target_id);
      if (mine) scores.push({ month: thisMonth, score: mine.score });
      scores.sort((a, b) => a.month.localeCompare(b.month));
      return { weight: l.weight, score: scoring.lineScore({ section: l.section, months: scores.map((s) => s.score) }) };
    }),
  );
  return { month, toDate };
}

/** The chain as the PDF prints it. */
function chainForPdf(r, decisions) {
  const names = { check_in: "Check-In", reviewer: "Reviewer", second_level: "Second Level", hr: "Operations & People" };
  return chainOf({ ...r, status: "closed" }, decisions)
    .filter((s) => s.state !== "skipped")
    .map((s) => ({ step: names[s.key], name: s.person || "Not named", at: s.at || (s.key === "hr" ? iso(new Date()) : null) }));
}

/** Apply a probation review's outcome through the organisation's own service (§6.16). */
async function applyOutcome(client, r) {
  if (r.review_kind !== "probation" || !r.probation_outcome) return;
  const organisation = require("../organisation/organisation.service");
  const today = lagos.today();
  if (r.probation_outcome === "confirm") await organisation.updateEmployee(client, r.employee_id, { confirmed_on: today }, null);
  if (r.probation_outcome === "extend") {
    const { rows } = await client.query("SELECT confirmation_due_on FROM employee WHERE employee_id = $1", [r.employee_id]);
    const from = day(rows[0] && rows[0].confirmation_due_on) || today;
    await organisation.updateEmployee(client, r.employee_id, { confirmation_due_on: lagos.addMonths(from, 3) }, null);
  }
  await emit(client, {
    key: EVENTS.PROBATION_DECIDED,
    entity: { type: "performance_review", id: r.performance_review_id },
    actor: null,
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      subject_employee_id: r.employee_id,
      probation_outcome: r.probation_outcome,
      outcome_label: pdf.OUTCOME[r.probation_outcome],
    },
  });
}

/**
 * Close a review in the caller's transaction: scores and rating on the review and its scorecard,
 * the PDF queued, a probation outcome applied, the employee told.
 */
async function closeReview(client, r, actor = null) {
  const items = await repo.items(client, r.performance_review_id);
  const { month, toDate } = await scoresOf(client, r, items);
  const rating = ratingOf(toDate, Boolean(r.conduct_breach), r);
  await repo.update(client, r.performance_review_id, {
    status: "closed",
    closed_at: new Date(),
    score_month: scoring.formatScore(month),
    score_to_date: scoring.formatScore(toDate),
    rating,
  });
  if (r.scorecard_id && r.review_kind === "monthly")
    await repo.setScorecardScore(client, r.scorecard_id, { score_to_date: scoring.formatScore(toDate), rating });
  const closed = await repo.get(client, r.performance_review_id);
  const month0 = await tasksOf(client, closed);
  const titles = (b) => month0.tasks.filter((t) => t.bucket === b).map((t) => t.title);
  const documentId = await pdf.generate(
    client,
    closed,
    items,
    { done: titles("done"), ongoing: titles("ongoing"), next_month: titles("next_month") },
    chainForPdf(closed, await repo.decisions(client, r.performance_review_id)),
  );
  await repo.update(client, r.performance_review_id, { document_id: documentId });
  await reminders.cancel(client, { key: CLOSE_REMINDER, entity: { type: "performance_review", id: r.performance_review_id } });
  await applyOutcome(client, closed);
  await emit(client, {
    key: EVENTS.REVIEW_CLOSED,
    entity: { type: "performance_review", id: r.performance_review_id },
    actor,
    after: { score_month: closed.score_month, score_to_date: closed.score_to_date, rating },
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      subject_employee_id: r.employee_id,
      round_name: r.round_name,
      review_kind: r.review_kind,
      score_month: closed.score_month,
      score_to_date: closed.score_to_date,
      rating,
      rating_label: pdf.RATING[rating] || null,
      conduct_breach: Boolean(r.conduct_breach),
    },
  });
}

/**
 * `performance.review` finished: approved closes the review; refused returns it to the reviewer.
 * Safe to run again: a review no longer in the chain is left alone.
 */
async function settle(reviewId, { state, reason = null }) {
  return tx(async (client) => {
    await repo.lock(client, reviewId);
    const r = await repo.get(client, reviewId);
    if (!r || !sequence.IN_APPROVAL.includes(r.status)) return null;
    if (state === "approved" || state === "timeout_approved") {
      await closeReview(client, r);
      return "closed";
    }
    if (state === "cancelled") return null;
    await returnToReviewer(client, r, reason);
    return "returned";
  });
}

/** Back to the reviewer with the reason, in the caller's transaction. */
async function returnToReviewer(client, r, reason) {
  await repo.update(client, r.performance_review_id, { status: "returned", returned_reason: reason || null });
  await reminders.cancel(client, { key: CLOSE_REMINDER, entity: { type: "performance_review", id: r.performance_review_id } });
  await emit(client, {
    key: EVENTS.REVIEW_RETURNED,
    entity: { type: "performance_review", id: r.performance_review_id },
    actor: null,
    payload: {
      performance_review_id: r.performance_review_id,
      employee_id: r.employee_id,
      reviewer_employee_id: r.reviewer_employee_id,
      employee_name: r.employee.display_name,
      to: "reviewer",
      reason,
    },
  });
}

/** The approval moved to Operations & People. */
async function stageMoved(reviewId, stage) {
  if (stage !== "operations_people") return null;
  return tx(async (client) => {
    await repo.lock(client, reviewId);
    const r = await repo.get(client, reviewId);
    if (!r || r.status !== "second_level") return null;
    await repo.update(client, reviewId, { status: "with_hr" });
    await cycle.scheduleClose(client, r);
    await emit(client, {
      key: EVENTS.REVIEW_ADVANCED,
      entity: { type: "performance_review", id: reviewId },
      actor: null,
      before: { status: "second_level" },
      after: { status: "with_hr" },
      payload: { performance_review_id: reviewId, employee_id: r.employee_id },
    });
    return "with_hr";
  });
}

/**
 * The engine's Request Changes sends an approval back to its first stage; a review goes back to its
 * reviewer instead: the pending approval is withdrawn for its opener and the review is returned.
 */
async function changesRequested(reviewId, payload) {
  return tx(async (client) => {
    await repo.lock(client, reviewId);
    const r = await repo.get(client, reviewId);
    if (!r || !sequence.IN_APPROVAL.includes(r.status)) return null;
    const instance = await workflow.findOpenInstance(client, { type: "performance_review", id: reviewId });
    if (instance) await workflow.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason: payload.reason || null });
    await returnToReviewer(client, r, payload.reason || null);
    return "returned";
  });
}

/* ------------------------------------------------------------------ *
 * Withdrawn: a leaver's open review, or one Operations & People withdraw (§11)
 * ------------------------------------------------------------------ */

/**
 * Close an open review as Withdrawn at HR's stage, without a score, in the caller's transaction:
 * its pending approval and reminders end, and the people it names are told. `tell` are the
 * employees told (the actor never is).
 */
async function withdrawIn(client, r, { reason, actor = null, leaver = false, tell = [] }) {
  const id = r.performance_review_id;
  const instance = await workflow.findOpenInstance(client, { type: "performance_review", id });
  if (instance) await workflow.cancel(client, { instance_id: instance.workflow_instance_id, actor: { user_id: instance.opened_by }, reason });
  await repo.update(client, id, { status: "withdrawn", withdrawn_at: new Date(), withdrawn_reason: reason });
  for (const key of [CHECK_IN_REMINDER, REVIEW_REMINDER, CLOSE_REMINDER]) await reminders.cancel(client, { key, entity: { type: "performance_review", id } });
  await emit(client, {
    key: EVENTS.REVIEW_WITHDRAWN,
    entity: { type: "performance_review", id },
    actor,
    before: { status: r.status },
    after: { status: "withdrawn" },
    payload: {
      performance_review_id: id,
      employee_id: r.employee_id,
      subject_employee_id: r.employee_id,
      employee_name: r.employee.display_name,
      round_name: r.round_name,
      reason,
      leaver,
      tell_employee_ids: [...new Set(tell.filter(Boolean))],
    },
  });
}

/** POST /performance/reviews/:id/withdraw: Operations & People withdraw an open review, with a reason. */
async function withdraw(actor, scope, id, body) {
  await tx(async (client) => {
    await repo.lock(client, id);
    const { r, roles } = await loadFor(client, id, actor, scope);
    if (sequence.ENDED.includes(r.status)) throw new AppError("REVIEW_ENDED", "This review is already closed", 409);
    if (!sequence.allowed(r, roles).withdraw) throw new AppError("PERMISSION_DENIED", "Operations & People withdraw a review", 403);
    await withdrawIn(client, r, { reason: body.withdrawn_reason, actor, tell: [r.employee_id, r.reviewer_employee_id, r.second_level_employee_id] });
  });
  return get(actor, scope, id);
}

/** The note a leaver's withdrawn review carries. */
const leaverNote = (leftOn) => (leftOn ? `The employee left on ${formatDate(leftOn)}.` : "The employee left.");

/**
 * A leaver's open reviews end Withdrawn and their running scorecards close, in the caller's
 * transaction; their commitments stay as they are, reportable. Returns how many reviews ended.
 */
async function withdrawLeaverIn(client, employeeId, leftOn) {
  let ended = 0;
  for (const id of await repo.openIdsOf(client, employeeId)) {
    await repo.lock(client, id);
    const r = await repo.get(client, id);
    if (!r || sequence.ENDED.includes(r.status)) continue;
    // The reviewer stops waiting on it; the leaver is not told.
    await withdrawIn(client, r, { reason: leaverNote(leftOn), leaver: true, tell: [r.reviewer_employee_id, r.second_level_employee_id] });
    ended += 1;
  }
  await require("../targets/targets.service").closeOfLeaver(client, employeeId, lagos.today());
  return ended;
}

/** The leaver's record as their leaving reads it: archived or not, and the day they leave. */
async function leaverOf(db, employeeId) {
  const { rows } = await db.query("SELECT status, to_char(left_on, 'YYYY-MM-DD') AS left_on FROM employee WHERE employee_id = $1", [employeeId]);
  return rows[0] || null;
}

/** The instant a leaving date is acted on: its first morning, Lagos. */
const leavingAt = (leftOn) => lagos.instant(leftOn, "06:00");

/**
 * `employee.archived`: the person has left. With a leaving date still ahead, their reviews and
 * scorecard end on that date (the reminder engine brings it back, LEAVER_REMINDER); otherwise now.
 * Safe to run again.
 */
async function leaverArchived(employeeId) {
  return tx(async (client) => {
    const e = await leaverOf(client, employeeId);
    if (!e || e.status !== "archived") return null;
    if (e.left_on && e.left_on > lagos.today()) {
      await reminders.schedule(client, {
        key: LEAVER_REMINDER,
        entity: { type: "employee", id: employeeId },
        occurrence: e.left_on,
        at: leavingAt(e.left_on),
        payload: { employee_id: employeeId, left_on: e.left_on },
      });
      return "scheduled";
    }
    return withdrawLeaverIn(client, employeeId, e.left_on);
  });
}

/**
 * The leaving date's reminder, in its firing's transaction: still archived and the day come, it
 * fires; a date moved later waits for it; a record restored ends it.
 */
async function leaverCheck(client, row) {
  const e = await leaverOf(client, row.entity_id);
  if (!e || e.status !== "archived") return null;
  if (e.left_on && e.left_on > lagos.today()) return { later: leavingAt(e.left_on) };
  return { entity: { type: "employee", id: row.entity_id }, payload: { employee_id: row.entity_id, left_on: e.left_on } };
}

/** `review.leaver_due`: the leaving date came. */
async function withdrawLeaver(employeeId) {
  return tx(async (client) => {
    const e = await leaverOf(client, employeeId);
    if (!e || e.status !== "archived") return null;
    return withdrawLeaverIn(client, employeeId, e.left_on);
  });
}

/* ------------------------------------------------------------------ *
 * Probation reviews (§6.16)
 * ------------------------------------------------------------------ */

const CRITERIA = ["objectives", "quality", "timeliness", "attendance", "conduct"];

/**
 * `employee.probation_ending`: open the person's probation review, with their line manager as
 * reviewer, on their scorecard's lines when they have one, else on the five criteria. One open
 * probation review at a time.
 */
async function openProbation(employeeId, dueOn = null) {
  return tx(async (client) => {
    if (await repo.openProbationOf(client, employeeId)) return null;
    const { rows } = await client.query("SELECT status FROM employee WHERE employee_id = $1", [employeeId]);
    if (!rows[0] || rows[0].status !== "active") return null;
    const reviewer = await repo.effectiveManagerOf(client, employeeId);
    if (!reviewer) return null;
    const today = lagos.today();
    const card = await repo.scorecardOn(client, employeeId, today);
    const dotted = (await client.query("SELECT dotted_manager_id FROM employee WHERE employee_id = $1", [employeeId])).rows[0];
    const id = await repo.insert(client, {
      performance_cycle_id: null,
      scorecard_id: card ? card.scorecard_id : null,
      employee_id: employeeId,
      reviewer_employee_id: reviewer,
      review_type: "manager",
      review_kind: "probation",
      status: "check_in",
      dotted_employee_id: (dotted && dotted.dotted_manager_id) || null,
    });
    if (!id) return null;
    if (card) {
      const r = await repo.get(client, id);
      await cycle.writeItems(client, id, { ...r, month: monthOfReview(r) }, await targetsRepo.lines(client, card.scorecard_id), rulesOf(r));
    } else {
      for (const criterion of CRITERIA) await repo.insertItem(client, { performance_review_id: id, criterion, assessable: true, auto: false });
    }
    const r = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.REVIEW_OPENED,
      entity: { type: "performance_review", id },
      actor: null,
      after: { review_kind: "probation" },
      payload: {
        performance_review_id: id,
        employee_id: employeeId,
        subject_employee_id: employeeId,
        employee_name: r.employee.display_name,
        reviewer_employee_id: reviewer,
        confirmation_due_on: dueOn,
      },
    });
    return id;
  });
}

/* ------------------------------------------------------------------ *
 * ESS · My Performance
 * ------------------------------------------------------------------ */

/** GET /ess/performance: the caller's quarter at a glance. */
/** This month's commitments of a person, as the commitments module counts them (§6.11). */
async function commitmentsOf(employeeId) {
  const month = `${lagos.today().slice(0, 7)}-01`;
  const figures = await require("../targets/targets.commitments").monthFigures(pool, employeeId, month);
  const set = (await pool.query("SELECT status FROM commitment_set WHERE employee_id = $1 AND month = $2::date", [employeeId, month])).rows[0];
  return { month, set_status: set ? set.status : null, due: figures ? figures.due : 0, delivered_on_time: figures ? figures.delivered_on_time : 0 };
}

async function myPerformance(actor) {
  const me = actor && actor.employee_id;
  let period = null;
  try {
    period = await require("../goals/goals.service").currentPeriod(pool);
  } catch (err) {
    if (err.code !== "NO_QUARTER") throw err;
  }
  const card = me && period ? await targetsRepo.ofPerson(pool, period.performance_period_id, me) : null;
  const open = me ? await repo.openOfEmployee(pool, me) : null;
  const pip = me ? await repo.openPipOf(pool, me) : null;
  return {
    period: period ? { performance_period_id: period.performance_period_id, name: period.name } : null,
    scorecard: card
      ? {
          scorecard_id: card.scorecard_id,
          status: card.status,
          score_to_date: card.score_to_date,
          rating: card.rating,
          employee_agreed_at: iso(card.employee_agreed_at),
          reviewer_name: card.reviewer ? card.reviewer.display_name : card.reviewer_role || null,
        }
      : null,
    check_in: open
      ? { performance_review_id: open.performance_review_id, month: day(open.month), due_on: open.status === "check_in" ? checkInDueOf(open) : day(open.due_on), status: open.status }
      : null,
    commitments: me ? await commitmentsOf(me) : null,
    open_pip: pip ? { improvement_plan_id: pip.improvement_plan_id, review_on: day(pip.review_on) } : null,
  };
}

/** GET /ess/performance/reviews */
async function myReviews(actor, query) {
  if (!actor || !actor.employee_id) return { data: [], page: { number: 1, size: 25, total: 0, pages: 0, has_next: false } };
  const page = await repo.ofEmployee(pool, actor.employee_id, query);
  return {
    ...page,
    data: page.data.map((r) => {
      const closed = r.status === "closed";
      return {
        performance_review_id: r.performance_review_id,
        round_name: r.round_name,
        month: day(r.month),
        review_kind: r.review_kind,
        status: r.status,
        score_month: closed ? r.score_month : null,
        score_to_date: closed ? r.score_to_date : null,
        rating: closed ? r.rating : null,
        closed_at: iso(r.closed_at),
        document_id: closed ? r.document_id : null,
      };
    }),
  };
}

module.exports = {
  reviewView,
  itemView,
  chainOf,
  list,
  get,
  detail,
  loadFor,
  monthOfReview,
  refreshScores,
  myOpen,
  myCheckIn,
  saveCheckIn,
  addEvidence,
  submitCheckIn,
  saveScores,
  submit,
  returnCheckIn,
  scoreWithoutCheckIn,
  askInput,
  giveInput,
  markConduct,
  setProbationOutcome,
  missed,
  scoresOf,
  closeReview,
  settle,
  stageMoved,
  changesRequested,
  withdraw,
  leaverArchived,
  leaverCheck,
  withdrawLeaver,
  checkInLate,
  openProbation,
  myPerformance,
  myReviews,
};
