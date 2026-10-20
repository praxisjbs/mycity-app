"use strict";
/**
 * What Integrations records and tells people, and the work that follows a save. Loaded by
 * the API and the worker (docs/guides/integrations.md §7).
 *
 * Who hears it: holders of `integrations` view, which the seed gives to the Implementation
 * Team and the System Administrator only; the person who acted is not told of their own
 * change, and the CEO is never added to a permission audience. The events sit in the System
 * Health category (shared/notifications/categories.js): the bell and push for IT, locked
 * on, email off.
 *
 * A failing connection is not announced here: its readiness check goes down on Settings ·
 * Status, and System Health's own notice tells the same people (guide §1.1).
 *
 * A secret never reaches an event: payloads carry codes and field names only, and emit()
 * redacts any credential-named key in before and after besides.
 */
const c = require("@mycity/contract");
const { defineEvents } = require("../../shared/events/catalogue");
const { defineVariables } = require("../../shared/templates/variables");
const { defineNotification } = require("../../shared/notifications/fanout");
const outbox = require("../../shared/events/outbox");
const providers = require("../../shared/integrations/providers");
const queues = require("../../jobs/queues");

const EVENTS = defineEvents("integrations", {
  "integration.saved": { summary: "A connection's settings were saved on Settings, Integrations" },
  "integration.removed": { summary: "A connection's saved settings were removed; the server file applies again" },
  "integration.keys_replaced": { summary: "The web push key pair was replaced" },
  "integration.tested": { summary: "A connection was tested, a test email sent, or exchange rates synced" },
  "integration.quota_warning": { summary: "A connection used 80% of its daily limit" },
  // Audit only, told to nobody: a model list is configuration, like a test (guide §1.2).
  "integration.model_added": { summary: "A model was added by hand to an AI connection's list" },
  "integration.model_removed": { summary: "A model added by hand was taken off an AI connection's list" },
});

/** Send Test Email's message (templates/email/integration-test.html). */
defineVariables("email", "integration-test", c.integrations.IntegrationTestEmailVars);

const TO_IT = [{ permission: ["integrations", "view"] }];
const WHO = "Whoever holds Integrations";
const nameOf = (e) => (providers.has(e.payload.code) ? providers.get(e.payload.code).name : e.payload.code);

defineNotification(EVENTS.INTEGRATION_SAVED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `${nameOf(e)} settings changed`,
  body: (e) =>
    e.payload.secrets_replaced && e.payload.secrets_replaced.length
      ? "Saved with a new key or password."
      : "Saved on Settings, Integrations.",
  push: { tag: (e) => `integration:${e.payload.code}`, mode: "alert" },
});

defineNotification(EVENTS.INTEGRATION_REMOVED, {
  to: TO_IT,
  who: WHO,
  title: (e) => `${nameOf(e)} settings removed`,
  body: "The server file's settings apply again.",
  push: { tag: (e) => `integration:${e.payload.code}`, mode: "alert" },
});

defineNotification(EVENTS.INTEGRATION_KEYS_REPLACED, {
  to: TO_IT,
  who: WHO,
  title: "Web push keys replaced",
  body: "Each device subscribes again when the app next opens.",
  push: { tag: () => "integration:web_push", mode: "alert" },
});

defineNotification(EVENTS.INTEGRATION_QUOTA_WARNING, {
  to: TO_IT,
  who: WHO,
  title: (e) => `${nameOf(e)} near its daily limit`,
  body: (e) => `${e.payload.units} of ${e.payload.daily_limit} used today.`,
  urgency: "important",
  push: { tag: (e) => `integration_quota:${e.payload.code}`, mode: "alert" },
});

/**
 * A system sender saved: mail held because none was set up goes out now instead of at its
 * next 15 minute retry (guide §3 step 9). Only jobs held for that reason are released; one
 * waiting for the hourly limit keeps waiting.
 */
outbox.register(EVENTS.INTEGRATION_SAVED, "integrations.release_held_mail", async (event) => {
  if (event.payload.code !== "mail_sender") return;
  const queue = queues.getQueue("email-send");
  for (const job of await queue.getDelayed(0, 999)) {
    if (job && job.data && job.data.held_for === "sender") await job.promote().catch(() => undefined);
  }
});

module.exports = { EVENTS };
