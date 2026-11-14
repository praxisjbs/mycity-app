"use strict";
/**
 * Organisation: departments, employees, reporting lines.
 *
 * First cut, written with scripts/db/create-admin.js (internal meeting
 * 12 October 2026: an account is never provisioned without a full employee
 * record behind it). Keys are the column names 0040_organisation.sql must use;
 * gate 6 (check/contract-columns.js) holds the two together once the
 * migration exists.
 *
 * Grown on 16/10/2026 with the People register (#24), the employee 360, the
 * reporting tree behind Org Chart (#91) and Organogram (#92), departments,
 * vacant seats and the staff import row (docs/guides/foundation.md §5,
 * docs/guides/organogram.md §4 to §6).
 */
const { z } = require("zod");
const {
  uuid,
  text,
  optionalText,
  email,
  phone,
  isoDate,
  isoDateTime,
  money,
  positiveMoney,
  monthStart,
  taxYear,
  blank,
  listQuery,
  Paged,
  recordId,
  changesBeside,
  nothingOn,
} = require("./common");
const { PlaceInput, PlaceView } = require("./maps");

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
 * Nigeria's 36 states and the Federal Capital Territory, by the names people read. Where a person lives decides which
 * State's Internal Revenue Service their PAYE goes to (docs/guides/payroll.md §13.1 item 46; the Joint Revenue Board's
 * Guidelines 2026, para 25). A fixed list the code knows, not MyCity's data; employee_state_of_residence_check holds the
 * same codes (migration 6050).
 */
const STATE_LABELS = Object.freeze({
  abia: "Abia",
  adamawa: "Adamawa",
  akwa_ibom: "Akwa Ibom",
  anambra: "Anambra",
  bauchi: "Bauchi",
  bayelsa: "Bayelsa",
  benue: "Benue",
  borno: "Borno",
  cross_river: "Cross River",
  delta: "Delta",
  ebonyi: "Ebonyi",
  edo: "Edo",
  ekiti: "Ekiti",
  enugu: "Enugu",
  fct: "Federal Capital Territory",
  gombe: "Gombe",
  imo: "Imo",
  jigawa: "Jigawa",
  kaduna: "Kaduna",
  kano: "Kano",
  katsina: "Katsina",
  kebbi: "Kebbi",
  kogi: "Kogi",
  kwara: "Kwara",
  lagos: "Lagos",
  nasarawa: "Nasarawa",
  niger: "Niger",
  ogun: "Ogun",
  ondo: "Ondo",
  osun: "Osun",
  oyo: "Oyo",
  plateau: "Plateau",
  rivers: "Rivers",
  sokoto: "Sokoto",
  taraba: "Taraba",
  yobe: "Yobe",
  zamfara: "Zamfara",
});
const NIGERIAN_STATES = Object.freeze(Object.keys(STATE_LABELS));
const NigerianState = z.enum(NIGERIAN_STATES);

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

/** A Nigerian bank account: ten digits (NUBAN). */
const accountNumber = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "Ten digits");

/** A tax or pension number as it is issued: letters, digits and hyphens (a TIN, a pension PIN, an NHF number). */
const statutoryNumber = z
  .string()
  .trim()
  .toUpperCase()
  .max(30, "At most 30 characters")
  .regex(/^[A-Z0-9]+(?:[-/][A-Z0-9]+)*$/, "Letters and digits");

/** Gross pay: an amount, never below zero (employee_gross_monthly_check, migration 0110). */
const pay = money.refine((v) => !v.startsWith("-"), "Not below zero");

/**
 * An optional field on a correction (PATCH): "" or null clears it, left out leaves it. Edit
 * sends only the fields the person changed, so an emptied field is one they cleared.
 */
const clearable = (schema) =>
  schema
    .or(z.literal(""))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

/** The fields every employee has, whoever creates them and however. */
const employeeCore = {
  staff_number: blank(staffNumber),
  first_name: text(100),
  middle_name: optionalText(100),
  last_name: text(100),
  /** What colleagues call them, when it is not the first name. */
  preferred_name: optionalText(100),
  work_email: email,
  phone,
  job_title: text(150),
  start_date: isoDate,
  employment_type: EmploymentType,
  work_pattern: WorkPattern,
  /** A consultant's or contractor's last day under contract; empty for permanent staff. */
  contract_ends_on: blank(isoDate),
  /** End of probation; the same day as start_date for someone engaged without one. */
  confirmation_due_on: blank(isoDate),
  confirmed_on: blank(isoDate),
  gender: blank(Gender),
  date_of_birth: blank(isoDate),
  next_of_kin_name: optionalText(150),
  next_of_kin_phone: blank(phone),
  next_of_kin_relationship: optionalText(50),
};

/** Restricted fields (field-masked, BACKEND_STRUCTURE §9.4). Optional on create. */
const employeeRestricted = {
  /**
   * Masked as personal details (field-mask.js employee.personal), as is personal_email. Picked
   * or pinned, never typed (F27); the person sets it on My Profile.
   */
  home_address: PlaceInput.optional(),
  personal_email: blank(email),
  bank_name: optionalText(100),
  account_number: blank(accountNumber),
  gross_monthly: blank(pay),
};

/**
 * Tax and pension, masked as `employee.statutory` (field-mask.js) and read by payroll in advanced mode
 * (docs/guides/payroll.md §6.12): the numbers the statutory report prints, whether the person contributes to the
 * National Housing Fund (their choice in the private sector, NHF Act s.4(1)(b); §13.1 item 44) and the State they live in
 * (§13.1 item 46). Optional on create, as on People · Employees' Tax and Pension step.
 */
const employeeStatutory = {
  tax_id: blank(statutoryNumber),
  pension_pin: blank(statutoryNumber),
  pension_administrator: optionalText(100),
  nhf_number: blank(statutoryNumber),
  nhf_contributes: z.boolean().optional(),
  state_of_residence: blank(NigerianState),
};

/**
 * The order an employee's dates keep (migrations 0040 and 0210 hold the first two in the
 * database too): a contract, a probation and its confirmation never end before the start date,
 * and a person is born before they start. Each issue lands on its own field, so the form marks
 * it as it is filled rather than when Add Employee is pressed (docs/guides/foundation.md §6.16).
 * The service applies the same to a correction against the stored record (employeeDateProblems).
 */
function employeeDateProblems(v) {
  const out = [];
  const start = v.start_date;
  if (!start) return out;
  for (const key of ["contract_ends_on", "confirmation_due_on", "confirmed_on"])
    if (v[key] && v[key] < start) out.push({ path: key, message: "Not before the start" });
  if (v.date_of_birth && v.date_of_birth >= start) out.push({ path: "date_of_birth", message: "Before the start date" });
  return out;
}

const employeeDates = (v, ctx) => {
  for (const p of employeeDateProblems(v)) ctx.addIssue({ code: "custom", path: [p.path], message: p.message });
};

/* ------------------------------------------------------------------ *
 * The register: lists, the record, and the writes behind them
 * ------------------------------------------------------------------ */

/**
 * employee.status, exactly as the CHECK spells it (0110, widened by 0300).
 * `archived` is a record People have put away: it keeps its history, leaves
 * every list and the reporting tree, and comes back with Restore.
 */
const EMPLOYEE_STATUSES = ["active", "suspended", "left", "archived"];
const EmployeeStatus = z.enum(EMPLOYEE_STATUSES);

/** What a person's login is, as Settings and the register show it. */
/** `left`: the employee was archived and their login closed with them (docs/guides/identity.md §6.1). */
const LOGIN_STATES = ["none", "invited", "active", "suspended", "left"];
const LoginState = z.enum(LOGIN_STATES);

/**
 * A person, as a list or a card names them. `photo_url` is their photo's API path at the
 * list size (src/shared/db/person.js), fetched with the session; null shows their initials.
 */
const PersonRef = z
  .object({
    employee_id: uuid,
    display_name: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
    photo_url: z.string().nullable(),
  })
  .strict();

/**
 * Who someone reports to: a person, or a vacant seat when the post above them
 * is empty (docs/guides/organogram.md §4). Never both.
 */
const ManagerRef = z
  .object({
    employee_id: uuid.nullable(),
    org_seat_id: uuid.nullable(),
    display_name: z.string(),
    job_title: z.string().nullable(),
    vacant: z.boolean(),
  })
  .strict();

/** GET /employees. The filters the register's toolbar sends, and its sortable columns. */
const EmployeeListQuery = listQuery(
  {
    department_id: uuid.optional(),
    status: EmployeeStatus.optional(),
    work_pattern: WorkPattern.optional(),
    employment_type: EmploymentType.optional(),
    line_manager_id: uuid.optional(),
    /** `ending`: active people whose contract ends within 30 days, as Contracts Ending counts them. */
    contract: z.enum(["ending"]).optional(),
    /** `true`: the caller is left out, for a picker whose form may not name them (Raise Query). */
    exclude_self: z.enum(["true", "false"]).optional(),
  },
  ["display_name", "staff_number", "job_title", "department", "start_date", "created_at"],
);

/**
 * The assistant's headcount summary (docs/guides/praxis-ai.md §6.13; organogram.md §9): people by
 * department, status, work arrangement, employment type, line manager or when their confirmation is
 * due, with the register's own filters. Figures, never rows; no page.
 */
const EmployeeSummaryBy = z.enum(["department", "status", "work_pattern", "employment_type", "manager", "confirmation"]);
const EmployeeSummaryQuery = z
  .object({
    department_id: uuid.optional(),
    status: EmployeeStatus.optional(),
    work_pattern: WorkPattern.optional(),
    employment_type: EmploymentType.optional(),
    line_manager_id: uuid.optional(),
    by: EmployeeSummaryBy.default("department"),
  })
  .strict();

/** One row of the register. */
const EmployeeRow = z
  .object({
    employee_id: uuid,
    staff_number: z.string(),
    display_name: z.string(),
    job_title: z.string(),
    department_id: uuid,
    department: z.string(),
    line_manager: ManagerRef.nullable(),
    work_pattern: WorkPattern,
    employment_type: EmploymentType,
    status: EmployeeStatus,
    login: LoginState,
    start_date: isoDate.nullable(),
    /** Probation: the register shows On Probation until the day it is confirmed. */
    confirmation_due_on: isoDate.nullable(),
    confirmed_on: isoDate.nullable(),
    /** Their photo at the list size; null shows their initials. */
    photo_url: z.string().nullable(),
  })
  .strict();

const EmployeePage = Paged(EmployeeRow);

/** A tone a pill or a count carries on screen. */
const Tone = z.enum(["ok", "warn", "err", "info", "neutral"]);

/** The counts above the register, and the records waiting for a decision. */
const EmployeesSummary = z
  .object({
    kpis: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          value: z.string(),
          tone: Tone.optional(),
        })
        .strict(),
    ),
    arrangements: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
    departments: z.array(
      z.object({ label: z.string(), pct: z.number(), value: z.string() }).strict(),
    ),
    decisions: z.array(
      z
        .object({
          title: z.string(),
          text: z.string(),
          action: z.object({ tone: Tone, text: z.string() }).strict(),
          link: z.string(),
        })
        .strict(),
    ),
  })
  .strict();

/** The login block of the 360 (identity owns the login itself). */
const EmployeeLogin = z
  .object({
    user_id: uuid.nullable(),
    email: z.string().nullable(),
    state: LoginState,
    roles: z.array(z.object({ code: z.string(), name: z.string() }).strict()),
    last_sign_in_at: isoDateTime.nullable(),
  })
  .strict();

/**
 * GET /employees/:id, the employee 360: who they are, their job, their
 * reporting line and their login. Restricted fields (salary, bank, personal
 * details) are null for a viewer without the field grant
 * (shared/rbac/field-mask.js), so every one of them is nullable here.
 * Documents have the documents module's own route; history is paged.
 */
const Employee360 = z
  .object({
    employee_id: uuid,
    staff_number: z.string(),
    display_name: z.string(),
    first_name: z.string(),
    middle_name: z.string().nullable(),
    last_name: z.string(),
    preferred_name: z.string().nullable(),
    job_title: z.string(),
    department_id: uuid,
    department: z.string(),
    worksite_id: uuid.nullable(),
    status: EmployeeStatus,
    employment_type: EmploymentType,
    work_pattern: WorkPattern,
    start_date: isoDate.nullable(),
    contract_ends_on: isoDate.nullable(),
    confirmation_due_on: isoDate.nullable(),
    confirmed_on: isoDate.nullable(),
    left_on: isoDate.nullable(),
    /** The CEO's own record, which cannot be archived. */
    is_ceo: z.boolean(),
    archived_at: isoDateTime.nullable(),
    archive_reason: z.string().nullable(),
    work_email: z.string(),
    phone: z.string().nullable(),
    gender: Gender.nullable(),
    line_manager: ManagerRef.nullable(),
    dotted_manager: ManagerRef.nullable(),
    direct_reports: z.number().int(),
    login: EmployeeLogin,
    date_of_birth: isoDate.nullable(),
    home_address: z.string().nullable(),
    personal_email: z.string().nullable(),
    next_of_kin_name: z.string().nullable(),
    next_of_kin_phone: z.string().nullable(),
    next_of_kin_relationship: z.string().nullable(),
    bank_name: z.string().nullable(),
    account_number: z.string().nullable(),
    gross_monthly: money.nullable(),
    /**
     * Tax and pension numbers, masked as `employee.statutory` (field-mask.js): read by payroll's statutory report in
     * advanced mode (docs/guides/payroll.md §6.12 rule 6), where a missing one prints Not Set.
     */
    tax_id: z.string().nullable(),
    pension_pin: z.string().nullable(),
    pension_administrator: z.string().nullable(),
    nhf_number: z.string().nullable(),
    /** Whether they contribute to the National Housing Fund (their choice, §13.1 item 44); null when masked. */
    nhf_contributes: z.boolean().nullable(),
    /** The State they live in, where their PAYE goes (§13.1 item 46); null when not set or masked. */
    state_of_residence: NigerianState.nullable(),
    created_at: isoDateTime,
    /** Their photo at a profile's size (384 px, shared/db/person.js); null shows their initials. */
    photo_url: z.string().nullable(),
  })
  .strict();

/** PATCH /employees/:id. Every field of the record a person may correct. */
/** The work patterns that come to a worksite, so clock-in has an office to check. */
const ON_SITE_PATTERNS = ["on_site", "hybrid"];

/**
 * PATCH /employees/:id carries only what changed. Moving someone to On Site or Hybrid while
 * emptying their worksite in the same edit is refused here; a move that leaves the stored
 * worksite empty is refused by the service, which knows it (JBS Praxis, 25/10/2026).
 */
const EmployeeUpdateFields = z
  .object({
    first_name: text(100),
    middle_name: clearable(z.string().trim().max(100)),
    last_name: text(100),
    preferred_name: clearable(z.string().trim().max(100)),
    work_email: email,
    personal_email: clearable(email),
    phone,
    job_title: text(150),
    department_id: uuid,
    worksite_id: clearable(uuid),
    employment_type: EmploymentType,
    work_pattern: WorkPattern,
    start_date: isoDate,
    contract_ends_on: clearable(isoDate),
    confirmation_due_on: clearable(isoDate),
    confirmed_on: clearable(isoDate),
    left_on: clearable(isoDate),
    gender: clearable(Gender),
    date_of_birth: clearable(isoDate),
    next_of_kin_name: clearable(z.string().trim().max(150)),
    next_of_kin_phone: clearable(phone),
    next_of_kin_relationship: clearable(z.string().trim().max(50)),
    /** Picked or pinned, never typed (F27); left out, it stays as it is. No People form asks for it. */
    home_address: PlaceInput.optional(),
    bank_name: clearable(z.string().trim().max(100)),
    account_number: clearable(accountNumber),
    gross_monthly: clearable(pay),
    /** Tax and pension (`employee.statutory`), read by payroll in advanced mode (docs/guides/payroll.md §6.12). */
    tax_id: clearable(statutoryNumber),
    pension_pin: clearable(statutoryNumber),
    pension_administrator: clearable(z.string().trim().max(100)),
    nhf_number: clearable(statutoryNumber),
    nhf_contributes: z.boolean(),
    state_of_residence: clearable(NigerianState),
  })
  .partial()
  .strict();

/** Moving someone to On Site or Hybrid while emptying their worksite in the same change is refused. */
const keepsWorksite = (v, ctx) => {
  if (ON_SITE_PATTERNS.includes(v.work_pattern) && "worksite_id" in v && !v.worksite_id)
    ctx.addIssue({ code: "custom", path: ["worksite_id"], message: "Pick a worksite" });
};

const EmployeeUpdate = EmployeeUpdateFields.refine((v) => Object.keys(v).length > 0, { message: "change at least one field" })
  .superRefine(employeeDates)
  .superRefine(keepsWorksite);

/**
 * The work record, as Praxis AI's cards carry it (docs/guides/praxis-ai.md §6.11, decision 33;
 * JBS Praxis, 03/11/2026): names, work contact, job, department, line manager, worksite, the
 * arrangement and the dates of the engagement. Personal details (birth date, gender, next of kin,
 * home, personal email), bank and pay are never on a card: they stay on the record's own screen.
 */
const WORK_RECORD = Object.freeze([
  "first_name",
  "middle_name",
  "last_name",
  "preferred_name",
  "work_email",
  "phone",
  "job_title",
  "department_id",
  "worksite_id",
  "employment_type",
  "work_pattern",
  "start_date",
  "contract_ends_on",
  "confirmation_due_on",
  "confirmed_on",
]);

/**
 * Edit Record as a card (Save Record): the person (their id, or their name matched among the
 * people the reader may see) beside the work record's fields; only what changes.
 */
const EmployeeChange = EmployeeUpdateFields.pick(Object.fromEntries(WORK_RECORD.map((k) => [k, true])))
  .extend({ employee_id: recordId("employee") })
  .refine(changesBeside(["employee_id"]), nothingOn("employee_id"))
  .superRefine(employeeDates)
  .superRefine(keepsWorksite);

/**
 * POST /employees/:id/archive. `left_on` is their last day (today when not given), kept as
 * employee.left_on, which Attrition counts; not after today, nor before they started.
 */
const EmployeeArchive = z.object({ archive_reason: text(200), left_on: isoDate.optional() }).strict();

/**
 * PATCH /employees/:id/line-manager: a person or a vacant seat, and the
 * dotted line beside it. null clears one. The reason is kept on the audit row.
 */
const EmployeeReportingFields = z
  .object({
    line_manager_id: uuid.nullable(),
    line_manager_seat_id: uuid.nullable(),
    dotted_manager_id: uuid.nullable(),
    dotted_manager_seat_id: uuid.nullable(),
    reason: optionalText(200),
  })
  .partial()
  .strict();
const EmployeeReportingUpdate = EmployeeReportingFields.refine(
  (v) =>
    !(v.line_manager_id && v.line_manager_seat_id) &&
    !(v.dotted_manager_id && v.dotted_manager_seat_id),
  { message: "a person reports to a person or to a seat, never both" },
);

/**
 * Save Line as a card: the person beside who they report to, a person on each line (null clears
 * one), and the reason kept on the audit row. A vacant seat is picked on the Organogram, where the
 * structure is in view.
 */
const EmployeeReportingChange = EmployeeReportingFields.pick({ line_manager_id: true, dotted_manager_id: true, reason: true })
  .extend({ employee_id: recordId("employee") })
  .refine(changesBeside(["employee_id", "reason"]), nothingOn("employee_id"))
  .refine((v) => !v.line_manager_id || v.line_manager_id !== v.employee_id, { message: "Not themselves", path: ["line_manager_id"] })
  .refine((v) => !v.dotted_manager_id || v.dotted_manager_id !== v.employee_id, { message: "Not themselves", path: ["dotted_manager_id"] });

/**
 * Each field of an employee record as its screens name it (People's form, My Profile), for the
 * line that says what changed: "Record changed: Bank, Account Number", never a column's key.
 */
const EMPLOYEE_FIELD_LABELS = Object.freeze({
  staff_number: "Staff Number",
  status: "Status",
  first_name: "First Name",
  middle_name: "Middle Name",
  last_name: "Last Name",
  preferred_name: "Preferred Name",
  work_email: "Work Email",
  personal_email: "Personal Email",
  phone: "Phone",
  gender: "Gender",
  date_of_birth: "Date of Birth",
  birth_day: "Birthday",
  birth_month: "Birthday",
  home_address: "Home Address",
  job_title: "Job Title",
  department_id: "Department",
  worksite_id: "Worksite",
  line_manager_id: "Line Manager",
  line_manager_seat_id: "Line Manager",
  dotted_manager_id: "Dotted Line",
  dotted_manager_seat_id: "Dotted Line",
  employment_type: "Employment Type",
  work_pattern: "Work Pattern",
  start_date: "Start Date",
  contract_ends_on: "Contract Ends",
  confirmation_due_on: "Probation Ends",
  confirmed_on: "Confirmed On",
  left_on: "Left On",
  gross_monthly: "Gross Monthly",
  bank_name: "Bank",
  account_number: "Account Number",
  tax_id: "Tax ID",
  pension_pin: "Pension PIN",
  pension_administrator: "Pension Administrator",
  nhf_number: "NHF Number",
  nhf_contributes: "Contributes to NHF",
  state_of_residence: "State of Residence",
  next_of_kin_name: "Next of Kin",
  next_of_kin_phone: "Next of Kin Phone",
  next_of_kin_relationship: "Relationship",
});

/**
 * The fields a change touched, in its screens' words, each once: "Line Manager" for a person or a
 * seat alike. A key with no name here reads as words ("home_address_place_id" as "Home address
 * place"), so a column added later never reaches a screen as a key.
 * @param {string[]} keys
 * @returns {string[]}
 */
function employeeFieldNames(keys) {
  const words = (key) => {
    const said = String(key).replace(/_id$/, "").replace(/_/g, " ").trim();
    return said.charAt(0).toUpperCase() + said.slice(1);
  };
  return [...new Set((keys || []).filter(Boolean).map((k) => EMPLOYEE_FIELD_LABELS[k] || words(k)))];
}

/** GET /employees/:id/history: what has been done to this record. */
const EmployeeHistoryEntry = z
  .object({
    event_id: uuid,
    occurred_at: isoDateTime,
    action: z.string(),
    actor_name: z.string().nullable(),
    changed_fields: z.array(z.string()),
    summary: z.string(),
  })
  .strict();

const EmployeeHistoryPage = Paged(EmployeeHistoryEntry);

/* ------------------------------------------------------------------ *
 * Departments
 * ------------------------------------------------------------------ */

/**
 * A function's head: a person, or a vacant seat (the person above it acts). `head` names who
 * is set; `acting_head` is who acts while the seat is vacant (docs/guides/performance.md §6.20).
 *
 * People keep departments on People · Departments (docs/guides/organogram.md §6.1, JBS Praxis
 * 27/10/2026): one level, so `parent_department_id` is always null and no body takes it.
 * `open_roles` counts its vacant seats; `merged_into` names where a merged one went;
 * `can_delete` says nothing has ever named it, so Delete Department is offered.
 */
const Department = z
  .object({
    department_id: uuid,
    code: z.string(),
    name: z.string(),
    parent_department_id: uuid.nullable(),
    active: z.boolean(),
    headcount: z.number().int(),
    open_roles: z.number().int(),
    head_employee_id: uuid.nullable(),
    head_seat_id: uuid.nullable(),
    head: ManagerRef.nullable(),
    acting_head: PersonRef.nullable(),
    merged_into: z.object({ department_id: uuid, name: z.string() }).strict().nullable(),
    can_delete: z.boolean(),
  })
  .strict();

const DepartmentListQuery = listQuery({ active: z.enum(["true", "false"]).optional() }, [
  "name",
  "headcount",
  "created_at",
]);
const DepartmentPage = Paged(Department);

const ONE_HEAD = { message: "A person or a vacant seat, not both", path: ["head_seat_id"] };

/** 2 to 10 letters, stored upper case: the prefix of the function's goal and KPI codes (BM-O1). */
const departmentCode = z
  .string()
  .trim()
  .min(2, "At least 2 letters")
  .max(10, "At most 10 letters")
  .regex(/^[A-Za-z]+$/, "Letters only");

const DepartmentCreate = z
  .object({
    name: text(100),
    code: departmentCode.optional(),
    description: optionalText(300),
    head_employee_id: blank(uuid),
    head_seat_id: blank(uuid),
  })
  .strict()
  .refine((v) => !(v.head_employee_id && v.head_seat_id), ONE_HEAD);

const DepartmentUpdateFields = z
  .object({
    name: text(100),
    code: departmentCode,
    description: optionalText(300),
    active: z.boolean(),
    head_employee_id: uuid.nullable(),
    head_seat_id: uuid.nullable(),
  })
  .partial()
  .strict();
const DepartmentUpdate = DepartmentUpdateFields.refine((v) => Object.keys(v).length > 0, { message: "change at least one field" }).refine(
  (v) => !(v.head_employee_id && v.head_seat_id),
  ONE_HEAD,
);

/**
 * Save Department as a card: the department (its id, or its name) beside Edit Department's fields;
 * its head a person (null clears it), a vacant seat being picked on the screen. Retired (`active`
 * false) and restored as the screen's Retire and Restore do.
 */
const DepartmentChange = DepartmentUpdateFields.omit({ head_seat_id: true })
  .extend({ department_id: recordId("department") })
  .refine(changesBeside(["department_id"]), nothingOn("department_id"));

/**
 * Add People and Move To: the people to move into the department, at most a page a press.
 * Each one's line follows the head (docs/guides/organogram.md §6.1).
 */
const DepartmentPeopleMove = z
  .object({
    employee_ids: z.array(uuid).min(1, "Pick someone").max(25, "At most 25 people"),
  })
  .strict();

/** Merge Department: the department in use its people and open roles go into. */
const DepartmentMerge = z.object({ into_department_id: uuid }).strict();

/* ------------------------------------------------------------------ *
 * Vacant seats and the reporting tree
 * ------------------------------------------------------------------ */

const SEAT_STATUSES = ["vacant", "filled", "closed"];
const SeatStatus = z.enum(SEAT_STATUSES);

const OrgSeat = z
  .object({
    org_seat_id: uuid,
    title: z.string(),
    department_id: uuid,
    department: z.string(),
    status: SeatStatus,
    line_manager: ManagerRef.nullable(),
    filled_by_employee_id: uuid.nullable(),
    filled_on: isoDate.nullable(),
    reports: z.number().int(),
    created_at: isoDateTime,
  })
  .strict();

const OrgSeatListQuery = listQuery({ status: SeatStatus.optional(), department_id: uuid.optional() }, ["title", "created_at"]);
const OrgSeatPage = Paged(OrgSeat);

const OrgSeatCreate = z
  .object({
    title: text(150),
    department_id: uuid,
    line_manager_id: uuid.optional(),
    line_manager_seat_id: uuid.optional(),
  })
  .strict()
  .refine((v) => !(v.line_manager_id && v.line_manager_seat_id), {
    message: "a seat reports to a person or to a seat, never both",
  });

const OrgSeatUpdateFields = z
  .object({
    title: text(150),
    department_id: uuid,
    line_manager_id: uuid.nullable(),
    line_manager_seat_id: uuid.nullable(),
    status: z.enum(["vacant", "closed"]),
  })
  .partial()
  .strict();
const OrgSeatUpdate = OrgSeatUpdateFields.refine((v) => Object.keys(v).length > 0, { message: "change at least one field" }).refine(
  (v) => !(v.line_manager_id && v.line_manager_seat_id),
  { message: "a seat reports to a person or to a seat, never both" },
);

/**
 * Save Role as a card: the open role (its id, or its title matched among the open roles) beside
 * Edit Open Role's fields, reporting to a person (null clears it); closed with `status` closed.
 */
const OrgSeatChange = OrgSeatUpdateFields.omit({ line_manager_seat_id: true })
  .extend({ org_seat_id: recordId("role") })
  .refine(changesBeside(["org_seat_id"]), nothingOn("org_seat_id"));

/**
 * GET /org-chart. The whole company in one read: a node is a person or a
 * vacant seat, and `manager_node_id` is the solid line above it. Bounded, not
 * paged: a tree with a missing branch is wrong (docs/guides/foundation.md §6.6).
 */
const OrgChartQuery = z.object({ view: z.enum(["builder", "viewer"]).default("viewer") }).strict();

/**
 * A department a node heads, or acts for while its head role is open, and the words of the Head
 * mark its card carries: Head, Acting Head, and the department's code when it is not the card's
 * own (Acting Head · PG). docs/guides/organogram.md §6.
 */
const OrgNodeHead = z
  .object({
    department_id: uuid,
    name: z.string(),
    code: z.string(),
    acting: z.boolean(),
    mark: z.string(),
  })
  .strict();

const OrgNode = z
  .object({
    node_id: uuid,
    node_kind: z.enum(["employee", "seat"]),
    employee_id: uuid.nullable(),
    org_seat_id: uuid.nullable(),
    display_name: z.string(),
    job_title: z.string(),
    department: z.string(),
    manager_node_id: uuid.nullable(),
    dotted_manager_node_id: uuid.nullable(),
    dotted_line_to: z.string().nullable(),
    is_ceo: z.boolean(),
    vacant: z.boolean(),
    /** Builder only: the since and arrangement line. */
    meta: z.string().nullable(),
    /** The person's photo at the list size; null for a vacant seat or someone with none. */
    photo_url: z.string().nullable(),
    /** The departments it heads or acts for, its own first; empty for most cards. */
    heads: z.array(OrgNodeHead),
  })
  .strict();

const OrgChartTree = z
  .object({
    nodes: z.array(OrgNode),
    seats: z.number().int(),
    filled: z.number().int(),
    open: z.number().int(),
    roots: z.number().int(),
  })
  .strict();

/**
 * POST /org-chart/exports, Download PDF: the whole tree in the view asked for, drawn by the
 * pdf-render job and downloaded on the device that pressed; answered as documents ExportFile
 * (docs/guides/organogram.md §5 to §7).
 */
const OrgChartExportRequest = z.object({ view: z.enum(["builder", "viewer"]).default("viewer") }).strict();

/** A length on the PDF's page, in millimetres. */
const mm = z.number().min(0).max(100000);

/**
 * The variables of templates/documents/org-chart.html: the chart already laid out
 * (src/modules/organisation/org-chart.layout.js), so the template only places it.
 */
const OrgChartDocumentVars = z
  .object({
    page: z.object({ width: mm, height: mm }).strict(),
    chart: z.object({ width: mm, height: mm, scale: z.number().positive().max(1) }).strict(),
    card: z.object({ width: mm, height: mm }).strict(),
    cards: z.array(
      z
        .object({
          x: mm,
          y: mm,
          initials: z.string(),
          name: z.string(),
          title: z.string(),
          department: z.string(),
          meta: z.string().nullable(),
          dotted: z.string().nullable(),
          vacant: z.boolean(),
          ceo: z.boolean(),
          /** The Head marks, as the screen's card says them. */
          heads: z.array(z.object({ mark: z.string() }).strict()),
        })
        .strict(),
    ),
    lines: z.array(z.object({ x: mm, y: mm, w: mm, h: mm, across: z.boolean() }).strict()),
    seats: z.number().int(),
    filled: z.number().int(),
    open: z.number().int(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * The staff import row
 * ------------------------------------------------------------------ */

/**
 * One row of a staff sheet (src/modules/organisation/employee.import.js): the
 * same field rules as POST /employees with the sheet's own shapes, one Name
 * cell, a department and a line manager by name, and nothing only a screen can
 * pick. A row whose name is VACANT is a vacant seat, not a person.
 */
const EmployeeImportRow = z
  .object({
    staff_number: staffNumber.optional(),
    full_name: text(200),
    job_title: text(150),
    department: text(100),
    gender: Gender.optional(),
    start_date: isoDate.optional(),
    date_of_birth: isoDate.optional(),
    line_manager: optionalText(200),
    work_email: email.optional(),
    phone: phone.optional(),
    employment_type: EmploymentType.optional(),
    work_pattern: WorkPattern.optional(),
    bank_name: optionalText(100),
    /** Tax and pension, as People · Employees' Tax and Pension step takes them (`employee.statutory`). */
    tax_id: statutoryNumber.optional(),
    pension_pin: statutoryNumber.optional(),
    pension_administrator: optionalText(100),
    nhf_number: statutoryNumber.optional(),
    nhf_contributes: z.boolean().optional(),
    state_of_residence: NigerianState.optional(),
  })
  .strict();

/**
 * A new employee, however they arrive: the screen (EmployeeAdd, below), create-admin and the
 * demonstration data. References are ids, resolved on screen through pickers; one left empty
 * is not given.
 */
const EmployeeCreate = z
  .object({
    ...employeeCore,
    ...employeeRestricted,
    ...employeeStatutory,
    department_id: uuid,
    line_manager_id: blank(uuid),
    dotted_manager_id: blank(uuid),
    worksite_id: blank(uuid),
  })
  .strict()
  .superRefine(employeeDates);

/**
 * POST /api/v1/employees, Add Employee: EmployeeCreate, and someone who works On Site or Hybrid
 * names their worksite, so they can clock in on their first day (JBS Praxis, 25/10/2026). A
 * roster load and create-admin make people before any worksite exists, so they use
 * EmployeeCreate and the worksite is set later on People · Worksites.
 */
const EmployeeAdd = EmployeeCreate.superRefine((v, ctx) => {
  if (ON_SITE_PATTERNS.includes(v.work_pattern) && !v.worksite_id)
    ctx.addIssue({ code: "custom", path: ["worksite_id"], message: "Pick a worksite" });
});

/**
 * What a screen button may fill on Add Employee through the address (docs/guides/praxis-ai.md
 * §6.4): the names and the job, each optional and checked on its own. Nothing contact, personal
 * or pay: an address sits in the browser's history.
 */
const EmployeePrefill = z
  .object({
    first_name: text(100).optional(),
    middle_name: optionalText(100),
    last_name: text(100).optional(),
    job_title: text(150).optional(),
    department_id: uuid.optional(),
    start_date: isoDate.optional(),
    employment_type: EmploymentType.optional(),
    work_pattern: WorkPattern.optional(),
    contract_ends_on: isoDate.optional(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Rent relief: a person's declared rent for a tax year (docs/guides/payroll.md §6.12 rule 15, §13.1 item 41)
 * ------------------------------------------------------------------ */

/** A National Identification Number: eleven digits. */
const nin = z
  .string()
  .trim()
  .regex(/^\d{11}$/, "Eleven digits");

/** GET /employees/:id/rent-declarations: a person's declared rent, newest year first. */
const RentDeclarationParams = z.object({ id: uuid }).strict();

/** PUT and DELETE /employees/:id/rent-declarations/:year. */
const RentDeclarationYearParams = z.object({ id: uuid, year: taxYear }).strict();

/**
 * One person's declared rent for one tax year, as the Joint Revenue Board's Guidelines 2026 ask for it (paras 9.2 to 9.6):
 * the rent the person paid (their own share, in a shared tenancy) and the months it covers, the legal tenant, the landlord
 * with a mobile number, Tax ID or NIN, the property's address and the evidence of payment. `year_rent` is the rent
 * pro-rated to the year by months (para 9.5: two years' rent gives half to each), which payroll's rent relief reads.
 * Every field is masked as `employee.statutory`; `property_address_place` is the address as an edit form reads it.
 */
const RentDeclaration = z
  .object({
    employee_rent_declaration_id: uuid,
    employee_id: uuid,
    year: z.number().int(),
    rent_paid: money.nullable(),
    year_rent: money.nullable(),
    covers_from: isoDate,
    covers_to: isoDate,
    tenant_name: z.string().nullable(),
    landlord_name: z.string().nullable(),
    landlord_phone: z.string().nullable(),
    landlord_tax_id: z.string().nullable(),
    landlord_nin: z.string().nullable(),
    property_address: z.string().nullable(),
    property_address_place: PlaceView.nullable(),
    evidence_document_id: uuid.nullable(),
    entered_by_name: z.string().nullable(),
    updated_at: isoDateTime,
  })
  .strict();
const RentDeclarationPage = Paged(RentDeclaration);

/**
 * PUT /employees/:id/rent-declarations/:year (`people` edit, a role that sees `employee.statutory`): the year's
 * declaration, made or replaced. The months covered run from one month's first day to another's and include at least one
 * month of the year (422 COVERS_OUTSIDE_YEAR); the year is this one or the next in Lagos (422 YEAR_NOT_ALLOWED). The
 * address is picked (F27); the evidence is a file staged through POST /documents and claimed by the save.
 */
const RentDeclarationSave = z
  .object({
    rent_paid: positiveMoney,
    covers_from: monthStart("Pick a month"),
    covers_to: monthStart("Pick a month"),
    tenant_name: text(200),
    landlord_name: text(200),
    landlord_phone: blank(phone),
    landlord_tax_id: blank(statutoryNumber),
    landlord_nin: blank(nin),
    property_address: PlaceInput,
    evidence_document_id: uuid,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.covers_from && v.covers_to && v.covers_to < v.covers_from)
      ctx.addIssue({ code: "custom", path: ["covers_to"], message: "Not before From" });
    if (!v.landlord_phone && !v.landlord_tax_id && !v.landlord_nin)
      ctx.addIssue({ code: "custom", path: ["landlord_phone"], message: "Give one landlord ID" });
  });

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
      .strict()
      .superRefine(employeeDates),
    role_code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,49}$/, "must be a role code"),
    is_ceo: z.boolean().default(false),
  })
  .strict();

/**
 * Which table each schema's keys are the columns of (gate 6, check/contract-columns.js).
 * department_name is the one key that is not a column: create-admin finds or creates the
 * department by that name and stores its department_id.
 */
/**
 * The assistant's seat summary (docs/guides/praxis-ai.md §6.13, People, performance and queries): the
 * structure's roles by department or status, open and filled, and the departments whose head role is
 * open. Figures, never a row.
 */
const SeatSummaryBy = z.enum(["department", "status"]);
const SeatSummaryQuery = z
  .object({
    department_id: uuid.optional(),
    by: SeatSummaryBy.default("department"),
  })
  .strict();

const TABLES = {
  EmployeeCreate: { table: "employee" },
  EmployeeAdd: { table: "employee" },
  EmployeePrefill: { table: "employee" },
  EmployeeUpdate: { table: "employee" },
  EmployeeChange: { table: "employee" },
  EmployeeArchive: { table: "employee" },
  EmployeeReportingUpdate: {
    table: "employee",
    virtual: { reason: "why the line changed: kept on the audit row, not on the record" },
  },
  EmployeeReportingChange: {
    table: "employee",
    virtual: { reason: "why the line changed: kept on the audit row, not on the record" },
  },
  EmployeeSummaryQuery: { table: null, reason: "the filters and grouping of the assistant's headcount summary; figures, never a row" },
  EmployeeListQuery: {
    table: null,
    reason: "list controls and the register's filters, not a row",
  },
  EmployeeRow: {
    table: "employee",
    virtual: {
      display_name: "the person's name as a list shows it, from first_name and last_name",
      department: "the department's name, joined from department",
      line_manager: "the manager above them: a person or a vacant seat, from line_manager_id or line_manager_seat_id",
      login: "whether they have a login and its state, from app_user",
      photo_url: "the list size of photo_document_id, as an API path (shared/db/person.js)",
    },
  },
  EmployeePage: { table: null, reason: "a page of the register" },
  EmployeesSummary: {
    table: null,
    reason: "the counts and the decisions above the register, each one computed",
  },
  EmployeeLogin: {
    table: null,
    reason: "the login block of the 360: app_user and its roles, which identity owns",
  },
  Employee360: {
    table: "employee",
    virtual: {
      display_name: "the person's name as the record shows it, from first_name and last_name",
      department: "the department's name, joined from department",
      line_manager: "the manager above them: a person or a vacant seat",
      dotted_manager: "the second manager for matrix work: a person or a vacant seat",
      direct_reports: "how many people report to them, counted",
      login: "their login and roles, from app_user and user_role",
      photo_url: "the profile size of photo_document_id, as an API path (shared/db/person.js)",
      is_ceo: "whether this is the CEO's own record (a login holding the ceo role), which cannot be archived",
    },
  },
  RentDeclaration: {
    table: "employee_rent_declaration",
    virtual: {
      year_rent: "the rent pro-rated to the year by the months it covers (organisation.rent.js)",
      property_address_place: "the address as a place, from place (owner employee_rent_declaration.property_address)",
      entered_by_name: "who entered it, from app_user and employee",
    },
  },
  RentDeclarationPage: { table: null, reason: "a page of a person's declared rent" },
  RentDeclarationParams: { table: null, reason: "the person's :id path parameter" },
  RentDeclarationYearParams: { table: null, reason: "the person's :id and the :year path parameters" },
  RentDeclarationSave: { table: "employee_rent_declaration" },
  EmployeeHistoryEntry: {
    table: "audit_ledger",
    virtual: { summary: "the line the History tab reads, written from action and changed_fields" },
  },
  EmployeeHistoryPage: { table: null, reason: "a page of one record's history" },
  Department: {
    table: "department",
    virtual: {
      headcount: "how many active people are in it, counted",
      open_roles: "how many of its seats are vacant, counted",
      head: "the person in department.head_employee_id, or the seat in department.head_seat_id",
      acting_head: "organisation.headOf(): the head, or the person above a vacant head seat",
      merged_into: "the department in department.merged_into_department_id, with its name",
      can_delete: "no row anywhere names the department, worked out from its references",
    },
  },
  DepartmentListQuery: { table: null, reason: "list controls and the active filter, not a row" },
  DepartmentPage: { table: null, reason: "a page of departments" },
  DepartmentCreate: {
    table: "department",
    virtual: {},
  },
  DepartmentUpdate: { table: "department" },
  DepartmentChange: { table: "department" },
  DepartmentPeopleMove: { table: null, reason: "the people a move names: each one's employee.department_id changes" },
  DepartmentMerge: {
    table: "department",
    virtual: { into_department_id: "kept as department.merged_into_department_id once merged" },
  },
  PersonRef: {
    table: null,
    reason: "a person as a list or a card names them, from employee, with the list size of photo_document_id as photo_url",
    virtual: {},
  },
  ManagerRef: {
    table: null,
    reason: "who someone reports to: an employee or an org_seat, never both",
  },
  OrgSeat: {
    table: "org_seat",
    virtual: {
      department: "the department's name, joined from department",
      line_manager: "the manager above the seat: a person or another seat",
      reports: "how many people hang from the seat, counted",
    },
  },
  OrgSeatListQuery: { table: null, reason: "list controls and the status filter, not a row" },
  SeatSummaryQuery: { table: null, reason: "the filter and grouping of the assistant's seat summary; figures, never a row" },
  OrgSeatPage: { table: null, reason: "a page of seats" },
  OrgSeatCreate: { table: "org_seat" },
  OrgSeatUpdate: { table: "org_seat" },
  OrgSeatChange: { table: "org_seat" },
  OrgChartQuery: { table: null, reason: "which view of the tree is asked for" },
  OrgNode: {
    table: null,
    reason: "one node of the reporting tree: an employee or a vacant seat, flattened for the chart, with the employee's photo_url and the departments it heads",
  },
  OrgChartTree: { table: null, reason: "the whole bounded tree and its counts" },
  OrgChartExportRequest: { table: null, reason: "which view of the tree Download PDF draws" },
  OrgChartDocumentVars: { table: null, reason: "the variables of templates/documents/org-chart.html, the chart laid out" },
  EmployeeImportRow: {
    table: "employee",
    virtual: {
      full_name: "one Name cell in the sheet, split into first_name, middle_name and last_name",
      department: "named, not picked: resolved to department_id, created on confirmation",
      line_manager: "named or titled in the sheet: resolved to line_manager_id, or to line_manager_seat_id when the post above is vacant",
    },
  },
  AdminBootstrap: {
    table: null,
    reason: "script input to create-admin: one employee, a role code and the CEO flag",
    nested: {
      employee: {
        table: "employee",
        virtual: {
          department_name: "named, not picked: create-admin finds or creates the department and stores its department_id",
        },
      },
    },
  },
};

module.exports = {
  TABLES,
  EMPLOYMENT_TYPES,
  WORK_PATTERNS,
  GENDERS,
  EMPLOYEE_STATUSES,
  LOGIN_STATES,
  SEAT_STATUSES,
  EmploymentType,
  NigerianState,
  NIGERIAN_STATES,
  STATE_LABELS,
  WorkPattern,
  Gender,
  EmployeeStatus,
  LoginState,
  SeatStatus,
  Tone,
  PersonRef,
  ManagerRef,
  EmployeeCreate,
  EmployeeAdd,
  ON_SITE_PATTERNS,
  employeeDateProblems,
  EmployeePrefill,
  EmployeeUpdate,
  WORK_RECORD,
  EmployeeChange,
  EmployeeArchive,
  EmployeeReportingUpdate,
  EmployeeReportingChange,
  EmployeeListQuery,
  EmployeeSummaryQuery,
  EmployeeRow,
  EmployeePage,
  EmployeesSummary,
  EmployeeLogin,
  Employee360,
  EMPLOYEE_FIELD_LABELS,
  employeeFieldNames,
  EmployeeHistoryEntry,
  EmployeeHistoryPage,
  Department,
  DepartmentListQuery,
  DepartmentPage,
  DepartmentCreate,
  DepartmentUpdate,
  DepartmentChange,
  DepartmentPeopleMove,
  DepartmentMerge,
  OrgSeat,
  OrgSeatListQuery,
  SeatSummaryBy,
  SeatSummaryQuery,
  OrgSeatPage,
  OrgSeatCreate,
  OrgSeatUpdate,
  OrgSeatChange,
  OrgChartQuery,
  OrgNode,
  OrgChartTree,
  OrgChartExportRequest,
  OrgChartDocumentVars,
  EmployeeImportRow,
  RentDeclaration,
  RentDeclarationPage,
  RentDeclarationParams,
  RentDeclarationYearParams,
  RentDeclarationSave,
  AdminBootstrap,
};
