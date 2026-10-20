"use strict";
/**
 * Worksites: the one write path for a worksite, and the fence attendance matches a
 * punch to (docs/guides/attendance.md §6.5).
 *
 * A worksite is a centre, a radius and a timezone. People add one, change it, retire it
 * (`active: false`) and restore it; a retired worksite fences nothing, so its people
 * punch unjudged on location until they are assigned elsewhere. Assigning someone is a
 * change to their employee record, made through the organisation service, the one
 * write path for an employee.
 *
 * A worksite's code is made from its name ("Lagos Office" is LAGOS-OFFICE), with a
 * number after it when another worksite has that code.
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { AppError } = require("../../shared/errors");
const { emit } = require("../../shared/events/emit");
const { assertInScope } = require("../../shared/rbac/scope");
const { isTimeZone } = require("../attendance/attendance.rules");
const organisation = require("../organisation/organisation.service");
const repo = require("./worksites.repo");
const places = require("../../shared/places/places");

/** The worksite's address field (shared/places/owners.js). */
const ADDRESS = "worksite.address";
const { EVENTS } = require("./worksites.events");

async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

const notFound = () => new AppError("NOT_FOUND", "That worksite does not exist", 404);

function assertZone(timezone) {
  if (timezone !== undefined && !isTimeZone(timezone))
    throw new AppError("TIMEZONE_UNKNOWN", "Pick a timezone the server knows", 422, {
      timezone: ["Not a timezone"],
    });
}

/** LAGOS-OFFICE from "Lagos Office". */
const codeOf = (name) =>
  String(name)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase()
    .slice(0, 40) || "WORKSITE";

async function freeCode(db, name) {
  const base = codeOf(name);
  for (let n = 1; n < 100; n += 1) {
    const code = n === 1 ? base : `${base}-${n}`;
    if (!(await repo.codeTaken(db, code))) return code;
  }
  throw new AppError("WORKSITE_CODE", "Give the worksite a different name", 409, { name: ["Name in use"] });
}

/** Each worksite's address as a place, for the edit form (F27). */
async function withPlaces(rows) {
  const byId = await places.views(pool, ADDRESS, rows.map((w) => w.worksite_id));
  return rows.map((w) => ({ ...w, address_place: byId.get(w.worksite_id) || null }));
}

async function list(query) {
  const page = await repo.list(pool, query);
  return { ...page, data: await withPlaces(page.data) };
}

async function get(id) {
  const row = await repo.get(pool, id);
  if (!row) throw notFound();
  return (await withPlaces([row]))[0];
}

/** The active fence a punch is matched to, or null. In the caller's transaction or pool. */
const fenceFor = (db, id) => (id ? repo.fence(db, id) : null);

async function create(actor, body) {
  assertZone(body.timezone);
  const id = await tx(async (client) => {
    const code = await freeCode(client, body.name);
    const place = body.address;
    const row = await repo.insert(client, { ...body, address: place ? places.lineOf(place) : "", code });
    if (place) await places.save(client, ADDRESS, row.worksite_id, place);
    const after = await repo.get(client, row.worksite_id);
    await emit(client, {
      key: EVENTS.WORKSITE_CREATED,
      entity: { type: "worksite", id: row.worksite_id },
      actor,
      after,
      payload: { worksite_id: row.worksite_id, name: after.name },
    });
    return row.worksite_id;
  });
  return get(id);
}

async function update(actor, id, patch) {
  assertZone(patch.timezone);
  const before = await repo.get(pool, id);
  if (!before) throw notFound();
  await tx(async (client) => {
    const change = { ...patch };
    if (patch.address === null) {
      await places.remove(client, ADDRESS, id);
      change.address = "";
    } else if (patch.address !== undefined) {
      change.address = (await places.save(client, ADDRESS, id, patch.address)).line;
    }
    await repo.update(client, id, change);
    const after = await repo.get(client, id);
    await emit(client, {
      key: EVENTS.WORKSITE_UPDATED,
      entity: { type: "worksite", id },
      actor,
      before,
      after,
      payload: { worksite_id: id, name: after.name, active: after.active },
    });
  });
  return get(id);
}

/** The people assigned to a worksite, within the reader's scope. */
async function employees(id, query, scope) {
  await get(id);
  return repo.employees(pool, id, query, scope);
}

/** Assign someone to a worksite (it moves them from any other). */
async function assign(actor, scope, id, body) {
  const site = await repo.get(pool, id);
  if (!site) throw notFound();
  if (!site.active)
    throw new AppError("WORKSITE_RETIRED", "Restore the worksite before assigning anyone", 409);
  assertInScope(scope, body.employee_id);
  const person = await repo.employee(pool, body.employee_id);
  if (!person || person.status !== "active")
    throw new AppError("EMPLOYEE_NOT_ACTIVE", "Pick someone who works here now", 422, {
      employee_id: ["Not active"],
    });
  if (person.worksite_id !== id)
    await tx((client) => organisation.updateEmployee(client, body.employee_id, { worksite_id: id }, actor));
  const { status: _s, ...out } = await repo.employee(pool, body.employee_id);
  return out;
}

module.exports = { list, get, fenceFor, create, update, employees, assign, codeOf };
