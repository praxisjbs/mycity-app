"use strict";
/**
 * Tidy With AI on a panelist's comments (docs/guides/recruitment.md §3 step 9, §9; action
 * interview-notes-cleanup, job Default, chosen by GE 04/11/2026). Nothing is kept: the panelist reads
 * the tidied text beside their own and presses Use Tidied, then saves. The text is theirs, so it is not
 * held to the no-gap check: a panelist's own "[inaudible]" stays (GE · (Ose), 04/11/2026).
 *
 *   status()            GET  /recruitment/interviews/assist: whether it may answer now
 *   tidy(user, body)    POST /recruitment/interviews/assist: for a panelist with a card still to
 *                       write, whatever their grant (`recruitment` view is enough, as for the card)
 */
const c = require("@mycity/contract");
const { pool } = require("../../config/db");
const ai = require("../../services/ai/llm.service");
const drafts = require("../../services/ai/drafts");
const redact = require("../../services/ai/redact");
const { AppError } = require("../../shared/errors");
const repo = require("./interviews.repo");

const MODULE = "recruitment";
const off = (reason) => ({ available: false, reason, text: null, ai_run_id: null });

const status = () => drafts.availability(pool, MODULE);

async function tidy(user, body) {
  if (!(await repo.hasOpenSeat(pool, user.employee_id)))
    throw new AppError("NOT_PANELIST", "Only a panelist with a card to write can tidy it", 403);
  const now = await status();
  if (!now.available) return off(now.reason);
  const s = redact.shield({ text: body.text });
  let run;
  try {
    run = await ai.complete({
      purpose: "interview-notes-cleanup",
      module: MODULE,
      actor: user,
      input: s.value,
      output: c.interviews.NotesTidyOutput,
      egress: "external",
      temperature: 0.2,
    });
  } catch (err) {
    const reason = drafts.offReason(err);
    if (reason) return off(reason);
    throw err;
  }
  if (!run || !run.output) return off("off");
  return { available: true, reason: null, text: s.restore(run.output.text).slice(0, 5000), ai_run_id: run.run_id };
}

module.exports = { tidy, status };
