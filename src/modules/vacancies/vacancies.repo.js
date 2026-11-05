"use strict";
/**
 * Vacancies: the SQL (docs/guides/recruitment.md §4). Writes vacancy, vacancy_question,
 * recruitment_scorecard_criterion and the module's own setting rows (recruitment.*); reads
 * application counts, org_seat and the people a vacancy names. Never emits (BACKEND_GUIDE §2).
 *
 * Scope is the vacancy's hiring manager (guide §8): `team` and `own` see the vacancies whose
 * hiring_manager_id is in their scope; one with no hiring manager is seen with `all` only.
 *
 * The public reads (publicPage, publicBySlug) name their columns: what reaches a stranger is the
 * service's allow-list, and these queries never hand it a whole row.
 */
const { personJson } = require("../../shared/db/person");
const { pageQuery, orderBy, completeQuery, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { M4_STAGES } = require("./vacancies.lifecycle");

/** The setting rows this module keeps (Careers Settings, guide §6.1). */
const SETTINGS = Object.freeze({ about: "recruitment.about_company", traits: "recruitment.default_traits" });

/** Every vacancy with what the list and the sheet show. */
const ROWS = `
  SELECT v.vacancy_id, v.number::text AS number, v.title, v.slug::text AS slug, v.status, v.close_reason,
         v.department_id, d.name AS department,
         v.hiring_manager_id, ${personJson("hm", "hmd")} AS hiring_manager,
         v.location, v.work_pattern, v.positions,
         (SELECT count(*)::int FROM application a WHERE a.vacancy_id = v.vacancy_id) AS applicants,
         (SELECT count(*)::int FROM application a WHERE a.vacancy_id = v.vacancy_id AND a.status = 'active') AS in_progress,
         v.closes_at, (v.status = 'open' AND v.closes_at IS NOT NULL AND v.closes_at <= now()) AS past_closing,
         v.published_at, v.created_at,
         v.org_seat_id, v.employment_type, v.work_pattern_note, v.probation_months, v.reports_to,
         v.min_experience_years, v.salary_min::text AS salary_min, v.salary_max::text AS salary_max,
         v.salary_visible, v.description, v.requirements, v.nice_to_have, v.target_start_on::text AS target_start_on,
         v.paused_at, v.closed_at, v.working_days, v.screening_conditions, v.worksite_id,
         search_fold(v.number || ' ' || v.title) AS haystack
    FROM vacancy v
    LEFT JOIN department d ON d.department_id = v.department_id
    LEFT JOIN employee hm ON hm.employee_id = v.hiring_manager_id
    LEFT JOIN department hmd ON hmd.department_id = hm.department_id`;

/** The keys of Vacancy (the list); the service adds days_open and public_url. */
const LIST_OUT = `v.vacancy_id, v.number, v.title, v.slug, v.status, v.close_reason, v.department_id, v.department,
  v.hiring_manager, v.location, v.work_pattern, v.positions, v.applicants, v.in_progress, v.closes_at,
  v.past_closing, v.published_at, v.created_at, v.closed_at`;

const SORTS = {
  closes_at: "v.closes_at",
  title: "v.title",
  created_at: "v.created_at",
  published_at: "v.published_at",
};

/**
 * One page of vacancies in scope.
 * @param {{status?: string, department_id?: string, q?: string, page?: number, sort?: object}} query
 * @param {{scope: string, scope_ids: string[]|null}} scope
 */
function list(db, query, scope) {
  const params = [query.status || null, query.department_id || null, query.q || null];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT ${LIST_OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::uuid IS NULL OR v.department_id = $2)
        AND ($3::text IS NULL OR v.haystack LIKE '%' || search_fold($3) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "v.vacancy_id")}`,
    params,
    query,
  );
}

/** One vacancy with every column the service needs, or null. `lock` holds it for a write. */
async function get(db, id, { lock = false } = {}) {
  if (lock) await db.query("SELECT 1 FROM vacancy WHERE vacancy_id = $1 FOR UPDATE", [id]);
  const { rows } = await db.query(`SELECT * FROM (${ROWS}) v WHERE v.vacancy_id = $1`, [id]);
  return rows[0] || null;
}

/** The columns New Vacancy and Edit write; anything else is refused here, not trusted. */
const WRITABLE = [
  "title",
  "department_id",
  "hiring_manager_id",
  "org_seat_id",
  "positions",
  "employment_type",
  "work_pattern",
  "work_pattern_note",
  "location",
  "probation_months",
  "reports_to",
  "min_experience_years",
  "salary_min",
  "salary_max",
  "salary_visible",
  "description",
  "requirements",
  "nice_to_have",
  "target_start_on",
  "working_days",
  "closes_at",
];

function pick(fields) {
  const out = {};
  for (const k of WRITABLE) if (fields[k] !== undefined) out[k] = fields[k];
  return out;
}

/** Insert a draft. `fields` holds WRITABLE keys, number and created_by. Returns the id. */
async function insert(client, { number, created_by: createdBy, ...fields }) {
  const cols = pick(fields);
  const keys = Object.keys(cols);
  const values = keys.map((k) => cols[k]);
  const { rows } = await client.query(
    `INSERT INTO vacancy (number, status, created_by${keys.map((k) => `, ${k}`).join("")})
     VALUES ($1, 'draft', $2${keys.map((_, i) => `, $${i + 3}`).join("")})
     RETURNING vacancy_id`,
    [number, createdBy, ...values],
  );
  return rows[0].vacancy_id;
}

/** Change the WRITABLE columns given; null clears one. */
async function update(client, id, fields) {
  const cols = pick(fields);
  const keys = Object.keys(cols);
  if (!keys.length) return;
  await client.query(
    `UPDATE vacancy SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")} WHERE vacancy_id = $1`,
    [id, ...keys.map((k) => cols[k])],
  );
}

/** The location line, rewritten when a waiting place is named (places.owner rename). */
async function setLocationLine(client, id, line) {
  await client.query("UPDATE vacancy SET location = $2 WHERE vacancy_id = $1", [id, line]);
}

/**
 * Record a lifecycle move on the row: its status and the stamp that goes with it. `slug` is set
 * once, at first publish (COALESCE keeps the one it has).
 */
async function setStatus(client, id, { status, slug = null, close_reason: reason = null }) {
  await client.query(
    `UPDATE vacancy
        SET status = $2,
            slug = COALESCE(slug, $3::citext),
            published_at = CASE WHEN $2 = 'open' AND published_at IS NULL THEN now() ELSE published_at END,
            paused_at = CASE WHEN $2 = 'paused' THEN now() WHEN $2 = 'open' THEN NULL ELSE paused_at END,
            closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END,
            close_reason = CASE WHEN $2 = 'closed' THEN $4 ELSE close_reason END
      WHERE vacancy_id = $1`,
    [id, status, slug, reason],
  );
}

/** The city of the vacancy's picked place, for its slug; null when it has none. */
async function cityOf(db, owner, id) {
  const { rows } = await db.query("SELECT city FROM place WHERE owner = $1 AND owner_key = $2", [owner, String(id)]);
  return rows[0] ? rows[0].city : null;
}

/**
 * Hold a slug's base for the rest of the transaction, so two vacancies published at once with the
 * same title and city cannot both take the same free slug.
 */
async function lockSlug(client, base) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('vacancy.slug:' || $1))", [base]);
}

/** Keep the must-meet conditions Screen With AI asked for (guide §6.4). */
async function setScreeningConditions(client, id, conditions) {
  await client.query("UPDATE vacancy SET screening_conditions = $2::text[] WHERE vacancy_id = $1", [id, conditions]);
}

/* ------------------------------------------------------------------ *
 * Questions and traits
 * ------------------------------------------------------------------ */

async function questions(db, vacancyId) {
  // pagination:complete a vacancy's questions are its form, at most 30 by the contract, read whole
  const { rows } = await completeQuery(
    db,
    `SELECT q.vacancy_question_id, q.purpose, q.question_type, q.prompt, q.options, q.required,
            q.display_order, q.active
       FROM vacancy_question q
      WHERE q.vacancy_id = $1
      ORDER BY q.active DESC, q.purpose, q.display_order, q.vacancy_question_id`,
    [vacancyId],
  );
  return rows;
}

/** Which of these questions have been answered on an application or rated on a card. */
async function questionsInUse(db, vacancyId) {
  const { rows } = await db.query(
    `SELECT q.vacancy_question_id
       FROM vacancy_question q
      WHERE q.vacancy_id = $1
        AND (EXISTS (SELECT 1 FROM interview_rating r WHERE r.vacancy_question_id = q.vacancy_question_id)
             OR EXISTS (SELECT 1 FROM application a
                         WHERE a.vacancy_id = q.vacancy_id AND a.answers ? q.vacancy_question_id::text))`,
    [vacancyId],
  );
  return new Set(rows.map((r) => r.vacancy_question_id));
}

/** Add a question; returns its id. */
async function insertQuestion(client, vacancyId, q, order) {
  const { rows } = await client.query(
    `INSERT INTO vacancy_question (vacancy_id, purpose, question_type, prompt, options, required, display_order, active)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, true)
     RETURNING vacancy_question_id`,
    [vacancyId, q.purpose, q.question_type, q.prompt, q.options ? JSON.stringify(q.options) : null, q.required, order],
  );
  return rows[0].vacancy_question_id;
}

async function updateQuestion(client, vacancyId, id, q, order) {
  const { rowCount } = await client.query(
    `UPDATE vacancy_question
        SET purpose = $3, question_type = $4, prompt = $5, options = $6::jsonb, required = $7,
            display_order = $8, active = true
      WHERE vacancy_id = $1 AND vacancy_question_id = $2`,
    [vacancyId, id, q.purpose, q.question_type, q.prompt, q.options ? JSON.stringify(q.options) : null, q.required, order],
  );
  return rowCount === 1;
}

/** Retire one question: it stays, inactive, on the answers and ratings it was given. */
async function retireQuestion(client, id) {
  await client.query("UPDATE vacancy_question SET active = false WHERE vacancy_question_id = $1", [id]);
}

/** Retire the questions not kept: deleted when unused, made inactive when answered or rated. */
async function dropQuestions(client, vacancyId, keepIds, inUse) {
  const { rows } = await client.query(
    "SELECT vacancy_question_id FROM vacancy_question WHERE vacancy_id = $1 AND NOT (vacancy_question_id = ANY($2::uuid[]))",
    [vacancyId, keepIds],
  );
  for (const { vacancy_question_id: id } of rows) {
    if (inUse.has(id)) await client.query("UPDATE vacancy_question SET active = false WHERE vacancy_question_id = $1", [id]);
    else await client.query("DELETE FROM vacancy_question WHERE vacancy_question_id = $1", [id]);
  }
}

/* ------------------------------------------------------------------ *
 * The scorecard
 * ------------------------------------------------------------------ */

/** The five parts and how each is fed (recruitment_scorecard_criterion.source_type). */
const PARTS = Object.freeze([
  ["screening", "Screening", "screening"],
  ["psychometric", "Psychometric", "assessment"],
  ["technical", "Technical", "assessment"],
  ["case_study", "Case Study", "assessment"],
  ["interview", "Interview", "interview"],
]);

/** The five parts at the default weights, all on (guide §6.1). */
async function insertScorecard(client, vacancyId, defaults) {
  for (const [i, [code, name, source]] of PARTS.entries()) {
    await client.query(
      `INSERT INTO recruitment_scorecard_criterion (vacancy_id, code, name, source_type, weight, active, display_order)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT (vacancy_id, code) DO NOTHING`,
      [vacancyId, code, name, source, defaults[code], i],
    );
  }
}

async function scorecard(db, vacancyId) {
  // pagination:complete the scorecard is always its five parts
  const { rows } = await completeQuery(
    db,
    `SELECT c.code::text AS code, c.name, c.active, round(c.weight)::int AS weight
       FROM recruitment_scorecard_criterion c
      WHERE c.vacancy_id = $1
      ORDER BY c.display_order, c.code`,
    [vacancyId],
  );
  return rows;
}

async function saveScorecard(client, vacancyId, parts) {
  for (const [code, part] of Object.entries(parts)) {
    await client.query(
      "UPDATE recruitment_scorecard_criterion SET active = $3, weight = $4 WHERE vacancy_id = $1 AND code = $2",
      [vacancyId, code, part.active, part.active ? part.weight : 0],
    );
  }
}

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

/** Active applications of one vacancy by stage. */
async function stageCounts(db, vacancyId) {
  // pagination:complete one count per stage, at most ten
  const { rows } = await completeQuery(
    db,
    `SELECT a.stage, count(*)::int AS count
       FROM application a
      WHERE a.vacancy_id = $1 AND a.status = 'active'
      GROUP BY a.stage`,
    [vacancyId],
  );
  return rows;
}

/** The figures above Vacancies, and the funnel, within the scope. */
async function summary(db, scope) {
  const params = [];
  const s = scopeClause(scope, { column: "v.hiring_manager_id" }, params);
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE v.status = 'open')::int AS open,
            count(*) FILTER (WHERE v.status = 'open' AND v.closes_at IS NOT NULL AND v.closes_at <= now())::int AS past_closing
       FROM vacancy v
      WHERE true ${s.and}`,
    params,
  );
  const p2 = [];
  const s2 = scopeClause(scope, { column: "v.hiring_manager_id" }, p2);
  // pagination:complete one count per stage, at most ten
  const funnel = await completeQuery(
    db,
    `SELECT a.stage, count(*)::int AS count
       FROM application a JOIN vacancy v ON v.vacancy_id = a.vacancy_id
      WHERE a.status = 'active' AND v.status IN ('open', 'paused') ${s2.and}
      GROUP BY a.stage`,
    p2,
  );
  const by = new Map(funnel.rows.map((r) => [r.stage, r.count]));
  return {
    open: rows[0].open,
    past_closing: rows[0].past_closing,
    applicants: funnel.rows.reduce((n, r) => n + r.count, 0),
    in_interview: by.get("interview") || 0,
    funnel: M4_STAGES.map((stage) => ({ stage, count: by.get(stage) || 0 })),
  };
}

/* ------------------------------------------------------------------ *
 * Suggested From Organogram
 * ------------------------------------------------------------------ */

/**
 * Vacant seats with no draft, open or paused vacancy, newest first. A team-scoped reader sees the
 * seats whose line manager is in their scope, as they would see the vacancy it becomes.
 */
function suggested(db, query, scope) {
  const params = [query.q || null];
  const s = scopeClause(scope, { column: "s.line_manager_id" }, params);
  return pageQuery(
    db,
    `SELECT s.org_seat_id, s.title, s.department_id, d.name AS department,
            COALESCE(btrim(lm.first_name || ' ' || lm.last_name), up.title) AS reports_to, ${TOTAL_COL}
       FROM org_seat s
       JOIN department d ON d.department_id = s.department_id
       LEFT JOIN employee lm ON lm.employee_id = s.line_manager_id
       LEFT JOIN org_seat up ON up.org_seat_id = s.line_manager_seat_id
      WHERE s.status = 'vacant'
        AND NOT EXISTS (SELECT 1 FROM vacancy v WHERE v.org_seat_id = s.org_seat_id AND v.status IN ('draft', 'open', 'paused'))
        AND ($1::text IS NULL OR search_fold(s.title || ' ' || d.name) LIKE '%' || search_fold($1) || '%')
        ${s.and}
      ORDER BY s.created_at DESC, s.org_seat_id`,
    params,
    query,
  );
}

/**
 * A seat a vacancy names, held for the save, with whether another live (draft, open or paused)
 * vacancy already fills it.
 */
async function seat(client, id, exceptVacancyId = null) {
  const { rows } = await client.query(
    `SELECT s.org_seat_id, s.title, s.department_id, s.status,
            EXISTS (SELECT 1 FROM vacancy v
                     WHERE v.org_seat_id = s.org_seat_id AND v.status IN ('draft', 'open', 'paused')
                       AND ($2::uuid IS NULL OR v.vacancy_id <> $2)) AS taken
       FROM org_seat s
      WHERE s.org_seat_id = $1
        FOR UPDATE OF s`,
    [id, exceptVacancyId],
  );
  return rows[0] || null;
}

/* ------------------------------------------------------------------ *
 * People a vacancy names
 * ------------------------------------------------------------------ */

/** Whether an employee is active (a hiring manager must be). */
async function activeEmployee(db, employeeId) {
  const { rows } = await db.query(
    "SELECT 1 FROM employee WHERE employee_id = $1 AND status = 'active'",
    [employeeId],
  );
  return rows.length === 1;
}

/**
 * A hiring manager holds `recruitment` view through an active login (or is the CEO), as a panelist
 * must: the notices they are sent open screens of Recruitment (GE, 05/11/2026).
 */
async function holdsRecruitment(db, employeeId) {
  const { rows } = await db.query(
    `SELECT 1
       FROM app_user u
      WHERE u.employee_id = $1 AND u.status = 'active'
        AND (u.is_ceo = true OR EXISTS (
              SELECT 1 FROM user_role ur JOIN permission p ON p.role_id = ur.role_id
               WHERE ur.user_id = u.user_id AND p.module_key = 'recruitment' AND p.can_view = true
                 AND (ur.effective_to IS NULL OR ur.effective_to > CURRENT_DATE)))
      LIMIT 1`,
    [employeeId],
  );
  return rows.length === 1;
}

async function departmentExists(db, id) {
  const { rows } = await db.query("SELECT 1 FROM department WHERE department_id = $1", [id]);
  return rows.length === 1;
}

/** A department's name, for Write With AI; null when there is none. */
async function departmentName(db, id) {
  const { rows } = await db.query("SELECT name FROM department WHERE department_id = $1", [id]);
  return rows[0] ? rows[0].name : null;
}

/* ------------------------------------------------------------------ *
 * Careers Settings: setting rows recruitment.*
 * ------------------------------------------------------------------ */

async function settings(db) {
  const { rows } = await db.query(
    "SELECT key, value, updated_at FROM setting WHERE key = ANY($1::text[])",
    [[SETTINGS.about, SETTINGS.traits]],
  );
  const by = new Map(rows.map((r) => [r.key, r]));
  const about = by.get(SETTINGS.about);
  const traits = by.get(SETTINGS.traits);
  const stamps = rows.map((r) => new Date(r.updated_at).getTime());
  return {
    about_company: about && typeof about.value === "string" && about.value.trim() ? about.value : null,
    default_traits: traits && Array.isArray(traits.value) ? traits.value.filter((t) => typeof t === "string") : [],
    updated_at: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}

async function putSetting(client, key, value, userId) {
  await client.query(
    `INSERT INTO setting (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, JSON.stringify(value), userId],
  );
}

/* ------------------------------------------------------------------ *
 * Public: the careers page (allow-listed by the service)
 * ------------------------------------------------------------------ */

const PUBLIC_COLS = `v.vacancy_id, v.slug::text AS slug, v.title, d.name AS department, v.location, v.work_pattern,
  v.status, v.close_reason, v.closes_at, v.published_at`;

/** Open roles taking applications, newest first, searched by title, department or place. */
function publicPage(db, query) {
  return pageQuery(
    db,
    `SELECT ${PUBLIC_COLS}, ${TOTAL_COL}
       FROM vacancy v
       LEFT JOIN department d ON d.department_id = v.department_id
      WHERE v.status = 'open' AND v.slug IS NOT NULL
        AND (v.closes_at IS NULL OR v.closes_at > now())
        AND ($1::text IS NULL OR search_fold(v.title || ' ' || COALESCE(d.name, '') || ' ' || COALESCE(v.location, ''))
                                  LIKE '%' || search_fold($1) || '%')
      ORDER BY v.published_at DESC NULLS LAST, v.vacancy_id`,
    [query.q || null],
    query,
  );
}

/** A published vacancy by its slug (never a draft), with the columns PublicJob names. */
async function publicBySlug(db, slug) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLS}, v.employment_type, v.work_pattern_note, v.probation_months, v.reports_to,
            v.min_experience_years, v.working_days, v.salary_visible,
            v.salary_min::text AS salary_min, v.salary_max::text AS salary_max,
            v.description, v.requirements, v.nice_to_have,
            (SELECT count(*)::int FROM application a WHERE a.vacancy_id = v.vacancy_id) AS applicants,
            (SELECT COALESCE(array_agg(c.code::text ORDER BY c.display_order), '{}')
               FROM recruitment_scorecard_criterion c WHERE c.vacancy_id = v.vacancy_id AND c.active) AS active_parts
       FROM vacancy v
       LEFT JOIN department d ON d.department_id = v.department_id
      WHERE v.slug = $1::citext AND v.status <> 'draft'`,
    [slug],
  );
  return rows[0] || null;
}

module.exports = {
  M4_STAGES,
  PARTS,
  SETTINGS,
  list,
  get,
  insert,
  update,
  setLocationLine,
  setStatus,
  setScreeningConditions,
  cityOf,
  lockSlug,
  questions,
  questionsInUse,
  insertQuestion,
  updateQuestion,
  retireQuestion,
  dropQuestions,
  insertScorecard,
  scorecard,
  saveScorecard,
  stageCounts,
  summary,
  suggested,
  seat,
  activeEmployee,
  holdsRecruitment,
  departmentExists,
  departmentName,
  settings,
  putSetting,
  publicPage,
  publicBySlug,
};
