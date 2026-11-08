"use strict";
/**
 * The offer letter (docs/guides/offers.md §3 steps 1, 3 and 5): one set of values, one template,
 * one renderer, for the record's preview, the signing page and every PDF.
 *
 *   varsOf(offer, lines, opts)   OfferLetterVars: the standard wording's values, from the offer
 *   canonicalOf(offer, lines)    what a signature covers (shared/documents/canonical OFFER_LETTER)
 *   lines(db, vars)              the letter as the signing page and the record show it: the same
 *                                HTML the PDF is made from, as its blocks of text
 *
 * The standard wording is templates/documents/offer-letter.html, edited on the Offers tab; the
 * version in force when the offer was approved is `offer.terms_version`, so an edit made later
 * never changes a letter already signed or sent. Additional Terms and Schedule A follow it
 * (offers.events.js appendix).
 */
const money = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const { renderMarkdown, render } = require("../../shared/documents/render");
const { markdownToHtml } = require("../../shared/documents/markdown");
const templates = require("../../shared/templates/template-store");
const profile = require("../../shared/organisation/profile");

const TEMPLATE = "offer-letter";

const EMPLOYMENT = { full_time: "Full-time", part_time: "Part-time", contract: "Contract", internship: "Internship" };
const PATTERN = { on_site: "On site", hybrid: "Hybrid", remote: "Remote" };

const day = (v) => (v ? (v instanceof Date ? lagos.dateOf(v) : String(v).slice(0, 10)) : null);
const iso = (v) => (v ? new Date(v).toISOString() : null);

/** The monthly total of the pay lines, as a two-place string. */
const totalOf = (pay) => money.toWire(money.sum(pay.map((l) => l.monthly_amount)));

/** Twelve months of the pay lines. */
const annualOf = (pay) => money.toWire(money.sum(pay.map((l) => l.monthly_amount)).times(12));

/**
 * OfferLetterVars for an offer.
 * @param {object} o  the offer row (offers.repo ROWS)
 * @param {Array<{name: string, monthly_amount: string}>} pay  the pay lines
 * @param {{company: string, signatory?: {name: string, title: string|null}|null, date?: string, sealing?: object|null}} opts
 */
function varsOf(o, pay, { company, signatory = null, date = null, sealing = null }) {
  return {
    company,
    date: date || day(o.approved_at) || lagos.today(),
    candidate: {
      full_name: o.candidate_name,
      first_name: o.candidate_first_name,
      email: o.candidate_email,
    },
    job_title: o.job_title,
    department: o.department || null,
    role_function: o.role_function || null,
    role_scope: o.role_scope || null,
    reports_to: o.reports_to || null,
    location: o.worksite_name || o.vacancy_location || null,
    start_date: day(o.start_date),
    employment_type: EMPLOYMENT[o.employment_type] || null,
    work_pattern: PATTERN[o.work_pattern] || null,
    office_days: o.work_pattern === "hybrid" && o.office_days ? Number(o.office_days) : null,
    probation_months: o.probation_months === null || o.probation_months === undefined ? null : Number(o.probation_months),
    annual_leave_days: o.annual_leave_days === null || o.annual_leave_days === undefined ? null : Number(o.annual_leave_days),
    working_hours: o.working_hours || null,
    incentives: o.incentives || null,
    pay_lines: pay.map((l) => ({ name: l.name, monthly_amount: money.toWire(l.monthly_amount) })),
    monthly_total: totalOf(pay),
    expires_at: iso(o.expires_at),
    signatory: signatory ? { name: signatory.name, title: signatory.title || null } : null,
    additional_terms: o.additional_terms || null,
    job_description: o.job_description || null,
    sealing,
  };
}

/** What a signature on the offer covers (canonical OFFER_LETTER v1). */
function canonicalOf(o, pay) {
  return {
    number: o.number,
    candidate: o.candidate_name,
    job_title: o.job_title,
    department: o.department,
    reports_to: o.reports_to,
    role_function: o.role_function,
    role_scope: o.role_scope,
    start_date: day(o.start_date),
    employment_type: o.employment_type,
    work_pattern: o.work_pattern,
    office_days: o.office_days,
    probation_months: o.probation_months,
    annual_leave_days: o.annual_leave_days,
    working_hours: o.working_hours,
    currency: o.currency,
    pay_lines: pay.map((l) => ({ name: l.name, monthly_amount: l.monthly_amount })),
    monthly_total: totalOf(pay),
    incentives: o.incentives,
    additional_terms: o.additional_terms,
    job_description: o.job_description,
    terms_version: o.terms_version,
  };
}

/** The appendix after the standard wording (the doc type's `appendix`, and the lines below). */
function appendixOf(vars) {
  return [
    vars.additional_terms ? { title: "Additional Terms", markdown: vars.additional_terms } : null,
    vars.job_description ? { title: "Schedule A: Role Description", markdown: vars.job_description } : null,
  ].filter(Boolean);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** HTML as its blocks of text: a paragraph, heading or list item a line; a table row's cells joined. */
function textBlocks(html) {
  return String(html || "")
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " · ")
    .split(/<\/(?:p|h[1-6]|li|tr|div|section)>/i)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/g, " ")
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e) => ENTITIES[e])
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** The wording an offer is rendered with: the version it was approved under, else the current one. */
async function wordingOf(db, o) {
  if (o.terms_version !== null && o.terms_version !== undefined) {
    const t = await templates.version(db, "document", TEMPLATE, o.terms_version);
    if (t) return t;
  }
  return templates.current(db, "document", TEMPLATE);
}

/**
 * The letter as the signing page and the record show it: the same template, values and Markdown
 * renderer the PDF is made with, then its appendix, as lines of text.
 */
async function lines(db, o, vars) {
  const t = await wordingOf(db, o);
  const org = await profile.readProfile(db);
  const values = { ...vars, org: { name: org.legal_name || org.trading_name, display_name: profile.displayName(org) }, number: o.number, today: vars.date, doc: { title: "Offer of Employment" } };
  const body = t.format === "markdown" ? renderMarkdown(t.body, values) : render(t.body, values);
  const out = [vars.candidate.full_name, ...textBlocks(body)];
  for (const a of appendixOf(vars)) out.push(a.title, ...textBlocks(markdownToHtml(a.markdown)));
  return out;
}

module.exports = { TEMPLATE, EMPLOYMENT, PATTERN, varsOf, canonicalOf, appendixOf, textBlocks, wordingOf, lines, totalOf, annualOf };
