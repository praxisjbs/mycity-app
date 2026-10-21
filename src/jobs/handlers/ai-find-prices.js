"use strict";
/**
 * Queue `ai-find-prices`: Find Prices' search (docs/guides/ai-control.md §6.4), queued once per
 * press by ai_governance.events.js after the request commits. Each set-up provider is searched
 * in turn, each search up to two minutes, so it runs here rather than in the outbox. Queued with
 * one attempt: a retry would search, and pay, again; the person presses Find Prices again.
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/ai_governance/ai_governance.service");

module.exports = async function aiFindPrices(job) {
  if (job.name !== "find") throw new UnrecoverableError(`ai-find-prices: no job called "${job.name}"`);
  return service.runFindPrices({ actor: (job.data && job.data.actor_user_id) || null });
};
