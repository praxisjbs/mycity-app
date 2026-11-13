"use strict";
/**
 * A person's declared rent for a tax year, for payroll's rent relief (docs/guides/payroll.md §6.12 rule 15, §13.1 item
 * 41): kept with the person on People · Employees (the record's Tax and Pension tab) and read by Compute in advanced mode.
 * The Joint Revenue Board's Guidelines 2026 say what is declared (paras 9.2 to 9.6): the rent the person paid (their own
 * share, in a shared tenancy) and the period it covers, the legal tenant, the landlord with a mobile number, Tax ID or
 * NIN, the property's address and the evidence of payment. Every field is masked as `employee.statutory`
 * (field-mask.js); the controller refuses the routes to a role that hides it.
 *
 *   list(db, employeeId, query)      GET /employees/:id/rent-declarations, newest year first, 25 a page
 *   save(client, args)               PUT /employees/:id/rent-declarations/:year: made or replaced; the address kept as a
 *                                    place (places.save, owner employee_rent_declaration.property_address), the evidence
 *                                    claimed from the upload engine as a `rent_evidence` document
 *   remove(client, args)             DELETE /employees/:id/rent-declarations/:year
 *   yearRentOf(declaration, year)    the rent pro-rated to the year by the months it covers (para 9.5)
 *   yearRentsFor(db, ids, year)      each person's year rent, for a run
 *   assertTaxYear(year)              this year or the next, in Lagos (422 YEAR_NOT_ALLOWED)
 *
 * One write path: every write is here, inside the caller's transaction, with emit(). Events carry the person and the
 * year, never an amount (§6.13 rule 5).
 */
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { pageQuery, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const places = require("../../shared/places/places");
const vault = require("../../shared/documents/vault");
const lagos = require("../../shared/time/lagos");
const m = require("../../shared/money/money");
const { EVENTS, RENT_EVIDENCE_DOC_TYPE } = require("./organisation.events");

/** The address field's owner (shared/places/owners.js). */
const OWNER = "employee_rent_declaration.property_address";

/** The most people a run pays (payroll.inputs MAX_PEOPLE): one declaration each a year. */
const MAX_PEOPLE = 5000;

const COLUMNS = `r.employee_rent_declaration_id, r.employee_id, r.year, r.rent_paid::text AS rent_paid,
  r.covers_from::text AS covers_from, r.covers_to::text AS covers_to, r.tenant_name, r.landlord_name, r.landlord_phone,
  r.landlord_tax_id, r.landlord_nin, r.property_address, r.evidence_document_id, r.updated_at,
  CASE WHEN e.employee_id IS NULL THEN NULL ELSE btrim(e.first_name || ' ' || e.last_name) END AS entered_by_name`;
const JOINS = `LEFT JOIN app_user u ON u.user_id = r.entered_by LEFT JOIN employee e ON e.employee_id = u.employee_id`;

/** A month's place in time, to count months between two first days. */
const monthIndex = (iso) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;

/**
 * The rent pro-rated to `year` by the months it covers (the Guidelines para 9.5: ₦2,000,000 for 24 months gives
 * ₦1,000,000 for a year): the rent × the months of the period inside the year ÷ the months of the period. Unrounded, so
 * the relief made from it is rounded once, in its PAYE line. Nothing when the period has no month in the year.
 * @param {{rent_paid: string, covers_from: string, covers_to: string}} d
 * @param {number} year
 * @returns {object} a Decimal
 */
function yearRentOf(d, year) {
  const from = monthIndex(d.covers_from);
  const to = monthIndex(d.covers_to);
  const inYear = Math.min(to, year * 12 + 11) - Math.max(from, year * 12) + 1;
  if (inYear <= 0 || to < from) return m.ZERO;
  return m.money(d.rent_paid).times(inYear).dividedBy(to - from + 1);
}

/** A declaration as the contract's RentDeclaration, with its year's rent and its place for an edit form. */
function present(row, place) {
  return {
    employee_rent_declaration_id: row.employee_rent_declaration_id,
    employee_id: row.employee_id,
    year: Number(row.year),
    rent_paid: row.rent_paid,
    year_rent: m.toWire(yearRentOf(row, Number(row.year))),
    covers_from: row.covers_from,
    covers_to: row.covers_to,
    tenant_name: row.tenant_name,
    landlord_name: row.landlord_name,
    landlord_phone: row.landlord_phone ?? null,
    landlord_tax_id: row.landlord_tax_id ?? null,
    landlord_nin: row.landlord_nin ?? null,
    property_address: row.property_address,
    property_address_place: place || null,
    evidence_document_id: row.evidence_document_id ?? null,
    entered_by_name: row.entered_by_name ?? null,
    updated_at: new Date(row.updated_at).toISOString(),
  };
}

/** A tax year a declaration or a Pay to Date may be for: this one or the next, in Lagos. */
function assertTaxYear(year) {
  const now = Number(lagos.today().slice(0, 4));
  if (year !== now && year !== now + 1)
    throw new AppError("YEAR_NOT_ALLOWED", "Pick this year or next", 422, { year: ["This year or next"] });
}

/** The person exists, or 404. */
async function assertPerson(db, employeeId) {
  const { rows } = await db.query("SELECT 1 FROM employee WHERE employee_id = $1", [employeeId]);
  if (!rows.length) throw new AppError("NOT_FOUND", "That person does not exist", 404);
}

/**
 * GET /employees/:id/rent-declarations: a person's declarations, newest year first.
 * @param {{query: Function}} db
 * @param {string} employeeId
 * @param {object} query  PageQuery
 */
async function list(db, employeeId, query) {
  const page = await pageQuery(
    db,
    `SELECT ${COLUMNS}, ${TOTAL_COL}
       FROM employee_rent_declaration r ${JOINS}
      WHERE r.employee_id = $1
      ORDER BY r.year DESC, r.employee_rent_declaration_id`,
    [employeeId],
    query,
  );
  const views = await places.views(db, OWNER, page.data.map((r) => r.employee_rent_declaration_id));
  return { ...page, data: page.data.map((r) => present(r, views.get(String(r.employee_rent_declaration_id)))) };
}

/** One declaration as it now stands, or null. */
async function one(db, employeeId, year) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM employee_rent_declaration r ${JOINS} WHERE r.employee_id = $1 AND r.year = $2`,
    [employeeId, year],
  );
  if (!rows[0]) return null;
  return present(rows[0], await places.view(db, OWNER, rows[0].employee_rent_declaration_id));
}

/**
 * PUT /employees/:id/rent-declarations/:year, inside the caller's transaction: the year's declaration made or replaced.
 * The months covered must include one of the year (422 COVERS_OUTSIDE_YEAR); the address is kept as a place; the
 * evidence, staged through POST /documents, is claimed as a restricted `rent_evidence` document of the person.
 * @param {import("pg").PoolClient} client
 * @param {{employee_id: string, year: number, body: object, actor: object}} args
 * @returns {Promise<object>} the declaration as the contract's RentDeclaration
 */
async function save(client, { employee_id: employeeId, year, body, actor }) {
  assertTaxYear(year);
  if (yearRentOf({ rent_paid: body.rent_paid, covers_from: body.covers_from, covers_to: body.covers_to }, year).isZero())
    throw new AppError("COVERS_OUTSIDE_YEAR", "The rent covers no month of this year", 422, { covers_from: ["Outside the year"] });
  await assertPerson(client, employeeId);
  const line = places.lineOf(body.property_address);
  const { rows } = await client.query(
    `INSERT INTO employee_rent_declaration (employee_id, year, rent_paid, covers_from, covers_to, tenant_name, landlord_name,
                                            landlord_phone, landlord_tax_id, landlord_nin, property_address,
                                            evidence_document_id, entered_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (employee_id, year) DO UPDATE
        SET rent_paid = EXCLUDED.rent_paid, covers_from = EXCLUDED.covers_from, covers_to = EXCLUDED.covers_to,
            tenant_name = EXCLUDED.tenant_name, landlord_name = EXCLUDED.landlord_name,
            landlord_phone = EXCLUDED.landlord_phone, landlord_tax_id = EXCLUDED.landlord_tax_id,
            landlord_nin = EXCLUDED.landlord_nin, property_address = EXCLUDED.property_address,
            evidence_document_id = EXCLUDED.evidence_document_id, entered_by = EXCLUDED.entered_by
     RETURNING employee_rent_declaration_id, (xmax = 0) AS created`,
    [
      employeeId,
      year,
      body.rent_paid,
      body.covers_from,
      body.covers_to,
      body.tenant_name,
      body.landlord_name,
      body.landlord_phone || null,
      body.landlord_tax_id || null,
      body.landlord_nin || null,
      line,
      body.evidence_document_id,
      actor ? actor.user_id || null : null,
    ],
  );
  const id = rows[0].employee_rent_declaration_id;
  await places.save(client, OWNER, id, body.property_address, { field: "property_address" });
  await vault.claim(client, {
    document_id: body.evidence_document_id,
    doc_type: RENT_EVIDENCE_DOC_TYPE,
    entity: { type: "employee", id: employeeId },
    subject_employee_id: employeeId,
    actor,
    field: "evidence_document_id",
    sensitivity: "restricted",
  });
  await emit(client, {
    key: EVENTS.EMPLOYEE_RENT_DECLARED,
    entity: { type: "employee", id: employeeId },
    actor,
    after: { year, covers_from: body.covers_from, covers_to: body.covers_to },
    payload: { employee_id: employeeId, year, created: rows[0].created === true, evidence_document_id: body.evidence_document_id },
  });
  return one(client, employeeId, year);
}

/**
 * DELETE /employees/:id/rent-declarations/:year, inside the caller's transaction: a declaration made in error taken
 * away, with its place; 404 for a year with none. The evidence stays in the vault, on the person.
 */
async function remove(client, { employee_id: employeeId, year, actor }) {
  const { rows } = await client.query(
    `DELETE FROM employee_rent_declaration WHERE employee_id = $1 AND year = $2 RETURNING employee_rent_declaration_id`,
    [employeeId, year],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", "No rent declared for that year", 404);
  await places.remove(client, OWNER, rows[0].employee_rent_declaration_id);
  await emit(client, {
    key: EVENTS.EMPLOYEE_RENT_DECLARATION_REMOVED,
    entity: { type: "employee", id: employeeId },
    actor,
    before: { year },
    payload: { employee_id: employeeId, year },
  });
}

/**
 * Each person's declared rent for `year`, pro-rated to it, for a run (payroll.run.js): a Decimal a person, unrounded.
 * @param {{query: Function}} db
 * @param {string[]} employeeIds
 * @param {number} year
 * @returns {Promise<Map<string, object>>}
 */
async function yearRentsFor(db, employeeIds, year) {
  if (!employeeIds.length) return new Map();
  // pagination:complete one declaration a person a year, for the people one run pays
  const { rows } = await completeQuery(
    db,
    `SELECT employee_id, rent_paid::text AS rent_paid, covers_from::text AS covers_from, covers_to::text AS covers_to
       FROM employee_rent_declaration WHERE employee_id = ANY($1::uuid[]) AND year = $2
      ORDER BY employee_id`,
    [employeeIds, year],
    { label: "The declared rent of a run's people", ceiling: MAX_PEOPLE },
  );
  return new Map(rows.map((r) => [r.employee_id, yearRentOf(r, year)]));
}

/** The readable line follows the place when one saved while address search was down is named (organisation.events.js). */
function setAddressLine(client, key, line) {
  return client.query("UPDATE employee_rent_declaration SET property_address = $2 WHERE employee_rent_declaration_id = $1", [key, line]);
}

module.exports = { OWNER, yearRentOf, assertTaxYear, list, one, save, remove, yearRentsFor, setAddressLine };
