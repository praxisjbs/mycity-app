"use strict";
/**
 * What AI Control records, and the job that follows Find Prices. Loaded by the API and the
 * worker (docs/guides/ai-control.md §7).
 *
 * Every event is audit only: AI Control tells nobody anything, a provider at its cap included
 * (decision 21). The Audit Log shows who changed a chain, a price or a cap, and when.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const outbox = require("../../shared/events/outbox");
const queues = require("../../jobs/queues");

const EVENTS = defineEvents("ai_control", {
  "ai_control.chain_changed": { summary: "A job's or an action's chain was changed on AI Control, or a model made first" },
  "ai_control.chain_reset": { summary: "An action was put back on its job's chain" },
  "ai_control.prices_requested": { summary: "Find Prices was pressed: the providers' pricing pages are searched" },
  "ai_control.prices_proposed": { summary: "Find Prices proposed prices for IT to accept" },
  "ai_control.price_set": { summary: "A model's prices were accepted, edited, or saved with Accept All on AI Control" },
  "ai_control.cap_changed": { summary: "A provider's monthly cap, or the cap on all AI, was set" },
});

/**
 * The search itself, after the request commits: a request of 20 models can take minutes, so it
 * runs as a job rather than inside this handler. One attempt: the run records its own failure,
 * and Find Prices is pressed again.
 */
outbox.register(EVENTS.AI_CONTROL_PRICES_REQUESTED, "ai_control.find_prices", async (event) => {
  const runId = event.payload.ai_price_run_id;
  if (!runId) return;
  await queues.enqueue(
    "ai-find-prices",
    "find-prices",
    { ai_price_run_id: runId, actor: event.actor_user_id || null },
    { jobId: `ai-find-prices-${runId}`, attempts: 1 },
  );
});

module.exports = { EVENTS };
