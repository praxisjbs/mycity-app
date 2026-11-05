"use strict";
/**
 * Vacancies: the one write path for a vacancy (docs/guides/recruitment.md §3 steps 1 to 3, §6.1).
 *
 *   create()        New Vacancy: a draft (VAC-0001), its five scorecard parts at the default weights,
 *                   its traits from Careers Settings; `publish` puts it live in the same save
 *   update()        Edit; a closed vacancy is not edited
 *   publish(), pause(), resume(), close()   the lifecycle (vacancies.lifecycle.js), each a row of
 *                   entity_state_history; the slug is made at the first publish and never changes
 *   saveQuestions(), saveScorecard()        the Apply questions and traits, the parts on or off
 *   settings(), saveSettings()              Careers Settings: About MyCityApp and the Default Traits
 *
 * The careers page is vacancies.careers.js, which never loads staff auth (public-surface gate).
 *
 * Scope is the hiring manager (guide §8): a vacancy outside the reader's scope is a 404, and a
 * team-scoped reader may only name a hiring manager in their scope, or the vacancy would leave it.
 */
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const c = require("@mycity/contract");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const money = require("../../shared/money/money");
const lagos = require("../../shared/time/lagos");
const places = require("../../shared/places/places");
const { transition } = require("../../shared/state/state-history");
const { assertInScope } = require("../../shared/rbac/scope");
const { scopeFor } = require("../../middleware/rbac");
const repo = require("./vacancies.repo");
const lifecycle = require("./vacancies.lifecycle");
const slugs = require("./vacancies.slug");
const questions = require("./vacancies.questions");
const { EVENTS, LOCATION } = require("./vacancies.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That vacancy does not exist", 404);
const field = (name, message) => new AppError("VALIDATION_FAILED", message, 422, { [name]: [message] });

/** The last instant of a Lagos day: a vacancy picked to close on a day closes at 23:59:59 then. */
const endOfDay = (date) => new Date(lagos.endOfDayExclusive(date).getTime() - 1000);

/** The careers page address of a published vacancy. */
const publicUrl = (slug) => `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/jobs/${slug}`;

/** Whole Lagos days from publish to close (or today), null before publish. */
function daysOpen(row, now = new Date()) {
  if (!row.published_at) return null;
  const end = row.closed_at ? new Date(row.closed_at) : now;
  return Math.max(0, lagos.daysBetween(lagos.dateOf(row.published_at), lagos.dateOf(end)));
}

/** A row as the list shows it (Vacancy). */
function listed(row, now = new Date()) {
  return {
    vacancy_id: row.vacancy_id,
    number: row.number,
    title: row.title,
    slug: row.slug,
    status: row.status,
    close_reason: row.close_reason,
    department_id: row.department_id,
    department: row.department,
    hiring_manager: row.hiring_manager,
    location: row.location,
    work_pattern: row.work_pattern,
    positions: row.positions,
    applicants: row.applicants,
    in_progress: row.in_progress,
    closes_at: row.closes_at,
    past_closing: row.past_closing,
    published_at: row.published_at,
    days_open: daysOpen(row, now),
    public_url: row.slug && row.status !== "draft" ? publicUrl(row.slug) : null,
    created_at: row.created_at,
  };
}

/** Whether the user holds recruitment edit over this vacancy's hiring manager. */
async function canEdit(user, row) {
  if (row.status === "closed") return false;
  const s = await scopeFor(user, "recruitment", "edit");
  if (!s) return false;
  return s.scope === "all" || Boolean(row.hiring_manager_id && (s.scope_ids || []).includes(row.hiring_manager_id));
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

async function list(query, scope) {
  const page = await repo.list(pool, query, scope);
  const now = new Date();
  return { ...page, data: page.data.map((r) => listed(r, now)) };
}

const summary = (scope) => repo.summary(pool, scope);
const suggested = (query, scope) => repo.suggested(pool, query, scope);

/** The row behind a vacancy the reader may see, or 404. */
async function visibleRow(db, id, scope, opts) {
  const row = await repo.get(db, id, opts);
  if (!row) throw notFound();
  assertInScope(scope, row.hiring_manager_id);
  return row;
}

/** VacancyDetail. */
async function detailOf(db, row, user) {
  // One after another: inside a write, `db` is the transaction's single client.
  const place = await places.view(db, LOCATION, row.vacancy_id);
  const qs = await repo.questions(db, row.vacancy_id);
  const scorecard = await repo.scorecard(db, row.vacancy_id);
  const counts = await repo.stageCounts(db, row.vacancy_id);
  const editable = user ? await canEdit(user, row) : false;
  const by = new Map(counts.map((r) => [r.stage, r.count]));
  return {
    ...listed(row),
    org_seat_id: row.org_seat_id,
    employment_type: row.employment_type,
    work_pattern_note: row.work_pattern_note,
    location_place: place,
    probation_months: row.probation_months,
    reports_to: row.reports_to,
    min_experience_years: row.min_experience_years,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    salary_visible: row.salary_visible,
    description: row.description,
    requirements: row.requirements,
    nice_to_have: row.nice_to_have,
    target_start_on: row.target_start_on,
    paused_at: row.paused_at,
    closed_at: row.closed_at,
    working_days: row.working_days,
    screening_conditions: row.screening_conditions || [],
    board_stages: lifecycle.boardStages(scorecard),
    questions: qs.filter((q) => q.active).map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : null })),
    scorecard,
    by_stage: lifecycle.M4_STAGES.map((stage) => ({ stage, count: by.get(stage) || 0 })),
    can_edit: editable,
  };
}

async function get(id, user, scope) {
  return detailOf(pool, await visibleRow(pool, id, scope), user);
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/**
 * Check the people and places a save names: the department exists, the hiring manager is an active
 * employee in the writer's scope, and a seat is still vacant with no other live vacancy for it (the
 * seat is held until the save commits, so two saves cannot both take it).
 */
async function checkRefs(client, scope, body, vacancyId = null) {
  if (body.department_id && !(await repo.departmentExists(client, body.department_id)))
    throw field("department_id", "Pick the department");
  if (body.hiring_manager_id) {
    if (!(await repo.activeEmployee(client, body.hiring_manager_id)))
      throw field("hiring_manager_id", "Pick an active employee");
    if (scope.scope !== "all" && !(scope.scope_ids || []).includes(body.hiring_manager_id))
      throw field("hiring_manager_id", "Pick someone in your team");
  }
  if (body.org_seat_id) {
    const seat = await repo.seat(client, body.org_seat_id, vacancyId);
    if (!seat || seat.status !== "vacant") throw field("org_seat_id", "That seat is no longer open");
    if (seat.taken) throw field("org_seat_id", "That seat has a vacancy");
  }
}

/** The contract's fields as columns: closes_on becomes closes_at, the place its line. */
function columnsOf(body) {
  const { closes_on: closesOn, location, publish, ...rest } = body;
  const out = { ...rest };
  if (closesOn !== undefined) out.closes_at = endOfDay(closesOn);
  return out;
}

async function create(actor, scope, body) {
  return tx(async (client) => {
    await checkRefs(client, scope, body);
    const { number } = await numbering.allocate(client, "vacancy");
    const cols = columnsOf(body);
    const placed = body.location && body.work_pattern !== "remote";
    if (placed) cols.location = places.lineOf(body.location);
    const id = await repo.insert(client, { ...cols, number, created_by: actor.user_id });
    if (placed) await places.save(client, LOCATION, id, body.location);
    await repo.insertScorecard(client, id, c.vacancies.SCORECARD_DEFAULTS);
    const { default_traits: traits } = await repo.settings(client);
    if (traits.length) await questions.save(client, id, questions.fromTraits(traits));
    await transition(client, lifecycle.MACHINE, { entity_id: id, from: null, to: "draft", actor_id: actor.user_id });
    await emit(client, {
      key: EVENTS.VACANCY_CREATED,
      entity: { type: "vacancy", id },
      actor,
      payload: { number, title: body.title },
    });
    if (body.publish) await publishIn(client, actor, await repo.get(client, id, { lock: true }));
    return detailOf(client, await repo.get(client, id), actor);
  });
}

async function update(actor, scope, id, body) {
  return tx(async (client) => {
    const before = await visibleRow(client, id, scope, { lock: true });
    if (before.status === "closed") throw new AppError("VACANCY_CLOSED", "A closed vacancy cannot be changed", 409);
    await checkRefs(client, scope, body, id);
    const cols = columnsOf(body);
    const pattern = body.work_pattern || before.work_pattern;
    if (pattern === "remote") {
      // A remote role has no place: one it had is removed, and a place sent with it is not kept.
      if (before.location) {
        await places.remove(client, LOCATION, id);
        cols.location = null;
      }
    } else if (body.location) {
      cols.location = (await places.save(client, LOCATION, id, body.location)).line;
    } else if (!before.location && before.status !== "draft") {
      throw field("location", "Pick the location");
    }
    const min = body.salary_min !== undefined ? body.salary_min : before.salary_min;
    const max = body.salary_max !== undefined ? body.salary_max : before.salary_max;
    if (min && max && money.compare(max, min) < 0) throw field("salary_max", "Below the minimum");
    if (cols.closes_at && before.status !== "draft" && cols.closes_at <= new Date())
      throw field("closes_on", "Pick a day after today");
    await repo.update(client, id, cols);
    await emit(client, {
      key: EVENTS.VACANCY_UPDATED,
      entity: { type: "vacancy", id },
      actor,
      before: { title: before.title, status: before.status },
      payload: { number: before.number, fields: Object.keys(body) },
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/** The slug a vacancy is published under: its own, or a free one made from its title and city. */
async function slugFor(client, row) {
  if (row.slug) return row.slug;
  const base = slugs.base(row.title, await repo.cityOf(client, LOCATION, row.vacancy_id));
  await repo.lockSlug(client, base);
  return slugs.unique(client, base);
}

/** Publish a draft, or resume a paused vacancy, inside the caller's transaction; `row` is locked. */
async function publishIn(client, actor, row) {
  lifecycle.assertCanMove(row.status, "open");
  lifecycle.assertPublishable(row);
  const slug = await slugFor(client, row);
  await repo.setStatus(client, row.vacancy_id, { status: "open", slug });
  await transition(client, lifecycle.MACHINE, {
    entity_id: row.vacancy_id,
    from: row.status,
    to: "open",
    actor_id: actor.user_id,
  });
  await emit(client, {
    key: row.status === "paused" ? EVENTS.VACANCY_RESUMED : EVENTS.VACANCY_PUBLISHED,
    entity: { type: "vacancy", id: row.vacancy_id },
    actor,
    payload: { number: row.number, title: row.title, slug },
  });
}

/** One lifecycle move: publish, pause, resume, close. */
function move(to, event) {
  return async (actor, scope, id, body = {}) =>
    tx(async (client) => {
      const row = await visibleRow(client, id, scope, { lock: true });
      if (to === "open") {
        if (row.status === "paused" && event === EVENTS.VACANCY_PUBLISHED)
          throw new AppError("MOVE_NOT_ALLOWED", "Resume a paused vacancy instead", 409);
        if (row.status === "draft" && event === EVENTS.VACANCY_RESUMED)
          throw new AppError("MOVE_NOT_ALLOWED", "Publish a draft instead", 409);
        await publishIn(client, actor, row);
      } else {
        lifecycle.assertCanMove(row.status, to);
        await repo.setStatus(client, id, { status: to, close_reason: body.close_reason || null });
        await transition(client, lifecycle.MACHINE, { entity_id: id, from: row.status, to, actor_id: actor.user_id });
        await emit(client, {
          key: event,
          entity: { type: "vacancy", id },
          actor,
          payload: { number: row.number, title: row.title, ...(body.close_reason ? { close_reason: body.close_reason } : {}) },
        });
      }
      return detailOf(client, await repo.get(client, id), actor);
    });
}

const publish = move("open", EVENTS.VACANCY_PUBLISHED);
const resume = move("open", EVENTS.VACANCY_RESUMED);
const pause = move("paused", EVENTS.VACANCY_PAUSED);
const close = move("closed", EVENTS.VACANCY_CLOSED);

async function saveQuestions(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (row.status === "closed") throw new AppError("VACANCY_CLOSED", "A closed vacancy cannot be changed", 409);
    await questions.save(client, id, body.questions);
    await emit(client, {
      key: EVENTS.VACANCY_QUESTIONS_SAVED,
      entity: { type: "vacancy", id },
      actor,
      payload: { number: row.number, questions: body.questions.length },
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

async function saveScorecard(actor, scope, id, body) {
  return tx(async (client) => {
    const row = await visibleRow(client, id, scope, { lock: true });
    if (row.status === "closed") throw new AppError("VACANCY_CLOSED", "A closed vacancy cannot be changed", 409);
    await repo.saveScorecard(client, id, body.parts);
    await emit(client, {
      key: EVENTS.VACANCY_SCORECARD_SAVED,
      entity: { type: "vacancy", id },
      actor,
      payload: {
        number: row.number,
        parts: Object.fromEntries(Object.entries(body.parts).map(([k, p]) => [k, p.active ? p.weight : 0])),
      },
    });
    return detailOf(client, await repo.get(client, id), actor);
  });
}

/**
 * A condition about a protected trait (guide §6.4; the same list the cv-screen prompt ignores): age,
 * sex, marital or family status, pregnancy, religion, ethnicity or tribe, state or LGA of origin,
 * nationality, disability, genotype or appearance. Refused before it is kept, so it is never read.
 * A language ("speaks Yoruba") or work with children is a fair condition and passes; what slips
 * past this list is still not applied by the model (prompts/cv-screen.md rule 5).
 */
const PROTECTED = [
  // Age: an age, a range of ages, or a limit; never a number of years of experience ("over 10 years in sales").
  /\b(aged?\s+(between\s+)?\d{2}|\d{2}\s*(to|-|and)\s*\d{2}\s*(years?\s+old|yrs?\s+old|years?\s+of\s+age)|\d{2}\s*years?\s+old|age\s+(limit|range|between|of\s+\d)|ages?\s+\d{2}|not\s+older\s+than|no\s+older\s+than|younger\s+than|older\s+than\s+\d{2}\b(?!\s*(years?|yrs?)\s+(of|in)\b))/i,
  // "Must be 25 to 35", "be 21 or over": a person's own number, not their experience's.
  /\bbe\s+(between\s+)?\d{2}\s*((to|-|and)\s*\d{2}|or\s+(over|under|older|younger))\b(?!\s*(years?|yrs?)\s+(of|in)\b)/i,
  /\b(gender|sex|male|female|married|unmarried|marital|spouse|pregnan\w*|religio\w*|christian|muslim|tribe|tribal|ethnic\w*|state\s+of\s+origin|lga\s+of\s+origin|indigene|nationality|disab\w*|genotype|hiv|appearance|attractive|good.looking)\b/i,
];

/** The conditions that name a protected trait, by their index. */
const protectedConditions = (conditions) =>
  conditions.map((text, i) => (PROTECTED.some((re) => re.test(text)) ? i : -1)).filter((i) => i >= 0);

/**
 * Keep the must-meet conditions Screen With AI asked for (guide §6.4), one to three; left out, the
 * vacancy's kept ones stand. Called by the candidates service inside its own transaction, before it
 * queues the reads. Returns the vacancy and the conditions to read against.
 */
async function keepScreeningConditions(client, scope, id, conditions) {
  const row = await visibleRow(client, id, scope, { lock: true });
  if (row.status === "closed") throw new AppError("VACANCY_CLOSED", "A closed vacancy cannot be changed", 409);
  if (conditions === undefined) {
    const kept = row.screening_conditions || [];
    if (!kept.length) throw field("screening_conditions", "Give one condition");
    return { row, conditions: kept };
  }
  if (conditions.length < 1 || conditions.length > 3) throw field("screening_conditions", "One to three conditions");
  const named = protectedConditions(conditions);
  if (named.length)
    throw new AppError(
      "VALIDATION_FAILED",
      "A condition names a protected trait",
      422,
      Object.fromEntries(named.map((i) => [`screening_conditions.${i}`, ["Not a fair condition"]])),
    );
  await repo.setScreeningConditions(client, id, conditions);
  return { row, conditions };
}

/* ------------------------------------------------------------------ *
 * Careers Settings
 * ------------------------------------------------------------------ */

const settings = () => repo.settings(pool);

/**
 * Careers Settings shape every vacancy, so only a recruiter whose edit grant reaches every vacancy
 * (scope all) may save them; a hiring manager reads them.
 */
async function saveSettings(actor, scope, body) {
  if (scope.scope !== "all") throw new AppError("PERMISSION_DENIED", "Only a recruiter for every vacancy can change this", 403);
  return tx(async (client) => {
    if (body.about_company !== undefined) await repo.putSetting(client, repo.SETTINGS.about, body.about_company, actor.user_id);
    if (body.default_traits !== undefined)
      await repo.putSetting(client, repo.SETTINGS.traits, body.default_traits, actor.user_id);
    await emit(client, {
      key: EVENTS.RECRUITMENT_CAREERS_SETTINGS_SAVED,
      entity: { type: "setting", id: "recruitment" },
      actor,
      payload: { fields: Object.keys(body) },
    });
    return repo.settings(client);
  });
}

/* ------------------------------------------------------------------ *
 * Write With AI (vacancies.draft.js): nothing is kept
 * ------------------------------------------------------------------ */

/** A description drafted from what New Vacancy holds; the department named, not its id. */
async function assist(user, body) {
  const department = body.department_id ? await repo.departmentName(pool, body.department_id) : null;
  const { about_company: company } = await repo.settings(pool);
  return require("./vacancies.draft").draft(user, body, department, company);
}

/** Questions and traits to consider for a vacancy in scope, beside the traits it has. */
async function suggestQuestions(user, scope, id) {
  const row = await visibleRow(pool, id, scope);
  const traits = (await repo.questions(pool, id)).filter((q) => q.active && q.purpose === "interview").map((q) => q.prompt);
  const { about_company: company } = await repo.settings(pool);
  return require("./vacancies.draft").suggest(user, row, traits, company);
}

/* ------------------------------------------------------------------ *
 * Praxis AI cards (vacancies.ai.js)
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a vacancy exists and the reader's scope reaches it. */
async function inScope(db, id, scope) {
  const row = await repo.get(db, id);
  if (!row) return null;
  if (scope.scope !== "all" && !(row.hiring_manager_id && (scope.scope_ids || []).includes(row.hiring_manager_id))) return null;
  return row;
}

/** A vacancy the person names by id, number or title, among those they may see; null when none or several. */
async function idOf(db, words, scope) {
  if (UUID.test(String(words))) return (await inScope(db, String(words), scope)) ? String(words) : null;
  const page = await repo.list(db, { page: 1, q: String(words).slice(0, 100) }, scope);
  const { oneNamed } = require("../../shared/ai/named");
  const found = oneNamed(page.data || [], words, (v) => [v.number, v.title]);
  return found ? found.vacancy_id : null;
}

/** The vacancy a card changes, by name, for the card's header; nothing outside the reader's scope. */
async function cardVacancy(db, id, scope) {
  if (!id || !UUID.test(String(id))) return [];
  const row = await inScope(db, id, scope);
  return row ? [{ type: "vacancy", id, label: `${row.number}, ${row.title}` }] : [];
}

module.exports = {
  list,
  summary,
  suggested,
  get,
  create,
  update,
  publish,
  pause,
  resume,
  close,
  saveQuestions,
  saveScorecard,
  keepScreeningConditions,
  protectedConditions,
  settings,
  saveSettings,
  assist,
  suggestQuestions,
  idOf,
  cardVacancy,
  boardStages: lifecycle.boardStages,
  daysOpen,
  endOfDay,
};
