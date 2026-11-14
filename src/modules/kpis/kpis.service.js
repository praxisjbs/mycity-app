"use strict";
/**
 * KPIs: the one write path for a function's operational KPIs and their monthly actuals
 * (docs/guides/performance.md §5 KPIs, §6.5).
 *
 * A KPI belongs to a function and stands across quarters. Its code is the function's next free
 * one (TBO-K04, G1). The head (or acting head) sets them (`goals.function`); the CEO and whoever
 * runs the cycle may act for any function. One actual per KPI per month: Met, Not Met or N/A,
 * never 100% for N/A (no eligible cases).
 *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11) name a KPI by its code or its words among those
 * the person reads (kpiIdOf), name it on the card (cardKpi) and re-check it at the press with
 * update's own rule (assertCardKpi).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const authority = require("../goals/goals.authority");
const visibility = require("../goals/goals.visibility");
const { common } = require("@mycity/contract");
const { oneNamedIn, plainWords, choiceWords } = require("../../shared/ai/named");
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

/** GET /performance/kpis: the KPIs of the functions the reader reads (§6.23). */
async function list(query, actor = null) {
  const page = await repo.list(pool, query, await untilOf(query.period_id), await visibility.readerOf(pool, actor));
  return { ...page, data: page.data.map(kpiView) };
}

async function get(id, { period_id: periodId = null } = {}, actor = null) {
  const row = await repo.get(pool, id, await untilOf(periodId));
  if (!row) throw notFound();
  if (!visibility.readsFunction(await visibility.readerOf(pool, actor), row.department_id)) throw notFound();
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
async function summary(query, actor = null) {
  const row = await repo.summary(pool, { department_id: query.department_id || null, month: query.month }, await visibility.readerOf(pool, actor));
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

/* ------------------------------------------------------------------ *
 * Praxis AI's cards (docs/guides/praxis-ai.md §6.11, decision 40)
 * ------------------------------------------------------------------ */

const isId = (v) => typeof v === "string" && common.uuid.safeParse(v).success;

/** The KPI a person names: its code (TBO-K01) or its words, among the active KPIs they read. */
async function kpiIdOf(db, words, actor) {
  const reach = await visibility.readerOf(db, actor);
  const page = (q) => async () => (await repo.list(db, { page: 1, active: "true", ...(q ? { q } : {}) }, null, reach)).data;
  const found = await oneNamedIn([page(words), page(plainWords(words, ["kpi"])), page(null)], words, (k) => [k.code, k.name], { drop: ["kpi"] });
  return found ? found.kpi_definition_id : null;
}

/** "Which KPI?" answers (decision 34): the active KPIs of the functions whose KPIs the person sets, by code and name as kpiIdOf matches them. */
async function kpiChoices(db, actor) {
  const reach = await visibility.readerOf(db, actor);
  const out = [];
  for (const k of (await repo.list(db, { page: 1, active: "true" }, null, reach)).data) if (await authority.maySetGoals(db, actor, k.department_id)) out.push(choiceWords(`${k.code} ${k.name}`));
  return out;
}

/** The KPI a card names, by its code and name, when the person reads it; its id alone otherwise. */
async function cardKpi(db, id, actor) {
  const k = isId(id) ? await repo.get(db, id) : null;
  if (!k) return [];
  const reach = await visibility.readerOf(db, actor);
  const readable = (await repo.list(db, { page: 1, q: k.code }, null, reach)).data.some((r) => r.kpi_definition_id === id);
  return [{ type: "kpi", id, label: readable ? `${k.code} ${k.name}` : null }];
}

/** Save KPI's re-check: the KPI exists and the person sets its function's KPIs, as update holds it. */
async function assertCardKpi(db, id, actor) {
  const k = isId(id) ? await repo.get(db, id) : null;
  if (!k) throw new AppError("NOT_FOUND", "That KPI does not exist", 404, { kpi_definition_id: ["No such KPI"] });
  await authority.assertSetsGoals(db, actor, k.department_id, "KPIs");
}

/* ------------------------------------------------------------------ *
 * The assistant's summary (docs/guides/praxis-ai.md §6.13, People, performance and queries)
 * ------------------------------------------------------------------ */

/** A month's result as KPIs names it, and a KPI with no month yet as Not Entered. */
const RESULT_PARTS = Object.freeze([
  { key: "met", label: "Met" },
  { key: "not_met", label: "Not Met" },
  { key: "na", label: "N/A" },
  { key: "not_entered", label: "Not Entered" },
]);

/** Met as a whole per cent of those met or not met; N/A and not entered are left out. */
const metShare = (met, decided) => (decided ? Math.round((met * 100) / decided) : 0);

/**
 * The KPIs' results in figures (KpiResultSummaryQuery): the active KPIs of the functions the reader reads
 * (§6.23), each by its latest result on or before the quarter's end, by result, by function stacked Met,
 * Not Met, N/A and Not Entered, and met as a per cent by month. Runs on the client the assistant hands over.
 * @param {{query: Function}} client
 * @param {object} params   KpiResultSummaryQuery, parsed
 * @param {object} actor    the asking person
 */
async function aiSummary(client, params, actor) {
  const { figure, group, series, stacked } = require("../../shared/ai/summary");
  const r = (await repo.aiSummary(client, params, await visibility.readerOf(client, actor))) || {};
  const f = r.figures || {};
  const byResult = group("result", "KPIs by result", RESULT_PARTS.map((x) => ({ key: x.key, label: x.label, value: f[x.key] || 0 })).filter((x) => x.value > 0));
  const byFunction = group("function", "KPIs by function", stacked(r.by_function, RESULT_PARTS));
  return {
    figures: [
      figure("kpis", "KPIs", f.kpis || 0),
      figure("met", "Met", f.met || 0),
      figure("not_met", "Not met", f.not_met || 0),
      figure("na", "N/A", f.na || 0),
      figure("not_entered", "Not entered", f.not_entered || 0),
      figure("met_rate", "Met as a per cent", metShare(f.met || 0, (f.met || 0) + (f.not_met || 0)), "percent"),
    ],
    groups: params.by === "result" ? [byResult, byFunction] : [byFunction, byResult],
    series: [series("met_rate", "Per cent of KPIs met by month", (r.months || []).map((m) => ({ at: m.at, value: metShare(m.met, m.decided) })))],
    total: f.kpis || 0,
  };
}

module.exports = { monthView, kpiView, list, summary, aiSummary, units, get, ofDepartment, nextCode, create, update, recordIn, recordActual, importKpi, removeImported, kpiIdOf, kpiChoices, cardKpi, assertCardKpi };
