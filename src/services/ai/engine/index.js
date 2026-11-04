"use strict";
/**
 * The Praxis AI Engine (docs/guides/praxis-ai.md §6.14; decision 17): the part that would travel
 * to another project. It holds the rules of a question (turn.js), of a card (cards.js), of the
 * pane (pane.js), of what a read sends back (content.js) and of the proof (matrix.js), and
 * requires nothing of MyCity: no database, no vendor, no framework, no module. Gate 24
 * (scripts/check/ai-engine-boundary.js) keeps it so. The adapter in services/ai/assistant/
 * supplies the pieces: how a read runs with a person's rights, how the model is talked to, how
 * an action is checked, the clock and the limits.
 *
 *   const engine = createEngine({ limits: { maxReads: 5, maxRounds: 8, deadlineMs: 60_000 } });
 *   const { draft } = await engine.runTurn({ talk, messages, tools, output, runTool, parse, rescue });
 */
const turn = require("./turn");
const cards = require("./cards");
const pane = require("./pane");
const content = require("./content");
const matrix = require("./matrix");
const { EngineError, isEngineError } = require("./errors");

const DEFAULT_LIMITS = Object.freeze({ maxReads: 5, maxRounds: 8, deadlineMs: 60_000 });

/**
 * @param {{limits?: {maxReads?: number, maxRounds?: number, deadlineMs?: number}, now?: () => number}} [deps]
 */
function createEngine(deps = {}) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...(deps.limits || {}) });
  const now = deps.now || (() => Date.now());
  return Object.freeze({
    limits,
    runTurn: (q) => turn.runTurn({ ...q, limits: { ...limits, ...(q.limits || {}) }, now }),
    cards,
    pane,
    content,
    matrix,
  });
}

module.exports = { createEngine, DEFAULT_LIMITS, EngineError, isEngineError, turn, cards, pane, content, matrix };
