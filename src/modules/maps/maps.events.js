"use strict";
/**
 * Maps: the one event addresses raise of their own (docs/guides/addresses.md §7). Every other
 * change to an address is its owner's event (a worksite saved, a profile changed), raised in the
 * owner's transaction alongside `places.save()`.
 *
 *   place.named   a device location saved while address search was down got its name; audit
 *                 only, with the owner and never the point
 */
const { defineEvents } = require("../../shared/events/catalogue");

const EVENTS = defineEvents("settings", {
  "place.named": { summary: "A location saved while address search was down was named" },
});

module.exports = { EVENTS };
