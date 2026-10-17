"use strict";
/**
 * People · Employees, the employee 360, departments, seats and the reporting tree: the
 * HTTP edge. It reads the request, calls the service and sends the answer.
 *
 * The one thing it does of its own is masking: a response that can carry salary, bank
 * details or personal data goes through shared/rbac/field-mask.js, which nulls what the
 * caller may not see. A person's own record is never masked from them, and the CEO is
 * never masked (FRONTEND_GUIDE §5; BACKEND_STRUCTURE §9.4).
 */
const { pool } = require("../../config/db");
const { atomically } = require("../../shared/db/tx");
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { scopeOf, assertInScope } = require("../../shared/rbac/scope");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const employee360 = require("./employee-360.service");
const service = require("./organisation.service");

const id = (req) => req.validated.params.id;

/** Run one write in its own transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    return await atomically(client, () => fn(client));
  } finally {
    client.release();
  }
}

/** Mask what the caller may not see, unless the record is their own. */
const maskUnlessOwn = (req, record) =>
  record.employee_id && req.user && record.employee_id === req.user.employee_id
    ? record
    : maskForUser(pool, req.user, record);

/** The record, if this caller may open it at all. */
async function readable(req) {
  const record = await employee360.get(pool, id(req));
  assertInScope(scopeOf(req), record.employee_id);
  return record;
}

module.exports = {
  list: async (req, res) => sendPaged(res, await service.list(pool, req.validated.query, scopeOf(req))),

  summary: async (req, res) => ok(res, await service.summary(pool, scopeOf(req))),

  get: async (req, res) => ok(res, await maskUnlessOwn(req, await readable(req))),

  create: async (req, res) => {
    const employee = await tx((client) =>
      service.createEmployee(client, req.validated.body, withActor(req)),
    );
    return created(res, await maskUnlessOwn(req, await employee360.get(pool, employee.employee_id)));
  },

  update: async (req, res) => {
    await readable(req);
    await tx((client) => service.updateEmployee(client, id(req), req.validated.body, withActor(req)));
    return ok(res, await maskUnlessOwn(req, await employee360.get(pool, id(req))));
  },

  archive: async (req, res) => {
    await readable(req);
    await tx((client) =>
      service.archiveEmployee(client, id(req), req.validated.body.archive_reason, withActor(req)),
    );
    return ok(res, await maskUnlessOwn(req, await employee360.get(pool, id(req))));
  },

  restore: async (req, res) => {
    await readable(req);
    await tx((client) => service.restoreEmployee(client, id(req), withActor(req)));
    return ok(res, await maskUnlessOwn(req, await employee360.get(pool, id(req))));
  },

  setLineManager: async (req, res) => {
    await readable(req);
    await tx((client) =>
      service.setReportingLine(client, id(req), req.validated.body, withActor(req)),
    );
    return ok(res, await maskUnlessOwn(req, await employee360.get(pool, id(req))));
  },

  history: async (req, res) => {
    await readable(req);
    const page = await employee360.history(pool, id(req), req.validated.query);
    return sendPaged(res, await maskForUser(pool, req.user, page));
  },

  departments: async (req, res) => sendPaged(res, await service.departments(pool, req.validated.query)),

  createDepartment: async (req, res) =>
    created(res, await tx((client) => service.createDepartment(client, req.validated.body, withActor(req)))),

  updateDepartment: async (req, res) =>
    ok(res, await tx((client) => service.updateDepartment(client, id(req), req.validated.body, withActor(req)))),

  seats: async (req, res) => sendPaged(res, await service.seats(pool, req.validated.query)),

  createSeat: async (req, res) =>
    created(res, await tx((client) => service.createSeat(client, req.validated.body, withActor(req)))),

  updateSeat: async (req, res) =>
    ok(res, await tx((client) => service.updateSeat(client, id(req), req.validated.body, withActor(req)))),

  orgChart: async (req, res) => ok(res, await service.orgChart(pool, req.validated.query)),
};
