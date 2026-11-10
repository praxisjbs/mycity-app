"use strict";
// ai:none design: grades, a person's grade and their pay split are a structure laid out whole on Configurations by someone with payroll.configure, never drafted in the chat (praxis-ai.md decision 35)
// search:none a grade or a pay split is configuration, not a record: the Configurations screen is what ⌘K finds (words grades, salary structure, pay components)
/**
 * Salary structure and pay components: the HTTP edge for Configurations' Salary Structure and Pay Components
 * (docs/guides/payroll.md §5, §6.11). Read with the `payroll` grant, written with `payroll` edit and the
 * `payroll.configure` capability, which the routes check; every route answers 409 ADVANCED_OFF until the advanced
 * option is on or has been. A band's limits, a person's gross, a component's amount and where a person stands against
 * their band are masked for a reader without the salary grant (`band_minimum`, `band_maximum`, `gross_pay`,
 * `pay_amount`, `band_position`), so they reach the screen as Restricted.
 */
const { pool } = require("../../config/db");
const { ok, created } = require("../../shared/http/respond");
const { sendPaged } = require("../../shared/http/paged");
const { maskForUser } = require("../../shared/rbac/field-mask");
const { withActor } = require("../../shared/events/emit");
const service = require("./salary_structure.service");

const masked = (req, data) => maskForUser(pool, req.user, data);
const person = (req) => req.validated.params.employee_id;

module.exports = {
  grades: async (req, res) => sendPaged(res, await masked(req, await service.listGrades(req.validated.query))),

  saveGrade: async (req, res) => created(res, await masked(req, await service.saveGrade(withActor(req), req.validated.body))),

  placements: async (req, res) => sendPaged(res, await masked(req, await service.listPlacements(req.validated.query))),

  savePlacement: async (req, res) => ok(res, await masked(req, await service.savePlacement(withActor(req), person(req), req.validated.body))),

  components: async (req, res) => ok(res, await masked(req, await service.components(person(req)))),

  saveComponents: async (req, res) => ok(res, await masked(req, await service.saveComponents(withActor(req), person(req), req.validated.body))),
};
