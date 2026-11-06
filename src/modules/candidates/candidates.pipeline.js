"use strict";
/**
 * An application's pipeline (docs/guides/recruitment.md §6.3). By hand, on the board, a card moves
 * through the five M4 stages: to any stage ahead of it or one back, never into a column the vacancy's
 * board leaves out. Not Progressing stops it where it stands (status not_progressed, the stage kept),
 * and Reopen puts it back at that stage.
 *
 * Past Shortlist the stages are M5's (#79, 06/11/2026), and only M5's own steps set them, through
 * candidates.advanceIn and hireIn in M5's transaction: offer when an offer is sent, documentation at
 * acceptance, pre_onboarding once the checklist is done, onboarding on the start date, hired when
 * onboarding completes. An offer that ends unsigned (declined, lapsed, withdrawn) takes the card back
 * to Shortlist (candidates.offerEndedIn), so another offer can be made. Not Progressing works from any
 * of them, and Reopen returns the card to where it stopped.
 *
 * Every move, Not Progressing and Reopen is a row of entity_state_history (entity type
 * application), so the time at each stage reads one history (shared/state/state-history).
 *
 *   ORDER                          every stage, in the order a card goes through them
 *   nextStages(stage, board)       where a card may be moved by hand now, in board order
 *   assertCanMove(row, to, board)  409 with plain words, else nothing
 */
const { AppError } = require("../../shared/errors");
const { defineMachine } = require("../../shared/state/state-history");
const { M4_STAGES, M5_STAGES } = require("../vacancies/vacancies.lifecycle");

const NOT_PROGRESSED = "not_progressed";

/** Every stage, in pipeline order. */
const ORDER = Object.freeze([...M4_STAGES, ...M5_STAGES]);

/**
 * The moves. Among the M4 stages every stage may reach every other (the board narrows it); only
 * Shortlist leads to Offer; from Offer on, one step forward at a time, and Offer may go back to
 * Shortlist. Any stage but Hired may stop at Not Progressing, which returns to any stage but Hired.
 */
const MACHINE = defineMachine(
  "application",
  Object.fromEntries([
    ...M4_STAGES.map((s) => [s, [...M4_STAGES.filter((t) => t !== s), ...(s === "shortlist" ? ["offer"] : []), NOT_PROGRESSED]]),
    ["offer", ["documentation", "shortlist", NOT_PROGRESSED]],
    ["documentation", ["pre_onboarding", NOT_PROGRESSED]],
    ["pre_onboarding", ["onboarding", NOT_PROGRESSED]],
    ["onboarding", ["hired", NOT_PROGRESSED]],
    ["hired", []],
    [NOT_PROGRESSED, ORDER.filter((s) => s !== "hired")],
  ]),
);

/** Whether a stage is M5's (Offer or after), where no hand move reaches. */
const isM5 = (stage) => M5_STAGES.includes(stage);

/**
 * The stages a card at `stage` may be moved to by hand: any ahead of it, or the one just behind it,
 * among the hand-moved columns of its vacancy's board. None once it is at Offer or after.
 * @param {string} stage
 * @param {string[]} board  the vacancy's hand-moved stages (vacancies.lifecycle boardStages)
 */
function nextStages(stage, board) {
  if (isM5(stage)) return [];
  const manual = board.filter((s) => !isM5(s));
  const at = manual.indexOf(stage);
  if (at < 0) return manual.filter((s) => s !== stage);
  return manual.filter((s, i) => i > at || i === at - 1);
}

/** Refuse a move a card may not make, in words a recruiter reads. */
function assertCanMove(row, to, board) {
  if (row.status !== "active")
    throw new AppError("MOVE_NOT_ALLOWED", "Reopen this candidate before moving them", 409);
  if (isM5(row.stage))
    throw new AppError("MOVE_NOT_ALLOWED", "This candidate has moved on to an offer", 409);
  if (to === row.stage) throw new AppError("MOVE_NOT_ALLOWED", "The candidate is already at this stage", 409);
  if (isM5(to)) throw new AppError("MOVE_NOT_ALLOWED", "An offer moves a candidate to Offer", 409);
  if (!board.includes(to)) throw new AppError("MOVE_NOT_ALLOWED", "This role does not use that stage", 409);
  if (!nextStages(row.stage, board).includes(to))
    throw new AppError("MOVE_NOT_ALLOWED", "Move one stage back at most", 409);
}

module.exports = { MACHINE, NOT_PROGRESSED, ORDER, isM5, nextStages, assertCanMove };
