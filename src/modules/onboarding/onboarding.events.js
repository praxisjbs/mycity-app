"use strict";
/**
 * What the onboarding module records (docs/guides/offers.md §7). Loaded by the API (through the
 * service) and the worker. Payloads carry ids and who to tell; never a document or a link.
 *
 *   onboarding.opened   the offer was accepted: the hire's case opens at documentation with its
 *                       checklist, in the acceptance transaction (guide §3 step 5)
 *
 * The uploads, the verifications, the documentation gate and Complete Onboarding come with the
 * onboarding backend (PR 6), and declare their own events here.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");

const EVENTS = defineEvents("recruitment", {
  "onboarding.opened": { summary: "An onboarding case was opened for a hire" },
});

defineNotification(EVENTS.ONBOARDING_OPENED, {
  to: [{ users: (e) => (e.payload.owner_user_id ? [e.payload.owner_user_id] : []) }],
  title: "Onboarding Opened",
  body: (e) => `${e.payload.employee_name} accepted their offer. Their documents are now due.`,
});

module.exports = { EVENTS };
