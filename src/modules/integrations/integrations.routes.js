"use strict";
/**
 * /api/v1/integrations: Settings · Integrations (docs/guides/integrations.md §5).
 *
 *   GET    /                               view    every connection, 25 a page
 *   GET    /summary                        view    the connections counted by state
 *   GET    /:code                          view    one connection; secrets as far as shown
 *   GET    /:code/checks                   view    its checks, newest first, 25 a page
 *   PUT    /:code                          edit    test what was typed, then save it
 *   DELETE /:code                          delete  forget what was saved
 *   POST   /:code/test                     edit    test the settings in use
 *   POST   /mail_sender/test-email         edit    a real message to the tester
 *   POST   /web_push/replace-keys          edit    a new key pair
 *
 * The `integrations` key, not `settings`: only the IT team holds it (seed 9290). A test and a
 * test email need edit because they act on the connection: a test email is a real message,
 * and a Geoapify test spends credits. Saving a secret, removing saved settings and replacing
 * keys also need a fresh sign-in, checked in the service (403 REAUTH_REQUIRED).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./integrations.controller");

const router = express.Router();
const i = c.integrations;

route(router, "get", "/",
  { query: i.IntegrationListQuery, response: i.IntegrationPage, summary: "Every connection on Settings, Integrations" },
  requirePermission("integrations", "view"), controller.list);

route(router, "get", "/summary",
  { response: i.IntegrationSummary, summary: "The counts above Settings, Integrations" },
  requirePermission("integrations", "view"), controller.summary);

route(router, "post", "/mail_sender/test-email",
  { body: c.common.EmptyBody, response: i.IntegrationCheck, summary: "Send a test email to myself" },
  requirePermission("integrations", "edit"), controller.testEmail);

route(router, "post", "/web_push/replace-keys",
  { body: c.common.EmptyBody, response: i.Integration, summary: "Replace the web push key pair" },
  requirePermission("integrations", "edit"), controller.replaceKeys);

route(router, "get", "/:code",
  { params: i.IntegrationParams, response: i.Integration, summary: "One connection" },
  requirePermission("integrations", "view"), controller.get);

route(router, "get", "/:code/checks",
  { params: i.IntegrationParams, query: i.IntegrationCheckListQuery, response: i.IntegrationCheckPage, summary: "A connection's checks" },
  requirePermission("integrations", "view"), controller.checks);

route(router, "put", "/:code",
  { params: i.IntegrationParams, body: i.IntegrationSave, response: i.Integration, summary: "Test and save a connection's settings" },
  requirePermission("integrations", "edit"), controller.save);

route(router, "delete", "/:code",
  { params: i.IntegrationParams, no_content: true, summary: "Remove a connection's saved settings" },
  requirePermission("integrations", "delete"), controller.remove);

route(router, "post", "/:code/test",
  { params: i.IntegrationParams, body: i.IntegrationTestBody, response: i.IntegrationCheck, summary: "Test a connection" },
  requirePermission("integrations", "edit"), controller.test);

module.exports = { basePath: "/integrations", surface: "staff", router };
