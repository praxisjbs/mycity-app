"use strict";
/**
 * Organisation events (loaded by the API and the worker). An employee record holds
 * personal data, so its audit rows are marked sensitive: the Audit Log masks them
 * for people without the field grant.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("people", {
  "department.created": { summary: "A department was created" },
  "employee.created": { summary: "An employee record was created", sensitive: true },
});

module.exports = { EVENTS };
