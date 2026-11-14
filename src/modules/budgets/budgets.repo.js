"use strict";
/**
 * Budgets: the SQL. Reads each department's budget for a year with its lines by category, Budget
 * History from the audit ledger, and each project's spend; writes only budget and budget_line.
 * Never emits (BACKEND_GUIDE §2). A project's budget is written by the projects service, and a
 * request's line and flag by the expenses service.
 *
 * Committed and spent on a line are never added to by hand: recount() works them out again from
 * the requests that name the line (docs/guides/expenses.md §6.6 rule 2).
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
const { scopeClause } = require("../../shared/rbac/scope");
const { personJson } = require("../../shared/db/person");

/** The statuses counted as committed (approved, not yet paid) and spent. */
const COMMITTED = Object.freeze(["approved", "in_requisition", "authorised"]);
const SPENT = Object.freeze(["disbursed"]);

/** A budget with its totals over its lines. */
const BUDGETS = `
  SELECT b.budget_id, b.number, b.name, b.department_id, bd.name AS department,
         -- The department's head now, not the one at saving (audit F17): scope and notices follow a new head.
         COALESCE(bd.head_employee_id, b.owner_id) AS owner_id,
         ${personJson("o", "od")} AS owner,
         to_char(b.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(b.ends_on, 'YYYY-MM-DD') AS ends_on,
         date_part('year', b.starts_on)::int AS year, b.status, b.approved_at,
         COALESCE(t.allocated, 0)::numeric(18,2) AS allocated,
         COALESCE(t.committed, 0)::numeric(18,2) AS committed,
         COALESCE(t.spent, 0)::numeric(18,2) AS spent,
         (COALESCE(t.allocated, 0) - COALESCE(t.committed, 0) - COALESCE(t.spent, 0))::numeric(18,2) AS remaining,
         search_fold(b.number || ' ' || b.name || ' ' || COALESCE(bd.name, '')) AS haystack
    FROM budget b
    LEFT JOIN department bd ON bd.department_id = b.department_id
    LEFT JOIN employee o ON o.employee_id = COALESCE(bd.head_employee_id, b.owner_id)
    LEFT JOIN department od ON od.department_id = o.department_id
    LEFT JOIN LATERAL (
      SELECT sum(bl.amount) AS allocated, sum(bl.committed_amount) AS committed, sum(bl.spent_amount) AS spent
        FROM budget_line bl WHERE bl.budget_id = b.budget_id
    ) t ON true`;

const SORTS = { name: "v.name", allocated: "v.allocated", remaining: "v.remaining" };

/**
 * One page of budgets, within the caller's scope (a head sees their own department's: scope runs on
 * the budget's owner, the department's head).
 */
function list(db, query, scope) {
  const params = [query.year ?? null, query.department_id ?? null, query.q ?? null];
  const s = scopeClause(scope, { column: "v.owner_id" }, params);
  return pageQuery(
    db,
    `SELECT v.*, ${TOTAL_COL}
       FROM (${BUDGETS}) v
      WHERE ($1::int IS NULL OR v.year = $1::int)
        AND ($2::uuid IS NULL OR v.department_id = $2::uuid)
        AND ($3::text IS NULL OR v.haystack LIKE '%' || search_fold($3) || '%')
        ${s.and}
      ORDER BY ${orderBy(query, SORTS, "v.budget_id")}`,
    params,
    query,
  );
}

async function get(db, id) {
  const { rows } = await db.query(`SELECT v.* FROM (${BUDGETS}) v WHERE v.budget_id = $1`, [id]);
  return rows[0] || null;
}

/**
 * The lines of these budgets, by category name. A budget holds at most 25 (the contract's limit),
 * so the lines of one page of budgets are at most 625 rows, never a list a person pages.
 */
async function linesOf(db, budgetIds) {
  if (!budgetIds.length) return [];
  const { rows } = await db.query(
    `SELECT bl.budget_id, bl.budget_line_id, bl.expense_category_id, ec.name AS category,
            bl.amount, bl.committed_amount, bl.spent_amount,
            (bl.amount - bl.committed_amount - bl.spent_amount)::numeric(18,2) AS remaining
       FROM budget_line bl
       JOIN expense_category ec ON ec.expense_category_id = bl.expense_category_id
      WHERE bl.budget_id = ANY($1::uuid[])
      ORDER BY bl.budget_id, ec.name, bl.budget_line_id`,
    [budgetIds],
  );
  return rows;
}

async function lock(client, id) {
  const { rows } = await client.query("SELECT * FROM budget WHERE budget_id = $1 FOR UPDATE", [id]);
  return rows[0] || null;
}

/** The department's budget whose year holds `year`, if it has one. */
async function forDepartmentYear(db, departmentId, year) {
  const { rows } = await db.query(
    `SELECT budget_id FROM budget WHERE department_id = $1 AND date_part('year', starts_on)::int = $2 AND status <> 'closed' LIMIT 1`,
    [departmentId, year],
  );
  return rows[0] ? rows[0].budget_id : null;
}

/** A department a budget may be set for, with its head. */
async function department(db, id) {
  const { rows } = await db.query("SELECT department_id, name, head_employee_id, active FROM department WHERE department_id = $1", [id]);
  return rows[0] || null;
}

/** The categories among `ids` that exist, by id, with their names. */
async function categories(db, ids) {
  const { rows } = await db.query("SELECT expense_category_id, name FROM expense_category WHERE expense_category_id = ANY($1::uuid[])", [ids]);
  return rows;
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO budget (number, name, department_id, owner_id, currency, starts_on, ends_on, status, approved_by, approved_at)
     VALUES ($1, $2, $3, $4, 'NGN', $5, $6, 'approved', $7, now())
     RETURNING budget_id`,
    [row.number, row.name, row.department_id, row.owner_id, row.starts_on, row.ends_on, row.approved_by],
  );
  return rows[0].budget_id;
}

/** The lines as stored, locked, by category. */
/**
 * insert(), or null when the department already has an open budget for that year: two New Budget
 * saves at once meet the database's index (8020, audit F7), and the second is refused, not a 500.
 */
async function insertOnce(client, row) {
  await client.query("SAVEPOINT budget_insert");
  try {
    const id = await insert(client, row);
    await client.query("RELEASE SAVEPOINT budget_insert");
    return id;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT budget_insert");
    if (err.code === "23505" && err.constraint === "budget_one_per_department_year") return null;
    throw err;
  }
}

async function lockLines(client, budgetId) {
  const { rows } = await client.query(
    "SELECT budget_line_id, expense_category_id, amount FROM budget_line WHERE budget_id = $1 ORDER BY budget_line_id FOR UPDATE",
    [budgetId],
  );
  return rows;
}

async function insertLine(client, budgetId, categoryId, amount) {
  const { rows } = await client.query(
    "INSERT INTO budget_line (budget_id, expense_category_id, amount) VALUES ($1, $2, $3) RETURNING budget_line_id",
    [budgetId, categoryId, amount],
  );
  return rows[0].budget_line_id;
}

async function setLineAmount(client, lineId, amount) {
  await client.query("UPDATE budget_line SET amount = $2, updated_at = now() WHERE budget_line_id = $1", [lineId, amount]);
}

/** Take a line away; false when a request counts against it (it is set to nothing instead). */
/** The statuses of a request that counts against its line, or is being decided against it. */
const COUNTED = Object.freeze(["submitted", "approved", "in_requisition", "authorised", "disbursed"]);

/** Whether a counted request names this line (audit F16): only then is it kept at 0. */
async function lineCounted(client, lineId) {
  const { rows } = await client.query("SELECT 1 FROM expense_request WHERE budget_line_id = $1 AND status = ANY($2::text[]) LIMIT 1", [lineId, COUNTED]);
  return rows.length > 0;
}

/** Take a line away; the expenses service has let go of it first (expenses.service detachLineIn). */
async function deleteLine(client, lineId) {
  await client.query("DELETE FROM budget_line WHERE budget_line_id = $1", [lineId]);
}

async function touch(client, id) {
  await client.query("UPDATE budget SET updated_at = now() WHERE budget_id = $1", [id]);
}

/**
 * Committed and spent on each line, worked out again from the requests that name it, in the
 * caller's transaction. Answers each line as it now stands.
 * @param {import("pg").PoolClient} client
 * @param {string[]} lineIds
 */
async function recount(client, lineIds) {
  const ids = [...new Set(lineIds.filter(Boolean))].sort();
  if (!ids.length) return [];
  // The lines first, in one order, in a statement of their own (audit F6): under READ COMMITTED the
  // UPDATE below then reads every request a move committed before this one got the lock, so two
  // moves on one line never drop each other's amount, and two recounts never deadlock.
  await client.query("SELECT 1 FROM budget_line WHERE budget_line_id = ANY($1::uuid[]) ORDER BY budget_line_id FOR UPDATE", [ids]);
  const { rows } = await client.query(
    `UPDATE budget_line bl
        SET committed_amount = COALESCE((SELECT sum(er.amount) FROM expense_request er
                                          WHERE er.budget_line_id = bl.budget_line_id AND er.status = ANY($2::text[])), 0),
            spent_amount = COALESCE((SELECT sum(er.amount) FROM expense_request er
                                      WHERE er.budget_line_id = bl.budget_line_id AND er.status = ANY($3::text[])), 0),
            updated_at = now()
      WHERE bl.budget_line_id = ANY($1::uuid[])
      RETURNING bl.budget_line_id, bl.budget_id, bl.amount, bl.committed_amount, bl.spent_amount`,
    [ids, COMMITTED, SPENT],
  );
  return rows;
}

/** The lines of a budget, by id. */
async function lineIdsOf(db, budgetId) {
  const { rows } = await db.query("SELECT budget_line_id FROM budget_line WHERE budget_id = $1", [budgetId]);
  return rows.map((r) => r.budget_line_id);
}

/**
 * One page of Budget History: each line a save changed, from the audit ledger, newest first. A
 * save's changes travel in its event's metadata (`changes`: category, before, after).
 */
function history(db, budgetId, query) {
  return pageQuery(
    db,
    `SELECT a.occurred_at AS at, a.actor_name AS by, c.category, c.before::numeric(18,2) AS before,
            c.after::numeric(18,2) AS after, ${TOTAL_COL}
       FROM audit_ledger a
      CROSS JOIN LATERAL ROWS FROM (
              jsonb_to_recordset(COALESCE(a.metadata -> 'changes', '[]'::jsonb)) AS (category text, before text, after text)
            ) WITH ORDINALITY AS c(category, before, after, n)
      WHERE a.entity_type = 'budget' AND a.entity_id = $1 AND a.action IN ('budget.set', 'budget.changed')
      ORDER BY a.occurred_at DESC, a.event_id, c.n`,
    [budgetId],
    query,
  );
}

/** Each project with its budget, and its requests' committed and spent. */
const PROJECTS = `
  SELECT p.project_id, COALESCE(p.number, '') AS number, p.name, p.status, p.budget_amount,
         COALESCE(x.committed, 0)::numeric(18,2) AS committed,
         COALESCE(x.spent, 0)::numeric(18,2) AS spent,
         CASE WHEN p.budget_amount IS NULL THEN NULL
              ELSE (p.budget_amount - COALESCE(x.committed, 0) - COALESCE(x.spent, 0))::numeric(18,2) END AS remaining,
         COALESCE(x.requests, 0)::int AS requests,
         search_fold(COALESCE(p.number, '') || ' ' || p.name) AS haystack
    FROM project p
    LEFT JOIN LATERAL (
      SELECT sum(er.amount) FILTER (WHERE er.status = ANY($1::text[])) AS committed,
             sum(er.amount) FILTER (WHERE er.status = ANY($2::text[])) AS spent,
             count(*) FILTER (WHERE er.status <> 'draft') AS requests
        FROM expense_request er WHERE er.project_id = p.project_id
    ) x ON true`;

const PROJECT_SORTS = { name: "v.name", spent: "v.spent", remaining: "v.remaining" };

/** One page of projects as Expenses · Projects shows them: running ones, and any with spend. */
function projects(db, query) {
  const params = [COMMITTED, SPENT, query.q ?? null];
  return pageQuery(
    db,
    `SELECT v.project_id, v.number, v.name, v.budget_amount, v.committed, v.spent, v.remaining, v.requests, ${TOTAL_COL}
       FROM (${PROJECTS}) v
      WHERE (v.status = 'active' OR v.requests > 0 OR v.budget_amount IS NOT NULL)
        AND ($3::text IS NULL OR v.haystack LIKE '%' || search_fold($3) || '%')
      ORDER BY ${orderBy(query, PROJECT_SORTS, "v.project_id")}`,
    params,
    query,
  );
}

async function project(db, id) {
  const { rows } = await db.query(
    `SELECT v.project_id, v.number, v.name, v.budget_amount, v.committed, v.spent, v.remaining, v.requests
       FROM (${PROJECTS}) v WHERE v.project_id = $3`,
    [COMMITTED, SPENT, id],
  );
  return rows[0] || null;
}

/**
 * A year's budgets in figures for the assistant (docs/guides/praxis-ai.md §6.13, Finance: Budgets),
 * in one statement with the reader's scope (on the budget's owner, as list() applies it): the totals
 * over the budgets' lines, the lines by department and by category, what was paid by month (requests
 * disbursed against those lines), and, only when `projects` is true (a reader whose scope is all), the
 * projects with a budget. Groups cut to 20 rows, the months to the year's 12. Figures, never a row.
 * Every amount leaves as text: JSON would carry ₦1,050,000.50 as the number 1050000.5, which money()
 * refuses.
 */
async function aiSummary(db, q, scope) {
  const params = [COMMITTED, SPENT, q.year, q.department_id || null, q.projects === true];
  const s = scopeClause(scope, { column: "v.owner_id" }, params);
  const { rows } = await db.query(
    `WITH b AS (
       SELECT v.budget_id, v.department_id, v.department, v.allocated, v.committed, v.spent
         FROM (${BUDGETS}) v
        WHERE v.year = $3::int
          AND ($4::uuid IS NULL OR v.department_id = $4::uuid)
          ${s.and}
     ), l AS (
       SELECT bl.budget_line_id, bl.budget_id, bl.expense_category_id, ec.name AS category,
              bl.amount, bl.committed_amount, bl.spent_amount
         FROM budget_line bl
         JOIN b ON b.budget_id = bl.budget_id
         JOIN expense_category ec ON ec.expense_category_id = bl.expense_category_id
     ), figures AS (
       SELECT (SELECT count(*) FROM b)::int AS budgets,
              COALESCE(sum(amount), 0)::numeric(18,2)::text AS allocated,
              COALESCE(sum(committed_amount), 0)::numeric(18,2)::text AS committed,
              COALESCE(sum(spent_amount), 0)::numeric(18,2)::text AS spent,
              count(*) FILTER (WHERE committed_amount + spent_amount > amount)::int AS lines_over,
              count(*) FILTER (WHERE amount > 0 AND committed_amount + spent_amount >= amount * 0.8)::int AS lines_past_80
         FROM l
     ), by_department AS (
       SELECT COALESCE(b.department_id::text, 'none') AS key, COALESCE(min(b.department), 'No department') AS label,
              COALESCE(sum(b.allocated), 0)::numeric(18,2) AS allocated,
              COALESCE(sum(b.committed), 0)::numeric(18,2) AS committed,
              COALESCE(sum(b.spent), 0)::numeric(18,2) AS spent,
              row_number() OVER (ORDER BY sum(b.allocated) DESC NULLS LAST, min(b.department), b.department_id) AS rank
         FROM b GROUP BY b.department_id
     ), by_category AS (
       SELECT l.expense_category_id::text AS key, min(l.category) AS label,
              sum(l.amount)::numeric(18,2) AS allocated,
              sum(l.committed_amount)::numeric(18,2) AS committed,
              sum(l.spent_amount)::numeric(18,2) AS spent,
              row_number() OVER (ORDER BY sum(l.amount) DESC, min(l.category), l.expense_category_id) AS rank
         FROM l GROUP BY l.expense_category_id
     ), by_project AS (
       SELECT x.project_id::text AS key, TRIM(COALESCE(x.number, '') || ' ' || x.name) AS label,
              x.budget_amount AS allocated, x.committed, x.spent,
              row_number() OVER (ORDER BY x.budget_amount DESC, x.name, x.project_id) AS rank
         FROM (${PROJECTS}) x
        WHERE $5::boolean AND x.budget_amount IS NOT NULL
     ), paid AS (
       SELECT to_char(er.disbursed_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM') AS at, sum(er.amount)::numeric(18,2) AS value
         FROM expense_request er
         JOIN l ON l.budget_line_id = er.budget_line_id
        WHERE er.status = ANY($2::text[]) AND er.disbursed_at IS NOT NULL
          AND date_part('year', er.disbursed_at AT TIME ZONE 'Africa/Lagos')::int = $3::int
        GROUP BY 1
     )
     SELECT (SELECT row_to_json(f) FROM figures f) AS figures,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'allocated', allocated::text, 'committed', committed::text, 'spent', spent::text) ORDER BY rank)
               FROM by_department WHERE rank <= 20) AS by_department,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'allocated', allocated::text, 'committed', committed::text, 'spent', spent::text) ORDER BY rank)
               FROM by_category WHERE rank <= 20) AS by_category,
            (SELECT json_agg(json_build_object('key', key, 'label', label, 'allocated', allocated::text, 'committed', committed::text, 'spent', spent::text) ORDER BY rank)
               FROM by_project WHERE rank <= 20) AS by_project,
            (SELECT json_agg(json_build_object('at', at, 'value', value::text) ORDER BY at) FROM paid) AS paid`,
    params,
  );
  const row = rows[0] || {};
  return {
    figures: row.figures || {},
    by_department: row.by_department || [],
    by_category: row.by_category || [],
    by_project: row.by_project || [],
    paid: row.paid || [],
  };
}

/**
 * The lines past `percent` used (committed and spent over allocated) on budgets running on a
 * Lagos date, not yet warned about: a batch of at most `size` after the line `after`, by id.
 * A line is warned once, ever, and a line belongs to one year, so once per line per year.
 */
async function linesPast(db, { today, percent, after = null, size, warnedKey }) {
  const { rows } = await db.query(
    `SELECT bl.budget_line_id, bl.budget_id, b.number, b.name, b.department_id, bd.name AS department,
            bd.head_employee_id, ec.name AS category, bl.amount, bl.committed_amount, bl.spent_amount,
            round(100 * (bl.committed_amount + bl.spent_amount) / bl.amount)::int AS used
       FROM budget_line bl
       JOIN budget b ON b.budget_id = bl.budget_id
       JOIN expense_category ec ON ec.expense_category_id = bl.expense_category_id
       LEFT JOIN department bd ON bd.department_id = b.department_id
      WHERE b.status = 'approved' AND b.starts_on <= $1::date AND b.ends_on >= $1::date
        AND bl.amount > 0
        AND (bl.committed_amount + bl.spent_amount) >= bl.amount * $2::numeric / 100
        AND ($3::uuid IS NULL OR bl.budget_line_id > $3::uuid)
        AND NOT EXISTS (SELECT 1 FROM event_log ev
                         WHERE ev.event_key = $5 AND ev.entity_type = 'budget' AND ev.entity_id = b.budget_id::text
                           AND ev.payload ->> 'budget_line_id' = bl.budget_line_id::text)
      ORDER BY bl.budget_line_id
      LIMIT $4 -- pagination:batch the lines one step of the budget-threshold sweep reads`,
    [today, percent, after, size, warnedKey],
  );
  return rows;
}

/** The logins of the people a budget warning goes to: the department's head and Operations & People. */
async function warnedUsers(db, headEmployeeId) {
  const { rows } = await db.query(
    `SELECT DISTINCT u.user_id
       FROM app_user u
      WHERE u.status = 'active'
        AND (u.employee_id = $1::uuid
             OR EXISTS (SELECT 1 FROM user_role ur JOIN role r ON r.role_id = ur.role_id
                         WHERE ur.user_id = u.user_id AND r.code = 'operations_people'))
      ORDER BY u.user_id`,
    [headEmployeeId || null],
  );
  return rows.map((r) => r.user_id);
}

/** The login of an employee, if they have one. */
async function userOf(db, employeeId) {
  if (!employeeId) return null;
  const { rows } = await db.query("SELECT user_id FROM app_user WHERE employee_id = $1 AND status = 'active' LIMIT 1", [employeeId]);
  return rows[0] ? rows[0].user_id : null;
}

/** The budgets a card may name: number and name of each in reach, for its question's options. */
async function names(db) {
  const { rows } = await db.query(
    `SELECT b.budget_id AS value, b.number || ' ' || b.name AS label
       FROM budget b
      WHERE b.status <> 'closed'
      ORDER BY b.starts_on DESC, b.name, b.budget_id
      LIMIT 25 -- pagination:batch the first 25 a card's question offers`,
  );
  return rows;
}

/** A budget a card names by its number or name ("Programmes 2026"). */
async function idOf(db, value) {
  const { rows } = await db.query(
    `SELECT budget_id FROM budget
      WHERE lower(number) = lower($1) OR search_fold(name) = search_fold($1)
      ORDER BY starts_on DESC, budget_id
      LIMIT 1`,
    [String(value || "")],
  );
  return rows[0] ? rows[0].budget_id : null;
}

module.exports = {
  COMMITTED,
  SPENT,
  list,
  get,
  linesOf,
  lock,
  forDepartmentYear,
  department,
  categories,
  insert,
  insertOnce,
  lockLines,
  insertLine,
  setLineAmount,
  COUNTED,
  lineCounted,
  deleteLine,
  touch,
  recount,
  lineIdsOf,
  history,
  projects,
  project,
  aiSummary,
  linesPast,
  warnedUsers,
  userOf,
  names,
  idOf,
};
