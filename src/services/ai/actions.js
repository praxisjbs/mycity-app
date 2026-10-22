"use strict";
/**
 * Every AI feature, declared once (docs/guides/ai-control.md §1.1 decisions 14 and 24, §6.5).
 *
 *   const a = actions.of("policy-tidy");
 *   // → { key: "policy-tidy", label: "Tidy Policy", job: "default", personal_data: true, ... }
 *
 * An action's key is its prompt's name (services/ai/prompts/<key>.md) and the `purpose` the ledger
 * keeps, so a run on AI Control · Spend names the feature that made it. Each entry says:
 *
 *   job            which chain answers it (§6.2): default, fast, deep_reasoning, image_reading,
 *                  transcription, embeddings, top_tier
 *   personal_data  whether what is sent can name or describe a person; DeepSeek is passed by
 *                  when true (decision 23)
 *   chosen_by, chosen_at   who picked the job, and when (the build asks; CLAUDE.md)
 *   reason         Top Tier only: why Default or Deep Reasoning will not do
 *   chain          optional: the action's own chain in code, as [provider, family] pairs
 *                  (services/ai/jobs.js FAMILIES); IT can still replace it on AI Control
 *   built          false while the feature is registered but not built yet
 *   direct         the call names its model itself and has no chain (the connection test)
 *
 * A new AI feature adds its entry here before its first call; scripts/check/ai-actions.js fails
 * a build whose call names an action this file does not hold.
 */

const ACTIONS = Object.freeze({
  "voice-note-transcription": Object.freeze({
    label: "Voice Note Transcription",
    module: "community",
    job: "transcription",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    built: true,
  }),
  "policy-tidy": Object.freeze({
    label: "Tidy Policy",
    module: "knowledge",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    built: true,
  }),
  "data-answers": Object.freeze({
    label: "Data Answers",
    module: "praxis_ai",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    // Decision 22: Gemini's Flash first, its Pro second.
    chain: Object.freeze([
      ["gemini", "flash"],
      ["gemini", "pro"],
    ]),
    built: true,
  }),
  // A question spoken on Praxis AI · Ask (docs/guides/praxis-ai.md §6.6).
  "praxis-ai-voice": Object.freeze({
    label: "Voice Question",
    module: "praxis_ai",
    job: "transcription",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-10-21",
    built: true,
  }),
  "find-prices": Object.freeze({
    label: "Find Prices",
    module: "ai_control",
    job: "deep_reasoning",
    personal_data: false,
    searches: true,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    built: true,
  }),
  // Performance PR 3 (docs/guides/performance.md §6.17, P19): both carry personal data.
  "review-dictation": Object.freeze({
    label: "Review Dictation",
    module: "performance",
    job: "transcription",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  "review-cleanup": Object.freeze({
    label: "Tidy Review",
    module: "performance",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  // Performance PR 4 (docs/guides/performance.md §6.18): Tidy With AI on the week, only when pressed.
  "week-summary": Object.freeze({
    label: "Week Summary",
    module: "workspace",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  // Mailbox (docs/guides/mailbox.md §1.1, §9): each only when the mailbox's owner presses it.
  "mail-draft": Object.freeze({
    label: "Write Email",
    module: "mailbox",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  "mail-tidy": Object.freeze({
    label: "Tidy Email",
    module: "mailbox",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  "mail-summary": Object.freeze({
    label: "Thread Summary",
    module: "mailbox",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  "mail-dictation": Object.freeze({
    label: "Mail Dictation",
    module: "mailbox",
    job: "transcription",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-10-22",
    built: true,
  }),
  "integration-test": Object.freeze({
    label: "Connection Test",
    module: "integrations",
    job: null,
    personal_data: false,
    chosen_by: "TB",
    chosen_at: "2026-10-20",
    built: true,
    direct: true,
  }),
});

const KEYS = Object.freeze(Object.keys(ACTIONS));

/** Whether `key` is a registered action. */
const has = (key) => Object.prototype.hasOwnProperty.call(ACTIONS, key);

/**
 * One action, with its key.
 * @param {string} key
 */
function of(key) {
  if (!has(key)) throw new Error(`ai actions: "${key}" is not registered in services/ai/actions.js`);
  return { key, ...ACTIONS[key] };
}

/** The actions AI Control lists: every one with a chain, in the registry's order. */
const listed = () => KEYS.filter((k) => !ACTIONS[k].direct).map(of);

module.exports = { ACTIONS, KEYS, has, of, listed };
