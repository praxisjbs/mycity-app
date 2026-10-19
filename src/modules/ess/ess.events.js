"use strict";
/**
 * What Employee Self-Service records beyond the owning modules' own events.
 *
 * A change an employee makes to their own record is the organisation module's
 * `employee.updated` (audited, with before and after). A bank change is also this
 * event, so People are told the same day: expense refunds are paid into that account
 * (docs/guides/ess.md §6, §7). The notice names the person, never the account.
 *
 * Download My Data (ess.export.js): `employee.data_export_requested` is on the person's record,
 * with who asked (the person, or the CEO for Download Their Data), and its file is reserved as a
 * `data_export` only the person and the CEO may open. After commit the worker builds the
 * workbook into that file, which the screen that asked downloads; nothing is emailed. The
 * export-cleanup job removes it a day later (shared/documents/exports.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const vault = require("../../shared/documents/vault");
const { defineNotification } = require("../../shared/notifications/fanout");
const { defineDocumentType } = require("../../shared/documents/types");

const EVENTS = defineEvents("people", {
  "employee.bank_details_changed": {
    summary: "An employee changed their own bank details",
    sensitive: true,
  },
  "employee.data_export_requested": {
    summary: "A copy of an employee's data was requested",
  },
});

/** The document type a Download My Data workbook is kept under, and the record it belongs to. */
const DATA_EXPORT = "data_export";

defineDocumentType(DATA_EXPORT, { label: "Download My Data", module: "people", sensitivity: "restricted", export: true });

/** The workbook is for the person it is about and the CEO; the rule decides alone. */
vault.defineAccess(DATA_EXPORT, async (client, user, doc) => {
  if (user.is_ceo === true) return true;
  return Boolean(user.employee_id) && doc.subject_employee_id === user.employee_id;
});

/* The work is required when the handler runs: ess.export requires the services, which require this file. */
outbox.register(EVENTS.EMPLOYEE_DATA_EXPORT_REQUESTED, "ess.data_export", (event, ctx) =>
  require("./ess.export").build(event, ctx),
);

defineNotification(EVENTS.EMPLOYEE_BANK_DETAILS_CHANGED, {
  to: [{ permission: ["people", "edit"] }],
  title: "Bank details changed",
  body: (e) => `${e.payload.display_name} changed their bank details in My Profile.`,
  copy: true,
});

module.exports = { EVENTS, DATA_EXPORT };
