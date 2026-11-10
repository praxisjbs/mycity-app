"use strict";
/**
 * Salary structure and pay components on Configurations (docs/guides/payroll.md §5, §6.11 rules 4 to 6). Advanced
 * mode only: every read and write answers 409 ADVANCED_OFF until the option is on or has been (switched on now or
 * from a later day). Each write is a new version from today or later (422 EFFECTIVE_IN_THE_PAST otherwise); a second
 * change for the same day replaces that day's version.
 *
 *   listGrades, saveGrade              Bands by Grade and Save Grade
 *   listPlacements, savePlacement      who is in which grade, and who is Below Minimum or Above Maximum; Place Person
 *   components, saveComponents         a person's pay split, and Set Pay Components
 *
 * A grade sets no one's pay: a person outside their band is flagged, never blocked (§6.11 rule 5). A split must add up
 * to the person's monthly gross when it is saved (422 SPLIT_NOT_GROSS); if the gross changes later, a run warns No Pay
 * Split for them until the split is set again (payroll.run.js).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { addVersion, addVersionSet } = require("../../shared/db/effective-dated");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const m = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const settings = require("../payroll/payroll.config.repo");

const { assertNotPast } = settings;
const repo = require("./salary_structure.repo");
const { EVENTS } = require("./salary_structure.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const iso = (at) => (at ? new Date(at).toISOString() : null);

/** Salary Structure and Pay Components exist once the advanced option is on or has been (§6.11 rule 4). */
async function assertAdvancedHasBeenOn(db) {
  if (!(await settings.hasBeenOn(db)))
    throw new AppError("ADVANCED_OFF", "Switch on Advanced Payroll first", 409);
}

/* ------------------------------------------------------------------ *
 * Grades
 * ------------------------------------------------------------------ */

/** A repo row as the contract's SalaryGrade. */
const presentGrade = (row) => ({
  salary_grade_id: row.salary_grade_id,
  code: row.code,
  name: row.name,
  band_minimum: row.minimum,
  band_maximum: row.maximum,
  effective_from: row.effective_from,
  effective_to: row.effective_to ?? null,
  staff: Number(row.staff || 0),
  below_minimum: Number(row.below_minimum || 0),
  above_maximum: Number(row.above_maximum || 0),
  created_at: iso(row.created_at),
});

/** GET /salary-structure/grades. */
async function listGrades(query) {
  await assertAdvancedHasBeenOn(pool);
  const page = await repo.listGrades(pool, query, lagos.today());
  return { ...page, data: page.data.map(presentGrade) };
}

/** POST /salary-structure/grades: a grade, or its band from a later day. */
async function saveGrade(actor, body) {
  await assertAdvancedHasBeenOn(pool);
  assertNotPast(body.effective_from);
  const id = await tx(async (client) => {
    const row = await addVersion(client, {
      table: "salary_grade",
      key: { code: body.code },
      from: body.effective_from,
      data: { name: body.name, minimum: body.minimum, maximum: body.maximum, created_by: actor.user_id || null },
      writable: ["name", "minimum", "maximum", "created_by"],
      replace: true,
    });
    await emit(client, {
      key: EVENTS.SALARY_GRADE_SAVED,
      entity: { type: "salary_structure", id: row.salary_grade_id },
      actor,
      after: { code: body.code, name: body.name, effective_from: body.effective_from },
      payload: { salary_grade_id: row.salary_grade_id, code: body.code, effective_from: body.effective_from },
    });
    return row.salary_grade_id;
  });
  return presentGrade(await repo.gradeRow(pool, id, lagos.today()));
}

/* ------------------------------------------------------------------ *
 * Placements
 * ------------------------------------------------------------------ */

/** A repo row as the contract's GradePlacement. */
const presentPlacement = (row) => ({
  employee: row.employee,
  gross_pay: row.gross_monthly ?? null,
  salary_grade_id: row.salary_grade_id ?? null,
  grade_code: row.grade_code ?? null,
  grade_name: row.grade_name ?? null,
  band_position: row.band_position ?? null,
  effective_from: row.effective_from ?? null,
  has_pay_split: Boolean(row.has_pay_split),
});

/** GET /salary-structure/placements. */
async function listPlacements(query) {
  await assertAdvancedHasBeenOn(pool);
  const page = await repo.listPlacements(pool, query, lagos.today());
  return { ...page, data: page.data.map(presentPlacement) };
}

const noPerson = () => new AppError("NOT_FOUND", "That person does not exist", 404);

/**
 * PUT /salary-structure/placements/:employee_id: the person in a grade from a day. The grade must have a band in
 * force that day (422 GRADE_NOT_IN_FORCE).
 */
async function savePlacement(actor, employeeId, body) {
  await assertAdvancedHasBeenOn(pool);
  assertNotPast(body.effective_from);
  if (!(await repo.personOf(pool, employeeId))) throw noPerson();
  if (!(await repo.gradeExists(pool, body.salary_grade_id)))
    throw new AppError("NOT_FOUND", "That grade does not exist", 422, { salary_grade_id: ["No such grade"] });
  await tx(async (client) => {
    const band = await repo.gradeInForce(client, body.salary_grade_id, body.effective_from);
    if (!band)
      throw new AppError("GRADE_NOT_IN_FORCE", "That grade has no band on this date", 422, { salary_grade_id: ["No band that day"] });
    const row = await addVersion(client, {
      table: "employee_salary_grade",
      key: { employee_id: employeeId },
      from: body.effective_from,
      data: { salary_grade_id: band.salary_grade_id, created_by: actor.user_id || null },
      writable: ["salary_grade_id", "created_by"],
      replace: true,
    });
    await emit(client, {
      key: EVENTS.GRADE_PLACEMENT_SAVED,
      entity: { type: "salary_structure", id: row.employee_salary_grade_id },
      actor,
      after: { code: band.code, effective_from: body.effective_from },
      payload: { employee_id: employeeId, subject_employee_id: employeeId, salary_grade_id: band.salary_grade_id, effective_from: body.effective_from },
    });
  });
  return presentPlacement(await repo.placementOf(pool, employeeId, lagos.today()));
}

/* ------------------------------------------------------------------ *
 * Pay components
 * ------------------------------------------------------------------ */

const presentComponent = (row) => ({
  code: row.code,
  label: row.label,
  pay_amount: row.amount,
  pensionable: row.pensionable === true,
  effective_from: row.effective_from,
  effective_to: row.effective_to ?? null,
});

/** A version's rows as the contract's PayComponentVersion, or null with none. */
const versionOf = (rows) =>
  rows.length
    ? { effective_from: rows[0].effective_from, effective_to: rows[0].effective_to ?? null, components: rows.map(presentComponent) }
    : null;

/** GET /salary-structure/employees/:employee_id/components: the split today and the next one. */
async function components(employeeId) {
  await assertAdvancedHasBeenOn(pool);
  const person = await repo.personOf(pool, employeeId);
  if (!person) throw noPerson();
  const today = lagos.today();
  const [current, next] = await Promise.all([repo.splitOn(pool, employeeId, today), repo.splitAfter(pool, employeeId, today)]);
  return { employee: person.employee, gross_pay: person.gross_monthly ?? null, current: versionOf(current), next: versionOf(next) };
}

/**
 * PUT /salary-structure/employees/:employee_id/components: a new split from a day. It must add up to the person's
 * monthly gross as it stands (422 SPLIT_NOT_GROSS), and a person with no gross has nothing to split (422 NO_SALARY).
 */
async function saveComponents(actor, employeeId, body) {
  await assertAdvancedHasBeenOn(pool);
  assertNotPast(body.effective_from);
  const person = await repo.personOf(pool, employeeId);
  if (!person) throw noPerson();
  if (person.gross_monthly === null || person.gross_monthly === undefined)
    throw new AppError("NO_SALARY", "Set the person's monthly gross first", 422, { components: ["Set the pay first"] });
  if (m.compare(m.sum(body.components.map((c) => c.amount)), person.gross_monthly) !== 0)
    throw new AppError("SPLIT_NOT_GROSS", "The components must add up to the monthly gross", 422, { components: ["Must equal the gross"] });
  await tx(async (client) => {
    const rows = await addVersionSet(client, {
      table: "employee_pay_component",
      key: { employee_id: employeeId },
      from: body.effective_from,
      rows: body.components.map((c) => ({ code: c.code, label: c.label, amount: c.amount, pensionable: c.pensionable, created_by: actor.user_id || null })),
      writable: ["code", "label", "amount", "pensionable", "created_by"],
      replace: true,
    });
    await emit(client, {
      key: EVENTS.PAY_COMPONENTS_SAVED,
      entity: { type: "salary_structure", id: rows[0].employee_pay_component_id },
      actor,
      after: { codes: body.components.map((c) => c.code), effective_from: body.effective_from },
      payload: { employee_id: employeeId, subject_employee_id: employeeId, components: rows.length, effective_from: body.effective_from },
    });
  });
  return components(employeeId);
}

module.exports = {
  assertAdvancedHasBeenOn,
  listGrades,
  saveGrade,
  listPlacements,
  savePlacement,
  components,
  saveComponents,
};
