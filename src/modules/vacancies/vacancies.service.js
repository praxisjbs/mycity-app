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

/** The board's columns for a vacancy: the M4 stages less those whose parts are off (guide §6.3). */
function boardStages(scorecard) {
  const on = new Set(scorecard.filter((p) => p.active).map((p) => p.code));
  return repo.M4_STAGES.filter((stage) => {
    if (stage === "assessment") return on.has("psychometric") || on.has("technical") || on.has("case_study");
    if (stage === "interview") return on.has("interview");
    return true;
  });
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
const suggested = (query) => repo.suggested(pool, query);

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
    board_stages: boardStages(scorecard),
    questions: qs.map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options : null })),
    scorecard,
    by_stage: repo.M4_STAGES.map((stage) => ({ stage, count: by.get(stage) || 0 })),
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
 * employee in the writer's scope, and a seat is still vacant.
 */
async function checkRefs(client, scope, body) {
  if (body.department_id && !(await repo.departmentExists(client, body.department_id)))
    throw field("department_id", "Pick the department");
  if (body.hiring_manager_id) {
    if (!(await repo.activeEmployee(client, body.hiring_manager_id)))
      throw field("hiring_manager_id", "Pick an active employee");
    if (scope.scope !== "all" && !(scope.scope_ids || []).includes(body.hiring_manager_id))
      throw field("hiring_manager_id", "Pick someone in your team");
  }
  if (body.org_seat_id) {
    const seat = await repo.seat(client, body.org_seat_id);
    if (!seat || seat.status !== "vacant") throw field("org_seat_id", "That seat is no longer open");
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
    if (body.location) cols.location = places.lineOf(body.location);
    const id = await repo.insert(client, { ...cols, number, created_by: actor.user_id });
    if (body.location) await places.save(client, LOCATION, id, body.location);
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
    await checkRefs(client, scope, body);
    const cols = columnsOf(body);
    const pattern = body.work_pattern || before.work_pattern;
    if (body.location) {
      cols.location = (await places.save(client, LOCATION, id, body.location)).line;
    } else if (pattern !== "remote" && !before.location && before.status !== "draft") {
      throw field("location", "Pick the location");
    }
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

/** Read the city of the vacancy's picked place, for its slug. */
async function cityOf(client, id) {
  const { rows } = await client.query("SELECT city FROM place WHERE owner = $1 AND owner_key = $2", [LOCATION, String(id)]);
  return rows[0] ? rows[0].city : null;
}

/** Publish a draft inside the caller's transaction; `row` is locked. */
async function publishIn(client, actor, row) {
  lifecycle.assertCanMove(row.status, "open");
  lifecycle.assertPublishable(row);
  const slug = row.slug || (await slugs.unique(client, slugs.base(row.title, await cityOf(client, row.vacancy_id))));
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
 * Keep the must-meet conditions Screen All With AI asked for (guide §6.4). Called by the candidates
 * service inside its own transaction, before it queues the reads.
 */
async function keepScreeningConditions(client, scope, id, conditions) {
  const row = await visibleRow(client, id, scope, { lock: true });
  await repo.setScreeningConditions(client, id, conditions);
  return row;
}

/* ------------------------------------------------------------------ *
 * Careers Settings
 * ------------------------------------------------------------------ */

const settings = () => repo.settings(pool);

async function saveSettings(actor, body) {
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
  let department = null;
  if (body.department_id) {
    const { rows } = await pool.query("SELECT name FROM department WHERE department_id = $1", [body.department_id]);
    department = rows[0] ? rows[0].name : null;
  }
  return require("./vacancies.draft").draft(user, body, department);
}

/** Questions and traits to consider for a vacancy in scope, beside the traits it has. */
async function suggestQuestions(user, scope, id) {
  const row = await visibleRow(pool, id, scope);
  const traits = (await repo.questions(pool, id)).filter((q) => q.active && q.purpose === "interview").map((q) => q.prompt);
  return require("./vacancies.draft").suggest(user, row, traits);
}

/* ------------------------------------------------------------------ *
 * Praxis AI cards (vacancies.ai.js)
 * ------------------------------------------------------------------ */

/** A vacancy the person names by number or title, among those they may see; null when none or several. */
async function idOf(db, words, scope) {
  if (/^[0-9a-f-]{36}$/i.test(String(words))) return String(words);
  const page = await repo.list(db, { page: 1, q: String(words).slice(0, 100) }, scope);
  const { oneNamed } = require("../../shared/ai/named");
  const found = oneNamed(page.data || [], words, (v) => [v.number, v.title]);
  return found ? found.vacancy_id : null;
}

/** The vacancy a card changes, by name, for the card's header. */
async function cardVacancy(db, id) {
  if (!id) return [];
  const row = await repo.get(db, id);
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
  settings,
  saveSettings,
  assist,
  suggestQuestions,
  idOf,
  cardVacancy,
  boardStages,
  daysOpen,
  endOfDay,
};
