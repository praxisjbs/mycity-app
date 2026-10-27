"use strict";
/**
 * Where attendance's records wait on the screens they open on (docs/guides/notifications.md §6,
 * Where it waits), as each screen's own filters find them, so its switch and chips carry their share:
 *
 *   People · Worksites   temporary/sites/<state>, temporary/requests/<status>, temporary/field/<state>
 *   People · Attendance  register/<status> (today's days), exceptions/<status>, homes/<status>,
 *                        deductions/<status>, overtime/<status>
 *
 * A record the screen lists nowhere (a check-in, a rule breach, an overtime approval, another day
 * than the Register's) is left out: it counts on the tab alone.
 */
const lagos = require("../../shared/time/lagos");
const repo = require("./attendance.repo");
const sites = require("./attendance.sites.repo");

/** Each row's path, by its id. */
const placed = (rows, pathOf) => new Map(rows.flatMap((r) => (pathOf(r) ? [[r.id, pathOf(r)]] : [])));

module.exports = [
  {
    module: "people",
    tab: "worksites",
    type: "attendance_temporary_site",
    place: async (db, ids) => placed(await sites.statesOf(db, ids, lagos.today()), (r) => `temporary/sites/${r.state}`),
  },
  {
    module: "people",
    tab: "worksites",
    type: "attendance_location_request",
    place: async (db, ids) => placed(await repo.requestStatusesOf(db, ids), (r) => `temporary/requests/${r.status}`),
  },
  {
    module: "people",
    tab: "worksites",
    type: "attendance_field_assignment",
    place: async (db, ids) => placed(await repo.assignmentStatesOf(db, ids, lagos.today()), (r) => `temporary/field/${r.state}`),
  },
  {
    module: "people",
    tab: "attendance",
    type: "attendance_record",
    // The Register opens on today: a day of today waits there, under its status once it has one.
    place: async (db, ids) => {
      const today = lagos.today();
      return placed(await repo.daysOf(db, ids), (r) => (r.date === today ? (r.status ? `register/${r.status}` : "register") : null));
    },
  },
  {
    module: "people",
    tab: "attendance",
    type: "attendance_exception",
    place: async (db, ids) => placed(await repo.exceptionStatusesOf(db, ids), (r) => `exceptions/${r.status}`),
  },
  {
    module: "people",
    tab: "attendance",
    type: "attendance_home",
    place: async (db, ids) => placed(await repo.homeStatusesOf(db, ids), (r) => `homes/${r.status}`),
  },
  {
    module: "people",
    tab: "attendance",
    type: "attendance_pay_item",
    place: async (db, ids) => placed(await repo.payItemsOf(db, ids), (r) => `${r.kind === "overtime" ? "overtime" : "deductions"}/${r.status}`),
  },
];
