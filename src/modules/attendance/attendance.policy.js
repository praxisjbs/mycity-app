"use strict";
/**
 * The attendance policy: the one write path for its draft, its versions and each person's
 * acknowledgement, and the reads behind Settings · Attendance Policy and ESS · Policy Updates
 * (docs/guides/attendance.md §6.15).
 *
 *   saveDraft     `settings` edit saves every rule as the draft; the first save creates it. Nobody
 *                 is told
 *   publish       the draft becomes the next version (`Version N`) from a first day, today or
 *                 later and after any version still waiting, with People's note; everyone at work
 *                 with a login is told
 *   withdraw      a version waiting to start never applies; when there is no draft its rules
 *                 become the draft
 *   acknowledge   an employee acknowledges the newest version; their notices about it are read.
 *                 A record, never a gate: the clock judges a punch the same either way
 *   reminders     the reminder engine's find and check for `attendance_policy_unacknowledged`
 *                 (attendance.events.js): once, 3 days after a version is published, each person
 *                 asked who has not acknowledged it (docs/guides/notifications.md §7.1)
 *
 * The rules in force on a date are attendance.calendar.js policyFor's (§6.1); a punch keeps the
 * version it was judged by. Changes run one at a time under the policy's lock. Events carry the
 * version's id, number and first day.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { scopeFor } = require("../../middleware/rbac");
const lagos = require("../../shared/time/lagos");
const notifications = require("../notifications/notifications.service");
const calendar = require("./attendance.calendar");
const repo = require("./attendance.repo");
const { EVENTS } = require("./attendance.events");

/** How far ahead a version may start, in days. */
const AHEAD_DAYS = 90;
/** How long after a version is published the people who have not acknowledged it are reminded. */
const REMIND_AFTER_DAYS = 3;
const RULES = repo.RULE_COLUMNS;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That policy version does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);

/* ------------------------------------------------------------------ *
 * Pure
 * ------------------------------------------------------------------ */

/** A row's rules as PolicySettings. */
function settingsOf(row) {
  return {
    grace_minutes: Number(row.grace_minutes),
    office_geofence_mode: row.office_geofence_mode,
    home_geofence_mode: row.home_geofence_mode,
    site_geofence_mode: row.site_geofence_mode,
    device_mode: row.device_mode,
    max_accuracy_m: Number(row.max_accuracy_m),
    home_radius_m: Number(row.home_radius_m),
  };
}

/** The rules `next` changes against `base`, in PolicySettings' order; none against nothing. */
function changedRules(next, base) {
  if (!base) return [];
  return RULES.filter((k) => String(next[k]) !== String(base[k]));
}

/**
 * A version's state on `today` (§6.15): withdrawn, waiting (its first day after today), in force
 * (the one `inForceId` names) or past.
 */
function stateOf(row, today, inForceId) {
  if (row.status === "withdrawn") return "withdrawn";
  if (row.effective_from > today) return "waiting";
  return row.attendance_policy_id === inForceId ? "in_force" : "past";
}

/** What every version carries, for People and for staff. */
function versionBase(row, today, inForceId) {
  return {
    attendance_policy_id: row.attendance_policy_id,
    version: Number(row.version),
    state: stateOf(row, today, inForceId),
    effective_from: row.effective_from,
    note: row.note,
    published_at: iso(row.published_at),
    withdrawn_at: iso(row.withdrawn_at),
    changed: changedRules(row, row.previous),
    ...settingsOf(row),
  };
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** The rules in force today, as PolicySettings (a version, an older row, or the code's). */
async function currentRules(db, today) {
  return settingsOf(await calendar.policyFor(db, null, today));
}

/** A version as People read it, with how many acknowledged it of the people asked now. */
function asVersion(row, { today, inForceId, acknowledged, asked }) {
  return {
    ...versionBase(row, today, inForceId),
    published_by_name: row.published_by_name || null,
    withdraw_reason: row.withdraw_reason || null,
    acknowledged: acknowledged.get(row.attendance_policy_id) || 0,
    asked,
  };
}

/** The version in force today, the newest waiting, and what People need to read them. */
async function landscape(db, today) {
  const [inForce, newest] = await Promise.all([repo.versionInForce(db, today), repo.newestVersion(db)]);
  const waiting = newest && newest.effective_from > today ? newest : null;
  return { inForce, waiting, inForceId: inForce ? inForce.attendance_policy_id : null };
}

/** GET /attendance/policy. */
async function overview(user, { db = pool } = {}) {
  const today = lagos.today();
  const { inForce, waiting, inForceId } = await landscape(db, today);
  const ids = [inForce, waiting].filter(Boolean).map((r) => r.attendance_policy_id);
  const [acknowledged, asked, current, draft, editor] = await Promise.all([
    repo.acknowledgedCounts(db, ids, today),
    repo.askedCount(db, today),
    currentRules(db, today),
    repo.policyDraft(db),
    scopeFor(user, "settings", "edit"),
  ]);
  const meta = { today, inForceId, acknowledged, asked };
  // The draft is read against the version it would replace: the newest, else the rules in force.
  const base = waiting ? settingsOf(waiting) : inForce ? settingsOf(inForce) : current;
  return {
    today,
    current,
    in_force: inForce ? asVersion(inForce, meta) : null,
    waiting: waiting ? asVersion(waiting, meta) : null,
    draft: draft
      ? {
          attendance_policy_id: draft.attendance_policy_id,
          ...settingsOf(draft),
          changed: changedRules(settingsOf(draft), base),
          updated_at: iso(draft.updated_at),
          updated_by_name: draft.updated_by_name || null,
        }
      : null,
    can_edit: Boolean(editor),
  };
}

/** GET /attendance/policy/versions. */
async function versions(query) {
  const today = lagos.today();
  const { inForceId } = await landscape(pool, today);
  const page = await repo.listVersions(pool, query, { today, inForceId });
  const [acknowledged, asked] = await Promise.all([
    repo.acknowledgedCounts(pool, page.data.map((r) => r.attendance_policy_id), today),
    repo.askedCount(pool, today),
  ]);
  const meta = { today, inForceId, acknowledged, asked };
  return { ...page, data: page.data.map((row) => asVersion(row, meta)) };
}

/** GET /attendance/policy/versions/:id. */
async function version(id) {
  const today = lagos.today();
  const row = await repo.getVersion(pool, id);
  if (!row) throw notFound();
  const { inForceId } = await landscape(pool, today);
  const [acknowledged, asked] = await Promise.all([
    repo.acknowledgedCounts(pool, [id], today),
    repo.askedCount(pool, today),
  ]);
  return asVersion(row, { today, inForceId, acknowledged, asked });
}

/** GET /attendance/policy/versions/:id/acknowledgements: everyone asked, within the reader's scope. */
async function acknowledgements(id, query, scope) {
  if (!(await repo.getVersion(pool, id))) throw notFound();
  const page = await repo.listAcknowledgements(pool, id, query, scope, lagos.today());
  return {
    ...page,
    data: page.data.map((r) => ({
      employee: r.employee,
      acknowledged_at: iso(r.acknowledged_at),
      reminded_at: iso(r.reminded_at),
    })),
  };
}

/** A version as an employee reads it, with their own acknowledgement. */
const asMine = (row, today, inForceId) => ({
  ...versionBase(row, today, inForceId),
  acknowledged_at: iso(row.acknowledged_at),
});

/** GET /attendance/me/policy. */
async function mine(user, { db = pool } = {}) {
  const today = lagos.today();
  const { inForce, inForceId } = await landscape(db, today);
  const newest = await repo.newestVersion(db);
  let latest = null;
  if (newest) {
    const ack = await repo.acknowledgementOf(db, newest.attendance_policy_id, user.employee_id);
    latest = asMine({ ...newest, acknowledged_at: ack ? ack.acknowledged_at : null }, today, inForceId);
  }
  return {
    today,
    current: await currentRules(db, today),
    latest,
    in_force_version: inForce ? Number(inForce.version) : null,
  };
}

/** GET /attendance/me/policy/versions. */
async function myVersions(user, query) {
  const today = lagos.today();
  const { inForceId } = await landscape(pool, today);
  const page = await repo.listVersions(pool, query, { employeeId: user.employee_id, today, inForceId });
  return { ...page, data: page.data.map((row) => asMine(row, today, inForceId)) };
}

/** GET /attendance/me/policy/versions/:id. */
async function myVersion(user, id) {
  const today = lagos.today();
  const row = await repo.getVersion(pool, id);
  if (!row) throw notFound();
  const { inForceId } = await landscape(pool, today);
  const ack = await repo.acknowledgementOf(pool, id, user.employee_id);
  return asMine({ ...row, acknowledged_at: ack ? ack.acknowledged_at : null }, today, inForceId);
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * PUT /attendance/policy/draft.
 * @param {{user_id: string}} user
 * @param {object} rules  PolicySettings, checked by the contract
 */
async function saveDraft(user, rules) {
  await tx(async (client) => {
    await repo.lockPolicy(client);
    const today = lagos.today();
    const draft = await repo.policyDraft(client);
    const base = await calendar.policyFor(client, null, today);
    const before = draft ? settingsOf(draft) : settingsOf(base);
    const after = settingsOf(rules);
    const row = draft
      ? await repo.updateDraft(client, draft.attendance_policy_id, after, user.user_id)
      : await repo.insertDraft(client, after, base, user.user_id);
    await emit(client, {
      key: EVENTS.ATTENDANCE_POLICY_DRAFT_SAVED,
      entity: { type: "attendance_policy", id: row.attendance_policy_id },
      actor: user,
      before,
      after,
      payload: { attendance_policy_id: row.attendance_policy_id, created: !draft },
    });
  });
  return overview(user);
}

/** POST /attendance/policy/draft/discard. */
async function discardDraft(user) {
  await tx(async (client) => {
    await repo.lockPolicy(client);
    const draft = await repo.policyDraft(client);
    if (!draft || !(await repo.deleteDraft(client, draft.attendance_policy_id)))
      throw new AppError("NO_DRAFT", "There are no draft changes", 409);
    await emit(client, {
      key: EVENTS.ATTENDANCE_POLICY_DRAFT_DISCARDED,
      entity: { type: "attendance_policy", id: draft.attendance_policy_id },
      actor: user,
      before: settingsOf(draft),
      payload: { attendance_policy_id: draft.attendance_policy_id },
    });
  });
  return overview(user);
}

/**
 * POST /attendance/policy/publish.
 * @param {{user_id: string}} user
 * @param {{effective_from: string, note: string}} body
 */
async function publish(user, body) {
  const today = lagos.today();
  const from = body.effective_from;
  if (from < today)
    throw new AppError("POLICY_IN_THE_PAST", "The first day is today or later.", 422, {
      effective_from: ["Today or later"],
    });
  if (from > lagos.addDays(today, AHEAD_DAYS))
    throw new AppError("POLICY_TOO_FAR", `The first day is within ${AHEAD_DAYS} days.`, 422, {
      effective_from: [`Within ${AHEAD_DAYS} days`],
    });
  await tx(async (client) => {
    await repo.lockPolicy(client);
    const draft = await repo.policyDraft(client);
    if (!draft) throw new AppError("NO_DRAFT", "Save the changes as a draft first", 409);
    const newest = await repo.newestVersion(client);
    if (newest && changedRules(settingsOf(draft), settingsOf(newest)).length === 0)
      throw new AppError("NO_CHANGES", "The draft changes nothing", 409);
    const waitingStart = await repo.lastWaitingStart(client, today);
    if (waitingStart && from <= waitingStart)
      throw new AppError("POLICY_BEFORE_WAITING", "Start it after the version waiting to start.", 422, {
        effective_from: ["After the waiting version"],
      });
    const number = await repo.nextVersion(client);
    await repo.publishDraft(client, draft.attendance_policy_id, {
      version: number,
      effective_from: from,
      note: body.note,
      userId: user.user_id,
    });
    await emit(client, {
      key: EVENTS.ATTENDANCE_POLICY_PUBLISHED,
      entity: { type: "attendance_policy", id: draft.attendance_policy_id },
      actor: user,
      before: newest ? { version: Number(newest.version), ...settingsOf(newest) } : null,
      after: { version: number, effective_from: from, ...settingsOf(draft) },
      payload: { attendance_policy_id: draft.attendance_policy_id, version: number, effective_from: from },
    });
  });
  return overview(user);
}

/**
 * POST /attendance/policy/versions/:id/withdraw.
 * @param {{user_id: string}} user
 * @param {string} id
 * @param {{reason: string}} body
 */
async function withdraw(user, id, body) {
  const today = lagos.today();
  await tx(async (client) => {
    await repo.lockPolicy(client);
    const row = await repo.getVersion(client, id);
    if (!row) throw notFound();
    const done = await repo.withdrawVersion(client, id, { reason: body.reason, userId: user.user_id, today });
    if (!done) throw new AppError("POLICY_NOT_WAITING", "Only a version waiting to start can be withdrawn", 409);
    // Nothing People prepared is lost: with no draft, the withdrawn rules become the draft.
    let draftId = null;
    if (!(await repo.policyDraft(client))) {
      const base = await calendar.policyFor(client, null, today);
      draftId = (await repo.insertDraft(client, settingsOf(row), base, user.user_id)).attendance_policy_id;
    }
    await emit(client, {
      key: EVENTS.ATTENDANCE_POLICY_WITHDRAWN,
      entity: { type: "attendance_policy", id },
      actor: user,
      before: { status: "published" },
      after: { status: "withdrawn", withdraw_reason: body.reason, draft_id: draftId },
      payload: { attendance_policy_id: id, version: Number(row.version), effective_from: row.effective_from },
    });
  });
  return overview(user);
}

/**
 * POST /attendance/me/policy/versions/:id/acknowledge.
 * @param {{user_id: string, employee_id: string}} user  the session's
 * @param {string} id
 */
async function acknowledge(user, id) {
  const employeeId = user.employee_id;
  await tx(async (client) => {
    await repo.lockEmployee(client, employeeId);
    const person = await repo.person(client, employeeId);
    if (!person || person.status !== "active")
      throw new AppError("NOT_EMPLOYED", "Only people who work here now acknowledge the policy.", 422);
    const row = await repo.getVersion(client, id);
    if (!row) throw notFound();
    const newest = await repo.newestVersion(client);
    if (!newest || newest.attendance_policy_id !== id)
      throw new AppError("POLICY_NOT_LATEST", "Acknowledge the newest version of the policy", 409);
    const done = await repo.acknowledge(client, id, employeeId);
    await notifications.markReadForRecord(client, user, "attendance_policy", id);
    if (!done) return;
    await emit(client, {
      key: EVENTS.ATTENDANCE_POLICY_ACKNOWLEDGED,
      entity: { type: "attendance_policy", id },
      actor: user,
      after: { acknowledged_at: iso(done.acknowledged_at) },
      payload: { attendance_policy_id: id, version: Number(row.version), employee_id: employeeId },
    });
  });
  return mine(user);
}

/**
 * The reminder's `find` (attendance.events.js): from REMIND_AFTER_DAYS days after the newest version
 * was published, one occurrence for each person asked who has neither acknowledged it nor been
 * reminded of it, fired in the working day. The engine adds each once.
 * @param {{query: Function}} db
 * @param {{now: Date}} ctx
 */
async function remindersDue(db, { now }) {
  const newest = await repo.newestVersion(db);
  if (!newest) return [];
  const dueAt = new Date(new Date(newest.published_at).getTime() + REMIND_AFTER_DAYS * 86_400_000);
  if (dueAt > now) return [];
  return (await repo.dueForPolicyReminder(db, newest.attendance_policy_id, lagos.today(now))).map((p) => ({
    entity_type: "attendance_policy",
    entity_id: newest.attendance_policy_id,
    occurrence: p.employee_id,
    due_at: dueAt,
    work_hours: true,
  }));
}

/**
 * The reminder's `check`, in the firing's transaction: fire only while the version is still the
 * newest and the person still asked and not acknowledged, recording that they were reminded;
 * otherwise end it.
 * @param {import("pg").PoolClient} client
 * @param {{entity_id: string, occurrence: string}} row  the engine's occurrence: a version and a person
 * @param {{now: Date}} ctx
 */
async function reminderCheck(client, row, { now }) {
  const newest = await repo.newestVersion(client);
  if (!newest || newest.attendance_policy_id !== row.entity_id) return null;
  const employeeId = row.occurrence;
  if (!(await repo.isAsked(client, employeeId, lagos.today(now)))) return null;
  if (!(await repo.recordPolicyReminder(client, row.entity_id, employeeId))) return null;
  return {
    entity: { type: "attendance_policy", id: row.entity_id },
    payload: {
      attendance_policy_id: row.entity_id,
      version: Number(newest.version),
      employee_id: employeeId,
      subject_employee_id: employeeId,
    },
  };
}

module.exports = {
  AHEAD_DAYS,
  REMIND_AFTER_DAYS,
  settingsOf,
  changedRules,
  stateOf,
  overview,
  versions,
  version,
  acknowledgements,
  mine,
  myVersions,
  myVersion,
  saveDraft,
  discardDraft,
  publish,
  withdraw,
  acknowledge,
  remindersDue,
  reminderCheck,
};
