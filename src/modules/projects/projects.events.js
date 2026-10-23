"use strict";
/**
 * What the projects module records (docs/guides/workspace.md §7). A project tells nobody: its
 * tasks carry their own notices. Every change is one event, for the audit.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("workspace", {
  "project.created": { summary: "A project was started" },
  "project.edited": { summary: "A project was changed" },
  "project.completed": { summary: "A project was completed" },
  "project.reopened": { summary: "A completed project was reopened" },
});

module.exports = { EVENTS };
