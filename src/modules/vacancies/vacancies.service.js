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
 *   settings(user), saveSettings()          Careers Settings: About MyCityApp and the Default Traits, with can_edit
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

/** The figures above Vacancies, and the careers page on this environment (Careers Page). */
const summary = async (scope) => ({ ...(await repo.summary(pool, scope)), careers_url: `${String(config.PUBLIC_ORIGIN).replace(/\/+$/, "")}/jobs` });
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
    description_blocks: lifecycle.blocksOf(row.description) || [],
    requirements_blocks: lifecycle.blocksOf(row.requirements),
    nice_to_have_blocks: lifecycle.blocksOf(row.nice_to_have),
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
    if (!(await repo.holdsRecruitment(client, body.hiring_manager_id)))
      throw field("hiring_manager_id", "No Recruitment access");
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

const CLOSE_WORDS = { filled: "filled", cancelled: "cancelled", on_hold: "on hold" };

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
        // Close can tell everyone still in progress at once (GE, 05/11/2026): each is marked Not
        // Progressing through the candidates' own path, so each gets their email.
        if (to === "closed" && body.not_progress)
          await require("../candidates/candidates.service").notProgressAllIn(client, actor, id, `The vacancy closed (${CLOSE_WORDS[body.close_reason] || "closed"})`);
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
 * A condition about a protected trait (guide §6.4; the same list the cv-screen prompt ignores): sex,
 * age, ethnicity or tribe (and a language asked for as an origin), religion, marital or family status
 * and pregnancy, disability or health, state or LGA of origin, nationality and appearance. Refused
 * before it is kept, so it is never read. A language as a skill ("Fluent in English", "Speaks
 * Yoruba"), where someone lives ("Lives in Lagos"), years of experience ("Over 10 years in sales") and
 * work with children are fair and pass; what slips past this list is still not applied by the model
 * (prompts/cv-screen.md rule 5).
 *
 * The text is folded first (lower case, accents off, curly quotes straight, any run of dashes,
 * slashes, dots or underscores a space), so "Ladies-only", "L.G.A." and "Muslim/Christian" read as
 * their words.
 */
const fold = (text) =>
  String(text)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 to $2")
    .replace(/[-_/\\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A person's own age: a number 15 to 69 (an experience of 10 or 12 years never reads as an age). */
const AGE = "(?:1[5-9]|[2-6]\\d)";
/** What a number counts when it is not an age: years in a job, hours, sales, people. */
const NOT_AGE =
  "(?!\\s*(?:\\+\\s*)?(?:years?|yrs?)\\s+(?:of\\s+(?!age\\b)|in\\b|experience|working|post|relevant|professional|industry|as\\b|on\\b|at\\b|with\\b|doing|managing|leading|selling|running))" +
  "(?!\\s*(?:%|percent|per\\b|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|km|kilomet\\w*|miles?|kg|words?|wpm|people|staff|persons?|clients?|customers?|accounts?|units?|calls?|deals?|leads?|sales|stores?|shops?|branches?|cities|states|million|thousand|naira|k\\b|m\\b))";

/**
 * Nigeria's larger peoples, named as an origin; a language skill naming one is fair (see LANGUAGE).
 * Names that are also a place people live (Edo, Oyo, Ekiti, Ibadan) are left to STATES and their context.
 */
const PEOPLES =
  "igbo|ibo|yoruba|hausa|fulani|ijaw|izon|kanuri|tiv|ibibio|efik|annang|bini|esan|urhobo|itsekiri|isoko|nupe|igala|idoma|ebira|igbira|gwari|gbagyi|jukun|berom|ogoni|ejagham";
/** The states and the capital territory, named as an origin. */
const STATES =
  "abia|adamawa|akwa ibom|anambra|bauchi|bayelsa|benue|borno|cross river|delta|ebonyi|edo|ekiti|enugu|gombe|imo|jigawa|kaduna|kano|katsina|kebbi|kogi|kwara|lagos|nasarawa|niger|ogun|ondo|osun|oyo|plateau|rivers|sokoto|taraba|yobe|zamfara|fct|abuja";

/** A language asked for as a skill: speaking, reading, writing or translating it. */
const LANGUAGE = /\b(speak\w*|spoken|fluen\w*|conversant|proficien\w*|read\w*|writ\w*|language|interpret\w*|translat\w*|communicat\w*|bilingual)\b/;
/** A language asked for as an origin: a native, a mother tongue, by birth. */
const ORIGIN_WORDS = /\b(native|mother tongue|first language|by birth|by origin|origin\w*|indigen\w*|ancestr\w*|descent|heritage|blood)\b/;

/** Each trait's test, on the folded text. */
const PROTECTED = Object.freeze([
  {
    trait: "sex",
    test: (t) =>
      /\b(gender|sex|sexes|male|males|female|females|man|men|woman|women|lady|ladies|gentleman|gentlemen|girls?|boys?|guys?|feminine|masculine|he or she|she or he|transgender)\b(?!'s|s')/.test(t) ||
      /\b(mr|mrs|miss|ms)\b\s*(only|$)/.test(t),
  },
  {
    trait: "age",
    test: (t) =>
      /\b(age|aged|ages|years? old|yrs? old|years? of age|young|younger|youngest|youthful|elderly|over the hill|millennials?|gen ?z|date of birth|dob|birth year|year of birth|born (in|after|before|between) \d{4})\b/.test(t) ||
      new RegExp(`\\b(under|below|over|above|beyond|exceed\\w*|older than|younger than|less than|more than|no more than|not more than|not above|not over|maximum( of)?|max|minimum( of)?|min|at least|at most|up to)\\s+${AGE}\\b${NOT_AGE}`).test(t) ||
      new RegExp(`\\b(be|is|are|aged)\\s+(between\\s+)?${AGE}\\b${NOT_AGE}`).test(t) ||
      new RegExp(`\\bbetween\\s+${AGE}\\s+(and|to)\\s+${AGE}\\b${NOT_AGE}`).test(t) ||
      new RegExp(`\\b${AGE}\\s+to\\s+${AGE}\\s*(years?|yrs?)?\\s*(only|$)`).test(t) ||
      new RegExp(`^${AGE}\\s*(\\+|years?|yrs?)?\\s*(or (under|over|below|above|younger|older|less|more))?\\s*(only)?$`).test(t),
  },
  {
    trait: "ethnicity",
    test: (t) => {
      if (/\b(tribe|tribes|tribal|tribesm[ae]n|ethnic\w*|race|races|racial|colou?red|skin (colou?r|tone)|complexion|fair skinned|light skinned|dark skinned|albin\w*|northerners?|southerners?|easterners?|westerners?|middle belt\w*|hausa fulani)\b/.test(t))
        return true;
      if (!new RegExp(`\\b(${PEOPLES})s?\\b`).test(t)) return false;
      // "Speaks Yoruba" is a skill; "Igbo only", "Must be Yoruba" or "a native Hausa speaker" is an origin.
      return ORIGIN_WORDS.test(t) || !LANGUAGE.test(t);
    },
  },
  {
    trait: "origin",
    test: (t) =>
      /\b(state of origin|lga of origin|l g a of origin|local government (area )?of origin|hometown|home town|home state|village of origin|indigen\w*|non indigen\w*|native of|hails? from|originally from|origin)\b/.test(t) ||
      new RegExp(`\\b(${STATES})( state)?\\s+(origin|indigenes?|natives?|people|man|men|woman|women|sons?|daughters?|born)\\b`).test(t) ||
      new RegExp(`\\b(born in|from)\\s+(${STATES})( state)?\\s*(only|$)`).test(t) && !/\b(live|lives|living|resid\w*|based|relocat\w*|commute\w*)\b/.test(t),
  },
  {
    trait: "religion",
    test: (t) =>
      /\b(religio\w*|(?<!(good|bad) )faith|christians?|christianity|muslims?|moslems?|islam\w*|catholics?|protestants?|pentecostal\w*|anglicans?|methodists?|baptists?|adventists?|jehovah\w*|evangelical\w*|born again|church\w*|mosques?|hijab\w*|veil\w*|turban\w*|pray\w*|sabbath|god fearing|godly|atheists?|agnostics?|pagan\w*|traditional worship\w*|traditionalists?|hindus?|jewish|jews?|buddhists?|sharia)\b/.test(t),
  },
  {
    trait: "family",
    test: (t) =>
      /\b(marital|married|marry|marriage|unmarried|spouses?|husbands?|wives|wife|divorc\w*|widow\w*|separated|fianc\w*|engaged to|spinsters?|pregnan\w*|maternity|paternity|childless|child free|no (kids|children|child)|(has|have|having|without) (no )?(kids|children|child)\b|family (status|planning|commitments?)|plans? to (marry|have)|nursing mothers?|single (mothers?|fathers?|parents?|ladies|women|men|status)|mothers?|fathers?)\b/.test(t) ||
      /\b(be|is|are|must|only)\s+single\b|\bsingle\s*(only|$)/.test(t),
  },
  {
    trait: "disability",
    test: (t) =>
      /\b(disab\w*|handicap\w*|able bodied|abled|impair\w*|blind(?! (panel|review|spot|test|copy))|deaf|dumb|mute|lame|cripple\w*|wheelchair\w*|amputee\w*|stammer\w*|stutter\w*|mental(ly)? (ill\w*|health|disorder\w*)|psychiatric|epilep\w*|sickle|genotype|blood group|hiv|hepatitis|medical (history|condition\w*)|chronic (illness|condition))\b/.test(t),
  },
  {
    trait: "nationality",
    test: (t) =>
      /\b(nationality|nationals|citizens? only|citizenship|foreigners?|expatriates?|non nigerians?)\b/.test(t) ||
      /\b(nigerians?|ghanaians?|cameroonians?)\s*(only|$)|\bonly\s+nigerians?\b/.test(t),
  },
  {
    trait: "appearance",
    test: (t) =>
      /\b(appearance|attractive|good looking|pretty|beautiful|handsome|cute|sexy|slim|slender|petite|curvy|plus size|fat|obese|overweight|skinny|tall|heights?|overweight|body (size|shape|type)|photogenic)\b/.test(t) &&
      !/\bwork(ing)? at heights?\b/.test(t),
  },
]);

/** The traits a condition names, or none. */
const traitsNamed = (text) => {
  const t = fold(text);
  return PROTECTED.filter((p) => p.test(t)).map((p) => p.trait);
};

/** The conditions that name a protected trait, by their index. */
const protectedConditions = (conditions) =>
  conditions.map((text, i) => (traitsNamed(text).length ? i : -1)).filter((i) => i >= 0);

/**
 * Keep the must-meet conditions Screen With AI asked for (guide §6.4), one to three; left out, the
 * vacancy's kept ones stand. Called by the candidates service inside its own transaction, before it
 * queues the reads. Returns the vacancy and the conditions to read against.
 */
async function keepScreeningConditions(client, scope, id, conditions, actor = null) {
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
  await emit(client, {
    key: EVENTS.VACANCY_UPDATED,
    entity: { type: "vacancy", id },
    actor,
    before: { title: row.title, status: row.status },
    payload: { number: row.number, fields: ["screening_conditions"] },
  });
  return { row, conditions };
}

/* ------------------------------------------------------------------ *
 * Careers Settings
 * ------------------------------------------------------------------ */

/** Whether `user` may save what goes to every role (Careers Settings, Candidate Emails): recruitment edit over every vacancy. */
async function wordsEveryRole(user) {
  const s = user ? await scopeFor(user, "recruitment", "edit") : null;
  return Boolean(s && s.scope === "all");
}

/** Careers Settings, with whether the reader may save them (so the screen offers Save only then). */
const settings = async (user) => ({ ...(await repo.settings(pool)), can_edit: await wordsEveryRole(user) });

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
    return { ...(await repo.settings(client)), can_edit: true };
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

/** The interview's two follow-up questions about the role, from its answers so far; the department named. */
async function followUps(user, body) {
  const department = body.department_id ? await repo.departmentName(pool, body.department_id) : null;
  const { about_company: company } = await repo.settings(pool);
  return require("./vacancies.draft").followUps(user, body, department, company);
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
  wordsEveryRole,
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
  traitsNamed,
  settings,
  saveSettings,
  assist,
  followUps,
  suggestQuestions,
  idOf,
  cardVacancy,
  boardStages: lifecycle.boardStages,
  daysOpen,
  endOfDay,
};
