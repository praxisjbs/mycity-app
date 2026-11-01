"use strict";
/**
 * What AI Control records, and the job that follows Find Prices. Loaded by the API and the
 * worker (docs/guides/ai-control.md §7).
 *
 * Every event is audit only: AI Control tells nobody anything, a provider at its cap included
 * (decision 21), with one exception since PR5 of the Praxis AI Engine (praxis-ai.md §6.17,
 * decision 26): a leak the nightly attack run finds is an urgent notice to whoever may change AI
 * Control, the Implementation Team and the System Administrator, closed only on Acknowledge. The
 * Audit Log shows who changed a chain, a price or a cap, and when.
 */
const { defineEvents } = require("../../shared/events/catalogue");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");
const queues = require("../../jobs/queues");

const EVENTS = defineEvents("ai_control", {
  "ai_control.chain_changed": { summary: "A job's or an action's chain was changed on AI Control, or a model made first" },
  "ai_control.chain_reset": { summary: "An action was put back on its job's chain" },
  "ai_control.prices_requested": { summary: "Find Prices was pressed: the providers' pricing pages are searched" },
  "ai_control.prices_proposed": { summary: "Find Prices proposed prices for IT to accept" },
  "ai_control.price_set": { summary: "A model's prices were accepted, edited, or saved with Accept All on AI Control" },
  "ai_control.cap_changed": { summary: "A provider's monthly cap, or the cap on all AI, was set" },
  "ai_control.attack_run_recorded": { summary: "Praxis AI's attack suite ran against the real model and its result was recorded" },
  "ai_control.attack_leaked": { summary: "Praxis AI's attack suite found a leak: an answer gave someone what their own screens would not" },
});

/** A leak is told at once, to the people who can act, on every device, until one of them acknowledges it. */
defineNotification(EVENTS.AI_CONTROL_ATTACK_LEAKED, {
  to: [{ permission: ["ai_control", "edit"] }],
  who: "Whoever may change AI Control",
  title: (e) => `Praxis AI leaked in ${e.payload.leaks} of ${e.payload.asked} attacks`,
  body: (e) => `${e.payload.first ? `${e.payload.first}. ` : ""}Open AI Control, Spend to see which.`,
  urgency: "urgent",
  acknowledge: true,
  channels: { push: true },
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
