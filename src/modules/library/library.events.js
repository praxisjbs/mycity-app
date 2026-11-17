"use strict";
/**
 * The Document Centre's events, document types, notice, reminder and follow-on work
 * (docs/guides/document-centre.md §7).
 *
 *   company_document.*     a company document uploaded, changed, given a new version, archived, restored
 *   document_category.*    a category added, changed, archived, restored
 *   company_document.expiring   raised by the reminder engine 60, 30 and 7 days ahead and on the day,
 *                          once each, to its uploader and the holders of documents.manage (§6.9)
 *   letterhead.requested   Download Letterhead's Word file, made in the worker (§6.8)
 *
 * The text of a library type's file is read after commit: document.stored, document.claimed and
 * document.generated queue `document-text` for it (§6.7), and the nightly document-text-sweep
 * reads what has none.
 *
 * Types: `company_document`, read by its own rule (library.access.js, §6.4); `letterhead_export`,
 * the blank letterhead as PDF or Word, kept a day like every export and read by whoever asked.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const { defineDocType } = require("../../shared/documents/generate");
const { defineVariables } = require("../../shared/templates/variables");
const { defineNotification } = require("../../shared/notifications/fanout");
const { formatDate } = require("../../shared/time/day-first");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const reminders = require("../notifications/notifications.reminders");
const access = require("./library.access");

const EVENTS = defineEvents("documents", {
  "company_document.uploaded": { summary: "A company document was uploaded to the Document Centre" },
  "company_document.updated": { summary: "A company document's details were changed" },
  "company_document.version_added": { summary: "A company document was replaced by a new version" },
  "company_document.archived": { summary: "A company document was archived" },
  "company_document.restored": { summary: "An archived company document was restored" },
  "company_document.expiring": { summary: "A company document's expiry is near, or today" },
  "document_category.created": { summary: "A document category was added" },
  "document_category.updated": { summary: "A document category was changed" },
  "document_category.archived": { summary: "A document category was archived" },
  "document_category.restored": { summary: "An archived document category was restored" },
  "letterhead.requested": { summary: "Someone asked for the blank letterhead as a Word file" },
});

/** A company document's type and the entity its files are stored against. */
const DOC_TYPE = "company_document";
const ENTITY = "company_document";
/** The blank letterhead, PDF or Word: an export, read by whoever asked. */
const LETTERHEAD = "letterhead_export";
const LETTERHEAD_TEMPLATE = "blank-letterhead";
/** The reminder that raises company_document.expiring. */
const EXPIRY_REMINDER = "company_document_expiring";

defineDocumentType(DOC_TYPE, { label: "Company document", module: "documents", sensitivity: "normal" });
vault.defineAccess(ENTITY, access.mayRead);

defineDocType(LETTERHEAD, {
  label: "Letterhead",
  module: "documents",
  template: LETTERHEAD_TEMPLATE,
  numbering: null,
  sensitivity: "normal",
  title: () => "Letterhead",
  heading: false,
  blank: true,
  export: true,
});
defineVariables("document", LETTERHEAD_TEMPLATE, c.library.LetterheadVars);
vault.defineAccess(LETTERHEAD, async (_client, user, doc) => Boolean(user && doc.uploaded_by && doc.uploaded_by === user.user_id));

/** Who is told of an expiry: the uploader and every holder of documents.manage. */
const keepers = (event, db) => require("./library.repo").expiryAudience(db, event.payload.company_document_id);

defineNotification(EVENTS.COMPANY_DOCUMENT_EXPIRING, {
  to: [{ users: keepers }],
  title: "Document Expiring",
  body: (e) =>
    e.payload.days_left > 0
      ? `${e.payload.title} expires on ${formatDate(e.payload.expires_on)}.`
      : `${e.payload.title} expires today.`,
  priority: "high",
});

reminders.defineReminder(EXPIRY_REMINDER, {
  event: EVENTS.COMPANY_DOCUMENT_EXPIRING,
  module: "documents",
  find: (db, ctx) => require("./library.service").remindersDue(db, ctx),
  check: (client, row, ctx) => require("./library.service").reminderCheck(client, row, ctx),
});

/* The text of a library type's file, read in the worker after the file exists (§6.7). */
const text = () => require("./library.text");
for (const key of [vault.EVENTS.DOCUMENT_STORED, vault.EVENTS.DOCUMENT_CLAIMED, vault.EVENTS.DOCUMENT_GENERATED]) {
  outbox.register(key, `documents.text.${key}`, (event) => text().queueFor(event));
}

/* Download Letterhead's Word file (§6.8). */
outbox.register(EVENTS.LETTERHEAD_REQUESTED, "documents.letterhead_word", (event, ctx) =>
  require("./library.letterhead").buildWord(event, ctx),
);

module.exports = { EVENTS, DOC_TYPE, ENTITY, LETTERHEAD, LETTERHEAD_TEMPLATE, EXPIRY_REMINDER };
