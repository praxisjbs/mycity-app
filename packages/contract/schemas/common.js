"use strict";
/**
 * Shared wire primitives. Every module schema builds on these, so a phone
 * number, a date or a page of results means the same thing on every route
 * and on both sides of the wire (BACKEND_STRUCTURE §6).
 *
 * Field names are snake_case. The generator refuses anything else.
 */
const { z } = require("zod");

/* ------------------------------------------------------------------ *
 * Identifiers and text
 * ------------------------------------------------------------------ */

const uuid = z.string().uuid();

/** Trimmed, non-empty, bounded. Use for names, titles, labels. */
const text = (max = 200) => z.string().trim().min(1).max(max);

/** Optional free text: empty string becomes undefined. */
const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/* ------------------------------------------------------------------ *
 * Email and phone
 * ------------------------------------------------------------------ */

/** Lower-cased and trimmed, so `Ada@MyCity.io` and `ada@mycity.io` are one user. */
const email = z.string().trim().toLowerCase().max(254).email();

/**
 * Phone numbers normalised to E.164. Nigerian numbers in any local form become +234XXXXXXXXXX:
 * 0803 123 4567, 08031234567, 2348031234567, +234 803 123 4567. A number already written in
 * international form (+41 77 953 9483, +44 7884 050144) is kept, since some staff are abroad.
 * Anything else is refused rather than guessed.
 */
const phone = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const digits = v.replace(/[\s\-().]/g, "");
    let national;
    if (/^\+234\d{10}$/.test(digits)) national = digits.slice(4);
    else if (/^234\d{10}$/.test(digits)) national = digits.slice(3);
    else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
    else if (/^\+(?!234)[1-9]\d{7,14}$/.test(digits)) return digits;
    else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must be a phone number",
      });
      return z.NEVER;
    }
    return `+234${national}`;
  });

/* ------------------------------------------------------------------ *
 * Dates and money
 * ------------------------------------------------------------------ */

/**
 * ISO calendar date, YYYY-MM-DD, round-trip checked so 2026-02-30 is refused
 * instead of silently becoming 2 March. Day-first is for people; the wire is ISO.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date as YYYY-MM-DD")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "is not a real calendar date");

/**
 * An instant on the wire: ISO 8601 with its offset, as a timestamptz column
 * leaves the API ("2026-10-16T09:30:00.000Z").
 */
const isoDateTime = z.string().datetime({ offset: true });

/**
 * Money is a decimal STRING with exactly two places (gate 20). Never a JS
 * number on the wire. numeric(18,2) holds 16 integer digits.
 */
const money = z
  .string()
  .regex(/^-?\d{1,16}\.\d{2}$/, "must be an amount like 1250000.00");

/**
 * An optional typed value a form may send as an empty cell.
 *
 * `optionalText()` already treats "" as "not given". A typed optional (a date, an
 * amount, an email, a phone number) is in the same position on a screen: a field the
 * person left alone sends "", not nothing, because a form holds every one of its fields.
 * This says the same thing for those: "" and null mean the field was left alone, and
 * anything else is held to the type's own rules.
 *
 * So one Zod schema checks a form as it is filled (useContractForm) and the request it
 * sends, and no screen strips its empty fields before it saves.
 *
 *   date_of_birth: blank(isoDate),      // "" → undefined, "2026-13-01" → a 422
 *
 * @param {z.ZodTypeAny} schema  the type the value has when it is given
 */
const blank = (schema) =>
  schema
    .or(z.literal(""))
    .nullish()
    .transform((v) => (v === "" || v === null ? undefined : v));

/* ------------------------------------------------------------------ *
 * Pagination: the one rule for every list in the system
 * ------------------------------------------------------------------ *
 *
 * 25 rows per page. Fixed. Not a default, not a maximum the client may go
 * below or above: the client cannot choose a page size at all. Every list
 * endpoint, every AI read and every frontend table pages at 25
 * (internal meeting 12 October 2026, BACKEND_STRUCTURE §16).
 *
 * The client sends `page` (1-based). There is no `limit`, `offset`,
 * `per_page` or `page_size` anywhere in the contract; scripts/check/pagination.js
 * fails the build if one appears outside this file.
 */
const PAGE_SIZE = 25;

/** Page number, 1-based. Bounded so `?page=999999999` cannot ask Postgres to skip billions of rows. */
const page = z.coerce.number().int().min(1).max(100000).default(1);

/** Free-text search inside a list. */
const q = z.string().trim().min(1).max(200).optional();

/** The controls every list endpoint accepts. */
const LIST_CONTROLS = { page, q };

/** Names a list's own filters may not take, because a control already has them. */
const RESERVED_CONTROLS = [...Object.keys(LIST_CONTROLS), "sort"];

/**
 * A list's sort control (FRONTEND_FOUNDATION F20, decided with TB 16/10/2026).
 *
 * ONE key. The value is a field name, with a leading `-` for descending:
 * `?sort=display_name`, `?sort=-created_at`. The list declares the fields a
 * caller may sort by, so a typo, a renamed field or a column nobody indexed is
 * a 422 naming `sort`, exactly like an unknown filter, instead of an ORDER BY
 * nobody meant. The value parses to `{ field, dir }` for the repo; the wire
 * type stays the string the frontend sends.
 *
 * Sorting is not optional decoration: a list the server does not sort comes
 * back in whatever order the query planner chose, and the page the person
 * reads is then sorted inside its own 25 rows (FRONTEND_GUIDE §4). A list with
 * no `sortable` has no `sort` key at all, and `.strict()` refuses one.
 *
 * @param {string[]} sortable field names, snake_case, in the list's own order
 */
function sortParam(sortable) {
  if (!Array.isArray(sortable) || sortable.length === 0) {
    throw new Error("sortParam: name at least one sortable field");
  }
  for (const f of sortable) {
    if (!/^[a-z][a-z0-9_]*$/.test(f)) {
      throw new Error(`sortParam: "${f}" is not a snake_case field name`);
    }
  }
  if (new Set(sortable).size !== sortable.length) {
    throw new Error("sortParam: the same field is listed twice");
  }
  const values = sortable.flatMap((f) => [f, `-${f}`]);
  return z
    .enum(values)
    .transform((v) =>
      v.startsWith("-")
        ? { field: v.slice(1), dir: "desc" }
        : { field: v, dir: "asc" },
    )
    .optional();
}

/**
 * A list endpoint's query schema: the standard controls, this list's sortable
 * fields, its own filters, and NOTHING else. `.strict()` turns an unknown key
 * (a typo, or a client trying `?limit=500`) into a 422 that names the key,
 * instead of a filter that silently does nothing.
 *
 *   listQuery({ status: EmployeeStatus }, ["display_name", "created_at"])
 *
 * The repo turns the parsed `sort` into an ORDER BY with `orderBy()` from
 * shared/http/paged.js, which builds the SQL from its own allow-list, so
 * nothing a caller typed reaches the query.
 *
 * @template {Record<string, z.ZodTypeAny>} [F={}]
 * @param {F} [filters]  typed per list, so the generated contract carries each list's own filters
 * @param {string[]} [sortable]  fields this list may be sorted by; the first is its default order
 */
function listQuery(filters = /** @type {F} */ ({}), sortable = []) {
  for (const key of Object.keys(filters)) {
    if (RESERVED_CONTROLS.includes(key)) {
      throw new Error(
        `listQuery: "${key}" is a standard list control and cannot be redefined`,
      );
    }
  }
  const controls = { ...LIST_CONTROLS };
  if (sortable.length > 0) controls.sort = sortParam(sortable);
  return z.object({ ...controls, ...filters }).strict();
}

/** Default list query for a list with no filters and no sort of its own. */
const PageQuery = listQuery();

/** Page metadata returned with every list. */
const PageMeta = z
  .object({
    number: z.number().int().min(1),
    size: z.literal(PAGE_SIZE),
    total: z.number().int().min(0),
    pages: z.number().int().min(0),
    has_next: z.boolean(),
  })
  .strict();

/**
 * Response shape of every list endpoint: `{ data: [...], page: {...} }`.
 * `data` can never hold more than PAGE_SIZE items.
 *
 * @param {z.ZodTypeAny} item schema of one row
 */
function Paged(item) {
  return z
    .object({
      data: z.array(item).max(PAGE_SIZE),
      page: PageMeta,
    })
    .strict();
}

/* ------------------------------------------------------------------ *
 * Bodies with nothing in them
 * ------------------------------------------------------------------ */

/**
 * The body of a write that carries no data: `POST /expenses/:id/submit`. Every
 * write route declares a body (http/route.js); this is the one to declare when
 * the URL says it all. `.strict()`, so a stray field is refused, not ignored.
 */
const EmptyBody = z.object({}).strict();

/** Path of a route addressed by one id: `/:id`. */
const IdParams = z.object({ id: uuid }).strict();

/** Gate 6 (check/contract-columns.js): the shared wire shapes are not rows of any table. */
const TABLES = {
  PageQuery: { table: null, reason: "list controls on every list endpoint: page, q, sort" },
  PageMeta: { table: null, reason: "the page block of every paged response" },
  EmptyBody: { table: null, reason: "a request with no body" },
  IdParams: { table: null, reason: "the :id path parameter" },
};

module.exports = {
  TABLES,
  uuid,
  text,
  optionalText,
  email,
  phone,
  isoDate,
  isoDateTime,
  money,
  blank,
  PAGE_SIZE,
  LIST_CONTROLS,
  RESERVED_CONTROLS,
  sortParam,
  listQuery,
  PageQuery,
  PageMeta,
  Paged,
  EmptyBody,
  IdParams,
};
