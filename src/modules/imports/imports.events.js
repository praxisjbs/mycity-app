"use strict";
/**
 * Who is told about an import.
 *
 * The engine (shared/import/engine.js) declares the events and emits them; what
 * belongs to the module is the audience. An import is slow, so the person who
 * ran it has usually gone to another screen by the time it finishes: they are
 * told, themselves included, because it is their own work finishing rather than
 * somebody else's news (docs/guides/foundation.md §7).
 */
const { defineNotification } = require("../../shared/notifications/fanout");
const { EVENTS } = require("../../shared/import/engine");

const who = (event) => (event.actor_user_id ? [event.actor_user_id] : []);

defineNotification(EVENTS.IMPORT_COMMITTED, {
  to: [{ users: who }],
  title: "Your import finished",
  body: (e) =>
    `${e.payload.create} created, ${e.payload.update} updated, ${e.payload.error} with problems.`,
  include_actor: true,
});

defineNotification(EVENTS.IMPORT_REVERTED, {
  to: [{ users: who }],
  title: "Your import was undone",
  body: (e) =>
    `${e.payload.archived} archived, ${e.payload.restored} put back as they were.`,
  include_actor: true,
});

module.exports = {};
