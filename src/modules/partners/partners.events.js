"use strict";
/**
 * What the partners module records (docs/guides/partnerships.md §7).
 *
 *   partner.created           New Partner, or a lead converted (§6.4)
 *   partner.updated           Edit Partner
 *   partner.closed            Close Partner: its open and live deals lost with it
 *   partner.status_changed    active while a deal is live, dormant when none is (§6.6)
 *   partner_contact.created   Add Contact, or a record's primary contact
 *   partner_contact.updated   Edit Contact
 *   partner_document.attached Upload Document, or the signed copy that evidences a signing
 *
 * A partner's headquarters (an area) and its region's cities are picked, never typed (F27), and kept
 * as place rows by this module (owners partner.headquarters and partner.cities). The partner keeps
 * no copy of their lines, so a place named by the places-name job has nothing else to rewrite.
 *
 * A record's documents are the vault's, each tagged by a partner_document row that the vault names
 * as its entity; who may read one is who may see its lead or partner (§6.1).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const places = require("../../shared/places/owners");

const EVENTS = defineEvents("partnerships", {
  "partner.created": { summary: "A partner was added" },
  "partner.updated": { summary: "A partner was changed" },
  "partner.closed": { summary: "A partner was closed" },
  "partner.status_changed": { summary: "A partner became active or dormant" },
  "partner_contact.created": { summary: "A contact was added to a lead or partner" },
  "partner_contact.updated": { summary: "A lead's or partner's contact was changed" },
  "partner_document.attached": { summary: "A document was attached to a lead or partner" },
});

/** The vault's document type for every file of a lead or a partner, and the entity it names. */
const DOC_TYPE = "partner_document";
const ENTITY = "partner_document";
defineDocumentType(DOC_TYPE, { label: "Partnership document", module: "partnerships", sensitivity: "normal" });

// A record's document is read by whoever may see the record (§6.1), as its Documents tab lists it.
vault.defineAccess(ENTITY, (client, user, doc) => require("./partners.documents").mayRead(client, user, doc));

places.owner("partner.headquarters", { rename: async () => {} });
places.owner("partner.cities", { rename: async () => {} });

module.exports = { EVENTS, DOC_TYPE, ENTITY };
