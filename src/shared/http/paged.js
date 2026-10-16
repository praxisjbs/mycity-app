"use strict";
/**
 * THE pagination gate. Every list in MyCity pages through this file.
 *
 * Rule (internal meeting, 12 October 2026): 25 rows per page, server side,
 * across the whole system. The API never sends more than 25 rows of a list,
 * the frontend never shows more than 25, and the AI assistant reads in
 * batches of 25. A list that loads a whole table can take the server down
 * once the table is large; this file is why that cannot happen.
 *
 * The page size is NOT a client choice. The contract (packages/contract/
 * schemas/common.js) has no limit/offset/per_page/page_size key, and
 * scripts/check/pagination.js fails the build if one appears, or if a repo
 * writes its own LIMIT/OFFSET instead of calling pageQuery().
 *
 * Usage, repo:
 *
 *   const { pageQuery, orderBy, TOTAL_COL } = require("../../shared/http/paged");
 *
 *   // The fields the contract's listQuery allow-lists, and the SQL for each.
 *   const SORTS = {
 *     display_name: "e.last_name, e.first_name",
 *     department: "d.name",
 *     created_at: "e.created_at",
 *   };
 *
 *   function list(client, query, scope) {
 *     return pageQuery(client,
 *       `SELECT e.employee_id, e.staff_number, e.first_name, e.last_name, ${TOTAL_COL}
 *          FROM employee e
 *         WHERE ($1::text IS NULL OR search_fold(e.first_name || ' ' || e.last_name) LIKE '%' || search_fold($1) || '%')
 *         ORDER BY ${orderBy(query, SORTS, "e.employee_id")}`,
 *       [query.q ?? null],
 *       query);
 *   }
 *
 * Usage, controller:
 *
 *   list: async (req, res) => sendPaged(res, await service.list(req.validated.query, req.scope)),
 *
 * Response body, every list endpoint:
 *
 *   { "data": [ ...at most 25 rows ],
 *     "page": { "number": 2, "size": 25, "total": 312, "pages": 13, "has_next": true } }
 *
 * The total comes from COUNT(*) OVER() in the same query: one round trip, one
 * WHERE clause, so the count and the rows can never disagree. There is no
 * other paging helper anywhere, and no client-chosen page size.
 */
const { AppError } = require("../errors");
const { PAGE_SIZE } = require("../../../packages/contract/schemas/common");

/** Add to the SELECT list of every paged query. */
const TOTAL_COL = "COUNT(*) OVER() AS _total";

/** Rows a "complete set" query may return before it fails loudly. */
const COMPLETE_CEILING = 5000;

const HAS_TOTAL = /\b_total\b/;
const HAS_ORDER = /\border\s+by\b/i;
const HAS_LIMIT = /\b(limit|offset|fetch\s+first)\b/i;

/**
 * Page number and SQL offset from a validated list query.
 * Defensive on raw input too: anything that is not a positive integer is page 1.
 *
 * @param {{page?: number|string}} [query]
 * @returns {{number: number, size: number, offset: number}}
 */
function pageOf(query = {}) {
  const n = Number.parseInt(query.page, 10);
  const number = Number.isInteger(n) && n >= 1 ? Math.min(n, 100000) : 1;
  return { number, size: PAGE_SIZE, offset: (number - 1) * PAGE_SIZE };
}

/**
 * The ORDER BY of a paged list, for the `sort` the contract parsed
 * (FRONTEND_FOUNDATION F20, common.js `sortParam`).
 *
 * The caller chooses a KEY; every character of SQL comes from `columns`, which
 * the repo wrote, so nothing a caller typed reaches the query. An unknown key
 * cannot arrive (listQuery refuses it with a 422) and falls back to the list's
 * default order rather than throwing, so a list still answers if a contract and
 * a repo drift apart.
 *
 * `tiebreak` is the unique column the order finishes on. pageQuery refuses a
 * query without a unique ORDER BY for a reason: two rows that tie on the sorted
 * column would otherwise swap places between page 1 and page 2, and a row would
 * repeat while another was never seen.
 *
 * @param {{sort?: {field: string, dir: "asc"|"desc"}}} query  the validated list query
 * @param {Record<string, string>} columns  sortable key → its SQL; the first is the default order
 * @param {string} tiebreak  a unique column, usually the primary key
 * @returns {string} SQL for the ORDER BY clause, without the keyword
 */
function orderBy(query, columns, tiebreak) {
  const keys = Object.keys(columns || {});
  if (keys.length === 0) {
    throw new Error("orderBy: the list declares no sortable columns");
  }
  if (!tiebreak) {
    throw new Error("orderBy: name the unique column the order finishes on");
  }
  const asked = query && query.sort;
  const key = asked && columns[asked.field] ? asked.field : keys[0];
  const descending = Boolean(asked && columns[asked.field] && asked.dir === "desc");
  // Ascending already puts NULLs last in Postgres; descending needs telling,
  // or a list sorted newest first opens on the rows with no date at all.
  const direction = descending ? " DESC NULLS LAST" : "";
  const expression = columns[key]
    .split(",")
    .map((column) => `${column.trim()}${direction}`)
    .join(", ");
  return `${expression}, ${tiebreak}`;
}

/**
 * Build the page envelope.
 *
 * @param {Array<object>} data
 * @param {number} number
 * @param {number} total
 */
function envelope(data, number, total) {
  const pages = Math.ceil(total / PAGE_SIZE);
  return {
    data,
    page: { number, size: PAGE_SIZE, total, pages, has_next: number < pages },
  };
}

/**
 * Run one page of a list query.
 *
 * The SQL must:
 *  - include TOTAL_COL in its SELECT list,
 *  - end with an ORDER BY that is unique (finish on the primary key), or rows
 *    can repeat or vanish between pages,
 *  - carry no LIMIT, OFFSET or FETCH FIRST: this function appends them.
 * A query that breaks any of these throws at once, in development, on the
 * first call, rather than paging wrongly in production.
 *
 * @param {{query: Function}} client  pg client or pool
 * @param {string} sql
 * @param {Array} params
 * @param {{page?: number}} query     the validated list query
 * @returns {Promise<{data: Array<object>, page: object}>}
 */
async function pageQuery(client, sql, params = [], query = {}) {
  if (!HAS_TOTAL.test(sql)) {
    throw new Error("pageQuery: the SELECT list must include TOTAL_COL");
  }
  if (!HAS_ORDER.test(sql)) {
    throw new Error("pageQuery: a paged query must end with a unique ORDER BY");
  }
  if (HAS_LIMIT.test(sql)) {
    throw new Error(
      "pageQuery: do not write LIMIT/OFFSET yourself; pageQuery appends them",
    );
  }

  const { number, offset } = pageOf(query);
  const n = params.length;
  const { rows } = await client.query(
    `${sql}\nLIMIT $${n + 1} OFFSET $${n + 2}`,
    [...params, PAGE_SIZE, offset],
  );

  let total;
  if (rows.length > 0) {
    total = Number(rows[0]._total) || 0;
  } else if (number > 1) {
    // Past the last page: the window function has no row to report on, but the
    // client still needs the real total to jump back.
    const { rows: c } = await client.query(
      `SELECT COUNT(*)::int AS n FROM (${sql}) AS _counted`,
      params,
    );
    total = c[0] ? c[0].n : 0;
  } else {
    total = 0;
  }

  const data = rows.map(({ _total, ...row }) => row);
  return envelope(data, number, total);
}

/**
 * Send a page. The body is the envelope as is; there is no X-Total-Count
 * header to remember to expose through CORS.
 *
 * @param {import("express").Response} res
 * @param {{data: Array<object>, page: object}} result
 */
function sendPaged(res, result) {
  assertPage(result, "response");
  return res.json(result);
}

/**
 * Refuse a "page" that is not one. Used by sendPaged, and by the AI layer
 * (shared/ai/authorise.js) on every manifest read before rows reach the model.
 *
 * @param {{data?: Array<object>}} result
 * @param {string} label  what produced it, for the error
 */
function assertPage(result, label) {
  if (!result || !Array.isArray(result.data) || !result.page) {
    throw new Error(
      `${label}: expected a page envelope { data, page } from pageQuery()`,
    );
  }
  if (result.data.length > PAGE_SIZE) {
    throw new Error(
      `${label}: ${result.data.length} rows in one page; the limit is ${PAGE_SIZE}`,
    );
  }
  return result;
}

/**
 * The one exception: a set the caller MUST have whole, because acting on part
 * of it would be wrong. The permissions matrix is the example: loaded through a
 * paged endpoint, an editor would see part of it and save over grants they
 * could not see.
 *
 * This is never a list a person scrolls through. It is never sent to a table
 * on screen and never handed to the AI. Every call site carries a marker on
 * the line above, which scripts/check/pagination.js requires:
 *
 *   // pagination:complete <why this set must be whole>
 *   const { rows } = await completeQuery(client, sql, params, { label: "permission matrix" });
 *
 * Asks for ceiling + 1 rows. If they all come back, the assumption that the
 * set is small no longer holds and the call fails loudly; a truncated set is
 * never returned as if it were complete.
 *
 * @param {{query: Function}} client
 * @param {string} sql     no LIMIT
 * @param {Array} params
 * @param {{label: string, ceiling?: number}} opts
 * @returns {Promise<{rows: Array<object>}>}
 */
async function completeQuery(client, sql, params = [], opts = {}) {
  if (HAS_LIMIT.test(sql)) {
    throw new Error("completeQuery: do not write LIMIT yourself");
  }
  const ceiling = opts.ceiling || COMPLETE_CEILING;
  const { rows } = await client.query(`${sql}\nLIMIT ${ceiling + 1}`, params);
  if (rows.length > ceiling) {
    throw new AppError(
      "RESULT_SET_TOO_LARGE",
      `${opts.label || "This set"} has more than ${ceiling} rows and cannot be loaded whole.`,
      500,
    );
  }
  return { rows };
}

module.exports = {
  PAGE_SIZE,
  TOTAL_COL,
  COMPLETE_CEILING,
  pageOf,
  orderBy,
  envelope,
  pageQuery,
  sendPaged,
  assertPage,
  completeQuery,
};
