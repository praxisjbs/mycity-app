"use strict";
/**
 * Access events. A change to who holds which role is a security event: the CEO and
 * the people who manage Settings are told, whatever their preferences.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("settings", {
  "access.roles_set": {
    summary: "A person's roles were changed",
    security: true,
  },
});

module.exports = { EVENTS };
