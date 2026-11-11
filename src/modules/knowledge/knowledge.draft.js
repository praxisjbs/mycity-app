"use strict";
/**
 * Draft With AI on an SOP (docs/guides/knowledge.md §6.4; action sop-draft, the Default job,
 * personal data, never DeepSeek, chosen by TB 11/11/2026). A department's existing procedure,
 * pasted (up to 20,000 characters) or a PDF's text, comes back shaped as the form: title, purpose,
 * scope, roles and steps with who does each. A suggestion only: nothing is kept here, and the
 * writer takes it into the form (Use This Draft) or not (Keep Mine), then saves with their own
 * press (A23 as amended).
 *
 * The model keeps the procedure's own words and never adds a step; it never suggests a screen or
 * a file, which the writer picks. Contact details and identifiers are shielded on the way out and
 * put back in the answer. A scanned PDF has no text: "No text in this file", and nothing is sent.
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const vault = require("../../shared/documents/vault");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const pdfText = require("../../services/media/pdf-text");
const repo = require("./knowledge.repo");
const service = require("./knowledge.service");

const MODULE = "knowledge";
/** The form's own limits (SopDraftSave), so a suggestion always fits the form it fills. */
const LIMITS = { title: 120, purpose: 600, scope: 600, role: 60, roles: 10, steps: 50, step: 1000, who: 80 };

/** A text held to a limit, cut at a word where it can be. */
function fit(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

/** The procedure's text: what was pasted, or a clean PDF's text (null when it has none). */
async function procedureOf(user, body) {
  if (body.text) return body.text;
  const doc = await vault.getReadable(pool, user, body.document_id);
  if (doc.mime !== "application/pdf")
    throw new AppError("NOT_A_PDF", "Pick a PDF", 422, { document_id: ["Pick a PDF"] });
  const text = ["clean", "skipped"].includes(doc.scan_status) ? await pdfText.read(doc.storage_key) : null;
  if (!text) throw new AppError("NO_TEXT", "No text in this file", 422, { document_id: ["No text in this file"] });
  return text;
}

/** The answer back in the contract's shape, the shield's tokens restored and every field fitted. */
function shaped(out, restore) {
  const r = (s) => restore(s ?? "");
  const roles = (out.roles || []).map((x) => fit(r(x), LIMITS.role)).filter(Boolean).slice(0, LIMITS.roles);
  const steps = (out.steps || [])
    .map((s) => ({ text: fit(r(s.text), LIMITS.step), who: s.who ? fit(r(s.who), LIMITS.who) || null : null }))
    .filter((s) => s.text.length >= 3)
    .slice(0, LIMITS.steps);
  const scope = out.scope ? fit(r(out.scope), LIMITS.scope) : "";
  return {
    title: fit(r(out.title), LIMITS.title),
    purpose: fit(r(out.purpose), LIMITS.purpose),
    scope: scope || null,
    roles,
    steps,
  };
}

/**
 * POST /knowledge/sops/draft-with-ai: a writer of the department only (§6.2).
 * @returns {Promise<import("@mycity/contract").knowledge.SopDraftSuggestion>}
 */
async function suggest(user, body) {
  const department = await repo.department(pool, body.department_id);
  if (!department) throw new AppError("VALIDATION", "Pick a department", 422, { department_id: ["Pick a department"] });
  await service.assertWriter(pool, user, department.department_id);
  const procedure = await procedureOf(user, body);
  const now = await drafts.availability(pool, MODULE);
  if (!now.available)
    throw new AppError(
      "AI_UNAVAILABLE",
      now.reason === "limit" ? "This month's AI spending limit has been reached." : "Draft With AI is unavailable right now.",
      503,
    );
  const s = redact.shield({ department: department.name, procedure });
  const run = await ai.complete({
    purpose: "sop-draft",
    module: MODULE,
    actor: user,
    input: s.value,
    output: drafts.readyToUse(c.knowledge.SopDraftSuggestion, s),
    egress: "external",
    temperature: 0.2,
  });
  if (!run.output) throw new AppError("AI_UNAVAILABLE", "Draft With AI is unavailable right now.", 503);
  const suggestion = shaped(run.output, s.restore);
  if (!suggestion.title || !suggestion.steps.length)
    throw new AppError("AI_BAD_OUTPUT", "No steps found. Try again or write it by hand.", 502);
  return suggestion;
}

module.exports = { suggest, shaped, fit, LIMITS };
