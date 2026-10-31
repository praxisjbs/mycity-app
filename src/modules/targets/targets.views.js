"use strict";
/**
 * Where scorecards and commitments wait on Performance · Scorecards (docs/guides/notifications.md
 * §6, Where it waits): a scorecard on Scorecards, a month's commitments on Commitments, so the
 * switch carries their share of the tab's count and the screen opens where they are.
 */
module.exports = [
  { module: "performance", tab: "targets", type: "scorecard", view: "scorecards" },
  { module: "performance", tab: "targets", type: "commitment_set", view: "commitments" },
];
