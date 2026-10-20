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

/**
 * What each probe is called on screen, and where to look when it is not up. A list of
 * records rather than an object keyed by probe, as CATEGORIES is in
 * shared/notifications/categories.js: it keeps each probe's name as data, so the
 * `numbering` probe does not read as a document type being numbered
 * (scripts/check/numbering-schemes.js looks for a `numbering:` key).
 */
const CHECKS = [
  { key: "postgres", label: "Database", look: "The database is not answering. Nothing can be read or written until it is back." },
  { key: "redis", label: "Cache and Sessions", look: "Sessions, queued jobs and live updates are down." },
  { key: "worker", label: "Worker", look: "No heartbeat. Mail, PDFs and notifications are waiting, not lost." },
  { key: "modules", label: "Modules", look: "A module failed to load, so its screens answer nothing." },
  { key: "migrations", label: "Migrations", look: "The migration ledger is missing or empty. The database is not at this build." },
  { key: "numbering", label: "Numbering", look: "A document type has no numbering scheme, so nothing of that type can be created." },
  { key: "outbox", label: "Events", look: "Events are piling up: the worker is behind or down." },
  { key: "storage", label: "File Storage", look: "The media folder is missing or cannot be written to. Uploads will fail." },
  { key: "chromium", label: "PDFs", look: "Chromium is missing, so no PDF can be drawn." },
  { key: "ffmpeg", label: "Voice and Video", look: "Voice notes and video cannot be processed." },
  { key: "clamd", label: "Upload Scanning", look: "Uploads cannot be scanned, so they are refused." },
  { key: "mail", label: "Mail", look: "Mail is not configured or the server refused. Queued mail waits." },
  { key: "ai", label: "AI", look: "No AI vendor answers, so the assistant falls back to its stub." },
  { key: "static", label: "Frontend Build", look: "A frontend build is missing from this release." },
  { key: "disk", label: "Disk Space", look: "The disk is filling up. Nothing can be uploaded or written once it is full." },
  { key: "memory", label: "Memory", look: "The server is close to its memory. The process is killed if it runs out." },
  { key: "cpu", label: "Processor", look: "The server is working harder than it has cores for, so everything answers slowly." },
  { key: "database_usage", label: "Database Usage", look: "The database is close to its connection limit, or growing fast." },
  { key: "schedulers", label: "Background Jobs", look: "A job has not run when it should have. Reminders, snapshots and clean-ups are waiting." },
];

const BY_KEY = new Map(CHECKS.map((c) => [c.key, c]));

const label = (key) => (BY_KEY.get(key) ? BY_KEY.get(key).label : key.replace(/_/g, " "));
const lookAt = (key) => (BY_KEY.get(key) ? BY_KEY.get(key).look : "Open the logs for this service.");

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
  if (key === "disk" && v.free_pct !== undefined) bits.push(`${v.free_pct}% free, ${v.free_gb} GB of ${v.total_gb} GB`);
  if (key === "memory" && v.used_pct !== undefined) bits.push(`${v.used_pct}% used, ${v.used_gb} GB of ${v.total_gb} GB`);
  if (key === "cpu" && v.load !== undefined) bits.push(`load ${v.load} across ${v.cores} cores`);
  if (key === "database_usage" && v.size_mb !== undefined)
    bits.push(`${v.size_mb} MB, ${v.connections_used} of ${v.connections_allowed} connections`);
  if (key === "schedulers" && v.schedulers !== undefined)
    bits.push(
      (v.late || []).length
        ? `${v.late.length} of ${v.schedulers} have not run: ${v.late.slice(0, 3).join(", ")}`
        : `all ${v.schedulers} running`,
    );
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
/**
 * A snapshot older than this means the five-minute job is not running, rather than the
 * system being quiet. Two intervals, so one missed tick is not an accusation.
 */
const RECORDING_WITHIN_MS = 11 * 60_000;

const asNumber = (v) => (v === null || v === undefined ? null : Number(v));
const asDecimal = (v) => (v === null || v === undefined ? null : String(v));

async function performance(query) {
  const range = query.range || "24h";
  const [points, up, last] = await Promise.all([
    repo.series(pool, range),
    repo.uptime(pool, range),
    repo.lastSnapshot(pool),
  ]);
  const snapshots = up ? up.snapshots : 0;
  const ready = up ? up.ready : 0;
  const lastAt = last ? new Date(last.taken_at) : null;
  return {
    range,
    points: points.map((p) => ({
      at: new Date(p.at).toISOString(),
      state: p.state,
      faults: p.faults || 0,
      outbox_backlog: p.outbox_backlog || 0,
      worker_lag_s: p.worker_lag_s ?? null,
      requests: asNumber(p.requests),
      mean_ms: asNumber(p.mean_ms),
      error_pct: asDecimal(p.error_pct),
      disk_free_pct: asNumber(p.disk_free_pct),
      memory_used_pct: asNumber(p.memory_used_pct),
      cpu_load: asDecimal(p.cpu_load),
      database_mb: asNumber(p.database_mb),
    })),
    gap_minutes: gapMinutes(range, snapshots),
    recording: Boolean(lastAt) && Date.now() - lastAt.getTime() < RECORDING_WITHIN_MS,
    last_snapshot_at: lastAt ? lastAt.toISOString() : null,
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
  RECORDING_WITHIN_MS,
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
