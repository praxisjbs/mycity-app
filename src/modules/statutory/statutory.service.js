"use strict";
/**
 * Statutory rates on Configurations (docs/guides/payroll.md §5, §6.11, §6.12): read them, enter a new version, and
 * ask for a run's statutory report. The rates are read and entered whatever the advanced option's state, so the
 * first ones are in force before it is first switched on (§13.1 item 25); the option decides only whether a run
 * computes them.
 *
 *   list(query)                 GET /statutory/rates, 25 a page
 *   items()                     GET /statutory/items: the seven items, each with today's version and the next
 *   save(actor, body)           POST /statutory/rates (`payroll.configure`): a version from today or later, never
 *                               backdated (422 EFFECTIVE_IN_THE_PAST, payroll.config.repo); one starting that day is
 *                               replaced. It carries its legal source or No Legal Source (the contract refuses neither,
 *                               SOURCE_REQUIRED); the day checked is not still to come (422 CHECKED_IN_THE_FUTURE); a
 *                               document it names is claimed from the upload engine as a `statutory_source`
 *   removeChange(actor, p)      DELETE /statutory/rates/:item/versions/:effective_from (`payroll.configure`): Remove
 *                               Change of a version still to come; the version before it runs on. 409 VERSION_IN_FORCE
 *                               once it has started, or when an advanced run sent for approval read it
 *   requestReport(actor, id)    POST /payroll/runs/:id/statutory-report: an approved or paid advanced run's report
 *   assertMayReadReport(user)   a reader whose role hides pay or tax numbers is not handed the report (403)
 *   payToDate(id, query)        GET /statutory/employees/:employee_id/pay-to-date: a person's years, newest first
 *   savePayToDate(actor, p, b)  PUT …/pay-to-date/:year (`payroll.configure`): the year's taxable pay and tax before
 *                               MyCity's first statutory month, made or replaced, the leaving certificate claimed
 *   removePayToDate(actor, p)   DELETE …/pay-to-date/:year (`payroll.configure`)
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { canSee } = require("../../shared/rbac/field-mask");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const { assertNotPast } = require("../payroll/payroll.config.repo");
const { assertTaxYear } = require("../organisation/employee.rent");
const lock = require("../payroll/payroll.lock");
const rates = require("./statutory.rates");
const report = require("./statutory.report");
const repo = require("./statutory.repo");
const { EVENTS, SOURCE_DOC_TYPE, CERTIFICATE_DOC_TYPE } = require("./statutory.events");

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

/** One item's rows of one version in brief, or null with none. */
function brief(item, rows) {
  const mine = rows.filter((r) => r.item === item);
  if (!mine.length) return null;
  const r = mine[0];
  return {
    rate: item === "paye" || item === "minimum_wage" ? null : r.rate,
    flat_amount: c.statutory.AMOUNT_ITEMS.includes(item) ? r.flat_amount : null,
    base: r.base,
    bands: item === "paye" ? mine.length : null,
    effective_from: r.effective_from,
    ...rates.sourceOf(r),
  };
}

/** GET /statutory/items: the eight items, each with the version in force today and the next one. */
async function items() {
  const today = lagos.today();
  const [now, next] = await Promise.all([repo.inForce(pool, today), repo.nextVersions(pool, today)]);
  const [current, later] = [now.map(rates.present), next.map(rates.present)];
  return {
    items: c.statutory.StatutoryItem.options.map((item) => ({
      item,
      kind: c.statutory.ITEM_KIND[item],
      bases: [...c.statutory.ITEM_BASES[item]],
      current: brief(item, current),
      next: brief(item, later),
    })),
  };
}

/** The day a source was read is today or before, in Lagos: nobody has checked a law on a day still to come. */
function assertCheckedBefore(body) {
  if (body.source_checked_on && body.source_checked_on > lagos.today())
    throw new AppError("CHECKED_IN_THE_FUTURE", "The day checked is today or earlier", 422, { source_checked_on: ["Not after today"] });
}

/**
 * The instrument a version names, in the vault: a file the person staged through the upload engine is claimed for the
 * version (`statutory_source`, restricted); one an earlier version already holds is named again as it is, since one law
 * serves many versions. Anything else is refused on the field (422 DOCUMENT_NOT_STAGED, vault.claim).
 */
async function claimSource(client, documentId, versionRowId, actor) {
  if (!documentId) return null;
  const held = await vault.get(client, documentId);
  if (held && held.doc_type === SOURCE_DOC_TYPE && held.is_current && held.scan_status !== "infected") return held;
  return vault.claim(client, {
    document_id: documentId,
    doc_type: SOURCE_DOC_TYPE,
    entity: { type: "statutory_return", id: versionRowId },
    actor,
    field: "source_document_id",
    sensitivity: "restricted",
  });
}

/** What an audit line says of a version's source: whether it has one, and the instrument named; never a figure. */
const sourceAudit = (row) => ({
  no_legal_source: row.no_legal_source === true,
  source_title: row.source_title ?? null,
  source_section: row.source_section ?? null,
  source_document_id: row.source_document_id ?? null,
});

/** POST /statutory/rates: the version's rows, as a page. */
async function save(actor, body) {
  assertNotPast(body.effective_from);
  assertCheckedBefore(body);
  await tx(async (client) => {
    const written = await rates.saveVersion(client, body, actor);
    await claimSource(client, body.source_document_id, written[0].statutory_rate_id, actor);
    const facts = { item: body.item, effective_from: body.effective_from, rows: written.length, ...sourceAudit(written[0]) };
    await emit(client, {
      key: EVENTS.STATUTORY_RATE_SAVED,
      entity: { type: "statutory_return", id: written[0].statutory_rate_id },
      actor,
      after: facts,
      payload: facts,
    });
  });
  const page = await repo.versionRows(pool, body.item, body.effective_from);
  return { ...page, data: page.data.map(rates.present) };
}

/**
 * DELETE /statutory/rates/:item/versions/:effective_from: Remove Change. A version still to come is taken back and the
 * version before it runs on again. One that has started is history (409 VERSION_IN_FORCE, shared/db/effective-dated);
 * so is one an advanced run sent for approval, approved or paid was computed with (payroll.lock, §13.2 item 34). The
 * run of its month is locked first, then the item's versions, the order Compute takes them in.
 * @param {object} actor
 * @param {{item: string, effective_from: string}} version  StatutoryVersionParams
 */
async function removeChange(actor, version) {
  await tx(async (client) => {
    if (version.effective_from > lagos.today()) await lock.assertVersionUnread(client, version.effective_from, { advancedOnly: true });
    const { removed, reopened } = await rates.removeVersion(client, version);
    const facts = { item: version.item, effective_from: version.effective_from, rows: removed.length };
    const runsOn = reopened.length ? { effective_from: String(reopened[0].effective_from).slice(0, 10), rows: reopened.length } : null;
    await emit(client, {
      key: EVENTS.STATUTORY_RATE_REMOVED,
      entity: { type: "statutory_return", id: removed[0].statutory_rate_id },
      actor,
      before: { ...facts, ...sourceAudit(removed[0]) },
      after: { item: version.item, runs_on: runsOn },
      payload: { ...facts, runs_on: runsOn },
    });
  });
}

/** The report carries pay and tax numbers: a reader whose role hides either is refused it. */
async function assertMayReadReport(user) {
  const [salary, statutory] = await Promise.all([canSee(pool, user, "employee.salary"), canSee(pool, user, "employee.statutory")]);
  if (!salary || !statutory) throw new AppError("FIELD_RESTRICTED", "Your role cannot see pay or tax numbers.", 403);
}

/** POST /payroll/runs/:id/statutory-report: 202 with the file the screen waits on. */
const requestReport = (actor, runId) => tx((client) => report.requestReport(client, runId, { actor }));

/* ------------------------------------------------------------------ *
 * A person's Pay to Date (§6.12 rule 11, §13.1 item 42)
 * ------------------------------------------------------------------ */

/** The person exists, or 404. */
async function assertPerson(db, employeeId) {
  const { rows } = await db.query("SELECT 1 FROM employee WHERE employee_id = $1", [employeeId]);
  if (!rows.length) throw new AppError("NOT_FOUND", "That person does not exist", 404);
}

/** A row as the contract's PayToDate. */
const presentPayToDate = (r) => ({
  employee_pay_to_date_id: r.employee_pay_to_date_id,
  employee_id: r.employee_id,
  year: Number(r.year),
  taxable_pay: r.taxable_pay,
  tax_paid: r.tax_paid,
  document_id: r.document_id ?? null,
  entered_by_name: r.entered_by_name ?? null,
  updated_at: new Date(r.updated_at).toISOString(),
});

/** GET /statutory/employees/:employee_id/pay-to-date: a person's years, newest first, 25 a page. */
async function payToDate(employeeId, query) {
  await assertPerson(pool, employeeId);
  const page = await repo.payToDatePage(pool, employeeId, query);
  return { ...page, data: page.data.map(presentPayToDate) };
}

/**
 * PUT /statutory/employees/:employee_id/pay-to-date/:year: the year's taxable pay and tax before MyCity's first statutory
 * month, made or replaced (this year or the next, 422 YEAR_NOT_ALLOWED). A leaving certificate staged through the upload
 * engine is claimed for the person as a restricted `leaving_certificate`; one this person's entry already holds is named
 * again as it is. A later run reads it as the start of the person's year to date; a run already sent keeps what it read.
 */
async function savePayToDate(actor, { employee_id: employeeId, year }, body) {
  assertTaxYear(year);
  await tx(async (client) => {
    await assertPerson(client, employeeId);
    const row = await repo.writePayToDate(client, {
      employee_id: employeeId,
      year,
      taxable_pay: body.taxable_pay,
      tax_paid: body.tax_paid,
      document_id: body.document_id,
      entered_by: actor ? actor.user_id : null,
    });
    if (body.document_id)
      await vault.claim(client, {
        document_id: body.document_id,
        doc_type: CERTIFICATE_DOC_TYPE,
        entity: { type: "salary_structure", id: employeeId },
        subject_employee_id: employeeId,
        actor,
        field: "document_id",
        sensitivity: "restricted",
      });
    await emit(client, {
      key: EVENTS.PAY_TO_DATE_SAVED,
      entity: { type: "salary_structure", id: employeeId },
      actor,
      after: { year, has_certificate: Boolean(body.document_id) },
      payload: { employee_id: employeeId, year, created: row.created === true, document_id: body.document_id || null },
    });
  });
  return presentPayToDate(await repo.payToDateOf(pool, employeeId, year));
}

/** DELETE /statutory/employees/:employee_id/pay-to-date/:year: an entry made in error; 404 for a year with none. */
async function removePayToDate(actor, { employee_id: employeeId, year }) {
  await tx(async (client) => {
    const gone = await repo.deletePayToDate(client, employeeId, year);
    if (!gone) throw new AppError("NOT_FOUND", "No pay to date for that year", 404);
    await emit(client, {
      key: EVENTS.PAY_TO_DATE_REMOVED,
      entity: { type: "salary_structure", id: employeeId },
      actor,
      before: { year },
      payload: { employee_id: employeeId, year },
    });
  });
}

module.exports = { list, items, save, removeChange, assertMayReadReport, requestReport, payToDate, savePayToDate, removePayToDate };
