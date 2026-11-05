"use strict";
/**
 * /api/v1/recruitment/pool: Recruitment · Talent Pool (docs/guides/recruitment.md §5, §6.9).
 *
 *   GET  /, /summary, /:id    `recruitment` view, scope by the hiring manager of the vacancy applied for
 *   POST /                    `recruitment` create: Add to Pool (or renew)
 *   POST /:id/invite          `recruitment` edit: Invite to Apply
 *   POST /:id/remove          `recruitment` delete: off the pool early
 *   POST /exports             `recruitment` export: the filtered pool as a workbook
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./talent_pool.controller");

const router = express.Router();
const t = c.talent_pool;
const byId = { params: c.common.IdParams };

route(router, "get", "/", { query: t.PoolListQuery, response: t.PoolPage, summary: "The Talent Pool" }, requirePermission("recruitment", "view"), controller.list);
route(router, "get", "/summary", { response: t.PoolSummary, summary: "The figures above the Talent Pool" }, requirePermission("recruitment", "view"), controller.summary);
route(router, "get", "/:id", { ...byId, response: t.PoolEntry, summary: "One person in the Talent Pool" }, requirePermission("recruitment", "view"), controller.get);
route(router, "post", "/", { body: t.PoolAdd, response: t.PoolEntry, summary: "Add a candidate to the Talent Pool" }, requirePermission("recruitment", "create"), controller.add);
route(router, "post", "/exports", { body: t.PoolExportRequest, response: c.documents.ExportFile, summary: "Export the Talent Pool as a workbook" },
  requirePermission("recruitment", "export"), controller.requestExport);
route(router, "post", "/:id/invite", { ...byId, body: t.PoolInvite, response: t.PoolEntry, summary: "Invite someone in the pool to apply" },
  requirePermission("recruitment", "edit"), controller.invite);
route(router, "post", "/:id/remove", { ...byId, body: t.PoolRemove, response: t.PoolEntry, summary: "Take someone off the Talent Pool" },
  requirePermission("recruitment", "delete"), controller.remove);

module.exports = { basePath: "/recruitment/pool", surface: "staff", router };
