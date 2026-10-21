"use strict";
/**
 * KPIs: each person's individual monthly KPIs, their weights and progress (A16;
 * docs/guides/performance.md §3 steps 4, 6 and 7, §6).
 *
 *   assign()        replaces a person's draft KPIs for a month, each under a departmental target
 *                   of their department for that month; the department's month must not be sent
 *   recordActual()  a manual KPI's figure so far, by the person or whoever set it
 *   trace()         the KPI's departmental target, monthly, annual and organisational goals
 *
 * Reads honour the `performance` scope on the person: staff see their own, a line manager their
 * reporting line, a head their department through the line, Management and up everyone.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const goalsRepo = require("../goals/goals.repo");
const targetsRepo = require("../targets/targets.repo");
const { EVENTS: TARGET_EVENTS } = require("../targets/targets.events");
const repo = require("./kpis.repo");
const score = require("./kpis.score");
const weights = require("./kpis.weights");
const { EVENTS } = require("./kpis.events");

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That KPI does not exist", 404);
const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });
const thisMonth = () => lagos.today().slice(0, 7);
const EDITABLE_PLAN = new Set(["draft", "returned"]);

/** The share of a month's working days gone today. */
async function shareOf(client, month, today = lagos.today()) {
  const cal = await workingWeek.loadCalendar(client);
  const { first, last } = score.monthRange(month);
  return score.elapsed(first, last, today, cal);
}

/** A repo row as the contract's Kpi. */
function toKpi(row, share, actor) {
  const attainment = score.COUNTED.includes(row.status) ? score.attainment(row) : null;
  const mine = actor && (actor.employee_id === row.employee_id || actor.employee_id === row.set_by_employee_id);
  return {
    employee_target_id: row.employee_target_id,
    employee: row.employee,
    title: row.title,
    month: row.month,
    target_value: row.target_value,
    actual_value: row.actual_value,
    unit: row.unit,
    direction: row.direction,
    progress_source: row.progress_source,
    weight: row.weight,
    status: row.status,
    attainment: attainment === null ? null : Math.round(attainment * 10000) / 10000,
    progress_status: score.statusOf(attainment, share),
    due_on: row.due_on,
    set_by: row.set_by,
    target: row.target,
    performance_plan_id: row.performance_plan_id,
    can_record_actual: Boolean(
      row.progress_source === "manual" && row.status === "active" && (mine || (actor && actor.is_ceo === true)),
    ),
    updated_at: iso(row.updated_at),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function list(query, scope, actor) {
  const month = query.month || thisMonth();
  const share = await shareOf(pool, month);
  const page = await repo.list(pool, { ...query, month_start: `${month}-01`, share }, scope);
  return { ...page, data: page.data.map((r) => toKpi(r, share, actor)) };
}

async function summary(query, scope) {
  const month = query.month || thisMonth();
  const share = await shareOf(pool, month);
  const c = await repo.summary(pool, { month_start: `${month}-01`, department_id: query.department_id, share }, scope);
  return {
    month,
    staff: c.staff,
    with_kpis: c.with_kpis,
    weights_off: c.weights_off,
    on_track: c.on_track,
    behind_or_at_risk: c.behind_or_at_risk,
    sources: [
      { progress_source: "tasks", count: c.tasks },
      { progress_source: "manual", count: c.manual },
    ],
  };
}

async function personOf(client, employeeId) {
  const { rows } = await client.query(
    `SELECT e.employee_id, e.department_id, e.status,
            ${personJson("e", "d")} AS ref
       FROM employee e LEFT JOIN department d ON d.department_id = e.department_id
      WHERE e.employee_id = $1`,
    [employeeId],
  );
  return rows[0] || null;
}

async function mayAssign(client, actor) {
  if (actor.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(client, actor.user_id)).includes("kpis.assign");
}

async function ofEmployee(employeeId, query, scope, actor, client = pool) {
  assertInScope(scope, employeeId);
  const person = await personOf(client, employeeId);
  if (!person) throw new AppError("NOT_FOUND", "That person does not exist", 404);
  const month = query.month || thisMonth();
  const { first, last } = score.monthRange(month);
  const share = await shareOf(client, month);
  const rows = await repo.ofEmployee(client, employeeId, first);
  const targets = person.department_id ? await repo.targetsFor(client, person.department_id, first, last) : [];
  const plan = person.department_id ? await targetsRepo.planOf(client, person.department_id, first) : null;
  const counted = rows.filter((r) => score.COUNTED.includes(r.status));
  return {
    employee: person.ref,
    month,
    items: rows.map((r) => toKpi(r, share, actor)),
    total_weight: weights.totalWeight(rows),
    kpi_score: score.kpiScore(counted),
    targets: targets.map((t) => t.ref),
    can_assign:
      (await mayAssign(client, actor)) && actor.employee_id !== employeeId && (!plan || EDITABLE_PLAN.has(plan.status)),
  };
}

async function trace(id, scope) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  assertInScope(scope, row.employee_id);
  const chain = row.target ? [row.target, ...(await goalsRepo.ancestors(pool, row.organisational_goal_id))] : [];
  return { employee_target_id: row.employee_target_id, title: row.title, chain };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

async function assign(actor, scope, employeeId, body) {
  assertInScope(scope, employeeId);
  if (actor.employee_id === employeeId && actor.is_ceo !== true)
    throw new AppError("PERMISSION_DENIED", "Your KPIs are set by your manager", 403);
  weights.assertDistinct(body.items);
  await tx(async (client) => {
    const person = await personOf(client, employeeId);
    if (!person || person.status !== "active") throw invalid("employee_id", "Not an active employee");
    if (!person.department_id) throw invalid("employee_id", "Not in a department");
    const { first, last } = score.monthRange(body.month);
    const targets = await repo.targetsFor(client, person.department_id, first, last);
    const allowed = new Map(targets.map((t) => [t.ref.organisational_goal_id, t]));
    body.items.forEach((item, i) => {
      if (!allowed.has(item.organisational_goal_id))
        throw invalid(`items.${i}.organisational_goal_id`, "Pick a target of their department");
    });
    const plan = await targetsRepo.ensurePlan(client, person.department_id, first);
    if (!EDITABLE_PLAN.has(plan.status))
      throw new AppError("PLAN_LOCKED", "This month is already sent for approval", 409);

    const before = await repo.ofEmployee(client, employeeId, first);
    const existing = new Map(before.map((r) => [r.employee_target_id, r]));
    const kept = new Set();
    for (const [i, item] of body.items.entries()) {
      const fields = {
        organisational_goal_id: item.organisational_goal_id,
        title: item.title,
        target_value: item.target_value,
        unit: item.unit,
        direction: item.direction,
        progress_source: item.progress_source,
        weight: item.weight,
        set_by_employee_id: actor.employee_id,
      };
      if (item.employee_target_id) {
        const old = existing.get(item.employee_target_id);
        if (!old) throw invalid(`items.${i}.employee_target_id`, "Not one of their KPIs");
        await repo.update(client, item.employee_target_id, fields);
        kept.add(item.employee_target_id);
      } else {
        const id = await repo.insert(client, {
          ...fields,
          employee_id: employeeId,
          month_start: first,
          due_on: last,
          performance_plan_id: plan.performance_plan_id,
        });
        kept.add(id);
      }
    }
    for (const old of before) if (!kept.has(old.employee_target_id)) await repo.remove(client, old.employee_target_id);

    await emit(client, {
      key: EVENTS.KPIS_ASSIGNED,
      entity: { type: "employee", id: employeeId },
      actor,
      before: { kpis: before.map((r) => ({ title: r.title, weight: r.weight })) },
      after: { kpis: body.items.map((r) => ({ title: r.title, weight: r.weight })) },
      payload: { employee_id: employeeId, subject_employee_id: employeeId, month: body.month, kpis: body.items.length },
    });
  });
  return ofEmployee(employeeId, { month: body.month }, scope, actor);
}

async function recordActual(actor, scope, id, body) {
  await tx(async (client) => {
    const row = await repo.get(client, id, { lock: true });
    if (!row) throw notFound();
    assertInScope(scope, row.employee_id);
    if (row.progress_source !== "manual")
      throw new AppError("KPI_FROM_TASKS", "This KPI counts its done tasks", 409);
    if (row.status !== "active") throw new AppError("KPI_NOT_ACTIVE", "This KPI is not approved yet", 409);
    const allowed =
      actor.is_ceo === true || actor.employee_id === row.employee_id || actor.employee_id === row.set_by_employee_id;
    if (!allowed) throw new AppError("PERMISSION_DENIED", "The person or whoever set it records this", 403);
    await repo.setActual(client, id, body.actual_value);
    await emit(client, {
      key: TARGET_EVENTS.KPI_PROGRESS_CHANGED,
      entity: { type: "kpi", id },
      actor,
      before: { actual_value: row.actual_value },
      after: { actual_value: body.actual_value, note: body.note || null },
      payload: { employee_target_id: id, employee_id: row.employee_id, actual_value: body.actual_value },
    });
  });
  const share = await shareOf(pool, (await repo.get(pool, id)).month);
  return toKpi(await repo.get(pool, id), share, actor);
}

module.exports = { toKpi, shareOf, list, summary, ofEmployee, trace, assign, recordActual };
