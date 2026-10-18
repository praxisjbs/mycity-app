"use strict";
/**
 * /api/v1/home: Home's alerts and the rules that raise them (docs/guides/home.md §5). The
 * Overview, Team and Reports mount their own routers at the same base path.
 *
 *   GET   /alerts                `home` view, `alerts.clear` or `alerts.manage`: a page of 25
 *   GET   /alerts/summary        as above: the counts, the category chips, Alert Sources
 *   GET   /alerts/:id            as above: one alert (404 when the reader may not see it)
 *   POST  /alerts/:id/clear      `home` view, `alerts.clear`: clear or dismiss it, when the
 *                                rule's grant also reaches the person it is about
 *   GET   /alert-rules           `home` view, `alerts.manage`: a page of 25
 *   GET   /alert-rules/:id       as above
 *   POST  /alert-rules           as above: a new rule, its key made by the server
 *   PATCH /alert-rules/:id       as above: any field but the metric; off dismisses its open alerts
 *
 * Every login holds `home` view, so the alerts a reader sees are decided in the service, per
 * rule and per person; the capability opens the tab and sets no scope. A literal path is
 * defined before the `/:id` beside it.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability, requireAnyCapability } = require("../../middleware/rbac");
const controller = require("./alerts.controller");

const router = express.Router();
const a = c.alerts;
const view = requirePermission("home", "view");

route(router, "get", "/alerts",
  { query: a.HomeAlertQuery, response: a.HomeAlertPage, summary: "The alerts I may see" },
  view, requireAnyCapability(["alerts.clear", "alerts.manage"]), controller.list);

route(router, "get", "/alerts/summary",
  { response: a.HomeAlertSummary, summary: "The counts over the alerts I may see" },
  view, requireAnyCapability(["alerts.clear", "alerts.manage"]), controller.summary);

route(router, "get", "/alerts/:id",
  { params: c.common.IdParams, response: a.HomeAlert, summary: "One alert" },
  view, requireAnyCapability(["alerts.clear", "alerts.manage"]), controller.get);

route(router, "post", "/alerts/:id/clear",
  { params: c.common.IdParams, body: a.HomeAlertClear, response: a.HomeAlert, summary: "Clear or dismiss an alert" },
  view, requireCapability("alerts.clear"), controller.clear);

route(router, "get", "/alert-rules",
  { query: a.HomeAlertRuleQuery, response: a.HomeAlertRulePage, summary: "The alert rules" },
  view, requireCapability("alerts.manage"), controller.rules);

route(router, "get", "/alert-rules/:id",
  { params: c.common.IdParams, response: a.HomeAlertRule, summary: "One alert rule" },
  view, requireCapability("alerts.manage"), controller.rule);

route(router, "post", "/alert-rules",
  { body: a.HomeAlertRuleCreate, response: a.HomeAlertRule, summary: "Create an alert rule" },
  view, requireCapability("alerts.manage"), controller.createRule);

route(router, "patch", "/alert-rules/:id",
  { params: c.common.IdParams, body: a.HomeAlertRuleUpdate, response: a.HomeAlertRule,
    summary: "Change an alert rule, or switch it on or off" },
  view, requireCapability("alerts.manage"), controller.updateRule);

module.exports = { basePath: "/home", surface: "staff", router };
