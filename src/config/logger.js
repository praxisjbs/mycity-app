"use strict";
/**
 * The one logger. Pino, JSON lines to stdout (journald on the server).
 *
 *   const { logger } = require("../config/logger");
 *   logger.info({ employee_id }, "employee created");     // fields first, then the message
 *
 * Rules:
 *
 *  - Redaction by key at the top level AND one level down. Pino paths are
 *    literal: `*.password` does not match a top-level `password`, so both forms
 *    are generated from SENSITIVE_KEYS.
 *  - pg error `detail` and `where` are redacted: a unique violation quotes the
 *    row ("Key (work_email)=(ada@mycity.io) already exists").
 *  - A mixin that adds request_id, user_id and surface from the request context
 *    to every line, so call sites cannot forget them. Call-site fields win.
 *
 *  - Bank, BVN, NIN, salary and MFA fields are on the list from the start.
 *  - No pino-pretty transport (pipe through `npx pino-pretty` locally if wanted;
 *    a transport is a worker thread Jest cannot shut down).
 */
const pino = require("pino");
const { config, ENV_SHORT, PROCESS_NAME } = require("./env");

/** Keys whose values never reach a log line. Also used by observability/scrub.js. */
const SENSITIVE_KEYS = [
  "password",
  "password_hash",
  "new_password",
  "current_password",
  "confirm_password",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "secret",
  "secret_enc",
  "mfa_secret",
  "mfa_secret_enc",
  "otp",
  "api_key",
  "private_key",
  "client_secret",
  "bank_account_number",
  "account_number",
  "bvn",
  "nin",
  "basic_salary",
  "gross_pay",
  "net_pay",
];

const REDACT_PATHS = [
  ...SENSITIVE_KEYS,
  ...SENSITIVE_KEYS.map((k) => `*.${k}`),
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["idempotency-key"]',
  'res.headers["set-cookie"]',
  "err.detail",
  "err.where",
  "error.detail",
  "error.where",
];

/** Ambient fields from config/request-context.js. Required lazily to avoid a load cycle. */
function contextMixin() {
  let ctx;
  try {
    ctx = require("./request-context").get();
  } catch {
    return {};
  }
  if (!ctx) return {};
  const out = {};
  if (ctx.requestId) out.request_id = ctx.requestId;
  if (ctx.userId) out.user_id = ctx.userId;
  if (ctx.surface) out.surface = ctx.surface;
  if (ctx.importBatchId) out.import_batch_id = ctx.importBatchId;
  return out;
}

/**
 * @param {string} [app]  process name: "mycity-api", "mycity-worker", a script name
 */
function createLogger(app = "mycity-api") {
  return pino({
    level: config.LOG_LEVEL,
    base: { app, env: ENV_SHORT },
    mixin: contextMixin,
    mixinMergeStrategy(mergeObject, mixinObject) {
      return Object.assign({}, mixinObject, mergeObject);
    },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

const logger = createLogger(PROCESS_NAME);

module.exports = { logger, createLogger, SENSITIVE_KEYS, REDACT_PATHS, contextMixin };
