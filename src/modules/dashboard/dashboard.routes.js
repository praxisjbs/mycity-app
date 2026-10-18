"use strict";
/**
 * /api/v1/home: the Overview, the records behind a card, the cards a person chooses and
 * the cards a role opens on (docs/guides/home.md §5). The Team tab, Alerts and Reports
 * mount their own routers at the same base path.
 *
 *   GET    /overview                `home` view: the reader's Overview, resolved for them
 *   GET    /kpi-picker              `home` view: the cards they may choose, and their own
 *   PUT    /kpi-picks               `home` view: choose up to four, locks kept
 *   DELETE /kpi-picks               `home` view: back to their roles' cards
 *   GET    /kpi/:key/meta           `home` view, and the card's own eligibility (404 without)
 *   GET    /kpi/:key                as above: the records behind it, paged at 25, masked
 *   GET    /roles/:role_id/kpis     `settings` view: a role's cards (the editor is M9)
 *   PUT    /roles/:role_id/kpis     `settings` edit
 *   DELETE /roles/:role_id/kpis     `settings` edit: back to the Home view's defaults
 *
 * Every login holds `home` view, so the card a reader may open is decided per card in the
 * service, never by the route. Need You's requests are GET /workflow/mine, their own list.
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./dashboard.controller");

const router = express.Router();
const d = c.dashboard;
const view = requirePermission("home", "view");

route(router, "get", "/overview",
  { response: d.HomeOverview, summary: "The signed-in person's Overview" },
  view, controller.overview);

route(router, "get", "/kpi-picker",
  { response: d.HomeKpiPicker, summary: "The cards a person may choose, and the ones they chose" },
  view, controller.picker);

route(router, "put", "/kpi-picks",
  { body: d.HomeKpiPicks, response: d.HomeKpiPicker, summary: "Choose the cards on my Overview" },
  view, controller.savePicks);

route(router, "delete", "/kpi-picks",
  { no_content: true, summary: "Go back to my roles' cards" },
  view, controller.resetPicks);

route(router, "get", "/kpi/:key/meta",
  { params: d.HomeKpiParams, response: d.HomeKpiDetailMeta, summary: "What the records behind a card are" },
  view, controller.kpiMeta);

route(router, "get", "/kpi/:key",
  { params: d.HomeKpiParams, query: d.HomeKpiDetailQuery, response: d.HomeKpiDetailPage,
    summary: "The records behind a card" },
  view, controller.kpiPage);

route(router, "get", "/roles/:role_id/kpis",
  { response: d.HomeRoleKpis, summary: "The cards a role opens Home on" },
  requirePermission("settings", "view"), controller.roleCards);

route(router, "put", "/roles/:role_id/kpis",
  { body: d.HomeRoleKpisSave, response: d.HomeRoleKpis, summary: "Set the cards a role opens Home on" },
  requirePermission("settings", "edit"), controller.saveRoleCards);

route(router, "delete", "/roles/:role_id/kpis",
  { no_content: true, summary: "Take a role back to its Home view's cards" },
  requirePermission("settings", "edit"), controller.resetRoleCards);

module.exports = { basePath: "/home", surface: "staff", router };
