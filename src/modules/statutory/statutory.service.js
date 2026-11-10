"use strict";
/**
 * Statutory rates on Configurations (docs/guides/payroll.md §5, §6.11, §6.12): read them, enter a new version, and
 * ask for a run's statutory report. The rates are read and entered whatever the advanced option's state, so the
 * first ones are in force before it is first switched on (§13.1 item 25); the option decides only whether a run
 * computes them.
 *
 *   list(query)                 GET /statutory/rates, 25 a page
 *   save(actor, body)           POST /statutory/rates (`payroll.configure`): a version from today or later, never
 *                               backdated (422 EFFECTIVE_IN_THE_PAST, payroll.config.repo); one starting that day is replaced
 *   requestReport(actor, id)    POST /payroll/runs/:id/statutory-report: an approved or paid advanced run's report
 *   assertMayReadReport(user)   a reader whose role hides pay or tax numbers is not handed the report (403)
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { canSee } = require("../../shared/rbac/field-mask");
const lagos = require("../../shared/time/lagos");
const { assertNotPast } = require("../payroll/payroll.config.repo");
const rates = require("./statutory.rates");
const report = require("./statutory.report");
const repo = require("./statutory.repo");
const { EVENTS } = require("./statutory.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}


/** GET /statutory/rates. */
async function list(query) {
  const page = await repo.list(pool, query, lagos.today());
  return { ...page, data: page.data.map(rates.present) };
}

/** POST /statutory/rates: the version's rows, as a page. */
async function save(actor, body) {
  assertNotPast(body.effective_from);
  await tx(async (client) => {
    const written = await rates.saveVersion(client, body, actor);
    await emit(client, {
      key: EVENTS.STATUTORY_RATE_SAVED,
      entity: { type: "statutory_return", id: written[0].statutory_rate_id },
      actor,
      after: { item: body.item, effective_from: body.effective_from, rows: written.length },
      payload: { item: body.item, effective_from: body.effective_from, rows: written.length },
    });
  });
  const page = await repo.versionRows(pool, body.item, body.effective_from);
  return { ...page, data: page.data.map(rates.present) };
}

/** The report carries pay and tax numbers: a reader whose role hides either is refused it. */
async function assertMayReadReport(user) {
  const [salary, statutory] = await Promise.all([canSee(pool, user, "employee.salary"), canSee(pool, user, "employee.statutory")]);
  if (!salary || !statutory) throw new AppError("FIELD_RESTRICTED", "Your role cannot see pay or tax numbers.", 403);
}

/** POST /payroll/runs/:id/statutory-report: 202 with the file the screen waits on. */
const requestReport = (actor, runId) => tx((client) => report.requestReport(client, runId, { actor }));

module.exports = { list, save, assertMayReadReport, requestReport };
