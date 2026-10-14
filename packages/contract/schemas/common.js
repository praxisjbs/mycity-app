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
const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email();

/**
 * Nigerian numbers normalised to E.164 (+234XXXXXXXXXX).
 * Accepts 0803 123 4567, 08031234567, 2348031234567, +234 803 123 4567.
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
    else {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be a Nigerian phone number" });
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
 * Money is a decimal STRING with exactly two places (gate 20). Never a JS
 * number on the wire. numeric(18,2) holds 16 integer digits.
 */
const money = z.string().regex(/^-?\d{1,16}\.\d{2}$/, "must be an amount like 1250000.00");

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

/**
 * A list endpoint's query schema: the standard controls plus this list's own
 * filters, and NOTHING else. `.strict()` turns an unknown key (a typo, or a
 * client trying `?limit=500`) into a 422 that names the key, instead of a
 * filter that silently does nothing.
 *
 * @param {Record<string, z.ZodTypeAny>} [filters]
 */
function listQuery(filters = {}) {
  for (const key of Object.keys(filters)) {
    if (key in LIST_CONTROLS) {
      throw new Error(`listQuery: "${key}" is a standard list control and cannot be redefined`);
    }
  }
  return z.object({ ...LIST_CONTROLS, ...filters }).strict();
}

/** Default list query for a list with no filters of its own. */
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

module.exports = {
  uuid,
  text,
  optionalText,
  email,
  phone,
  isoDate,
  money,
  PAGE_SIZE,
  LIST_CONTROLS,
  listQuery,
  PageQuery,
  PageMeta,
  Paged,
  EmptyBody,
  IdParams,
};
