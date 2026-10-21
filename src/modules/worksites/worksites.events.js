"use strict";
/**
 * What the worksites module records (docs/guides/attendance.md §7). Assigning someone
 * to a worksite is a change to their employee record, recorded by the organisation
 * service (`employee.updated`), so it has no event of its own here.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");
const repo = require("./worksites.repo");

const EVENTS = defineEvents("people", {
  "worksite.created": { summary: "A worksite was added" },
  "worksite.updated": { summary: "A worksite was changed, retired or restored" },
});

/** A worksite's address saved while search was down is named by the places-name job (F27). */
places.owner("worksite.address", { rename: (client, id, line) => repo.update(client, id, { address: line }) });

module.exports = { EVENTS };
