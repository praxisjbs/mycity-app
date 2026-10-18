"use strict";
/**
 * Home · Reports (docs/guides/home.md §2, §3 steps 7 and 8, §5, §6 Reports): the reports a
 * person builds and receives, their schedules, and the files they produce.
 *
 *   list()          GET   /home/reports               a page of 25: live ones unless `archived` asks
 *   summary()       GET   /home/reports/summary       Scheduled, Paused, Runs This Month, Recipients
 *   get()           GET   /home/reports/:id           404 when the reader may not see it
 *   create()        POST  /home/reports               a source the creator may open, a schedule or none
 *   update()        PATCH /home/reports/:id           owner or CEO; a schedule keeps running or paused
 *   setActive()     PATCH /home/reports/:id/schedule  owner or CEO: Pause or Resume
 *   archive()       POST  /home/reports/:id/archive   owner or CEO: its schedule stops, its runs stay
 *   runNow()        POST  /home/reports/:id/run       one pending file for the caller
 *   runs()          GET   /home/report-runs           Recent Runs, newest first
 *   getRun()        GET   /home/report-runs/:id       one run on the reader's Recent Runs, else 404
 *   exportOverview() POST /home/overview/export       the caller's own Overview, as Run Now
 *
 *   queueDue()      the `scheduled-reports` tick: a `scheduled-report` job per schedule now due
 *   fireSlot()      that job: one run per recipient and format for the slot, the next slot set
 *   forAssistant(), runsForAssistant()   the assistant's reads (reports.ai.js)
 *   searchReports(), searchRuns()        ⌘K (reports.search.js)
 *
 * WHO SEES A REPORT (home.md §6): its owner; its recipients and, when it is shared, every
 * holder of `home.reports`, while they may open its source; the CEO every report. Only the
 * owner and the CEO change, pause or archive it; anyone who sees it may run it for themselves
 * while they may open its source. A person's own Overview report (the Overview Export) is
 * never listed. readerOf() works out the sources a reader may open once per request, and
 * reports.repo.js seenWhere() turns it into the one condition every read here uses.
 *
 * A SCHEDULE is a recurrence rule from a start day at a time of day in Lagos
 * (reports.schedule.js). `next_run_at` is its next slot; a paused schedule has none. Its
 * recipients are logins who hold `home.reports` and may open the report's source, checked
 * when it is saved and again for each file (reports.generate.js).
 *
 * A RUN is one file: one recipient, one format, one number (numbering `report_run`). Making
 * one emits `home.report_run`, whose outbox handler builds the file as its recipient; so Run
 * Now and Export answer the run while it is still pending, and pressing again while it waits
 * answers the same run. Every write runs in one transaction with its event; saving a report as
 * it already is writes and records nothing (home.md §11, Double submit).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { envelope, pageOf } = require("../../shared/http/paged");
const numbering = require("../../shared/numbering/numbering");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");
const workingWeek = require("../../shared/time/working-week");
const reportSources = require("./reports.sources");
const schedule = require("./reports.schedule");
const repo = require("./reports.repo");
const { EVENTS, ENTITY } = require("./reports.events");

/** The schedules one `scheduled-reports` tick queues at most; the rest are queued at the next. */
const DUE_BATCH = 200;

/** The name a person's own Overview report takes, with a number on the end when they hold it. */
const OVERVIEW_NAME = "Overview";

const { SOURCES } = reportSources;

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "Report not found", 404);
const runNotFound = () => new AppError("NOT_FOUND", "Run not found", 404);
const invalid = (fields) => new AppError("VALIDATION_FAILED", "Check the highlighted fields", 422, fields);
const nameTaken = () =>
  new AppError("REPORT_NAME_TAKEN", "You already have a report with this name", 409, { name: ["Name already used"] });

/* ------------------------------------------------------------------ *
 * Who the reader is
 * ------------------------------------------------------------------ */

/**
 * The reader, and which reports and runs they see: the CEO every one; anyone else theirs,
 * and the reports of the sources they may open.
 * @param {{query: Function}} db
 * @param {{user_id: string, employee_id: string|null, role_ids: string[], is_ceo?: boolean}} user  req.user
 */
async function readerOf(db, user) {
  const ceo = user.is_ceo === true;
  const sources = ceo ? Object.keys(SOURCES) : await reportSources.openTo(db, user);
  return { user, ceo, seen: { all: ceo, user_id: user.user_id, sources } };
}

/** Which runs a person sees: the CEO every one; anyone else those they received or whose report they own. */
const runsSeenBy = (user) => ({ all: user.is_ceo === true, user_id: user.user_id });

/** Whether the person holds `home.reports`, which opens the Reports tab; the CEO does. */
async function mayReport(db, user) {
  if (user.is_ceo === true) return true;
  return (await grantsCache.getCapabilities(db, user.user_id)).includes("home.reports");
}

/**
 * Why a person may not receive a report's file, or null when they may: an active login, who
 * may open the report's source and, for any source but the Overview, holds `home.reports`.
 * The rule a schedule's recipients are held to when it is saved, and each file when it is made.
 * @param {{query: Function}} db
 * @param {object|null} person  grants-cache getAuthUser
 * @param {string} sourceKey
 * @returns {Promise<"inactive"|"source"|"capability"|null>}
 */
async function whyNot(db, person, sourceKey) {
  if (!person || person.status !== "active") return "inactive";
  if (!(await reportSources.scopeOn(db, person, sourceKey))) return "source";
  if (sourceKey === repo.OVERVIEW || (await mayReport(db, person))) return null;
  return "capability";
}

/** Only a report's owner and the CEO change, pause or archive it. */
function assertMayChange(reader, row) {
  if (reader.ceo || row.owner_user_id === reader.user.user_id) return;
  throw new AppError("REPORT_NOT_YOURS", "Only the report's owner or the CEO can change it", 403);
}

/** An archived report is kept as it is: its runs stay, and it neither changes nor runs. */
function assertLive(row) {
  if (row.archived_at) throw new AppError("REPORT_ARCHIVED", "This report is archived", 409);
}

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

const filtersOf = (row) => (row.definition && row.definition.filters) || {};

/** A report's schedule as the contract shapes it (HomeReportSchedule), or null. */
function scheduleOf(row) {
  if (!row.report_schedule_id) return null;
  return {
    report_schedule_id: row.report_schedule_id,
    recurrence: row.recurrence,
    starts_on: row.starts_on,
    run_time: row.run_time,
    formats: row.formats,
    audience: row.audience,
    active: row.active,
    last_run_at: row.last_run_at,
    next_run_at: row.next_run_at,
  };
}

/** A report row as the contract shapes it (HomeReport), for this reader. */
function present(row, reader) {
  return {
    saved_report_id: row.saved_report_id,
    name: row.name,
    report_key: row.report_key,
    filters: filtersOf(row),
    shared: row.shared,
    owner_user_id: row.owner_user_id,
    owner_name: row.owner_name,
    status: !row.report_schedule_id ? "on_demand" : row.active ? "scheduled" : "paused",
    schedule: scheduleOf(row),
    can_edit: reader.ceo || row.owner_user_id === reader.user.user_id,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** What the audit line keeps of a report: what a person set, not who reads it. */
function auditOf(row) {
  const s = scheduleOf(row);
  return {
    name: row.name,
    report_key: row.report_key,
    filters: filtersOf(row),
    shared: row.shared,
    archived_at: row.archived_at,
    schedule: s && {
      recurrence: s.recurrence,
      starts_on: s.starts_on,
      run_time: s.run_time,
      formats: s.formats,
      recipient_user_ids: row.recipient_user_ids,
      active: s.active,
    },
  };
}

/** A run row as the contract shapes it (HomeReportRun): its file only once it is done. */
function presentRun(row) {
  return {
    home_report_run_id: row.home_report_run_id,
    number: row.number,
    saved_report_id: row.saved_report_id,
    report_name: row.report_name,
    report_key: row.report_key,
    report_schedule_id: row.report_schedule_id,
    scheduled_for: row.scheduled_for,
    recipient_user_id: row.recipient_user_id,
    recipient_name: row.recipient_name,
    requested_by: row.requested_by,
    format: row.format,
    status: row.status,
    document_id: row.status === "done" ? row.document_id : null,
    emailed_at: row.emailed_at,
    run_at: row.run_at,
    finished_at: row.finished_at,
  };
}

/** JSON with its keys in order, so two equal rules compare equal however they were stored. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

/** GET /home/reports */
async function list(user, query) {
  const reader = await readerOf(pool, user);
  const page = await repo.reportPage(pool, reader.seen, query);
  return { ...page, data: page.data.map((row) => present(row, reader)) };
}

/** GET /home/reports/:id: any report the reader may see, archived ones too. */
async function get(user, id) {
  const reader = await readerOf(pool, user);
  const row = await repo.reportById(pool, reader.seen, id);
  if (!row) throw notFound();
  return present(row, reader);
}

/**
 * GET /home/reports/summary (HomeReportSummary): over the live reports the reader may see,
 * and the files on their Recent Runs generated since the 1st of this month in Lagos.
 */
async function summary(user, { now = new Date() } = {}) {
  const reader = await readerOf(pool, user);
  const since = lagos.startOfDay(lagos.monthBounds(lagos.today(now)).first);
  const [n, files] = await Promise.all([repo.counts(pool, reader.seen), repo.filesSince(pool, runsSeenBy(user), since)]);
  return { scheduled: n.scheduled, paused: n.paused, runs_this_month: files, recipients: n.recipients };
}

/** GET /home/report-runs: the files the reader received, and every file of the reports they own. */
async function runs(user, query) {
  const page = await repo.runPage(pool, runsSeenBy(user), query);
  return { ...page, data: page.data.map(presentRun) };
}

/** GET /home/report-runs/:id: one run the reader has on Recent Runs, however old; 404 otherwise. */
async function getRun(user, id) {
  const row = await repo.runById(pool, id, { seen: runsSeenBy(user) });
  if (!row) throw runNotFound();
  return presentRun(row);
}

/* ------------------------------------------------------------------ *
 * Building and changing a report
 * ------------------------------------------------------------------ */

/**
 * The owner may give a report this name: no other report of theirs has it, case aside. Their
 * own Overview report is never listed, so a name they choose always wins it: that report
 * takes the next free name instead. The table's own unique key is exact, so one owner's saves
 * take turns here: two at once with "Late" and "late" are one name, not two.
 */
async function claimName(client, ownerUserId, name, { except = null } = {}) {
  await repo.lockOwner(client, ownerUserId);
  if (await repo.nameTaken(client, ownerUserId, name, { except })) throw nameTaken();
  const overview = await repo.overviewReportOf(client, ownerUserId);
  if (overview && overview.name === name && overview.saved_report_id !== except)
    await repo.updateReport(client, overview.saved_report_id, { name: await freeName(client, ownerUserId) });
}

/** The first of "Overview", "Overview 2", ... the owner does not hold, case aside. */
async function freeName(client, ownerUserId) {
  const used = new Set(await repo.namesLike(client, ownerUserId, OVERVIEW_NAME));
  if (!used.has(OVERVIEW_NAME.toLowerCase())) return OVERVIEW_NAME;
  for (let n = 2; ; n += 1) if (!used.has(`${OVERVIEW_NAME} ${n}`.toLowerCase())) return `${OVERVIEW_NAME} ${n}`;
}

/**
 * A report's filters hold only what its source takes (the contract checks a new report's
 * shape), and a department or leave type they name exists: a filter on nothing would send an
 * empty file for ever.
 * @param {{query: Function}} client
 * @param {string} sourceKey
 * @param {object} filters
 */
async function checkFilters(client, sourceKey, filters) {
  const takes = SOURCES[sourceKey].filters;
  const f = filters || {};
  const fields = {};
  for (const [key, value] of Object.entries(f))
    if (value !== undefined && !takes.includes(key)) fields[`filters.${key}`] = ["Not for this source"];
  if (!Object.keys(fields).length && (f.department_id || f.leave_type_id)) {
    const names = await repo.filterNames(client, f);
    if (f.department_id && !names.department) fields["filters.department_id"] = ["Department not found"];
    if (f.leave_type_id && !names.leave_type) fields["filters.leave_type_id"] = ["Leave type not found"];
  }
  if (Object.keys(fields).length) throw invalid(fields);
}

/**
 * A schedule as the form sent it (HomeReportScheduleSave), checked and made ready to save:
 * its rule sound, every recipient a login who may receive the report, its next slot in Lagos.
 *
 * A recipient the saved schedule already goes to was checked when it was saved, and is not
 * asked again: one who has since lost the report gets a skipped run (reports.generate.js), so
 * an edit to anything else still saves. Each person refused is named.
 * @param {import("pg").PoolClient} client
 * @param {object} body  a validated HomeReportScheduleSave
 * @param {string} sourceKey  the report's source
 * @param {{active: boolean, now: Date, kept?: string[]}} state  running or paused, the moment
 *   it is saved, and the recipients the saved schedule already goes to
 */
async function scheduleFields(client, body, sourceKey, { active, now, kept = [] }) {
  const problems = schedule.problems(body.recurrence);
  if (problems.length) throw invalid({ "schedule.recurrence": problems });
  const people = await repo.people(client, body.recipient_user_ids);
  const known = new Map(people.map((p) => [p.user_id, p]));
  const refused = [];
  for (const id of body.recipient_user_ids) {
    const person = known.get(id);
    if (!person) refused.push("Cannot receive this report");
    else if (!kept.includes(id) && (await whyNot(client, await grantsCache.getAuthUser(client, id), sourceKey)))
      refused.push(`${person.display_name}: no access`);
  }
  if (refused.length) throw invalid({ "schedule.recipient_user_ids": refused });
  const fields = {
    recurrence: body.recurrence,
    starts_on: body.starts_on,
    run_time: body.run_time,
    formats: body.formats,
    recipient_user_ids: body.recipient_user_ids,
    recipients: body.recipient_user_ids.map((id) => known.get(id).email),
    active,
  };
  fields.next_run_at = active ? schedule.nextSlot(fields, now, await workingWeek.loadCalendar(client)) : null;
  return fields;
}

/** Whether a schedule as saved would change nothing a person set. */
const sameSchedule = (fields, row) =>
  Boolean(row.report_schedule_id) &&
  canonical(fields.recurrence) === canonical(row.recurrence) &&
  fields.starts_on === row.starts_on &&
  fields.run_time === row.run_time &&
  canonical(fields.formats) === canonical(row.formats) &&
  canonical(fields.recipient_user_ids) === canonical(row.recipient_user_ids);

/** Insert a report, a name taken meanwhile by the same owner answering as one taken before. */
async function insertReport(client, report) {
  try {
    return await repo.insertReport(client, report);
  } catch (err) {
    if (err && err.code === "23505" && err.constraint === "saved_report_owner_user_id_name_key") throw nameTaken();
    throw err;
  }
}

/**
 * POST /home/reports. A source the creator may open, with the filters it takes (the contract
 * checks both shapes); a schedule runs from the moment it is saved.
 * @param {object} actor  withActor(req)
 * @param {object} body  a validated HomeReportCreate
 */
async function create(actor, body, { now = new Date() } = {}) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    if (!reader.seen.sources.includes(body.report_key)) throw invalid({ report_key: ["Not open to you"] });
    await checkFilters(client, body.report_key, body.filters);
    await claimName(client, actor.user_id, body.name);
    const fields = body.schedule
      ? await scheduleFields(client, body.schedule, body.report_key, { active: true, now })
      : null;
    const id = await insertReport(client, {
      owner_user_id: actor.user_id,
      name: body.name,
      report_key: body.report_key,
      definition: { filters: body.filters },
      shared: body.shared,
    });
    if (fields) await repo.saveSchedule(client, id, fields);
    const created = await repo.reportById(client, reader.seen, id);
    await emit(client, {
      key: EVENTS.HOME_REPORT_CREATED,
      entity: { type: "home_report", id },
      actor,
      after: auditOf(created),
      payload: { saved_report_id: id, report_key: body.report_key, scheduled: Boolean(fields) },
    });
    return present(created, reader);
  });
}

/**
 * PATCH /home/reports/:id: its name, filters, sharing, or its whole schedule (null: on
 * demand). Saving over a schedule keeps it running or paused as it was; a new one runs. A
 * running schedule saved while its slot is due keeps that slot, which is then sent once, late,
 * as the schedule now stands, and the schedule moves on from there as it fires (fireSlot).
 * @param {object} actor  withActor(req)
 * @param {string} id
 * @param {object} body  a validated HomeReportUpdate
 */
async function update(actor, id, body, { now = new Date() } = {}) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    const before = await repo.reportById(client, reader.seen, id, { lock: true });
    if (!before) throw notFound();
    assertMayChange(reader, before);
    assertLive(before);

    const changes = {};
    if (body.name !== undefined && body.name !== before.name) {
      await claimName(client, before.owner_user_id, body.name, { except: id });
      changes.name = body.name;
    }
    // Filters sent as they are stored were checked when they were saved, and stay as they are.
    if (body.filters !== undefined && canonical(body.filters) !== canonical(filtersOf(before))) {
      await checkFilters(client, before.report_key, body.filters);
      changes.definition = { ...before.definition, filters: body.filters };
    }
    if (body.shared !== undefined && body.shared !== before.shared) changes.shared = body.shared;

    let scheduled;
    if (body.schedule === null && before.report_schedule_id) scheduled = null;
    else if (body.schedule) {
      const active = before.report_schedule_id ? before.active : true;
      const kept = before.report_schedule_id ? before.recipient_user_ids : [];
      const fields = await scheduleFields(client, body.schedule, before.report_key, { active, now, kept });
      const due = active && before.next_run_at && new Date(before.next_run_at) <= now;
      if (due) fields.next_run_at = before.next_run_at;
      if (!sameSchedule(fields, before)) scheduled = fields;
    }
    const changed = [...Object.keys(changes).map((k) => (k === "definition" ? "filters" : k))];
    if (scheduled !== undefined) changed.push("schedule");
    if (!changed.length) return present(before, reader);

    await repo.updateReport(client, id, changes);
    if (scheduled === null) await repo.deleteSchedule(client, id);
    else if (scheduled) await repo.saveSchedule(client, id, scheduled);
    const after = await repo.reportById(client, reader.seen, id);
    await emit(client, {
      key: EVENTS.HOME_REPORT_UPDATED,
      entity: { type: "home_report", id },
      actor,
      before: auditOf(before),
      after: auditOf(after),
      payload: { saved_report_id: id, changed },
    });
    return present(after, reader);
  });
}

/**
 * PATCH /home/reports/:id/schedule: Pause or Resume. Paused keeps its rule, has no next slot
 * and sends nothing; resumed, it runs from its next slot after now.
 * @param {object} actor  withActor(req)
 * @param {string} id
 * @param {{active: boolean}} body  a validated HomeReportScheduleState
 */
async function setActive(actor, id, { active }, { now = new Date() } = {}) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    const before = await repo.reportById(client, reader.seen, id, { lock: true });
    if (!before) throw notFound();
    assertMayChange(reader, before);
    assertLive(before);
    if (!before.report_schedule_id)
      throw new AppError("REPORT_ON_DEMAND", "This report has no schedule", 409);
    if (before.active === active) return present(before, reader);

    const next = active ? schedule.nextSlot(before, now, await workingWeek.loadCalendar(client)) : null;
    await repo.setScheduleState(client, id, { active, next_run_at: next });
    await repo.updateReport(client, id, {});
    const after = await repo.reportById(client, reader.seen, id);
    await emit(client, {
      key: EVENTS.HOME_REPORT_UPDATED,
      entity: { type: "home_report", id },
      actor,
      before: auditOf(before),
      after: auditOf(after),
      payload: { saved_report_id: id, changed: ["active"] },
    });
    return present(after, reader);
  });
}

/**
 * POST /home/reports/:id/archive: hidden from the list unless asked for, its schedule
 * stopped, its runs and their files kept. Archiving it again answers it as it is.
 * @param {object} actor  withActor(req)
 * @param {string} id
 */
async function archive(actor, id) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    const before = await repo.reportById(client, reader.seen, id, { lock: true });
    if (!before) throw notFound();
    assertMayChange(reader, before);
    if (before.archived_at) return present(before, reader);

    await repo.archiveReport(client, id);
    if (before.report_schedule_id) await repo.setScheduleState(client, id, { active: false, next_run_at: null });
    const after = await repo.reportById(client, reader.seen, id);
    await emit(client, {
      key: EVENTS.HOME_REPORT_ARCHIVED,
      entity: { type: "home_report", id },
      actor,
      before: auditOf(before),
      after: auditOf(after),
      payload: { saved_report_id: id },
    });
    return present(after, reader);
  });
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/**
 * A new numbered run, waiting for its file, and the event that has it built.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{saved_report_id: string, report_schedule_id?: string|null, scheduled_for?: Date|null,
 *          recipient_user_id: string, requested_by: string|null, format: string}} run
 * @param {object|null} actor  the caller, or null for a schedule
 * @returns {Promise<string|null>} its id; null when the slot already holds it
 */
async function queueRun(client, run, actor) {
  const { number } = await numbering.allocate(client, "report_run");
  const id = await repo.insertRun(client, {
    number,
    saved_report_id: run.saved_report_id,
    report_schedule_id: run.report_schedule_id || null,
    scheduled_for: run.scheduled_for || null,
    recipient_user_id: run.recipient_user_id,
    requested_by: run.requested_by,
    format: run.format,
  });
  if (!id) return null;
  await emit(client, {
    key: EVENTS.HOME_REPORT_RUN,
    entity: { type: ENTITY, id },
    actor,
    payload: {
      home_report_run_id: id,
      number,
      saved_report_id: run.saved_report_id,
      recipient_user_id: run.recipient_user_id,
      format: run.format,
      scheduled_for: run.scheduled_for || null,
    },
    dedup_key: `report_run:${id}`,
  });
  return id;
}

/**
 * One file of a report for the caller, or the one already waiting for them in that format.
 * @param {import("pg").PoolClient} client  inside atomically(), the report held
 */
async function runFor(client, actor, report, format) {
  const waiting = await repo.pendingOnDemand(client, {
    saved_report_id: report.saved_report_id,
    recipient_user_id: actor.user_id,
    format,
  });
  const id =
    waiting ||
    (await queueRun(
      client,
      { saved_report_id: report.saved_report_id, recipient_user_id: actor.user_id, requested_by: actor.user_id, format },
      actor,
    ));
  return presentRun(await repo.runById(client, id));
}

/**
 * POST /home/reports/:id/run (Run Now): one file for the caller, in a format the report's
 * schedule offers (either, for a report on demand), answered pending.
 * @param {object} actor  withActor(req)
 * @param {string} id
 * @param {{format: "pdf"|"xlsx"}} body  a validated HomeReportRunNow
 */
async function runNow(actor, id, { format }) {
  return tx(async (client) => {
    const reader = await readerOf(client, actor);
    const report = await repo.reportById(client, reader.seen, id, { lock: true });
    if (!report) throw notFound();
    assertLive(report);
    if (!reader.seen.sources.includes(report.report_key))
      throw new AppError("REPORT_SOURCE_CLOSED", "You cannot open this report's source", 403);
    if (report.report_schedule_id && !report.formats.includes(format)) throw invalid({ format: ["Not offered"] });
    return runFor(client, actor, report, format);
  });
}

/**
 * POST /home/overview/export: a file of the caller's own Overview, through the same runs. The
 * report behind it is made the first time they export, theirs alone and never listed.
 * @param {object} actor  withActor(req)
 * @param {{format: "pdf"|"xlsx"}} body  a validated HomeReportRunNow
 */
async function exportOverview(actor, { format }) {
  return tx(async (client) => {
    // One person exporting from two tabs at once makes one report, not two.
    await repo.lockOwner(client, actor.user_id);
    let report = await repo.overviewReportOf(client, actor.user_id);
    if (!report) {
      const id = await insertReport(client, {
        owner_user_id: actor.user_id,
        name: await freeName(client, actor.user_id),
        report_key: repo.OVERVIEW,
        definition: { filters: {} },
        shared: false,
      });
      report = await repo.overviewReportOf(client, actor.user_id);
      await emit(client, {
        key: EVENTS.HOME_REPORT_CREATED,
        entity: { type: "home_report", id },
        actor,
        after: auditOf(report),
        payload: { saved_report_id: id, report_key: repo.OVERVIEW, scheduled: false },
      });
    }
    return runFor(client, actor, report, format);
  });
}

/* ------------------------------------------------------------------ *
 * Schedules firing
 * ------------------------------------------------------------------ */

/**
 * The `scheduled-reports` tick: a `scheduled-report` job for each schedule whose slot has
 * come, the earliest first, at most DUE_BATCH a tick. The job id is the schedule's and its
 * slot's, so a schedule still waiting from the last tick is not queued twice. A slot's job
 * that finished without moving the schedule on (it failed every attempt) is replaced, so the
 * next tick tries the slot again instead of the schedule stopping at it.
 * @param {{now?: Date}} [at]
 * @returns {Promise<{due: number}>}
 */
async function queueDue({ now = new Date() } = {}) {
  const queues = require("../../jobs/queues");
  const due = await repo.dueSchedules(pool, { now, batch: DUE_BATCH });
  for (const s of due) {
    const slot = new Date(s.next_run_at);
    await queues.enqueue(
      "scheduled-report",
      "slot",
      { report_schedule_id: s.report_schedule_id, slot: slot.toISOString() },
      { jobId: `scheduled-report-${s.report_schedule_id}-${slot.getTime()}`, replaceFinished: true },
    );
  }
  return { due: due.length };
}

/**
 * The `scheduled-report` job: one run per recipient and format for the slot, each numbered and
 * built as its recipient, then the schedule's next slot after now. Run again, or for a slot the
 * schedule has moved past, it makes nothing; a schedule paused, archived or removed since the
 * slot was queued does nothing.
 * @param {string} scheduleId
 * @param {Date} slot  the next_run_at the tick saw
 * @param {{now?: Date}} [at]
 * @returns {Promise<{runs: number, next_run_at?: Date|null, skipped?: string}>}
 */
async function fireSlot(scheduleId, slot, { now = new Date() } = {}) {
  return tx(async (client) => {
    const s = await repo.scheduleToFire(client, scheduleId);
    if (!s) return { runs: 0, skipped: "no schedule" };
    if (!s.active || s.archived_at) return { runs: 0, skipped: "not running" };
    if (!s.next_run_at || new Date(s.next_run_at).getTime() !== slot.getTime() || slot > now)
      return { runs: 0, skipped: "not this slot" };

    const taken = await repo.slotTaken(client, scheduleId, slot);
    let made = 0;
    for (const person of await repo.people(client, s.recipient_user_ids)) {
      for (const format of s.formats) {
        if (taken.has(`${person.user_id}:${format}`)) continue;
        const id = await queueRun(
          client,
          {
            saved_report_id: s.saved_report_id,
            report_schedule_id: scheduleId,
            scheduled_for: slot,
            recipient_user_id: person.user_id,
            requested_by: null,
            format,
          },
          null,
        );
        if (id) made += 1;
      }
    }
    const next = schedule.nextSlot(s, now, await workingWeek.loadCalendar(client));
    await repo.advanceSchedule(client, scheduleId, { last_run_at: slot, next_run_at: next });
    return { runs: made, next_run_at: next };
  });
}

/* ------------------------------------------------------------------ *
 * The assistant and ⌘K
 * ------------------------------------------------------------------ */

/**
 * The assistant's `reports.mine`: a page of the reports the asker owns or receives, or an
 * empty page for someone without `home.reports`. The assistant checks only the `home`
 * grant, which every login holds, so the capability is checked here.
 * @param {{query: Function}} db  the client the assistant reads with
 * @param {object} actor  req.user with the assistant's scope
 * @param {object} query  a validated HomeReportQuery
 */
async function forAssistant(db, actor, query) {
  if (!(await mayReport(db, actor))) return envelope([], pageOf(query).number, 0);
  const reader = await readerOf(db, actor);
  const page = await repo.reportPage(db, reader.seen, { ...query, mine: "true" });
  return { ...page, data: page.data.map((row) => present(row, reader)) };
}

/**
 * The assistant's `runs.mine`: a page of the files the asker received, newest first, or an
 * empty page for someone without `home.reports`.
 * @param {{query: Function}} db
 * @param {object} actor
 * @param {object} query  a validated HomeReportRunQuery
 */
async function runsForAssistant(db, actor, query) {
  if (!(await mayReport(db, actor))) return envelope([], pageOf(query).number, 0);
  const page = await repo.runPage(db, runsSeenBy(actor), query, { received: true });
  return { ...page, data: page.data.map(presentRun) };
}

/**
 * ⌘K's reports: a page of the reports the reader may see whose name matches; nothing for a
 * reader without `home.reports`.
 * @param {{query: Function}} db  the search's client
 * @param {object} user  req.user
 * @param {{term: string, page: number}} search
 */
async function searchReports(db, user, { term, page }) {
  if (!(await mayReport(db, user))) return envelope([], pageOf({ page }).number, 0);
  const reader = await readerOf(db, user);
  return repo.reportPage(db, reader.seen, { q: term, page });
}

/**
 * ⌘K's runs: a page of the runs the reader may see whose number or report matches; nothing
 * for a reader without `home.reports`.
 * @param {{query: Function}} db  the search's client
 * @param {object} user  req.user
 * @param {{term: string, page: number}} search
 */
async function searchRuns(db, user, { term, page }) {
  if (!(await mayReport(db, user))) return envelope([], pageOf({ page }).number, 0);
  return repo.runPage(db, runsSeenBy(user), { q: term, page });
}

module.exports = {
  DUE_BATCH,
  readerOf,
  mayReport,
  whyNot,
  present,
  presentRun,
  list,
  get,
  summary,
  runs,
  getRun,
  create,
  update,
  setActive,
  archive,
  runNow,
  exportOverview,
  queueDue,
  fireSlot,
  forAssistant,
  runsForAssistant,
  searchReports,
  searchRuns,
};
