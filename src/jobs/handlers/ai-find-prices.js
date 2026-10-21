"use strict";
/**
 * Queue `ai-find-prices`: one Find Prices run (docs/guides/ai-control.md §6.4), its requests of
 * 20 models one after another. Queued once per run by ai_governance.events.js; the run is
 * claimed before anything is asked, so a job delivered twice searches once.
 */
const { UnrecoverableError } = require("bullmq");
const service = require("../../modules/ai_governance/ai_governance.service");

module.exports = async function aiFindPrices(job) {
  const { ai_price_run_id: runId, actor = null } = job.data || {};
  if (!runId) throw new UnrecoverableError("ai-find-prices: no ai_price_run_id");
  const run = await service.runFindPrices({ runId, actor });
  return run && { status: run.status, batches_done: run.batches_done, proposals: run.proposals };
};
