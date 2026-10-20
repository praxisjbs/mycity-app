"use strict";
/**
 * Settings · System Health: the readiness checks as they stand, what the snapshots say
 * about the last day or week, and the faults with the status the team shares.
 *
 * The checks are not re-implemented here. `src/http/health.js` owns them and
 * `GET /api/health/ready` runs the same ones, so the screen and the uptime probe can
 * never disagree about what is up. This file adds the words a person reads and where to
 * look when something is not up (docs/runbooks/monitoring.md §1).
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { config } = require("../../config/env");
const { buildInfo } = require("../../config/build-info");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const exportFiles = require("../../shared/documents/exports");
const { exportFilename } = require("../../shared/spreadsheet/cells");
const repo = require("./system_health.repo");
const { explain } = require("./system_health.explain");
const { EVENTS, BRIEF_DOC_TYPE } = require("./system_health.events");

/** What each probe is called on screen, and where to look when it is not up. */
const CHECKS = {
  postgres: ["Database", "The database is not answering. Nothing can be read or written until it is back."],
  redis: ["Cache and Sessions", "Sessions, queued jobs and live updates are down."],
  worker: ["Worker", "No heartbeat. Mail, PDFs and notifications are waiting, not lost."],
  modules: ["Modules", "A module failed to load, so its screens answer nothing."],
  migrations: ["Migrations", "The migration ledger is missing or empty. The database is not at this build."],
  numbering: ["Numbering", "A document type has no numbering scheme, so nothing of that type can be created."],
  outbox: ["Events", "Events are piling up: the worker is behind or down."],
  storage: ["File Storage", "The media folder is missing or cannot be written to. Uploads will fail."],
  chromium: ["PDFs", "Chromium is missing, so no PDF can be drawn."],
  ffmpeg: ["Voice and Video", "Voice notes and video cannot be processed."],
  clamd: ["Upload Scanning", "Uploads cannot be scanned, so they are refused."],
  mail: ["Mail", "Mail is not configured or the server refused. Queued mail waits."],
  ai: ["AI", "No AI vendor answers, so the assistant falls back to its stub."],
  static: ["Frontend Build", "A frontend build is missing from this release."],
};

const label = (key) => (CHECKS[key] ? CHECKS[key][0] : key.replace(/_/g, " "));
const lookAt = (key) => (CHECKS[key] ? CHECKS[key][1] : "Open the logs for this service.");

/** What a probe is doing, in a line, from whatever it chose to report. */
function detailOf(key, v) {
  if (v.error) return String(v.error).slice(0, 200);
  const bits = [];
  if (key === "outbox" && v.backlog !== undefined) bits.push(`${v.backlog} waiting`);
  if (key === "modules" && v.mounted !== undefined) bits.push(`${v.mounted} mounted`);
  if (key === "modules" && v.skipped && v.skipped.length) bits.push(`skipped: ${v.skipped.join(", ")}`);
  if (key === "migrations" && v.head) bits.push(`at ${v.head}`);
  if (key === "mail" && v.sent_last_hour !== undefined) bits.push(`${v.sent_last_hour} of ${v.per_hour} this hour`);
  if (key === "ai" && v.vendor) bits.push(`answering: ${v.vendor}`);
  if (v.latency_ms !== undefined && v.latency_ms !== null) bits.push(`answered in ${v.latency_ms} ms`);
  if (!bits.length) bits.push(v.status === "up" ? "Answering" : "Not answering");
  return bits.join(", ");
}

/** GET /system-health/status */
async function status() {
  const { runChecks } = require("../../http/health");
  const [{ checks, fatal, degraded }, counts] = await Promise.all([runChecks(), repo.faultCounts(pool)]);
  const build = buildInfo();
  return {
    state: fatal ? "unavailable" : degraded ? "degraded" : "ready",
    checked_at: new Date().toISOString(),
    release: build.sha,
    deployed_at: build.built_at || null,
    checks: Object.entries(checks).map(([key, v]) => ({
      key,
      label: label(key),
      state: v.status === "up" ? "up" : v.status === "degraded" ? "degraded" : "down",
      detail: detailOf(key, v),
      look_at: v.status === "up" ? null : lookAt(key),
      latency_ms: v.latency_ms ?? null,
    })),
    faults_open: counts ? counts.faults_open : 0,
    faults_new_24h: counts ? counts.faults_new_24h : 0,
    faults_returned_24h: counts ? counts.faults_returned_24h : 0,
  };
}

/** How many minutes of the window have no snapshot: the worker was not running. */
function gapMinutes(range, snapshots) {
  const minutes = range === "7d" ? 60 * 24 * 7 : 60 * 24;
  const expected = Math.floor(minutes / 5);
  return Math.max(0, (expected - snapshots) * 5);
}

/** GET /system-health/performance */
async function performance(query) {
  const range = query.range || "24h";
  const [points, up] = await Promise.all([repo.series(pool, range), repo.uptime(pool, range)]);
  const snapshots = up ? up.snapshots : 0;
  const ready = up ? up.ready : 0;
  return {
    range,
    points: points.map((p) => ({
      at: new Date(p.at).toISOString(),
      state: p.state,
      faults: p.faults || 0,
      outbox_backlog: p.outbox_backlog || 0,
      worker_lag_s: p.worker_lag_s ?? null,
    })),
    gap_minutes: gapMinutes(range, snapshots),
    uptime_pct: (snapshots ? (ready * 100) / snapshots : 0).toFixed(1),
  };
}

/* ------------------------------------------------------------------ *
 * Faults
 * ------------------------------------------------------------------ */

/** A group row as the wire carries it. Counts come from the query; nothing is stored. */
function presentRow(g) {
  return {
    error_group_id: g.error_group_id,
    title: g.title,
    severity: g.severity,
    origin: g.origin,
    route: g.route ?? null,
    status: g.status,
    assigned_to: g.assigned_to ?? null,
    assigned_name: g.assigned_name ?? null,
    first_seen_at: new Date(g.first_seen_at).toISOString(),
    last_seen_at: new Date(g.last_seen_at).toISOString(),
    last_release: g.last_release ?? null,
    today: g.today ?? 0,
    total: g.total ?? 0,
    people: g.people ?? 0,
    came_back: Boolean(g.regressed_at) && g.status === "open",
  };
}

async function faults(query) {
  const page = await repo.page(pool, query);
  return { ...page, data: page.data.map(presentRow) };
}

async function fault(id) {
  const g = await repo.get(pool, id);
  if (!g) throw new AppError("NOT_FOUND", "Not found", 404);
  const [occurrences, daily, notes] = await Promise.all([
    repo.occurrences(pool, g.fingerprint),
    repo.daily(pool, g.fingerprint),
    repo.notes(pool, id),
  ]);
  return {
    ...presentRow(g),
    name: g.name,
    last_message: g.last_message ?? null,
    frame: g.frame ?? null,
    first_release: g.first_release ?? null,
    regressions: g.regressions || 0,
    plainly: explain(g),
    daily,
    occurrences: occurrences.map((o) => ({
      occurred_at: new Date(o.occurred_at).toISOString(),
      route: o.route ?? null,
      origin: o.origin,
      release: o.release ?? null,
      request_id: o.request_id ?? null,
      message: o.message,
      stack: o.stack ?? null,
    })),
    notes: notes.map((n) => ({
      error_group_note_id: n.error_group_note_id,
      body: n.body,
      author_user_id: n.author_user_id ?? null,
      author_name: n.author_name ?? null,
      created_at: new Date(n.created_at).toISOString(),
    })),
  };
}

/** Status, owner, or both, with an optional note, in one transaction. */
async function patch(id, body, actor) {
  const client = await pool.connect();
  try {
    const row = await atomically(client, async () => {
      const updated = await repo.setState(client, id, {
        status: body.status,
        assigned_to: body.assigned_to,
        actor: actor.user_id,
      });
      if (!updated) throw new AppError("NOT_FOUND", "Not found", 404);
      if (body.note) {
        await repo.addNote(client, {
          error_group_id: id,
          author_user_id: actor.user_id,
          body: body.note,
        });
      }
      return updated;
    });
    return fault(row.error_group_id);
  } finally {
    client.release();
  }
}

async function addNote(id, body, actor) {
  const g = await repo.get(pool, id);
  if (!g) throw new AppError("NOT_FOUND", "Not found", 404);
  const client = await pool.connect();
  try {
    const n = await atomically(client, () =>
      repo.addNote(client, { error_group_id: id, author_user_id: actor.user_id, body: body.body }),
    );
    return {
      error_group_note_id: n.error_group_note_id,
      body: n.body,
      author_user_id: n.author_user_id ?? null,
      author_name: actor.display_name || null,
      created_at: new Date(n.created_at).toISOString(),
    };
  } finally {
    client.release();
  }
}

async function bulk(body, actor) {
  const client = await pool.connect();
  try {
    const changed = await atomically(client, () =>
      repo.setStatusMany(client, body.error_group_ids, body.status, actor.user_id),
    );
    return { changed };
  } finally {
    client.release();
  }
}

/**
 * Download Brief: the file is reserved here and written by the worker, as every export
 * is. The ticked faults that are still open become Being Handled, taken by whoever
 * pressed if nobody holds them, so two people do not fix one fault twice.
 */
async function requestBrief(body, actor) {
  const ids = body.error_group_ids;
  const groups = await repo.getMany(pool, ids);
  if (!groups.length) throw new AppError("NOT_FOUND", "Those faults are no longer here.", 404);
  const found = groups.map((g) => g.error_group_id);
  const open = groups.filter((g) => g.status === "open").map((g) => g.error_group_id);

  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: BRIEF_DOC_TYPE,
        entity: { type: BRIEF_DOC_TYPE, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "mycity-faults", env: config.APP_ENV, extension: "md" }),
        title: "System Health brief",
        actor,
      });
      if (open.length) await repo.setStatusMany(client, open, "handling", actor.user_id);
      await repo.claimUnassigned(client, found, actor.user_id);
      await emit(client, {
        key: EVENTS.SYSTEM_HEALTH_BRIEF_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: { error_group_ids: found, requested_by: actor.user_id, document_id: doc.document_id },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

module.exports = {
  CHECKS,
  label,
  lookAt,
  detailOf,
  gapMinutes,
  presentRow,
  status,
  performance,
  faults,
  fault,
  patch,
  addNote,
  bulk,
  requestBrief,
};
