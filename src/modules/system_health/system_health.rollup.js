"use strict";
/**
 * The worker's five minutes of System Health work (docs/guides/system-health.md §3).
 *
 *   rollup()    group what the reporter wrote, notice what came back or is spiking,
 *               take a snapshot, and compare it with the one before
 *   escalate()  faults open a day with nobody on them
 *   digest()    the 08:00 summary
 *
 * Why the grouping happens here and not in the reporter: `error-reporter.js` writes on
 * the path of a request that has already gone wrong, and its own comment says a reporter
 * that breaks the thing it reports on is worse than none. It stays a plain insert. All
 * the thinking is here, where a failure only delays a notification.
 *
 * Everything is idempotent. A run that dies half way, or two runs overlapping after a
 * restart, leaves the same rows: groups upsert on the fingerprint, a regression only
 * counts while the status is still `fixed`, a spike is held off for six hours by
 * `spiked_at`, and an escalation by `escalated_at`.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");
const { atomically } = require("../../shared/db/tx");
const { emit } = require("../../shared/events/emit");
const repo = require("./system_health.repo");
const { explain } = require("./system_health.explain");
const { EVENTS } = require("./system_health.events");
const { ALERT_SEVERITIES } = require("../../shared/observability/error-reporter");

/** How far back a run looks. Wider than the 5 minute pace, so a late write is never missed. */
const LOOKBACK_MINUTES = 15;
/** Faults rolled up in one run, so a storm cannot hold the worker. */
const MAX_PER_RUN = 200;

/** Nobody acted on the system's behalf: these events have no person behind them. */
const SYSTEM = null;

/** Only a fatal or an error is told; a warning or a notice is counted on Faults, nothing more (§6). */
const tells = (g) => ALERT_SEVERITIES.has(g.severity);

const tx = async (fn) => {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
};

/** The title a person reads: the message with its ids already normalised. */
function titleOf(row) {
  const message = String(row.last_message || "").replace(/\s+/g, " ").trim();
  const name = String(row.name || "Error");
  const text = message && !message.startsWith(name) ? `${name}: ${message}` : message || name;
  return text.slice(0, 500);
}

/**
 * Group everything written since the last run, and tell the IT team about what is worth
 * telling: a fault seen for the first time, one that came back after somebody marked it
 * fixed, and one that has started happening far faster than it does. A warning or a notice
 * is grouped and reopened like any other, but never told (TB, 20/10/2026).
 * @returns {Promise<{groups: number, new: number, returned: number, spiking: number}>}
 */
async function rollupFaults(now = new Date()) {
  const from = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000).toISOString();
  const rows = (await repo.recentFingerprints(pool, from)).slice(0, MAX_PER_RUN);
  const done = { groups: 0, new: 0, returned: 0, spiking: 0 };

  for (const row of rows) {
    try {
      const group = await tx(async (client) => {
        const g = await repo.upsertGroup(client, { ...row, title: titleOf(row) });
        if (g && g.is_new && tells(g)) {
          await emit(client, {
            key: EVENTS.SYSTEM_HEALTH_FAULT_NEW,
            entity: { type: "error_group", id: g.error_group_id },
            actor: SYSTEM,
            payload: {
              error_group_id: g.error_group_id,
              title: g.title,
              severity: g.severity,
              origin: g.origin,
              route: g.route,
              plainly: explain(g),
            },
          });
        }
        return g;
      });
      done.groups += 1;
      if (group && group.is_new) done.new += 1;

      // Came back: only ever from `fixed`, and only while it is still `fixed`, so two
      // overlapping runs cannot count one return twice.
      if (group && !group.is_new && group.status === "fixed") {
        const back = await tx(async (client) => {
          const r = await repo.markReturned(client, group.error_group_id);
          if (r) {
            await repo.addNote(client, {
              error_group_id: r.error_group_id,
              author_user_id: SYSTEM,
              body: "It happened again after it was marked fixed, so it is open again.",
            });
            if (tells(r)) {
              await emit(client, {
                key: EVENTS.SYSTEM_HEALTH_FAULT_RETURNED,
                entity: { type: "error_group", id: r.error_group_id },
                actor: SYSTEM,
                payload: { error_group_id: r.error_group_id, title: r.title, regressions: r.regressions },
              });
            }
          }
          return r;
        });
        if (back) done.returned += 1;
      }

      if (group && tells(group) && (await repo.spiking(pool, group.fingerprint))) {
        const told = await tx(async (client) => {
          const { rowCount } = await repo.markSpiked(client, group.error_group_id);
          if (!rowCount) return false;
          await emit(client, {
            key: EVENTS.SYSTEM_HEALTH_FAULT_SPIKED,
            entity: { type: "error_group", id: group.error_group_id },
            actor: SYSTEM,
            payload: { error_group_id: group.error_group_id, title: group.title },
          });
          return true;
        });
        if (told) done.spiking += 1;
      }
    } catch (err) {
      // One bad fingerprint must not stop the rest, and a failed roll-up must never
      // become a fault of its own: the next run picks it up inside the lookback.
      logger.warn({ err, fingerprint: row.fingerprint }, "system health could not roll up a fault");
    }
  }
  return done;
}

/** How long something has been down, in the words a notice uses. */
function since(from, now) {
  const minutes = Math.max(1, Math.round((now - new Date(from)) / 60_000));
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${Math.round(hours / 24)} days`;
}

/**
 * Take a snapshot, and compare it with the one before: a check that has left `up` is
 * told once, and so is one that has come back. Comparing with the previous row rather
 * than holding state in memory means a worker restart never re-tells a check that was
 * already down.
 */
async function snapshot(now = new Date()) {
  const { runChecks } = require("../../http/health");
  const service = require("./system_health.service");
  const [{ checks, fatal, degraded }, counts, previous] = await Promise.all([
    runChecks(),
    repo.faultCounts(pool),
    repo.lastSnapshot(pool),
  ]);
  const state = fatal ? "unavailable" : degraded ? "degraded" : "ready";
  const outbox = checks.outbox || {};
  const worker = checks.worker || {};
  const disk = checks.disk || {};
  const memory = checks.memory || {};
  const cpu = checks.cpu || {};
  const db = checks.database_usage || {};

  // The traffic of the five minutes just gone, as the API recorded it minute by minute.
  const traffic = await repo.trafficSince(pool, 5).catch(() => null);
  const requests = traffic ? Number(traffic.requests) : 0;
  const errors = traffic ? Number(traffic.errors) : 0;
  const totalMs = traffic ? Number(traffic.total_ms) : 0;

  await tx((client) =>
    repo.addSnapshot(client, {
      status: state,
      checks,
      outbox_backlog: Number(outbox.backlog) || 0,
      worker_lag_s: worker.last_beat_s !== undefined ? Number(worker.last_beat_s) : null,
      faults_open: counts ? counts.faults_open : 0,
      faults_new_24h: counts ? counts.faults_new_24h : 0,
      release: config.BUILD_SHA || "local",
      disk_free_pct: disk.free_pct ?? null,
      memory_used_pct: memory.used_pct ?? null,
      cpu_load: cpu.load ?? null,
      database_mb: db.size_mb ?? null,
      database_connections_pct: db.connections_pct ?? null,
      // Null, not zero, when nothing was served: a quiet window is a gap, not 0 ms.
      requests,
      error_pct: requests ? Math.round((errors * 10000) / requests) / 100 : null,
      mean_ms: requests ? Math.round(totalMs / requests) : null,
    }),
  );

  const before = (previous && previous.checks) || {};
  const told = { down: 0, recovered: 0 };
  for (const [key, value] of Object.entries(checks)) {
    const was = before[key] && before[key].status;
    const is = value.status;
    // Mail paused or resumed on purpose: its own notice told IT already (integrations.events.js).
    if (service.pausedMail(key, value) || service.pausedMail(key, before[key])) continue;
    // Only the moment it changes. A check that stays down is already on somebody's phone.
    if (is !== "up" && (was === "up" || was === undefined) && previous) {
      await tx((client) =>
        emit(client, {
          key: EVENTS.SYSTEM_HEALTH_CHECK_DOWN,
          entity: { type: "health_snapshot", id: previous.health_snapshot_id },
          actor: SYSTEM,
          payload: { check: key, label: service.label(key), state: is, detail: service.detailOf(key, value) },
        }),
      );
      told.down += 1;
    } else if (is === "up" && was !== undefined && was !== "up") {
      await tx((client) =>
        emit(client, {
          key: EVENTS.SYSTEM_HEALTH_CHECK_RECOVERED,
          entity: { type: "health_snapshot", id: previous.health_snapshot_id },
          actor: SYSTEM,
          payload: { check: key, label: service.label(key), down_for: since(previous.taken_at, now) },
        }),
      );
      told.recovered += 1;
    }
  }
  return { state, ...told };
}

/** Everything the five-minute scheduler does. */
async function rollup(now = new Date()) {
  const faults = await rollupFaults(now);
  const checks = await snapshot(now);
  const escalated = await escalate(now);
  return { ...faults, ...checks, escalated };
}

/**
 * Faults still open a day after they were first seen, with nobody on them. This is the
 * one notice that carries email: a push at the wrong moment has already failed to work.
 * It repeats every 24 hours until the status changes, which `escalated_at` paces.
 */
async function escalate(now = new Date()) {
  const rows = await repo.unattended(pool);
  if (!rows.length) return 0;
  for (const g of rows) {
    await tx(async (client) => {
      await emit(client, {
        key: EVENTS.SYSTEM_HEALTH_FAULT_UNATTENDED,
        entity: { type: "error_group", id: g.error_group_id },
        actor: SYSTEM,
        payload: {
          error_group_id: g.error_group_id,
          title: g.title,
          severity: g.severity,
          first_seen: since(g.first_seen_at, now),
        },
      });
      await repo.markEscalated(client, [g.error_group_id]);
    });
  }
  return rows.length;
}

/** The 08:00 Lagos summary, whether or not there is anything wrong. */
async function digest() {
  const figures = (await repo.digestFigures(pool)) || {};
  const last = await repo.lastSnapshot(pool);
  const checksDown = last && last.checks
    ? Object.values(last.checks).filter((c) => c && c.status !== "up").length
    : 0;
  await tx((client) =>
    emit(client, {
      key: EVENTS.SYSTEM_HEALTH_DIGEST,
      entity: { type: "health_snapshot", id: (last && last.health_snapshot_id) || crypto.randomUUID() },
      actor: SYSTEM,
      payload: {
        open: figures.open || 0,
        serious: figures.serious || 0,
        new_today: figures.new_today || 0,
        came_back: figures.came_back || 0,
        unattended: figures.unattended || 0,
        checks_down: checksDown,
      },
    }),
  );
  return { ...figures, checks_down: checksDown };
}

module.exports = {
  LOOKBACK_MINUTES,
  MAX_PER_RUN,
  titleOf,
  since,
  rollupFaults,
  snapshot,
  rollup,
  escalate,
  digest,
};
