"use strict";
/**
 * KPIs: the one write path for a function's operational KPIs and their monthly actuals
 * (docs/guides/performance.md §5 KPIs, §6.5).
 *
 * A KPI belongs to a function and stands across quarters. Its code is the function's next free
 * one (TBO-K04, G1). The head (or acting head) sets them (`goals.function`); the CEO and whoever
 * runs the cycle may act for any function. One actual per KPI per month: Met, Not Met or N/A,
 * never 100% for N/A (no eligible cases).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const authority = require("../goals/goals.authority");
const repo = require("./kpis.repo");
const { EVENTS } = require("./kpis.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That KPI does not exist", 404);
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v ? new Date(v).toISOString() : null);

/** A kpi_month row (or its JSON) as KpiMonth. */
function monthView(m) {
  if (!m) return null;
  return {
    kpi_month_id: m.kpi_month_id,
    kpi_definition_id: m.kpi_definition_id,
    month: day(m.month),
    result: m.result,
    actual_value: m.actual_value ?? null,
    actual_text: m.actual_text ?? null,
    comment: m.comment ?? null,
    recorded_by: m.recorded_by ?? null,
    recorded_at: iso(m.recorded_at),
  };
}

/** A kpi_definition row as Kpi. */
function kpiView(r) {
  return {
    kpi_definition_id: r.kpi_definition_id,
    code: r.code,
    name: r.name,
    description: r.description,
    department_id: r.department_id,
    department: r.department,
    formula: r.formula,
    unit: r.unit,
    direction: r.direction === "lower" ? "lower" : "higher",
    target_text: r.target_text,
    target_value: r.target_value,
    frequency: r.frequency,
    data_source: r.data_source,
    starts_period_id: r.starts_period_id,
    active: r.active,
    latest: monthView(r.latest),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** The last day of a quarter, for the latest month a list shows. */
async function untilOf(periodId) {
  if (!periodId) return null;
  const { rows } = await pool.query("SELECT ends_on FROM performance_period WHERE performance_period_id = $1", [periodId]);
  return rows[0] ? day(rows[0].ends_on) : null;
}

async function list(query) {
  const page = await repo.list(pool, query, await untilOf(query.period_id));
  return { ...page, data: page.data.map(kpiView) };
}

async function get(id, { period_id: periodId = null } = {}, actor = null) {
  const row = await repo.get(pool, id, await untilOf(periodId));
  if (!row) throw notFound();
  return {
    ...kpiView(row),
    months: (await repo.months(pool, id)).map(monthView),
    lines: await repo.lines(pool, id),
    can_edit: await mayEdit(actor, row.department_id),
  };
}

/** May the reader change this KPI and record its months? update's and recordActual's checks, as a yes or no. */
async function mayEdit(actor, departmentId) {
  if (!actor || !(await scopeFor(actor, "performance", "edit"))) return false;
  if (!(await authority.holds(actor, "goals.function"))) return false;
  return authority.maySetGoals(pool, actor, departmentId);
}

/** GET /performance/kpis/summary: the month's figures over every active KPI, or one function's. */
async function summary(query) {
  const row = await repo.summary(pool, { department_id: query.department_id || null, month: query.month });
  return { kpis: row.kpis, met: row.met, not_met: row.not_met, awaiting: row.awaiting };
}

/** GET /performance/kpis/units: the units already in use, most used first, narrowed by `q`. */
function units(query) {
  return repo.units(pool, query);
}

/** A function's KPIs, for its plan. */
async function ofDepartment(db, departmentId) {
  return (await repo.ofDepartment(db, departmentId)).map(kpiView);
}

/** The function's next free KPI code: TBO-K01, TBO-K02 ... */
async function nextCode(db, departmentId) {
  const { rows } = await db.query("SELECT code::text AS code FROM department WHERE department_id = $1", [departmentId]);
  if (!rows[0]) throw new AppError("DEPARTMENT_NOT_FOUND", "Pick a function that exists", 422, { department_id: ["Not a function"] });
  const prefix = rows[0].code;
  const used = new Set(
    (await repo.codesWithPrefix(db, prefix)).map((c) => Number(/-K(\d+)$/i.exec(c)?.[1] || 0)),
  );
  let n = 1;
  while (used.has(n)) n += 1;
  return `${prefix}-K${String(n).padStart(2, "0")}`;
}

/** POST /performance/kpis. `code` is accepted from the importer only (imported rows keep their codes). */
async function create(actor, body, { code = null } = {}) {
  await authority.assertSetsGoals(pool, actor, body.department_id, "KPIs");
  const id = await tx(async (client) => {
    const kpiCode = code || (await nextCode(client, body.department_id));
    if (code && (await repo.findByCode(client, code)))
      throw new AppError("KPI_CODE_TAKEN", "Another KPI has this code", 409, { code: ["Already in use"] });
    const newId = await repo.insert(client, { ...body, code: kpiCode });
    const after = await repo.get(client, newId);
    await emit(client, {
      key: EVENTS.KPI_SAVED,
      entity: { type: "kpi", id: newId },
      actor,
      after,
      payload: { kpi_definition_id: newId, code: kpiCode, name: body.name, department_id: body.department_id },
    });
    return newId;
  });
  return kpiView(await repo.get(pool, id));
}

/** PATCH /performance/kpis/:id */
async function update(actor, id, patch) {
  const before = await repo.get(pool, id);
  if (!before) throw notFound();
  await authority.assertSetsGoals(pool, actor, before.department_id, "KPIs");
  await tx(async (client) => {
    await repo.update(client, id, patch);
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.KPI_SAVED,
      entity: { type: "kpi", id },
      actor,
      before,
      after,
      payload: { kpi_definition_id: id, code: after.code, name: after.name, department_id: after.department_id },
    });
  });
  return kpiView(await repo.get(pool, id));
}

/**
 * Record a month's actual, in the caller's transaction (Report Month records a function's KPIs
 * with its key results in one save).
 */
async function recordIn(client, actor, kpi, body) {
  if (body.result !== "na" && body.actual_value === undefined && body.actual_text === undefined)
    throw new AppError("VALIDATION_FAILED", "Give the month's actual", 422, { actual_value: ["Enter the actual"] });
  await repo.upsertMonth(client, kpi.kpi_definition_id, body, actor && actor.user_id);
  const m = await repo.month(client, kpi.kpi_definition_id, body.month);
  await emit(client, {
    key: EVENTS.KPI_ACTUAL_RECORDED,
    entity: { type: "kpi", id: kpi.kpi_definition_id },
    actor,
    after: m,
    payload: { kpi_definition_id: kpi.kpi_definition_id, code: kpi.code, month: body.month, result: body.result },
  });
  return monthView(m);
}

/** POST /performance/kpis/:id/actuals */
async function recordActual(actor, id, body) {
  const kpi = await repo.get(pool, id);
  if (!kpi) throw notFound();
  await authority.assertSetsGoals(pool, actor, kpi.department_id, "KPIs");
  return tx((client) => recordIn(client, actor, kpi, body));
}

/** The definition fields an imported KPI carries. */
const IMPORTED = ["name", "formula", "unit", "direction", "target_text", "target_value", "frequency", "data_source"];
const same = (a, b) => (a ?? null) === (b ?? null);

/**
 * One KPI of the OKR workbook, in the import's transaction (docs/guides/performance.md §6.19): made
 * with the workbook's code or brought up to the sheet, its former codes kept as aliases, and the
 * month's result recorded when the sheet gives one. A row that changes nothing answers `none`.
 * @param {object} r  department_id, code, the IMPORTED fields, starts_period_id, former_codes,
 *   month ({month, result, actual_text, comment} or null)
 * @returns {Promise<{id: string, action: "create"|"update"|"none"}>}
 */
async function importKpi(client, actor, r) {
  const goalsRepo = require("../goals/goals.repo");
  const fields = Object.fromEntries(IMPORTED.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
  const found = await repo.findByCode(client, r.code);
  let id;
  let action = "update";
  let wrote = false;
  if (!found) {
    id = await repo.insert(client, { ...fields, code: r.code, department_id: r.department_id, starts_period_id: r.starts_period_id });
    action = "create";
    wrote = true;
  } else {
    id = found.kpi_definition_id;
    const held = await repo.get(client, id);
    const changed = Object.keys(fields).filter((k) => !same(held[k] === null || held[k] === undefined ? null : String(held[k]), fields[k] === null ? null : String(fields[k])));
    if (changed.length) {
      await repo.update(client, id, Object.fromEntries(changed.map((k) => [k, fields[k]])));
      wrote = true;
    }
  }
  for (const alias of r.former_codes || [])
    await goalsRepo.addAlias(client, r.starts_period_id, alias, { kpi_definition_id: id });
  if (r.month) {
    const held = await repo.month(client, id, r.month.month);
    if (!held || held.result !== r.month.result || !same(held.actual_text, r.month.actual_text) || !same(held.comment, r.month.comment)) {
      await repo.upsertMonth(client, id, r.month, actor && actor.user_id);
      wrote = true;
    }
  }
  if (!wrote) return { id, action: "none" };
  const after = await repo.get(client, id);
  await emit(client, {
    key: EVENTS.KPI_SAVED,
    entity: { type: "kpi", id },
    actor,
    after,
    payload: { kpi_definition_id: id, code: r.code, name: r.name, department_id: r.department_id, imported: true },
  });
  return { id, action };
}

/**
 * Revert an imported KPI: it goes with its months and former codes, as a key result does, so the
 * next import of it creates it again. The importer refuses this while a line or review uses it.
 */
async function removeImported(client, actor, id) {
  const before = await repo.get(client, id);
  if (!before) return;
  await repo.remove(client, id);
  await emit(client, {
    key: EVENTS.KPI_REMOVED,
    entity: { type: "kpi", id },
    actor,
    before,
    payload: { kpi_definition_id: id, code: before.code, name: before.name, department_id: before.department_id },
  });
}

module.exports = { monthView, kpiView, list, summary, units, get, ofDepartment, nextCode, create, update, recordIn, recordActual, importKpi, removeImported };
