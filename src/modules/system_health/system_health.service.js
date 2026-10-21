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
const { EVENTS, BRIEF_DOC_TYPE, STATUS_BRIEF_DOC_TYPE } = require("./system_health.events");

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
  { key: "mail", label: "Mail", look: "Mail is not set up or the server refused. Queued mail waits. Open Settings, Integrations." },
  { key: "mail_server", label: "Staff Mail Server", look: "Staff mailboxes cannot reach their mail server. Open Settings, Integrations." },
  { key: "maps", label: "Maps", look: "Address search and maps are failing. Open Settings, Integrations." },
  { key: "ai", label: "AI", look: "No AI vendor answers, or Gemini is failing. Open Settings, Integrations." },
  { key: "groq", label: "Groq", look: "Voice notes go to Gemini, then the browser. Open Settings, Integrations." },
  { key: "openai", label: "OpenAI", look: "Embeddings for search are failing. Open Settings, Integrations." },
  { key: "anthropic", label: "Anthropic", look: "Top-tier drafting falls back to Gemini. Open Settings, Integrations." },
  { key: "deepseek", label: "DeepSeek", look: "DeepSeek is failing. Open Settings, Integrations." },
  { key: "exchange_rates", label: "Exchange Rates", look: "Rates are not fresh, so naira prices use the last rate. Open Settings, Integrations." },
  { key: "web_push", label: "Web Push", look: "Pushes to phones and computers are failing. Open Settings, Integrations." },
  { key: "static", label: "Frontend Build", look: "A frontend build is missing from this release." },
  { key: "disk", label: "Disk Space", look: "The disk is filling up. Nothing can be uploaded or written once it is full." },
  { key: "memory", label: "Memory", look: "The server is close to its memory. A process is killed if it runs out. Performance shows which service holds it." },
  { key: "cpu", label: "Processor", look: "The processor is close to fully busy, so everything answers slowly. Performance shows which service is using it." },
  { key: "database_usage", label: "Database Usage", look: "The database is close to its connection limit, or growing fast." },
  { key: "schedulers", label: "Background Jobs", look: "A job has not run when it should have. Reminders, snapshots and clean-ups are waiting." },
];

const BY_KEY = new Map(CHECKS.map((c) => [c.key, c]));

const label = (key) => (BY_KEY.get(key) ? BY_KEY.get(key).label : key.replace(/_/g, " "));

/** Mail paused on purpose (docs/guides/integrations.md §6.15): degraded, and where to undo it. */
const pausedMail = (key, v) => key === "mail" && Boolean(v) && v.mode === "paused";

function lookAt(key, v) {
  if (pausedMail(key, v)) return "System mail is paused. Resume it on Settings, Integrations, System Sender.";
  return BY_KEY.get(key) ? BY_KEY.get(key).look : "Open the logs for this service.";
}

/** A connection's failure (Settings · Integrations), in a few words. */
const CONNECTION_ERROR = {
  SERVER_NOT_FOUND: "server not found",
  NO_ANSWER: "no answer on its port",
  TLS_FAILED: "secure connection failed",
  CERTIFICATE_MISMATCH: "certificate is for another name",
  AUTH_FAILED: "password refused",
  KEY_REFUSED: "key refused",
  OVER_QUOTA: "over today's quota",
  SECRET_UNREADABLE: "saved key cannot be read",
  TIMEOUT: "no answer in time",
  MODEL_NOT_FOUND: "no model it needs is on the key",
  RATES_STALE: "rates are more than a day old",
};

/** The checks that are a connection's stored state on Settings · Integrations. */
const CONNECTIONS = new Set(["maps", "mail_server", "groq", "openai", "anthropic", "deepseek", "exchange_rates", "web_push"]);

/** What a probe is doing, in a line, from whatever it chose to report. */
function detailOf(key, v) {
  if ((CONNECTIONS.has(key) || key === "ai") && v.error && CONNECTION_ERROR[v.error]) return `Failing: ${CONNECTION_ERROR[v.error]}`;
  if (CONNECTIONS.has(key) && v.error) return "Failing: not answering";
  if ((CONNECTIONS.has(key) || key === "mail") && v.mode === "not_set_up") return "Not set up";
  if (pausedMail(key, v)) return "Paused: invitations and password resets only";
  if (v.error) return String(v.error).slice(0, 200);
  const bits = [];
  if (key === "exchange_rates" && v.rate_day) bits.push(`rates of ${require("../../shared/time/day-first").formatDate(v.rate_day)}`);
  if (key === "outbox" && v.backlog !== undefined) bits.push(`${v.backlog} waiting`);
  if (key === "modules" && v.mounted !== undefined) bits.push(`${v.mounted} mounted`);
  if (key === "modules" && v.skipped && v.skipped.length) bits.push(`skipped: ${v.skipped.join(", ")}`);
  if (key === "migrations" && v.head) bits.push(`at ${v.head}`);
  if (key === "mail" && v.sent_last_hour !== undefined) bits.push(`${v.sent_last_hour} of ${v.per_hour} this hour`);
  if (key === "ai" && v.vendor) bits.push(`answering: ${v.vendor}`);
  if (key === "disk" && v.free_pct !== undefined) bits.push(`${v.free_pct}% free, ${v.free_gb} GB of ${v.total_gb} GB`);
  if (key === "memory" && v.used_pct !== undefined) bits.push(`${v.used_pct}% in use, ${v.used_gb} GB of ${v.total_gb} GB`);
  if (key === "cpu" && v.busy_pct !== undefined && v.busy_pct !== null) bits.push(`${v.busy_pct}% busy across ${v.cores} cores`);
  else if (key === "cpu" && v.load !== undefined) bits.push(`load ${v.load} across ${v.cores} cores`);
  if (key === "database_usage" && v.size_mb !== undefined)
    bits.push(`${v.size_mb} MB, ${v.connections_used} of ${v.connections_allowed} connections`);
  if (key === "schedulers" && v.schedulers !== undefined) {
    const late = v.late || [];
    const failing = v.failing || [];
    const waiting = v.waiting || [];
    const some = (names) => `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
    if (late.length) bits.push(`${late.length} of ${v.schedulers} have not run: ${some(late)}`);
    if (failing.length) bits.push(`${failing.length} failing: ${some(failing)}`);
    if (!late.length && !failing.length) bits.push(`all ${v.schedulers - waiting.length} on time`);
    if (waiting.length) bits.push(`${waiting.length} not due yet`);
  }
  if (v.latency_ms !== undefined && v.latency_ms !== null) bits.push(`answered in ${v.latency_ms} ms`);
  if (!bits.length) bits.push(v.status === "up" ? "Answering" : "Not answering");
  return bits.join(", ");
}

const stateOf = (v) => (v.status === "up" ? "up" : v.status === "degraded" ? "degraded" : "down");

/**
 * When each check entered the state the snapshots last saw, by key. Empty when the
 * database cannot say: the checks still show, without a since.
 */
async function sinceByKey() {
  const rows = await repo.lastChanges(pool).catch(() => []);
  return new Map(rows.map((r) => [r.key, r]));
}

/** One probe's result as the wire carries it. */
function presentCheck(key, v, since) {
  const state = stateOf(v);
  const seen = since.get(key);
  return {
    key,
    label: label(key),
    state,
    detail: detailOf(key, v),
    look_at: state === "up" ? null : lookAt(key, v),
    latency_ms: v.latency_ms ?? null,
    since: seen && seen.state === state && seen.since ? new Date(seen.since).toISOString() : null,
  };
}

/** GET /system-health/status */
async function status() {
  const { runChecks } = require("../../http/health");
  // Neither database read may take the screen down with it: with Postgres down the
  // checks are exactly what a person needs to see (§11).
  const [{ checks, fatal, degraded }, counts, since] = await Promise.all([
    runChecks(),
    repo.faultCounts(pool).catch(() => null),
    sinceByKey(),
  ]);
  const build = buildInfo();
  return {
    state: fatal ? "unavailable" : degraded ? "degraded" : "ready",
    checked_at: new Date().toISOString(),
    release: build.sha,
    deployed_at: build.built_at || null,
    checks: Object.entries(checks).map(([key, v]) => presentCheck(key, v, since)),
    faults_open: counts ? counts.faults_open : 0,
    faults_new_24h: counts ? counts.faults_new_24h : 0,
    faults_returned_24h: counts ? counts.faults_returned_24h : 0,
  };
}

/**
 * What each figure a probe reports is called on screen, and its unit. Anything a probe
 * adds later still shows, under its own key in words.
 */
const FACTS = {
  latency_ms: ["Answered In", " ms"],
  error: ["Error", ""],
  backlog: ["Waiting Events", ""],
  failed: ["Failed Events", ""],
  workers: ["Workers Alive", ""],
  mounted: ["Modules Mounted", ""],
  routes: ["Routes", ""],
  skipped: ["Modules Skipped", ""],
  head: ["Latest Migration", ""],
  vendor: ["Answering", ""],
  mode: ["Mode", ""],
  sent_last_hour: ["Sent This Hour", ""],
  per_hour: ["Hourly Limit", ""],
  free_pct: ["Free", "%"],
  free_gb: ["Free Space", " GB"],
  total_gb: ["Total", " GB"],
  path: ["Measured At", ""],
  used_pct: ["In Use", "%"],
  used_gb: ["Used Space", " GB"],
  process_mb: ["This Process", " MB"],
  busy_pct: ["Busy", "%"],
  load: ["Load per Core", ""],
  cores: ["Cores", ""],
  size_mb: ["Size", " MB"],
  connections_used: ["Connections Used", ""],
  connections_allowed: ["Connections Allowed", ""],
  connections_pct: ["Connections", "%"],
  schedulers: ["Jobs", ""],
  late: ["Late", ""],
  failing: ["Failing", ""],
  waiting: ["Not Due Yet", ""],
};

const words = (key) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** Every figure a probe reported, labelled, scrubbed and in the order it reported them. */
function factsOf(v) {
  const { scrub } = require("../../shared/observability/scrub");
  const shown = ([k, value]) =>
    k !== "status" && value !== undefined && value !== null && (Array.isArray(value) || typeof value !== "object");
  return Object.entries(v || {})
    .filter(shown)
    .map(([k, value]) => {
      const [name, unit] = FACTS[k] || [words(k), ""];
      const text = Array.isArray(value)
        ? value.length ? value.join(", ") : "None"
        : typeof value === "boolean"
          ? value ? "Yes" : "No"
          : `${value}${unit}`;
      return { label: name, value: scrub(String(text)).slice(0, 300) };
    });
}

/**
 * A readiness snapshot newer than this is the system as it stands: two of the five-minute
 * job's intervals, so one missed tick is not an accusation (the Faults brief's state now).
 */
const SNAPSHOT_RECENT_MS = 11 * 60_000;

/** The check keys this build has probes for. */
function checkKeys() {
  return require("../../http/health").checkNames();
}

/**
 * GET /system-health/checks/:key: one probe run now, with everything behind it. The jobs
 * and the queues are read from the source, not from the probe, so a person sees each
 * scheduler and queue rather than a count.
 */
async function check(key) {
  if (!checkKeys().includes(key)) throw new AppError("NOT_FOUND", "Not found", 404);
  const health = require("../../http/health");
  const report = require("../../jobs/report");
  const [v, since, jobs, queues] = await Promise.all([
    health.runCheck(key),
    sinceByKey(),
    key === "schedulers" ? report.schedulers({ db: pool }) : null,
    key === "worker" ? report.queues() : null,
  ]);
  const unread = [];
  if (jobs && jobs.db_error) unread.push(`Job runs: ${jobs.db_error}`);
  if (jobs && jobs.queue_error) unread.push(`Next ticks: ${jobs.queue_error}`);
  if (queues && queues.error) unread.push(`Queues: ${queues.error}`);
  return {
    ...presentCheck(key, v, since),
    facts: factsOf(v),
    jobs: jobs ? jobs.jobs : null,
    queues: queues ? queues.queues : null,
    unread,
  };
}

/** GET /system-health/checks/:key/history */
async function history(key, query) {
  if (!checkKeys().includes(key)) throw new AppError("NOT_FOUND", "Not found", 404);
  const page = await repo.changes(pool, key, query);
  return {
    ...page,
    data: page.data.map((r) => ({
      at: new Date(r.at).toISOString(),
      from: r.from,
      to: r.to,
      detail: detailOf(key, r.value || { status: r.to }),
    })),
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

/* ------------------------------------------------------------------ *
 * The Status brief
 * ------------------------------------------------------------------ */

/** The checks of one probe run that are not up, labelled: the Faults brief's state lines. */
function notUpIn(checks) {
  return Object.entries(checks || {})
    .filter(([, v]) => v && v.status !== "up")
    .map(([key, v]) => ({ key, label: label(key), state: stateOf(v), detail: detailOf(key, v) }));
}

/**
 * Everything the Status brief reads, each part on its own, so one source being down never
 * costs the rest: a part that fails is named in `unread` instead. Used by the worker for
 * Download Brief and by scripts/ops/health-brief.js on the server, where the database,
 * Redis or the API itself may be what is down.
 * @param {{checks: object, api?: {answering: boolean, error?: string|null}|null}} seen
 *   checks  runChecks()'s `checks`, as whoever ran them saw them
 */
async function statusBriefInput({ checks, api = null }) {
  const { scrub } = require("../../shared/observability/scrub");
  const report = require("../../jobs/report");
  const unread = [];
  const part = async (what, fn) => {
    try {
      return await fn();
    } catch (err) {
      unread.push(`${what}: ${scrub(String((err && err.message) || err)).slice(0, 200)}`);
      return null;
    }
  };
  const [since, jobs, queues, changes, last24, open] = await Promise.all([
    part("When each check changed", sinceByKey),
    report.schedulers({ db: pool }),
    report.queues(),
    part("Changes over the last 7 days", () => repo.changesOfAll(pool, { page: 1 })),
    part("The last 24 hours", () => performance({ range: "24h" })),
    part("Open faults", () => faults({ status: "active", page: 1 })),
  ]);
  if (jobs.db_error) unread.push(`Background job runs: ${jobs.db_error}`);
  if (jobs.queue_error) unread.push(`The schedule queue: ${jobs.queue_error}`);
  if (queues.error) unread.push(`Queues: ${queues.error}`);

  const list = Object.entries(checks || {}).map(([key, v]) => ({
    ...presentCheck(key, v, since || new Map()),
    facts: factsOf(v),
  }));
  const build = buildInfo();
  return {
    now: new Date(),
    config,
    release: build.sha,
    deployed_at: build.built_at || null,
    // From the checks given, never from a second run that could disagree with them.
    state: require("../../http/health").serviceState(checks),
    checks: list,
    api,
    jobs,
    queues,
    changes: changes
      ? {
          rows: changes.data.map((r) => ({
            at: new Date(r.at).toISOString(),
            key: r.key,
            label: label(r.key),
            from: r.from,
            to: r.to,
            detail: detailOf(r.key, r.value || { status: r.to }),
          })),
          total: changes.page.total,
        }
      : null,
    last24,
    faults: open ? { rows: open.data, total: open.page.total } : null,
    host: null,
    unread,
  };
}

/**
 * Download Brief on Status: the file is reserved here and written by the worker, as every
 * export is. The checks travel in the event exactly as the API ran them at the press,
 * because only the API mounts the modules, and the worker's own run would say less.
 * Nothing about any fault changes.
 */
async function requestStatusBrief(actor) {
  const { runChecks } = require("../../http/health");
  const { scrubObject } = require("../../shared/observability/scrub");
  const { checks } = await runChecks();
  const client = await pool.connect();
  try {
    return await atomically(client, async () => {
      const doc = await exportFiles.reserve(client, {
        doc_type: STATUS_BRIEF_DOC_TYPE,
        entity: { type: STATUS_BRIEF_DOC_TYPE, id: crypto.randomUUID() },
        file_name: exportFilename({ base: "mycity-status", env: config.APP_ENV, extension: "md" }),
        title: "System Health status brief",
        actor,
      });
      await emit(client, {
        key: EVENTS.SYSTEM_HEALTH_STATUS_BRIEF_REQUESTED,
        entity: { type: doc.entity_type, id: doc.entity_id },
        actor,
        payload: {
          document_id: doc.document_id,
          requested_by: actor.user_id,
          checked_at: new Date().toISOString(),
          checks: scrubObject(checks),
        },
      });
      return exportFiles.present(doc);
    });
  } finally {
    client.release();
  }
}

module.exports = {
  CHECKS,
  SNAPSHOT_RECENT_MS,
  label,
  lookAt,
  detailOf,
  pausedMail,
  presentRow,
  status,
  faults,
  fault,
  patch,
  addNote,
  bulk,
  requestBrief,
  presentCheck,
  factsOf,
  check,
  history,
  notUpIn,
  statusBriefInput,
  requestStatusBrief,
};
