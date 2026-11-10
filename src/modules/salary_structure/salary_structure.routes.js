"use strict";
/**
 * /api/v1/salary-structure: grades, placements and pay components (docs/guides/payroll.md §5, §6.11 rules 4 to 6).
 * Advanced mode only: every route answers 409 ADVANCED_OFF until the option is on or has been.
 *
 *   GET  /grades                                  `payroll` view: Bands by Grade, with who is placed and outside the band
 *   POST /grades                                  `payroll` edit, `payroll.configure`: Save Grade, a band from a day
 *   GET  /placements                              `payroll` view: everyone paid now against their band
 *   PUT  /placements/:employee_id                 `payroll` edit, `payroll.configure`: Place Person in a grade from a day
 *   GET  /employees/:employee_id/components       `payroll` view: the person's pay split today and the next one
 *   PUT  /employees/:employee_id/components       `payroll` edit, `payroll.configure`: Set Pay Components from a day
 */
const express = require("express");
const c = require("@mycity/contract");
const { route } = require("../../http/route");
const { requirePermission, requireCapability } = require("../../middleware/rbac");
const controller = require("./salary_structure.controller");

const router = express.Router();
const s = c.salary_structure;
const byPerson = { params: s.SalaryStructureParams };

route(router, "get", "/grades", { query: s.SalaryGradeListQuery, response: s.SalaryGradePage, summary: "Salary grades and their bands" },
  requirePermission("payroll", "view"), controller.grades);

route(router, "post", "/grades", { body: s.SalaryGradeSave, response: s.SalaryGrade, summary: "Set a salary grade's band from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.saveGrade);

route(router, "get", "/placements", { query: s.GradePlacementListQuery, response: s.GradePlacementPage, summary: "Everyone paid now against their grade's band" },
  requirePermission("payroll", "view"), controller.placements);

route(router, "put", "/placements/:employee_id", { ...byPerson, body: s.GradePlacementSave, response: s.GradePlacement, summary: "Place a person in a salary grade from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.savePlacement);

route(router, "get", "/employees/:employee_id/components", { ...byPerson, response: s.PayComponentSet, summary: "A person's pay split" },
  requirePermission("payroll", "view"), controller.components);

route(router, "put", "/employees/:employee_id/components", { ...byPerson, body: s.PayComponentsSave, response: s.PayComponentSet, summary: "Set a person's pay split from a date" },
  requirePermission("payroll", "edit"), requireCapability("payroll.configure"), controller.saveComponents);

module.exports = { basePath: "/salary-structure", surface: "staff", router };
