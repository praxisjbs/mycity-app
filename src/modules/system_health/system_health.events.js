"use strict";
/**
 * What System Health tells people, and the work behind the brief. Loaded by the API and
 * the worker (docs/guides/system-health.md §7).
 *
 * Who hears it: holders of `system_health` view, which the seed gives to the
 * Implementation Team and the System Administrator only. Not Operations & People, not
 * Management, and not the CEO: the fan-out never adds the CEO to a permission audience,
 * so a stack trace never reaches her phone.
 *
 * How it reaches them: the System Health notification category is locked, like Security,
 * so the bell and push cannot be switched off and a fault reaches every device a person
 * has registered. Email is off for the category and declared only on the 24 hour
 * escalation, which is the one notice that has waited long enough to deserve an inbox.
 *
 * WhatsApp is deliberately not used here. ALERT_WHATSAPP_URLS stays as it is for the
 * infrastructure alerts that are nothing to do with the app's own engine (the uptime
 * probe, the nightly backup, the restore drill).
 */
const { pool } = require("../../config/db");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");
const outbox = require("../../shared/events/outbox");

const EVENTS = defineEvents("system_health", {
  "system_health.check_down": { summary: "A readiness check stopped answering" },
  "system_health.check_recovered": { summary: "A readiness check started answering again" },
  "system_health.fault_new": { summary: "A fault was reported for the first time" },
  "system_health.fault_returned": { summary: "A fault marked fixed happened again" },
  "system_health.fault_spiked": { summary: "A fault started happening far more often" },
  "system_health.fault_unattended": { summary: "A fault has been open for a day with nobody on it" },
  "system_health.digest": { summary: "The daily System Health summary" },
  "system_health.brief_requested": { summary: "A fault brief was downloaded" },
  "system_health.status_brief_requested": { summary: "A status brief was downloaded" },
  "system_health.targets_changed": { summary: "The performance targets or warning levels were changed" },
});

/** The file a brief is kept in. Restricted: it carries stack traces. */
const BRIEF_DOC_TYPE = "system_health_brief";

defineDocumentType(BRIEF_DOC_TYPE, {
  label: "System Health brief",
  module: "system_health",
  sensitivity: "restricted",
  export: true,
});

/** The file a status brief is kept in. Restricted: it names the server's paths and units. */
const STATUS_BRIEF_DOC_TYPE = "system_health_status_brief";

defineDocumentType(STATUS_BRIEF_DOC_TYPE, {
  label: "System Health status brief",
  module: "system_health",
  sensitivity: "restricted",
  export: true,
});

/** Everyone who may open System Health. */
const TO_IT = [{ permission: ["system_health", "view"] }];
const WHO = "Whoever holds System Health";

/** A down database, cache or worker stops the app; anything else degrades it. */
const FATAL_CHECKS = new Set(["postgres", "redis", "worker"]);

defineNotification(EVENTS.SYSTEM_HEALTH_CHECK_DOWN, {
  to: TO_IT,
  who: WHO,
  title: (e) => `${e.payload.label || e.payload.check} is not answering`,
  body: (e) => e.payload.detail || "Open System Health to see what it said.",
  urgency: (e) => (FATAL_CHECKS.has(e.payload.check) ? "urgent" : "important"),
  push: { tag: (e) => `system_health_check:${e.payload.check}`, mode: "alert" },
});

defineNotification(EVENTS.SYSTEM_HEALTH_CHECK_RECOVERED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `${e.payload.label || e.payload.check} is answering again`,
  body: (e) => `It was not answering for ${e.payload.down_for || "a while"}.`,
  urgency: "normal",
  push: { tag: (e) => `system_health_check:${e.payload.check}`, mode: "quiet" },
});

defineNotification(EVENTS.SYSTEM_HEALTH_FAULT_NEW, {
  to: TO_IT,
  who: WHO,
  title: (e) => `New fault: ${e.payload.title || "something failed"}`,
  body: (e) => `${e.payload.plainly || ""}`.trim() || "Open it in System Health.",
  urgency: (e) => (e.payload.severity === "fatal" ? "urgent" : "important"),
  push: { tag: (e) => `system_health_fault:${e.payload.error_group_id}`, mode: "alert" },
});

defineNotification(EVENTS.SYSTEM_HEALTH_FAULT_RETURNED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `Back again: ${e.payload.title || "a fault marked fixed"}`,
  body: (e) =>
    `It was marked fixed and has happened again, for the ${e.payload.regressions === 1 ? "first" : `${e.payload.regressions}${e.payload.regressions === 2 ? "nd" : e.payload.regressions === 3 ? "rd" : "th"}`} time.`,
  urgency: "important",
  push: { tag: (e) => `system_health_fault:${e.payload.error_group_id}`, mode: "alert" },
});

defineNotification(EVENTS.SYSTEM_HEALTH_FAULT_SPIKED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `Happening fast: ${e.payload.title || "a fault"}`,
  body: (e) => `${e.payload.last_hour || "Several"} in the last hour, far more than usual.`,
  urgency: "important",
  push: { tag: (e) => `system_health_fault:${e.payload.error_group_id}`, mode: "alert" },
});

/**
 * The one notice that reaches email. A fault nobody has touched for a day is no longer
 * something a push at the wrong moment will fix, so it goes where it will still be
 * sitting tomorrow. People can still turn email off for it in Settings · Notifications.
 */
defineNotification(EVENTS.SYSTEM_HEALTH_FAULT_UNATTENDED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `A day with nobody on it: ${e.payload.title || "a fault"}`,
  body: (e) =>
    `Open for ${e.payload.first_seen || "a day"} with nobody on it. Set it to Being Handled, Fixed or Ignored to stop this.`,
  urgency: "important",
  channels: { email: true },
  push: { tag: (e) => `system_health_fault:${e.payload.error_group_id}`, mode: "alert" },
});

defineNotification(EVENTS.SYSTEM_HEALTH_DIGEST, {
  to: TO_IT,
  who: WHO,
  title: (e) =>
    e.payload.open === 0 && e.payload.checks_down === 0
      ? "System Health: nothing to do"
      : `System Health: ${e.payload.open} open`,
  body: (e) =>
    [
      `${e.payload.new_today} new`,
      `${e.payload.came_back} came back`,
      `${e.payload.unattended} with nobody on them`,
      e.payload.checks_down ? `${e.payload.checks_down} checks not up` : null,
    ]
      .filter(Boolean)
      .join(", ") + ".",
  urgency: "normal",
  push: { tag: () => "system_health_digest", mode: "quiet" },
});

/**
 * The brief's outbox handler: the Markdown written into the file the request reserved,
 * which the screen is waiting on and downloads on the device that pressed.
 * @param {object} event  system_health.brief_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildBrief(event, ctx) {
  const exportFiles = require("../../shared/documents/exports");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const { config } = require("../../config/env");
  const brief = require("./system_health.brief");
  const repo = require("./system_health.repo");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");

  await exportFiles.make(p.document_id, ctx, async () => {
    const service = require("./system_health.service");
    const groups = await repo.getMany(pool, p.error_group_ids || []);
    const faults = [];
    for (const group of groups) {
      faults.push({
        group: { ...group, notes: await repo.notes(pool, group.error_group_id) },
        occurrences: await repo.occurrences(pool, group.fingerprint),
      });
    }
    // What the system looked like: now, and at each occurrence (guide §6). A snapshot is
    // recent within two of its five-minute intervals.
    const last = await repo.lastSnapshot(pool);
    const recent = last && Date.now() - new Date(last.taken_at).getTime() < service.SNAPSHOT_RECENT_MS;
    const moments = faults.flatMap((f) => f.occurrences.map((o) => o.occurred_at));
    const around = await repo.snapshotsAround(pool, moments);
    let i = 0;
    for (const f of faults) {
      for (const o of f.occurrences) {
        const snap = around[i++];
        o.system = snap && snap.taken_at ? { taken_at: snap.taken_at, not_up: service.notUpIn(snap.checks) } : null;
      }
    }
    return Buffer.from(
      brief.build({
        faults,
        downloaded_by: reader.display_name || null,
        release: config.BUILD_SHA || "local",
        system: recent ? { taken_at: last.taken_at, not_up: service.notUpIn(last.checks) } : null,
      }),
      "utf8",
    );
  });
}

/**
 * The status brief's outbox handler: the whole system written into the file the request
 * reserved. The checks are the API's, carried in the event; everything else is read now.
 * @param {object} event  system_health.status_brief_requested
 * @param {{attempt: number, max_attempts: number}} ctx  the outbox's
 */
async function buildStatusBrief(event, ctx) {
  const exportFiles = require("../../shared/documents/exports");
  const grantsCache = require("../../shared/rbac/grants-cache");
  const service = require("./system_health.service");
  const statusBrief = require("./system_health.status-brief");

  const p = event.payload || {};
  if (!p.document_id) return;
  const reader = await grantsCache.getAuthUser(pool, p.requested_by || event.actor_user_id);
  if (!reader || reader.status !== "active")
    return exportFiles.fail(p.document_id, "The person who asked is no longer active.");

  await exportFiles.make(p.document_id, ctx, async () => {
    const input = await service.statusBriefInput({ checks: p.checks || {} });
    return Buffer.from(
      statusBrief.build({
        ...input,
        now: p.checked_at ? new Date(p.checked_at) : input.now,
        made: { how: "screen", by: reader.display_name || null },
      }),
      "utf8",
    );
  });
}

outbox.register(EVENTS.SYSTEM_HEALTH_BRIEF_REQUESTED, "system_health.build_brief", (event, ctx) =>
  buildBrief(event, ctx),
);

outbox.register(EVENTS.SYSTEM_HEALTH_STATUS_BRIEF_REQUESTED, "system_health.build_status_brief", (event, ctx) =>
  buildStatusBrief(event, ctx),
);

module.exports = { EVENTS, BRIEF_DOC_TYPE, STATUS_BRIEF_DOC_TYPE, TO_IT, FATAL_CHECKS, buildBrief, buildStatusBrief };
