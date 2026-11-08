"use strict";
/**
 * Queue `agreement-renewal`: the morning's agreement sweep run again by hand, for an operator re-running
 * a morning the scheduler missed. Under the scheduler's own cron lock, so it never runs beside the
 * morning's run, and safe to repeat: each agreement and deal moves once (agreements.renewals).
 */
const { withCronLock } = require("../cron-lock");
const renewals = require("../../modules/agreements/agreements.renewals");

module.exports = async function agreementRenewal() {
  const out = await withCronLock("agreement-renewals", () => renewals.sweep());
  return out === undefined ? { skipped: "locked" } : out;
};
