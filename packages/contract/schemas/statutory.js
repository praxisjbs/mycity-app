"use strict";
/**
 * Statutory rates and the statutory report (docs/guides/payroll.md §4.2, §5, §6.11, §6.12, Appendix C). Built
 * and shipped off: nothing here is computed until someone with `payroll.configure` switches the advanced option on
 * from a date, and no rate, band or relief is in any seed. MyCity enters every one on Configurations once its
 * accountant has confirmed it against current law; the rates can be entered before the option is first switched
 * on (§13.1 item 25).
 *
 * What is code and what is data (§6.12 rule 7). Code: the set of items below and which side of the payslip each
 * falls on (`ITEM_KIND`), and the shape of the formula. Data, entered as a new version from a date: every rate,
 * every PAYE band's limits and rate, the relief's flat amount and percentage, and each item's base among the ones
 * its formula allows (`ITEM_BASES`, the first being the one §6.12's table gives).
 *
 *   paye              employee   taxable         ordered bands: from, to (none on the last), rate
 *   pension_employee  employee   pensionable     one rate
 *   pension_employer  employer   pensionable     one rate
 *   nhf               employee   basic           one rate
 *   relief            employee   gross           a flat amount and a rate; both may apply
 *   itf               employer   annual_payroll  one rate
 *   nsitf             employer   annual_payroll  one rate
 *
 * A rate is a percentage as a string with up to six places (`numeric(9,6)`): "7.5" is 7.5%. Money is a two-place
 * string. PAYE bands are read as annual or monthly amounts by the setting's `paye_basis` (payroll.js; unset, annual), and
 * so is the relief's flat amount. Messages on a field are four words or fewer.
 *
 * Every version carries its legal source (guide §4.2, §6.12 rule 12, §13.1 item 31): the instrument's title and the
 * section, optionally a link and the instrument itself in the vault (a file staged through POST /documents), and the day
 * it was checked; or No Legal Source with the reason ("a company rule, not a law"). Never both, never neither: a save
 * without one is refused on the missing field with the code SOURCE_REQUIRED (the issue's `params.code`, which
 * shared/http/validate answers with), so the form says it as it is filled. Every row of a version carries the same source.
 */
const { z } = require("zod");
const { uuid, isoDate, isoDateTime, money, optionalText, listQuery, Paged } = require("./common");

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

const StatutoryItem = z.enum(["paye", "pension_employee", "pension_employer", "nhf", "itf", "nsitf", "relief"]);

/** Who bears an item: the person (a deduction on the payslip) or MyCity (an employer charge, on the report only). */
const StatutoryKind = z.enum(["employee", "employer"]);

/** What an item's rate is applied to (§6.12). */
const StatutoryBase = z.enum(["gross", "pensionable", "basic", "taxable", "annual_payroll"]);

/** Which side each item falls on: code, never data (§6.12 rule 7). */
const ITEM_KIND = Object.freeze({
  paye: "employee",
  pension_employee: "employee",
  nhf: "employee",
  relief: "employee",
  pension_employer: "employer",
  itf: "employer",
  nsitf: "employer",
});

/** The bases each item's formula may use; the first is §6.12's, which a save takes when it names none. */
const ITEM_BASES = Object.freeze({
  paye: ["taxable"],
  relief: ["gross"],
  pension_employee: ["pensionable", "basic", "gross"],
  pension_employer: ["pensionable", "basic", "gross"],
  nhf: ["basic", "pensionable", "gross"],
  itf: ["annual_payroll"],
  nsitf: ["annual_payroll"],
});

/** A percentage, 0 to 100, with up to six places: "7.5" is 7.5%. */
const percent = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, "Enter a rate")
  .refine((v) => !/^\d{1,3}(\.\d{1,6})?$/.test(v) || Number(v) <= 100, "At most 100");

/** An amount that is zero or more: a band's limits, the relief's flat amount. */
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
 * last); the relief carries `flat_amount` and `rate`; every other item one `rate`. Each version runs from
 * `effective_from` to the day before `effective_to` (null: still in force, or starting later and open).
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
 * One version of an item in brief: its rate (the relief its flat amount too), its base, how many PAYE bands, its first
 * day, and its legal source.
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

/** One of the seven items: its side, the bases it may use, the version in force today and the next, each null when none. */
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
 * GET /statutory/items: the seven items, always all seven in §6.12's order, so Configurations shows Not Set for an
 * item with no rate. A fixed set of the items the code knows, not a list of records: it is never paged.
 */
const StatutoryItems = z.object({ items: z.array(StatutoryItemState).length(7) }).strict();

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
 * whole table of bands; the relief its flat amount, its rate or both; every other item one rate. `base` is the
 * item's own unless another of its allowed bases is named. Every version names its legal source, or No Legal Source
 * with the reason (SOURCE_REQUIRED on the missing field otherwise).
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
    if (v.item === "relief") {
      const flat = v.flat_amount !== undefined && cents(v.flat_amount) > 0n;
      const rate = v.rate !== undefined && Number(v.rate) > 0;
      if (!flat && !rate) issue(["flat_amount"], "Enter an amount or rate");
      return;
    }
    if (v.flat_amount !== undefined) issue(["flat_amount"], "Only relief has one");
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
 * One item of the report: its people and its total, printed, and the legal source of the rate the run was computed with
 * (`source_label`: the instrument and section with the day checked, or No Legal Source with its reason; `source_link`
 * the link, when there is one).
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
    rows: z.array(StatutoryReportRow),
    total: z.string(),
  })
  .strict();

/**
 * The variables of `templates/documents/statutory-report.html`: a run's statutory lines per item and per person,
 * with the base and the amount, the employee and employer totals, the conventions the run was computed with, each
 * item's legal source (the relief's too, when the run had one: it reduces PAYE but has no line) and each person's tax
 * and pension numbers. Every value is a string as printed.
 */
const StatutoryReportVars = z
  .object({
    title: z.string(),
    number: z.string(),
    period_label: z.string(),
    status_label: z.string(),
    paye_basis_label: z.string(),
    pension_reduces_label: z.string(),
    nhf_reduces_label: z.string(),
    relief_source_label: z.string().nullable(),
    items: z.array(StatutoryReportItem),
    employee_total: z.string(),
    employer_total: z.string(),
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
  StatutoryReportItem: { table: null, reason: "a printed item of the statutory report" },
  StatutoryReportVars: { table: null, reason: "template variables of the statutory report, every value printed" },
};

module.exports = {
  TABLES,
  ITEM_KIND,
  ITEM_BASES,
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
  StatutoryReportItem,
  StatutoryReportVars,
};
