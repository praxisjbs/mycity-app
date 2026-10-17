"use strict";
/**
 * Access events. Every change to who can do what is a security event: the audit row
 * is marked sensitive, and the CEO and the people who manage Settings are told,
 * whatever their preferences (shared/notifications/fanout.js). The grants cache is
 * cleared by the service once the change commits, so the next request sees it.
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("settings", {
  "access.roles_set": {
    summary: "A person's roles were changed",
    security: true,
  },
  "role.created": { summary: "A role was created", security: true },
  "role.updated": { summary: "A role's name or Home was changed", security: true },
  "role.deleted": { summary: "A role was deleted", security: true },
  "permission.changed": { summary: "What a role grants was changed", security: true },
  "field_visibility.changed": { summary: "The fields a role sees were changed", security: true },
  "capability.changed": { summary: "The capabilities a role holds were changed", security: true },
});

module.exports = { EVENTS };
