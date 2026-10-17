"use strict";
/**
 * What Employee Self-Service records beyond the owning modules' own events.
 *
 * A change an employee makes to their own record is the organisation module's
 * `employee.updated` (audited, with before and after). A bank change is also this
 * event, so People are told the same day: expense refunds are paid into that account
 * (docs/guides/ess.md §6, §7). The notice names the person, never the account.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("people", {
  "employee.bank_details_changed": {
    summary: "An employee changed their own bank details",
    sensitive: true,
  },
});

defineNotification(EVENTS.EMPLOYEE_BANK_DETAILS_CHANGED, {
  to: [{ permission: ["people", "edit"] }],
  title: "Bank details changed",
  body: (e) => `${e.payload.display_name} changed their bank details in My Profile.`,
});

module.exports = { EVENTS };
