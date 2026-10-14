"use strict";
/**
 * One log line per request: method, url, status, time taken, who, which surface.
 *
 * pino-http, with these rules:
 *  - reuses the id from middleware/request-id.js, so the access line and every
 *    application line of the request share one key;
 *  - 5xx at error, 4xx at warn, the rest at info;
 *  - health probes are not logged unless LOG_LEVEL is debug (an uptime monitor
 *    would otherwise write 1,440 lines a day nobody reads);
 *  - request count and duration recorded on the same hook, so metrics and the
 *    log cannot disagree;
 *  - the serialised request is trimmed to method, url, ip and user agent. Headers
 *    are not logged: they carry the token and the cookie.
 */
const pinoHttp = require("pino-http");
const { logger } = require("../config/logger");
const requestContext = require("../config/request-context");
const metrics = require("../shared/observability/metrics");

const QUIET = /^\/api\/health(\/|$)/;

function record(req, res) {
  try {
    const route = metrics.templatePath(req.originalUrl || req.url);
    metrics.inc("mycity_http_requests_total", { method: req.method, route, status: String(res.statusCode) }, 1,
      "HTTP requests by method, templated route and status.");
    const ms = Number(res.responseTime || 0);
    if (ms > 0) {
      metrics.observe("mycity_http_request_duration_seconds", ms / 1000, { method: req.method, route },
        "HTTP request duration in seconds.");
    }
  } catch {
    /* metrics never break a request */
  }
}

function accessLog() {
  return pinoHttp({
    logger,
    genReqId: (req) => req.request_id,
    customLogLevel(_req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    autoLogging: { ignore: (req) => QUIET.test(req.url || "") && logger.level !== "debug" },
    customSuccessMessage(req, res) {
      record(req, res);
      return `${req.method} ${req.originalUrl || req.url} ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      record(req, res);
      return `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${err ? err.message : ""}`.trim();
    },
    customProps(req) {
      const ctx = requestContext.get() || {};
      return {
        request_id: req.request_id,
        user_id: ctx.userId || (req.user && req.user.user_id) || null,
        surface: ctx.surface || null,
      };
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          ip: req.raw ? req.raw.ip : req.ip,
          user_agent: req.headers && req.headers["user-agent"],
        };
      },
      res(res) {
        return { status: res.statusCode };
      },
    },
  });
}

module.exports = { accessLog, QUIET };
