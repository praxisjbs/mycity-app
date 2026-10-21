"use strict";
/**
 * Who sets which level of the cascade, and what each level hangs from (A16;
 * docs/guides/performance.md §6 "Who sets which level").
 *
 *   organisation   goals.organisation (the CEO); no parent; a calendar year; active when saved
 *   annual         goals.company; under an active organisational goal of the same year
 *   monthly        goals.company; under an active annual goal whose year holds the month
 *   department     goals.department, for the head's own department; under an active monthly
 *                  goal of the same month
 *
 * Every number comes from numbering, one scheme per level.
 */
const { AppError } = require("../../shared/errors");
const grantsCache = require("../../shared/rbac/grants-cache");
const lagos = require("../../shared/time/lagos");

/** Each level's capability, the level it hangs from, and its numbering scheme (goals.service numberFor). */
const LEVELS = Object.freeze({
  organisation: { capability: "goals.organisation", parent: null, doc_type: "goal_organisation" },
  annual: { capability: "goals.company", parent: "organisation", doc_type: "goal_annual" },
  monthly: { capability: "goals.company", parent: "annual", doc_type: "goal_monthly" },
  department: { capability: "goals.department", parent: "monthly", doc_type: "goal_department" },
});

const invalid = (field, message) => new AppError("VALIDATION_FAILED", message, 422, { [field]: [message] });

/** Does the caller hold the capability the level needs? The CEO holds every one. */
async function mayAuthor(client, actor, level) {
  if (actor && actor.is_ceo === true) return true;
  const held = await grantsCache.getCapabilities(client, actor && actor.user_id);
  return held.includes(LEVELS[level].capability);
}

async function assertMayAuthor(client, actor, level) {
  if (!(await mayAuthor(client, actor, level))) {
    throw new AppError(
      "CAPABILITY_REQUIRED",
      "You do not set goals at this level",
      403,
    );
  }
}

/** The period a goal covers: a calendar year, or a month ("YYYY-MM"). */
function periodOf({ level, year, month }) {
  if (level === "monthly" || level === "department") {
    const { first, last } = lagos.monthBounds(`${month}-01`);
    return { starts_on: first, ends_on: last };
  }
  return { starts_on: `${year}-01-01`, ends_on: `${year}-12-31` };
}

/**
 * The parent must be one level up, approved, and its period must hold the child's.
 * @param {object|null} parent  the parent goal's row
 */
function assertParent(level, parent, period) {
  const want = LEVELS[level].parent;
  if (!want) return;
  if (!parent) throw invalid("parent_goal_id", "Pick the parent goal");
  if (parent.level !== want) throw invalid("parent_goal_id", `Pick ${article(want)} goal`);
  if (parent.status !== "active") {
    throw new AppError("PARENT_NOT_ACTIVE", "The goal above it is not approved yet", 422, {
      parent_goal_id: ["Not approved yet"],
    });
  }
  if (period.starts_on < parent.starts_on || period.ends_on > parent.ends_on) {
    throw invalid("parent_goal_id", "Outside its period");
  }
}

const article = (level) => ({ organisation: "an organisational", annual: "an annual", monthly: "a monthly" })[level];

module.exports = { LEVELS, mayAuthor, assertMayAuthor, periodOf, assertParent };
