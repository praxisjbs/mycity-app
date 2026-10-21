"use strict";
/**
 * Work location requests and field assignments as the attendance module wrote them before its PR 4
 * (docs/guides/attendance.md §6.11, §6.12), which retired making new ones: numbered, saved with
 * their place, a request's approval opened. The rows still apply until their last day and are still
 * read, cancelled and decided, so the tests that hold those to the real schema start from rows the
 * old write path would have left.
 *
 *   await tx((c) => legacyRequest(c, actor, { request_type: "remote_day", starts_on, ends_on, reason }))
 *   await tx((c) => legacyAssignment(c, actor, { name, client, starts_on, ends_on, sites, employee_ids }))
 */
const numbering = require("../../../src/shared/numbering/numbering");
const places = require("../../../src/shared/places/places");
const engine = require("../../../src/shared/workflow/engine");
const lagos = require("../../../src/shared/time/lagos");

/**
 * A request as the person asked for it then, waiting on the line manager and then Operations & People.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{user_id: string, employee_id: string}} user  the person asking
 * @param {object} r  the old LocationRequestCreate's fields, `address` a parsed PlaceInput or none
 * @returns {Promise<{location_request_id: string, workflow_instance_id: string, number: string}>}
 */
async function legacyRequest(client, user, r) {
  const { number } = await numbering.allocate(client, "location_request");
  const home = r.request_type === "temporary_home";
  const visit = r.request_type === "client_visit";
  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO attendance_location_request
       (number, employee_id, request_type, starts_on, ends_on, address, latitude, longitude, accuracy_m,
        site_latitude, site_longitude, site_radius_m, reason, requested_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING location_request_id`,
    [
      number,
      user.employee_id,
      r.request_type,
      r.starts_on,
      r.ends_on,
      r.address ? places.lineOf(r.address) : null,
      home ? r.home_latitude : null,
      home ? r.home_longitude : null,
      home ? r.accuracy_m : null,
      visit ? r.site_latitude ?? null : null,
      visit ? r.site_longitude ?? null : null,
      visit ? r.site_radius_m ?? null : null,
      r.reason || "Working with a partner on site",
      user.user_id,
    ],
  );
  if (r.address) await places.save(client, "attendance_location_request.address", row.location_request_id, r.address);
  const instance = await engine.openInstance(client, {
    definition_key: "attendance.location_request",
    entity: { type: "attendance_location_request", id: row.location_request_id },
    subject_employee_id: user.employee_id,
    context: { days: lagos.daysBetween(r.starts_on, r.ends_on) + 1 },
    actor: user,
  });
  await client.query("UPDATE attendance_location_request SET workflow_instance_id = $2 WHERE location_request_id = $1", [
    row.location_request_id,
    instance.workflow_instance_id,
  ]);
  return { location_request_id: row.location_request_id, workflow_instance_id: instance.workflow_instance_id, number };
}

/**
 * An assignment as a line manager or People set it then, in force at once.
 * @param {import("pg").PoolClient} client  inside atomically()
 * @param {{user_id: string}} user  who set it
 * @param {object} a  the old FieldAssignmentCreate's fields, each site's `address` a parsed PlaceInput or none
 * @returns {Promise<{field_assignment_id: string, number: string}>}
 */
async function legacyAssignment(client, user, a) {
  const { number } = await numbering.allocate(client, "field_assignment");
  const {
    rows: [row],
  } = await client.query(
    `INSERT INTO attendance_field_assignment (number, name, client, note, starts_on, ends_on, assigned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING field_assignment_id`,
    [number, a.name, a.client, a.note || null, a.starts_on, a.ends_on, user.user_id],
  );
  for (const [i, site] of a.sites.entries()) {
    const {
      rows: [made],
    } = await client.query(
      `INSERT INTO attendance_field_site (field_assignment_id, position, name, address, latitude, longitude, radius_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING field_site_id`,
      [row.field_assignment_id, i + 1, site.name, site.address ? places.lineOf(site.address) : null, site.latitude, site.longitude, site.radius_m],
    );
    if (site.address) await places.save(client, "attendance_field_site.address", made.field_site_id, site.address);
  }
  await client.query(
    "INSERT INTO attendance_field_member (field_assignment_id, employee_id) SELECT $1, x FROM unnest($2::uuid[]) AS x",
    [row.field_assignment_id, [...a.employee_ids].sort()],
  );
  return { field_assignment_id: row.field_assignment_id, number };
}

module.exports = { legacyRequest, legacyAssignment };
