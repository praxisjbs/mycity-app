"use strict";
/**
 * Salary structure and pay components (docs/guides/payroll.md §4.2, §5, §6.11 rules 5 and 6, Appendix C). Advanced
 * mode only: their routes answer 409 ADVANCED_OFF until the option is on or has been (`advanced_has_been_on`,
 * payroll.js), and nothing here is seeded.
 *
 *   a grade      a band, minimum to maximum, from a date; a new version of its code from a later date. Salaries stay
 *                negotiated: a grade sets no one's pay, and a person outside their band is flagged, never blocked
 *   a placement  the grade a person is in, from a date; read against the grade's band in force that day
 *   a split      a person's monthly gross split into basic, housing, transport and any other component, each
 *                pensionable or not, from a date. In advanced mode it makes the payslip's earning lines and the
 *                pensionable and basic bases of the statutory items; a person with none is warned No Pay Split
 *
 * Amounts that tell a person's pay or a band's carry the names the salary mask governs (shared/rbac/field-mask,
 * `employee.salary`): a component's amount is `pay_amount`, a person's gross `gross_pay`, a band's limits
 * `band_minimum` and `band_maximum`, and where a person stands against their band `band_position`. Each is nullable:
 * a reader without the salary grant gets null and the screen shows Restricted. A request that takes money in names
 * it as the column does (`minimum`, `maximum`, `amount`). Messages on a field are four words or fewer.
 */
const { z } = require("zod");
const { uuid, text, isoDate, isoDateTime, money, positiveMoney, listQuery, Paged } = require("./common");
const { PersonRef } = require("./organisation");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** Where a person's monthly gross stands against their grade's band. */
const BandPosition = z.enum(["below", "within", "above"]);

/** A grade's code as people type it: letters and digits, kept upper case ("G4", "M1"). */
const gradeCode = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, "Enter a code")
  .max(20, "At most 20 characters")
  .regex(/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/, "Letters and digits");

/** A component's code: lower case words joined by underscores (`basic`, `housing`, `transport`, `meal`). */
const componentCode = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter a code")
  .max(40, "At most 40 characters")
  .regex(/^[a-z][a-z0-9_]*$/, "Letters and underscores");

const cents = (v) => BigInt(v.replace(".", ""));

/* ------------------------------------------------------------------ *
 * Grades
 * ------------------------------------------------------------------ */

/**
 * One version of a grade with how many people are placed in it today and how many of them are below its minimum or
 * above its maximum.
 */
const SalaryGrade = z
  .object({
    salary_grade_id: uuid,
    code: z.string(),
    name: z.string(),
    band_minimum: money.nullable(),
    band_maximum: money.nullable(),
    effective_from: isoDate,
    effective_to: isoDate.nullable(),
    staff: z.number().int().min(0),
    below_minimum: z.number().int().min(0),
    above_maximum: z.number().int().min(0),
    created_at: isoDateTime,
  })
  .strict();

/**
 * GET /salary-structure/grades. With `as_of`, the versions in force that day; without it, those in force today and
 * those starting later. Lowest band first unless sorted.
 */
const SalaryGradeListQuery = listQuery({ as_of: isoDate.optional() }, ["minimum", "code", "name"]);
const SalaryGradePage = Paged(SalaryGrade);

/**
 * POST /salary-structure/grades: a grade, or a new version of one, from `effective_from` (today or later, Lagos). The
 * version of the same code before it ends the day before; one already starting that day is replaced.
 */
const SalaryGradeSave = z
  .object({
    code: gradeCode,
    name: text(100),
    minimum: positiveMoney,
    maximum: positiveMoney,
    effective_from: isoDate,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (/^\d+\.\d{2}$/.test(v.minimum) && /^\d+\.\d{2}$/.test(v.maximum) && cents(v.maximum) < cents(v.minimum))
      ctx.addIssue({ code: "custom", path: ["maximum"], message: "Not below the minimum" });
  });

/* ------------------------------------------------------------------ *
 * Placements
 * ------------------------------------------------------------------ */

/**
 * A person against their band today: the grade they are placed in (none: not placed), their monthly gross and where
 * it stands. `band_position` is null for a person not placed or with no salary set.
 */
const GradePlacement = z
  .object({
    employee: PersonRef,
    gross_pay: money.nullable(),
    salary_grade_id: uuid.nullable(),
    grade_code: z.string().nullable(),
    grade_name: z.string().nullable(),
    band_position: BandPosition.nullable(),
    effective_from: isoDate.nullable(),
    has_pay_split: z.boolean(),
  })
  .strict();

/**
 * GET /salary-structure/placements: everyone paid now (active or suspended), placed or not. `band_position` filters
 * to those below, within or above their band; `unplaced` to those in no grade.
 */
const GradePlacementListQuery = listQuery(
  {
    salary_grade_id: uuid.optional(),
    band_position: z.enum(["below", "within", "above", "unplaced"]).optional(),
  },
  ["employee", "grade"],
);
const GradePlacementPage = Paged(GradePlacement);

/** The person a placement or a split is about: PUT /salary-structure/placements/:employee_id and the components' path. */
const SalaryStructureParams = z.object({ employee_id: uuid }).strict();

/** PUT /salary-structure/placements/:employee_id: place the person in a grade from a date (today or later). */
const GradePlacementSave = z
  .object({
    salary_grade_id: z.string().uuid("Pick a grade"),
    effective_from: isoDate,
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Pay components
 * ------------------------------------------------------------------ */

/** One component of a person's split, in force from `effective_from`. */
const PayComponent = z
  .object({
    code: z.string(),
    label: z.string(),
    pay_amount: money.nullable(),
    pensionable: z.boolean(),
    effective_from: isoDate,
    effective_to: isoDate.nullable(),
  })
  .strict();

/** One version of a person's split: its components, which sum to their monthly gross when it was saved. */
const PayComponentVersion = z
  .object({
    effective_from: isoDate,
    effective_to: isoDate.nullable(),
    components: z.array(PayComponent),
  })
  .strict();

/**
 * GET and PUT /salary-structure/employees/:employee_id/components: the person, their monthly gross, the split in force
 * today and the one that starts later, each null when there is none.
 */
const PayComponentSet = z
  .object({
    employee: PersonRef,
    gross_pay: money.nullable(),
    current: PayComponentVersion.nullable(),
    next: PayComponentVersion.nullable(),
  })
  .strict();

/** One component as it is entered. */
const PayComponentInput = z
  .object({
    code: componentCode,
    label: text(60),
    amount: positiveMoney,
    pensionable: z.boolean(),
  })
  .strict();

/**
 * PUT /salary-structure/employees/:employee_id/components: a new split from `effective_from` (today or later). One
 * `basic`, every code once, at most ten; the amounts must add up to the person's monthly gross (422 SPLIT_NOT_GROSS,
 * checked by the service, which knows it).
 */
const PayComponentsSave = z
  .object({
    effective_from: isoDate,
    components: z.array(PayComponentInput).min(1, "Add a component").max(10, "At most 10"),
  })
  .strict()
  .superRefine((v, ctx) => {
    const seen = new Set();
    v.components.forEach((p, i) => {
      if (seen.has(p.code)) ctx.addIssue({ code: "custom", path: ["components", i, "code"], message: "Used twice" });
      seen.add(p.code);
    });
    if (!seen.has("basic")) ctx.addIssue({ code: "custom", path: ["components"], message: "Add a basic component" });
  });

/* ------------------------------------------------------------------ *
 * Gate 6 (check/contract-columns.js): which table each schema is a row of
 * ------------------------------------------------------------------ */

const TABLES = {
  SalaryGrade: {
    table: "salary_grade",
    virtual: {
      band_minimum: "salary_grade.minimum, named for the salary mask",
      band_maximum: "salary_grade.maximum, named for the salary mask",
      staff: "how many people are placed in it today, from employee_salary_grade",
      below_minimum: "how many of them earn less than its minimum",
      above_maximum: "how many of them earn more than its maximum",
    },
  },
  SalaryGradeListQuery: { table: null, reason: "list controls for the grades" },
  SalaryGradePage: { table: null, reason: "a page of grades" },
  SalaryGradeSave: { table: "salary_grade" },
  GradePlacement: {
    table: "employee_salary_grade",
    virtual: {
      employee: "the person, from employee and department",
      gross_pay: "employee.gross_monthly, named for the salary mask",
      grade_code: "the grade's code, from salary_grade",
      grade_name: "the grade's name, from salary_grade",
      band_position: "where the person's gross stands against the band in force, worked out on read",
      has_pay_split: "whether a pay split is in force today, from employee_pay_component",
    },
  },
  GradePlacementListQuery: { table: null, reason: "list controls for the placements" },
  GradePlacementPage: { table: null, reason: "a page of people against their bands" },
  SalaryStructureParams: { table: null, reason: "the :employee_id path parameter" },
  GradePlacementSave: { table: "employee_salary_grade" },
  PayComponent: {
    table: "employee_pay_component",
    virtual: { pay_amount: "employee_pay_component.amount, named for the salary mask" },
  },
  PayComponentVersion: {
    table: "employee_pay_component",
    virtual: { components: "the version's employee_pay_component rows" },
  },
  PayComponentSet: {
    table: null,
    reason: "a person, their gross and the versions of their split",
  },
  PayComponentInput: { table: "employee_pay_component" },
  PayComponentsSave: {
    table: "employee_pay_component",
    virtual: { components: "written one employee_pay_component row each" },
  },
};

module.exports = {
  TABLES,
  BandPosition,
  SalaryGrade,
  SalaryGradeListQuery,
  SalaryGradePage,
  SalaryGradeSave,
  GradePlacement,
  GradePlacementListQuery,
  GradePlacementPage,
  SalaryStructureParams,
  GradePlacementSave,
  PayComponent,
  PayComponentVersion,
  PayComponentSet,
  PayComponentInput,
  PayComponentsSave,
};
