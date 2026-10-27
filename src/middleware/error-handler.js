"use strict";
/**
 * The last stop. Every error becomes one shape, and nothing internal leaks:
 *
 *   { "error": { "code": "VALIDATION_FAILED", "message": "Check the highlighted fields",
 *                "fields": { "work_email": ["is already in use"] } },
 *     "request_id": "..." }
 *
 *   AppError            its code, message, status and fields, as thrown
 *   ZodError            422 VALIDATION_FAILED with per-field messages
 *   Postgres error      mapped by SQLSTATE (unique violation 409, bad reference 409, ...);
 *                       the SQL, the constraint text and the row values never leave the server
 *   body parser         413 PAYLOAD_TOO_LARGE / 400 BAD_JSON
 *   anything else       500 INTERNAL_ERROR, with the request id as a reference to quote
 *
 * 5xx are reported (observability/error-reporter.js: stored, and posted to the
 * alert channel), at the severity an AppError gives itself, `error` unless it says
 * otherwise (an outside service not answering is a `warning`, shared/errors.js). 4xx are
 * logged at warn; validation failures are recorded at
 * `notice`, grouped by the rule that refused them (the error's code), its field names and
 * the route as declared, so a form that keeps failing shows up as one rising count per
 * rule rather than noise. A refusal that says it is not a fault (`err.recorded = false`, a
 * password found in a breach) is answered the same and never recorded.
 *
 * Messages are written without dashes (README §7 rule 11: copy a person reads).
 */
const { ZodError } = require("zod");
const { logger } = require("../config/logger");
const { AppError } = require("../shared/errors");
const { report } = require("../shared/observability/error-reporter");
const { fieldsOf } = require("../shared/http/validate");

/** SQLSTATE → [status, code, message]. */
const PG = {
  23505: [409, "ALREADY_EXISTS", "A record with these details already exists"],
  23503: [
    409,
    "REFERENCE_INVALID",
    "This refers to a record that does not exist, or is still in use",
  ],
  23502: [422, "MISSING_VALUE", "A required value is missing"],
  23514: [422, "INVALID_VALUE", "A value is not allowed here"],
  22001: [422, "VALUE_TOO_LONG", "One of the values is too long"],
  22003: [422, "VALUE_OUT_OF_RANGE", "One of the values is out of range"],
  "22P02": [422, "INVALID_VALUE", "One of the values is in the wrong format"],
  22007: [422, "INVALID_VALUE", "One of the dates is not valid"],
  22008: [422, "INVALID_VALUE", "One of the dates is out of range"],
  40001: [
    409,
    "TRY_AGAIN",
    "Someone else changed this at the same moment. Try again.",
  ],
  "40P01": [
    409,
    "TRY_AGAIN",
    "Someone else changed this at the same moment. Try again.",
  ],
  "55P03": [409, "TRY_AGAIN", "This record is busy. Try again in a moment."],
  57014: [
    503,
    "TIMED_OUT",
    "That took too long and was stopped. Try again, or narrow the request.",
  ],
  P0001: [409, "NOT_ALLOWED", "That is not allowed by a business rule"],
};

/**
 * The route as declared (`POST /api/v1/ess/leave`), which http/route.js stamps while the
 * router's base path is still on the request: by the time an error reaches this handler
 * Express has unwound req.baseUrl, so reading it here would give `POST /leave`.
 */
const routeOf = (req) =>
  req.routePattern
    ? `${req.method} ${req.routePattern}`
    : `${req.method} ${req.baseUrl || ""}${req.route ? req.route.path : req.path}`;

/** A refused form as one fault per rule: "LEAVE_SPANS_YEARS: ends_on" at its route. */
function recordValidation(req, fields, code = "VALIDATION_FAILED") {
  try {
    const names =
      Object.keys(fields || {})
        .sort()
        .join(", ") || "unknown";
    const err = new Error(`${code}: ${names}`);
    err.name = "ValidationError";
    err.stack = `ValidationError: ${code}: ${names}\n    at ${routeOf(req)}`;
    report(err, {
      origin: "server",
      severity: "notice",
      route: routeOf(req),
      request_id: req.request_id,
    });
  } catch {
    /* never break the 422 */
  }
}

function send(res, status, error, requestId) {
  if (res.headersSent) return undefined;
  return res.status(status).json({ error, request_id: requestId });
}

function notFound(req, res) {
  return send(
    res,
    404,
    { code: "NOT_FOUND", message: `Nothing at ${req.method} ${req.path}` },
    req.request_id,
  );
}

/** Four arguments: that is how Express recognises error middleware. */
function errorHandler(err, req, res, _next) {
  const requestId = req.request_id;

  if (err instanceof AppError) {
    const status = err.status || 500;
    if (status >= 500) {
      const severity = err.severity || "error";
      logger[severity === "error" ? "error" : "warn"]({ err }, err.message);
      report(err, {
        origin: "server",
        severity,
        route: routeOf(req),
        request_id: requestId,
      });
    } else {
      logger.warn({ code: err.code, status }, err.message);
      if (status === 422 && err.fields && err.recorded !== false) recordValidation(req, err.fields, err.code);
    }
    return send(
      res,
      status,
      {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
      requestId,
    );
  }

  if (err instanceof ZodError) {
    const fields = fieldsOf(err);
    logger.warn({ fields: Object.keys(fields) }, "validation failed");
    recordValidation(req, fields);
    return send(
      res,
      422,
      {
        code: "VALIDATION_FAILED",
        message: "Check the highlighted fields",
        fields,
      },
      requestId,
    );
  }

  // body-parser
  if (err && err.type === "entity.too.large") {
    return send(
      res,
      413,
      { code: "PAYLOAD_TOO_LARGE", message: "That request is too large" },
      requestId,
    );
  }
  if (err && err.type === "entity.parse.failed") {
    return send(
      res,
      400,
      { code: "BAD_JSON", message: "The request body is not valid JSON" },
      requestId,
    );
  }

  const mapped = err && typeof err.code === "string" && PG[err.code];
  if (mapped) {
    const [status, code, message] = mapped;
    // Constraint and table names help us; the row values in `detail` never leave (logger redacts them).
    const log = {
      pg_code: err.code,
      constraint: err.constraint,
      table: err.table,
      column: err.column,
    };
    if (status >= 500) {
      logger.error({ err, ...log }, "database error");
      report(err, {
        origin: "server",
        route: routeOf(req),
        request_id: requestId,
      });
    } else {
      logger.warn(log, "database refused the change");
    }
    const error = { code, message };
    if (err.column) error.fields = { [err.column]: [message] };
    return send(res, status, error, requestId);
  }

  logger.error({ err }, "unhandled error");
  report(err, { origin: "server", route: routeOf(req), request_id: requestId });
  return send(
    res,
    500,
    {
      code: "INTERNAL_ERROR",
      message:
        "Something went wrong on our side. Try again, and quote this reference if it keeps happening.",
      reference: requestId,
    },
    requestId,
  );
}

module.exports = { errorHandler, notFound, PG };
