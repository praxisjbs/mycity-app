"use strict";
/**
 * The SOPs an onboarding plan's steps point to (docs/guides/offers.md §3 step 8; M10's knowledge
 * base, docs/guides/knowledge.md). A step names an SOP by id; only an SOP still in force is taken,
 * and the step shows its number and title. There is no foreign key to `sop` (it is created in M10's
 * block, after M5's), so this is where the link is checked.
 */
const { AppError } = require("../../shared/errors");
const repo = require("./onboarding.repo");

/** sop_id → { sop_id, number, title } for the SOPs in force among those named. */
async function sopsById(db, ids) {
  return new Map((await repo.sops(db, ids)).map((s) => [s.sop_id, s]));
}

/** Refuse a step whose SOP is not in force, naming the step. */
async function assertInForce(db, steps) {
  const found = await sopsById(db, steps.map((s) => s.sop_id));
  steps.forEach((s, i) => {
    if (s.sop_id && !found.has(s.sop_id))
      throw new AppError("SOP_NOT_FOUND", "Pick an SOP in force", 422, { [`steps.${i}.sop_id`]: ["Pick an SOP in force"] });
  });
}

module.exports = { sopsById, assertInForce };
