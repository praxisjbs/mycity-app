"use strict";
/**
 * The closed review as a letterheaded PDF (docs/guides/performance.md §6.12): the person, their
 * reviewer and month; each line with its target, actual, evidence, the proposed, self and final
 * score (Auto where the system worked it out, and the reason a score was changed); the month's
 * tasks; the corrective actions; the dotted manager's input; and the chain with names and dates.
 *
 * Generated in the closing transaction through documents.generate(): the worker renders it after
 * commit, and the document is filed on the review (entity performance_review), personal.
 */
const documents = require("../../shared/documents/generate");
const { formatDate, formatDateTime } = require("../../shared/time/day-first");
const { PDF_DOC_TYPE } = require("./reviews.events");

const SECTION = { results: "Results", kpis: "KPIs", accountability: "Accountability" };
const CRITERION = {
  objectives: "KPIs and objectives",
  quality: "Quality",
  timeliness: "Timeliness",
  attendance: "Attendance",
  conduct: "Conduct",
};
const RATING = { exceeds: "Exceeds", meets: "Meets", partly_meets: "Partly Meets", below: "Below" };
const OUTCOME = { confirm: "Confirmed", extend: "Extended 3 Months", end: "Employment Ended" };
const EVIDENCE = { record: "Record", document: "File", link: "Link", note: "Note" };

const score = (s) => (s === null || s === undefined ? "Not scored" : Number(s).toFixed(2));
const text = (v) => (v === null || v === undefined || v === "" ? "Not given" : String(v));

/** What a line aimed for, as printed. */
const targetOf = (line) =>
  line ? [line.target_text, line.target_value && !line.target_text ? `${line.target_value}${line.unit ? ` ${line.unit}` : ""}` : null].filter(Boolean).join(" ") || "Not set" : "Overall assessment";

/** What came in, as printed. */
const actualOf = (i) =>
  [i.actual_text, i.actual_value && !i.actual_text ? i.actual_value : null, i.achieved_on ? `Done ${formatDate(i.achieved_on)}` : null]
    .filter(Boolean)
    .join(", ") || "Not given";

/** The evidence, as printed: its kind and what it names. */
const evidenceOf = (i) => {
  if (i.auto) return "System record";
  if (!i.evidence_kind) return "Not Assessable";
  const what = i.evidence_note || i.evidence_url || (i.evidence_entity_type ? i.evidence_entity_type.replace(/_/g, " ") : null);
  return what ? `${EVIDENCE[i.evidence_kind]}: ${what}` : EVIDENCE[i.evidence_kind];
};

/**
 * The template's variables, from the review as its closing transaction holds it.
 * @param {object} review   reviews.repo row, closed scores and rating set
 * @param {Array<object>} items  reviews.repo items
 * @param {{done: string[], ongoing: string[], next_month: string[]}} tasks  titles
 * @param {Array<{step: string, name: string, at: string|null}>} chain
 */
function variables(review, items, tasks, chain) {
  const month = review.round_name || "Probation Review";
  return {
    title: `${review.employee.display_name} · ${month} Review`,
    employee_name: review.employee.display_name,
    job_title: review.employee.job_title,
    department: review.employee.department,
    reviewer_name: review.reviewer.display_name,
    month,
    closed_on: formatDate(new Date()),
    score_month: score(review.score_month),
    score_to_date: score(review.score_to_date),
    rating: RATING[review.rating] || "Not rated",
    conduct_note: review.conduct_breach ? text(review.conduct_note) : null,
    outcome: review.probation_outcome ? OUTCOME[review.probation_outcome] : null,
    lines: items.map((i) => ({
      section: i.section ? SECTION[i.section] : "Probation",
      title: i.line ? i.line.title : CRITERION[i.criterion] || text(i.criterion),
      target: targetOf(i.line),
      actual: actualOf(i),
      evidence: evidenceOf(i),
      proposed: score(i.proposed_score),
      self: i.self_score === null ? "As proposed" : score(i.self_score),
      final: score(i.score),
      auto: Boolean(i.auto),
      note: [i.self_reason ? `Self: ${i.self_reason}` : null, i.override_reason ? `Reviewer: ${i.override_reason}` : null, i.comment]
        .filter(Boolean)
        .join(" · ") || null,
      action: i.action_text || null,
    })),
    done: tasks.done,
    ongoing: tasks.ongoing,
    next_month: tasks.next_month,
    actions: items
      .filter((i) => i.corrective_title)
      .map((i) => ({
        title: i.corrective_title,
        owner: i.corrective_owner ? i.corrective_owner.display_name : "Not set",
        due: formatDate(i.corrective_due_on),
      })),
    input: review.dotted_input && review.dotted ? { name: review.dotted.display_name, text: review.dotted_input } : null,
    chain: chain.map((s) => ({ step: s.step, name: s.name, at: s.at ? formatDateTime(s.at) : "Skipped" })),
  };
}

/** Queue the PDF in the closing transaction; returns the document's id. */
async function generate(client, review, items, tasks, chain) {
  const doc = await documents.generate(client, {
    doc_type: PDF_DOC_TYPE,
    entity: { type: "performance_review", id: review.performance_review_id },
    subject_employee_id: review.employee_id,
    data: variables(review, items, tasks, chain),
    actor: null,
  });
  return doc.document_id;
}

module.exports = { variables, generate, RATING, OUTCOME };
