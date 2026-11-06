"use strict";
/**
 * The careers page, go.mycityapp.io/jobs (docs/guides/recruitment.md §6.1, §6.2). Nobody here is
 * signed in, so this file loads no staff auth (public-surface gate) and answers only allow-lists:
 * every field a stranger may read is named below, and nothing else ever leaves.
 *
 *   list(query)               GET  /api/public/v1/jobs            open roles taking applications, closing soonest first
 *   summary()                 GET  /api/public/v1/jobs/summary    the public index's figures over those roles
 *   get(slug)                 GET  /api/public/v1/jobs/:slug      one role; a draft or an unknown slug is the same 404
 *   startApplication(slug)    POST /api/public/v1/jobs/:slug/apply   a single-use Apply link, 48 hours
 *
 * A role is reached by its slug, made once at first publish (MILESTONES §9, decided 04/11/2026); the
 * Apply link that follows is a token (shared/tokens), and the application it leads to is write-only
 * (the candidates module, P4).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const publicToken = require("../../shared/tokens/public-token");
const repo = require("./vacancies.repo");
const lifecycle = require("./vacancies.lifecycle");
const slugs = require("./vacancies.slug");

/** An Apply link lives 48 hours (guide §6.2). */
const APPLY_TTL_HOURS = 48;

const notFound = () => new AppError("NOT_FOUND", "There is no open role at this address", 404);

/** PublicJobCard. */
const card = (r) => ({
  slug: r.slug,
  title: r.title,
  department: r.department,
  department_code: r.department_code,
  location: r.location,
  work_pattern: r.work_pattern,
  work_pattern_note: r.work_pattern_note,
  employment_type: r.employment_type,
  closes_at: r.closes_at,
});

async function list(query) {
  const page = await repo.publicPage(pool, query);
  return { ...page, data: page.data.map(card) };
}

const { blocksOf } = lifecycle;

/** How many roles the index's Closing Soon shows: the first of the careers list. */
const CLOSING_SOON = 3;

/**
 * PublicJobsSummary. The open count and the three closing soonest come from the careers list's own
 * first page (its order, its filter), so the index and Careers can never disagree.
 */
async function summary() {
  const [first, departments, cities, settings] = await Promise.all([
    repo.publicPage(pool, {}),
    repo.publicDepartments(pool),
    repo.publicCities(pool),
    repo.settings(pool),
  ]);
  return {
    open: first.page.total,
    departments: departments.map((d) => ({ code: d.code, name: d.name, open: d.open })),
    cities: cities.map((c) => ({ name: c.name, open: c.open })),
    closing_soon: first.data.slice(0, CLOSING_SOON).map(card),
    about_company: blocksOf(settings.about_company),
  };
}

/** PublicJob, built field by field. A hidden salary band is left out, not sent as null. */
async function get(slug) {
  if (!slugs.looksLikeSlug(slug)) throw notFound();
  const row = await repo.publicBySlug(pool, slug);
  if (!row) throw notFound();
  return {
    ...card(row),
    employment_type: row.employment_type,
    work_pattern_note: row.work_pattern_note,
    probation_months: row.probation_months,
    reports_to: row.reports_to,
    min_experience_years: row.min_experience_years,
    working_days: row.working_days,
    ...(row.salary_visible && row.salary_min ? { salary_min: row.salary_min } : {}),
    ...(row.salary_visible && row.salary_max ? { salary_max: row.salary_max } : {}),
    description: blocksOf(row.description) || [],
    requirements: blocksOf(row.requirements),
    nice_to_have: blocksOf(row.nice_to_have),
    how_we_hire: lifecycle.howWeHire(row.active_parts),
    applicants: row.applicants,
    closes_at: row.closes_at,
    state: lifecycle.publicState(row),
  };
}

/**
 * Apply for This Role: a single-use Apply link for this role, refused with the same 404 unless it
 * takes applications now. The token is shown once; only its hash is kept.
 */
async function startApplication(slug) {
  if (!slugs.looksLikeSlug(slug)) throw notFound();
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const row = await repo.publicBySlug(client, slug);
      if (!row || !lifecycle.takesApplications(row)) throw notFound();
      const { token } = await publicToken.issue(client, {
        scope: "application.apply",
        subject_type: "vacancy",
        subject_id: row.vacancy_id,
        ttl_hours: APPLY_TTL_HOURS,
        single_use: true,
      });
      return { token };
    });
  } finally {
    client.release();
  }
}

module.exports = { APPLY_TTL_HOURS, CLOSING_SOON, list, summary, get, startApplication, howWeHire: lifecycle.howWeHire };
