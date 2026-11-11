"use strict";
/**
 * Queue `partner-inactivity`: the morning's follow-up sweep run again by hand, for an operator
 * re-running a morning the scheduler missed. Under the scheduler's own cron lock, so it never runs
 * beside the morning's run, and safe to repeat: one follow-up a quiet spell
 * (partner_pipeline.inactivity).
 */
const { withCronLock } = require("../cron-lock");
const inactivity = require("../../modules/partner_pipeline/partner_pipeline.inactivity");

module.exports = async function partnerInactivity() {
  const out = await withCronLock("partner-inactivity", () => inactivity.sweep());
  return out === undefined ? { skipped: "locked" } : out;
};
