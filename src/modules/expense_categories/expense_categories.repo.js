"use strict";
/**
 * Expense categories: the SQL. Reads the categories with this month's spend and how many requests
 * name each; writes only expense_category. Never emits (BACKEND_GUIDE §2).
 *
 * This month's spend is the requests in the category paid this month in Lagos (`disbursed`, by
 * `disbursed_at`); the request count leaves drafts out, as nobody but their author has seen them.
 */
const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");

const COLUMNS = "expense_category_id, code, name, type, description, active, created_at";

const ROWS = `
  SELECT c.expense_category_id, c.name, c.type, c.description, c.active, c.created_at,
         COALESCE((SELECT sum(er.amount) FROM expense_request er
                    WHERE er.expense_category_id = c.expense_category_id AND er.status = 'disbursed'
                      AND (er.disbursed_at AT TIME ZONE 'Africa/Lagos')::date >= $1::date
                      AND (er.disbursed_at AT TIME ZONE 'Africa/Lagos')::date < ($1::date + interval '1 month')), 0)::numeric(18,2) AS spent_this_month,
         (SELECT count(*)::int FROM expense_request er
           WHERE er.expense_category_id = c.expense_category_id AND er.status <> 'draft') AS requests,
         search_fold(c.name || ' ' || COALESCE(c.description, '')) AS haystack
    FROM expense_category c`;

const OUT = "v.expense_category_id, v.name, v.type, v.description, v.active, v.spent_this_month, v.requests, v.created_at";

/** The SQL for each field ExpenseCategoryListQuery allow-lists; the first is the default. */
const SORTS = { name: "lower(v.name)", spent_this_month: "v.spent_this_month", created_at: "v.created_at" };

/**
 * One page of categories.
 * @param {{query: Function}} db
 * @param {{active?: boolean, type?: string, q?: string, page?: number, sort?: object}} query
 * @param {string} monthStart  the first day of this month in Lagos, YYYY-MM-DD
 */
function list(db, query, monthStart) {
  const params = [monthStart, query.active === undefined ? null : query.active, query.type || null, query.q || null];
  return pageQuery(
    db,
    `SELECT ${OUT}, ${TOTAL_COL}
       FROM (${ROWS}) v
      WHERE ($2::boolean IS NULL OR v.active = $2)
        AND ($3::text IS NULL OR v.type = $3)
        AND ($4::text IS NULL OR v.haystack LIKE '%' || search_fold($4) || '%')
      ORDER BY ${orderBy(query, SORTS, "v.expense_category_id")}`,
    params,
    query,
  );
}

/** One category as the list shows it, or null. */
async function get(db, id, monthStart) {
  const { rows } = await db.query(`SELECT ${OUT} FROM (${ROWS}) v WHERE v.expense_category_id = $2`, [monthStart, id]);
  return rows[0] || null;
}

/** The stored row, with its code, or null. */
async function getRow(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM expense_category WHERE expense_category_id = $1`, [id]);
  return rows[0] || null;
}

/** The category another one would clash with: the same code, or the same name in any case. */
async function clash(db, code, name, exceptId = null) {
  const { rows } = await db.query(
    `SELECT expense_category_id FROM expense_category
      WHERE (code = $1 OR lower(name) = lower($2)) AND ($3::uuid IS NULL OR expense_category_id <> $3)
      LIMIT 1`,
    [code, name, exceptId],
  );
  return rows[0] || null;
}

async function count(db) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM expense_category");
  return rows[0].n;
}

/** Hold the categories still while the suggested ones go in, so two presses add them once. */
async function lockTable(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('expense_category.suggested'))");
}

async function insert(client, row) {
  const { rows } = await client.query(
    `INSERT INTO expense_category (code, name, type, description)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [row.code, row.name, row.type, row.description || null],
  );
  return rows[0];
}

/** Change what the patch names; the rest stays. */
async function update(client, id, patch) {
  const { rows } = await client.query(
    `UPDATE expense_category
        SET code = COALESCE($2, code),
            name = COALESCE($3, name),
            type = COALESCE($4, type),
            description = CASE WHEN $5::boolean THEN $6 ELSE description END,
            active = COALESCE($7, active),
            updated_at = now()
      WHERE expense_category_id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      patch.code || null,
      patch.name || null,
      patch.type || null,
      Object.prototype.hasOwnProperty.call(patch, "description"),
      patch.description || null,
      patch.active === undefined ? null : patch.active,
    ],
  );
  return rows[0] || null;
}

/** Whether a category is offered on a new request. */
async function isActive(db, id) {
  const { rows } = await db.query("SELECT active FROM expense_category WHERE expense_category_id = $1", [id]);
  return rows[0] ? rows[0].active === true : null;
}

module.exports = { list, get, getRow, clash, count, lockTable, insert, update, isActive };
