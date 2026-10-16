"use strict";
// ai:none roles and grants are access configuration, not records the assistant answers from
// search:none roles are picked inside Settings; a role is not a record a person looks up
/**
 * Access's HTTP edge: the role list the Users screen picks from.
 */
const { sendPaged } = require("../../shared/http/paged");
const service = require("./access.service");

const roles = async (req, res) =>
  sendPaged(res, await service.rolePage(req.validated.query));

module.exports = { roles };
