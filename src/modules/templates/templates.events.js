"use strict";
/**
 * Letter templates: the events, and the two document types every query and sanction
 * letter is generated as (docs/guides/queries.md §6.7). Loaded by the API (through the
 * service) and by the worker.
 *
 *   letter_template.created    a letter was added on Letter Templates (a draft)
 *   letter_template.saved      new wording saved as the next template_version
 *   letter_template.activated  it may now be chosen by a rung, a rule or a query
 *
 * Both document types take the template their caller names (`templateChoice`): a rung
 * added on Chain Settings sends a letter nobody shipped. Every letter fills from one
 * variable schema, so `declare(key)` registers a key the screen created before it is
 * saved or generated; the shipped keys are declared here.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");

const EVENTS = defineEvents("queries", {
  "letter_template.created": { summary: "A letter template was added" },
  "letter_template.saved": { summary: "A letter template's wording was saved" },
  "letter_template.activated": { summary: "A letter template was made available" },
});

/** The letters the code ships, one file each in templates/documents/ (seed 3190 lists them). */
const SHIPPED = Object.freeze([
  "query-letter",
  "caution-letter",
  "warning-letter",
  "suspension-letter",
  "suspension-without-pay-letter",
  "termination-letter",
]);

/** Let a letter key fill from the one letter schema. Safe to call again. */
function declare(key) {
  defineVariables("document", key, c.templates.ConsequenceLetterVars);
}

SHIPPED.forEach(declare);

const QUERY_LETTER = "query_letter";
const SANCTION_LETTER = "sanction_letter";

defineDocType(QUERY_LETTER, {
  label: "Query letter",
  module: "queries",
  template: "query-letter",
  templateChoice: true,
  numbering: "letter",
  sensitivity: "personal",
  title: (d) => `Query ${d.query_number}: ${d.subject}`,
});

defineDocType(SANCTION_LETTER, {
  label: "Sanction letter",
  module: "queries",
  template: "caution-letter",
  templateChoice: true,
  numbering: "letter",
  sensitivity: "personal",
  title: (d) => `${d.step_name || "Sanction"}: ${d.query_number}`,
});

module.exports = { EVENTS, SHIPPED, declare, QUERY_LETTER, SANCTION_LETTER };
