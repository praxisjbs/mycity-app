"use strict";
/**
 * The Settings screens' HTTP edge: Organisation (the profile, the working week,
 * holidays), Roles & Permissions (access), Documents & Numbering, and Security (the
 * rules, failed sign-ins, everyone's live sessions). Each call goes to the module that
 * owns the data: settings, access, or security for sessions.
 */
const { ok, created, noContent } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { withActor } = require("../../shared/events/emit");
const { readUpload } = require("../../middleware/upload");
const access = require("../access/access.service");
const sessions = require("../security/security.sessions");
const service = require("./settings.service");

const id = (req) => req.validated.params.id;

module.exports = {
  // Organisation
  organisation: async (_req, res) => ok(res, await service.organisation()),
  updateOrganisation: async (req, res) =>
    ok(res, await service.updateOrganisation(req.validated.body, withActor(req))),
  uploadBrand: async (req, res) =>
    created(res, await service.uploadBrand(req.validated.params.slot, readUpload(req), withActor(req))),
  removeBrand: async (req, res) =>
    ok(res, await service.removeBrand(req.validated.params.slot, withActor(req))),
  week: async (_req, res) => ok(res, await service.week()),
  saveWeek: async (req, res) => ok(res, await service.saveWeek(req.validated.body, withActor(req))),
  holidays: async (req, res) => sendPaged(res, await service.holidays(req.validated.query)),
  addHoliday: async (req, res) => created(res, await service.addHoliday(req.validated.body, withActor(req))),
  updateHoliday: async (req, res) =>
    ok(res, await service.updateHoliday(id(req), req.validated.body, withActor(req))),
  removeHoliday: async (req, res) => {
    await service.removeHoliday(id(req), withActor(req));
    return noContent(res);
  },

  // Roles & Permissions
  roles: async (req, res) => sendPaged(res, await access.roleRows(req.validated.query)),
  catalogue: async (_req, res) => ok(res, await access.catalogue()),
  matrix: async (_req, res) => ok(res, await access.matrix()),
  role: async (req, res) => ok(res, await access.roleDetail(id(req))),
  createRole: async (req, res) => created(res, await access.createRole(req.validated.body, withActor(req))),
  updateRole: async (req, res) =>
    ok(res, await access.updateRole(id(req), req.validated.body, withActor(req))),
  deleteRole: async (req, res) => {
    await access.deleteRole(id(req), withActor(req));
    return noContent(res);
  },

  // Documents & Numbering
  schemes: async (req, res) => sendPaged(res, await service.numberingList(req.validated.query)),
  numberingSummary: async (_req, res) => ok(res, await service.numberingSummary()),
  saveScheme: async (req, res) =>
    ok(res, await service.saveScheme(req.validated.params.doc_type, req.validated.body, withActor(req))),

  // Security
  security: async (_req, res) => ok(res, await service.securityPolicy()),
  updateSecurity: async (req, res) => ok(res, await service.updateSecurity(req.validated.body, withActor(req))),
  failedSignIns: async (req, res) => sendPaged(res, await service.failedSignIns(req.validated.query)),
  sessions: async (req, res) => sendPaged(res, await sessions.list(req.validated.query, req.user)),
  endSession: async (req, res) => {
    await sessions.end(id(req), withActor(req));
    return noContent(res);
  },
};
