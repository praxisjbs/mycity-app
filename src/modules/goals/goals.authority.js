"use strict";
/**
 * Who may set what in Performance (docs/guides/performance.md §6.3, §8). Routes check the module
 * grant and the capability; these checks add what a route cannot see: whose function it is.
 *
 *   the company's objectives and key results   `goals.company` (Management, the CEO)
 *   a function's objectives, key results, KPIs  `goals.function` and being the function's head or
 *                                               acting head (organisation.headOf); the CEO and
 *                                               whoever runs the cycle (`performance.manage`) may
 *                                               act for any function
 *
 * The CEO holds every authority (A11).
 */
const { pool } = require("../../config/db");
const { AppError } = require("../../shared/errors");
const grantsCache = require("../../shared/rbac/grants-cache");
const organisation = require("../organisation/organisation.service");

const refused = (message) => new AppError("PERMISSION_DENIED", message, 403);

/** Does the actor hold a capability? The CEO holds every one. */
async function holds(actor, code) {
  if (!actor) return false;
  if (actor.is_ceo === true) return true;
  if (!actor.user_id) return false;
  return (await grantsCache.getCapabilities(pool, actor.user_id)).includes(code);
}

/** May the actor act for every function: the CEO, or whoever runs the cycle. */
const runsTheCycle = (actor) => holds(actor, "performance.manage");

/** Is the actor the function's head or acting head? */
async function headsFunction(db, actor, departmentId) {
  if (!actor || !actor.employee_id || !departmentId) return false;
  return (await organisation.headOf(db, departmentId)) === actor.employee_id;
}

/** The refusals, in the words of what is being set: a function's goals, or its KPIs. */
const REFUSED = Object.freeze({
  goals: {
    company: "Only Management set the company's objectives",
    none: "You cannot set a function's goals",
    head: "Only the function's head sets its goals",
  },
  KPIs: {
    company: "Only Management set the company's KPIs",
    none: "You cannot set a function's KPIs",
    head: "Only the function's head sets its KPIs",
  },
});

/**
 * Refuse unless the actor may set this function's goals (or the company's, for no department).
 * @param {{query: Function}} db
 * @param {object} actor
 * @param {string|null} departmentId  null: the company
 * @param {string} [what]  what is being set, as the refusal names it: "goals", or "KPIs" for a KPI
 */
async function assertSetsGoals(db, actor, departmentId, what = "goals") {
  const words = REFUSED[what] || REFUSED.goals;
  if (!departmentId) {
    if (await holds(actor, "goals.company")) return;
    throw refused(words.company);
  }
  if (!(await holds(actor, "goals.function"))) throw refused(words.none);
  if ((await runsTheCycle(actor)) || (await headsFunction(db, actor, departmentId))) return;
  throw refused(words.head);
}

/** assertSetsGoals as a yes or no, for what a screen offers. */
async function maySetGoals(db, actor, departmentId) {
  try {
    await assertSetsGoals(db, actor, departmentId);
    return true;
  } catch (err) {
    if (err.code === "PERMISSION_DENIED") return false;
    throw err;
  }
}

module.exports = { holds, runsTheCycle, headsFunction, assertSetsGoals, maySetGoals };
