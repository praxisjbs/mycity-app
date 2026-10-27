"use strict";
/**
 * Every document type the code numbers, and its default scheme
 * (BACKEND_STRUCTURE §7).
 *
 * This list is the contract between the code and the `numbering_scheme` table:
 *  - a reference seed writes one row per entry, from these defaults (0099 the
 *    first sixteen; a type added later comes with its milestone's seed, as
 *    report_run with 1199);
 *  - the readiness probe reports any entry with no row (a type the code would
 *    fail to number);
 *  - scripts/check/numbering-schemes.js fails the build when the code calls
 *    allocate(client, "<type>") for a type that is not listed here.
 *
 * The scheme in the database is what is used; these are only the starting
 * values. Settings → Documents & Numbering edits the row, and a change applies to
 * future numbers only.
 *
 *   prefix      letters before the number                      "QRY"
 *   padding     digits in the sequence part; 0 = no sequence   4 → "0028"
 *   separator   between the parts                              "-"
 *   reset       when the sequence starts again                 never | yearly | monthly
 *   include_period  put the year (yearly) or year-month (monthly) in the number
 *
 * Prefixes are proposals pending MyCity's confirmation (the naming email); they
 * are a setting, so confirming them is not a code change.
 */

const RESETS = ["never", "yearly", "monthly"];

/** doc_type → default scheme. Milestone of first use in the comment. */
const SCHEMES = Object.freeze({
  employee: {
    prefix: "",
    padding: 5,
    separator: "",
    reset: "never",
    include_period: false,
  }, // M0 staff number: MyCity's own five digits, 00001 (decided with TB, 16/10/2026)
  document: {
    prefix: "DOC",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M0 vault
  import_batch: {
    prefix: "IMP",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M0
  report_run: {
    prefix: "RPT",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M1 Home: one generated report file, "RPT-0001"
  project: {
    prefix: "PRJ",
    padding: 6,
    separator: "-",
    reset: "yearly",
    include_period: true,
  }, // M2 (seeded in 2099): a project, "PRJ-2026-000001"
  task: {
    prefix: "TSK",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M2 My Workspace: a task, "TSK-0001" (seeded in 2090)
  organisational_goal: {
    prefix: "ORG",
    padding: 2,
    separator: "-",
    reset: "yearly",
    include_period: true,
  }, // M2 Performance: an organisational goal's ID, "ORG-2026-01", numbered by its plan year (seeded in 2291)
  location_request: {
    prefix: "WLR",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M1 attendance: a work location request, "WLR-0001" (seeded in 1392)
  field_assignment: {
    prefix: "FA",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M1 attendance: a field assignment, "FA-0001" (seeded in 1393)
  temporary_site: {
    prefix: "TS",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M1 attendance: a temporary site, "TS-0001" (seeded in 1470)
  policy: {
    prefix: "POL",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M1 policies: a company policy, "POL-0001" (seeded in 1396)
  query: {
    prefix: "QRY",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M3
  sanction: {
    prefix: "SAN",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M3
  letter: {
    prefix: "LTR",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M3
  vacancy: {
    prefix: "VAC",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M4
  offer: {
    prefix: "OFF",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M5
  contract: {
    prefix: "CON",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M5
  payroll_run: {
    prefix: "PAY",
    padding: 0,
    separator: "-",
    reset: "monthly",
    include_period: true,
  }, // M6 "PAY-2026-10"
  payslip: {
    prefix: "PAY",
    padding: 4,
    separator: "-",
    reset: "monthly",
    include_period: true,
  }, // M6 "PAY-2026-10-0001"
  proposal: {
    prefix: "PRO",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M7
  mou: {
    prefix: "MOU",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M7
  expense: {
    prefix: "EXP",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M8
  requisition: {
    prefix: "REQ",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M8
  disbursement: {
    prefix: "DSB",
    padding: 4,
    separator: "-",
    reset: "never",
    include_period: false,
  }, // M8
});

const DOC_TYPES = Object.freeze(Object.keys(SCHEMES));

/** Problems with a scheme row (Settings validates edits with this), empty when valid. */
function validateScheme(s) {
  const p = [];
  if (!s || typeof s !== "object") return ["scheme must be an object"];
  if (typeof s.prefix !== "string" || !/^[A-Z0-9]{0,8}$/.test(s.prefix))
    p.push("prefix must be up to 8 capital letters or digits");
  // With no prefix the number is the sequence alone (00001), so it must have one.
  if (s.prefix === "" && !(Number.isInteger(s.padding) && s.padding > 0))
    p.push("a scheme with no prefix needs a sequence part");
  if (!Number.isInteger(s.padding) || s.padding < 0 || s.padding > 10)
    p.push("padding must be 0 to 10");
  if (typeof s.separator !== "string" || !/^[-/._]?$/.test(s.separator))
    p.push("separator must be one of - / . _ or empty");
  if (!RESETS.includes(s.reset))
    p.push(`reset must be one of ${RESETS.join(", ")}`);
  if (typeof s.include_period !== "boolean")
    p.push("include_period must be true or false");
  if (s.padding === 0 && !(s.include_period && s.reset !== "never")) {
    p.push(
      "a scheme with no sequence part must include a period, or every number would be the same",
    );
  }
  return p;
}

module.exports = { SCHEMES, DOC_TYPES, RESETS, validateScheme };
