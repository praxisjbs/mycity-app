"use strict";
/**
 * The Document Centre's training certificates (docs/guides/document-centre.md §6.2): the certificate
 * an enrolment holds, for the person it was awarded to and whoever manages training
 * (docs/guides/knowledge.md §8). The rule is the vault's for a training enrolment
 * (training.events.js), written once more for a list.
 */
const { librarySource, employeeName } = require("../../shared/documents/library");
const grantsCache = require("../../shared/rbac/grants-cache");
const { ENROLMENT_ENTITY, CERTIFICATE_DOC_TYPE } = require("./training.events");

const OF = "training_enrolment te WHERE te.training_enrolment_id = d.entity_id::uuid";

module.exports = librarySource({
  area: "knowledge",
  types: { [CERTIFICATE_DOC_TYPE]: "Training Certificate" },
  entity: ENROLMENT_ENTITY,
  record: {
    type: "'training_enrolment'",
    id: "d.entity_id",
    label: `(SELECT COALESCE(te.certificate_holder_name, ${employeeName("te.employee_id")}) FROM ${OF})`,
    ref: `(SELECT te.certificate_number::text FROM ${OF})`,
  },
  listed: `EXISTS (SELECT 1 FROM ${OF} AND te.certificate_document_id = d.document_id)`,
  reach: async (client, user) => ({
    all: user.is_ceo === true || (await grantsCache.getCapabilities(client, user.user_id)).includes("training.manage"),
    employee_id: user.employee_id || null,
  }),
  readable: (reach, params) => {
    if (reach.all) return "TRUE";
    if (!reach.employee_id) return "FALSE";
    params.push(reach.employee_id);
    return `d.subject_employee_id = $${params.length}::uuid`;
  },
});
