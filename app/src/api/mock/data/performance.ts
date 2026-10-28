/**
 * The Performance mock in the contract's shapes (docs/guides/performance.md §12, PR 1): one quarter,
 * the year's organisational goals, a function's OKRs and KPIs as MyCity's Q4 workbook lays them
 * out, its plan, and two scorecards with their lines, so PRs 2 to 5 build screens before their API lands. Every person
 * and figure is invented; the shapes are the contract's, so a screen built on this reads the API
 * unchanged.
 */
import type {
  Contribution,
  OrganisationalGoal,
  Kpi,
  KeyResult,
  KeyResultMonth,
  Objective,
  PerformancePeriod,
  Plan,
  Round,
  ScorecardDetail,
  ScorecardLine,
  TargetChange,
} from "@mycity/contract/contract.gen.ts";
import { at, sid } from "../core";
import { byKey, refKey } from "./people";

/** The quarter, carrying the code's default rules. */
export const PERIOD: PerformancePeriod = {
  performance_period_id: sid("perf:period:q4-2026"),
  name: "Q4 2026",
  starts_on: "2026-10-01",
  ends_on: "2026-12-31",
  plan_year_starts_on: "2026-01-01",
  live_from: "2026-10-22",
  status: "active",
  rules: {
    key_results: { dated_on_time: 1, dated_grace_days: 14, dated_late: 0.7, dated_partly: 0.3, band_good: 0.7, band_watch: 0.4 },
    lines: { milestone_on_time: 1, milestone_grace_business_days: 10, milestone_late: 0.5, standard_met: 1, standard_near: 0.5, standard_near_points: 5 },
    bands: { exceeds: 0.9, meets: 0.75, partly_meets: 0.5 },
    sections: { results: 60, kpis: 25, accountability: 15 },
    due_business_days: { check_in: 2, head_check_in: 3, commitments: 3, review: 5, second_level: 7, close: 10 },
  },
  months: ["2026-10-01", "2026-11-01", "2026-12-01"],
  created_at: at(30, "09:00"),
  updated_at: at(2, "09:00"),
};

/** The mock's Marketing & Sales department, laid out as the workbook lays out Branding & Marketing. */
export const DEPT = "Marketing & Sales";
export const deptId = sid(`dept:${DEPT}`);
const planId = sid("perf:plan:bm");
const head = refKey("ngozi");

const month = (kr: string, score: string | null, status: KeyResultMonth["status"], actual: string | null, update: string): KeyResultMonth => ({
  okr_key_result_month_id: sid(`perf:krm:${kr}:2026-10`),
  okr_key_result_id: sid(`perf:kr:${kr}`),
  month: "2026-10-01",
  status,
  actual_value: actual,
  actual_text: null,
  actual_source: "Monthly report",
  update_text: update,
  recovery_employee_id: null,
  recovery_due_on: null,
  proposed_score: score,
  confirmed_score: null,
  confirmed_at: null,
  score,
  band: score === null ? null : Number(score) >= 0.7 ? "good" : Number(score) >= 0.4 ? "watch" : "recovery",
  confirmed: false,
});

const kr = (
  code: string,
  objective: string,
  statement: string,
  target: string,
  unit: string,
  latest: KeyResultMonth | null,
  position: number,
): KeyResult => ({
  okr_key_result_id: sid(`perf:kr:${code}`),
  okr_objective_id: sid(`perf:obj:${objective}`),
  code,
  statement,
  kr_type: "outcome",
  measure: "numeric",
  direction: "higher",
  unit,
  baseline_text: null,
  target_value: target,
  target_text: null,
  parts: null,
  starts_on: "2026-10-01",
  finishes_on: "2026-12-31",
  accountable: head,
  co_accountable: null,
  accountable_note: null,
  scored_from_key_result_id: null,
  linked_company_key_results: [],
  position,
  latest,
});

/** The year's organisational goals, set by the CEO. */
export const ORG_GOALS: OrganisationalGoal[] = [
  ["ORG-2026-01", "Growth", "Reach 2 million active residents", "Monthly active users", "1.1M"],
  ["ORG-2026-02", "Revenue", "Partnership revenue of ₦180M", "Signed partnership value", "₦96M"],
  ["ORG-2026-03", "Expansion", "Operate in 12 Nigerian cities", "Cities live", "8"],
].map(([code, theme, title, measure, baseline]) => ({
  organisational_goal_id: sid(`perf:goal:${code}`),
  code,
  title,
  strategic_theme: theme,
  detail: null,
  success_measure: measure,
  reference_target: null,
  baseline,
  key_decisions: null,
  function_cascade: null,
  plan_year_starts_on: "2026-01-01",
  starts_on: "2026-01-01",
  ends_on: "2026-12-31",
  status: "active" as const,
  owner: refKey("ifeoma"),
  can_share: false,
  share: null,
  created_at: at(60, "09:00"),
  updated_at: at(60, "09:00"),
}));

/** The function's objectives and key results, with October reported. */
export const OBJECTIVES: Objective[] = [
  {
    okr_objective_id: sid("perf:obj:BM-O1"),
    performance_period_id: PERIOD.performance_period_id,
    performance_plan_id: planId,
    department_id: deptId,
    department: DEPT,
    code: "BM-O1",
    title: "Make MyCity the first app a resident opens for their city",
    organisational_goal_id: sid("perf:goal:ORG-2026-01"),
    position: 0,
    plan_status: "binding",
    score: "0.68",
    can_edit: false,
    can_share: false,
    share: null,
    key_results: [
      kr("BM-KR1.1", "BM-O1", "Grow monthly active users to 64,000", "64000", "users", month("BM-KR1.1", "0.6", "at_risk", "38400", "Campaign in two cities slipped a week."), 0),
      kr("BM-KR1.2", "BM-O1", "Publish 36 city stories across channels", "36", "stories", month("BM-KR1.2", "0.75", "on_track", "27", "On plan."), 1),
    ],
  },
  {
    okr_objective_id: sid("perf:obj:BM-O2"),
    performance_period_id: PERIOD.performance_period_id,
    performance_plan_id: planId,
    department_id: deptId,
    department: DEPT,
    code: "BM-O2",
    title: "Build a brand partners trust",
    organisational_goal_id: sid("perf:goal:ORG-2026-02"),
    position: 1,
    plan_status: "binding",
    can_edit: false,
    can_share: false,
    share: null,
    score: "0.9",
    key_results: [kr("BM-KR2.1", "BM-O2", "Secure 12 earned media features", "12", "features", month("BM-KR2.1", "0.9", "on_track", "11", "Two pending."), 0)],
  },
];

/** The function's KPIs, with October's actuals. */
export const KPIS: Kpi[] = [
  ["BM-K01", "Brand assets delivered on time", "95", "%", "met", "96"],
  ["BM-K02", "Social response within 24 hours", "90", "%", "not_met", "84"],
].map(([code, name, target, unit, result, actual]) => ({
  kpi_definition_id: sid(`perf:kpi:${code}`),
  code,
  name,
  description: null,
  department_id: deptId,
  department: DEPT,
  formula: null,
  unit,
  direction: "higher" as const,
  target_text: `${target}${unit}`,
  target_value: target,
  frequency: "monthly" as const,
  data_source: "Content calendar",
  starts_period_id: PERIOD.performance_period_id,
  active: true,
  latest: {
    kpi_month_id: sid(`perf:kpim:${code}:2026-10`),
    kpi_definition_id: sid(`perf:kpi:${code}`),
    month: "2026-10-01",
    result: result as "met" | "not_met",
    actual_value: actual,
    actual_text: null,
    comment: null,
    recorded_by: head,
    recorded_at: at(18, "10:00"),
  },
  created_at: at(30, "09:00"),
  updated_at: at(18, "10:00"),
}));

const line = (
  card: string,
  n: number,
  section: ScorecardLine["section"],
  title: string,
  weight: string,
  measure: ScorecardLine["measure"],
  source: ScorecardLine["source"],
  target: string | null,
  score: string | null,
  key?: { code: string; statement: string },
): ScorecardLine => ({
  employee_target_id: sid(`perf:line:${card}:${n}`),
  scorecard_id: sid(`perf:card:${card}`),
  section,
  position: n,
  title,
  measure,
  direction: "higher",
  unit: measure === "standard" ? "%" : null,
  target_value: target,
  target_text: target === null ? "Delivered and accepted" : null,
  milestone_due_on: measure === "milestone" ? "2026-11-30" : null,
  due_on: null,
  frequency_text: section === "results" ? null : "Monthly",
  weight,
  source,
  okr_key_result_id: key ? sid(`perf:kr:${key.code}`) : null,
  key_result: key ? { okr_key_result_id: sid(`perf:kr:${key.code}`), code: key.code, statement: key.statement } : null,
  kpi_definition_id: null,
  kpi: null,
  team_key_results: [],
  share_value: null,
  months: [{ month: "2026-10-01", score }],
  score,
  can_change_target: false,
  pending_change: null,
});

const card = (key: string, reviewer: string, lines: ScorecardLine[], score: string, rating: ScorecardDetail["rating"], agreed = true): ScorecardDetail => {
  const p = refKey(key);
  return {
    scorecard_id: sid(`perf:card:${key}`),
    performance_period_id: PERIOD.performance_period_id,
    period_name: PERIOD.name,
    employee: p,
    department_id: deptId,
    department: DEPT,
    status: agreed ? "agreed" : "binding",
    reviewer: refKey(reviewer),
    reviewer_role_code: null,
    reviewer_role: null,
    dotted: null,
    employee_agreed_at: agreed ? at(20, "11:00") : null,
    reviewer_agreed_at: agreed ? at(20, "15:00") : null,
    disagreed_at: null,
    score_to_date: score,
    rating,
    line_count: lines.length,
    created_at: at(30, "09:00"),
    updated_at: at(3, "09:00"),
    scope_text: byKey(key)?.job_title ?? null,
    reviewer_reason: null,
    disagree_reason: null,
    results_weight: 60,
    kpis_weight: 25,
    accountability_weight: 15,
    lines,
    weight_problems: [],
    contributions: [],
    can_edit: false,
    can_agree: false,
    can_send: false,
    amendment_instance_id: null,
  };
};

/** Two scorecards of the function's people: one agreed, one awaiting agreement. */
export const SCORECARDS: ScorecardDetail[] = [
  card(
    "adedotun",
    "ngozi",
    [
      line("adedotun", 0, "results", "Brand refresh delivered for the city launches", "30", "milestone", "own", null, null),
      line("adedotun", 1, "results", "Team result: users and stories", "30", "numeric", "team_result", "1", "0.68"),
      line("adedotun", 2, "kpis", "Brand assets delivered on time", "25", "standard", "function_kpi", "95", "1"),
      line("adedotun", 3, "accountability", "On-time commitment delivery", "10", "standard", "commitments", "80", "0.5"),
      line("adedotun", 4, "accountability", "Monthly update on time", "5", "binary", "update_on_time", null, "1"),
    ],
    "0.79",
    "meets",
  ),
  card(
    "tobi",
    "ngozi",
    [
      line("tobi", 0, "results", "Earned media features secured", "40", "numeric", "key_result", "4", "0.75", { code: "BM-KR2.1", statement: "Secure 12 earned media features" }),
      line("tobi", 1, "results", "Partner launch events held", "20", "numeric", "own", "3", "0.67"),
      line("tobi", 2, "kpis", "Social response within 24 hours", "25", "standard", "function_kpi", "90", "0"),
      line("tobi", 3, "accountability", "On-time commitment delivery", "10", "standard", "commitments", "80", "1"),
      line("tobi", 4, "accountability", "Monthly update on time", "5", "binary", "update_on_time", null, "1"),
    ],
    "0.62",
    "partly_meets",
    false,
  ),
];

/**
 * Grace joined after the function's plan bound: her manager drafted her scorecard and the head sent
 * it on its own (§11). It waits on Operations & People, then the CEO (FLOWS in modules/performance.ts).
 */
const graceLines = [
  line("grace", 0, "results", "Partner venues signed in Lekki", "60", "numeric", "own", "8", null),
  line("grace", 1, "kpis", "Partner replies within 48 hours", "25", "standard", "function_kpi", "90", null),
  line("grace", 2, "accountability", "On-time commitment delivery", "10", "standard", "commitments", "80", null),
  line("grace", 3, "accountability", "Monthly update on time", "5", "binary", "update_on_time", null, null),
].map((l) => ({ ...l, months: [], score: null }));
export const GRACE_CARD: ScorecardDetail = {
  ...card("grace", "bashir", graceLines, "0", null, false),
  status: "draft",
  score_to_date: null,
  rating: null,
  created_at: at(4, "09:00"),
  updated_at: at(2, "10:00"),
  amendment_instance_id: sid("perf:wf:amend:grace"),
};
SCORECARDS.push(GRACE_CARD);

/** The function's plan, binding; and Content's, sent and waiting on Operations & People. */
export const PLANS: Plan[] = [
  {
    performance_plan_id: planId,
    performance_period_id: PERIOD.performance_period_id,
    period_name: PERIOD.name,
    department_id: deptId,
    department: DEPT,
    status: "binding",
    workflow_instance_id: sid("perf:wf:plan:bm"),
    submitted_by: refKey("ngozi"),
    submitted_at: at(25, "10:00"),
    returned_reason: null,
    binding_at: at(21, "16:00"),
    objective_count: OBJECTIVES.length,
    scorecard_count: SCORECARDS.length,
    created_at: at(30, "09:00"),
    updated_at: at(21, "16:00"),
  },
  {
    performance_plan_id: sid("perf:plan:content"),
    performance_period_id: PERIOD.performance_period_id,
    period_name: PERIOD.name,
    department_id: sid("dept:Content"),
    department: "Content",
    status: "submitted",
    workflow_instance_id: sid("perf:wf:plan:content"),
    submitted_by: refKey("tolu"),
    submitted_at: at(1, "11:00"),
    returned_reason: null,
    binding_at: null,
    objective_count: 0,
    scorecard_count: 0,
    created_at: at(6, "09:00"),
    updated_at: at(1, "11:00"),
  },
];

/** Target changes asked for this quarter: one waiting on the CEO. */
const changed = OBJECTIVES.flatMap((o) => o.key_results).find((k) => k.target_value !== null);
export const TARGET_CHANGES: TargetChange[] = changed
  ? [
      {
        target_change_id: sid("perf:change:seed"),
        okr_key_result_id: changed.okr_key_result_id,
        employee_target_id: null,
        from_value: changed.target_value,
        from_text: changed.target_text,
        to_value: String(Math.round(Number(changed.target_value) * 0.8)),
        to_text: null,
        from_month: "2026-11-01",
        reason: "Two partner events moved to January",
        status: "pending",
        workflow_instance_id: sid("perf:wf:change:seed"),
        requested_by: refKey("ngozi"),
        decided_at: null,
        created_at: at(1, "15:30"),
      },
    ]
  : [];

/** No key result here is split between people, so the check has nothing to rebalance. */
export const CONTRIBUTIONS: Contribution[] = [];

/** October's round. */
export const ROUNDS: Round[] = [
  {
    performance_cycle_id: sid("perf:round:2026-10"),
    performance_period_id: PERIOD.performance_period_id,
    name: "October 2026",
    month: "2026-10-01",
    status: "open",
    check_in_due_on: "2026-11-03",
    head_check_in_due_on: "2026-11-04",
    review_due_on: "2026-11-06",
    second_level_due_on: "2026-11-10",
    close_due_on: "2026-11-13",
    closes_at: "2026-11-13T23:00:00.000Z",
    counts: { total: 2, check_in: 1, with_reviewer: 1, second_level: 0, with_hr: 0, closed: 0 },
  },
];
