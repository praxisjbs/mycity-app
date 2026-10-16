"use strict";
/**
 * Record a fault, and tell a person about the ones that matter.
 *
 *   report(err, { origin: "server", route: "POST /api/v1/things", request_id });
 *   report(err, { origin: "worker", severity: "error", extra: { queue: "email" } });
 *
 * Every report is scrubbed (observability/scrub.js), written to `error_event`,
 * and logged. Severities `fatal` and `error` (the 5xx class) are also sent to the alert
 * channels (observability/alert.js: ALERT_WEBHOOK_URL, ALERT_WHATSAPP_URLS); `warning` and `notice` (4xx, validation) are recorded and
 * counted but never alert, so the channel stays worth reading
 * (SYSTEM_ARCHITECTURE §11).
 *
 * Rules:
 *  - fingerprinting with ids and numbers normalised, so one fault is one group
 *    with a count, not a thousand rows;
 *  - a five-minute de-duplication window and a 20-per-minute cap on alerts;
 *  - writes batched off the request path, flushed every few seconds;
 *  - it never throws. A reporter that breaks the thing it reports on is worse
 *    than none; if the table is missing (a database before migration 0030) it
 *    says so once and carries on logging.
 *
 * Columns written (migration 0030, `error_event`): occurred_at, severity, origin,
 * fingerprint, name, message, stack, route, request_id, user_id, release, extra.
 */
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const requestContext = require("../../config/request-context");
const { scrub, scrubObject } = require("./scrub");
const metrics = require("./metrics");
const alert = require("./alert");

const ALERT_SEVERITIES = new Set(["fatal", "error"]);
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const MAX_ALERTS_PER_MINUTE = 20;
const MAX_TRACKED = 500;
const FLUSH_MS = 3000;
const MAX_BUFFER = 200;

const seen = new Map();
let windowStart = Date.now();
let alertsThisWindow = 0;

let buffer = [];
let timer = null;
let storeBroken = false;
let queryFn = null;

/** The database call, swappable in tests. Lazy so this file loads without a pool. */
function dbQuery(sql, params) {
  if (queryFn) return queryFn(sql, params);
  return require("../../config/db").query(sql, params);
}

/** Group key: same error at the same place is one fingerprint whatever the ids. */
function fingerprint(err, meta = {}) {
  const name = (err && err.name) || "Error";
  const msg = String((err && err.message) || err || "unknown")
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      "<uuid>",
    )
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 200);
  const frame =
    String((err && err.stack) || "")
      .split("\n")[1]
      ?.trim()
      .replace(/:\d+:\d+\)?$/, ")")
      .slice(0, 120) ||
    meta.route ||
    "";
  return `${name}|${msg}|${frame}`;
}

function underAlertCap() {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    alertsThisWindow = 0;
  }
  if (alertsThisWindow >= MAX_ALERTS_PER_MINUTE) return false;
  alertsThisWindow += 1;
  return true;
}

function forget() {
  if (seen.size <= MAX_TRACKED) return;
  const oldest = [...seen.entries()].sort(
    (a, b) => a[1].lastSent - b[1].lastSent,
  );
  for (const [k] of oldest.slice(0, Math.ceil(MAX_TRACKED / 4))) seen.delete(k);
}

function alertText(p) {
  return [
    `${p.severity.toUpperCase()} · ${p.origin} · ${config.APP_ENV}`,
    p.message,
    p.route ? `at: ${p.route}` : null,
    p.user_id ? `user: ${p.user_id}` : null,
    p.request_id ? `request: ${p.request_id}` : null,
    `build: ${p.release}`,
    p.suppressed
      ? `(${p.suppressed} identical suppressed in the last 5 minutes)`
      : null,
    p.stack ? `\n${p.stack.split("\n").slice(0, 5).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function postAlert(payload) {
  if (!config.ALERT_WEBHOOK_URL && !config.ALERT_WHATSAPP_URLS) return false;
  const r = await alert.send(alertText(payload), {
    webhook: config.ALERT_WEBHOOK_URL,
    whatsapp: config.ALERT_WHATSAPP_URLS,
  });
  if (r.failed.length || r.skipped.length)
    logger.warn(
      { alert: alert.summary(r) },
      "an alert channel did not take the alert",
    );
  return r.sent > 0;
}

/* ---------------- storage ---------------- */

const COLUMNS = [
  "occurred_at",
  "severity",
  "origin",
  "fingerprint",
  "name",
  "message",
  "stack",
  "route",
  "request_id",
  "user_id",
  "release",
  "extra",
];

function schedule() {
  if (timer || storeBroken) return;
  timer = setTimeout(() => {
    timer = null;
    flush().catch(() => {});
  }, FLUSH_MS);
  if (timer.unref) timer.unref();
}

/** Write what is buffered. Called on a timer, and by server/worker shutdown. */
async function flush() {
  if (!buffer.length || storeBroken) {
    buffer = [];
    return 0;
  }
  const batch = buffer;
  buffer = [];
  const params = [];
  const rows = batch.map((p) => {
    const vals = [
      p.ts,
      p.severity,
      p.origin,
      p.fingerprint,
      p.name,
      p.message,
      p.stack,
      p.route,
      p.request_id,
      p.user_id,
      p.release,
      p.extra ? JSON.stringify(p.extra) : null,
    ];
    const start = params.length;
    params.push(...vals);
    return `(${vals.map((_, i) => `$${start + i + 1}`).join(", ")})`;
  });
  try {
    await dbQuery(
      `INSERT INTO error_event (${COLUMNS.join(", ")}) VALUES ${rows.join(", ")}`,
      params,
    );
    return batch.length;
  } catch (err) {
    if (err && err.code === "42P01") {
      storeBroken = true;
      logger.warn(
        "error_event table missing; errors are logged but not stored until migration 0030 runs",
      );
    } else {
      logger.warn(
        { err },
        "could not store error reports; they are in the log",
      );
    }
    return 0;
  }
}

function persist(payload) {
  if (storeBroken) return;
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push(payload);
  schedule();
}

/* ---------------- public ---------------- */

/**
 * @param {unknown} err
 * @param {{origin?: string, severity?: "fatal"|"error"|"warning"|"notice", route?: string,
 *          request_id?: string, user_id?: string, extra?: object}} [meta]
 * @returns {Promise<{alerted: boolean, reason?: string, fingerprint?: string}>}
 */
function report(err, meta = {}) {
  try {
    const message = scrub(String((err && err.message) || err || "unknown"), {
      max: 2000,
    });
    const stack = scrub((err && err.stack) || null, { max: 8000 }) || null;
    const severity = meta.severity || "error";
    const fp = fingerprint(
      { name: (err && err.name) || "Error", message, stack },
      meta,
    );
    const ctx = requestContext.get() || {};
    const prior = seen.get(fp);

    const payload = {
      ts: new Date().toISOString(),
      severity,
      origin: meta.origin || "server",
      fingerprint: fp.slice(0, 500),
      name: (err && err.name) || "Error",
      message,
      stack,
      route: scrub(meta.route || null) || null,
      request_id: meta.request_id || ctx.requestId || null,
      user_id: meta.user_id || ctx.userId || null,
      release: config.BUILD_SHA || "local",
      extra: meta.extra ? scrubObject(meta.extra) : null,
      suppressed: prior ? prior.suppressed : 0,
    };

    persist(payload);
    metrics.inc(
      "mycity_errors_total",
      { origin: payload.origin, severity },
      1,
      "Errors reported, by origin and severity.",
    );

    if (!ALERT_SEVERITIES.has(severity)) {
      return Promise.resolve({
        alerted: false,
        reason: "not_alerting",
        fingerprint: fp,
      });
    }
    if (prior && Date.now() - prior.lastSent < DEDUPE_WINDOW_MS) {
      prior.suppressed += 1;
      return Promise.resolve({
        alerted: false,
        reason: "deduped",
        fingerprint: fp,
      });
    }
    seen.set(fp, { lastSent: Date.now(), suppressed: 0 });
    forget();
    if (!underAlertCap()) {
      logger.warn(
        { fingerprint: fp },
        "error alert capped (more than 20 a minute)",
      );
      return Promise.resolve({
        alerted: false,
        reason: "capped",
        fingerprint: fp,
      });
    }
    return postAlert(payload).then((alerted) => ({ alerted, fingerprint: fp }));
  } catch (selfErr) {
    try {
      logger.error({ err: selfErr }, "error reporter failed");
    } catch {
      /* nothing left to try */
    }
    return Promise.resolve({ alerted: false, reason: "reporter_failed" });
  }
}

/** Tests only. */
function __reset({ query } = {}) {
  seen.clear();
  buffer = [];
  storeBroken = false;
  windowStart = Date.now();
  alertsThisWindow = 0;
  queryFn = query || null;
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = {
  report,
  flush,
  fingerprint,
  __reset,
  ALERT_SEVERITIES,
  DEDUPE_WINDOW_MS,
};
