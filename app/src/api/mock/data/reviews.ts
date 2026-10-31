/**
 * Performance · Reviews and ESS · My Performance on the in-browser mock, in the contract's shapes
 * (docs/guides/performance.md §3.3, §5; laptops and CI only, F12): October's round of the mock's
 * quarter with a review at every stage, Operations & People's own check-in open, and one improvement
 * plan. Every person and figure is invented; the shapes are the contract's.
 */
import type { ItemLine, MyReview, Pip, ReviewDetail, ReviewItem, ReviewTask, Round, ScorecardDetail, ScorecardLine } from "@mycity/contract/contract.gen.ts";
import { at, sid } from "../core";
import { byKey, managerOf, refKey } from "./people";
import { deptId, DEPT, PERIOD, ROUNDS, SCORECARDS } from "./performance";

export const ROUND = ROUNDS[0];

type Spec = { n: number; section: ItemLine["section"]; title: string; measure: ItemLine["measure"]; source: ItemLine["source"]; target: string | null; unit: string | null; weight: string };

/** The lines every mock scorecard here carries: a Results line, a KPI, the two Accountability lines. */
const SPECS: Spec[] = [
  { n: 0, section: "results", title: "Stories published", measure: "numeric", source: "own", target: "12", unit: null, weight: "60" },
  { n: 1, section: "kpis", title: "Assets delivered on time", measure: "standard", source: "function_kpi", target: "95", unit: "%", weight: "25" },
  { n: 2, section: "accountability", title: "On-time commitment delivery", measure: "standard", source: "commitments", target: "80", unit: "%", weight: "7.5" },
  { n: 3, section: "accountability", title: "Monthly update on time", measure: "binary", source: "update_on_time", target: null, unit: null, weight: "7.5" },
];

const lineOf = (key: string, s: Spec): ItemLine => ({
  employee_target_id: sid(`rv:line:${key}:${s.n}`),
  section: s.section,
  title: s.title,
  measure: s.measure,
  source: s.source,
  target_value: s.target,
  target_text: null,
  unit: s.unit,
  weight: s.weight,
});

/** One item: what the person entered and what the reviewer gave, as far as the review has come. */
function item(key: string, s: Spec, stage: number): ReviewItem {
  const auto = s.source !== "own";
  const checked = stage >= 1;
  const scored = stage >= 2;
  const proposed = auto ? (s.source === "commitments" ? null : s.source === "update_on_time" ? "1" : "1") : checked ? "0.42" : null;
  return {
    performance_review_item_id: sid(`rv:item:${key}:${s.n}`),
    employee_target_id: sid(`rv:line:${key}:${s.n}`),
    criterion: null,
    line: lineOf(key, s),
    actual_value: auto ? (s.source === "function_kpi" ? "96" : null) : checked ? "5" : null,
    actual_text: auto ? (s.source === "update_on_time" ? "On time" : null) : null,
    achieved_on: null,
    evidence_kind: !auto && checked ? "note" : null,
    evidence_entity_type: null,
    evidence_entity_id: null,
    evidence_document_id: null,
    evidence_url: null,
    evidence_note: !auto && checked ? "October monthly report" : null,
    evidence_link: null,
    action_text: !auto && checked ? "Two features move to November; both are drafted." : null,
    action_transcript: null,
    action_document_id: null,
    proposed_score: proposed,
    self_score: null,
    self_reason: null,
    score: scored ? proposed : null,
    override_reason: null,
    comment: null,
    assessable: auto || checked,
    auto,
  };
}

const TASKS = (key: string): ReviewTask[] => [
  { task_id: sid(`rv:task:${key}:1`), number: "TSK-0412", title: "Lagos launch story", status: "done", due_at: "2026-10-16T16:00:00.000Z", completed_at: "2026-10-15T14:00:00.000Z", employee_target_id: sid(`rv:line:${key}:0`), bucket: "done" },
  { task_id: sid(`rv:task:${key}:2`), number: "TSK-0431", title: "Abuja venues feature", status: "in_progress", due_at: "2026-10-30T16:00:00.000Z", completed_at: null, employee_target_id: null, bucket: "ongoing" },
  { task_id: sid(`rv:task:${key}:3`), number: "TSK-0450", title: "November city guide", status: "todo", due_at: "2026-11-13T16:00:00.000Z", completed_at: null, employee_target_id: null, bucket: "next_month" },
];

const STATUS: ReviewDetail["status"][] = ["check_in", "with_reviewer", "second_level", "with_hr", "closed"];
const STEP_KEYS = ["check_in", "reviewer", "second_level", "hr"] as const;

/** A review of a person in a round at one of the stages, 0 (checking in) to 4 (closed). */
export function reviewOf(key: string, stage: number, reviewerKey?: string, round: Round = ROUND): ReviewDetail {
  const seed = round === ROUND ? key : `${key}:${round.month}`;
  const person = byKey(key)!;
  const card = SCORECARDS.find((c) => c.employee.employee_id === person.employee_id && c.performance_period_id === round.performance_period_id);
  const reviewer = reviewerKey ? byKey(reviewerKey)! : managerOf(person)!;
  const second = managerOf(reviewer);
  const closed = stage === 4;
  const items = SPECS.map((s) => item(seed, s, stage));
  const status = STATUS[stage];
  return {
    performance_review_id: sid(`rv:review:${seed}`),
    performance_cycle_id: round.performance_cycle_id,
    round_name: round.name,
    month: round.month,
    scorecard_id: card?.scorecard_id ?? sid(`rv:card:${key}`),
    review_kind: "monthly",
    review_type: "manager",
    status,
    employee: refKey(key),
    reviewer: refKey(reviewer.user_key),
    check_in_submitted_at: stage >= 1 ? at(1, "10:00") : null,
    submitted_at: stage >= 2 ? at(1, "15:00") : null,
    closed_at: closed ? at(0, "11:00") : null,
    score_month: closed ? "0.6" : null,
    score_to_date: closed ? "0.6" : null,
    rating: closed ? "partly_meets" : null,
    due_on: [round.check_in_due_on, round.review_due_on, round.second_level_due_on, round.close_due_on, null][stage],
    waiting_on_me: false,
    dotted: null,
    second_level: stage >= 2 && second ? refKey(second.user_key) : null,
    dotted_input: null,
    dotted_input_at: null,
    conduct_breach: false,
    conduct_note: null,
    probation_outcome: null,
    returned_reason: null,
    no_check_in_at: null,
    no_check_in_reason: null,
    withdrawn_at: null,
    withdrawn_reason: null,
    document_id: closed ? sid(`rv:pdf:${seed}`) : null,
    workflow_instance_id: stage >= 2 ? sid(`rv:wf:${seed}`) : null,
    items,
    tasks: TASKS(seed),
    task_counts: { done: 1, ongoing: 1, next_month: 1 },
    actions: [],
    chain: STEP_KEYS.map((k, i) => ({
      key: k,
      state: closed || i < stage ? "done" : i === stage ? "current" : "waiting",
      person: k === "check_in" ? person.display_name : k === "reviewer" ? reviewer.display_name : k === "second_level" ? (second?.display_name ?? null) : "Operations & People",
      at: i < stage ? at(1, "10:00") : null,
    })),
    context: { on_time: 19, late: 2, absent: 0, recognitions: 1 },
    improvement_plan_id: null,
    can: { check_in: false, score: false, submit: false, return_check_in: false, ask_input: false, give_input: false, mark_conduct: false, decide_probation: false, decide: false, start_pip: false, score_without_check_in: false, withdraw: false },
  };
}

/** October's reviews: Operations & People's own still checking in, the rest at each stage after it. */
export const REVIEWS: ReviewDetail[] = [
  reviewOf("cynthia", 0, "ifeoma"),
  reviewOf("tobi", 0),
  reviewOf("adedotun", 1),
  reviewOf("zainab", 2),
  reviewOf("obinna", 3),
  reviewOf("funke", 4),
];

/** A plan from a review rated Below. */
export const PIPS: Pip[] = [
  {
    improvement_plan_id: sid("rv:pip:yusuf"),
    employee: refKey("yusuf"),
    performance_review_id: null,
    starts_on: "2026-10-05",
    ends_on: "2026-11-04",
    review_on: "2026-11-04",
    summary: "Turnaround on listing checks",
    status: "open",
    outcome_note: null,
    decided_at: null,
    lines: [{ improvement_plan_line_id: sid("rv:pip:yusuf:1"), employee_target_id: null, text: "Check every new listing within 2 days", target_text: "2 days", position: 0 }],
    created_at: at(17, "10:00"),
    updated_at: at(17, "10:00"),
  },
];

/** The scorecard behind Operations & People's own review, so My Performance shows it whole. */
const cynthiaLines: ScorecardLine[] = SPECS.map((s) => ({
  employee_target_id: sid(`rv:line:cynthia:${s.n}`),
  scorecard_id: sid("rv:card:cynthia"),
  section: s.section,
  position: s.n,
  title: s.title,
  measure: s.measure,
  direction: "higher",
  unit: s.unit,
  target_value: s.target,
  target_text: null,
  milestone_due_on: null,
  due_on: null,
  frequency_text: s.section === "results" ? null : "Monthly",
  weight: s.weight,
  source: s.source,
  okr_key_result_id: null,
  key_result: null,
  kpi_definition_id: null,
  kpi: null,
  team_key_results: [],
  share_value: null,
  months: [],
  score: null,
  can_change_target: false,
  pending_change: null,
}));

export const CYNTHIA_CARD: ScorecardDetail = {
  scorecard_id: sid("rv:card:cynthia"),
  performance_period_id: PERIOD.performance_period_id,
  period_name: PERIOD.name,
  employee: refKey("cynthia"),
  department_id: deptId,
  department: DEPT,
  status: "agreed",
  reviewer: refKey("ifeoma"),
  reviewer_role_code: null,
  reviewer_role: null,
  dotted: null,
  employee_agreed_at: at(20, "11:00"),
  reviewer_agreed_at: at(20, "15:00"),
  disagreed_at: null,
  score_to_date: null,
  rating: null,
  line_count: cynthiaLines.length,
  created_at: at(30, "09:00"),
  updated_at: at(20, "15:00"),
  scope_text: byKey("cynthia")?.job_title ?? null,
  reviewer_reason: null,
  disagree_reason: null,
  results_weight: 60,
  kpis_weight: 25,
  accountability_weight: 15,
  lines: cynthiaLines,
  weight_problems: [],
  contributions: [],
  can_edit: false,
  can_agree: false,
  can_send: false,
  amendment_instance_id: null,
};
if (!SCORECARDS.some((c) => c.scorecard_id === CYNTHIA_CARD.scorecard_id)) SCORECARDS.push(CYNTHIA_CARD);

/** A review as the caller's own list shows it. */
export const myReviewOf = (r: ReviewDetail): MyReview => {
  const closed = r.status === "closed";
  return {
    performance_review_id: r.performance_review_id,
    round_name: r.round_name,
    month: r.month,
    review_kind: r.review_kind,
    status: r.status,
    score_month: closed ? r.score_month : null,
    score_to_date: closed ? r.score_to_date : null,
    rating: closed ? r.rating : null,
    closed_at: r.closed_at,
    document_id: closed ? r.document_id : null,
  };
};
