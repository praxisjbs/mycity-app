"use strict";
/**
 * ⌘K for Performance · Goals (docs/guides/performance.md §9): a key result by its code, a former
 * code from the workbook's change map, or its statement; an objective by code or title; an
 * organisational goal by code, theme or title. What a reader finds is what they read on Goals
 * (docs/guides/performance.md §6.23): their department's, what is shared with them and the key results
 * they own, and the whole plan for the CEO and Management. A result opens on Performance · Goals
 * (shared/route-map.js).
 */
const { recordProvider } = require("../../shared/search/provider");
const visibility = require("./goals.visibility");

/** The reader's reach in the tree, worked out once for a search. */
const reach = (client, user) => visibility.readerOf(client, user);

module.exports = [
  recordProvider({
    type: "key_result",
    module: "performance",
    label: "Key Results",
    words: ["key result", "key results", "kr", "okr", "okrs", "target"],
    from: `okr_key_result kr
      JOIN okr_objective o ON o.okr_objective_id = kr.okr_objective_id
      JOIN performance_period p ON p.performance_period_id = o.performance_period_id`,
    key: "kr.okr_key_result_id",
    columns: [
      "kr.code",
      "kr.statement",
      `COALESCE((SELECT string_agg(a.alias_code::text, ' ') FROM okr_code_alias a
                  WHERE a.okr_key_result_id = kr.okr_key_result_id), '')`,
    ],
    select: "kr.okr_key_result_id AS id, kr.code::text AS ref, kr.statement AS title, p.name AS sub, NULL::text AS status",
    order: "p.starts_on DESC, kr.code",
    reach,
    readable: (r, params) => visibility.keyResultReadable(r, "kr", "o", params),
  }),
  recordProvider({
    type: "objective",
    module: "performance",
    label: "Objectives",
    words: ["objective", "objectives", "okr", "okrs"],
    from: `okr_objective o
      JOIN performance_period p ON p.performance_period_id = o.performance_period_id`,
    key: "o.okr_objective_id",
    columns: ["o.code", "o.title"],
    select: "o.okr_objective_id AS id, o.code::text AS ref, o.title AS title, p.name AS sub, NULL::text AS status",
    order: "p.starts_on DESC, o.code",
    reach,
    readable: (r, params) => visibility.objectiveReadable(r, "o", params),
  }),
  recordProvider({
    type: "organisational_goal",
    module: "performance",
    label: "Organisational Goals",
    words: ["goal", "goals", "organisational goal"],
    from: "organisational_goal g",
    key: "g.organisational_goal_id",
    columns: ["COALESCE(g.code::text, '')", "COALESCE(g.strategic_theme, '')", "g.title"],
    select: "g.organisational_goal_id AS id, g.code::text AS ref, g.title AS title, g.strategic_theme AS sub, g.status AS status",
    where: "g.level = 'organisation'",
    order: "g.ends_on DESC, g.code",
    reach,
    readable: (r, params) => visibility.goalReadable(r, "g", params),
  }),
];
