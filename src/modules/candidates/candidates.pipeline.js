"use strict";
/**
 * An application's pipeline (docs/guides/recruitment.md §6.3): the five M4 stages, a card moving to
 * any stage ahead of it or one back, never into a column the vacancy's board leaves out. Not
 * Progressing stops it where it stands (status not_progressed, the stage kept), and Reopen puts it
 * back at that stage. Offer and the stages after it are M5's: no move here reaches them.
 *
 * Every move, Not Progressing and Reopen is a row of entity_state_history (entity type
 * application), so the time at each stage reads one history (shared/state/state-history).
 *
 *   nextStages(stage, board)       where a card may move now, in board order
 *   assertCanMove(row, to, board)  409 with plain words, else nothing
 */
const { AppError } = require("../../shared/errors");
const { defineMachine } = require("../../shared/state/state-history");
const { M4_STAGES } = require("../vacancies/vacancies.lifecycle");

const NOT_PROGRESSED = "not_progressed";

/** Every stage may reach every other (the board narrows it), Not Progressing, and back by Reopen. */
const MACHINE = defineMachine(
  "application",
  Object.fromEntries([
    ...M4_STAGES.map((s) => [s, [...M4_STAGES.filter((t) => t !== s), NOT_PROGRESSED]]),
    [NOT_PROGRESSED, [...M4_STAGES]],
  ]),
);

/**
 * The stages a card at `stage` may move to: any ahead of it, or the one just behind it, among the
 * columns of its vacancy's board.
 * @param {string} stage
 * @param {string[]} board  the vacancy's board stages (vacancies.lifecycle boardStages)
 */
function nextStages(stage, board) {
  const at = board.indexOf(stage);
  if (at < 0) return board.filter((s) => s !== stage);
  return board.filter((s, i) => i > at || i === at - 1);
}

/** Refuse a move a card may not make, in words a recruiter reads. */
function assertCanMove(row, to, board) {
  if (row.status !== "active")
    throw new AppError("MOVE_NOT_ALLOWED", "Reopen this candidate before moving them", 409);
  if (!M4_STAGES.includes(row.stage))
    throw new AppError("MOVE_NOT_ALLOWED", "This candidate has moved on to an offer", 409);
  if (to === row.stage) throw new AppError("MOVE_NOT_ALLOWED", "The candidate is already at this stage", 409);
  if (!board.includes(to)) throw new AppError("MOVE_NOT_ALLOWED", "This role does not use that stage", 409);
  if (!nextStages(row.stage, board).includes(to))
    throw new AppError("MOVE_NOT_ALLOWED", "Move one stage back at most", 409);
}

module.exports = { MACHINE, NOT_PROGRESSED, nextStages, assertCanMove };
