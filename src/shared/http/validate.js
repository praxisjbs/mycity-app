"use strict";
/**
 * Request validation against the contract. http/route.js builds this middleware
 * from a route's contract; modules do not call it directly.
 *
 *   req.validated = { body, query, params }     parsed, coerced, unknown keys refused
 *
 * Parsed values go on req.validated, never back onto req.body / req.query:
 * Express 5 makes req.query read-only, and a controller that reads req.body
 * could read the raw, unvalidated input by mistake. One place to read from.
 *
 * All three parts are checked before answering, so a form gets every problem
 * at once (gate 12: inline validation shows every field, not the first).
 *
 * Schemas come only from packages/contract (http/route.js enforces it). There is
 * no limit/offset query helper: lists use common.listQuery, 25 per page (§16).
 */
const { AppError } = require("../errors");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ZodError → { "work_email": ["is already in use"], "lines.0.amount": [...] }
 * An unknown key (`.strict()`) is reported against the key itself, so the form or
 * the caller sees `query.limit: is not allowed` rather than a message about the object.
 */
function fieldsOf(zodError, prefix = "") {
  const acc = {};
  const add = (key, msg) => (acc[key || "_"] = acc[key || "_"] || []).push(msg);
  for (const i of zodError.issues) {
    const at = i.path.join(".");
    if (i.code === "unrecognized_keys") {
      for (const k of i.keys) add(`${prefix}${at ? `${at}.` : ""}${k}`, "is not allowed");
    } else {
      add(`${prefix}${at}`, i.message);
    }
  }
  return acc;
}

/**
 * @param {{body?: import("zod").ZodTypeAny, query?: import("zod").ZodTypeAny, params?: import("zod").ZodTypeAny}} parts
 */
function validator(parts) {
  return function validateRequest(req, _res, next) {
    const out = {};
    let fields = null;
    for (const where of ["params", "query", "body"]) {
      const schema = parts[where];
      if (!schema) {
        // No params schema: the path's own params, already UUID-checked by route().
        out[where] = where === "body" ? undefined : where === "params" ? { ...req.params } : {};
        continue;
      }
      // A multipart request's text fields arrive in req.body as strings: the schema coerces.
      const parsed = schema.safeParse(req[where] === undefined && where === "body" ? {} : req[where]);
      if (parsed.success) out[where] = parsed.data;
      else fields = { ...(fields || {}), ...fieldsOf(parsed.error, where === "body" ? "" : `${where}.`) };
    }
    if (fields) return next(new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, fields));
    req.validated = out;
    return next();
  };
}

/**
 * Path parameters that name a row (`:id`, `:employee_id`) must be UUIDs. A
 * malformed id is answered 404, the same as an id that does not exist, and
 * never reaches Postgres (where it would be a 22P02).
 * @param {string[]} names
 */
function uuidParams(names) {
  return function uuidParamGuard(req, _res, next) {
    for (const n of names) {
      const v = req.params[n];
      if (v !== undefined && !UUID_RE.test(v)) return next(new AppError("NOT_FOUND", "Not found", 404));
    }
    return next();
  };
}

/** Parameter names in an Express path that name a row: ":id" and ":something_id". */
function idParamNames(path) {
  return [...String(path).matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)]
    .map((m) => m[1])
    .filter((n) => n === "id" || n.endsWith("_id"));
}

module.exports = { validator, uuidParams, idParamNames, fieldsOf, UUID_RE };
