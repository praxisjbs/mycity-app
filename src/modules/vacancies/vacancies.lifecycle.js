"use strict";
/**
 * A vacancy's lifecycle (docs/guides/recruitment.md §6.1): draft → open ⇄ paused → closed; a draft
 * or a paused vacancy may also close. Each move is a row of entity_state_history (shared, the same
 * record of moves the pipeline keeps), so the days a vacancy spent open or paused read one history.
 *
 *   assertPublishable(row)   what Publish needs, as field errors (422)
 *   publicState(row, now)    what the careers page says about it: open, paused, closed or filled
 *   boardStages(scorecard)   the board's columns; howWeHire(parts) the careers page's steps
 */
const { defineMachine } = require("../../shared/state/state-history");
const { AppError } = require("../../shared/errors");

/** The M4 stages, in board order (contract vacancies.js M4_STAGES). */
const M4_STAGES = Object.freeze(["application", "screening", "assessment", "interview", "shortlist"]);

const MACHINE = defineMachine("vacancy", {
  draft: ["open", "closed"],
  open: ["paused", "closed"],
  paused: ["open", "closed"],
  closed: [],
});

/** The words a refused move answers with, by where it was going. */
const REFUSED = Object.freeze({
  open: "Only a draft or a paused vacancy can be published",
  paused: "Only an open vacancy can be paused",
  closed: "This vacancy is already closed",
});

/** Throw 409 with plain words when a vacancy cannot move from `from` to `to`. */
function assertCanMove(from, to) {
  if (!(MACHINE.moves[from] || []).includes(to)) {
    throw new AppError("MOVE_NOT_ALLOWED", REFUSED[to] || "That change is not allowed", 409);
  }
}

/**
 * What Publish needs (guide §6.1), as field errors so the screen marks each one: a department, a
 * hiring manager, a location unless remote, a description and requirements as the form demands,
 * and a closing day in the future.
 * @param {object} row  the vacancy as the repo reads it
 * @param {Date} [now]
 */
function assertPublishable(row, now = new Date()) {
  const fields = {};
  if (!row.department_id) fields.department_id = ["Pick the department"];
  if (!row.hiring_manager_id) fields.hiring_manager_id = ["Pick the hiring manager"];
  if (row.work_pattern !== "remote" && !row.location) fields.location = ["Pick the location"];
  if (!row.description || row.description.trim().length < 80) fields.description = ["At least 80 characters"];
  if (!row.requirements || row.requirements.trim().length < 20) fields.requirements = ["Say what is needed"];
  if (!row.closes_at || new Date(row.closes_at) <= now)
    fields.closes_on = [row.status === "paused" ? "Its closing day has passed" : "Pick a day after today"];
  if (Object.keys(fields).length) {
    throw new AppError("VALIDATION_FAILED", "Finish the vacancy before publishing it", 422, fields);
  }
}

/**
 * What the careers page says about a vacancy (PublicJob.state): open while it takes applications,
 * paused, closed; closed as filled says filled. An open vacancy past its closing time reads closed.
 * A draft is never public; the caller answers 404 for it.
 */
function publicState(row, now = new Date()) {
  if (row.status === "closed") return row.close_reason === "filled" ? "filled" : "closed";
  if (row.status === "paused") return "paused";
  if (row.closes_at && new Date(row.closes_at) <= now) return "closed";
  return "open";
}

/** Whether it takes applications now: open, and before its closing time. */
const takesApplications = (row, now = new Date()) => publicState(row, now) === "open" && row.status === "open";

const ASSESSED = ["psychometric", "technical", "case_study"];

/** The board's columns for a vacancy: the M4 stages less those whose parts are off (guide §6.3). */
function boardStages(scorecard) {
  const on = new Set(scorecard.filter((p) => p.active).map((p) => p.code));
  return M4_STAGES.filter((stage) => {
    if (stage === "assessment") return ASSESSED.some((code) => on.has(code));
    if (stage === "interview") return on.has("interview");
    return true;
  });
}

/** The steps a role uses, from its scorecard parts switched on (PublicJob.how_we_hire). */
function howWeHire(activeParts) {
  const on = new Set(activeParts || []);
  const steps = ["apply"];
  if (on.has("screening")) steps.push("screening");
  if (ASSESSED.some((code) => on.has(code))) steps.push("assessment");
  if (on.has("interview")) steps.push("interview");
  return steps;
}

module.exports = { MACHINE, M4_STAGES, assertCanMove, assertPublishable, publicState, takesApplications, boardStages, howWeHire };
