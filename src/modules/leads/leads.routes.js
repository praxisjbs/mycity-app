"use strict";
/**
 * Partnerships · Leads (docs/guides/partnerships.md §5), mounted on /api/v1/partnerships:
 *
 *   GET   /leads/summary        view: the cards above Leads
 *   GET   /leads, /leads/:id    view: leads the reader may see; the Lead 360 (zero-data safe)
 *   POST  /leads                create: New Lead with its contact and first deal (Idempotency-Key)
 *   PATCH /leads/:id            edit: Edit Lead; a converted lead is read only
 *   POST  /leads/:id/lose       edit: Close as Lost
 *   POST  /leads/:id/convert    edit: Convert to Partner, with the signed copy; idempotent
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./leads.controller");

const l = c.leads;
const view = () => requirePermission("partnerships", "view");

route(router, "get", "/leads/summary", { response: l.LeadsSummary, summary: "The figures above Leads" }, view(), controller.summary);
route(router, "get", "/leads", { query: l.LeadListQuery, response: l.LeadPage, summary: "Leads the reader may see" }, view(), controller.list);
route(router, "get", "/leads/:id", { params: c.common.IdParams, response: l.Lead360, summary: "The Lead 360" }, view(), controller.get);
route(router, "post", "/leads", { body: l.LeadCreate, response: l.Lead360, summary: "New Lead, with its contact and first deal" }, requirePermission("partnerships", "create"), controller.create);
route(router, "patch", "/leads/:id", { params: c.common.IdParams, body: l.LeadUpdate, response: l.Lead360, summary: "Edit a lead" }, requirePermission("partnerships", "edit"), controller.update);
route(router, "post", "/leads/:id/lose", { params: c.common.IdParams, body: l.LeadLose, response: l.Lead360, summary: "Close a lead as lost" }, requirePermission("partnerships", "edit"), controller.lose);
route(router, "post", "/leads/:id/convert", { params: c.common.IdParams, body: l.LeadConvert, response: l.LeadConverted, summary: "Convert a lead to a partner" }, requirePermission("partnerships", "edit"), controller.convert);

module.exports = { basePath: "/partnerships", surface: "staff", router };
