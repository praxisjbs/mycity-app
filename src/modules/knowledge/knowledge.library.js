"use strict";
/**
 * The Document Centre's SOP files (docs/guides/document-centre.md §6.2): a file a step of an SOP
 * carries, read as its SOP is, by everyone who may open the Knowledge Hub (docs/guides/knowledge.md
 * §6.2, §8). The rule is the vault's for an SOP (knowledge.events.js), written once more for a list.
 */
const { librarySource } = require("../../shared/documents/library");
const { scopeFor } = require("../../middleware/rbac");
const { SOP_ENTITY, STEP_FILE_DOC_TYPE } = require("./knowledge.events");

const OF = "sop s WHERE s.sop_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "knowledge",
  types: { [STEP_FILE_DOC_TYPE]: "SOP File" },
  entity: SOP_ENTITY,
  record: {
    type: "'sop'",
    id: "d.entity_id",
    label: `(SELECT s.title FROM ${OF})`,
    ref: `(SELECT s.number::text FROM ${OF})`,
  },
  reach: (_client, user) => scopeFor(user, "knowledge", "view"),
  readable: (scope) => (scope ? "TRUE" : "FALSE"),
});
