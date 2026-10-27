"use strict";
/**
 * Where reviews and improvement plans wait on Performance · Reviews (docs/guides/notifications.md
 * §6, Where it waits): a review on Reviews, an improvement plan on PIPs, so the switch carries
 * their share of the tab's count and the screen opens where they are.
 */
module.exports = [
  { module: "performance", tab: "reviews", type: "performance_review", view: "reviews" },
  { module: "performance", tab: "reviews", type: "improvement_plan", view: "pips" },
];
