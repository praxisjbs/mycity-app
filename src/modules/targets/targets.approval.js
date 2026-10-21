"use strict";
/**
 * A department's month on `performance.goal` (docs/guides/performance.md §3 step 5): the plan is
 * the record the approval is about, and its targets and KPIs follow its status. The route and
 * the outcome mapping are the goals module's (goals.approval.js); this file names the entity.
 */
const approval = require("../goals/goals.approval");

const ENTITY = "performance_plan";

const submit = (client, planId, actor) => approval.submit(client, { entity: { type: ENTITY, id: planId }, actor });

module.exports = {
  ENTITY,
  submit,
  decide: approval.decide,
  view: approval.view,
  statusFor: approval.statusFor,
};
