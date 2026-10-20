"use strict";
/**
 * Settings events. A change to the organisation profile, the working week, a
 * holiday or a numbering scheme is recorded for the Audit Log and nothing more. A
 * change to the security rules (session length, idle lock, password minimum, two-step
 * by role) is a security event: the audit row is marked sensitive and the CEO and the
 * people who manage Settings are told (shared/notifications/fanout.js).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineDocumentType } = require("../../shared/documents/types");
const vault = require("../../shared/documents/vault");
const places = require("../../shared/places/owners");
const { keyOf } = require("../../shared/organisation/profile");

const EVENTS = defineEvents("settings", {
  "settings.changed": { summary: "A setting was changed" },
  "settings.security_changed": { summary: "The security rules were changed", security: true },
});

/** The brand files of Settings · Organisation (foundation.md §6.11). */
defineDocumentType("brand_image", {
  label: "Brand file",
  module: "settings",
  sensitivity: "normal",
});

/** Anyone signed in may see the company's logos: every letter and every signature carries them. */
vault.defineAccess("brand", async () => true);

/** The company's address saved while search was down is named by the places-name job (F27). */
places.owner("organisation.address", {
  rename: (client, _key, line) => require("./settings.repo").putSetting(client, keyOf("address"), line, null),
});

module.exports = { EVENTS };
