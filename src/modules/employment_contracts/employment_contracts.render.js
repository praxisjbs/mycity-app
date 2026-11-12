"use strict";
/**
 * The employment contract (docs/guides/offers.md §3 step 5a): one set of values, one template, one
 * renderer, for the signing page and every PDF, as the offer letter has.
 *
 *   varsOf(contract, offer, lines, opts)   EmploymentContractVars: the offer's terms as accepted
 *   canonicalOf(contract, offer, lines)    what a signature covers (canonical EMPLOYMENT_CONTRACT)
 *   lines(db, contract, vars)              the contract as the signing page shows it
 *
 * The standard wording is templates/documents/employment-contract.html, edited on the Onboarding
 * tab's Contract settings. The version in force when the contract was generated is kept on its
 * document, so an edit made later never changes a contract already signed or sent (guide §6).
 */
const money = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const { renderMarkdown, render } = require("../../shared/documents/render");
const { markdownToHtml } = require("../../shared/documents/markdown");
const templates = require("../../shared/templates/template-store");
const profile = require("../../shared/organisation/profile");
const offerRender = require("../offers/offers.render");

const TEMPLATE = "employment-contract";

const day = (v) => (v ? (v instanceof Date ? lagos.dateOf(v) : String(v).slice(0, 10)) : null);
const int = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * EmploymentContractVars for a contract.
 * @param {object} ct  the contract row (employment_contracts.repo ROWS)
 * @param {object} o  the offer row the terms come from (offers.repo ROWS)
 * @param {Array<{name: string, monthly_amount: string}>} pay  the offer's pay lines
 * @param {{company: string, signatory?: {name: string, title: string|null}|null, sealing?: object|null}} opts
 */
function varsOf(ct, o, pay, { company, signatory = null, sealing = null }) {
  return {
    company,
    date: day(ct.created_at) || lagos.today(),
    number: ct.number,
    offer_number: o.number,
    employee: {
      full_name: ct.hire_name || ct.employee_name || o.candidate_name,
      first_name: ct.employee_first_name || o.candidate_first_name,
      email: ct.employee_email || o.candidate_email,
      staff_number: ct.staff_number || "",
    },
    job_title: o.job_title,
    department: o.department || null,
    role_function: o.role_function || null,
    role_scope: o.role_scope || null,
    reports_to: o.reports_to || null,
    location: o.worksite_name || o.vacancy_location || null,
    start_date: day(ct.starts_on) || day(o.start_date),
    employment_type: offerRender.EMPLOYMENT[o.employment_type] || null,
    work_pattern: offerRender.PATTERN[o.work_pattern] || null,
    office_days: o.work_pattern === "hybrid" && o.office_days ? Number(o.office_days) : null,
    probation_months: int(o.probation_months),
    annual_leave_days: int(o.annual_leave_days),
    working_hours: o.working_hours || null,
    incentives: o.incentives || null,
    pay_lines: pay.map((l) => ({ name: l.name, monthly_amount: money.toWire(l.monthly_amount) })),
    monthly_total: offerRender.totalOf(pay),
    signatory: signatory ? { name: signatory.name, title: signatory.title || null } : null,
    additional_terms: o.additional_terms || null,
    job_description: o.job_description || null,
    sealing,
  };
}

/**
 * What a signature on the contract covers (canonical EMPLOYMENT_CONTRACT v1). `clauses` carries the
 * headings of what follows the standard wording; the bodies are in the document, not in the payload
 * a verification page shows a stranger.
 */
function canonicalOf(ct, o, pay) {
  return {
    number: ct.number,
    date: day(ct.created_at),
    // The name the contract was made with, so a later rename never changes what was signed.
    employee: ct.hire_name || ct.employee_name || o.candidate_name,
    job_title: o.job_title,
    contract_type: o.employment_type,
    start_date: day(ct.starts_on) || day(o.start_date),
    end_date: day(ct.ends_on),
    currency: o.currency,
    gross_salary: offerRender.totalOf(pay),
    probation_months: o.probation_months,
    clauses: appendixOf({ additional_terms: o.additional_terms, job_description: o.job_description }).map((a) => ({
      heading: a.title,
    })),
  };
}

/** The appendix after the standard wording (the doc type's `appendix`, and the lines below). */
function appendixOf(vars) {
  return [
    vars.additional_terms ? { title: "Additional Terms", markdown: vars.additional_terms } : null,
    vars.job_description ? { title: "Schedule A: Role Description", markdown: vars.job_description } : null,
  ].filter(Boolean);
}

/** The wording a contract is rendered with: the version it was generated under, else the current one. */
async function wordingOf(db, ct) {
  if (ct.terms_version !== null && ct.terms_version !== undefined) {
    const t = await templates.version(db, "document", TEMPLATE, ct.terms_version);
    if (t) return t;
  }
  return templates.current(db, "document", TEMPLATE);
}

/**
 * The contract as the signing page shows it: the same template, values and Markdown renderer the
 * PDF is made with, then its appendix, as lines of text.
 */
async function lines(db, ct, vars) {
  const t = await wordingOf(db, ct);
  const org = await profile.readProfile(db);
  const values = {
    ...vars,
    org: { name: org.legal_name || org.trading_name, display_name: profile.displayName(org) },
    today: vars.date,
    doc: { title: "Contract of Employment" },
  };
  const body = t.format === "markdown" ? renderMarkdown(t.body, values) : render(t.body, values);
  const out = [vars.employee.full_name, ...offerRender.textBlocks(body)];
  for (const a of appendixOf(vars)) out.push(a.title, ...offerRender.textBlocks(markdownToHtml(a.markdown)));
  return out;
}

module.exports = { TEMPLATE, varsOf, canonicalOf, appendixOf, wordingOf, lines };
