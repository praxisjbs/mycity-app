"use strict";
/**
 * Objectives and key results, Report Month and Confirm Score (docs/guides/performance.md §6.1,
 * §6.3, §6.7, §6.8).
 *
 * The tree is edited while its plan is a draft, returned, unbound or awaiting approval (§6.4, §6.22):
 * codes are given then (G1) and freeze when it binds; an unbound plan adds new ones and changes no code
 * already given, and what is added to a plan already sent joins it, its approval carrying on. A
 * binding key result changes only through a target change. Each month the head reports the
 * function's key results and KPIs in one save; a score under the Watch band needs a recovery owner
 * and date. A company key result Scored From a function key result takes its month, so nothing is
 * entered twice. The CEO confirms each month's score; the confirmed score counts, else the
 * proposed one shows.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const lagos = require("../../shared/time/lagos");
const { scoring } = require("@mycity/contract");
const { scopeFor } = require("../../middleware/rbac");
const authority = require("./goals.authority");
const share = require("./goals.share");
const visibility = require("./goals.visibility");
const cascade = require("./goals.cascade");
const plans = require("./goals.plans");
const { traceOf } = require("./goals.trace");
const repo = require("./goals.repo");
const { EVENTS } = require("./goals.events");

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
const notFound = (what = "That key result") => new AppError("NOT_FOUND", `${what} does not exist`, 404);
const MAX_KEY_RESULTS = 4;

/** An okr_key_result_month row as KeyResultMonth, with the band its score sits in. */
function monthView(m, rules = scoring.DEFAULT_RULES) {
  if (!m) return null;
  const score = m.confirmed_score ?? m.proposed_score ?? null;
  return {
    okr_key_result_month_id: m.okr_key_result_month_id,
    okr_key_result_id: m.okr_key_result_id,
    month: day(m.month),
    status: m.status,
    actual_value: m.actual_value,
    actual_text: m.actual_text,
    actual_source: m.actual_source,
    update_text: m.update_text,
    recovery_employee_id: m.recovery_employee_id,
    recovery_due_on: day(m.recovery_due_on),
    proposed_score: m.proposed_score === null ? null : scoring.formatScore(Number(m.proposed_score)),
    confirmed_score: m.confirmed_score === null ? null : scoring.formatScore(Number(m.confirmed_score)),
    confirmed_at: iso(m.confirmed_at),
    score: score === null ? null : scoring.formatScore(Number(score)),
    band: scoring.krBand(score, (rules && rules.key_results) || scoring.DEFAULT_RULES.key_results),
    confirmed: m.confirmed_score !== null && m.confirmed_score !== undefined,
  };
}

/** A key result row (with its latest month) as KeyResult. */
function keyResultView(kr, latest = null, rules) {
  return {
    okr_key_result_id: kr.okr_key_result_id,
    okr_objective_id: kr.okr_objective_id,
    code: kr.code,
    statement: kr.statement,
    kr_type: kr.kr_type,
    measure: kr.measure,
    direction: kr.direction,
    unit: kr.unit,
    baseline_text: kr.baseline_text,
    target_value: kr.target_value,
    target_text: kr.target_text,
    parts: kr.parts || null,
    starts_on: day(kr.starts_on),
    finishes_on: day(kr.finishes_on),
    accountable: kr.accountable,
    co_accountable: kr.co_accountable,
    accountable_note: kr.accountable_note,
    scored_from_key_result_id: kr.scored_from_key_result_id,
    linked_company_key_results: kr.linked_company_key_results || [],
    position: kr.position,
    latest: monthView(latest, rules),
  };
}

/**
 * Objective rows with their key results and latest months, as Objective, banded by their quarter's
 * rules. `can_edit` is the reader's: a draft, returned, unbound or awaiting plan whose goals they set (none without one).
 */
async function withKeyResults(db, objectives, until = null, actor = null) {
  const krs = await repo.keyResultsOf(db, objectives.map((o) => o.okr_objective_id));
  const sharing = actor ? await share.sharingOf(actor, "objective", objectives) : new Map();
  const months = await repo.latestMonths(db, krs.map((k) => k.okr_key_result_id), until);
  const latestOf = new Map(months.map((m) => [m.okr_key_result_id, m]));
  const rulesOf = new Map();
  for (const periodId of new Set(objectives.map((o) => o.performance_period_id)))
    rulesOf.set(periodId, (await plans.periodOf(db, periodId)).rules);
  const setsFor = new Map();
  if (actor)
    for (const departmentId of new Set(objectives.filter((o) => plans.isEditable(o.plan_status)).map((o) => o.department_id)))
      setsFor.set(departmentId, await authority.maySetGoals(db, actor, departmentId));
  return objectives.map((o) => {
    const rules = rulesOf.get(o.performance_period_id);
    // An objective the reader reaches only through a key result they own is shown with that key result alone (§6.23).
    const partial = o.reader_open === false;
    const owns = (k) => Boolean(actor && actor.employee_id) && [k.accountable_employee_id, k.co_accountable_employee_id].includes(actor.employee_id);
    const mine = krs
      .filter((k) => k.okr_objective_id === o.okr_objective_id && (!partial || owns(k)))
      .map((k) => keyResultView(k, latestOf.get(k.okr_key_result_id), rules));
    return {
      okr_objective_id: o.okr_objective_id,
      performance_period_id: o.performance_period_id,
      performance_plan_id: o.performance_plan_id,
      department_id: o.department_id,
      department: o.department,
      code: o.code,
      title: o.title,
      organisational_goal_id: o.organisational_goal_id,
      position: o.position,
      plan_status: o.plan_status,
      score: partial ? null : scoring.formatScore(cascade.objectiveScore(mine)),
      key_results: mine,
      can_edit: plans.isEditable(o.plan_status) && setsFor.get(o.department_id) === true,
      ...(sharing.get(o.okr_objective_id) || { can_share: false, share: null }),
    };
  });
}

/** GET /performance/okrs */
async function listOkrs(query, actor = null) {
  const page = await repo.listObjectives(pool, query, await visibility.readerOf(pool, actor));
  return { ...page, data: await withKeyResults(pool, page.data, null, actor) };
}

/**
 * GET /performance/key-results: a quarter's key results for a picker, 25 a page. A function's within the
 * reader's reach; the company's, by code and statement alone, for whoever sets goals, so a head can say
 * which company key result theirs feeds (§6.23).
 */
async function listKeyResults(query, actor = null) {
  const reach = await visibility.readerOf(pool, actor);
  const pickCompany =
    reach.full ||
    (await authority.holds(actor, "goals.function")) ||
    (await authority.holds(actor, "goals.company")) ||
    (await authority.runsTheCycle(actor));
  return repo.listKeyResultRefs(pool, query, reach, pickCompany);
}

/**
 * GET /performance/okrs/summary: the Goals figures over the whole quarter, not a page of it. The
 * company score is the mean of the company objectives' scores whatever the function; the counts
 * are the function's key results (or every key result) by their latest month.
 */
async function okrSummary(query, actor = null) {
  const reach = await visibility.readerOf(pool, actor);
  const objectives = await withKeyResults(pool, await repo.objectivesOfPeriod(pool, query.period_id, reach), null, actor);
  // The company's score is the whole plan's alone; the functions' mean is whatever functions the reader reads.
  const company = reach.full ? objectives.filter((o) => o.department_id === null && o.score !== null).map((o) => Number(o.score)) : [];
  const functionScores = objectives
    .filter((o) => o.department_id !== null && o.score !== null && (!query.department_id || query.department_id === o.department_id))
    .map((o) => Number(o.score));
  const wanted =
    query.department_id === "company"
      ? objectives.filter((o) => o.department_id === null)
      : query.department_id
        ? objectives.filter((o) => o.department_id === query.department_id)
        : objectives;
  const krs = wanted.flatMap((o) => o.key_results);
  return {
    company_score: company.length ? scoring.formatScore(company.reduce((a, b) => a + b, 0) / company.length) : null,
    function_score: functionScores.length ? scoring.formatScore(functionScores.reduce((a, b) => a + b, 0) / functionScores.length) : null,
    key_results: krs.length,
    on_track: krs.filter((k) => k.latest && k.latest.band === "good").length,
    in_recovery: krs.filter((k) => k.latest && k.latest.band === "recovery").length,
    awaiting_report: krs.filter((k) => !k.latest).length,
  };
}

/** A plan's objectives with their key results. */
async function objectivesOfPlan(db, planId, actor = null) {
  return withKeyResults(db, await repo.objectivesOfPlan(db, planId), null, actor);
}

/**
 * Refuse a change to a plan that is not editable: a binding one (a draft, returned, unbound or awaiting
 * plan is, §6.4, §6.22). `field` names the form field at fault when there is one (New Objective's
 * Function), so the refusal is marked there, not only said.
 */
function assertOpen(plan, field = null) {
  if (!plans.isEditable(plan.status))
    throw new AppError(
      "PLAN_BINDING",
      "This plan is binding: change a target instead",
      409,
      field ? { [field]: ["Plan is binding"] } : undefined,
    );
}

/** POST /performance/objectives. `opts.code` and `opts.system` are for the importer. */
async function createObjective(actor, body, opts = {}) {
  const departmentId = body.department_id || null;
  if (!opts.system) await authority.assertSetsGoals(pool, actor, departmentId);
  const id = await tx(async (client) => {
    const period = await plans.periodOf(client, body.performance_period_id);
    if (period.status === "closed") throw new AppError("PERIOD_CLOSED", "That quarter is closed", 409);
    const plan = await plans.ensurePlan(client, period.performance_period_id, departmentId);
    if (!opts.system) assertOpen(plan, "department_id");
    let prefix = "CO";
    if (departmentId) {
      const { rows } = await client.query("SELECT code::text AS code FROM department WHERE department_id = $1", [departmentId]);
      if (!rows[0]) throw new AppError("VALIDATION_FAILED", "Pick a function that exists", 422, { department_id: ["Not a function"] });
      prefix = rows[0].code;
    }
    const code = opts.code || cascade.nextObjectiveCode(prefix, await repo.objectiveCodes(client, period.performance_period_id, prefix));
    const position = body.position ?? (await repo.objectivesOfPlan(client, plan.performance_plan_id)).length;
    const newId = await repo.insertObjective(client, {
      performance_period_id: period.performance_period_id,
      performance_plan_id: plan.performance_plan_id,
      department_id: departmentId,
      code,
      title: body.title,
      organisational_goal_id: body.organisational_goal_id || null,
      position,
    });
    await emit(client, {
      key: EVENTS.OBJECTIVE_SAVED,
      entity: { type: "objective", id: newId },
      actor,
      after: { code, title: body.title },
      payload: { okr_objective_id: newId, code, title: body.title, department_id: departmentId },
    });
    return newId;
  });
  return getObjective(id, actor);
}

/**
 * One objective with its key results. With an actor the reader's reach decides (404 outside it, and only the
 * key results they own when that is all they reach, §6.23); without, it is the system's own read.
 */
async function getObjective(id, actor = null) {
  const row = await repo.getObjective(pool, id);
  if (!row) throw notFound("That objective");
  if (actor) {
    const access = await visibility.assertObjective(pool, await visibility.readerOf(pool, actor), id);
    row.reader_open = access.open;
  }
  return (await withKeyResults(pool, [row], null, actor))[0];
}

/** PATCH /performance/objectives/:id */
async function updateObjective(actor, id, patch) {
  const before = await repo.getObjective(pool, id);
  if (!before) throw notFound("That objective");
  await authority.assertSetsGoals(pool, actor, before.department_id);
  assertOpen({ status: before.plan_status });
  await tx(async (client) => {
    await repo.updateObjective(client, id, patch);
    await emit(client, {
      key: EVENTS.OBJECTIVE_SAVED,
      entity: { type: "objective", id },
      actor,
      before,
      after: { ...before, ...patch },
      payload: { okr_objective_id: id, code: before.code, title: patch.title || before.title, department_id: before.department_id },
    });
  });
  return getObjective(id, actor);
}

/** What an unbound plan never deletes (§6.22): a key result with a reported month, or one a line, Team result, change, initiative or company key result depends on. */
const HELD = Object.freeze({
  key_result: {
    reported: "This key result has a reported month",
    in_use: "Something depends on this key result",
  },
  objective: {
    reported: "A key result of this objective has a reported month",
    in_use: "Something depends on a key result of this objective",
  },
});

function refuseHeld(holds, what) {
  if (holds.reported) throw new AppError("KEY_RESULT_REPORTED", HELD[what].reported, 409);
  if (holds.in_use) throw new AppError("KEY_RESULT_IN_USE", HELD[what].in_use, 409);
}

/** DELETE /performance/objectives/:id: an editable plan's objective, with its key results. */
async function deleteObjective(actor, id) {
  const before = await repo.getObjective(pool, id);
  if (!before) throw notFound("That objective");
  await authority.assertSetsGoals(pool, actor, before.department_id);
  assertOpen({ status: before.plan_status });
  if (plans.isAmended(before.plan_status)) refuseHeld(await repo.objectiveHolds(pool, id), "objective");
  // A plan awaiting approval was sent with something to approve: it never loses its last objective.
  if (plans.isAwaiting(before.plan_status) && (await repo.objectivesOfPlan(pool, before.performance_plan_id)).length <= 1)
    throw new AppError("PLAN_EMPTY", "A plan awaiting approval keeps an objective", 409);
  await tx(async (client) => {
    await repo.deleteObjective(client, id);
    await emit(client, {
      key: EVENTS.OBJECTIVE_DELETED,
      entity: { type: "objective", id },
      actor,
      before,
      payload: { okr_objective_id: id, code: before.code },
    });
  });
}

/** Linked company key results must be company key results of the same quarter. */
async function checkLinks(db, objective, body) {
  const out = {};
  for (const id of body.linked_company_key_result_ids || []) {
    const c = await repo.keyResultContext(db, id);
    if (!c || c.department_id !== null || c.performance_period_id !== objective.performance_period_id)
      out.linked_company_key_result_ids = ["Pick company key results of this quarter"];
  }
  if (body.scored_from_key_result_id) {
    const f = await repo.keyResultContext(db, body.scored_from_key_result_id);
    if (objective.department_id !== null || !f || f.department_id === null || f.performance_period_id !== objective.performance_period_id)
      out.scored_from_key_result_id = ["A company key result takes a function key result of this quarter"];
  }
  if (body.measure === "multi_part" && !(body.parts || []).length) out.parts = ["Add the parts"];
  if (Object.keys(out).length) throw new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, out);
}

/** POST /performance/key-results */
async function createKeyResult(actor, body, opts = {}) {
  const objective = await repo.getObjective(pool, body.okr_objective_id);
  if (!objective) throw new AppError("VALIDATION_FAILED", "Pick an objective", 422, { okr_objective_id: ["Not found"] });
  if (!opts.system) {
    await authority.assertSetsGoals(pool, actor, objective.department_id);
    assertOpen({ status: objective.plan_status });
  }
  await checkLinks(pool, objective, body);
  const id = await tx(async (client) => {
    const used = await repo.keyResultCodes(client, objective.okr_objective_id);
    if (used.length >= MAX_KEY_RESULTS && !opts.system)
      throw new AppError("OBJECTIVE_TOO_MANY", "An objective holds at most four key results", 409);
    const code = opts.code || cascade.nextKeyResultCode(objective.code, used);
    const { linked_company_key_result_ids: links = [], ...fields } = body;
    const newId = await repo.insertKeyResult(client, { ...fields, code, position: body.position ?? used.length });
    await repo.setLinks(client, newId, links);
    await emit(client, {
      key: EVENTS.KEY_RESULT_SAVED,
      entity: { type: "key_result", id: newId },
      actor,
      after: { code, statement: body.statement },
      payload: { okr_key_result_id: newId, code, statement: body.statement, department_id: objective.department_id },
    });
    return newId;
  });
  return getKeyResultView(id);
}

async function getKeyResultView(id) {
  const kr = await repo.getKeyResult(pool, id);
  if (!kr) throw notFound();
  const months = await repo.latestMonths(pool, [id]);
  return keyResultView(kr, months[0] || null);
}

/** What a reported month was scored on: an unbound plan keeps it in place once a month is reported (§6.22). */
const SCORED_ON = ["target_value", "target_text", "measure", "direction", "unit", "parts"];

/** A value as text whatever order its keys came in (a jsonb column reads back in its own order). */
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v).sort().map((k) => `${k}:${canonical(v[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);

/** A key result's field as an edit would compare it: a number as a number, parts as their text, a blank as null. */
const comparable = (k, v) => {
  if (v === undefined || v === null || v === "") return null;
  if (k === "target_value") return Number(v);
  return typeof v === "object" ? canonical(v) : String(v);
};

/**
 * An unbound plan's key result with a reported month keeps its target, measure, direction, unit and
 * parts in place: the target changes through Change Target, which keeps the original beside the new one.
 */
async function assertScoredOnHeld(id, patch) {
  const kr = await repo.getKeyResult(pool, id);
  const touched = SCORED_ON.filter((k) => patch[k] !== undefined && comparable(k, patch[k]) !== comparable(k, kr[k]));
  if (!touched.length || !(await repo.keyResultHolds(pool, id)).reported) return;
  throw new AppError(
    "KEY_RESULT_REPORTED",
    "This key result has a reported month: change its target instead",
    409,
    Object.fromEntries(touched.map((k) => [k, ["Use Change Target"]])),
  );
}

/** PATCH /performance/key-results/:id */
async function updateKeyResult(actor, id, patch) {
  const ctx = await repo.keyResultContext(pool, id);
  if (!ctx) throw notFound();
  if (!plans.isEditable(ctx.plan_status))
    throw new AppError("KEY_RESULT_BINDING", "This key result is binding: change its target instead", 409);
  await authority.assertSetsGoals(pool, actor, ctx.department_id);
  if (plans.isAmended(ctx.plan_status)) await assertScoredOnHeld(id, patch);
  const objective = await repo.getObjective(pool, ctx.okr_objective_id);
  await checkLinks(pool, objective, patch);
  await tx(async (client) => {
    const { linked_company_key_result_ids: links, ...fields } = patch;
    await repo.updateKeyResult(client, id, fields);
    if (links) await repo.setLinks(client, id, links);
    await emit(client, {
      key: EVENTS.KEY_RESULT_SAVED,
      entity: { type: "key_result", id },
      actor,
      before: ctx,
      after: { ...ctx, ...fields },
      payload: { okr_key_result_id: id, code: ctx.code, statement: fields.statement || ctx.statement, department_id: ctx.department_id },
    });
  });
  return getKeyResultView(id);
}

/** DELETE /performance/key-results/:id: an editable plan's key result. */
async function deleteKeyResult(actor, id) {
  const ctx = await repo.keyResultContext(pool, id);
  if (!ctx) throw notFound();
  await authority.assertSetsGoals(pool, actor, ctx.department_id);
  assertOpen({ status: ctx.plan_status });
  if (plans.isAmended(ctx.plan_status)) refuseHeld(await repo.keyResultHolds(pool, id), "key_result");
  await tx(async (client) => {
    await repo.deleteKeyResult(client, id);
    await emit(client, {
      key: EVENTS.KEY_RESULT_DELETED,
      entity: { type: "key_result", id },
      actor,
      before: ctx,
      payload: { okr_key_result_id: id, code: ctx.code },
    });
  });
}

/** May the reader ask to change this key result's target? requestChange's checks, as a yes or no. */
async function mayChangeTarget(actor, planStatus, ctx) {
  if (!actor || !plans.isLive(planStatus)) return false;
  if (await repo.changePending(pool, { okr_key_result_id: ctx.okr_key_result_id })) return false;
  if (!(await scopeFor(actor, "performance", "edit"))) return false;
  if (actor.employee_id && actor.employee_id === ctx.accountable_employee_id) return true;
  return authority.maySetGoals(pool, actor, ctx.department_id);
}

/** GET /performance/key-results/:id, with what the reader may do to it. */
async function getKeyResultDetail(id, actor = null) {
  const kr = await repo.getKeyResult(pool, id);
  if (!kr) throw notFound();
  const reach = await visibility.readerOf(pool, actor);
  await visibility.assertKeyResult(pool, reach, id);
  const ctx = await repo.keyResultContext(pool, id);
  const objective = await repo.getObjective(pool, kr.okr_objective_id);
  const [months, contributing, initiatives, changes, path] = await Promise.all([
    repo.monthsOf(pool, id),
    repo.contributing(pool, id, reach),
    repo.initiatives(pool, id),
    repo.changesOf(pool, id),
    readableTrace(pool, reach, id),
  ]);
  const latest = months.length ? months[months.length - 1] : null;
  return {
    ...keyResultView(kr, latest, ctx.rules),
    objective: { okr_objective_id: objective.okr_objective_id, code: objective.code, title: objective.title },
    performance_period_id: objective.performance_period_id,
    department_id: objective.department_id,
    department: objective.department,
    plan_status: objective.plan_status,
    contributing,
    initiatives: initiatives.map((t) => ({ ...t, due_at: iso(t.due_at), completed_at: iso(t.completed_at) })),
    months: months.map((m) => monthView(m, ctx.rules)),
    target_history: changes.map(changeView),
    trace: path,
    can_change_target: await mayChangeTarget(actor, objective.plan_status, ctx),
    can_edit: Boolean(actor) && plans.isEditable(objective.plan_status) && (await authority.maySetGoals(pool, actor, objective.department_id)),
  };
}

/** A target_change row as TargetChange. */
function changeView(c) {
  return {
    target_change_id: c.target_change_id,
    okr_key_result_id: c.okr_key_result_id,
    employee_target_id: c.employee_target_id,
    from_value: c.from_value,
    from_text: c.from_text,
    to_value: c.to_value,
    to_text: c.to_text,
    from_month: day(c.from_month),
    reason: c.reason,
    status: c.status,
    workflow_instance_id: c.workflow_instance_id,
    requested_by: c.requested_by,
    decided_at: iso(c.decided_at),
    created_at: iso(c.created_at),
  };
}

/**
 * A multi-part key result's parts for a report: the stored parts (label, measure, target, due
 * date), with only the actuals the report gives (actual, done on, partly), matched in order. A
 * report never changes a binding key result's parts.
 */
function reportedParts(ctx, r) {
  const stored = ctx.parts || [];
  if (!(r.parts || []).length) return null;
  if (r.parts.length !== stored.length)
    throw new AppError("VALIDATION_FAILED", `${ctx.code} has ${stored.length} parts`, 422, { key_results: [`${ctx.code} has ${stored.length} parts`] });
  return stored.map((p, i) => ({
    ...p,
    actual_value: r.parts[i].actual_value ?? null,
    done_on: r.parts[i].done_on ?? null,
    partly: r.parts[i].partly ?? false,
  }));
}

/**
 * The score a report proposes when the head gives none (§6.8): a number against the target in
 * force that month (`target`), a multi-part key result's parts against their stored targets, Done
 * or Missed.
 */
function proposed(ctx, r, { target = ctx.target_value, parts = null } = {}) {
  if (r.proposed_score !== undefined && r.proposed_score !== null) return r.proposed_score;
  if (ctx.measure === "numeric") return scoring.formatScore(scoring.numericScore({ actual: r.actual_value, target, direction: ctx.direction }));
  if (ctx.measure === "multi_part" && parts) {
    const today = lagos.today();
    const each = parts.map((p) =>
      p.measure === "numeric"
        ? scoring.numericScore({ actual: p.actual_value, target: p.target_value })
        : p.due_on
          ? scoring.datedKrScore({ done_on: p.done_on, due_on: p.due_on, partly: p.partly, today }, ctx.rules.key_results)
          : null,
    );
    return scoring.formatScore(scoring.meanScore(each));
  }
  if (r.status === "done") return "1";
  if (r.status === "missed") return "0";
  return null;
}

/**
 * The months of a key result from `fromMonth` (all when null), not yet confirmed, scored again on its
 * target as it now stands: after a target change. A numeric month needs
 * its actual; a dated month's score rests on its status, so only one left unscored is scored.
 */
async function rescoreFrom(client, keyResultId, fromMonth = null) {
  const ctx = await repo.keyResultContext(client, keyResultId);
  if (!ctx || ctx.measure === "multi_part") return;
  for (const m of await repo.monthsOf(client, keyResultId)) {
    if ((fromMonth && day(m.month) < day(fromMonth)) || m.confirmed_score !== null) continue;
    if (ctx.measure === "numeric" ? m.actual_value === null : m.proposed_score !== null) continue;
    const score = proposed(ctx, { status: m.status, actual_value: m.actual_value });
    if (ctx.measure === "numeric" || score !== null) await repo.setProposedScore(client, keyResultId, m.month, score);
  }
}

/**
 * POST /performance/reports: a function's (or the company's) month in one save (§6.8).
 * @returns {Promise<{month: string, key_results: object[], kpis: object[]}>}
 */
async function reportMonth(actor, body) {
  const departmentId = body.department_id || null;
  const contexts = [];
  for (const r of body.key_results) {
    const ctx = await repo.keyResultContext(pool, r.okr_key_result_id);
    if (!ctx || ctx.department_id !== departmentId)
      throw new AppError("VALIDATION_FAILED", "A key result is not this function's", 422, { key_results: ["Not this function's"] });
    if (!plans.isLive(ctx.plan_status)) throw new AppError("PLAN_NOT_BINDING", "Report a month once the plan is binding", 409);
    contexts.push(ctx);
  }
  if (departmentId) {
    if (!(await authority.runsTheCycle(actor)) && !(await authority.headsFunction(pool, actor, departmentId)))
      throw new AppError("PERMISSION_DENIED", "Only the function's head reports its month", 403);
  } else {
    const anyone = (await authority.runsTheCycle(actor)) || (await authority.holds(actor, "goals.company"));
    if (!anyone && contexts.some((c) => c.accountable_employee_id !== (actor && actor.employee_id)))
      throw new AppError("PERMISSION_DENIED", "Report the company key results you are accountable for", 403);
  }
  const problems = {};
  const reports = [];
  for (const [i, sent] of body.key_results.entries()) {
    const ctx = contexts[i];
    // A month reported again keeps what this report leaves out (an imported actual, a recovery owner).
    const held = await repo.monthOf(pool, ctx.okr_key_result_id, body.month);
    const r = held ? keepReported(held, sent) : sent;
    // A target changed from a later month leaves this month on the target it had (§6.7).
    const then = await repo.targetIn(pool, ctx.okr_key_result_id, body.month);
    const parts = ctx.measure === "multi_part" ? reportedParts(ctx, r) : null;
    const score = proposed(ctx, r, { target: then ? then.value : ctx.target_value, parts });
    const watch = ctx.rules.key_results.band_watch;
    if (score !== null && Number(score) < watch && (!r.recovery_employee_id || !r.recovery_due_on))
      problems[`key_results.${i}.recovery_employee_id`] = ["Name owner and date"];
    reports.push({ ...r, parts, month: body.month, proposed_score: score });
  }
  if (Object.keys(problems).length) throw new AppError("RECOVERY_REQUIRED", "A key result in Recovery needs an owner and date", 422, problems);

  const kpis = require("../kpis/kpis.service");
  return tx(async (client) => {
    const out = { month: body.month, key_results: [], kpis: [] };
    for (const [i, r] of reports.entries()) {
      const ctx = contexts[i];
      await repo.upsertMonth(client, ctx.okr_key_result_id, r, actor && actor.user_id);
      // The actuals ride on the stored parts; their definitions stay as bound.
      if (r.parts) await repo.updateKeyResult(client, ctx.okr_key_result_id, { parts: r.parts });
      // A company key result wholly delivered by this one takes its month.
      for (const companyId of await repo.scoredFrom(client, ctx.okr_key_result_id))
        await repo.upsertMonth(client, companyId, r, actor && actor.user_id);
      const m = await repo.monthOf(client, ctx.okr_key_result_id, body.month);
      out.key_results.push(monthView(m, ctx.rules));
      await emit(client, {
        key: EVENTS.KEY_RESULT_REPORTED,
        entity: { type: "key_result", id: ctx.okr_key_result_id },
        actor,
        after: m,
        payload: { okr_key_result_id: ctx.okr_key_result_id, code: ctx.code, month: body.month, status: r.status, proposed_score: r.proposed_score },
      });
    }
    for (const k of body.kpis || []) {
      const { rows } = await client.query(
        "SELECT kpi_definition_id, code::text AS code, department_id FROM kpi_definition WHERE kpi_definition_id = $1",
        [k.kpi_definition_id],
      );
      if (!rows[0] || rows[0].department_id !== departmentId)
        throw new AppError("VALIDATION_FAILED", "A KPI is not this function's", 422, { kpis: ["Not this function's"] });
      out.kpis.push(await kpis.recordIn(client, actor, rows[0], { ...k, month: body.month }));
    }
    return out;
  });
}

/** POST /performance/key-results/:id/confirm: the CEO confirms a month's score. */
async function confirmScore(actor, id, body) {
  const ctx = await repo.keyResultContext(pool, id);
  if (!ctx) throw notFound();
  return tx(async (client) => {
    if (!(await repo.confirmMonth(client, id, body.month, body.score, actor && actor.user_id)))
      throw new AppError("NOT_REPORTED", "That month has not been reported", 409);
    const m = await repo.monthOf(client, id, body.month);
    await emit(client, {
      key: EVENTS.KEY_RESULT_SCORE_CONFIRMED,
      entity: { type: "key_result", id },
      actor,
      after: m,
      payload: { okr_key_result_id: id, code: ctx.code, month: body.month, score: body.score },
    });
    // A company key result Scored From this one takes the confirmed score too: nothing is confirmed twice (§6.8).
    for (const companyId of await repo.scoredFrom(client, id)) {
      if (!(await repo.confirmMonth(client, companyId, body.month, body.score, actor && actor.user_id))) continue;
      const company = await repo.monthOf(client, companyId, body.month);
      await emit(client, {
        key: EVENTS.KEY_RESULT_SCORE_CONFIRMED,
        entity: { type: "key_result", id: companyId },
        actor,
        after: company,
        payload: { okr_key_result_id: companyId, month: body.month, score: body.score, scored_from: id },
      });
    }
    return monthView(m, ctx.rules);
  });
}

/** GET /performance/key-results/:id/trace */
async function trace(id, actor = null) {
  if (!(await repo.getKeyResult(pool, id))) throw notFound();
  const reach = await visibility.readerOf(pool, actor);
  await visibility.assertKeyResult(pool, reach, id);
  return readableTrace(pool, reach, id);
}

/**
 * What a key result rolls up to, as far as the reader may read it (§6.23): the company key result it feeds
 * by code and statement, then its objective and the organisational goal only where they are the reader's.
 */
async function readableTrace(db, reach, id) {
  const { steps } = await traceOf(db, id);
  const kept = [];
  for (const step of steps) {
    if (step.kind === "objective") {
      const access = await visibility.objectiveAccess(db, reach, step.id);
      if (!access || !access.readable) continue;
    } else if (step.kind === "organisational_goal") {
      try {
        await visibility.assertGoal(db, reach, step.id);
      } catch (err) {
        if (err.code === "NOT_FOUND") continue;
        throw err;
      }
    }
    kept.push(step);
  }
  return { steps: kept };
}

/* ------------------------------------------------------------------ *
 * The OKR workbook import (§6.19)
 * ------------------------------------------------------------------ */

/** The key result fields a workbook row sets. */
const IMPORTED = [
  "statement", "kr_type", "measure", "baseline_text", "starts_on", "finishes_on",
  "accountable_employee_id", "co_accountable_employee_id", "accountable_note",
];

const sameValue = (a, b) => (a instanceof Date ? day(a) : a ?? null) === (b instanceof Date ? day(b) : b ?? null);

/** A month's figures from the workbook against what is held: anything to write? */
const monthDiffers = (held, m) =>
  !held || held.status !== m.status || (held.actual_text ?? null) !== (m.actual_text ?? null) ||
  (held.update_text ?? null) !== (m.update_text ?? null) ||
  (held.proposed_score === null ? null : Number(held.proposed_score)) !== (m.proposed_score ?? null);

/** A month reported again in the app: each figure the report leaves out stays as held. */
const keepReported = (held, r) => ({
  ...r,
  actual_value: r.actual_value ?? held.actual_value,
  actual_text: r.actual_text ?? held.actual_text,
  actual_source: r.actual_source ?? held.actual_source,
  update_text: r.update_text ?? held.update_text,
  recovery_employee_id: r.recovery_employee_id ?? held.recovery_employee_id,
  recovery_due_on: r.recovery_due_on ?? (held.recovery_due_on ? day(held.recovery_due_on) : null),
});

/**
 * A month the workbook reports again, over what is held: what a person reported in the app that the
 * workbook does not hold (a figure, a recovery owner and date, a score, words left blank) stays.
 */
const keepHeld = (held, m) => ({
  ...m,
  // A status the workbook does not state (a scored month's, or a blank Status cell) stays as reported.
  status: m.status_given === false ? held.status : m.status,
  actual_value: held.actual_value,
  actual_text: m.actual_text ?? held.actual_text,
  update_text: m.update_text ?? held.update_text,
  recovery_employee_id: held.recovery_employee_id,
  recovery_due_on: held.recovery_due_on,
  proposed_score: m.proposed_score ?? (held.proposed_score === null ? null : Number(held.proposed_score)),
});

/**
 * One key result of the OKR workbook, in the import's transaction: its objective made or renamed,
 * the key result made or brought up to the sheet, its links to company key results, its former
 * codes, its months' figures and its dated initiatives (tasks for its owner), and its plan made
 * binding (the workbook's plans were approved in September). A row that changes nothing answers
 * `none`. Plan binding here sends no notices: nobody is asked to agree an imported plan.
 *
 * @param {object} r  the row, resolved: performance_period_id, department_id, objective_code,
 *   objective_title, code, the IMPORTED fields, linked_company_key_result_ids, former_codes,
 *   months [{month, status, actual_text, update_text, proposed_score}], initiatives [{title, due_on}]
 * @param {{task_scope?: object}} opts  the importer's scope for setting tasks
 * @returns {Promise<{id: string, action: "create"|"update"|"none"}>}
 */
async function importKeyResult(client, actor, r, { task_scope: taskScope = null } = {}) {
  const tasks = require("../tasks/tasks.service");
  const period = await plans.periodOf(client, r.performance_period_id);
  const plan = await plans.ensurePlan(client, period.performance_period_id, r.department_id);
  let wrote = false;
  let objective = await repo.objectiveByCode(client, period.performance_period_id, r.objective_code);
  if (!objective) {
    const objectiveId = await repo.insertObjective(client, {
      performance_period_id: period.performance_period_id,
      performance_plan_id: plan.performance_plan_id,
      department_id: r.department_id,
      code: r.objective_code,
      title: r.objective_title,
      organisational_goal_id: null,
      position: (await repo.objectivesOfPlan(client, plan.performance_plan_id)).length,
    });
    await emit(client, {
      key: EVENTS.OBJECTIVE_SAVED,
      entity: { type: "objective", id: objectiveId },
      actor,
      after: { code: r.objective_code, title: r.objective_title },
      payload: { okr_objective_id: objectiveId, code: r.objective_code, title: r.objective_title, department_id: r.department_id },
    });
    objective = { okr_objective_id: objectiveId, title: r.objective_title };
    wrote = true;
  } else if (objective.title !== r.objective_title) {
    await repo.updateObjective(client, objective.okr_objective_id, { title: r.objective_title });
    wrote = true;
  }

  const fields = Object.fromEntries(IMPORTED.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  const found = await repo.keyResultByOwnCode(client, period.performance_period_id, r.code);
  let id;
  let action = "update";
  if (!found) {
    const used = await repo.keyResultCodes(client, objective.okr_objective_id);
    id = await repo.insertKeyResult(client, { okr_objective_id: objective.okr_objective_id, code: r.code, position: used.length, ...fields });
    action = "create";
    wrote = true;
  } else {
    id = found.okr_key_result_id;
    const held = await repo.getKeyResult(client, id);
    const changed = Object.keys(fields).filter((k) => !sameValue(held[k], fields[k]));
    if (changed.length) {
      await repo.updateKeyResult(client, id, Object.fromEntries(changed.map((k) => [k, fields[k]])));
      wrote = true;
    }
    const links = (held.linked_company_key_results || []).map((l) => l.okr_key_result_id).sort();
    if (links.join() !== [...(r.linked_company_key_result_ids || [])].sort().join()) wrote = true;
  }
  await repo.setLinks(client, id, r.linked_company_key_result_ids || []);
  for (const alias of r.former_codes || []) await repo.addAlias(client, period.performance_period_id, alias, { okr_key_result_id: id });

  for (const m of r.months || []) {
    const held = await repo.monthOf(client, id, m.month);
    const month = held ? keepHeld(held, m) : m;
    if (!monthDiffers(held, month)) continue;
    await repo.upsertMonth(client, id, { ...month, actual_source: "OKR workbook" }, actor && actor.user_id);
    wrote = true;
  }

  const owner = r.accountable_employee_id;
  for (const t of owner && taskScope && actor && actor.employee_id ? r.initiatives || [] : []) {
    if (await repo.initiativeExists(client, id, t.title)) continue;
    // An initiative its owner cannot be given (out of the importer's scope) is left out, not the row.
    await client.query("SAVEPOINT okr_initiative");
    try {
      await tasks.create(actor, taskScope, { title: t.title, due_on: t.due_on, primary_assignee_id: owner, entity_type: "key_result", entity_id: id }, { client });
      await client.query("RELEASE SAVEPOINT okr_initiative");
      wrote = true;
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT okr_initiative");
    }
  }

  if (["draft", "returned"].includes(plan.status)) {
    await repo.updatePlan(client, plan.performance_plan_id, { status: "binding", binding_at: new Date() });
    wrote = true;
  }
  if (!wrote) return { id, action: "none" };
  await emit(client, {
    key: EVENTS.KEY_RESULT_SAVED,
    entity: { type: "key_result", id },
    actor,
    after: { code: r.code, statement: r.statement },
    payload: { okr_key_result_id: id, code: r.code, statement: r.statement, department_id: r.department_id, imported: true },
  });
  return { id, action };
}

/** A company key result's Scored From, set once every row of the workbook exists. */
async function importScoredFrom(client, actor, id, fromId) {
  const ctx = await repo.keyResultContext(client, id);
  const from = await repo.keyResultContext(client, fromId);
  if (!ctx || !from || ctx.department_id !== null || from.department_id === null || from.performance_period_id !== ctx.performance_period_id)
    throw new AppError("VALIDATION_FAILED", "A company key result takes a function key result of its quarter", 422, {
      scored_from: ["Not a function key result"],
    });
  if (ctx.scored_from_key_result_id === fromId) return false;
  await repo.updateKeyResult(client, id, { scored_from_key_result_id: fromId });
  await emit(client, {
    key: EVENTS.KEY_RESULT_SAVED,
    entity: { type: "key_result", id },
    actor,
    before: { scored_from_key_result_id: ctx.scored_from_key_result_id },
    after: { scored_from_key_result_id: fromId },
    payload: { okr_key_result_id: id, code: ctx.code, statement: ctx.statement, department_id: null, imported: true },
  });
  return true;
}

/**
 * Revert an imported key result: its open initiative tasks are cancelled, it goes, its objective
 * goes when nothing else is under it, and a plan left with no objective is a draft again.
 */
async function removeImported(client, actor, id) {
  const ctx = await repo.keyResultContext(client, id);
  if (!ctx) return;
  await require("../tasks/tasks.service").cancelForRecord(client, actor, {
    entity_type: "key_result",
    entity_id: id,
    reason: "Its key result's import was reverted",
  });
  await repo.deleteKeyResult(client, id);
  if (!(await repo.keyResultCodes(client, ctx.okr_objective_id)).length) await repo.deleteObjective(client, ctx.okr_objective_id);
  if (!(await repo.objectivesOfPlan(client, ctx.performance_plan_id)).length && ctx.plan_status !== "draft") {
    await repo.updatePlan(client, ctx.performance_plan_id, { status: "draft", binding_at: null });
    await emit(client, {
      key: EVENTS.PLAN_REOPENED,
      entity: { type: "performance_plan", id: ctx.performance_plan_id },
      actor,
      payload: { performance_plan_id: ctx.performance_plan_id, was: ctx.plan_status },
    });
  }
  await emit(client, {
    key: EVENTS.KEY_RESULT_DELETED,
    entity: { type: "key_result", id },
    actor,
    before: ctx,
    payload: { okr_key_result_id: id, code: ctx.code },
  });
}

module.exports = {
  importKeyResult,
  importScoredFrom,
  removeImported,
  monthView,
  keyResultView,
  changeView,
  withKeyResults,
  listKeyResults,
  listOkrs,
  objectivesOfPlan,
  createObjective,
  getObjective,
  updateObjective,
  deleteObjective,
  createKeyResult,
  updateKeyResult,
  deleteKeyResult,
  getKeyResultDetail,
  okrSummary,
  rescoreFrom,
  reportMonth,
  confirmScore,
  trace,
};
