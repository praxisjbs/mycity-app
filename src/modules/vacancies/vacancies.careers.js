"use strict";
/**
 * The careers page, go.mycityapp.io/jobs (docs/guides/recruitment.md §6.1, §6.2). Nobody here is
 * signed in, so this file loads no staff auth (public-surface gate) and answers only allow-lists:
 * every field a stranger may read is named below, and nothing else ever leaves.
 *
 *   list(query)               GET  /api/public/v1/jobs            open roles taking applications
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
  location: r.location,
  work_pattern: r.work_pattern,
});

async function list(query) {
  const page = await repo.publicPage(pool, query);
  return { ...page, data: page.data.map(card) };
}

/** PublicJob, built field by field. A hidden salary band is left out, not sent as null. */
async function get(slug) {
  if (!slugs.looksLikeSlug(slug)) throw notFound();
  const row = await repo.publicBySlug(pool, slug);
  if (!row) throw notFound();
  const { about_company: about } = await repo.settings(pool);
  return {
    ...card(row),
    employment_type: row.employment_type,
    work_pattern_note: row.work_pattern_note,
    probation_months: row.probation_months,
    reports_to: row.reports_to,
    min_experience_years: row.min_experience_years,
    working_days: row.working_days,
    about_company: about,
    ...(row.salary_visible && row.salary_min ? { salary_min: row.salary_min } : {}),
    ...(row.salary_visible && row.salary_max ? { salary_max: row.salary_max } : {}),
    description: row.description,
    requirements: row.requirements,
    nice_to_have: row.nice_to_have,
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

module.exports = { APPLY_TTL_HOURS, list, get, startApplication, howWeHire: lifecycle.howWeHire };
