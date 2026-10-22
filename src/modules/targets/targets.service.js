"use strict";
/**
 * Scorecards: the one write path for a person's quarter and its lines (docs/guides/performance.md
 * §6.5, §6.6, §6.13).
 *
 * A manager drafts a scorecard for a person in their `performance` scope, never their own. It
 * belongs to the function's plan for the quarter and binds with it (goals.approval.js): until then
 * its lines are edited freely; after, only through a target change. The reviewer is the person's
 * effective line manager, worked out when it is drafted (the CEO has none); Operations & People
 * may name another person or a role, with a reason. Both the employee and the reviewer agree with
 * one tap; Disagree With Reason clears both agreements and tells the reviewer.
 *
 * Someone who joins after their function's plan binds (§11) is drafted a scorecard all the same; Send
 * Scorecard opens a plan amendment, a `performance.plan` approval holding that scorecard alone, and
 * the CEO's approval binds it (goals.approval.js). While a plan is sent, no scorecard is drafted in it.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { scoring } = require("@mycity/contract");
const workflow = require("../../shared/workflow/engine");
const authority = require("../goals/goals.authority");
const plans = require("../goals/goals.plans");
const weights = require("./targets.weights");
const repo = require("./targets.repo");
const { EVENTS, AGREE_REMINDER } = require("./targets.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That scorecard does not exist", 404);
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);

/** A scorecard row as the contract's Scorecard. */
function cardView(r) {
  return {
    scorecard_id: r.scorecard_id,
    performance_period_id: r.performance_period_id,
    period_name: r.period_name,
    employee: r.employee,
    department_id: r.department_id,
    department: r.department,
    status: r.status,
    reviewer: r.reviewer,
    reviewer_role_code: r.reviewer_role_code,
    reviewer_role: r.reviewer_role,
    dotted: r.dotted,
    employee_agreed_at: iso(r.employee_agreed_at),
    reviewer_agreed_at: iso(r.reviewer_agreed_at),
    disagreed_at: iso(r.disagreed_at),
    score_to_date: r.score_to_date,
    rating: r.rating,
    line_count: r.line_count,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** A line row with its months as the contract's ScorecardLine. */
function lineView(l, months) {
  const mine = months.filter((m) => m.employee_target_id === l.employee_target_id);
  const score = scoring.lineScore({ section: l.section, months: mine.map((m) => m.score) });
  return {
    employee_target_id: l.employee_target_id,
    scorecard_id: l.scorecard_id,
    section: l.section,
    position: l.position,
    title: l.title,
    measure: l.measure,
    direction: l.direction === "lower" ? "lower" : "higher",
    unit: l.unit,
    target_value: l.target_value,
    target_text: l.target_text,
    milestone_due_on: day(l.milestone_due_on),
    due_on: day(l.due_on),
    frequency_text: l.frequency_text,
    weight: String(Number(l.weight)),
    source: l.source,
    okr_key_result_id: l.okr_key_result_id,
    key_result: l.key_result,
    kpi_definition_id: l.kpi_definition_id,
    kpi: l.kpi,
    team_key_results: l.team_key_results || [],
    share_value: l.share_value,
    months: mine.map((m) => ({ month: day(m.month), score: m.score })),
    score: scoring.formatScore(score),
  };
}

/** Is the reader the scorecard's reviewer (by name, or as a holder of its reviewer role)? */
async function isReviewer(db, card, actor) {
  if (!actor || !actor.employee_id) return false;
  if (card.reviewer_employee_id && card.reviewer_employee_id === actor.employee_id) return true;
  // A role reviews everyone but the holder themselves (§6.13).
  if (card.employee_id === actor.employee_id) return false;
  return Boolean(card.reviewer_role_code) && (await repo.holdsRole(db, actor.employee_id, card.reviewer_role_code));
}

/** May the reader open this scorecard: in scope, its employee, its reviewer or its dotted manager. */
async function assertMayRead(db, card, actor, scope) {
  if (actor && (actor.is_ceo || card.employee_id === actor.employee_id || card.dotted_employee_id === actor.employee_id)) return;
  if (await isReviewer(db, card, actor)) return;
  assertInScope(scope, card.employee_id);
}

/** May the reader open this scorecard (assertMayRead, as a yes or no)? */
async function mayRead(db, card, actor, scope) {
  try {
    await assertMayRead(db, card, actor, scope);
    return true;
  } catch {
    return false;
  }
}

/**
 * May the reader ask for a change to a line's target on this scorecard (§3.5, §6.7)? Its reviewer or
 * the function's head (or acting head), on a binding or agreed scorecard; never its employee, whose
 * reviewer changes their targets.
 */
async function mayChangeLineTarget(db, card, actor) {
  if (!actor || !actor.employee_id || card.employee_id === actor.employee_id) return false;
  if (!["binding", "agreed"].includes(card.status)) return false;
  if (await isReviewer(db, card, actor)) return true;
  if (!card.department_id) return false;
  const organisation = require("../organisation/organisation.service");
  return (await organisation.headOf(db, card.department_id)) === actor.employee_id;
}

/** The pending plan amendment holding a mid-quarter scorecard alone, if it was sent. */
const amendmentOf = (db, scorecardId) => workflow.findOpenInstance(db, { type: "scorecard", id: scorecardId });

/**
 * A draft scorecard may be edited by a manager in scope (never their own) while its plan is a draft
 * or returned, or once the plan binds (a mid-quarter scorecard) until it is sent as an amendment.
 */
async function editable(db, card, actor, scope) {
  if (card.status !== "draft") return false;
  const plan = await plans.planFor(db, card.performance_period_id, card.department_id);
  if (plan && plan.status === "submitted") return false;
  if (plan && plan.status === "binding" && (await amendmentOf(db, card.scorecard_id))) return false;
  if (!actor) return false;
  if (actor.is_ceo) return true;
  if (card.employee_id === actor.employee_id) return false;
  try {
    assertInScope(scope, card.employee_id);
  } catch {
    return false;
  }
  return scope.scope === "team" || scope.scope === "all";
}

async function detail(db, card, actor, scope) {
  const [lines, months, waiting] = await Promise.all([
    repo.lines(db, card.scorecard_id),
    repo.lineMonths(db, card.scorecard_id),
    repo.pendingChanges(db, card.scorecard_id),
  ]);
  // A line waiting on a change shows it, and offers no second Change Target (§6.7).
  const changeable = await mayChangeLineTarget(db, card, actor);
  const views = lines.map((l) => {
    const change = waiting.find((c) => c.employee_target_id === l.employee_target_id);
    return {
      ...lineView(l, months),
      can_change_target: changeable && !change,
      pending_change: change
        ? { target_change_id: change.target_change_id, to_value: change.to_value, to_text: change.to_text, from_month: change.from_month }
        : null,
    };
  });
  const splits = await repo.contributions(db, { scorecardId: card.scorecard_id });
  const reviewer = await isReviewer(db, card, actor);
  const mine = actor && card.employee_id === actor.employee_id;
  const agreeable = ["binding", "agreed"].includes(card.status);
  const canEdit = await editable(db, card, actor, scope);
  const plan = card.status === "draft" ? await plans.planFor(db, card.performance_period_id, card.department_id) : null;
  const amendment = plan && plan.status === "binding" ? await amendmentOf(db, card.scorecard_id) : null;
  return {
    ...cardView(card),
    scope_text: card.scope_text,
    reviewer_reason: card.reviewer_reason,
    disagree_reason: card.disagree_reason,
    results_weight: card.results_weight,
    kpis_weight: card.kpis_weight,
    accountability_weight: card.accountability_weight,
    lines: views,
    weight_problems: weights.weightProblems(card, views),
    contributions: splits.map(weights.contribution),
    can_edit: canEdit,
    can_agree: agreeable && ((mine && !card.employee_agreed_at) || (reviewer && !card.reviewer_agreed_at)),
    can_send: canEdit && Boolean(plan && plan.status === "binding") && !weights.weightProblems(card, views).length,
    amendment_instance_id: amendment ? amendment.workflow_instance_id : null,
  };
}

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  return { ...page, data: page.data.map(cardView) };
}

async function get(id, actor, scope) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  await assertMayRead(pool, card, actor, scope);
  return detail(pool, card, actor, scope);
}

/** The lines a new scorecard starts from: copied, or the accountability lines alone. */
async function startingLines(db, { copyFrom, employeeId, period, manages, actor = null, scope = null }) {
  let sourceId = null;
  if (copyFrom === "last_quarter") {
    const prev = await repo.previousOf(db, employeeId, day(period.starts_on));
    sourceId = prev ? prev.scorecard_id : null;
  } else if (copyFrom && copyFrom !== "none") sourceId = copyFrom;
  if (!sourceId) return weights.accountabilityLines(manages, period.rules.sections.accountability);
  const source = await repo.get(db, sourceId);
  const cannotCopy = () => new AppError("VALIDATION_FAILED", "Pick a scorecard to copy", 422, { copy_from: ["Not found"] });
  if (!source) throw cannotCopy();
  // A colleague's scorecard is copied only when the drafter may read it.
  if (scope && copyFrom !== "last_quarter") {
    try {
      await assertMayRead(db, source, actor, scope);
    } catch {
      throw cannotCopy();
    }
  }
  const sameQuarter = source.performance_period_id === period.performance_period_id;
  return (await repo.lines(db, sourceId)).map((l) => ({
    section: l.section,
    position: l.position,
    title: l.title,
    measure: l.measure,
    direction: l.direction,
    unit: l.unit,
    target_value: l.target_value,
    target_text: l.target_text,
    milestone_due_on: sameQuarter ? day(l.milestone_due_on) : null,
    frequency_text: l.frequency_text,
    weight: String(Number(l.weight)),
    source: l.source,
    // A key result belongs to its quarter: a line copied from last quarter is linked afresh.
    okr_key_result_id: sameQuarter ? l.okr_key_result_id : null,
    kpi_definition_id: l.kpi_definition_id,
    share_value: null,
    team_key_result_ids: sameQuarter ? (l.team_key_results || []).map((k) => k.okr_key_result_id) : [],
  }));
}

/**
 * POST /performance/scorecards: a manager drafts one for a person in their scope.
 * `opts.status` and `opts.agreed_at` are for the importer: an imported scorecard was approved and
 * signed in September.
 */
async function create(actor, scope, body, opts = {}) {
  if (actor && actor.employee_id && body.employee_id === actor.employee_id && !opts.system)
    throw new AppError("SCORECARD_OWN", "Your manager drafts your scorecard", 403);
  if (!opts.system) assertInScope(scope, body.employee_id);
  const id = await tx(async (client) => {
    const period = await plans.periodOf(client, body.performance_period_id);
    if (period.status === "closed") throw new AppError("PERIOD_CLOSED", "That quarter is closed", 409);
    const person = await repo.personFacts(client, body.employee_id);
    if (!person || person.status !== "active")
      throw new AppError("VALIDATION_FAILED", "Pick someone who works here now", 422, { employee_id: ["Not active"] });
    if (await repo.ofPerson(client, body.performance_period_id, body.employee_id))
      throw new AppError("SCORECARD_EXISTS", "They already have a scorecard this quarter", 409, { employee_id: ["Already has one"] });
    if (person.department_id) {
      const plan = await plans.ensurePlan(client, period.performance_period_id, person.department_id);
      // A sent plan takes no new scorecard: it would bind unchecked. A binding one takes it as an
      // amendment, sent on its own (§11).
      if (!opts.system && plan.status === "submitted")
        throw new AppError("PLAN_NOT_OPEN", "This function's plan is already sent for the quarter", 409);
    }
    const sections = period.rules.sections;
    const cardId = await repo.insert(client, {
      performance_period_id: period.performance_period_id,
      employee_id: body.employee_id,
      department_id: person.department_id,
      reviewer_employee_id: person.is_ceo ? null : opts.reviewer_employee_id || person.manager_id || null,
      dotted_employee_id: person.dotted_manager_id || null,
      scope_text: opts.scope_text,
      status: opts.status || "draft",
      employee_agreed_at: opts.agreed_at,
      reviewer_agreed_at: opts.agreed_at,
      results_weight: sections.results,
      kpis_weight: sections.kpis,
      accountability_weight: sections.accountability,
    });
    const lines =
      opts.lines ||
      (await startingLines(client, {
        copyFrom: body.copy_from,
        employeeId: body.employee_id,
        period,
        manages: person.manages,
        actor: opts.system ? null : actor,
        scope: opts.system ? null : scope,
      }));
    await writeLines(client, { scorecard_id: cardId, employee_id: body.employee_id, performance_period_id: period.performance_period_id, period_ends_on: day(period.ends_on), status: opts.status || "draft" }, lines);
    const after = await repo.get(client, cardId);
    await emit(client, {
      key: EVENTS.SCORECARD_CREATED,
      entity: { type: "scorecard", id: cardId },
      actor,
      after: cardView(after),
      payload: { scorecard_id: cardId, employee_id: body.employee_id, subject_employee_id: body.employee_id, period: period.name },
    });
    return cardId;
  });
  return get(id, actor && actor.is_ceo === undefined ? { ...actor, is_ceo: true } : actor, opts.system ? { scope: "all", scope_ids: null } : scope);
}

/** Check a set of lines against the rules a line must keep (§6.5); the problems by field. */
async function lineProblems(db, card, lines) {
  const out = {};
  for (const [i, l] of lines.entries()) {
    const at = (k) => `lines.${i}.${k}`;
    if (weights.measureProblem(l)) out[at("measure")] = [`Pick ${weights.MEASURES[l.section].join(" or ")}`];
    if (Number(l.weight) <= 0) out[at("weight")] = ["Above zero"];
    if (l.okr_key_result_id) {
      const kr = await repo.keyResultPeriod(db, l.okr_key_result_id);
      if (!kr || kr.performance_period_id !== card.performance_period_id) out[at("okr_key_result_id")] = ["Not this quarter's"];
    }
    if (l.share_value !== undefined && l.share_value !== null && !l.okr_key_result_id) out[at("share_value")] = ["Link a key result"];
    if (l.source === "key_result" && !l.okr_key_result_id) out[at("okr_key_result_id")] = ["Link a key result"];
    if (l.source === "function_kpi" && !l.kpi_definition_id) out[at("kpi_definition_id")] = ["Link a KPI"];
    if (l.source === "team_result" && !(l.team_key_result_ids || []).length) out[at("team_key_result_ids")] = ["Pick the key results"];
    for (const krId of l.team_key_result_ids || []) {
      const kr = await repo.keyResultPeriod(db, krId);
      if (!kr || kr.performance_period_id !== card.performance_period_id) out[at("team_key_result_ids")] = ["Not this quarter's"];
    }
    if (l.measure === "milestone" && !l.milestone_due_on) out[at("milestone_due_on")] = ["Pick a date"];
  }
  return out;
}

/** Write a scorecard's lines in order: update those with ids, insert the rest, remove the others. */
async function writeLines(client, card, lines) {
  const keep = [];
  for (const [i, l] of lines.entries()) {
    const row = {
      scorecard_id: card.scorecard_id,
      employee_id: card.employee_id,
      section: l.section,
      position: i,
      title: l.title,
      measure: l.measure,
      direction: l.direction || "higher",
      unit: l.unit ?? null,
      target_value: l.target_value ?? null,
      target_text: l.target_text ?? null,
      milestone_due_on: l.milestone_due_on ?? null,
      // Home's My Goals lists a person's lines due in the quarter: a line with no date is due at its end.
      due_on: l.milestone_due_on || l.due_on || card.period_ends_on,
      frequency_text: l.frequency_text ?? null,
      weight: l.weight,
      source: l.source || "own",
      okr_key_result_id: l.okr_key_result_id ?? null,
      kpi_definition_id: l.kpi_definition_id ?? null,
      share_value: l.share_value ?? null,
      status: card.status === "draft" ? "draft" : "active",
    };
    let lineId = l.employee_target_id;
    if (lineId) await repo.updateLine(client, lineId, row);
    else lineId = await repo.insertLine(client, row);
    await repo.setTeamKeyResults(client, lineId, l.team_key_result_ids || []);
    keep.push(lineId);
  }
  await repo.deleteLinesExcept(client, card.scorecard_id, keep);
}

/** PUT /performance/scorecards/:id/lines: every line, in order. */
async function saveLines(actor, scope, id, body) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  if (!(await editable(pool, card, actor, scope)))
    throw new AppError("SCORECARD_LOCKED", "This scorecard is binding: change a target instead", 409);
  const existing = new Set((await repo.lines(pool, id)).map((l) => l.employee_target_id));
  for (const l of body.lines)
    if (l.employee_target_id && !existing.has(l.employee_target_id))
      throw new AppError("VALIDATION_FAILED", "A line is not on this scorecard", 422, { lines: ["Not this scorecard's"] });
  const problems = await lineProblems(pool, card, body.lines);
  if (Object.keys(problems).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted lines", 422, problems);
  await tx(async (client) => {
    await writeLines(client, { ...card, period_ends_on: day(card.period_ends_on) }, body.lines);
    await emit(client, {
      key: EVENTS.SCORECARD_LINES_SAVED,
      entity: { type: "scorecard", id },
      actor,
      payload: { scorecard_id: id, employee_id: card.employee_id, lines: body.lines.length },
    });
  });
  return get(id, actor, scope);
}

/** PATCH /performance/scorecards/:id: scope, the reviewer (with a reason), the dotted manager. */
async function update(actor, scope, id, patch) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  const reviewerChange = "reviewer_employee_id" in patch || "reviewer_role_code" in patch;
  if (reviewerChange || "dotted_employee_id" in patch) {
    if (!(await authority.runsTheCycle(actor))) throw new AppError("CAPABILITY_REQUIRED", "Only Operations & People change a reviewer", 403);
  } else if (!(await editable(pool, card, actor, scope))) {
    throw new AppError("SCORECARD_LOCKED", "This scorecard is binding: change a target instead", 409);
  }
  if (patch.reviewer_employee_id && patch.reviewer_employee_id === card.employee_id)
    throw new AppError("VALIDATION_FAILED", "Nobody reviews themselves", 422, { reviewer_employee_id: ["Not themselves"] });
  const change = { ...patch };
  if (patch.reviewer_employee_id) change.reviewer_role_code = null;
  if (patch.reviewer_role_code) change.reviewer_employee_id = null;
  await tx(async (client) => {
    await repo.update(client, id, change);
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.SCORECARD_UPDATED,
      entity: { type: "scorecard", id },
      actor,
      before: cardView(card),
      after: cardView(after),
      payload: { scorecard_id: id, employee_id: card.employee_id, reviewer_changed: reviewerChange },
    });
  });
  return get(id, actor, scope);
}

/** POST /performance/scorecards/:id/agree: the employee or the reviewer, one tap each. */
async function agree(actor, scope, id) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  if (!["binding", "agreed"].includes(card.status))
    throw new AppError("SCORECARD_NOT_BINDING", "The plan is not approved yet", 409);
  const mine = actor && card.employee_id === actor.employee_id;
  const reviewer = await isReviewer(pool, card, actor);
  if (!mine && !reviewer) throw new AppError("PERMISSION_DENIED", "Only the employee and the reviewer agree a scorecard", 403);
  const now = new Date();
  const change = {};
  if (mine && !card.employee_agreed_at) change.employee_agreed_at = now;
  if (reviewer && !card.reviewer_agreed_at) {
    change.reviewer_agreed_at = now;
    // The first holder of a reviewing role to act becomes the reviewer (§6.13).
    if (card.reviewer_role_code && !card.reviewer_employee_id) {
      change.reviewer_employee_id = actor.employee_id;
      change.reviewer_role_code = null;
    }
  }
  if (!Object.keys(change).length) return get(id, actor, scope);
  // A scorecard with no reviewer (the CEO's) is agreed on its employee's agreement alone (§6.6).
  const noReviewer = !card.reviewer_employee_id && !card.reviewer_role_code;
  const both = (change.employee_agreed_at || card.employee_agreed_at) && (noReviewer || change.reviewer_agreed_at || card.reviewer_agreed_at);
  if (both) change.status = "agreed";
  await tx(async (client) => {
    await repo.update(client, id, change);
    await emit(client, {
      key: EVENTS.SCORECARD_AGREED,
      entity: { type: "scorecard", id },
      actor,
      payload: {
        scorecard_id: id,
        employee_id: card.employee_id,
        reviewer_employee_id: card.reviewer_employee_id || change.reviewer_employee_id || null,
        by: mine ? "employee" : "reviewer",
        agreed: Boolean(both),
        period: card.period_name,
      },
    });
  });
  return get(id, actor, scope);
}

/** POST /performance/scorecards/:id/disagree: clears both agreements and tells the reviewer. */
async function disagree(actor, scope, id, body) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  if (!["binding", "agreed"].includes(card.status))
    throw new AppError("SCORECARD_NOT_BINDING", "The plan is not approved yet", 409);
  const mine = actor && card.employee_id === actor.employee_id;
  if (!mine && !(await isReviewer(pool, card, actor)))
    throw new AppError("PERMISSION_DENIED", "Only the employee and the reviewer agree a scorecard", 403);
  await tx(async (client) => {
    await repo.update(client, id, {
      status: "binding",
      employee_agreed_at: null,
      reviewer_agreed_at: null,
      disagreed_at: new Date(),
      disagree_reason: body.disagree_reason,
    });
    await emit(client, {
      key: EVENTS.SCORECARD_DISAGREED,
      entity: { type: "scorecard", id },
      actor,
      payload: {
        scorecard_id: id,
        employee_id: card.employee_id,
        reviewer_employee_id: card.reviewer_employee_id,
        reviewer_employee_ids: card.reviewer_employee_id
          ? [card.reviewer_employee_id]
          : card.reviewer_role_code
            ? (await repo.roleHolders(client, card.reviewer_role_code)).filter((e) => e !== card.employee_id)
            : [],
        reason: body.disagree_reason,
        by: mine ? "employee" : "reviewer",
      },
    });
  });
  return get(id, actor, scope);
}

/** GET /performance/contributions */
async function contributions(query) {
  const page = await repo.contributionsPage(pool, query);
  return { ...page, data: page.data.map(weights.contribution) };
}

/* ------------------------------------------------------------------ *
 * A mid-quarter scorecard: Send Scorecard and its amendment (§11)
 * ------------------------------------------------------------------ */

/**
 * POST /performance/scorecards/:id/submit: Send Scorecard. A scorecard drafted after its plan bound
 * goes through the plan's chain alone, as an amendment of the function's plan.
 */
async function submit(actor, scope, id) {
  const card = await repo.get(pool, id);
  if (!card) throw notFound();
  const plan = card.department_id ? await plans.planFor(pool, card.performance_period_id, card.department_id) : null;
  if (!plan || plan.status !== "binding") throw new AppError("PLAN_NOT_BINDING", "Send the function's plan instead", 409);
  if (!(await editable(pool, card, actor, scope))) throw new AppError("SCORECARD_LOCKED", "This scorecard is already sent", 409);
  const views = (await repo.lines(pool, id)).map((l) => lineView(l, []));
  const problems = weights.weightProblems(card, views);
  if (problems.length)
    throw new AppError("WEIGHTS_NOT_100", "Each section's weights must add up first", 409, {
      problems: problems.map((w) => `${w.section} weights add to ${w.total}, not ${w.expected}`),
    });
  const goalsRepo = require("../goals/goals.repo");
  const organisation = require("../organisation/organisation.service");
  const head = await organisation.headOf(pool, card.department_id);
  const headManager = head ? await goalsRepo.effectiveManagerOf(pool, head) : null;
  const context = {
    head_reports_to_ceo: !headManager || (await goalsRepo.isCeoEmployee(pool, headManager)),
    by_operations_people: Boolean(actor && (actor.role_ids || []).length && (await goalsRepo.holdsRoleCode(pool, actor.role_ids, "operations_people"))),
    is_company: false,
  };
  await tx(async (client) => {
    await workflow.openInstance(client, {
      definition_key: "performance.plan",
      entity: { type: "scorecard", id },
      subject_employee_id: head,
      context,
      actor,
      exclude_employee_ids: [card.employee_id],
    });
    await emit(client, {
      key: EVENTS.SCORECARD_SENT,
      entity: { type: "scorecard", id },
      actor,
      payload: { scorecard_id: id, employee_id: card.employee_id, subject_employee_id: card.employee_id, period: card.period_name },
    });
  });
  return get(id, actor, scope);
}

/**
 * The amendment's approval finished: approved binds the scorecard alone and asks both sides to
 * agree; refused leaves it a draft to change and send again. Safe to run again.
 */
async function settleAmendment(id, { state, reason = null, opened_by: openedBy = null }) {
  return tx(async (client) => {
    const card = await repo.get(client, id);
    if (!card || card.status !== "draft") return null;
    const approved = state === "approved" || state === "timeout_approved";
    if (approved) {
      await repo.update(client, id, { status: "binding" });
      await client.query("UPDATE employee_target SET status = 'active' WHERE scorecard_id = $1 AND status = 'draft'", [id]);
      await emit(client, {
        key: EVENTS.SCORECARD_BOUND,
        entity: { type: "scorecard", id },
        actor: null,
        after: { status: "binding" },
        payload: { scorecard_id: id, employee_id: card.employee_id, period: card.period_name },
      });
      await scheduleAgreementReminders(client, [{ scorecard_id: id }]);
    }
    if (state === "cancelled") return null;
    const { rows } = await client.query("SELECT employee_id FROM app_user WHERE user_id = $1", [openedBy]);
    await emit(client, {
      key: EVENTS.SCORECARD_AMENDMENT_DECIDED,
      entity: { type: "scorecard", id },
      actor: null,
      payload: {
        scorecard_id: id,
        employee_id: card.employee_id,
        subject_employee_id: card.employee_id,
        approved,
        reason,
        period: card.period_name,
        employee_name: card.employee ? card.employee.display_name : null,
        tell_employee_ids: approved
          ? [card.employee_id, card.reviewer_employee_id].filter(Boolean)
          : [rows[0] ? rows[0].employee_id : null].filter(Boolean),
      },
    });
    return approved ? "binding" : "returned";
  });
}

/**
 * A leaver's scorecards not yet closed close (§11), in the caller's transaction: no round reviews
 * them again and a draft's waiting amendment is withdrawn. Their lines, scores and commitments stay
 * as they are, so the quarter still reports them. Returns how many closed.
 */
async function closeOfLeaver(client, employeeId) {
  const reminders = require("../notifications/notifications.reminders");
  const cards = await repo.runningOf(client, employeeId);
  for (const card of cards) {
    const open = card.status === "draft" ? await amendmentOf(client, card.scorecard_id) : null;
    if (open) await workflow.cancel(client, { instance_id: open.workflow_instance_id, actor: { user_id: open.opened_by }, reason: "The employee left" });
    await repo.update(client, card.scorecard_id, { status: "closed" });
    await reminders.cancel(client, { key: AGREE_REMINDER, entity: { type: "scorecard", id: card.scorecard_id } });
    await emit(client, {
      key: EVENTS.SCORECARD_CLOSED,
      entity: { type: "scorecard", id: card.scorecard_id },
      actor: null,
      before: { status: card.status },
      after: { status: "closed" },
      payload: { scorecard_id: card.scorecard_id, employee_id: employeeId, period: card.period_name },
    });
  }
  return cards.length;
}

/* ------------------------------------------------------------------ *
 * What a plan's approval and a target change do to scorecards (goals.approval.js)
 * ------------------------------------------------------------------ */

/**
 * A function's plan bound: its draft scorecards bind with it, and each side is asked to agree.
 * In the caller's transaction. Returns the scorecards that bound.
 */
async function bindDepartment(client, { performance_period_id: periodId, department_id: departmentId, period }) {
  const bound = await repo.setStatusOfDepartment(client, periodId, departmentId, "draft", "binding");
  for (const card of bound)
    await emit(client, {
      key: EVENTS.SCORECARD_BOUND,
      entity: { type: "scorecard", id: card.scorecard_id },
      actor: null,
      after: { status: "binding" },
      payload: { scorecard_id: card.scorecard_id, employee_id: card.employee_id, period },
    });
  await scheduleAgreementReminders(client, bound);
  return bound;
}

/** An approved target change on a line takes effect (§6.7). In the caller's transaction. */
async function applyTargetChange(client, { employee_target_id: lineId, target_value: value, target_text: text, target_change_id: changeId }) {
  const line = await repo.lineWithCard(client, lineId);
  if (!line) return;
  await repo.updateLine(client, lineId, { target_value: value ?? null, target_text: text ?? null });
  await emit(client, {
    key: EVENTS.SCORECARD_LINE_TARGET_CHANGED,
    entity: { type: "scorecard", id: line.scorecard_id },
    actor: null,
    before: { target_value: line.target_value, target_text: line.target_text },
    after: { target_value: value ?? null, target_text: text ?? null },
    payload: { scorecard_id: line.scorecard_id, employee_target_id: lineId, employee_id: line.employee_id, target_change_id: changeId },
  });
}

/* ------------------------------------------------------------------ *
 * The agreement reminder (§6.6)
 * ------------------------------------------------------------------ */

/**
 * When a plan binds: ask each of its scorecards' two sides daily, from 3 business days after
 * binding at 09:00, in the working day, until both agree. In the caller's transaction.
 * @param {Array<{scorecard_id: string}>} cards  the scorecards that just became binding
 */
async function scheduleAgreementReminders(client, cards, boundAt = new Date()) {
  if (!cards.length) return;
  const reminders = require("../notifications/notifications.reminders");
  const workingWeek = require("../../shared/time/working-week");
  const lagos = require("../../shared/time/lagos");
  const cal = await workingWeek.loadCalendar(client);
  const at = lagos.instant(workingWeek.addBusinessDays(lagos.dateOf(boundAt), 3, cal), "09:00");
  for (const card of cards)
    await reminders.schedule(client, {
      key: AGREE_REMINDER,
      entity: { type: "scorecard", id: card.scorecard_id },
      occurrence: "agree",
      at,
      every_minutes: 24 * 60,
      work_hours: true,
      payload: {},
    });
}

/** The reminder's `check`, in the firing's transaction: still binding, and who has not agreed. */
async function agreementCheck(client, row) {
  const card = await repo.get(client, row.entity_id);
  if (!card || card.status !== "binding") return null;
  const reviewers = card.reviewer_agreed_at
    ? []
    : card.reviewer_employee_id
      ? [card.reviewer_employee_id]
      : card.reviewer_role_code
        ? (await repo.roleHolders(client, card.reviewer_role_code)).filter((e) => e !== card.employee_id)
        : [];
  const waiting = [...(card.employee_agreed_at ? [] : [card.employee_id]), ...reviewers];
  if (!waiting.length) return null;
  const view = cardView(card);
  return {
    entity: { type: "scorecard", id: card.scorecard_id },
    payload: {
      scorecard_id: card.scorecard_id,
      employee_id: card.employee_id,
      employee_name: view.employee ? view.employee.display_name : "A",
      period: card.period_name,
      waiting_employee_ids: waiting,
    },
  };
}

/* ------------------------------------------------------------------ *
 * The scorecards workbook import (§6.19)
 * ------------------------------------------------------------------ */

const sameText = (a, b) => (a === null || a === undefined ? null : String(a)) === (b === null || b === undefined ? null : String(b));
const LINE_FIELDS = [
  "section", "title", "measure", "target_value", "target_text", "milestone_due_on", "due_on", "frequency_text", "weight",
  "source", "okr_key_result_id", "kpi_definition_id",
];

/**
 * One line of a person's scorecard from the workbook, in the import's transaction: the person's
 * scorecard made the first time (agreed: the workbook's were signed in September), its reviewer,
 * dotted line and scope as the sheet names them, and the line at its number made or brought up
 * to the sheet. A row that changes nothing answers `none`.
 * @param {object} r  performance_period_id, employee_id, reviewer_employee_id (undefined: their
 *   manager), dotted_employee_id, scope_text, position (from 1), and the line's LINE_FIELDS
 * @returns {Promise<{id: string, action: "create"|"update"|"none"}>}
 */
async function importLine(client, actor, r) {
  const period = await plans.periodOf(client, r.performance_period_id);
  let card = await repo.ofPerson(client, period.performance_period_id, r.employee_id);
  let wrote = false;
  if (!card) {
    const person = await repo.personFacts(client, r.employee_id);
    if (!person || person.status !== "active")
      throw new AppError("VALIDATION_FAILED", "They do not work here now", 422, { employee: ["Not active"] });
    if (person.department_id) await plans.ensurePlan(client, period.performance_period_id, person.department_id);
    const sections = period.rules.sections;
    const now = new Date();
    const cardId = await repo.insert(client, {
      performance_period_id: period.performance_period_id,
      employee_id: r.employee_id,
      department_id: person.department_id,
      reviewer_employee_id: person.is_ceo ? null : r.reviewer_employee_id === undefined ? person.manager_id || null : r.reviewer_employee_id,
      dotted_employee_id: r.dotted_employee_id || person.dotted_manager_id || null,
      scope_text: r.scope_text || null,
      status: "agreed",
      employee_agreed_at: now,
      reviewer_agreed_at: now,
      results_weight: sections.results,
      kpis_weight: sections.kpis,
      accountability_weight: sections.accountability,
    });
    card = await repo.get(client, cardId);
    await emit(client, {
      key: EVENTS.SCORECARD_CREATED,
      entity: { type: "scorecard", id: cardId },
      actor,
      after: cardView(card),
      payload: { scorecard_id: cardId, employee_id: r.employee_id, subject_employee_id: r.employee_id, period: period.name, imported: true },
    });
    wrote = true;
  }
  const row = {
    scorecard_id: card.scorecard_id,
    employee_id: r.employee_id,
    position: r.position - 1,
    direction: "higher",
    status: card.status === "draft" ? "draft" : "active",
    ...Object.fromEntries(LINE_FIELDS.map((k) => [k, r[k] ?? null])),
    due_on: r.due_on || day(period.ends_on),
  };
  const held = (await repo.lines(client, card.scorecard_id)).find((l) => l.position === r.position - 1);
  let id;
  let action = "update";
  if (!held) {
    id = await repo.insertLine(client, row);
    action = "create";
    wrote = true;
  } else {
    id = held.employee_target_id;
    const changed = LINE_FIELDS.filter((k) => !sameText(k.endsWith("_on") ? day(held[k]) : held[k], row[k]));
    if (changed.length) {
      await repo.updateLine(client, id, row);
      wrote = true;
    }
  }
  if (!wrote) return { id, action: "none" };
  await emit(client, {
    key: EVENTS.SCORECARD_LINES_SAVED,
    entity: { type: "scorecard", id: card.scorecard_id },
    actor,
    payload: { scorecard_id: card.scorecard_id, employee_id: r.employee_id, lines: 1, imported: true },
  });
  return { id, action };
}

/** Revert an imported line: it goes, and its scorecard with it when no line is left. */
async function removeImportedLine(client, actor, id) {
  const line = await repo.lineWithCard(client, id);
  if (!line) return;
  const rest = (await repo.lines(client, line.scorecard_id)).filter((l) => l.employee_target_id !== id).map((l) => l.employee_target_id);
  await repo.deleteLinesExcept(client, line.scorecard_id, rest);
  if (!rest.length) await repo.remove(client, line.scorecard_id);
  await emit(client, {
    key: EVENTS.SCORECARD_LINES_SAVED,
    entity: { type: "scorecard", id: line.scorecard_id },
    actor,
    payload: { scorecard_id: line.scorecard_id, employee_id: line.employee_id, lines: rest.length },
  });
}

module.exports = {
  bindDepartment,
  applyTargetChange,
  mayRead,
  mayChangeLineTarget,
  closeOfLeaver,
  scheduleAgreementReminders,
  agreementCheck,
  importLine,
  removeImportedLine,
  cardView,
  lineView,
  isReviewer,
  list,
  get,
  detail,
  create,
  writeLines,
  saveLines,
  update,
  agree,
  disagree,
  contributions,
  submit,
  settleAmendment,
};
