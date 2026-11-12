"use strict";
/**
 * /api/v1/recruitment/onboarding: Recruitment · Onboarding (docs/guides/offers.md §5).
 *
 *   GET  /                                         `recruitment` view: the cases, 25 a page, in scope
 *   GET  /summary                                  `recruitment` view: the figures above the list
 *   GET  /:id                                      `recruitment` view: one case, its checklist,
 *                                                  guarantors, contract and what it waits on
 *   POST /:id/items/:item_id/verify, /reject       `recruitment` edit: check what the hire sent
 *   POST /:id/guarantors/:guarantor_id/check       `recruitment` edit: a reference check, Passed or Failed
 *   POST /:id/remind                               `recruitment` edit: Send Reminder, a fresh link
 *   POST /:id/steps/:step_id/done                  `recruitment` edit: Mark Step Done
 *   POST /:id/complete                             `recruitment` edit: Complete Onboarding, with the
 *                                                  hire's company email
 *   POST /:id/withdraw                             `recruitment` edit: Withdraw, the hire not joining
 *   GET, POST /requirements, PATCH /requirements/:id    `recruitment` edit: the Checklist settings
 *   GET, POST /plans, GET, PUT /plans/:id               `recruitment` edit: the Plans settings
 *
 * A case is opened by the offer's acceptance and started on its start date by onboarding-dispatch,
 * never by a route here; the contract's own routes are
 * /recruitment/contracts (employment_contracts.routes.js).
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission } = require("../../middleware/rbac");
const controller = require("./onboarding.controller");

const router = express.Router();
const o = c.onboarding;
const view = requirePermission("recruitment", "view");
const edit = requirePermission("recruitment", "edit");

// The settings first: their words are not ids.
route(router, "get", "/requirements", { query: o.DocumentRequirementListQuery, response: o.DocumentRequirementPage, summary: "The Checklist settings" }, edit, controller.requirements);
route(router, "post", "/requirements", { body: o.DocumentRequirementCreate, response: o.DocumentRequirement, summary: "Add a document requirement" }, edit, controller.createRequirement);
route(router, "patch", "/requirements/:id", { params: o.DocumentRequirementParams, body: o.DocumentRequirementEdit, response: o.DocumentRequirement, summary: "Change a document requirement" }, edit, controller.editRequirement);
route(router, "get", "/plans", { query: o.OnboardingPlanListQuery, response: o.OnboardingPlanPage, summary: "The Plans settings" }, edit, controller.plans);
route(router, "post", "/plans", { body: o.OnboardingPlanSave, response: o.OnboardingPlan, summary: "Add an onboarding plan" }, edit, controller.createPlan);
route(router, "get", "/plans/:id", { params: o.OnboardingPlanParams, response: o.OnboardingPlan, summary: "One onboarding plan" }, edit, controller.plan);
route(router, "put", "/plans/:id", { params: o.OnboardingPlanParams, body: o.OnboardingPlanSave, response: o.OnboardingPlan, summary: "Save an onboarding plan" }, edit, controller.savePlan);

route(router, "get", "/", { query: o.OnboardingListQuery, response: o.OnboardingPage, summary: "The onboarding cases" }, view, controller.list);
route(router, "get", "/summary", { response: o.OnboardingSummary, summary: "The figures above the Onboarding list" }, view, controller.summary);
route(router, "get", "/:id", { params: o.OnboardingParams, response: o.OnboardingDetail, summary: "One onboarding case" }, view, controller.get);
route(router, "post", "/:id/items/:item_id/verify", { params: o.ChecklistItemParams, body: c.common.EmptyBody, response: o.OnboardingDetail, summary: "Verify a document" }, edit, controller.verifyItem);
route(router, "post", "/:id/items/:item_id/reject", { params: o.ChecklistItemParams, body: o.ChecklistItemReject, response: o.OnboardingDetail, summary: "Reject a document" }, edit, controller.rejectItem);
route(router, "post", "/:id/guarantors/:guarantor_id/check", { params: o.GuarantorParams, body: o.ReferenceCheckRecord, response: o.OnboardingDetail, summary: "Record a reference check" }, edit, controller.checkGuarantor);
route(router, "post", "/:id/remind", { params: o.OnboardingParams, body: c.common.EmptyBody, response: o.OnboardingDetail, summary: "Send the Upload Documents link again" }, edit, controller.remind);
route(router, "post", "/:id/steps/:step_id/done", { params: o.CaseStepParams, body: c.common.EmptyBody, response: o.OnboardingDetail, summary: "Mark an onboarding step done" }, edit, controller.markStepDone);
route(router, "post", "/:id/complete", { params: o.OnboardingParams, body: o.OnboardingComplete, response: o.OnboardingDetail, summary: "Complete onboarding" }, edit, controller.complete);
route(router, "post", "/:id/withdraw", { params: o.OnboardingParams, body: o.OnboardingCancel, response: o.OnboardingDetail, summary: "Withdraw an onboarding case" }, edit, controller.withdraw);

module.exports = { basePath: "/recruitment/onboarding", surface: "staff", router };
