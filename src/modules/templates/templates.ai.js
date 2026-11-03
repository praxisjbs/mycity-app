"use strict";
/**
 * What the assistant may do about letter templates (docs/guides/queries.md §6.7, §9): as cards the
 * person confirms (docs/guides/praxis-ai.md §6.11, decision 33), New Template's Save Draft and Save
 * and Activate, and Edit Template's Save Letter (its name, what it is used for, and its wording
 * saved as the next version), through the functions the screen's own buttons call, for a holder of
 * `queries.configure` as the routes hold it. A letter's wording holds its own {{ names }}
 * (ConsequenceLetterVars), which the card's ready-to-send guard lets pass as Write With AI's does
 * (templates.assist.js letterName); any other gap is marked. Questions about a query or a sanction
 * are answered by queries.ai.js and sanctions.ai.js.
 */
const c = require("@mycity/contract");
const { defineManifest } = require("../../shared/ai/manifest");
const routeMap = require("../../shared/route-map");
const { letterName } = require("./templates.assist");
const service = require("./templates.service");

const CONFIGURE = "queries.configure";
const letterLine = (status) => (t) => [{ type: "letter_template", id: t.letter_template_id, label: t.name, status, link: routeMap.screenPath("queries", "letter-templates") }];
const LABELS = { name: "Name", purpose: "Used For", title: "Title", body: "Wording" };

module.exports = defineManifest({
  module: "queries",
  actions: [
    {
      key: "letters.create",
      label: "Add Letter",
      description: "Add a letter template: its name, what it is used for, a title, and its wording in Markdown with the letter's own {{ names }}; saved as a draft, or active to send at once",
      input: c.templates.LetterTemplateCreate,
      permission: ["queries", "create"],
      // As the route: POST /letter-templates asks requireCapability("queries.configure").
      capability: CONFIGURE,
      risk: "standard",
      form: "none: New Template's form writes the wording in the rich text editor as HTML; the card carries it as Markdown, as a script may",
      fields: ["name", "purpose", "title", "body", "status"],
      // The letter's own names ({{ employee.first_name }}) are its wording, never a gap to fill.
      allows: { body: letterName },
      asks: [
        { field: "name", question: "What is the letter called?" },
        { field: "purpose", question: "What is it used for?", choices: ["Queries", "Sanctions"] },
        { field: "body", question: "What should the letter say?" },
      ],
      // The same function Save Draft and Save and Activate call: a draft unless status is active.
      run: (values, actor) => service.create(actor, values),
      readback: (t) => letterLine(t.status === "active" ? "saved and active" : "saved as a draft")(t),
      labels: { ...LABELS, status: "Status" },
    },
    {
      key: "letters.edit",
      label: "Save Letter",
      description: "Change a letter template: rename it, change what it is used for while nothing sends it, or give it new wording in Markdown with its own {{ names }}, saved as its next version",
      input: c.templates.LetterTemplateChange,
      permission: ["queries", "edit"],
      capability: CONFIGURE,
      risk: "standard",
      form: "none: Edit Template changes the letter open on Letter Templates, its wording in the rich text editor; the card names the letter and carries Markdown",
      fields: ["letter_template_id", "name", "purpose", "title", "body"],
      allows: { body: letterName },
      resolve: { letter_template_id: (value, _actor, db) => service.idOf(db, value) },
      asks: [{ field: "letter_template_id", question: "Which letter?", options: ({ db }) => service.letterNames(db) }],
      records: (values, _actor, db) => service.cardLetter(db, values.letter_template_id),
      check: (client, values) => service.assertCardLetter(client, values.letter_template_id),
      // Save Letter as Edit Template saves it: the name and use, then the wording as the next version.
      run: (values, actor) => {
        const { letter_template_id: id, ...changes } = values;
        return service.saveLetter(actor, id, changes);
      },
      readback: letterLine("saved"),
      labels: { letter_template_id: "Letter", ...LABELS },
    },
  ],
  // Edit Template's own requests, reached through the card that names its letter (gate 23, praxis-ai.md decision 33).
  not_offered: {
    LetterTemplateUpdate: "via letters.edit: Edit Template's rename and use, which never name their letter; the card is LetterTemplateChange",
    LetterTemplateBodySave: "via letters.edit: Edit Template's wording, saved as the next version, which never names its letter; the card is LetterTemplateChange",
  },
  routes: [{ intent: "preview a letter as the employee receives it", screen: "queries.letter-templates" }],
});
