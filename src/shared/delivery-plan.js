"use strict";
/**
 * What has shipped (FRONTEND_FOUNDATION F14), as the API sees it: the delivery plan the staff
 * app was built with, decided by the rule the app opens screens by (@mycity/contract/plan). A
 * screen the app would only show as Coming Soon is left out of every list the API offers
 * (Need You, ⌘K, Home's cards), so a page of 25 never counts a row its reader cannot open.
 *
 *   const plan = require("../../shared/delivery-plan");
 *   plan.screenOpen("expenses", "approvals")   // false on staging until Expenses has its API
 *   plan.typeOpens("expense_request")           // the screen route-map opens that record on
 *   plan.closedTypes()                          // every record type whose screen is not open
 *
 * The plan is app/dist/delivery-plan.json, which the app's build writes (app/vite.config.ts)
 * and a release carries. With no build (a laptop, CI's backend job) it is read from the docs,
 * the same way the build reads them. The rule follows APP_ENV, as the app's does where it runs:
 * production opens a screen whose PROGRESS row has API, UI and Mobile ticked; staging and
 * development open it once API is ticked; test opens every screen unless a suite hands this
 * module a plan and a rule of its own (use()). A plan that cannot be read holds nothing back,
 * and is reported once: the screens still answer for themselves with Coming Soon.
 */
const fs = require("node:fs");
const path = require("node:path");
const contractPlan = require("@mycity/contract/plan");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const lagos = require("./time/lagos");
const routeMap = require("./route-map");

const ROOT = path.resolve(__dirname, "../..");

/** { plan, rule } once read, or as a test set it. */
let held = null;

/** The plan the app was built with, else the docs'. */
function readPlan() {
  const built = path.resolve(ROOT, config.APP_DIST_DIR, "delivery-plan.json");
  if (fs.existsSync(built)) return JSON.parse(fs.readFileSync(built, "utf8"));
  return contractPlan.readPlan((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

/** The rule for where the API runs: "all" opens every screen (a test). */
function ruleFor(appEnv = config.APP_ENV) {
  if (appEnv === "production") return "production";
  if (appEnv === "test") return "all";
  return "staging";
}

function state() {
  if (held) return held;
  let plan = null;
  try {
    plan = readPlan();
  } catch (err) {
    logger.error({ err }, "delivery plan could not be read; every screen is offered");
  }
  held = { plan, rule: ruleFor() };
  return held;
}

/** Does this screen open where the API runs? */
function screenOpen(moduleKey, tab) {
  const { plan, rule } = state();
  if (rule === "all" || !plan) return true;
  const screen = plan.screens[contractPlan.planKey(moduleKey, tab)] || null;
  return contractPlan.screenOpens(screen, rule, "full", contractPlan.currentMilestone(plan, lagos.today()));
}

/** "praxis-ai" → "praxis_ai", the path's segment as a module key (route-map.moduleSlug the other way). */
const moduleKeyOf = (segment) => segment.replace(/-/g, "_");

/** The module and link answers, from the API's own screens (route-map SCREENS). */
const opens = () => contractPlan.opensFrom(screenOpen, (moduleKey) => routeMap.SCREENS[moduleKey], moduleKeyOf);

/** Does any of a module's screens open? */
const moduleOpen = (moduleKey) => opens().module(moduleKey);

/** Does the screen a link lands on open? A link outside the app's screens is never held back. */
const linkOpens = (href) => opens().link(href);

/** Does the screen a record type opens on (route-map ENTITY_ROUTES) open? A type with no screen is never held back. */
function typeOpens(entityType) {
  const route = routeMap.ENTITY_ROUTES[entityType];
  return !route || screenOpen(route.module, route.tab);
}

/** Every record type whose screen is not open: what Need You leaves out. */
const closedTypes = () => Object.keys(routeMap.ENTITY_ROUTES).filter((t) => !typeOpens(t));

/**
 * For a test: decide by this plan and rule ("production", "staging" or "all"), or, with
 * nothing, read them again as the API would.
 * @param {{plan: object|null, rule: "production"|"staging"|"all"}} [next]
 */
function use(next) {
  held = next ? { plan: next.plan, rule: next.rule } : null;
}

module.exports = { screenOpen, moduleOpen, linkOpens, typeOpens, closedTypes, ruleFor, use };
