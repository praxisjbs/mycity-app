"use strict";
/**
 * Where connections wait on Settings · Integrations (docs/guides/notifications.md §6, Where it
 * waits): under the Group chip of their provider (Mail, Maps, AI and the rest), as the list's own
 * filter groups them.
 */
const providers = require("../../shared/integrations/providers");
const repo = require("./integrations.repo");

module.exports = [
  {
    module: "settings",
    tab: "integrations",
    type: "integration",
    place: async (db, ids) => new Map((await repo.codesOf(db, ids)).flatMap((r) => (providers.get(r.code) ? [[r.id, providers.get(r.code).group]] : []))),
  },
];
