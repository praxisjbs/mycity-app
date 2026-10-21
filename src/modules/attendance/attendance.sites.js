"use strict";
/**
 * Temporary sites: the one write path for working somewhere else for some days, the reads behind
 * Home's Add Work Site, ESS · Work Location Requests and People · Worksites, and what the clock
 * reads of them (docs/guides/attendance.md §6.11).
 *
 *   submit()   anyone, for themselves, colleagues or both (Add Work Site). Checked (the dates, the
 *              people, one site a person a day) under each person's lock, numbered TS-0001, saved
 *              `submitted`, and the attendance.temporary_site approval opened in the same
 *              transaction with everyone on it excluded from deciding it
 *   add()      People (`people` approve, scope all), never with themselves on it: in force at once,
 *              whoever adds it its approver
 *   settle()   after commit, an approval's outcome is copied onto the site, once and only while it
 *              waits (attendance.events.js)
 *   withdraw() the submitter, while it waits (the approval with it)
 *   cancel(), remove()  People, until its last day, with a reason the people on it read
 *   cover()    after an approval, the open location flags it covers are resolved
 *
 * On a day it covers, an approved site decides the place a punch and a check-in are matched to,
 * before anything else (contextOf, read by attendance.calendar.js contextFor), and its zone the work
 * date and the wall clock (zoneAt). A Temporary Home's address is personal data: its own people,
 * its submitter and People with scope all read it (masked by the controller under employee.personal).
 * Events carry ids, the number, the purpose, the name, the dates and the people: never an address
 * or a point.
 */
const crypto = require("node:crypto");
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const numbering = require("../../shared/numbering/numbering");
const { scopeFor } = require("../../middleware/rbac");
const geo = require("../../shared/geo/geo");
const lagos = require("../../shared/time/lagos");
const places = require("../../shared/places/places");
const engine = require("../../shared/workflow/engine");
const rules = require("./attendance.rules");
const repo = require("./attendance.repo");
const sitesRepo = require("./attendance.sites.repo");
const { EVENTS, SITE_DEFINITION_KEY } = require("./attendance.events");

/** How far ahead a site may start, and the longest it runs, in calendar days. */
const AHEAD_DAYS = 90;
const MAX_DAYS = 90;
/** The owner a site's addresses are kept under (shared/places/owners.js). */
const OWNER = "attendance_temporary_site_location.address";

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That temporary site does not exist", 404);
const iso = (t) => (t ? new Date(t).toISOString() : null);
const ENTITY = (id) => ({ type: "attendance_temporary_site", id });
const isHome = (site) => site.purpose === "temporary_home";

/** A row as the contract's TemporarySite. */
function present(row) {
  if (!row) return row;
  return {
    ...row,
    days: Number(row.days),
    people: Number(row.people),
    submitted_at: iso(row.submitted_at),
    approved_at: iso(row.approved_at),
    cancelled_at: iso(row.cancelled_at),
    locations: row.locations.map((l) => ({ ...l, position: Number(l.position), radius_m: Number(l.radius_m) })),
    members: row.members.map((m) => ({ ...m, added_at: iso(m.added_at), removed_at: iso(m.removed_at) })),
    can_decide: Boolean(row.can_decide),
    can_change: Boolean(row.can_change),
    can_withdraw: Boolean(row.can_withdraw),
  };
}

const presentPage = (page) => ({ ...page, data: page.data.map(present) });

/** The facts every site event carries: no address, no point, no description. */
const payloadOf = (site, employeeIds, extra = {}) => ({
  temporary_site_id: site.temporary_site_id,
  number: site.number,
  purpose: site.purpose,
  name: site.name,
  starts_on: site.starts_on,
  ends_on: site.ends_on,
  employee_ids: employeeIds,
  submitted_by: site.submitted_by,
  ...extra,
});

/* ------------------------------------------------------------------ *
 * Dates, people and places
 * ------------------------------------------------------------------ */

/** The dates, against today in Lagos (§6.11). Pure. */
function checkDates(body, today) {
  if (body.starts_on < today)
    throw new AppError("SITE_IN_THE_PAST", "Pick a first day from today on", 422, { starts_on: ["Already past"] });
  if (lagos.daysBetween(today, body.starts_on) > AHEAD_DAYS)
    throw new AppError("SITE_TOO_FAR", `Pick a first day within ${AHEAD_DAYS} days`, 422, { starts_on: ["Too far ahead"] });
  if (lagos.daysBetween(body.starts_on, body.ends_on) + 1 > MAX_DAYS)
    throw new AppError("SITE_TOO_LONG", `A temporary site covers at most ${MAX_DAYS} days`, 422, {
      ends_on: [`At most ${MAX_DAYS} days`],
    });
}

/** The zone a picked place names, when the runtime knows it; else Lagos (§6.11, addresses.md §4). Pure. */
const zoneOfPlace = (place) => (place && place.timezone && rules.isTimeZone(place.timezone) ? place.timezone : rules.DEFAULT_TZ);

/** Whether someone is at work on a day: active, started by it and not yet left (422 NOT_EMPLOYED). */
function employedOn(person, date) {
  return (
    Boolean(person) &&
    person.status === "active" &&
    (!person.start_date || person.start_date <= date) &&
    (!person.left_on || person.left_on > date)
  );
}

/* ------------------------------------------------------------------ *
 * Adding one
 * ------------------------------------------------------------------ */

/**
 * The one write path for a new site, for Add Work Site (`direct` false) and People's own (`direct`
 * true). Returns the new site's id.
 */
async function create(user, body, { direct }) {
  const today = lagos.today();
  checkDates(body, today);
  const ids = [...body.employee_ids].sort();
  if (direct && user.employee_id && ids.includes(user.employee_id))
    throw new AppError("OWN_RECORD", "Add a site you are on from Home, for approval", 403, {
      employee_ids: ["Not yourself"],
    });

  return tx(async (client) => {
    // One lock a person, in the order of their ids, so two sites sent at once wait in turn.
    for (const e of ids) await repo.lockEmployee(client, e);
    const people = await sitesRepo.peopleOf(client, ids);
    if (people.length !== ids.length || !people.every((p) => employedOn(p, body.starts_on)))
      throw new AppError("NOT_EMPLOYED", "Only people who work here then can be on it", 422, {
        employee_ids: ["Not working here"],
      });
    const clash = await sitesRepo.overlappingSite(client, ids, body.starts_on, body.ends_on);
    if (clash)
      throw new AppError("SITE_OVERLAPS", `${clash.display_name} is already on ${clash.number}`, 409, {
        starts_on: ["Overlaps another site"],
      });

    const { number } = await numbering.allocate(client, "temporary_site");
    const status = direct ? "approved" : "submitted";
    const { temporary_site_id: id } = await sitesRepo.insertSite(client, {
      number,
      purpose: body.purpose,
      name: body.name,
      description: body.description,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      hours: body.hours || "usual",
      starts_at: body.starts_at || null,
      ends_at: body.ends_at || null,
      status,
      submitted_by: user.user_id,
      approved_by: direct ? user.user_id : null,
    });
    for (const [i, loc] of body.locations.entries()) {
      const field = `locations.${i}.address`;
      // A point is the fence's centre: an address typed before F27 has none to give.
      if (loc.address.lat === null || loc.address.lat === undefined)
        throw new AppError("VALIDATION_FAILED", "Pick an address", 422, { [field]: ["Pick an address"] });
      const locationId = crypto.randomUUID();
      const saved = await places.save(client, OWNER, locationId, loc.address, { field });
      await sitesRepo.insertLocation(client, {
        id: locationId,
        temporary_site_id: id,
        position: i + 1,
        name: loc.name,
        place_id: saved.place_id,
        address: saved.line,
        latitude: loc.address.lat,
        longitude: loc.address.lon,
        radius_m: loc.radius_m,
        timezone: zoneOfPlace(loc.address),
      });
    }
    await sitesRepo.insertMembers(client, id, ids);

    const site = { temporary_site_id: id, number, purpose: body.purpose, name: body.name, starts_on: body.starts_on, ends_on: body.ends_on, submitted_by: user.user_id };
    const after = {
      number,
      purpose: body.purpose,
      starts_on: body.starts_on,
      ends_on: body.ends_on,
      status,
      people: ids.length,
      addresses: body.locations.length,
    };
    if (direct) {
      // People's own is in force at once: approved, with its notices and covered flags as for an approval.
      await emit(client, {
        key: EVENTS.TEMPORARY_SITE_APPROVED,
        entity: ENTITY(id),
        actor: user,
        after,
        payload: payloadOf(site, ids, { direct: true }),
      });
      return id;
    }
    await emit(client, {
      key: EVENTS.TEMPORARY_SITE_SUBMITTED,
      entity: ENTITY(id),
      actor: user,
      after,
      payload: payloadOf(site, ids),
    });
    const instance = await engine.openInstance(client, {
      definition_key: SITE_DEFINITION_KEY,
      entity: ENTITY(id),
      subject_employee_id: user.employee_id || null,
      context: { days: lagos.daysBetween(body.starts_on, body.ends_on) + 1 },
      actor: user,
      // Nobody on it decides it (§6.11; foundation.md §6.5).
      exclude_employee_ids: ids,
    });
    await sitesRepo.setWorkflow(client, id, instance.workflow_instance_id);
    return id;
  });
}

/** POST /attendance/me/temporary-sites: Add Work Site, sent for approval. */
async function submit(user, body) {
  return getMine(user, await create(user, body, { direct: false }));
}

/** POST /attendance/temporary-sites: People's own, in force at once (`people` approve, scope all). */
async function add(user, body, scope) {
  assertAll(scope);
  const id = await create(user, body, { direct: true });
  return get(user, id, scope);
}

/* ------------------------------------------------------------------ *
 * Changing one
 * ------------------------------------------------------------------ */

function assertAll(scope) {
  if (!scope || scope.scope !== "all")
    throw new AppError("FORBIDDEN", "Only People with access to everyone change temporary sites", 403);
}

/** May People change it: not on it themselves, not over (§6.11). */
function assertChangeable(site, user, today) {
  if (user.employee_id && site.active_ids.includes(user.employee_id))
    throw new AppError("OWN_RECORD", "Someone else changes a site you are on", 403);
  if (site.ends_on < today) throw new AppError("SITE_ENDED", "This temporary site has ended", 409);
}

/** POST /attendance/me/temporary-sites/:id/withdraw: the submitter, while it waits. */
async function withdraw(user, id, body) {
  const seen = await sitesRepo.getSite(pool, id);
  if (!seen || !mineOf(seen, user)) throw notFound();
  if (seen.submitted_by !== user.user_id) throw notFound();
  if (seen.status !== "submitted") throw new AppError("SITE_NOT_WAITING", "This site no longer waits on approval", 409);
  await tx(async (client) => {
    const site = await sitesRepo.getSite(client, id, { forUpdate: true });
    if (site.status !== "submitted") throw new AppError("SITE_NOT_WAITING", "This site no longer waits on approval", 409);
    if (site.workflow_instance_id) await engine.cancel(client, { instance_id: site.workflow_instance_id, actor: user, reason: body.reason });
    await sitesRepo.closeSite(client, id, "submitted", "withdrawn", user.user_id, body.reason);
    await emit(client, {
      key: EVENTS.TEMPORARY_SITE_WITHDRAWN,
      entity: ENTITY(id),
      actor: user,
      before: { status: "submitted" },
      after: { status: "withdrawn", cancel_reason: body.reason },
      payload: payloadOf(site, site.active_ids, { reason: body.reason }),
    });
  });
  return getMine(user, id);
}

/** POST /attendance/temporary-sites/:id/cancel: an approved site, until its last day. */
async function cancel(user, id, body, scope) {
  assertAll(scope);
  const today = lagos.today();
  await tx(async (client) => {
    const site = await sitesRepo.getSite(client, id, { forUpdate: true });
    if (!site) throw notFound();
    assertChangeable(site, user, today);
    if (site.status !== "approved")
      throw new AppError("SITE_NOT_APPROVED", "Only an approved site is cancelled; decide a waiting one", 409);
    await sitesRepo.closeSite(client, id, "approved", "cancelled", user.user_id, body.reason);
    await emit(client, {
      key: EVENTS.TEMPORARY_SITE_CANCELLED,
      entity: ENTITY(id),
      actor: user,
      before: { status: "approved" },
      after: { status: "cancelled", cancel_reason: body.reason },
      payload: payloadOf(site, site.active_ids, { reason: body.reason }),
    });
  });
  return get(user, id, scope);
}

/** POST /attendance/temporary-sites/:id/remove: one person off a waiting or approved site, never the last. */
async function remove(user, id, body, scope) {
  assertAll(scope);
  const today = lagos.today();
  await tx(async (client) => {
    const site = await sitesRepo.getSite(client, id, { forUpdate: true });
    if (!site) throw notFound();
    assertChangeable(site, user, today);
    if (site.status !== "submitted" && site.status !== "approved")
      throw new AppError("SITE_CLOSED", "This temporary site is closed", 409);
    if (!site.active_ids.includes(body.employee_id))
      throw new AppError("NOT_ON_SITE", "That person is not on this site", 409, { employee_id: ["Not on it"] });
    if (site.active_ids.length === 1) throw new AppError("SITE_LAST_PERSON", "Cancel the site instead", 409);
    await sitesRepo.removeMember(client, id, body.employee_id, user.user_id, body.reason);
    await emit(client, {
      key: EVENTS.TEMPORARY_SITE_MEMBER_REMOVED,
      entity: ENTITY(id),
      actor: user,
      before: { employee_id: body.employee_id, on_it: true },
      after: { employee_id: body.employee_id, on_it: false, removed_reason: body.reason },
      payload: payloadOf(site, [body.employee_id], {
        employee_id: body.employee_id,
        subject_employee_id: body.employee_id,
        reason: body.reason,
      }),
    });
  });
  return get(user, id, scope);
}

/* ------------------------------------------------------------------ *
 * After an approval ends
 * ------------------------------------------------------------------ */

const SETTLED = {
  approved: { status: "approved", key: () => EVENTS.TEMPORARY_SITE_APPROVED },
  rejected: { status: "rejected", key: () => EVENTS.TEMPORARY_SITE_REJECTED },
  cancelled: { status: "withdrawn", key: () => EVENTS.TEMPORARY_SITE_WITHDRAWN },
};

/**
 * Copy an approval's outcome onto its site. Runs after commit, at least once; a site already
 * settled (or withdrawn by its submitter in the same transaction) is left alone.
 * @param {string} id  the temporary_site_id the approval is about
 * @param {string|null} outcome  approved, rejected or cancelled
 * @param {{reason?: string|null}} [extra]  the approver's reason on a rejection
 */
async function settle(id, outcome, { reason = null } = {}) {
  const how = SETTLED[outcome];
  if (!how) return;
  await tx(async (client) => {
    const site = await sitesRepo.getSite(client, id, { forUpdate: true });
    if (!site || site.status !== "submitted") return;
    const by = how.status === "approved" ? await sitesRepo.lastApprover(client, site.workflow_instance_id) : null;
    if (!(await sitesRepo.settleSite(client, id, how.status, by))) return;
    await emit(client, {
      key: how.key(),
      entity: ENTITY(id),
      actor: null,
      before: { status: "submitted" },
      after: { status: how.status },
      payload: payloadOf(site, site.active_ids, { reason, approved_by: by }),
    });
  });
}

/**
 * After an approval: each open location flag of a person still on the site, on one of its days,
 * whose reading falls inside one of its addresses, is resolved, accepted, "Covered by TS-0001"
 * (§6.11). Punches keep their judgement. Runs after commit, at least once: a flag already decided
 * is skipped.
 * @returns {Promise<number>} how many flags it resolved
 */
async function cover(id) {
  const site = await sitesRepo.getSite(pool, id);
  if (!site || site.status !== "approved") return 0;
  const addresses = await sitesRepo.locationsOf(pool, id);
  const flags = await sitesRepo.coverableExceptions(pool, id);
  const inside = (point) => addresses.some((a) => geo.distanceM(point, a) <= Number(a.radius_m));
  let resolved = 0;
  for (const x of flags) {
    if (!inside({ latitude: Number(x.latitude), longitude: Number(x.longitude) })) continue;
    await tx(async (client) => {
      await repo.lockEmployee(client, x.employee_id);
      const done = await repo.resolveException(client, x.attendance_exception_id, {
        outcome: "accepted",
        resolution: `Covered by ${site.number}`,
        by: site.approved_by,
      });
      if (!done) return;
      resolved += 1;
      await emit(client, {
        key: EVENTS.ATTENDANCE_EXCEPTION_DECIDED,
        entity: { type: "attendance_exception", id: x.attendance_exception_id },
        actor: null,
        before: { status: "open", outcome: null },
        after: { status: "resolved", outcome: "accepted", resolution: `Covered by ${site.number}` },
        payload: {
          attendance_exception_id: x.attendance_exception_id,
          employee_id: x.employee_id,
          subject_employee_id: x.employee_id,
          work_date: x.work_date,
          exception_type: x.exception_type,
          outcome: "accepted",
          outcome_text: `covered by ${site.number}`,
          temporary_site_id: id,
        },
      });
    });
  }
  return resolved;
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Whether the person submitted it or is or was on it: their own to read. */
const mineOf = (site, user) => site.submitted_by === user.user_id || (Boolean(user.employee_id) && site.member_ids.includes(user.employee_id));

/** The reader's grant for the decisions on People's screens. */
async function readerOf(user) {
  const approve = await scopeFor(user, "people", "approve");
  return {
    reader: { user, approves: Boolean(approve) },
    changer: approve ? { scope: approve.scope, employee_id: user.employee_id } : null,
  };
}

/** GET /attendance/temporary-sites: with anyone in the reader's `people` view scope on them, waiting first. */
async function list(user, query, scope) {
  const { reader, changer } = await readerOf(user);
  const page = await sitesRepo.listSites(pool, query, scope, {
    today: lagos.today(),
    place: scope.scope === "all",
    reader,
    changer,
  });
  return presentPage(page);
}

/** GET /attendance/temporary-sites/:id, within the reader's scope. */
async function get(user, id, scope) {
  if (!(await sitesRepo.inScope(pool, id, scope))) throw notFound();
  const { reader, changer } = await readerOf(user);
  const row = await sitesRepo.siteRow(pool, id, { today: lagos.today(), place: scope.scope === "all", reader, changer });
  if (!row) throw notFound();
  return present(row);
}

/** GET /attendance/me/temporary-sites: those the person submitted or is or was on. */
async function mine(user, query) {
  const page = await sitesRepo.listSites(pool, query, null, {
    today: lagos.today(),
    place: true,
    userId: user.user_id,
    mine: { user_id: user.user_id, employee_id: user.employee_id },
  });
  return presentPage(page);
}

/** GET /attendance/me/temporary-sites/:id; one they never submitted or were on is a 404. */
async function getMine(user, id) {
  const site = await sitesRepo.getSite(pool, id);
  if (!site || !mineOf(site, user)) throw notFound();
  return present(await sitesRepo.siteRow(pool, id, { today: lagos.today(), place: true, userId: user.user_id }));
}

/* ------------------------------------------------------------------ *
 * On the clock
 * ------------------------------------------------------------------ */

/** What an address is called on the register, a punch and an exception (§6.5). Pure. */
function nameOfAddress(site, location) {
  if (isHome(site)) return "Temporary Home";
  if (site.locations.length === 1) return site.name;
  return `${site.name}, ${location.name || `Address ${location.position}`}`;
}

/**
 * A person's shift on a day of a site (§6.11): with Site Hours, worked from its start to its end
 * whatever their schedule or the company hours say, the policy's grace kept; on the Usual Shift,
 * their own shift unchanged. Pure; calendar.shiftOn and the day's judgement apply it.
 */
function siteShift(site, shift) {
  if (!site || site.hours !== "site") return shift;
  return { ...shift, working_day: true, starts_at: site.starts_at, ends_at: site.ends_at, off_reason: null };
}

/**
 * A site's day as the clock judges it (§6.5, §6.11): its addresses through decideGeofence's `sites`
 * (each address's id as `field_site_id`, reported as `site_id`), judged with the site's mode, or a
 * home's for a Temporary Home, in its first address's zone. Pure.
 * @param {object} site  sitesRepo.siteOn()
 * @param {{policy: object, shift: object}} ctx  the policy for the date and the day's shift
 */
function contextOf(site, { policy, shift }) {
  const home = isHome(site);
  const addresses = site.locations.map((l) => ({
    field_site_id: l.temporary_site_location_id,
    name: nameOfAddress(site, l),
    latitude: Number(l.latitude),
    longitude: Number(l.longitude),
    radius_m: Number(l.radius_m),
  }));
  return {
    policy: rules.forPlace(policy, home ? "home" : "site"),
    shift,
    timeZone: site.locations[0].timezone || rules.DEFAULT_TZ,
    fence: {
      kind: home ? "temporary_home" : "temporary_site",
      place: home ? "temporary_home" : "temporary_site",
      attendance_home_id: null,
      worksite_id: null,
      temporary_site_id: site.temporary_site_id,
      site_number: site.number,
      name: home ? "Temporary Home" : site.name,
      latitude: addresses[0].latitude,
      longitude: addresses[0].longitude,
      radius_m: addresses.length === 1 ? addresses[0].radius_m : null,
      sites: addresses,
    },
    approved: null,
    home_day: false,
    site,
  };
}

/** The day's site on the clock panel: its addresses with their radius, no coordinates (AttendanceToday). Pure. */
function todayOf(site) {
  if (!site) return null;
  return {
    temporary_site_id: site.temporary_site_id,
    number: site.number,
    name: site.name,
    purpose: site.purpose,
    locations: site.locations.map((l) => ({
      temporary_site_location_id: l.temporary_site_location_id,
      position: Number(l.position),
      name: l.name,
      address: l.address,
      radius_m: Number(l.radius_m),
    })),
  };
}

/**
 * The zone a person's dates are read in at an instant (§6.4): the zone of an approved site they
 * are still on whose days cover that instant's date in the site's zone, else `fallback` (their
 * worksite's, else Lagos).
 * @param {{query: Function}} db
 * @param {{employee_id: string}} person
 * @param {Date} instant
 * @param {string} fallback  calendar.zoneOf(person)
 */
async function zoneAt(db, person, instant, fallback) {
  const lagosDay = rules.localDate(instant, rules.DEFAULT_TZ);
  const near = await sitesRepo.sitesAround(db, person.employee_id, lagos.addDays(lagosDay, -1), lagos.addDays(lagosDay, 1));
  for (const site of near) {
    const zone = site.timezone || rules.DEFAULT_TZ;
    const day = rules.localDate(instant, zone);
    if (day >= site.starts_on && day <= site.ends_on) return zone;
  }
  return fallback;
}

/** The approved site a person is still on for a work date, or null (the clock's read). */
const siteOn = (db, employeeId, date) => sitesRepo.siteOn(db, employeeId, date);

module.exports = {
  AHEAD_DAYS,
  MAX_DAYS,
  OWNER,
  checkDates,
  zoneOfPlace,
  employedOn,
  submit,
  add,
  withdraw,
  cancel,
  remove,
  settle,
  cover,
  list,
  get,
  mine,
  getMine,
  present,
  nameOfAddress,
  siteShift,
  contextOf,
  todayOf,
  zoneAt,
  siteOn,
};
