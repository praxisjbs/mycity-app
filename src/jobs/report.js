"use strict";
/**
 * What every background job is doing right now: the one judgement of whether a scheduler
 * is on time, and what each queue holds (http/health.js "schedulers", Settings · Status,
 * the Status brief; docs/guides/system-health.md §6).
 *
 *   const report = require("./report");
 *   const { jobs } = await report.schedulers({ db: pool });   // one row per scheduler
 *   const { queues } = await report.queues();                   // one row per queue
 *
 * Every source is optional, and nothing here throws. Without the database a row says
 * only what the code declared; without Redis there is no next tick and no queue count.
 * The reason a source could not be read comes back beside the rows, so a screen or a
 * brief can say which part it could not see rather than show a quiet empty table.
 *
 * A scheduler is one of four states:
 *   on_time   ran within its allowance and its last run did not throw
 *   failing   ran within its allowance, but its last run threw
 *   late      has not run within its allowance (three of its own intervals, 3 hours for an
 *             hourly cron, 26 for a daily one), was never started, is missing from the
 *             schedule queue, or its tick is overdue with nobody to take it
 *   waiting   started less than its allowance ago and not yet at its first slot: a
 *             nightly job deployed at noon is not late at one o'clock
 * The allowance is counted from the last run or, before the first, from when the worker
 * first started the job (`schedule_run.created_at`, written by registry.registerRuns()).
 */
const { scrub } = require("../shared/observability/scrub");
const registry = require("./registry");

const DEFAULT_TZ = "Africa/Lagos";
/** A tick due longer ago than this, still on the queue, has nobody taking it. */
const OVERDUE_MS = 10 * 60_000;
/** One read of Redis or the database may not hold up a readiness probe. */
const READ_TIMEOUT_MS = 1500;

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

const pad = (n) => String(n).padStart(2, "0");
const iso = (v) => (v ? new Date(v).toISOString() : null);

function within(promise, what) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(`${what} did not answer within ${READ_TIMEOUT_MS} ms`)), READ_TIMEOUT_MS);
      if (t.unref) t.unref();
    }),
  ]).finally(() => clearTimeout(t));
}

/** A length of time as a person says it: "4 minutes", "1 hour", "3 hours", "2 days". */
function inWords(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
}

/** "Every second", "Every 5 minutes", "Every 2 hours". */
function everyInWords(ms) {
  const unit =
    ms % 3_600_000 === 0 ? [ms / 3_600_000, "hour"] : ms % 60_000 === 0 ? [ms / 60_000, "minute"] : [Math.round(ms / 1000), "second"];
  return unit[0] === 1 ? `Every ${unit[1]}` : `Every ${unit[0]} ${unit[1]}s`;
}

/**
 * What a scheduler was set to, in words. Reads the shapes of cron this repository uses
 * (a step, an hour range, a time of day, a weekday); anything else is shown as written.
 * @param {{every?: number, pattern?: string, tz?: string}} spec
 */
function cadenceOf(spec) {
  if (spec.every) return everyInWords(spec.every);
  const parts = String(spec.pattern || "").trim().split(/\s+/);
  const [m, h, dom, mon, dow] = parts;
  const zone = (spec.tz || DEFAULT_TZ) === DEFAULT_TZ ? "Lagos" : spec.tz;
  const step = (f) => (/^\*\/(\d+)$/.exec(f || "") || [])[1];
  const num = (f) => /^\d+$/.test(f || "");
  const range = (f) => /^(\d+)-(\d+)$/.exec(f || "");
  const anyDay = dom === "*" && mon === "*" && dow === "*";

  if (step(m) && h === "*" && anyDay) return `Every ${step(m)} minutes`;
  if (step(m) && range(h) && anyDay) {
    const [, a, b] = range(h);
    return `Every ${step(m)} minutes, ${pad(a)}:00 to ${pad(b)}:59 (${zone})`;
  }
  if (num(m) && h === "*" && anyDay) return `Hourly at :${pad(m)}`;
  if (num(m) && step(h) && anyDay) return `Every ${step(h)} hours at :${pad(m)}`;
  if (num(m) && num(h)) {
    const at = `${pad(h)}:${pad(m)} (${zone})`;
    if (anyDay) return `Daily at ${at}`;
    if (dom === "*" && mon === "*" && num(dow)) return `${DAYS[Number(dow) % 7]} at ${at}`;
    if (dom === "*" && mon === "*" && dow === "1-5") return `Weekdays at ${at}`;
    if (num(dom) && mon === "*" && dow === "*") return `Monthly on day ${dom} at ${at}`;
  }
  return `Cron ${spec.pattern} (${zone})`;
}

/** What the code declared, exactly: `every 300000 ms`, `cron 30 2 * * * Africa/Lagos`. */
function setAsOf(spec) {
  return spec.every ? `every ${spec.every} ms` : `cron ${spec.pattern} ${spec.tz || DEFAULT_TZ}`;
}

/**
 * How long a scheduler may be silent before something is wrong. Three times its own
 * interval, and never under 15 minutes, so one missed tick is not an alarm. A cron
 * schedule is read coarsely: every n minutes through the day, hourly, or daily (an hour
 * range such as 08:00 to 17:59 is daily), which is all the shapes this repository uses.
 */
function staleAfterMs(spec) {
  if (spec.every) return Math.max(spec.every * 3, 15 * 60_000);
  const [minute = "", hour = "*"] = String(spec.pattern || "").trim().split(/\s+/);
  const step = /^\*\/(\d+)$/.exec(minute);
  if (step && hour === "*") return Math.max(Number(step[1]) * 3 * 60_000, 15 * 60_000);
  return hour === "*" || hour.startsWith("*/") ? 3 * 3600_000 : 26 * 3600_000;
}

/**
 * On time, failing, late or waiting, and why.
 * @param {object} spec    a defineSchedule() spec
 * @param {object|undefined} row  its schedule_run row; undefined when the worker never started it
 * @param {{now: number, next?: number|null, queued?: boolean|null}} at
 *   next    the queue's next tick for it (ms), when Redis answered
 *   queued  whether the schedule queue holds it; null when Redis was not read
 * @returns {{state: "on_time"|"failing"|"late"|"waiting", reason: string|null}}
 */
function judge(spec, row, { now, next = null, queued = null }) {
  const allowance = staleAfterMs(spec);
  if (!row) return { state: "late", reason: "Never started by the worker" };
  if (!spec.inProcess && queued === false) return { state: "late", reason: "Missing from the schedule queue" };
  if (!spec.inProcess && next && now - next > OVERDUE_MS)
    return { state: "late", reason: `Its tick is ${inWords(now - next)} overdue: no worker is taking it` };
  const last = row.last_run_at ? new Date(row.last_run_at).getTime() : null;
  if (last === null) {
    const started = row.created_at ? new Date(row.created_at).getTime() : null;
    if (started === null || now - started > allowance) return { state: "late", reason: "Has never run" };
    return { state: "waiting", reason: "Its first slot has not come yet" };
  }
  if (now - last > allowance) return { state: "late", reason: `Has not run for ${inWords(now - last)}` };
  if (row.ok === false) return { state: "failing", reason: "Its last run failed" };
  return { state: "on_time", reason: null };
}

/**
 * Every scheduler, in the order SCHEDULERS lists them.
 * @param {{db?: {query: Function}|null, redis?: boolean, now?: number}} [opts]
 *   redis  read the schedule queue for each job's next tick (false: skip Redis)
 * @returns {Promise<{jobs: object[], db_error: string|null, queue_error: string|null}>}
 */
/** schedule_run, or why it could not be read. */
async function readRuns(db) {
  if (!db) return { rows: null, error: "the database was not asked" };
  try {
    const { rows } = await within(
      db.query(
        `SELECT name, last_run_at, duration_ms, ok, note, runs, failures, last_failure_at, created_at
           FROM schedule_run`,
      ),
      "the database",
    );
    return { rows, error: null };
  } catch (err) {
    // A database from before 9110 has no table yet: say so rather than read as broken.
    return {
      rows: null,
      error: err.code === "42P01" ? "no schedule_run table yet" : scrub(String(err.message || err)).slice(0, 200),
    };
  }
}

/** Each queue-ticked job's next tick from the schedule queue, or why it could not be read. */
async function readTicks(redis) {
  if (!redis) return { ticks: null, error: "Redis was not asked" };
  try {
    if (!require("../config/redis").tryClient()) throw new Error("Redis is not connected");
    const queue = require("./queues").getQueue(registry.SCHEDULE_QUEUE);
    const list = await within(queue.getJobSchedulers(0, -1), "Redis");
    return { ticks: new Map(list.map((j) => [j.key || j.id || j.name, j.next ? Number(j.next) : null])), error: null };
  } catch (err) {
    return { ticks: null, error: scrub(String(err.message || err)).slice(0, 200) };
  }
}

async function schedulers({ db = null, redis = true, now = Date.now() } = {}) {
  const specs = registry.schedules();
  // Side by side: together they must fit inside one readiness probe's two seconds.
  const [{ rows, error: dbError }, { ticks, error: queueError }] = await Promise.all([
    readRuns(db),
    readTicks(redis),
  ]);

  const seen = new Map((rows || []).map((r) => [r.name, r]));
  const jobs = specs.map((spec) => {
    const row = seen.get(spec.name);
    const last = row && row.last_run_at ? new Date(row.last_run_at).getTime() : null;
    const next = spec.inProcess
      ? last && spec.every
        ? last + spec.every
        : null
      : ticks
        ? ticks.get(spec.name) ?? null
        : null;
    const verdict = rows
      ? judge(spec, row, { now, next, queued: spec.inProcess || !ticks ? null : ticks.has(spec.name) })
      : { state: "late", reason: "Its runs could not be read" };
    return {
      name: spec.name,
      summary: spec.summary || null,
      runs_in: spec.inProcess ? "worker" : "queue",
      cadence: cadenceOf(spec),
      set_as: setAsOf(spec),
      late_after: inWords(staleAfterMs(spec)),
      state: verdict.state,
      reason: verdict.reason,
      started_at: iso(row && row.created_at),
      last_run_at: iso(row && row.last_run_at),
      duration_ms: row && row.duration_ms !== null && row.duration_ms !== undefined ? Number(row.duration_ms) : null,
      last_ok: row && typeof row.ok === "boolean" ? row.ok : null,
      last_error: row && row.ok === false && row.note ? scrub(String(row.note)).slice(0, 500) : null,
      runs: row ? Number(row.runs) || 0 : 0,
      failures: row ? Number(row.failures) || 0 : 0,
      last_failure_at: iso(row && row.last_failure_at),
      next_run_at: iso(next),
    };
  });
  return { jobs, db_error: dbError, queue_error: queueError };
}

/**
 * Every queue the worker consumes, with what it holds and its newest failure. `failed`
 * counts the failed jobs still kept (BullMQ keeps the last 5,000), not today's.
 * @returns {Promise<{queues: object[], error: string|null}>}
 */
async function queues() {
  const declared = [
    ...registry.JOBS.map((j) => ({ queue: j.queue, summary: j.summary || null, concurrency: j.concurrency })),
    { queue: registry.SCHEDULE_QUEUE, summary: "One tick of every scheduler the queue drives", concurrency: 2 },
  ];
  try {
    if (!require("../config/redis").tryClient()) throw new Error("Redis is not connected");
    const { getQueue } = require("./queues");
    const out = await within(
      Promise.all(
        declared.map(async (d) => {
          const q = getQueue(d.queue);
          const [counts, failed] = await Promise.all([
            q.getJobCounts("waiting", "prioritized", "active", "delayed", "failed", "paused"),
            q.getFailed(0, 0),
          ]);
          const last = failed && failed[0];
          return {
            ...d,
            waiting: (counts.waiting || 0) + (counts.prioritized || 0),
            active: counts.active || 0,
            delayed: counts.delayed || 0,
            failed: counts.failed || 0,
            paused: counts.paused || 0,
            last_failed_at: last && last.finishedOn ? new Date(last.finishedOn).toISOString() : null,
            last_failure: last && last.failedReason ? scrub(String(last.failedReason)).slice(0, 500) : null,
          };
        }),
      ),
      "Redis",
    );
    return { queues: out, error: null };
  } catch (err) {
    return { queues: [], error: scrub(String(err.message || err)).slice(0, 200) };
  }
}

module.exports = {
  OVERDUE_MS,
  inWords,
  everyInWords,
  cadenceOf,
  setAsOf,
  staleAfterMs,
  judge,
  schedulers,
  queues,
};
