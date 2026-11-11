"use strict";
/**
 * What the interactions module records (docs/guides/partnerships.md §7, §6.12).
 *
 *   interaction.logged   Log Interaction: a call, meeting, email, visit or note with a lead or a
 *                        partner. It is contact, and ends a quiet spell (§6.12).
 *
 * The payload carries ids and the type, never the summary.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("partnerships", {
  "interaction.logged": { summary: "A call, meeting, email, visit or note was logged" },
});

module.exports = { EVENTS };
