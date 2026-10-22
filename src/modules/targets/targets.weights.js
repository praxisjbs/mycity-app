"use strict";
/**
 * A scorecard's sections and the contribution check (docs/guides/performance.md §6.5). Pure.
 *
 *   sections      Results, KPIs and Accountability carry the scorecard's weights (60, 25, 15 by
 *                 default); the lines of each must fill its weight exactly before the plan is sent.
 *   measures      a Results line is numeric or a milestone; a KPI or Accountability line is a
 *                 standard or met-or-not.
 *   contribution  a key result split across named people (two or more lines with a share) reads OK
 *                 when the shares add up exactly to its target, else Rebalance with the difference.
 */
const { scoring } = require("@mycity/contract");

const MEASURES = Object.freeze({
  results: ["numeric", "milestone"],
  kpis: ["standard", "binary"],
  accountability: ["standard", "binary"],
});

/** A line's measure must suit its section; the problem, or null. */
function measureProblem(line) {
  return MEASURES[line.section].includes(line.measure)
    ? null
    : `A ${line.section === "results" ? "Results" : line.section === "kpis" ? "KPIs" : "Accountability"} line is ${MEASURES[line.section].join(" or ")}`;
}

/** The sections whose lines do not fill their weight. */
function weightProblems(card, lines) {
  return scoring.sectionWeightProblems(lines, {
    results: card.results_weight,
    kpis: card.kpis_weight,
    accountability: card.accountability_weight,
  });
}

/** Four decimal places, as quantities travel. */
const qty = (n) => String(Math.round(n * 10000) / 10000);

/** A split key result's shares against its target. */
function contribution(row) {
  const total = (row.shares || []).reduce((a, s) => a + (scoring.num(s.share_value) || 0), 0);
  const target = scoring.num(row.target_value);
  const difference = target === null ? 0 : target - total;
  return {
    okr_key_result_id: row.okr_key_result_id,
    code: row.code,
    statement: row.statement,
    target_value: row.target_value,
    unit: row.unit,
    shares: row.shares,
    total: qty(total),
    difference: qty(difference),
    status: target !== null && Math.abs(difference) < 0.00005 ? "ok" : "rebalance",
  };
}

/** The lines every scorecard starts with in Accountability (§6.10): they fill its 15. */
function accountabilityLines(manages, weight = 15) {
  const lines = [
    { title: "On-time commitment delivery", measure: "standard", source: "commitments", target_value: "80", unit: "%" },
    { title: "Monthly update on time", measure: "binary", source: "update_on_time", target_value: null, unit: null },
  ];
  if (manages)
    lines.push({ title: "Team scorecards and reviews", measure: "standard", source: "team_reviews", target_value: "100", unit: "%" });
  const each = Math.floor((weight / lines.length) * 100) / 100;
  return lines.map((l, i) => ({
    ...l,
    section: "accountability",
    direction: "higher",
    frequency_text: "Monthly",
    weight: String(i === 0 ? Math.round((weight - each * (lines.length - 1)) * 100) / 100 : each),
  }));
}

module.exports = { MEASURES, measureProblem, weightProblems, contribution, accountabilityLines };
