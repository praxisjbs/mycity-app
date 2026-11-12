"use strict";
/**
 * An employment contract's statuses and the moves between them (docs/guides/offers.md §3 step 5a).
 * The table's CHECK is migration 5030; this file is what the code reads.
 *
 *   draft      generated at the offer's acceptance, waiting for the company's signature
 *   sent       the company signed; the hire holds a link and has not signed
 *   signed     the hire signed: the last signature of its request
 *   cancelled  the hire declined, the request lapsed, or the case was cancelled
 *
 * A contract is generated once a case, so there is no second draft: a wording changed after
 * acceptance never reaches a contract already made (guide §6).
 */
const STATUSES = Object.freeze(["draft", "sent", "signed", "cancelled"]);

/** What each status may become. A signed contract is final. */
const MOVES = Object.freeze({
  draft: Object.freeze(["sent", "cancelled"]),
  sent: Object.freeze(["signed", "cancelled"]),
  signed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

/** The statuses a contract still waiting on someone holds. */
const OPEN = Object.freeze(["draft", "sent"]);

const moves = (from, to) => (MOVES[from] || []).includes(to);

/** The role each signer takes on the request: the company first, the hire second (guide §3 step 5a). */
const ROLES = Object.freeze({ company: "mycity", hire: "employee" });

module.exports = { STATUSES, MOVES, OPEN, ROLES, moves };
