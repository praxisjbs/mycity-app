"use strict";
/**
 * Goals: the one write path for quarters (docs/guides/performance.md §4, §5, §6.2), and in PR 2
 * for organisational goals, objectives, key results, monthly reports, plans and target changes.
 *
 * A quarter carries its own scoring rules (ScoringRules): a new quarter copies the last one's,
 * the code's defaults for the first, so a rule changed next quarter never rewrites this one.
 * Its status runs planning → active → closed, one active at a time.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scoring } = require("@mycity/contract");
const periods = require("./goals.periods");
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

const notFound = () => new AppError("NOT_FOUND", "That quarter does not exist", 404);

/** A dates-only value from the database or the wire, as YYYY-MM-DD. */
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/** A performance_period row as PerformancePeriod. */
function periodView(row) {
  const startsOn = day(row.starts_on);
  return {
    performance_period_id: row.performance_period_id,
    name: row.name,
    starts_on: startsOn,
    ends_on: day(row.ends_on),
    plan_year_starts_on: day(row.plan_year_starts_on),
    targets_lock_on: day(row.targets_lock_on),
    live_from: day(row.live_from),
    status: row.status,
    rules: row.rules,
    months: periods.monthsOf(startsOn),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/** A date the quarter's own days must hold (the lock date, the first live day). */
function assertInQuarter(field, value, startsOn, endsOn) {
  if (value && (value < startsOn || value > endsOn))
    throw new AppError("VALIDATION_FAILED", "Pick a day inside the quarter", 422, { [field]: ["Outside the quarter"] });
}

const ORDER = { planning: 0, active: 1, closed: 2 };

async function listPeriods(query) {
  const page = await repo.listPeriods(pool, query);
  return { ...page, data: page.data.map(periodView) };
}

async function getPeriod(id) {
  const row = await repo.getPeriod(pool, id);
  if (!row) throw notFound();
  return periodView(row);
}

/** The active quarter, else the latest one still being planned; 404 when there is none. */
async function currentPeriod(db = pool) {
  const row = await repo.currentPeriod(db);
  if (!row)
    throw new AppError("NO_QUARTER", "No quarter has been set up yet", 404);
  return periodView(row);
}

/**
 * Set up a quarter: its name, end and plan year follow from its first day unless given; its rules
 * are copied from the quarter before it (the code's defaults for the first).
 */
async function createPeriod(actor, body) {
  const startsOn = body.starts_on;
  const endsOn = periods.quarterEnd(startsOn);
  assertInQuarter("targets_lock_on", body.targets_lock_on, startsOn, endsOn);
  assertInQuarter("live_from", body.live_from, startsOn, endsOn);
  const id = await tx(async (client) => {
    if (await repo.periodStarting(client, startsOn))
      throw new AppError("PERIOD_EXISTS", "That quarter is already set up", 409, { starts_on: ["Already set up"] });
    const before = await repo.periodBefore(client, startsOn);
    const rules = scoring.ScoringRules.parse(before ? before.rules : scoring.DEFAULT_RULES);
    const row = await repo.insertPeriod(client, {
      name: body.name || periods.quarterName(startsOn),
      starts_on: startsOn,
      ends_on: endsOn,
      plan_year_starts_on: body.plan_year_starts_on || periods.planYearOf(startsOn),
      targets_lock_on: body.targets_lock_on || null,
      live_from: body.live_from || null,
      rules,
    });
    const after = await repo.getPeriod(client, row.performance_period_id);
    await emit(client, {
      key: EVENTS.PERIOD_CREATED,
      entity: { type: "performance_period", id: row.performance_period_id },
      actor,
      after,
      payload: { performance_period_id: row.performance_period_id, name: after.name, copied_from: before ? before.performance_period_id : null },
    });
    return row.performance_period_id;
  });
  return getPeriod(id);
}

/** Change a quarter's name, lock date, first live day, rules or status. */
async function updatePeriod(actor, id, patch) {
  const id2 = await tx(async (client) => {
    const before = await repo.getPeriod(client, id);
    if (!before) throw notFound();
    const startsOn = day(before.starts_on);
    const endsOn = day(before.ends_on);
    assertInQuarter("targets_lock_on", patch.targets_lock_on, startsOn, endsOn);
    assertInQuarter("live_from", patch.live_from, startsOn, endsOn);
    if (patch.status && patch.status !== before.status) {
      if (ORDER[patch.status] < ORDER[before.status])
        throw new AppError("PERIOD_STATUS", "A quarter moves forward only: planning, active, closed", 409, {
          status: ["Cannot go back"],
        });
      if (patch.status === "active" && (await repo.otherActive(client, id)))
        throw new AppError("PERIOD_ACTIVE_EXISTS", "Close the active quarter first", 409, { status: ["Another is active"] });
    }
    await repo.updatePeriod(client, id, patch);
    const after = await repo.getPeriod(client, id);
    await emit(client, {
      key: EVENTS.PERIOD_CHANGED,
      entity: { type: "performance_period", id },
      actor,
      before,
      after,
      payload: { performance_period_id: id, name: after.name, status: after.status },
    });
    return id;
  });
  return getPeriod(id2);
}

module.exports = {
  periodView,
  listPeriods,
  getPeriod,
  currentPeriod,
  createPeriod,
  updatePeriod,
};
