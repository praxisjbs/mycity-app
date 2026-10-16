"use strict";
/**
 * Organisation: departments, employees, reporting lines.
 *
 * First cut, written with scripts/db/create-admin.js (internal meeting
 * 12 October 2026: an account is never provisioned without a full employee
 * record behind it). Keys are the column names 0040_organisation.sql must use;
 * gate 6 (check/contract-columns.js) holds the two together once the
 * migration exists. List, update and import-row schemas join this file with
 * the organisation module in M0.
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  email,
  phone,
  isoDate,
  money,
} = require("./common");

/**
 * PROPOSED values, to confirm with MyCity (Cynthia). Most MyCity staff are
 * engaged as contractors or consultants (internal workflow meeting,
 * 12 October 2026), so both are first-class values, not "other".
 */
const EMPLOYMENT_TYPES = [
  "full_time",
  "part_time",
  "contractor",
  "consultant",
  "intern",
];

/** MILESTONES §6.2: remote, hybrid and on-site are work patterns on the employee. */
const WORK_PATTERNS = ["on_site", "hybrid", "remote"];

/** The values employee_gender_check allows (migration 0110). */
const GENDERS = ["female", "male"];

const EmploymentType = z.enum(EMPLOYMENT_TYPES);
const WorkPattern = z.enum(WORK_PATTERNS);
const Gender = z.enum(GENDERS);

/**
 * Staff number as issued by numbering: MyCity's five digits ("00001") by default, or whatever
 * prefix Settings gives the scheme ("HQ-0042"). Optional on create: allocated when absent.
 */
const staffNumber = z
  .string()
  .trim()
  .toUpperCase()
  .max(20)
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "use letters and digits");

/** The fields every employee has, whoever creates them and however. */
const employeeCore = {
  staff_number: staffNumber.optional(),
  first_name: text(100),
  last_name: text(100),
  work_email: email,
  phone,
  job_title: text(150),
  start_date: isoDate,
  employment_type: EmploymentType,
  work_pattern: WorkPattern,
  gender: Gender.optional(),
  date_of_birth: isoDate.optional(),
  next_of_kin_name: optionalText(150),
  next_of_kin_phone: phone.optional(),
  next_of_kin_relationship: optionalText(50),
};

/** Restricted fields (field-masked, BACKEND_STRUCTURE §9.4). Optional on create. */
const employeeRestricted = {
  bank_name: optionalText(100),
  account_number: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "must be a 10-digit NUBAN")
    .optional(),
  gross_monthly: money.optional(),
};

/** POST /api/v1/employees. References are ids, resolved on screen through pickers. */
const EmployeeCreate = z
  .object({
    ...employeeCore,
    ...employeeRestricted,
    department_id: uuid,
    line_manager_id: uuid.optional(),
    dotted_manager_id: uuid.optional(),
    worksite_id: uuid.optional(),
  })
  .strict();

/**
 * scripts/db/create-admin.js input. The same employee fields as
 * EmployeeCreate, except the department is named rather than picked: on a
 * clean database there is no department to pick yet, so the script finds it
 * by name or creates it. A first administrator has no line manager.
 */
const AdminBootstrap = z
  .object({
    employee: z
      .object({
        ...employeeCore,
        ...employeeRestricted,
        department_name: text(100),
      })
      .strict(),
    role_code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,49}$/, "must be a role code"),
    is_ceo: z.boolean().default(false),
  })
  .strict();

module.exports = {
  EMPLOYMENT_TYPES,
  WORK_PATTERNS,
  GENDERS,
  EmploymentType,
  WorkPattern,
  Gender,
  EmployeeCreate,
  AdminBootstrap,
};
