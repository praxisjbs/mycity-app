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
  // Draft With AI on an SOP (docs/guides/knowledge.md §6.4): a department's procedure shaped into
  // Purpose, Roles and Steps; a procedure names people, so DeepSeek never answers it.
  "sop-draft": Object.freeze({
    label: "Draft SOP",
    module: "knowledge",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-11-11",
    built: true,
  }),
  // Draft Lesson on a course's lesson item (docs/guides/knowledge.md §6.5): a lesson written from a
  // pasted text or a PDF's text, only when the builder presses it; nothing kept until Use Lesson.
  "training-lesson-draft": Object.freeze({
    label: "Draft Lesson",
    module: "knowledge",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-11-11",
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
  // Write With AI on Raise a Query (docs/guides/queries.md §9): Subject and What Happened.
  "query-draft": Object.freeze({
    label: "Write Query",
    module: "queries",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-10-26",
    built: true,
  }),
  // Write With AI on the letter editor (queries.md §9): a disciplinary letter's wording, with care.
  "letter-draft": Object.freeze({
    label: "Write Letter",
    module: "queries",
    job: "deep_reasoning",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-10-26",
    built: true,
  }),
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
  // The User Guide's search (docs/guides/user-guide.md §6.8): its passages and each search, on one
  // embedding model so the two can be compared. A search can name a person.
  "guide-search": Object.freeze({
    label: "Guide Search",
    module: "knowledge",
    job: "embeddings",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-10-25",
    built: true,
  }),
  // Its short answer, written only from the passages the reader may read (§6.9), on Fast as
  // chosen on 25/10/2026 (§6.1 decision 10).
  "guide-answer": Object.freeze({
    label: "Guide Answer",
    module: "knowledge",
    job: "fast",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-10-25",
    built: true,
  }),
  // A search spoken into the guide's box (§6.10).
  "guide-voice": Object.freeze({
    label: "Guide Voice Search",
    module: "knowledge",
    job: "transcription",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-10-25",
    built: true,
  }),
  // Tidy With AI on the agreement template editor (docs/guides/partnerships.md §6.8, §9): the pasted
  // wording tidied, with a field proposed for each value; only when the person presses it, nothing kept.
  "template-tidy": Object.freeze({
    label: "Tidy Agreement",
    module: "partnerships",
    job: "default",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-11-06",
    built: true,
  }),
  // M8 Expenses (docs/guides/expenses.md §9): the three suggestions a person accepts, jobs chosen by
  // AJ (docs/handoff/m8-expenses.md decision 14).
  "expense-invoice-read": Object.freeze({
    label: "Read Invoice",
    module: "expenses",
    job: "image_reading",
    personal_data: true,
    chosen_by: "AJ",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // Praxis AI's documents in the chat (docs/guides/praxis-ai.md §1.10 decision 43, §6.18): a payment
  // receipt attached on Ask is read for Record Disbursement's card. An invoice reuses Read Invoice above.
  "disbursement-receipt-read": Object.freeze({
    label: "Read Receipt",
    module: "expenses",
    job: "image_reading",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-11-13",
    built: true,
  }),
  "expense-duplicate-check": Object.freeze({
    label: "Check Duplicate",
    module: "expenses",
    job: "default",
    personal_data: true,
    chosen_by: "AJ",
    chosen_at: "2026-11-04",
    built: true,
  }),
  "expense-category-suggest": Object.freeze({
    label: "Suggest Category",
    module: "expenses",
    job: "default",
    personal_data: true,
    chosen_by: "AJ",
    chosen_at: "2026-11-05",
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
  // M4 Recruitment (docs/guides/recruitment.md §9): Write With AI on New Vacancy, in MyCity's job
  // description shape, and Suggest With AI on a vacancy's Apply questions and interview traits.
  "jd-draft": Object.freeze({
    label: "Draft Job Description",
    module: "recruitment",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // The two questions New Vacancy's interview asks about this role from the answers so far
  // (docs/guides/recruitment.md §3 step 2, §9): Default, as jd-draft (GE, 06/11/2026).
  "vacancy-follow-ups": Object.freeze({
    label: "Ask Vacancy Follow-Ups",
    module: "recruitment",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-06",
    built: true,
  }),
  "screening-questions": Object.freeze({
    label: "Suggest Vacancy Questions",
    module: "recruitment",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // Suggest With AI on an assessment's questions (docs/guides/recruitment.md §6.7, §9). Personal data
  // as every Recruitment action is (decided 04/11/2026): it reads the role a candidate is hired for.
  "assessment-questions": Object.freeze({
    label: "Suggest Assessment Questions",
    module: "recruitment",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // Tidy With AI on a panelist's interview comments (docs/guides/recruitment.md §9): about a person.
  "interview-notes-cleanup": Object.freeze({
    label: "Tidy Interview Notes",
    module: "recruitment",
    job: "default",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // Score With AI and Screen With AI on Candidates (docs/guides/recruitment.md §6.4): a CV read
  // against the role and its must-meet conditions; personal data, so never DeepSeek.
  "cv-screen": Object.freeze({
    label: "Score Application",
    module: "recruitment",
    job: "deep_reasoning",
    personal_data: true,
    chosen_by: "GE",
    chosen_at: "2026-11-04",
    built: true,
  }),
  // M7 Proposal Studio (docs/guides/partnerships.md §6.10, §9): the question cards, the draft and a
  // section's rewrite on Top Tier, chosen by JBS Praxis; contacts' names travel, so DeepSeek never answers.
  "proposal-questions": Object.freeze({
    label: "Proposal Questions",
    module: "partnerships",
    job: "top_tier",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-11-05",
    reason: "Long drafting from many sources: the brief, a meeting transcript, the deal and its record, past accepted proposals and MyCity's proof points, written into the design kit's layouts",
    // Anthropic Sonnet first, Gemini Pro when MyCity's Anthropic key is missing or failing (§13.1 item 21).
    chain: Object.freeze([
      ["anthropic", "sonnet"],
      ["gemini", "pro"],
    ]),
    built: true,
  }),
  "proposal-draft": Object.freeze({
    label: "Write Proposal",
    module: "partnerships",
    job: "top_tier",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-11-05",
    reason: "Long drafting from many sources: the brief, a meeting transcript, the deal and its record, past accepted proposals and MyCity's proof points, written into the design kit's layouts",
    // Anthropic Sonnet first, Gemini Pro when MyCity's Anthropic key is missing or failing (§13.1 item 21).
    chain: Object.freeze([
      ["anthropic", "sonnet"],
      ["gemini", "pro"],
    ]),
    built: true,
  }),
  "proposal-rewrite": Object.freeze({
    label: "Rewrite Section",
    module: "partnerships",
    job: "top_tier",
    personal_data: true,
    chosen_by: "JP",
    chosen_at: "2026-11-05",
    reason: "Long drafting from many sources: the brief, a meeting transcript, the deal and its record, past accepted proposals and MyCity's proof points, written into the design kit's layouts",
    // Anthropic Sonnet first, Gemini Pro when MyCity's Anthropic key is missing or failing (§13.1 item 21).
    chain: Object.freeze([
      ["anthropic", "sonnet"],
      ["gemini", "pro"],
    ]),
    built: true,
  }),
  // Write With AI in Send Proposal: the covering email's subject and message. Default, not Fast: a
  // person reads it as a draft (ai-control.md §6.2), chosen by TB.
  "proposal-message": Object.freeze({
    label: "Proposal Message",
    module: "partnerships",
    job: "default",
    personal_data: true,
    chosen_by: "TB",
    chosen_at: "2026-11-07",
    built: true,
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
