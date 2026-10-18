"use strict";
/**
 * What Home's Overview records, and how a role's cards follow its grants
 * (docs/guides/home.md §7).
 *
 *   home.kpi_picks_changed   a person saved their own cards or went back to their roles'
 *   home.role_kpis_changed   a role's cards were saved, cleared, or pruned
 *
 * Both are audit lines; nobody is told.
 *
 * THE PRUNE. A card inherits its reader's rights (kpi-catalog/eligibility.js), so when a
 * role loses a grant, a capability or sight of a field, some of the cards it opens Home on
 * may no longer be ones its members can see. After the access change commits, the outbox
 * handler `dashboard.prune-role-kpis` takes those cards out of the role's row (and the row
 * itself when no card is left). It is safe to run twice: a second run finds nothing to take
 * out and writes nothing. A person's own pick needs no prune: it is filtered each time it is
 * read. A deleted role's row goes with it (ON DELETE CASCADE).
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const { EVENTS: ACCESS } = require("../access/access.events");

const EVENTS = defineEvents("home", {
  "home.kpi_picks_changed": { summary: "A person changed the cards on their Home" },
  "home.role_kpis_changed": { summary: "The cards a role opens Home on were changed" },
});

/** The access changes after which a role may see fewer cards. */
const PRUNE_ON = Object.freeze([
  ACCESS.PERMISSION_CHANGED,
  ACCESS.FIELD_VISIBILITY_CHANGED,
  ACCESS.CAPABILITY_CHANGED,
]);

/** The handler's name, stable across deploys: renaming it would run every pending row again. */
const PRUNE_HANDLER = "dashboard.prune-role-kpis";

/*
 * The service is required when the handler runs, not when this file loads: the service
 * requires this file for its event keys, and the worker loads this file on its own.
 */
const prune = (event) => require("./dashboard.service").pruneRoleCards(event.payload.role_id);

for (const key of PRUNE_ON) outbox.register(key, PRUNE_HANDLER, prune);

module.exports = { EVENTS, PRUNE_ON, PRUNE_HANDLER };
