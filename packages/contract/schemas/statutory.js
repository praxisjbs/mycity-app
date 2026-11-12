"use strict";
/**
 * Statutory rates and the statutory report (docs/guides/payroll.md §4.2, §5, §6.11, §6.12, §6.16, Appendix C). Built
 * and shipped off: nothing here is computed until someone with `payroll.configure` switches the advanced option on
 * from a date, and no rate, band or figure is in any seed. Operations & People enter every one on Configurations with
 * its legal source when MyCity starts statutory payroll (§13.1 item 38); the figures can be entered before the option
 * is first switched on (§13.1 item 25).
 *
 * What is code and what is data (§6.12 rule 7). Code: the set of items below, which side of the payslip each falls on
 * (`ITEM_KIND`), the bases each may use and the shape of the formula, each traced to a row of §6.16. Data, entered as a
 * new version from a date: every rate, every PAYE band's limits and rate, rent relief's percentage and cap, the minimum
 * wage, and each item's base among the ones its formula allows (`ITEM_BASES`, the first being §6.12's).
 *
 *   paye              employee   taxable         a year's bands: from, to (none on the last), rate (NTA s.58, Fourth Schedule)
 *   pension_employee  employee   pensionable     one rate (Pension Reform Act 2014, s.4(1)(b))
 *   pension_employer  employer   pensionable     one rate (s.4(1)(a))
 *   nhf               employee   gross           one rate, for a person who chose to contribute (NHF Act s.4(1)(b))
 *   itf               employer   annual_payroll  one rate, entered only while MyCity is liable (ITF Act s.6(1))
 *   nsitf             employer   annual_payroll  one rate (Employee's Compensation Act 2010, s.33(1))
 *   rent_relief       employee   rent            a rate of the year's rent and its cap (NTA s.30(2)(a)(vi))
 *   minimum_wage      employee   gross           a month's amount: PAYE's exemption and NHF's floor (NTA s.58, s.163(1)(t))
 *
 * The `relief` item PR 5 built (a flat amount plus a percentage of gross, the Consolidated Relief Allowance's shape) has
 * no legal source from 1 January 2026 and is retired (§13.1 item 41): it is not in `StatutoryItem`, so a save naming it
 * is refused, and its rows saved before stay in the table, never shown or computed (`RETIRED_ITEMS`).
 *
 * A rate is a percentage as a string with up to six places (`numeric(9,6)`): "7.5" is 7.5%. Money is a two-place string.
 * PAYE's bands are a year's, entered exactly as the Fourth Schedule publishes them; each month's PAYE is worked out
 * cumulatively over the year to date with the bands scaled to the months elapsed (§6.12 rule 11, §13.1 item 39). Messages
 * on a field are four words or fewer.
 *
 * Every version carries its legal source (guide §4.2, §6.12 rule 12, §13.1 item 31): the instrument's title and the
 * section, optionally a link and the instrument itself in the vault (a file staged through POST /documents), and the day
 * it was checked; or No Legal Source with the reason ("a company rule, not a law"). Never both, never neither: a save
 * without one is refused on the missing field with the code SOURCE_REQUIRED (the issue's `params.code`, which
 * shared/http/validate answers with), so the form says it as it is filled. Every row of a version carries the same source.
 *
 * A person's taxable pay and tax for a year before MyCity's first statutory month (a previous employer's leaving
 * certificate, or MyCity's own months before the option was on) are their Pay to Date, entered on Configurations in the
 * person's sheet (§13.1 item 42); the amounts carry names the salary mask governs (`taxable_pay`, `tax_paid`).
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, optionalText, listQuery, Paged, taxYear } = require("./common");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

const StatutoryItem = z.enum(["paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf", "rent_relief", "minimum_wage"]);

/** Items no longer saved, shown or computed; their rows saved before stay in the table (§13.1 item 41). */
const RETIRED_ITEMS = Object.freeze(["relief"]);

/** Who bears an item: the person (a deduction on the payslip) or MyCity (an employer charge, on the report only). */
const StatutoryKind = z.enum(["employee", "employer"]);

/**
 * What an item's figure is applied to (§6.12 rule 8). `basic` is no item's base any more (the NHF Act's "basic monthly
 * salary" is its wording before 2023, and pension's base is never less than basic, housing and transport); it stays in
 * the list because versions saved before PR 11 carry it. `rent` is the rent a person paid for the year.
 */
const StatutoryBase = z.enum(["gross", "pensionable", "basic", "taxable", "annual_payroll", "rent"]);

/** Which side each item falls on: code, never data (§6.12 rule 7). */
const ITEM_KIND = Object.freeze({
  paye: "employee",
  pension_employee: "employee",
  nhf: "employee",
  rent_relief: "employee",
  minimum_wage: "employee",
  pension_employer: "employer",
  itf: "employer",
  nsitf: "employer",
});

/**
 * The bases each item's formula may use, as §6.16 cites them; the first is the one a save takes when it names none.
 * Pension: the pensionable components, never less than basic, housing and transport, or the whole of the month's gross
 * (Pension Reform Act 2014, s.120). NHF: the month's gross pay (the 2023 s.4's "monthly income", as FMBN states it).
 * ITF and NSITF: the month's payroll, the person's gross. Rent relief: the year's rent. The minimum wage: compared with
 * the person's monthly gross.
 */
const ITEM_BASES = Object.freeze({
  paye: ["taxable"],
  pension_employee: ["pensionable", "gross"],
  pension_employer: ["pensionable", "gross"],
  nhf: ["gross"],
  itf: ["annual_payroll"],
  nsitf: ["annual_payroll"],
  rent_relief: ["rent"],
  minimum_wage: ["gross"],
});

/** The items whose version carries an amount (`flat_amount`): rent relief's cap and the minimum wage. */
const AMOUNT_ITEMS = Object.freeze(["rent_relief", "minimum_wage"]);

/** A percentage, 0 to 100, with up to six places: "7.5" is 7.5%. */
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "Enter a rate")
  .refine((v) => !/^\d{1,3}(\.\d{1,6})?$/.test(v) || Number(v) <= 100, "At most 100");

/** An amount that is zero or more: a band's limits, rent relief's cap, the minimum wage, a person's pay to date. */
const amountOrNothing = z.string().regex(/^\d{1,16}\.\d{2}$/, "Enter an amount");

/* ------------------------------------------------------------------ *
 * A version's legal source
 * ------------------------------------------------------------------ */

/** The code a missing source is refused with, carried on the issue so the API answers with it (shared/http/validate). */
const SOURCE_REQUIRED = "SOURCE_REQUIRED";

/** The columns of a source; No Legal Source is `no_legal_source` and `no_source_reason` instead. */
const SOURCE_KEYS = Object.freeze(["source_title", "source_section", "source_url", "source_document_id", "source_checked_on"]);

/** A link a person can open where the instrument is published: http or https only. */
function isLink(v) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** A version's source as it is read back: every column, null where it does not apply. */
const SOURCE_SHAPE = {
  source_title: z.string().nullable(),
  source_section: z.string().nullable(),
  source_url: z.string().nullable(),
  source_document_id: uuid.nullable(),
  source_checked_on: isoDate.nullable(),
  no_legal_source: z.boolean(),
  no_source_reason: z.string().nullable(),
};

/** One version's source, as the screens and the report read it. */
const StatutorySource = z.object(SOURCE_SHAPE).strict();

/**
 * The source a save names: the instrument (its title, section and the day checked; a link and a document if there are
 * any), or No Legal Source with a reason of 10 to 500 characters. An empty text field is not sent.
 */
const SOURCE_INPUT = {
  source_title: optionalText(200),
  source_section: optionalText(200),
  source_url: optionalText(500),
  source_document_id: uuid.optional(),
  source_checked_on: isoDate.optional(),
  no_legal_source: z.boolean().optional(),
  no_source_reason: optionalText(500),
};

/** The problems of a save's source, each on its own field; a missing part carries SOURCE_REQUIRED. */
function sourceProblems(v) {
  const out = [];
  const required = (key, message) => out.push({ path: [key], message, params: { code: SOURCE_REQUIRED } });
  if (v.no_legal_source === true) {
    if (!v.no_source_reason) required("no_source_reason", "Give a reason");
    else if (v.no_source_reason.length < 10) out.push({ path: ["no_source_reason"], message: "At least 10 characters" });
    for (const k of SOURCE_KEYS) if (v[k] !== undefined) out.push({ path: [k], message: "Not with No Source" });
    return out;
  }
  if (!v.source_title) required("source_title", "Name the source");
  if (!v.source_section) required("source_section", "Name the section");
  if (!v.source_checked_on) required("source_checked_on", "Pick the day checked");
  if (v.source_url !== undefined && !isLink(v.source_url)) out.push({ path: ["source_url"], message: "Not a link" });
  if (v.no_source_reason !== undefined) out.push({ path: ["no_source_reason"], message: "Only with No Source" });
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading the rates
 * ------------------------------------------------------------------ */

/**
 * One row of one version of an item. A PAYE table is one row per band (`position` from 1, `band_to` null on the
 * last); rent relief carries its `rate` and its cap in `flat_amount`; the minimum wage its month's amount in
 * `flat_amount`; every other item one `rate`. Each version runs from `effective_from` to the day before `effective_to`
 * (null: still in force, or starting later and open).
 */
const StatutoryRate = z
  .object({
    statutory_rate_id: uuid,
    item: StatutoryItem,
    kind: StatutoryKind,
    base: StatutoryBase,
    rate: z.string(),
    band_from: money.nullable(),
    band_to: money.nullable(),
    flat_amount: money.nullable(),
    position: z.number().int().min(1).nullable(),
    effective_from: isoDate,
    effective_to: isoDate.nullable(),
    ...SOURCE_SHAPE,
    created_by_name: z.string().nullable(),
    created_at: isoDateTime,
  })
  .strict();

/**
 * GET /statutory/rates. With `as_of`, the rows in force on that day; without it, the rows in force today and those
 * that start later, which is what Configurations shows. Ordered by item, then the version's first day, then the band.
 */
const StatutoryRateListQuery = listQuery({ item: StatutoryItem.optional(), as_of: isoDate.optional() }, ["item", "effective_from"]);
const StatutoryRatePage = Paged(StatutoryRate);

/**
 * One version of an item in brief: its rate, its amount (rent relief's cap, the minimum wage), its base, how many PAYE
 * bands, its first day, and its legal source.
 */
const StatutoryVersionBrief = z
  .object({
    rate: z.string().nullable(),
    flat_amount: money.nullable(),
    base: StatutoryBase,
    bands: z.number().int().min(1).nullable(),
    effective_from: isoDate,
    ...SOURCE_SHAPE,
  })
  .strict();

/** One of the eight items: its side, the bases it may use, the version in force today and the next, each null when none. */
const StatutoryItemState = z
  .object({
    item: StatutoryItem,
    kind: StatutoryKind,
    bases: z.array(StatutoryBase).min(1),
    current: StatutoryVersionBrief.nullable(),
    next: StatutoryVersionBrief.nullable(),
  })
  .strict();

/**
 * GET /statutory/items: the eight items, always all eight in §6.12's order, so Configurations shows Not Set for an
 * item with no figure. A fixed set of the items the code knows, not a list of records: it is never paged.
 */
const StatutoryItems = z.object({ items: z.array(StatutoryItemState).length(StatutoryItem.options.length) }).strict();

/* ------------------------------------------------------------------ *
 * Saving a version
 * ------------------------------------------------------------------ */

/** One PAYE band as it is entered; its position is its place in the list. */
const StatutoryBand = z
  .object({
    band_from: amountOrNothing,
    band_to: amountOrNothing.nullable(),
    rate: percent,
  })
  .strict();

const cents = (v) => BigInt(v.replace(".", ""));

/**
 * The bands of a PAYE table: the first starts at nothing, each starts where the one before ends, each ends above
 * where it starts, and only the last may be open (no end). Each problem lands on the band's own field.
 */
function bandProblems(bands) {
  const out = [];
  bands.forEach((b, i) => {
    if (i === 0 && cents(b.band_from) !== 0n) out.push({ path: ["bands", i, "band_from"], message: "Start at zero" });
    if (i > 0) {
      const before = bands[i - 1].band_to;
      if (before === null || cents(before) !== cents(b.band_from)) out.push({ path: ["bands", i, "band_from"], message: "Start where last ends" });
    }
    if (b.band_to === null && i < bands.length - 1) out.push({ path: ["bands", i, "band_to"], message: "Only the last is open" });
    if (b.band_to !== null && cents(b.band_to) <= cents(b.band_from)) out.push({ path: ["bands", i, "band_to"], message: "Above its start" });
  });
  return out;
}

/**
 * POST /statutory/rates: a new version of one item from `effective_from` (today or later in Lagos, never backdated).
 * The version before it ends the day before; a version already starting that same day is replaced. PAYE takes its
 * whole table of bands; rent relief its rate and its cap (`flat_amount`), both; the minimum wage its month's amount
 * (`flat_amount`) and no rate; every other item one rate. `base` is the item's own unless another of its allowed bases
 * is named. The retired `relief` is not an item, so naming it is refused. Every version names its legal source, or No
 * Legal Source with the reason (SOURCE_REQUIRED on the missing field otherwise).
 */
const StatutoryRatesSave = z
  .object({
    item: StatutoryItem,
    effective_from: isoDate,
    base: StatutoryBase.optional(),
    rate: percent.optional(),
    flat_amount: amountOrNothing.optional(),
    bands: z.array(StatutoryBand).min(1, "Enter the bands").max(12, "At most 12 bands").optional(),
    ...SOURCE_INPUT,
  })
  .strict()
  .superRefine((v, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: "custom", path, message });
    for (const p of sourceProblems(v)) ctx.addIssue({ code: "custom", ...p });
    if (v.base && !ITEM_BASES[v.item].includes(v.base)) issue(["base"], "Not a base for this");
    if (v.item === "paye") {
      if (!v.bands) issue(["bands"], "Enter the bands");
      else for (const p of bandProblems(v.bands)) issue(p.path, p.message);
      if (v.rate !== undefined) issue(["rate"], "Rates go on bands");
      if (v.flat_amount !== undefined) issue(["flat_amount"], "Not for PAYE");
      return;
    }
    if (v.bands !== undefined) issue(["bands"], "Only PAYE has bands");
    const amount = v.flat_amount !== undefined && cents(v.flat_amount) > 0n;
    if (v.item === "minimum_wage") {
      if (!amount) issue(["flat_amount"], "Enter an amount");
      if (v.rate !== undefined) issue(["rate"], "Not for this item");
      return;
    }
    if (v.item === "rent_relief") {
      if (v.rate === undefined || !(Number(v.rate) > 0)) issue(["rate"], "Enter a rate");
      if (!amount) issue(["flat_amount"], "Enter the cap");
      return;
    }
    if (v.flat_amount !== undefined) issue(["flat_amount"], "Not for this item");
    if (v.rate === undefined) issue(["rate"], "Enter a rate");
  });

/**
 * DELETE /statutory/rates/:item/versions/:effective_from: Remove Change, the version of one item that starts on a day
 * still to come (409 VERSION_IN_FORCE for one that has started); the version before it runs on again.
 */
const StatutoryVersionParams = z.object({ item: StatutoryItem, effective_from: isoDate }).strict();

/* ------------------------------------------------------------------ *
 * The statutory report (a document, §6.12 rule 6)
 * ------------------------------------------------------------------ */

/** One person's line of one item, every value as printed. `statutory_number` is their tax or pension number (null: Not Set). */
const StatutoryReportRow = z
  .object({
    employee_name: z.string(),
    staff_number: z.string(),
    statutory_number: z.string().nullable(),
    base: z.string(),
    amount: z.string(),
  })
  .strict();

/**
 * The people of one item under one heading: for PAYE and PAYE Refund one group a State of residence, the State's
 * Internal Revenue Service being where the tax goes (the Guidelines para 25; Not Set for a person with none), with the
 * group's total; for every other item one group with no heading and no total of its own.
 */
const StatutoryReportGroup = z
  .object({
    label: z.string().nullable(),
    rows: z.array(StatutoryReportRow),
    total: z.string().nullable(),
  })
  .strict();

/**
 * One item of the report: its people and its total, printed, the legal source of the figure the run was computed with
 * (`source_label`: the instrument and section with the day checked, or No Legal Source with its reason; `source_link`
 * the link, when there is one), and when and where it is remitted (`remit_label`, as §6.16 cites it).
 */
const StatutoryReportItem = z
  .object({
    label: z.string(),
    kind_label: z.string(),
    rate_label: z.string(),
    base_label: z.string(),
    number_label: z.string().nullable(),
    source_label: z.string(),
    source_link: z.string().nullable(),
    remit_label: z.string(),
    groups: z.array(StatutoryReportGroup),
    total: z.string(),
  })
  .strict();

/** A line of the box above the items: how PAYE was worked out, and the figures that have no line of their own. */
const StatutoryReportRule = z.object({ label: z.string(), value: z.string() }).strict();

/**
 * The variables of `templates/documents/statutory-report.html`: a run's statutory lines per item and per person, with
 * the base and the amount, the employee and employer totals, the rules the run was computed with and the figures with no
 * line (rent relief, the minimum wage), each with its legal source (`rules`), each item's source and remittance, and each
 * person's tax and pension numbers. Every value is a string as printed.
 */
const StatutoryReportVars = z
  .object({
    title: z.string(),
    // The run's number. Not `number`: the document engine lays the document's own number over the data's.
    run_number: z.string(),
    period_label: z.string(),
    status_label: z.string(),
    rules: z.array(StatutoryReportRule),
    items: z.array(StatutoryReportItem),
    employee_total: z.string(),
    employer_total: z.string(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * A person's pay to date (§6.12 rule 11, §13.1 item 42)
 * ------------------------------------------------------------------ */

/** GET /statutory/employees/:employee_id/pay-to-date: one person's years, newest first. */
const PayToDateParams = z.object({ employee_id: uuid }).strict();

/** PUT and DELETE /statutory/employees/:employee_id/pay-to-date/:year. */
const PayToDateYearParams = z.object({ employee_id: uuid, year: taxYear }).strict();

/**
 * One person's taxable pay and tax for a year before MyCity's first statutory month: from a previous employer's leaving
 * certificate (Operation of PAYE Regulations 2002, reg 5) or for MyCity's own months before the option was on. The
 * amounts carry names the salary mask governs, so a reader without it reads null (Restricted).
 */
const PayToDate = z
  .object({
    employee_pay_to_date_id: uuid,
    employee_id: uuid,
    year: z.number().int(),
    taxable_pay: money.nullable(),
    tax_paid: money.nullable(),
    document_id: uuid.nullable(),
    entered_by_name: z.string().nullable(),
    updated_at: isoDateTime,
  })
  .strict();
const PayToDatePage = Paged(PayToDate);

/**
 * PUT …/pay-to-date/:year (`payroll.configure`): the year's figures, a new entry or the year's one replaced; the
 * certificate, when there is one, staged through POST /documents and claimed by the save. The year is this one or the
 * next (Lagos; 422 YEAR_NOT_ALLOWED otherwise).
 */
const PayToDateSave = z
  .object({
    taxable_pay: amountOrNothing,
    tax_paid: amountOrNothing,
    document_id: uuid.optional(),
  })
  .strict();

/* ------------------------------------------------------------------ *
 * Gate 6 (check/contract-columns.js): which table each schema is a row of
 * ------------------------------------------------------------------ */

const TABLES = {
  StatutoryRate: {
    table: "statutory_rate",
    virtual: { created_by_name: "who entered it, from app_user and employee" },
  },
  StatutoryRateListQuery: { table: null, reason: "list controls for the rates" },
  StatutoryRatePage: { table: null, reason: "a page of rates" },
  StatutoryVersionBrief: {
    table: "statutory_rate",
    virtual: { bands: "how many PAYE bands the version has, counted from its rows" },
  },
  StatutoryItemState: {
    table: "statutory_rate",
    virtual: {
      bases: "the bases the item's formula may use (ITEM_BASES)",
      current: "the version in force today",
      next: "the version that starts later",
    },
  },
  StatutoryItems: { table: null, reason: "the seven statutory items the code knows, each with its versions" },
  StatutoryBand: { table: "statutory_rate" },
  StatutorySource: { table: "statutory_rate" },
  StatutoryVersionParams: { table: null, reason: "the :item and :effective_from path parameters of Remove Change" },
  StatutoryRatesSave: {
    table: "statutory_rate",
    virtual: { bands: "a PAYE table, written one statutory_rate row a band with its position" },
  },
  StatutoryReportRow: { table: null, reason: "a printed row of the statutory report" },
  StatutoryReportGroup: { table: null, reason: "a printed group of the statutory report: one State's people" },
  StatutoryReportItem: { table: null, reason: "a printed item of the statutory report" },
  StatutoryReportRule: { table: null, reason: "a printed rule of the statutory report" },
  StatutoryReportVars: { table: null, reason: "template variables of the statutory report, every value printed" },
  PayToDate: {
    table: "employee_pay_to_date",
    virtual: { entered_by_name: "who entered it, from app_user and employee" },
  },
  PayToDatePage: { table: null, reason: "a page of a person's pay to date" },
  PayToDateParams: { table: null, reason: "the :employee_id path parameter" },
  PayToDateYearParams: { table: null, reason: "the :employee_id and :year path parameters" },
  PayToDateSave: { table: "employee_pay_to_date" },
};

module.exports = {
  TABLES,
  ITEM_KIND,
  ITEM_BASES,
  AMOUNT_ITEMS,
  RETIRED_ITEMS,
  SOURCE_KEYS,
  SOURCE_REQUIRED,
  StatutoryItem,
  StatutoryKind,
  StatutoryBase,
  StatutoryRate,
  StatutoryRateListQuery,
  StatutoryRatePage,
  StatutoryVersionBrief,
  StatutoryItemState,
  StatutoryItems,
  StatutoryBand,
  StatutorySource,
  StatutoryRatesSave,
  StatutoryVersionParams,
  StatutoryReportRow,
  StatutoryReportGroup,
  StatutoryReportItem,
  StatutoryReportRule,
  StatutoryReportVars,
  PayToDate,
  PayToDatePage,
  PayToDateParams,
  PayToDateYearParams,
  PayToDateSave,
};
