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
  blank,
  listQuery,
  Paged,
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

/** A Nigerian bank account: ten digits (NUBAN). */
const accountNumber = z
  .string()
  .trim()
  .regex(/^\d{10}$/, "must be a 10-digit NUBAN");

/** The fields every employee has, whoever creates them and however. */
const employeeCore = {
  staff_number: staffNumber.optional(),
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
  /** Masked as personal details (field-mask.js employee.personal), as is personal_email. */
  home_address: optionalText(300),
  personal_email: blank(email),
  bank_name: optionalText(100),
  account_number: blank(accountNumber),
  gross_monthly: blank(money),
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
const LOGIN_STATES = ["none", "invited", "active", "suspended"];
const LoginState = z.enum(LOGIN_STATES);

/** A person, as a list or a card names them. */
const PersonRef = z
  .object({
    employee_id: uuid,
    display_name: z.string(),
    job_title: z.string().nullable(),
    department: z.string().nullable(),
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
  },
  ["display_name", "staff_number", "job_title", "department", "start_date", "created_at"],
);

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
    created_at: isoDateTime,
  })
  .strict();

/** PATCH /employees/:id. Every field of the record a person may correct. */
const EmployeeUpdate = z
  .object({
    first_name: text(100),
    middle_name: optionalText(100),
    last_name: text(100),
    preferred_name: optionalText(100),
    work_email: email,
    personal_email: blank(email),
    phone,
    job_title: text(150),
    department_id: uuid,
    worksite_id: uuid,
    employment_type: EmploymentType,
    work_pattern: WorkPattern,
    start_date: isoDate,
    contract_ends_on: blank(isoDate),
    confirmation_due_on: blank(isoDate),
    confirmed_on: blank(isoDate),
    left_on: blank(isoDate),
    gender: blank(Gender),
    date_of_birth: blank(isoDate),
    next_of_kin_name: optionalText(150),
    next_of_kin_phone: blank(phone),
    next_of_kin_relationship: optionalText(50),
    home_address: optionalText(300),
    bank_name: optionalText(100),
    account_number: blank(accountNumber),
    gross_monthly: blank(money),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "change at least one field" });

/** POST /employees/:id/archive. */
const EmployeeArchive = z.object({ archive_reason: text(200) }).strict();

/**
 * PATCH /employees/:id/line-manager: a person or a vacant seat, and the
 * dotted line beside it. null clears one. The reason is kept on the audit row.
 */
const EmployeeReportingUpdate = z
  .object({
    line_manager_id: uuid.nullable(),
    line_manager_seat_id: uuid.nullable(),
    dotted_manager_id: uuid.nullable(),
    dotted_manager_seat_id: uuid.nullable(),
    reason: optionalText(200),
  })
  .partial()
  .strict()
  .refine(
    (v) =>
      !(v.line_manager_id && v.line_manager_seat_id) &&
      !(v.dotted_manager_id && v.dotted_manager_seat_id),
    { message: "a person reports to a person or to a seat, never both" },
  );

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

const Department = z
  .object({
    department_id: uuid,
    code: z.string(),
    name: z.string(),
    parent_department_id: uuid.nullable(),
    active: z.boolean(),
    headcount: z.number().int(),
  })
  .strict();

const DepartmentListQuery = listQuery({ active: z.enum(["true", "false"]).optional() }, [
  "name",
  "created_at",
]);
const DepartmentPage = Paged(Department);

const DepartmentCreate = z
  .object({
    name: text(100),
    parent_department_id: uuid.optional(),
    description: optionalText(300),
  })
  .strict();

const DepartmentUpdate = z
  .object({
    name: text(100),
    parent_department_id: uuid.nullable(),
    description: optionalText(300),
    active: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "change at least one field" });

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

const OrgSeatListQuery = listQuery({ status: SeatStatus.optional() }, ["title", "created_at"]);
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

const OrgSeatUpdate = z
  .object({
    title: text(150),
    department_id: uuid,
    line_manager_id: uuid.nullable(),
    line_manager_seat_id: uuid.nullable(),
    status: z.enum(["vacant", "closed"]),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "change at least one field" })
  .refine((v) => !(v.line_manager_id && v.line_manager_seat_id), {
    message: "a seat reports to a person or to a seat, never both",
  });

/**
 * GET /org-chart. The whole company in one read: a node is a person or a
 * vacant seat, and `manager_node_id` is the solid line above it. Bounded, not
 * paged: a tree with a missing branch is wrong (docs/guides/foundation.md §6.6).
 */
const OrgChartQuery = z.object({ view: z.enum(["builder", "viewer"]).default("viewer") }).strict();

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
  })
  .strict();

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

/**
 * Which table each schema's keys are the columns of (gate 6, check/contract-columns.js).
 * department_name is the one key that is not a column: create-admin finds or creates the
 * department by that name and stores its department_id.
 */
const TABLES = {
  EmployeeCreate: { table: "employee" },
  EmployeeUpdate: { table: "employee" },
  EmployeeArchive: { table: "employee" },
  EmployeeReportingUpdate: {
    table: "employee",
    virtual: { reason: "why the line changed: kept on the audit row, not on the record" },
  },
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
    },
  },
  EmployeeHistoryEntry: {
    table: "audit_ledger",
    virtual: { summary: "the line the History tab reads, written from action and changed_fields" },
  },
  EmployeeHistoryPage: { table: null, reason: "a page of one record's history" },
  Department: {
    table: "department",
    virtual: { headcount: "how many active people are in it, counted" },
  },
  DepartmentListQuery: { table: null, reason: "list controls and the active filter, not a row" },
  DepartmentPage: { table: null, reason: "a page of departments" },
  DepartmentCreate: {
    table: "department",
    virtual: {},
  },
  DepartmentUpdate: { table: "department" },
  PersonRef: {
    table: null,
    reason: "a person as a list or a card names them, from employee",
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
  OrgSeatPage: { table: null, reason: "a page of seats" },
  OrgSeatCreate: { table: "org_seat" },
  OrgSeatUpdate: { table: "org_seat" },
  OrgChartQuery: { table: null, reason: "which view of the tree is asked for" },
  OrgNode: {
    table: null,
    reason: "one node of the reporting tree: an employee or a vacant seat, flattened for the chart",
  },
  OrgChartTree: { table: null, reason: "the whole bounded tree and its counts" },
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
  WorkPattern,
  Gender,
  EmployeeStatus,
  LoginState,
  SeatStatus,
  Tone,
  PersonRef,
  ManagerRef,
  EmployeeCreate,
  EmployeeUpdate,
  EmployeeArchive,
  EmployeeReportingUpdate,
  EmployeeListQuery,
  EmployeeRow,
  EmployeePage,
  EmployeesSummary,
  EmployeeLogin,
  Employee360,
  EmployeeHistoryEntry,
  EmployeeHistoryPage,
  Department,
  DepartmentListQuery,
  DepartmentPage,
  DepartmentCreate,
  DepartmentUpdate,
  OrgSeat,
  OrgSeatListQuery,
  OrgSeatPage,
  OrgSeatCreate,
  OrgSeatUpdate,
  OrgChartQuery,
  OrgNode,
  OrgChartTree,
  EmployeeImportRow,
  AdminBootstrap,
};
