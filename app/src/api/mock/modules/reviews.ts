/**
 * Performance · Reviews and ESS · My Performance on the in-browser mock (docs/guides/performance.md
 * §5, §6.12, §8; laptops and CI only, F12): rounds, reviews, the check-in, the reviewer's scores,
 * the chain's decisions, conduct, probation, Tidy and improvement plans, on ../data/reviews.ts.
 *
 * Who sees what follows reviews.sequence.js: the reviewer is answered 409 CHECK_IN_FIRST until the
 * check-in is in, and the employee sees the reviewer's scores only once the review is closed.
 */
import scoring from "@mycity/contract/schemas/scoring.js";
import type { ApprovalWaiting, MyPerformance, Pip, ReviewCheckIn, ReviewDetail, ReviewItem, Round } from "@mycity/contract/contract.gen.ts";
import { fail, invalid, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, managerOf, refKey, SIGN_INS, teamOf } from "../data/people";
import { PERIOD, ROUNDS, SCORECARDS } from "../data/performance";
import { myReviewOf, PIPS, REVIEWS, reviewOf } from "../data/reviews";

const now = () => new Date().toISOString();
const meOf = (user: string | null) => byKey(user);
/** Operations & People and the CEO read every review and run the cycle (§8); the HR stage is Operations & People's alone. */
const isHr = (user: string | null) => SIGN_INS[user ?? ""]?.view === "operations" || SIGN_INS[user ?? ""]?.view === "ceo";
const isOperations = (user: string | null) => SIGN_INS[user ?? ""]?.view === "operations";
const WITH_REVIEWER = ["with_reviewer", "returned"];

function rolesOf(r: ReviewDetail, user: string | null) {
  const me = meOf(user);
  const employee = r.employee.employee_id === me?.employee_id;
  const reviewer = r.reviewer.employee_id === me?.employee_id;
  const dotted = Boolean(me) && r.dotted?.employee_id === me?.employee_id;
  const second = Boolean(me) && r.second_level?.employee_id === me?.employee_id;
  const hr = isHr(user);
  const full = !employee && (second || hr);
  // Operations & People's own review is closed by the CEO (guide §11): the reviewee never decides it.
  const hrStage = isOperations(user) || (SIGN_INS[user ?? ""]?.view === "ceo" && isOperations(byId(r.employee.employee_id)?.user_key ?? null));
  const inScope = Boolean(me) && teamOf(me!.user_key).some((p) => p.employee_id === r.employee.employee_id);
  return { employee, reviewer, dotted, second, hr, hrStage, full, inScope, named: employee || reviewer || dotted || second || full };
}

/** May the reader decide the review's stage in its approval now? */
const mayDecide = (r: ReviewDetail, roles: ReturnType<typeof rolesOf>) =>
  !roles.employee && ((r.status === "second_level" && roles.second) || (r.status === "with_hr" && roles.hrStage));

const waitingOnMe = (r: ReviewDetail, user: string | null) => {
  const roles = rolesOf(r, user);
  return (roles.reviewer && WITH_REVIEWER.includes(r.status)) || mayDecide(r, roles) || (roles.dotted && !r.dotted_input && WITH_REVIEWER.includes(r.status));
};

/** The review as the reader is sent it: what they may not see arrives as null (reviews.sequence.js). */
function view(r: ReviewDetail, user: string | null): ReviewDetail {
  const roles = rolesOf(r, user);
  const closed = r.status === "closed";
  const submitted = Boolean(r.check_in_submitted_at) || r.status !== "check_in";
  const team = roles.reviewer || roles.full;
  const parts = {
    check_in: roles.employee || (submitted && (team || roles.dotted)),
    scores: team || (closed && (roles.employee || roles.inScope)),
    notes: team || (closed && roles.employee),
    input: team || roles.dotted || (closed && roles.employee),
  };
  const item = (i: ReviewItem): ReviewItem => ({
    ...i,
    ...(parts.check_in
      ? {}
      : { actual_value: null, actual_text: null, achieved_on: null, evidence_kind: null, evidence_entity_type: null, evidence_entity_id: null, evidence_document_id: null, evidence_url: null, evidence_note: null, evidence_link: null, action_text: null, action_transcript: null, action_document_id: null, self_reason: null, ...(parts.scores ? {} : { proposed_score: null, self_score: null }) }),
    ...(parts.scores ? {} : { score: null }),
    ...(parts.notes ? {} : { override_reason: null, comment: null }),
  });
  const scoring_ = roles.reviewer && WITH_REVIEWER.includes(r.status);
  return {
    ...r,
    items: r.items.map(item),
    dotted_input: parts.input ? r.dotted_input : null,
    conduct_note: parts.notes ? r.conduct_note : null,
    score_month: parts.scores ? r.score_month : null,
    score_to_date: parts.scores ? r.score_to_date : null,
    rating: parts.scores ? r.rating : null,
    actions: parts.notes ? r.actions : [],
    context: team ? r.context : null,
    waiting_on_me: waitingOnMe(r, user),
    can: {
      check_in: roles.employee && r.status === "check_in",
      score: scoring_,
      submit: scoring_,
      return_check_in: scoring_,
      ask_input: scoring_ && Boolean(r.dotted) && !r.dotted_input,
      give_input: roles.dotted && Boolean(r.check_in_submitted_at) && WITH_REVIEWER.includes(r.status),
      mark_conduct: roles.hr && !roles.employee && r.status !== "check_in",
      decide_probation: roles.hrStage && !roles.employee && r.review_kind === "probation" && r.status === "with_hr",
      decide: mayDecide(r, roles),
      start_pip: roles.hr && !roles.employee && closed && r.rating === "below" && !PIPS.some((p) => p.performance_review_id === r.performance_review_id),
    },
  };
}

/** A review as a list row carries it. */
const rowOf = (d: ReviewDetail) => ({
  performance_review_id: d.performance_review_id,
  performance_cycle_id: d.performance_cycle_id,
  round_name: d.round_name,
  month: d.month,
  scorecard_id: d.scorecard_id,
  review_kind: d.review_kind,
  review_type: d.review_type,
  status: d.status,
  employee: d.employee,
  reviewer: d.reviewer,
  check_in_submitted_at: d.check_in_submitted_at,
  submitted_at: d.submitted_at,
  closed_at: d.closed_at,
  score_month: d.score_month,
  score_to_date: d.score_to_date,
  rating: d.rating,
  due_on: d.due_on,
  waiting_on_me: d.waiting_on_me,
});

/** Load a review the reader may read, or the answer that refuses them. */
function readable(req: Req): { r: ReviewDetail } | { refused: ReturnType<typeof fail> } {
  const r = REVIEWS.find((x) => x.performance_review_id === req.params.id);
  if (!r) return { refused: notFound() };
  const roles = rolesOf(r, req.user);
  if (!roles.named && !roles.inScope) return { refused: notFound() };
  if (roles.reviewer && !roles.employee && r.status === "check_in") return { refused: fail(409, "CHECK_IN_FIRST", "Waiting for the check-in") };
  return { r };
}

const roundOf = (r: ReviewDetail) => ROUNDS.find((x) => x.performance_cycle_id === r.performance_cycle_id) ?? ROUNDS[0];
const dueFor = (r: ReviewDetail): string | null => {
  const round = roundOf(r);
  const at: Record<string, string | null> = { check_in: round.check_in_due_on, with_reviewer: round.review_due_on, returned: round.review_due_on, second_level: round.second_level_due_on, with_hr: round.close_due_on, closed: null };
  return at[r.status] ?? null;
};
/** The chain as the review shows it, from where it stands. */
function chainOf(r: ReviewDetail): ReviewDetail["chain"] {
  const order = ["check_in", "reviewer", "second_level", "hr"] as const;
  const at: Record<string, number> = { check_in: 0, with_reviewer: 1, returned: 1, second_level: 2, with_hr: 3, closed: 4 };
  const stage = at[r.status];
  return order.map((key, i) => {
    const was = r.chain.find((s) => s.key === key);
    const skipped = key === "second_level" && !r.second_level && stage > 1;
    return {
      key,
      state: skipped ? "skipped" : i < stage ? "done" : i === stage ? "current" : "waiting",
      person: key === "check_in" ? r.employee.display_name : key === "reviewer" ? r.reviewer.display_name : key === "second_level" ? (r.second_level?.display_name ?? null) : "Operations & People",
      at: i < stage && !skipped ? (was?.at ?? now()) : null,
    };
  });
}
const moved = (r: ReviewDetail, status: ReviewDetail["status"]) => {
  r.status = status;
  r.due_on = dueFor(r);
  r.chain = chainOf(r);
};

const ratingOf = (score: string, breach: boolean) => scoring.rating(Number(score), { conduct_breach: breach }) as ReviewDetail["rating"];
/** The scores of a closing review: each line weighted, capped by a conduct breach (§6.9, §6.15). */
function close(r: ReviewDetail) {
  const lines = r.items.filter((i) => i.line).map((i) => ({ weight: i.line!.weight, score: i.score }));
  const total = scoring.scoreToDate(lines);
  const s = total === null ? null : scoring.formatScore(total);
  r.score_month = s;
  r.score_to_date = s;
  r.rating = s === null ? null : ratingOf(s, r.conduct_breach);
  r.closed_at = now();
  r.document_id = sid(`rv:pdf:${r.performance_review_id}`);
  moved(r, "closed");
  const card = SCORECARDS.find((c) => c.scorecard_id === r.scorecard_id);
  if (card) Object.assign(card, { score_to_date: s, rating: r.rating });
}

/* Rounds */

const countsOf = (round: Round, user: string | null): Round["counts"] => {
  const mine = REVIEWS.filter((r) => r.performance_cycle_id === round.performance_cycle_id).filter((r) => {
    const roles = rolesOf(r, user);
    return roles.named || roles.inScope;
  });
  const n = (s: string[]) => mine.filter((r) => s.includes(r.status)).length;
  return { total: mine.length, check_in: n(["check_in"]), with_reviewer: n(WITH_REVIEWER), second_level: n(["second_level"]), with_hr: n(["with_hr"]), closed: n(["closed"]) };
};
route("GET /api/v1/performance/rounds", (req) =>
  paged(
    ROUNDS.map((r) => ({ ...r, counts: countsOf(r, req.user) })),
    req,
    { filters: { period_id: (r, v) => r.performance_period_id === v, status: (r, v) => r.status === v }, sort: { month: (a, b) => a.month.localeCompare(b.month) } },
  ),
);

const monthName = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** The nth business day after a date, Monday to Friday (§6.2; the mock keeps no holidays). */
function businessDay(from: string, n: number) {
  const d = new Date(`${from}T00:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}
route("POST /api/v1/performance/rounds", (req) => {
  if (!isHr(req.user)) return fail(403, "PERMISSION_DENIED", "Operations & People open rounds");
  const b = req.body as { performance_period_id?: string; month?: string };
  if (b.performance_period_id !== PERIOD.performance_period_id) return invalid({ performance_period_id: ["Pick a quarter"] });
  if (!b.month || !PERIOD.months.includes(b.month)) return invalid({ month: ["Not this quarter's"] });
  const next = new Date(`${b.month}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const after = next.toISOString().slice(0, 10);
  if (after > now().slice(0, 10)) return invalid({ month: ["Not ended yet"] });
  if (ROUNDS.some((r) => r.month === b.month)) return fail(409, "ROUND_EXISTS", "That month's round is open", { month: ["Already open"] });
  const opens = businessDay(new Date(Date.parse(`${after}T00:00:00Z`) - 86400000).toISOString().slice(0, 10), 1);
  const round: Round = {
    performance_cycle_id: sid(`perf:round:${b.month}`),
    performance_period_id: PERIOD.performance_period_id,
    name: monthName(b.month),
    month: b.month,
    status: "open",
    check_in_due_on: businessDay(opens, 1),
    head_check_in_due_on: businessDay(opens, 2),
    review_due_on: businessDay(opens, 4),
    second_level_due_on: businessDay(opens, 6),
    close_due_on: businessDay(opens, 9),
    closes_at: `${businessDay(opens, 9)}T23:00:00.000Z`,
    counts: { total: 0, check_in: 0, with_reviewer: 0, second_level: 0, with_hr: 0, closed: 0 },
  };
  ROUNDS.push(round);
  for (const c of SCORECARDS.filter((x) => x.performance_period_id === PERIOD.performance_period_id && (x.status === "binding" || x.status === "agreed"))) {
    const key = byId(c.employee.employee_id)?.user_key;
    if (key) REVIEWS.push(reviewOf(key, 0, c.reviewer ? byId(c.reviewer.employee_id)?.user_key : undefined, round));
  }
  return ok({ ...round, counts: countsOf(round, req.user) });
});
route("POST /api/v1/performance/rounds/:id/close", (req) => {
  if (!isHr(req.user)) return fail(403, "PERMISSION_DENIED", "Operations & People close rounds");
  const round = ROUNDS.find((r) => r.performance_cycle_id === req.params.id);
  if (!round) return notFound();
  round.status = "closed";
  return ok({ ...round, counts: countsOf(round, req.user) });
});

/* Reviews */

route("GET /api/v1/performance/reviews", (req) => {
  const rows = REVIEWS.filter((r) => {
    const roles = rolesOf(r, req.user);
    return roles.named || roles.inScope;
  }).map((r) => rowOf(view(r, req.user)));
  return paged(rows, req, {
    search: (r) => [r.employee.display_name, r.reviewer.display_name],
    filters: {
      round_id: (r, v) => r.performance_cycle_id === v,
      status: (r, v) => (v === "with_reviewer" ? WITH_REVIEWER.includes(r.status) : r.status === v),
      kind: (r, v) => r.review_kind === v,
      department_id: (r, v) => sid(`dept:${byId(r.employee.employee_id)?.department}`) === v,
      waiting_on_me: (r, v) => String(r.waiting_on_me) === v,
    },
    sort: {
      employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
      status: (a, b) => a.status.localeCompare(b.status),
      due_on: (a, b) => (a.due_on ?? "9").localeCompare(b.due_on ?? "9"),
    },
  });
});
route("GET /api/v1/performance/reviews/:id", (req) => {
  const got = readable(req);
  return "refused" in got ? got.refused : ok(view(got.r, req.user));
});

/** Load a review for its reviewer to act on; refuse anyone else and the wrong stage. */
function forReviewer(req: Req): { r: ReviewDetail } | { refused: ReturnType<typeof fail> } {
  const got = readable(req);
  if ("refused" in got) return got;
  if (!rolesOf(got.r, req.user).reviewer) return { refused: fail(403, "PERMISSION_DENIED", "Only the reviewer can do that") };
  if (!WITH_REVIEWER.includes(got.r.status)) return { refused: fail(409, "REVIEW_NOT_WITH_REVIEWER", "This review is not with its reviewer") };
  return got;
}

/** A line missed this month: under 1, and for a numeric line only in the quarter's last month (§6.16). */
const missed = (i: ReviewItem, r: ReviewDetail) =>
  i.score !== null && Number(i.score) < 1 && Boolean(i.line) && (i.line!.measure !== "numeric" || r.month === PERIOD.months[PERIOD.months.length - 1]);

route("PUT /api/v1/performance/reviews/:id/scores", (req) => {
  const got = forReviewer(req);
  if ("refused" in got) return got.refused;
  const r = got.r;
  const b = req.body as { items?: Array<{ performance_review_item_id: string; score: string | null; override_reason?: string | null; comment?: string | null }>; actions?: Array<{ performance_review_item_id: string; title: string; owner_employee_id: string; due_on: string }> };
  const problems: Record<string, string[]> = {};
  for (const [n, s] of (b.items ?? []).entries()) {
    const i = r.items.find((x) => x.performance_review_item_id === s.performance_review_item_id);
    if (!i) return invalid({ [`items.${n}.performance_review_item_id`]: ["Not this review's"] });
    const differs = s.score !== null && (i.proposed_score === null || Number(s.score) !== Number(i.proposed_score));
    if (differs && !s.override_reason?.trim()) problems[`items.${n}.override_reason`] = ["Give a reason"];
    Object.assign(i, { score: s.score, override_reason: s.override_reason?.trim() || null, comment: s.comment?.trim() || null });
  }
  for (const [n, a] of (b.actions ?? []).entries()) {
    if (!r.items.some((x) => x.performance_review_item_id === a.performance_review_item_id)) return invalid({ [`actions.${n}.performance_review_item_id`]: ["Not this review's"] });
    if (!a.title?.trim()) problems[`actions.${n}.title`] = ["Required"];
    if (!a.due_on) problems[`actions.${n}.due_on`] = ["Pick a date"];
  }
  if (Object.keys(problems).length) return invalid(problems);
  const kept = new Map(r.actions.filter((a) => a.task_id).map((a) => [a.performance_review_item_id, a]));
  r.actions = (b.actions ?? []).map((a) => kept.get(a.performance_review_item_id) ?? { performance_review_item_id: a.performance_review_item_id, title: a.title.trim(), owner: refKey(byId(a.owner_employee_id)?.user_key ?? r.employee.employee_id), due_on: a.due_on, task_id: null, task_number: null, task_status: null });
  return ok(view(r, req.user));
});

let taskSeq = 510;
route("POST /api/v1/performance/reviews/:id/submit", (req) => {
  const got = forReviewer(req);
  if ("refused" in got) return got.refused;
  const r = got.r;
  const problems: Record<string, string[]> = {};
  for (const [n, i] of r.items.entries()) {
    const blank = i.auto && i.proposed_score === null;
    if (i.assessable && !blank && i.score === null) problems[`items.${n}.score`] = ["Give a score"];
  }
  if (Object.keys(problems).length) return fail(422, "SCORES_MISSING", "Score every line first", problems);
  const missing = r.items.filter((i) => missed(i, r) && !r.actions.some((a) => a.performance_review_item_id === i.performance_review_item_id));
  if (missing.length) return fail(422, "CORRECTIVE_ACTION_REQUIRED", "Add a corrective action to each missed line", Object.fromEntries(missing.map((i) => [`actions.${r.items.indexOf(i)}`, ["Add an action"]])));
  for (const a of r.actions) if (!a.task_id) Object.assign(a, { task_id: sid(`rv:task:action:${a.performance_review_item_id}`), task_number: `TSK-0${(taskSeq += 1)}`, task_status: "todo" });
  const reviewer = byId(r.reviewer.employee_id);
  const second = reviewer && reviewer.user_key !== "ifeoma" ? managerOf(reviewer) : undefined;
  r.second_level = second && second.employee_id !== r.employee.employee_id ? refKey(second.user_key) : null;
  r.submitted_at = now();
  r.returned_reason = null;
  r.workflow_instance_id = sid(`rv:wf:${r.performance_review_id}:${r.submitted_at}`);
  moved(r, r.second_level ? "second_level" : "with_hr");
  return ok(view(r, req.user));
});
route("POST /api/v1/performance/reviews/:id/return", (req) => {
  const got = forReviewer(req);
  if ("refused" in got) return got.refused;
  const reason = String((req.body as { returned_reason?: string }).returned_reason ?? "").trim();
  if (!reason) return invalid({ returned_reason: ["Required"] });
  const r = got.r;
  Object.assign(r, { returned_reason: reason, check_in_submitted_at: null });
  moved(r, "check_in");
  return ok(rowOf(view(r, req.user)));
});
route("POST /api/v1/performance/reviews/:id/ask-input", (req) => {
  const got = forReviewer(req);
  if ("refused" in got) return got.refused;
  if (!got.r.dotted) return fail(409, "NO_DOTTED_MANAGER", "Nobody gives input to this review");
  if (got.r.dotted_input) return fail(409, "INPUT_GIVEN", "Input is already given");
  return ok(view(got.r, req.user));
});
route("POST /api/v1/performance/reviews/:id/input", (req) => {
  const got = readable(req);
  if ("refused" in got) return got.refused;
  if (!view(got.r, req.user).can.give_input) return fail(403, "PERMISSION_DENIED", "Only the dotted-line manager gives input now");
  const text = String((req.body as { dotted_input?: string }).dotted_input ?? "").trim();
  if (!text) return invalid({ dotted_input: ["Required"] });
  Object.assign(got.r, { dotted_input: text, dotted_input_at: now() });
  return ok(view(got.r, req.user));
});
route("POST /api/v1/performance/reviews/:id/conduct", (req) => {
  const got = readable(req);
  if ("refused" in got) return got.refused;
  if (!view(got.r, req.user).can.mark_conduct) return fail(403, "PERMISSION_DENIED", "Operations & People mark conduct");
  const b = req.body as { conduct_breach?: boolean; conduct_note?: string };
  if (!b.conduct_note?.trim()) return invalid({ conduct_note: ["Required"] });
  const r = got.r;
  Object.assign(r, { conduct_breach: Boolean(b.conduct_breach), conduct_note: b.conduct_note.trim() });
  if (r.status === "closed" && r.score_to_date !== null) r.rating = ratingOf(r.score_to_date, r.conduct_breach);
  return ok(view(r, req.user));
});
route("POST /api/v1/performance/reviews/:id/probation-outcome", (req) => {
  const got = readable(req);
  if ("refused" in got) return got.refused;
  const r = got.r;
  if (!isOperations(req.user) || rolesOf(r, req.user).employee) return fail(403, "PERMISSION_DENIED", "Operations & People decide probation");
  if (r.review_kind !== "probation" || r.status !== "with_hr") return fail(409, "REVIEW_NOT_WITH_HR", "Choose the outcome when the review is with Operations & People");
  const b = req.body as { probation_outcome?: ReviewDetail["probation_outcome"] };
  if (!b.probation_outcome) return invalid({ probation_outcome: ["Pick an outcome"] });
  r.probation_outcome = b.probation_outcome;
  return ok(view(r, req.user));
});

/** Tidy With AI: spelling, punctuation and filler only; the facts and figures stay (§6.17). */
const tidy = (text: string) =>
  text
    .replace(/\b(um+|uh+|erm|you know|like,)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_, a: string, c: string) => a + c.toUpperCase())
    .replace(/([^.!?])$/, "$1.");
route("POST /api/v1/performance/tidy", (req) => {
  const b = req.body as { kind?: string; text?: string };
  if (b.kind === "week") return invalid({ kind: ["Use My Week's tidy"] });
  const original = String(b.text ?? "");
  if (!original.trim()) return invalid({ text: ["Required"] });
  return ok({ available: true, original, tidied: tidy(original), ai_run_id: sid(`rv:tidy:${original}`) });
});

/* The approval's decisions on a review (POST /workflow/instances/:id/approve and /reject). */

/** Decide a review's stage, or null when the instance is not a review's (the workflow mock passes it on). */
export function decideReview(user: string, wid: string, approve: boolean, reason?: string | null) {
  const r = REVIEWS.find((x) => x.workflow_instance_id === wid && (x.status === "second_level" || x.status === "with_hr"));
  if (!r) return null;
  const roles = rolesOf(r, user);
  if (!mayDecide(r, roles)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  if (!approve) {
    if (!String(reason ?? "").trim()) return invalid({ reason: ["is required"] });
    r.returned_reason = String(reason).trim();
    moved(r, "returned");
    return ok({ workflow_instance_id: wid, state: "rejected", stage_name: null });
  }
  if (r.status === "second_level") {
    moved(r, "with_hr");
    return ok({ workflow_instance_id: wid, state: "pending", stage_name: "Operations & People" });
  }
  if (r.review_kind === "probation" && !r.probation_outcome) return fail(409, "PROBATION_OUTCOME_FIRST", "Choose the probation outcome first");
  close(r);
  return ok({ workflow_instance_id: wid, state: "approved", stage_name: null });
}

/** The reviews whose stage waits on this login, for GET /workflow/mine (Home's Need You). */
export function reviewsWaitingOn(user: string): ApprovalWaiting[] {
  return REVIEWS.filter((r) => r.workflow_instance_id && mayDecide(r, rolesOf(r, user))).map((r) => {
    const entered = r.submitted_at ?? r.check_in_submitted_at ?? now();
    const due = `${dueFor(r) ?? entered.slice(0, 10)}T16:00:00.000Z`;
    return {
      workflow_instance_id: r.workflow_instance_id!,
      definition_key: "performance.review",
      definition_name: "Performance Review",
      module_key: "performance",
      entity_type: "performance_review",
      entity_id: r.performance_review_id,
      subject_employee_id: r.employee.employee_id,
      subject_name: r.employee.display_name,
      current_stage: r.status === "second_level" ? "second_level" : "operations_people",
      stage_name: r.status === "second_level" ? "Second Level" : "Operations & People",
      context: {},
      stage_entered_at: entered,
      stage_due_at: due,
      overdue: Date.parse(due) < Date.now(),
      opened_by: null,
      opened_by_name: r.reviewer.display_name,
      opened_at: entered,
      link: `/performance?tab=reviews&id=${r.performance_review_id}`,
    };
  });
}

/* Improvement plans */

const pipOk = (req: Req) => (isHr(req.user) ? null : fail(403, "PERMISSION_DENIED", "Operations & People run improvement plans"));
route("GET /api/v1/performance/pips", (req) => {
  const me = meOf(req.user);
  const rows = PIPS.filter((p) => isHr(req.user) || p.employee.employee_id === me?.employee_id || (me && teamOf(me.user_key).some((x) => x.employee_id === p.employee.employee_id)));
  return paged(rows, req, {
    search: (p) => [p.employee.display_name, p.summary],
    filters: { status: (p, v) => p.status === v, employee_id: (p, v) => p.employee.employee_id === v },
    sort: { review_on: (a, b) => a.review_on.localeCompare(b.review_on), created_at: (a, b) => b.created_at.localeCompare(a.created_at) },
  });
});
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
type PipLineIn = { employee_target_id?: string; text?: string; target_text?: string };
const linesOf = (id: string, lines: PipLineIn[]): Pip["lines"] =>
  lines.map((l, i) => ({ improvement_plan_line_id: sid(`${id}:line:${i}:${l.text}`), employee_target_id: l.employee_target_id || null, text: String(l.text ?? "").trim(), target_text: l.target_text?.trim() || null, position: i }));
const lineProblems = (lines: PipLineIn[] | undefined) =>
  !lines?.length ? { lines: ["Add a line"] } : Object.fromEntries(lines.flatMap((l, i) => (String(l.text ?? "").trim() ? [] : [[`lines.${i}.text`, ["Required"]]])));
route("POST /api/v1/performance/pips", (req) => {
  const refused = pipOk(req);
  if (refused) return refused;
  const b = req.body as { performance_review_id?: string; starts_on?: string; ends_on?: string; review_on?: string; summary?: string; lines?: PipLineIn[] };
  const r = REVIEWS.find((x) => x.performance_review_id === b.performance_review_id);
  if (!r || r.status !== "closed" || r.rating !== "below") return fail(409, "PIP_NEEDS_BELOW", "A plan starts from a closed review rated Below");
  if (PIPS.some((p) => p.employee.employee_id === r.employee.employee_id && p.status === "open")) return fail(409, "PIP_OPEN", "This person already has an open plan");
  const problems = { ...(b.starts_on ? {} : { starts_on: ["Pick a date"] }), ...lineProblems(b.lines) };
  if (Object.keys(problems).length) return invalid(problems);
  const id = sid(`rv:pip:${r.performance_review_id}`);
  const ends = b.ends_on || addDays(b.starts_on!, 30);
  const pip: Pip = { improvement_plan_id: id, employee: r.employee, performance_review_id: r.performance_review_id, starts_on: b.starts_on!, ends_on: ends, review_on: b.review_on || ends, summary: b.summary?.trim() || null, status: "open", outcome_note: null, decided_at: null, lines: linesOf(id, b.lines!), created_at: now(), updated_at: now() };
  PIPS.unshift(pip);
  r.improvement_plan_id = id;
  return ok(pip);
});
route("PATCH /api/v1/performance/pips/:id", (req) => {
  const refused = pipOk(req);
  if (refused) return refused;
  const p = PIPS.find((x) => x.improvement_plan_id === req.params.id);
  if (!p) return notFound();
  if (p.status !== "open" && p.status !== "extended") return fail(409, "PIP_CLOSED", "This plan is closed");
  const b = req.body as { ends_on?: string; review_on?: string; summary?: string | null; lines?: PipLineIn[] };
  if (b.lines) {
    const problems = lineProblems(b.lines);
    if (Object.keys(problems).length) return invalid(problems);
    p.lines = linesOf(p.improvement_plan_id, b.lines);
  }
  Object.assign(p, { ...(b.ends_on ? { ends_on: b.ends_on } : {}), ...(b.review_on ? { review_on: b.review_on } : {}), ...("summary" in b ? { summary: b.summary?.trim() || null } : {}), updated_at: now() });
  return ok(p);
});
route("POST /api/v1/performance/pips/:id/close", (req) => {
  const refused = pipOk(req);
  if (refused) return refused;
  const p = PIPS.find((x) => x.improvement_plan_id === req.params.id);
  if (!p) return notFound();
  const b = req.body as { status?: Pip["status"]; outcome_note?: string; ends_on?: string; review_on?: string };
  if (!b.outcome_note?.trim()) return invalid({ outcome_note: ["Required"] });
  if (b.status === "extended" && !(b.ends_on && b.review_on)) return invalid({ ends_on: ["Give the new dates"] });
  Object.assign(p, { status: b.status, outcome_note: b.outcome_note.trim(), decided_at: now(), updated_at: now(), ...(b.status === "extended" ? { ends_on: b.ends_on, review_on: b.review_on } : {}) });
  return ok(p);
});

/* ESS · My Performance */

const openOf = (user: string | null) => {
  const me = meOf(user);
  return REVIEWS.filter((r) => r.employee.employee_id === me?.employee_id && r.status !== "closed").sort((a, b) => Number(b.status === "check_in") - Number(a.status === "check_in"))[0];
};
const checkInOf = (r: ReviewDetail, user: string | null): ReviewCheckIn => {
  const v = view(r, user);
  return {
    performance_review_id: v.performance_review_id,
    round_name: v.round_name,
    month: v.month,
    due_on: roundOf(r).check_in_due_on,
    status: v.status,
    check_in_submitted_at: v.check_in_submitted_at,
    returned_reason: v.status === "check_in" ? v.returned_reason : null,
    reviewer: v.reviewer,
    items: v.items,
    tasks: v.tasks,
    task_counts: v.task_counts,
  };
};
const noCheckIn = () => fail(404, "NO_OPEN_CHECK_IN", "No check-in is open");

route("GET /api/v1/ess/performance", (req) => {
  const me = meOf(req.user);
  const card = SCORECARDS.find((c) => c.employee.employee_id === me?.employee_id && c.performance_period_id === PERIOD.performance_period_id);
  const open = openOf(req.user);
  const pip = PIPS.find((p) => p.employee.employee_id === me?.employee_id && (p.status === "open" || p.status === "extended"));
  const out: MyPerformance = {
    period: { performance_period_id: PERIOD.performance_period_id, name: PERIOD.name },
    scorecard: card ? { scorecard_id: card.scorecard_id, status: card.status, score_to_date: card.score_to_date, rating: card.rating, employee_agreed_at: card.employee_agreed_at, reviewer_name: card.reviewer?.display_name ?? card.reviewer_role ?? null } : null,
    check_in: open ? { performance_review_id: open.performance_review_id, month: open.month, due_on: open.status === "check_in" ? roundOf(open).check_in_due_on : open.due_on, status: open.status } : null,
    commitments: null,
    open_pip: pip ? { improvement_plan_id: pip.improvement_plan_id, review_on: pip.review_on } : null,
  };
  return ok(out);
});
route("GET /api/v1/ess/performance/check-in", (req) => {
  const r = openOf(req.user);
  return r ? ok(checkInOf(r, req.user)) : noCheckIn();
});

type ItemSave = Partial<ReviewItem> & { performance_review_item_id: string };
/** The score the system proposes for a person's own line from what they entered (§6.9). */
function propose(i: ReviewItem): string | null {
  const l = i.line;
  if (!l) return null;
  if (l.measure === "milestone") return i.achieved_on ? "1" : null;
  if (i.actual_value === null || i.actual_value === "") return null;
  if (l.measure === "binary") return scoring.formatScore(scoring.binaryScore(Number(i.actual_value) > 0));
  const s = l.measure === "standard" ? scoring.standardScore({ actual: i.actual_value, target: l.target_value, unit: l.unit }) : scoring.numericScore({ actual: i.actual_value, target: l.target_value });
  return s === null ? null : scoring.formatScore(s);
}
route("PUT /api/v1/ess/performance/check-in", (req) => {
  const r = openOf(req.user);
  if (!r) return noCheckIn();
  if (r.status !== "check_in") return fail(409, "CHECK_IN_SENT", "Your check-in is already sent");
  const problems: Record<string, string[]> = {};
  for (const [n, s] of ((req.body as { items?: ItemSave[] }).items ?? []).entries()) {
    const i = r.items.find((x) => x.performance_review_item_id === s.performance_review_item_id);
    if (!i) return invalid({ [`items.${n}.performance_review_item_id`]: ["Not this check-in's"] });
    const keys = ["actual_value", "actual_text", "achieved_on", "action_text", "action_transcript", "action_document_id", "self_score", "self_reason"] as const;
    for (const k of keys) if (s[k] !== undefined) Object.assign(i, { [k]: s[k] === "" ? null : s[k] });
    if (!i.auto) {
      for (const k of ["evidence_kind", "evidence_entity_type", "evidence_entity_id", "evidence_document_id", "evidence_url", "evidence_note"] as const) if (s[k] !== undefined) Object.assign(i, { [k]: s[k] || null });
      if (i.evidence_kind === "note" && !i.evidence_note) problems[`items.${n}.evidence_note`] = ["Name the source"];
      if (i.evidence_kind === "link" && !i.evidence_url) problems[`items.${n}.evidence_url`] = ["Add the link"];
      if (i.evidence_kind === "document" && !i.evidence_document_id) problems[`items.${n}.evidence_document_id`] = ["Add the file"];
      i.assessable = Boolean(i.evidence_kind);
      i.proposed_score = i.assessable ? propose(i) : null;
    }
    if (i.self_score !== null && i.proposed_score !== null && Number(i.self_score) !== Number(i.proposed_score) && !i.self_reason) problems[`items.${n}.self_reason`] = ["Give a reason"];
  }
  if (Object.keys(problems).length) return invalid(problems);
  return ok(checkInOf(r, req.user));
});
route("POST /api/v1/ess/performance/check-in/submit", (req) => {
  const r = openOf(req.user);
  if (!r) return noCheckIn();
  if (r.status !== "check_in") return fail(409, "CHECK_IN_SENT", "Your check-in is already sent");
  Object.assign(r, { check_in_submitted_at: now(), returned_reason: null });
  moved(r, "with_reviewer");
  return ok(checkInOf(r, req.user));
});

route("GET /api/v1/ess/performance/reviews", (req) => {
  const me = meOf(req.user);
  return paged(
    REVIEWS.filter((r) => r.employee.employee_id === me?.employee_id).map(myReviewOf),
    req,
    { sort: { month: (a, b) => (b.month ?? "").localeCompare(a.month ?? "") } },
  );
});
