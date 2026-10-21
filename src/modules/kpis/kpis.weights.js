"use strict";
/**
 * A person's KPI weights for a month (docs/guides/performance.md §6 Weights). Each is 1 to 100
 * (the contract's Weight); a draft may total anything, and the month is refused at submit
 * unless each person's total is exactly 100.00 (targets.service submitPlan).
 */
const { AppError } = require("../../shared/errors");
const { totalWeight } = require("./kpis.score");

const WHOLE = "100.00";

/** Does a person's set of KPIs total exactly 100.00? */
const isWhole = (kpis) => totalWeight(kpis) === WHOLE;

/** Refuse the same KPI named twice in one person's month. */
function assertDistinct(items) {
  const seen = new Set();
  items.forEach((item, i) => {
    const key = item.title.trim().toLowerCase();
    if (seen.has(key)) {
      throw new AppError("VALIDATION_FAILED", "Each KPI once", 422, { [`items.${i}.title`]: ["Already listed"] });
    }
    seen.add(key);
  });
}

module.exports = { WHOLE, isWhole, assertDistinct, totalWeight };
