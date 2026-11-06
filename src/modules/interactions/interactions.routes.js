"use strict";
/**
 * Partnerships · interactions (docs/guides/partnerships.md §5), mounted on /api/v1/partnerships:
 *
 *   GET  /interactions   view: a record's calls, meetings, emails, visits and notes, seen with it
 *   POST /interactions   create: Log Interaction
 *
 * Linking a mail thread is on the mailbox's routes (M7 PR 8).
 */
const router = require("express").Router();
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./interactions.controller");

const i = c.interactions;

route(router, "get", "/interactions", { query: i.InteractionListQuery, response: i.InteractionPage, summary: "Interactions the reader may see" }, requirePermission("partnerships", "view"), controller.list);
route(router, "post", "/interactions", { body: i.InteractionCreate, response: i.Interaction, summary: "Log an interaction" }, requirePermission("partnerships", "create"), controller.create);

module.exports = { basePath: "/partnerships", surface: "staff", router };
