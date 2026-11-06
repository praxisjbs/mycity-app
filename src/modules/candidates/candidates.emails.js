"use strict";
/**
 * Candidate Emails (docs/guides/recruitment.md §6.8): the five emails a candidate is sent, each a
 * shipped default in templates/email/ (version 0) that Operations & People may reword. A save is
 * the next template_version, in Markdown, checked against the email's declared variables before it
 * is kept; Restore Default saves the shipped wording as the next version, so every wording ever
 * sent stays traceable (shared/templates/template-store.js).
 *
 * A shipped file is HTML; the editor shows it as the Markdown it would be saved as: a paragraph a
 * paragraph, a link as [text](address), the {{ }} variables and blocks left as they are.
 */
const store = require("../../shared/templates/template-store");
const variables = require("../../shared/templates/variables");

/** The five, in the order Candidate Emails lists them, with the names the screen shows. */
const NAMES = Object.freeze({
  "application-received": "Application Received",
  "apply-invite": "Invitation to Apply",
  "assessment-invite": "Assessment Invitation",
  "interview-invite": "Interview Invitation",
  "candidate-not-progressed": "Not Progressing",
});
const KEYS = Object.freeze(Object.keys(NAMES));

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/** HTML as Markdown: one paragraph a block, links kept, tags dropped, entities read. */
function markdownOf(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${text.replace(/<[^>]*>/g, "").trim()}](${href})`)
    .split(/<\/(?:p|h[1-6]|div|li)>|<br\s*\/?>/i)
    .map((chunk) =>
      chunk
        .replace(/<[^>]*>/g, "")
        .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e) => ENTITIES[e])
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n\n");
}

/** The names an email may use: its declared variables, then the built-ins a mail can read. */
function variablesOf(key) {
  const schema = variables.schemaOf("email", key);
  const own = schema && schema.shape ? Object.keys(schema.shape) : [];
  return [...own, "recipient", "org"].slice(0, 20);
}

/** CandidateEmail from a template row (a saved version, or the shipped default). */
function shape(key, t, updatedAt = null) {
  const isDefault = Number(t.version) === 0;
  return {
    key,
    name: NAMES[key],
    subject: t.subject || "",
    body: t.format === "html" ? markdownOf(t.body) : t.body,
    version: Number(t.version),
    is_default: isDefault,
    variables: variablesOf(key),
    updated_at: isDefault ? null : updatedAt,
  };
}

module.exports = { NAMES, KEYS, markdownOf, variablesOf, shape, store };
