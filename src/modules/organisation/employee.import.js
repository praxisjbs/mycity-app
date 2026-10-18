"use strict";
/**
 * The staff importer: a staff sheet in, people out, through the organisation service
 * (BACKEND_STRUCTURE §9.4, docs/guides/foundation.md §5, §6.1).
 *
 * It is the one importer People use for the register, and the one the roster loader
 * runs on each deploy (scripts/db/load-staff.js). Both go through the import engine, so
 * a sheet is mapped, previewed as a real run that is rolled back, committed row by row
 * in its own savepoint, and revertible, and every row is written by
 * `organisation.service.importRow` exactly as the Add Employee form writes one.
 *
 * What this file knows that a form does not:
 *
 *  - **One Name cell.** "Tobiloba Iyanuoluwa Dada" becomes first, middle and last name.
 *  - **A department by name.** "Backend Operations" is resolved to a department, and
 *    created at commit when the person ticks it.
 *  - **A line manager in prose.** A name, a name and a post, a post on its own, or a
 *    post nobody holds with a dotted line beside it (manager-text.js). It resolves to a
 *    person or to the vacant seat holding that post, in the second pass, once every row
 *    of the file exists. A cell that matches nothing is an error on that row.
 *  - **VACANT rows.** A row whose Name says VACANT is a seat in the structure, not a
 *    person: it carries reports and becomes a suggested vacancy in Recruitment.
 *
 * Four options only the roster loader sets (`ctx.options`):
 *   keep_existing            fill what is missing, never write over what the app holds
 *   work_email_by_job_title  the work email of a post whose Email cell is empty
 *   reclaim_staff_numbers    a staff number the sheet gives one of its people is theirs:
 *                            a holder the sheet does not name moves to the next free one
 *   roster_work_emails       every address the sheet names, so a holder it does name is
 *                            left on their number and the row is a problem instead
 *
 * Importing a sheet by hand sets none of them, so a staff number already in use is a
 * problem on the row, as it is on the Add Employee form.
 */
const c = require("@mycity/contract");
const { defineImporter } = require("../../shared/import/registry");
const managerText = require("./manager-text");
const repo = require("./organisation.repo");
const service = require("./organisation.service");

/**
 * Per-batch notes resolve() leaves for link(): which dotted manager a line-manager text
 * named. The engine resolves every row before it links any, and hands link the resolved
 * id rather than the words, so the pair is remembered here, by the id the words resolved
 * to. A post that is named with a dotted line on one row and without it on another is
 * "mixed": no dotted line is written from a sheet that contradicts itself.
 */
const BATCHES = new Map();
const BATCH_MEMORY = 8;

function notesFor(ctx) {
  const id = (ctx && ctx.batch && ctx.batch.import_batch_id) || "none";
  if (!BATCHES.has(id)) {
    BATCHES.set(id, { dottedByPrimary: new Map() });
    for (const old of [...BATCHES.keys()].slice(0, Math.max(0, BATCHES.size - BATCH_MEMORY)))
      BATCHES.delete(old);
  }
  return BATCHES.get(id);
}

/**
 * The sheet's values for a person already on the register, so the engine can diff them.
 * The reporting line is part of the snapshot: a sheet that names the manager somebody
 * already has is not a change, and the batch must not report one.
 */
const valuesOf = (employee, row) => ({
  staff_number: employee.staff_number,
  full_name: row ? row.display_name : undefined,
  job_title: employee.job_title,
  department: employee.department_id,
  work_email: employee.work_email,
  phone: employee.phone,
  employment_type: employee.employment_type,
  work_pattern: employee.work_pattern,
  start_date: employee.start_date,
  line_manager: employee.line_manager_id || employee.line_manager_seat_id || undefined,
});

async function found(client, employee) {
  if (!employee) return null;
  const row = await repo.findEmployeeById(client, employee.employee_id);
  return {
    id: employee.employee_id,
    values: valuesOf(row, { display_name: `${row.first_name} ${row.last_name}`.trim() }),
  };
}

const FIELDS = [
  {
    key: "staff_number",
    label: "Staff Number",
    aliases: ["staff id", "staff no", "employee id", "employee number", "id", "number"],
    example: "00019",
    hint: "Left empty, the system issues the next one",
  },
  {
    key: "full_name",
    label: "Name",
    aliases: ["full name", "staff name", "employee name", "employee"],
    required: true,
    example: "Tobiloba Iyanuoluwa Dada",
    hint: "VACANT marks a post nobody holds yet",
  },
  {
    key: "job_title",
    label: "Designation",
    aliases: ["job title", "role", "position", "title", "designation"],
    required: true,
    example: "Content & Listing Associate",
  },
  {
    key: "department",
    label: "Department",
    aliases: ["team", "unit", "division"],
    type: "reference",
    ref: "department",
    createMissing: "confirm",
    required: true,
    example: "Backend Operations",
  },
  {
    key: "work_email",
    label: "Work Email",
    aliases: ["email", "company email", "official email"],
    type: "email",
    example: "name@mycityapp.io",
  },
  {
    key: "phone",
    label: "Phone",
    aliases: ["phone number", "mobile", "telephone", "contact"],
    type: "phone",
    example: "08031234567",
  },
  {
    key: "line_manager",
    label: "Line Manager",
    aliases: ["manager", "reports to", "supervisor", "line manager name"],
    type: "reference",
    ref: "employee",
    pass: 2,
    example: "Bode Oluwasanmi",
    hint: "A name, a post, or a post with a dotted line beside it",
  },
  {
    key: "employment_type",
    label: "Employment Type",
    aliases: ["emploment type", "engagement", "engagement type", "contract type"],
    type: "enum",
    /* The last entry is the short form MyCity's own sheets use for full time. */
    options: [
      { value: "full_time", label: "Full Time" },
      { value: "part_time", label: "Part Time" },
      { value: "contractor", label: "Contractor" },
      { value: "consultant", label: "Consultant" },
      { value: "intern", label: "Intern" },
      { value: "full_time", label: "FTE" },
    ],
    example: "Full Time",
  },
  {
    key: "work_pattern",
    label: "Work Arrangement",
    aliases: ["work pattern", "arrangement", "work mode", "location type"],
    type: "enum",
    options: [
      { value: "on_site", label: "On Site" },
      { value: "hybrid", label: "Hybrid" },
      { value: "remote", label: "Remote" },
    ],
    example: "Remote",
  },
  {
    key: "start_date",
    label: "Joining Date",
    aliases: ["doj", "date of joining", "joined", "start date", "date joined"],
    type: "date",
    example: "02/03/2026",
  },
  {
    key: "gender",
    label: "Gender",
    type: "enum",
    options: [
      { value: "female", label: "Female" },
      { value: "male", label: "Male" },
    ],
    example: "Female",
  },
  {
    key: "date_of_birth",
    label: "Date of Birth",
    aliases: ["dob", "birthday"],
    type: "date",
    mask: "employee.personal",
    example: "03/07/1991",
    hint: "A full date; a day and month alone is not a date",
  },
  {
    key: "bank_name",
    label: "Bank Name",
    aliases: ["bank"],
    mask: "employee.bank",
    example: "Providus Bank",
  },
];

defineImporter({
  key: "employees",
  label: "Employees",
  permission: ["people", "create"],
  entity: "employee",
  schema: c.organisation.EmployeeImportRow,
  matchKeys: ["staff_number", "work_email"],
  fields: FIELDS,

  /** An existing person by one match key. */
  find: async (client, { key, value }) => {
    if (key === "staff_number")
      return found(client, await repo.findEmployeeByStaffNumber(client, value));
    if (key === "work_email")
      return found(client, await repo.findEmployeeByWorkEmail(client, value));
    return null;
  },

  /** A department by name; a line manager by name, post, or the seat holding the post. */
  resolve: async (client, field, value, ctx) => {
    if (field.key === "department") {
      const department = await repo.findDepartmentByName(client, value);
      return department ? department.department_id : null;
    }
    if (field.key !== "line_manager") return null;
    const { primary, dotted } = managerText.parse(value);
    const target = await service.resolveManager(client, primary);
    if (!target) return null;
    const id = target.employee_id || target.org_seat_id;
    const notes = notesFor(ctx).dottedByPrimary;
    const dottedTarget = dotted ? await service.resolveManager(client, dotted) : null;
    const dottedId = dottedTarget
      ? dottedTarget.employee_id || dottedTarget.org_seat_id
      : null;
    if (notes.has(id)) {
      const seen = notes.get(id);
      if (seen.dotted !== dottedId) seen.mixed = true;
    } else {
      notes.set(id, { dotted: dottedId, mixed: false });
    }
    return id;
  },

  /** A department the sheet names and the system does not have yet. */
  create: async (client, field, value, ctx) => {
    if (field.key !== "department") return null;
    const department = await service.createDepartment(client, { name: value }, ctx.actor);
    return department.department_id;
  },

  /** One row: a person created or corrected, or the seat a VACANT row stands for. */
  write: async (client, values, ctx) => {
    const result = await service.importRow(client, values, ctx);
    return { id: result.target_id, action: result.action };
  },

  /** The second pass: the reporting line, now that every row of the file exists. */
  link: async (client, id, refs, ctx) => {
    const managerId = refs.line_manager;
    if (!managerId) return;
    const employee = await repo.findEmployeeById(client, id);
    if (!employee) return; // a VACANT row: a seat's own line is set on the organogram
    const keep = Boolean(ctx.options && ctx.options.keep_existing);
    const seat = await repo.findSeatById(client, managerId);
    const patch = seat ? { line_manager_seat_id: managerId } : { line_manager_id: managerId };
    const note = notesFor(ctx).dottedByPrimary.get(managerId);
    if (note && note.dotted && !note.mixed) {
      const dottedSeat = await repo.findSeatById(client, note.dotted);
      Object.assign(
        patch,
        dottedSeat
          ? { dotted_manager_seat_id: note.dotted }
          : { dotted_manager_id: note.dotted },
      );
    }
    /* The roster fills what is missing and never writes over what a person set on screen. */
    if (keep) {
      if (employee.line_manager_id || employee.line_manager_seat_id) {
        delete patch.line_manager_id;
        delete patch.line_manager_seat_id;
      }
      if (employee.dotted_manager_id || employee.dotted_manager_seat_id) {
        delete patch.dotted_manager_id;
        delete patch.dotted_manager_seat_id;
      }
    }
    if (Object.keys(patch).length === 0) return;
    await service.setReportingLine(
      client,
      id,
      { ...patch, reason: `Staff import row ${ctx.row_number}` },
      ctx.actor,
    );
  },

  /** Revert a create: the person is archived, a seat is closed. Nothing is deleted. */
  archive: async (client, id, ctx) => {
    const employee = await repo.findEmployeeById(client, id);
    if (employee) {
      await service.archiveEmployee(client, id, "The staff import was reverted", ctx.actor);
      return;
    }
    if (await repo.findSeatById(client, id))
      await service.updateSeat(client, id, { status: "closed" }, ctx.actor);
  },

  /** Revert an update: the record goes back to the snapshot taken before the import. */
  restore: async (client, id, before, ctx) => {
    if (!before) return;
    const patch = {
      ...(before.full_name ? service.splitName(before.full_name) : {}),
      ...(before.job_title ? { job_title: before.job_title } : {}),
      ...(before.department ? { department_id: before.department } : {}),
      ...(before.work_email ? { work_email: before.work_email } : {}),
      ...(before.phone ? { phone: before.phone } : {}),
      ...(before.employment_type ? { employment_type: before.employment_type } : {}),
      ...(before.work_pattern ? { work_pattern: before.work_pattern } : {}),
      ...(before.start_date ? { start_date: before.start_date } : {}),
    };
    if (Object.keys(patch).length) await service.updateEmployee(client, id, patch, ctx.actor);
  },
});

module.exports = { FIELDS };
