"use strict";
/**
 * /api/v1/audit: Settings · Audit Log. Settings view with scope all, and the CEO
 * (whose scope is always all); the service refuses a narrower scope. The export needs
 * Settings export as well.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./audit.controller");

const router = express.Router();

route(router, "get", "/",
  { query: c.audit.AuditListQuery, response: c.audit.AuditPage, summary: "The audit log, filtered" },
  requirePermission("settings", "view"), controller.list);

route(router, "get", "/summary",
  { response: c.audit.AuditSummary, summary: "Counts above the audit log" },
  requirePermission("settings", "view"), controller.summary);

route(router, "post", "/exports",
  { body: c.audit.AuditExportRequest, response: c.audit.AuditExportQueued, summary: "Email the filtered log as a workbook" },
  requirePermission("settings", "export"), controller.requestExport);

module.exports = { basePath: "/audit", surface: "staff", router };
