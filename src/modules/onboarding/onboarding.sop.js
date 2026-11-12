"use strict";
/**
 * The SOPs an onboarding plan's steps point to (docs/guides/offers.md §3 step 8; M10's knowledge
 * base, docs/guides/knowledge.md). A step names an SOP by id; only an SOP still in force is taken,
 * and the step shows its number and title. There is no foreign key to `sop` (it is created in M10's
 * block, after M5's), so this is where the link is checked.
 */
const { AppError } = require("../../shared/errors");
const repo = require("./onboarding.repo");

/** sop_id → { sop_id, number, title } for the SOPs in force among those named (StepSop: no department). */
async function sopsById(db, ids) {
  return new Map((await repo.sops(db, ids)).map(({ department_id: _d, ...s }) => [s.sop_id, s]));
}

/**
 * Refuse a step whose SOP is not in force, or is another department's, naming the step. A
 * department's plan links its own department's SOPs; the company's default plan (no department) any.
 */
async function assertInForce(db, steps, departmentId = null) {
  const found = new Map((await repo.sops(db, steps.map((s) => s.sop_id))).map((s) => [s.sop_id, s]));
  steps.forEach((s, i) => {
    if (!s.sop_id) return;
    const sop = found.get(s.sop_id);
    if (!sop) throw new AppError("SOP_NOT_FOUND", "Pick an SOP in force", 422, { [`steps.${i}.sop_id`]: ["Pick an SOP in force"] });
    if (departmentId && sop.department_id !== departmentId)
      throw new AppError("SOP_OTHER_DEPARTMENT", "Pick this department's SOP", 422, { [`steps.${i}.sop_id`]: ["Another department's SOP"] });
  });
}

module.exports = { sopsById, assertInForce };
