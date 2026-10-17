"use strict";
/**
 * What the worksites module records (docs/guides/attendance.md §7). Assigning someone
 * to a worksite is a change to their employee record, recorded by the organisation
 * service (`employee.updated`), so it has no event of its own here.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("people", {
  "worksite.created": { summary: "A worksite was added" },
  "worksite.updated": { summary: "A worksite was changed, retired or restored" },
});

module.exports = { EVENTS };
