"use strict";
/**
 * /api/v1/disbursements: the transfer that pays one authorised request (docs/guides/expenses.md §5,
 * §6.5).
 *
 *   GET   /       `expenses` view and `expenses.finance`: the transfers, `reference_missing` filter
 *   POST  /       `expenses` create and `expenses.finance`: Record Disbursement
 *   PATCH /:id    `expenses` edit and `expenses.finance`: Add Reference
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./disbursements.controller");

const router = express.Router();
const d = c.disbursements;

route(router, "get", "/",
  { query: d.DisbursementListQuery, response: d.DisbursementPage, summary: "Disbursements" },
  requirePermission("expenses", "view"), requireCapability("expenses.finance"), controller.list);

route(router, "post", "/",
  { body: d.DisbursementCreate, response: d.Disbursement, summary: "Record the transfer for an authorised request" },
  requirePermission("expenses", "create"), requireCapability("expenses.finance"), controller.create);

route(router, "patch", "/:id",
  { params: c.common.IdParams, body: d.DisbursementReference, response: d.Disbursement,
    summary: "Add the bank reference to a transfer saved without one" },
  requirePermission("expenses", "edit"), requireCapability("expenses.finance"), controller.addReference);

module.exports = { basePath: "/disbursements", surface: "staff", router };
