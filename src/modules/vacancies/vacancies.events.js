"use strict";
/**
 * What the vacancies module records (docs/guides/recruitment.md §7). Loaded by the API (through the
 * service) and the worker. Payloads carry ids, numbers and titles; never a description.
 *
 *   vacancy.created, vacancy.updated            New Vacancy and Edit
 *   vacancy.published, .paused, .resumed, .closed   the lifecycle (guide §6.1); Home's card reads it
 *   vacancy.questions_saved, vacancy.scorecard_saved   the Apply questions and traits, the parts
 *   recruitment.careers_settings_saved           About MyCityApp and the Default Traits
 *
 * The vacancy's location is a picked place (owner vacancy.location, addresses.md §6.9); a waiting
 * place named later rewrites the vacancy's line through this module's repo.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const places = require("../../shared/places/owners");
const repo = require("./vacancies.repo");

const EVENTS = defineEvents("recruitment", {
  "vacancy.created": { summary: "A vacancy was written" },
  "vacancy.updated": { summary: "A vacancy was changed" },
  "vacancy.published": { summary: "A vacancy went live on the careers page" },
  "vacancy.paused": { summary: "A vacancy stopped taking applications for now" },
  "vacancy.resumed": { summary: "A paused vacancy took applications again" },
  "vacancy.closed": { summary: "A vacancy was closed" },
  "vacancy.questions_saved": { summary: "A vacancy's questions and traits were saved" },
  "vacancy.scorecard_saved": { summary: "A vacancy's scorecard parts were saved" },
  "recruitment.careers_settings_saved": { summary: "Careers Settings were saved" },
});

/** The vacancy's address field (shared/places/owners.js). */
const LOCATION = "vacancy.location";
places.owner(LOCATION, { rename: (client, id, line) => repo.setLocationLine(client, id, line) });

module.exports = { EVENTS, LOCATION };
