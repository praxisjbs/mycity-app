"use strict";
/**
 * What the salary structure records (docs/guides/payroll.md §7). Events carry the code, the person and the day, never
 * an amount or a band's figures (§6.13 rule 5): those live in the tables and are masked on the way out.
 *
 *   salary_grade.saved      a grade, or a new version of its band, from a day
 *   grade_placement.saved   a person was placed in a grade from a day
 *   pay_components.saved    a person's pay split from a day
 *
 * Nobody is told: these are configuration, and who changed them is on the Audit Log and the person's history.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("payroll", {
  "salary_grade.saved": { summary: "A salary grade's band was set from a date" },
  "grade_placement.saved": { summary: "A person was placed in a salary grade from a date" },
  "pay_components.saved": { summary: "A person's pay split into components was set from a date" },
});

module.exports = { EVENTS };
