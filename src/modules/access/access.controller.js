"use strict";
/**
 * Access's HTTP edge: the role list the Users screen picks from. Editing roles is
 * Settings · Roles & Permissions, served under /settings (settings.routes.js).
 */
const { sendPaged } = require("../../shared/http/paged");
const service = require("./access.service");

const roles = async (req, res) =>
  sendPaged(res, await service.rolePage(req.validated.query));

module.exports = { roles };
