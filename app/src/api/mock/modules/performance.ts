import type {
  Cycle,
  EmployeeKpis,
  Goal,
  GoalDetail,
  GoalRef,
  Kpi,
  MyPerformance,
  Plan,
  Review,
  ReviewDetail,
  ReviewForm,
  RouteStage,
  Target,
} from "@mycity/contract/contract.gen.ts";
import { todayIso } from "@mycity/ui";
import { at, created, fail, invalid, notFound, ok, paged, route, sid } from "../core";
import { byId, byKey, PEOPLE, ref, refKey, teamOf } from "../data/people";

/**
 * Performance Management in the browser, in the contract's shapes (docs/guides/performance.md §5).
 * The same records seed staging (F13). Rules the screens show are kept: the CEO's goals are
 * active at once, everything else waits on Management, Operations & People and the CEO; a
 * manager review shows nothing until the self review is in (A17).
 */
const MONTH = todayIso().slice(0, 7);
const YEAR = Number(MONTH.slice(0, 4));
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const deptId = (name: string) => sid(`dept:${name}`);

/* ───────────── Goals ───────────── */

type GoalRow = Goal & { quarters: Array<{ quarter: number; milestone: string }>; plan?: string };
const goalRef = (g: Goal): GoalRef => ({ organisational_goal_id: g.organisational_goal_id, code: g.code, level: g.level, title: g.title, status: g.status });
const GOALS: GoalRow[] = [];
const goal = (key: string, level: Goal["level"], code: string, title: string, parent: string | null, extra: Partial<GoalRow> = {}): GoalRow => {
  const p = parent ? GOALS.find((x) => x.organisational_goal_id === sid(`goal:${parent}`)) : null;
  const g: GoalRow = {
    organisational_goal_id: sid(`goal:${key}`),
    code,
    level,
    title,
    strategic_theme: null,
    success_measure: null,
    baseline: null,
    description: null,
    status: "active",
    starts_on: level === "monthly" || level === "department" ? `${MONTH}-01` : `${YEAR}-01-01`,
    ends_on: level === "monthly" || level === "department" ? monthEnd(MONTH) : `${YEAR}-12-31`,
    department: null,
    department_id: null,
    owner: refKey(level === "organisation" ? "ifeoma" : "cynthia"),
    rolls_up_to: p ? goalRef(p) : null,
    progress: { attainment: null, progress_status: null },
    workflow_instance_id: null,
    created_at: at(40, "09:00"),
    updated_at: at(3, "09:00"),
    quarters: [],
    ...extra,
  };
  GOALS.push(g);
  return g;
};
goal("og1", "organisation", `OG-${YEAR}-01`, "Reach 2 million active residents", null, { strategic_theme: "Growth", success_measure: "Monthly active users", baseline: "1.1M", progress: { attainment: 0.62, progress_status: "on_track" }, quarters: [{ quarter: 2, milestone: "1.4M" }, { quarter: 4, milestone: "2M" }] });
goal("og2", "organisation", `OG-${YEAR}-02`, "Partnership revenue of ₦180M", null, { strategic_theme: "Revenue", success_measure: "Signed partnership value", baseline: "₦96M", progress: { attainment: 0.48, progress_status: "at_risk" } });
goal("og3", "organisation", `OG-${YEAR}-03`, "Operate in 12 Nigerian cities", null, { strategic_theme: "Expansion", success_measure: "Cities live", baseline: "8", progress: { attainment: 0.71, progress_status: "on_track" } });
goal("ag1", "annual", `AG-${YEAR}-01`, "Sign 12 strategic partnerships", "og2", { progress: { attainment: 0.5, progress_status: "at_risk" } });
goal("ag2", "annual", `AG-${YEAR}-02`, "Operational readiness for 4 new cities", "og3", { progress: { attainment: 0.7, progress_status: "on_track" } });
goal("ag3", "annual", `AG-${YEAR}-03`, "Grow the team to 40", "og1", { status: "pending_approval", owner: refKey("ngozi") });
goal("mg1", "monthly", `MG-${YEAR}-010`, "Sign 2 partnerships this month", "ag1", { progress: { attainment: 0.5, progress_status: "on_track" } });
goal("mg2", "monthly", `MG-${YEAR}-011`, "Enugu hub ready to open", "ag2", { progress: { attainment: 0.8, progress_status: "on_track" } });

/* ───────────── A department's month ───────────── */

const PLANS: Plan[] = [];
const STAGES: Array<[string, string]> = [["management", "Management"], ["operations_people", "Operations & People"], ["ceo", "CEO"]];
const routeAt = (stage: number | "done" | null): RouteStage[] =>
  STAGES.map(([key, name], i) => ({ key, name, approvers: [], state: stage === "done" ? "done" : stage === null ? "todo" : i < stage ? "done" : i === stage ? "now" : "todo" }));
const plan = (dept: string, status: Plan["status"], stage: number | "done" | null, by: string): Plan => {
  const p: Plan = {
    performance_plan_id: sid(`plan:${dept}`),
    department_id: deptId(dept),
    department: dept,
    month: MONTH,
    status,
    submitted_by: status === "draft" ? null : refKey(by),
    submitted_at: status === "draft" ? null : at(2, "10:00"),
    approved_at: status === "active" ? at(1, "16:00") : null,
    workflow_instance_id: status === "draft" ? null : sid(`wf:${dept}`),
    waiting_on: typeof stage === "number" ? STAGES[stage][1] : null,
    targets: 0,
    kpis: 0,
    route: status === "draft" ? [] : routeAt(stage),
    can_submit: false,
    can_decide: false,
  };
  PLANS.push(p);
  return p;
};
plan("Marketing & Sales", "active", "done", "ngozi");
plan("Content", "pending_approval", 2, "tolu");
plan("Operations & People", "draft", null, "cynthia");

const target = (key: string, dept: string, title: string, parent: string, by: string, measure: string, attainment: number | null) =>
  goal(key, "department", `DT-${YEAR}-0${10 + GOALS.length}`, title, parent, {
    department: dept,
    department_id: deptId(dept),
    owner: refKey(by),
    success_measure: measure,
    status: PLANS.find((p) => p.department === dept)!.status === "active" ? "active" : PLANS.find((p) => p.department === dept)!.status === "pending_approval" ? "pending_approval" : "draft",
    plan: sid(`plan:${dept}`),
    progress: { attainment, progress_status: attainment === null ? null : attainment >= 0.5 ? "on_track" : "at_risk" },
  });
target("dt1", "Marketing & Sales", "8 new prospects, 3 proposals sent", "mg1", "ngozi", "Proposals sent", 0.6);
target("dt2", "Content", "24 pieces published", "mg1", "tolu", "Pieces", null);
target("dt3", "Operations & People", "Enugu hires onboarded", "mg2", "cynthia", "People onboarded", null);

/* ───────────── KPIs ───────────── */

const KPIS: Kpi[] = [];
const kpi = (who: string, title: string, dt: string, target: number, actual: number | null, weight: number, source: Kpi["progress_source"], by: string) => {
  const t = GOALS.find((g) => g.organisational_goal_id === sid(`goal:${dt}`))!;
  const pl = PLANS.find((p) => p.department === t.department)!;
  const status: Kpi["status"] = pl.status === "active" ? "active" : pl.status === "pending_approval" ? "pending_approval" : "draft";
  const att = status === "active" && actual !== null ? Math.min(1, actual / target) : null;
  KPIS.push({
    employee_target_id: sid(`kpi:${who}:${title}`),
    employee: refKey(who),
    title,
    month: MONTH,
    target_value: String(target),
    actual_value: actual === null ? null : String(actual),
    unit: null,
    direction: "higher",
    progress_source: source,
    weight: weight.toFixed(2),
    status,
    attainment: att,
    progress_status: att === null ? null : att >= 1 ? "met" : att >= 0.4 ? "on_track" : "at_risk",
    due_on: monthEnd(MONTH),
    set_by: refKey(by),
    target: goalRef(t),
    performance_plan_id: pl.performance_plan_id,
    can_record_actual: false,
    updated_at: at(1, "12:00"),
  });
};
kpi("bashir", "3 MOUs signed", "dt1", 3, 1, 60, "tasks", "ngozi");
kpi("bashir", "Partner contact log current", "dt1", 4, 4, 40, "manual", "ngozi");
kpi("grace", "8 new prospects", "dt1", 8, 6, 100, "tasks", "bashir");
kpi("tobi", "12 sales calls a week", "dt1", 48, 20, 70, "manual", "ngozi");
kpi("tobi", "2 proposals drafted", "dt1", 2, 1, 30, "tasks", "ngozi");
kpi("kemi", "12 pieces published", "dt2", 12, null, 60, "tasks", "tolu");
kpi("kemi", "Enugu blog series", "dt2", 3, null, 40, "tasks", "tolu");
kpi("precious", "Daily social posts", "dt2", 26, null, 100, "manual", "tolu");
kpi("damilola", "Enugu onboarding packs", "dt3", 4, null, 100, "tasks", "cynthia");
for (const p of PLANS) {
  p.targets = GOALS.filter((g) => g.plan === p.performance_plan_id).length;
  p.kpis = KPIS.filter((k) => k.performance_plan_id === p.performance_plan_id).length;
}

/* ───────────── Review cycles ───────────── */

const QUESTIONS = ["What went well this month?", "What did not, and why?", "What support do you need?"].map((prompt, i) => ({
  performance_cycle_question_id: sid(`q:${i}`),
  position: i + 1,
  prompt,
}));
const CYCLES: Cycle[] = [
  { performance_cycle_id: sid("cycle:q3"), name: `Q3 ${YEAR} Review`, starts_on: `${YEAR}-07-01`, ends_on: `${YEAR}-09-30`, status: "closed", self_review_opens_at: `${YEAR}-10-01T05:00:00.000Z`, closes_at: `${YEAR}-10-10T16:00:00.000Z`, questions: QUESTIONS, reviews: 0, closed_reviews: 0, created_at: at(30, "09:00") },
  { performance_cycle_id: sid("cycle:now"), name: `${new Date(`${MONTH}-15`).toLocaleString("en-GB", { month: "long" })} Check-In`, starts_on: `${MONTH}-01`, ends_on: monthEnd(MONTH), status: "open", self_review_opens_at: at(2, "06:00"), closes_at: at(-12, "17:00"), questions: QUESTIONS, reviews: 0, closed_reviews: 0, created_at: at(2, "06:00") },
];

type Row = { id: string; cycle: Cycle; employee: string; reviewer: string; type: Review["review_type"]; status: Review["status"]; overall: number | null; summary: string | null; submitted: boolean; items: Record<string, { score: number | null; comment: string | null }>; answers: Record<string, string | null> };
const ROWS: Row[] = [];
const review = (cycle: Cycle, employee: string, reviewer: string, type: Row["type"], status: Row["status"], overall: number | null, submitted: boolean) =>
  ROWS.push({ id: sid(`review:${cycle.performance_cycle_id}:${employee}:${type}`), cycle, employee, reviewer, type, status, overall, summary: type !== "self" && overall ? "Strong delivery; follow-ups slipped late in the period." : null, submitted, items: {}, answers: Object.fromEntries(QUESTIONS.map((q) => [q.performance_cycle_question_id, submitted ? "The Ikeja schools series landed well." : null])) });
const [past, current] = CYCLES;
for (const p of PEOPLE.filter((x) => x.manager)) {
  review(past, p.user_key, p.user_key, "self", "closed", 4, true);
  review(past, p.user_key, p.manager!, "manager", "closed", 4, true);
}
for (const p of PEOPLE.filter((x) => x.manager).slice(0, 18)) {
  const done = ["bashir", "grace", "tobi", "kemi"].includes(p.user_key);
  review(current, p.user_key, p.user_key, "self", done ? "submitted" : "draft", done ? 4 : null, done);
  review(current, p.user_key, p.manager!, "manager", p.user_key === "grace" ? "second_level" : "draft", p.user_key === "grace" ? 4 : null, p.user_key === "grace");
}
for (const c of CYCLES) {
  c.reviews = ROWS.filter((r) => r.cycle === c && r.type !== "self").length;
  c.closed_reviews = ROWS.filter((r) => r.cycle === c && r.type !== "self" && r.status === "closed").length;
}

const selfOf = (r: Row) => ROWS.find((x) => x.cycle === r.cycle && x.employee === r.employee && x.type === "self");
const managerOf = (r: Row) => ROWS.find((x) => x.cycle === r.cycle && x.employee === r.employee && x.type !== "self");
const kpisOf = (who: string, c: Cycle) => KPIS.filter((k) => k.employee.employee_id === byKey(who)!.employee_id && k.month >= c.starts_on.slice(0, 7) && k.month <= c.ends_on.slice(0, 7) && k.status === "active");
const STAGE_NAME: Partial<Record<Review["status"], string>> = { second_level: "Second Level", with_hr: "Operations & People" };

function toReview(r: Row, user: string): Review {
  const self = selfOf(r);
  const own = r.employee === user && r.type !== "self";
  return {
    performance_review_id: r.id,
    performance_cycle_id: r.cycle.performance_cycle_id,
    cycle: r.cycle.name,
    employee: refKey(r.employee),
    reviewer: refKey(r.reviewer),
    review_type: r.type,
    status: r.status,
    self_rating: r.type === "self" ? (r.submitted ? r.overall : null) : self?.submitted ? self.overall : null,
    manager_rating: r.type === "self" || !r.submitted || (own && r.status !== "closed") ? null : r.overall,
    waiting_on: STAGE_NAME[r.status] ?? null,
    submitted_at: r.submitted ? at(1, "15:00") : null,
    closes_at: r.cycle.closes_at,
  };
}

function toForm(r: Row, prefill: boolean): ReviewForm {
  return {
    performance_review_id: r.id,
    review_type: r.type,
    reviewer: refKey(r.reviewer),
    status: r.status,
    overall_score: r.overall,
    summary: r.summary,
    items: kpisOf(r.employee, r.cycle).map((k) => {
      const saved = r.items[k.employee_target_id];
      const auto = k.attainment === null ? null : k.attainment >= 1 ? 5 : k.attainment >= 0.85 ? 4 : k.attainment >= 0.7 ? 3 : k.attainment >= 0.5 ? 2 : 1;
      return { employee_target_id: k.employee_target_id, title: k.title, weight: k.weight, target_value: k.target_value, actual_value: k.actual_value, attainment: k.attainment, progress_status: k.progress_status, score: saved?.score ?? (prefill ? auto : null), comment: saved?.comment ?? null };
    }),
    answers: QUESTIONS.map((q) => ({ performance_cycle_question_id: q.performance_cycle_question_id, prompt: q.prompt, answer_text: r.answers[q.performance_cycle_question_id] ?? null, dictated: false })),
    submitted_at: r.submitted ? at(1, "15:00") : null,
  };
}

function detail(r: Row, user: string): ReviewDetail | null {
  const me = byKey(user)!;
  const ceo = user === "ifeoma";
  const hr = me.department === "Operations & People";
  const reviewer = r.reviewer === user;
  const employee = r.employee === user;
  const self = selfOf(r);
  const mgr = managerOf(r);
  const second = mgr && byKey(mgr.reviewer)?.manager === user;
  if (!reviewer && !employee && !ceo && !hr && !second && !(r.type === "self" && mgr?.reviewer === user && r.submitted)) return null;
  const isManager = r.type !== "self";
  const selfIn = isManager ? !!self?.submitted : r.submitted;
  const editable = (r.status === "draft" || r.status === "returned") && r.cycle.status === "open";
  let form: ReviewForm | null = null;
  let other: ReviewForm | null = null;
  let waiting = false;
  if (isManager) {
    if (employee && !reviewer) form = r.status === "closed" ? toForm(r, false) : null;
    else if (!selfIn && reviewer) waiting = true;
    else {
      form = toForm(r, reviewer && editable);
      other = self?.submitted ? toForm(self, false) : null;
    }
  } else {
    form = toForm(r, false);
    other = mgr && mgr.submitted && (!employee || mgr.status === "closed") ? toForm(mgr, false) : null;
  }
  const pending = r.status === "second_level" || r.status === "with_hr";
  return {
    performance_review_id: r.id,
    cycle: r.cycle,
    employee: refKey(r.employee),
    review_type: r.type,
    status: r.status,
    form,
    other,
    waiting_for_self: waiting,
    route: isManager && r.submitted
      ? [
          { key: "second_level", name: "Second Level", approvers: [], state: r.status === "second_level" ? "now" : "done" },
          { key: "operations_people", name: "Operations & People", approvers: [], state: r.status === "with_hr" ? "now" : r.status === "closed" ? "done" : "todo" },
        ]
      : [],
    decisions: [],
    document: null,
    can_edit: reviewer && editable && (!isManager || selfIn),
    can_submit: reviewer && editable && (!isManager || selfIn),
    can_decide: pending && ((r.status === "second_level" && (second || ceo)) || (r.status === "with_hr" && (hr || ceo))),
  };
}

/* ───────────── Routes: goals ───────────── */

const fresh = (g: GoalRow): Goal => {
  const { quarters: _q, plan: _p, ...rest } = g;
  return rest;
};
const may = (user: string, level: Goal["level"]) => user === "ifeoma" || (level !== "organisation" && ["cynthia", "ngozi"].includes(user));

route("GET /api/v1/performance/goals", (req) =>
  paged(GOALS.filter((g) => g.level !== "department" || req.query.level === "department").map(fresh), req, {
    search: (g) => [g.code, g.title, g.strategic_theme],
    filters: {
      level: (g, v) => g.level === v,
      status: (g, v) => g.status === v,
      year: (g, v) => g.starts_on.startsWith(v),
      month: (g, v) => g.starts_on <= `${v}-31` && g.ends_on >= `${v}-01`,
      parent_goal_id: (g, v) => g.rolls_up_to?.organisational_goal_id === v,
    },
    sort: { code: (a, b) => String(a.code).localeCompare(String(b.code)), ends_on: (a, b) => a.ends_on.localeCompare(b.ends_on), title: (a, b) => a.title.localeCompare(b.title) },
  }),
);

route("GET /api/v1/performance/goals/summary", () => {
  const count = (level: Goal["level"]) => ({ level, active: GOALS.filter((g) => g.level === level && g.status === "active").length, pending: GOALS.filter((g) => g.level === level && g.status === "pending_approval").length });
  const org = GOALS.filter((g) => g.level === "organisation");
  return ok({
    year: YEAR,
    cascade: [count("organisation"), count("annual"), count("monthly"), count("department"), { level: "individual", active: KPIS.filter((k) => k.status === "active").length, pending: KPIS.filter((k) => k.status === "pending_approval").length }],
    on_track: org.filter((g) => g.progress.progress_status === "on_track" || g.progress.progress_status === "met").length,
    progress: org.map((g) => ({ organisational_goal_id: g.organisational_goal_id, code: g.code, title: g.title, ...g.progress })),
  });
});

function goalDetail(g: GoalRow, user: string): GoalDetail {
  const trace: GoalRef[] = [];
  for (let p = g.rolls_up_to; p; ) {
    trace.push(p);
    const up = GOALS.find((x) => x.organisational_goal_id === p!.organisational_goal_id);
    p = up?.rolls_up_to ?? null;
  }
  const editable = g.status === "draft" || g.status === "returned";
  return {
    ...fresh(g),
    quarters: g.quarters,
    trace,
    children: GOALS.filter((c) => c.rolls_up_to?.organisational_goal_id === g.organisational_goal_id).map(goalRef),
    route: g.status === "pending_approval" ? routeAt(0) : g.status === "active" && g.level !== "organisation" ? routeAt("done") : [],
    decisions: [],
    can_edit: editable && may(user, g.level),
    can_submit: editable && may(user, g.level) && (g.level === "annual" || g.level === "monthly"),
    can_decide: g.status === "pending_approval" && ["ifeoma", "cynthia", "ngozi"].includes(user) && g.owner.employee_id !== byKey(user)!.employee_id,
  };
}

route("GET /api/v1/performance/goals/:id", (req) => {
  const g = GOALS.find((x) => x.organisational_goal_id === req.params.id);
  return g ? ok(goalDetail(g, req.user!)) : notFound();
});

route("POST /api/v1/performance/goals", (req) => {
  const b = req.body as { level: Goal["level"]; title?: string; parent_goal_id?: string; month?: string; strategic_theme?: string; success_measure?: string; baseline?: string; quarters?: Array<{ quarter: number; milestone: string }> };
  if (!may(req.user!, b.level)) return fail(403, "CAPABILITY_REQUIRED", "You do not set goals at this level");
  if (!b.title) return invalid({ title: ["Required"] });
  const n = GOALS.filter((g) => g.level === b.level).length + 1;
  const prefix = { organisation: "OG", annual: "AG", monthly: "MG", department: "DT" }[b.level];
  const g = goal(`new:${Date.now()}`, b.level, `${prefix}-${YEAR}-${String(n).padStart(b.level === "monthly" ? 3 : 2, "0")}`, b.title, null, {
    status: b.level === "organisation" ? "active" : "draft",
    owner: ref(byKey(req.user))!,
    strategic_theme: b.strategic_theme ?? null,
    success_measure: b.success_measure ?? null,
    baseline: b.baseline ?? null,
    quarters: b.quarters ?? [],
    ...(b.month ? { starts_on: `${b.month}-01`, ends_on: monthEnd(b.month) } : {}),
  });
  const parent = GOALS.find((x) => x.organisational_goal_id === b.parent_goal_id);
  if (parent) g.rolls_up_to = goalRef(parent);
  return created(fresh(g));
});

route("PATCH /api/v1/performance/goals/:id", (req) => {
  const g = GOALS.find((x) => x.organisational_goal_id === req.params.id);
  if (!g) return notFound();
  Object.assign(g, req.body);
  return ok(goalDetail(g, req.user!));
});

route("POST /api/v1/performance/goals/:id/submit", (req) => {
  const g = GOALS.find((x) => x.organisational_goal_id === req.params.id);
  if (!g) return notFound();
  g.status = "pending_approval";
  return ok(goalDetail(g, req.user!));
});

route("POST /api/v1/performance/goals/:id/decide", (req) => {
  const g = GOALS.find((x) => x.organisational_goal_id === req.params.id);
  if (!g) return notFound();
  g.status = req.body.decision === "return" ? "returned" : req.user === "ifeoma" ? "active" : g.status;
  return ok(goalDetail(g, req.user!));
});

/* ───────────── Routes: targets and plans ───────────── */

const toTarget = (g: GoalRow, user: string): Target => ({
  organisational_goal_id: g.organisational_goal_id,
  code: g.code,
  title: g.title,
  success_measure: g.success_measure,
  status: g.status,
  month: g.starts_on.slice(0, 7),
  department_id: g.department_id!,
  department: g.department!,
  rolls_up_to: g.rolls_up_to!,
  owner: g.owner,
  performance_plan_id: g.plan ?? null,
  progress: g.progress,
  can_decide: g.status === "pending_approval" && user === "ifeoma",
  created_at: g.created_at,
});
const planFor = (p: Plan, user: string): Plan => {
  const head = byKey(user)!;
  return {
    ...p,
    can_submit: (p.status === "draft" || p.status === "returned") && p.targets > 0 && (user === "ifeoma" || (head.department === p.department && ["ngozi", "tolu", "cynthia"].includes(user))),
    can_decide: p.status === "pending_approval" && ["ifeoma", "cynthia"].includes(user),
  };
};

route("GET /api/v1/performance/targets", (req) =>
  paged(GOALS.filter((g) => g.level === "department").map((g) => toTarget(g, req.user!)), req, {
    search: (t) => [t.title, t.department, t.code],
    filters: { month: (t, v) => t.month === v, department_id: (t, v) => t.department_id === v, status: (t, v) => t.status === v },
    sort: { department: (a, b) => a.department.localeCompare(b.department), title: (a, b) => a.title.localeCompare(b.title), code: (a, b) => String(a.code).localeCompare(String(b.code)) },
  }),
);

route("GET /api/v1/performance/targets/summary", (req) => {
  const m = req.query.month || MONTH;
  const plans = PLANS.filter((p) => p.month === m).map((p) => planFor(p, req.user!));
  const mine = byKey(req.user)!.department;
  return ok({
    month: m,
    departments: plans.length,
    approved: plans.filter((p) => p.status === "active").length,
    awaiting: plans.filter((p) => p.status === "pending_approval").length,
    chain: STAGES.map(([key, name]) => ({ key, name, waiting: plans.filter((p) => p.waiting_on === name).length })),
    my_plan: plans.find((p) => p.department === mine) ?? null,
    plans,
    last_month: m === MONTH ? [["Marketing & Sales", 0.82], ["Content", 0.74], ["Finance", 0.9], ["Engineering", 0.66]].map(([d, a]) => ({ department_id: deptId(d as string), department: d as string, attainment: a as number })) : [],
    trail: m === MONTH
      ? [
          { workflow_decision_id: sid("dec:1"), stage_key: "ceo", stage_name: "CEO", actor_id: sid("user:ifeoma"), actor_name: "Ifeoma Chukwu", decision: "approve" as const, reason: null, decided_at: at(1, "16:00"), performance_plan_id: sid("plan:Marketing & Sales"), department: "Marketing & Sales" },
          { workflow_decision_id: sid("dec:2"), stage_key: "operations_people", stage_name: "Operations & People", actor_id: sid("user:cynthia"), actor_name: "Cynthia Okoro", decision: "approve" as const, reason: null, decided_at: at(1, "11:00"), performance_plan_id: sid("plan:Content"), department: "Content" },
        ]
      : [],
  });
});

route("POST /api/v1/performance/targets", (req) => {
  const b = req.body as { title?: string; month?: string; parent_goal_id?: string; success_measure?: string };
  const me = byKey(req.user)!;
  const parent = GOALS.find((x) => x.organisational_goal_id === b.parent_goal_id);
  if (!b.title) return invalid({ title: ["Required"] });
  if (!parent) return invalid({ parent_goal_id: ["Pick the parent goal"] });
  const p = PLANS.find((x) => x.department === me.department && x.month === (b.month ?? MONTH)) ?? plan(me.department, "draft", null, req.user!);
  if (p.status === "pending_approval" || p.status === "active") return fail(409, "PLAN_LOCKED", "This month is already sent for approval");
  const g = target(`new:${Date.now()}`, me.department, b.title, parent.organisational_goal_id === sid("goal:mg1") ? "mg1" : "mg2", req.user!, b.success_measure ?? "", null);
  p.targets += 1;
  return created(toTarget(g, req.user!));
});

route("POST /api/v1/performance/plans/:department_id/:month/submit", (req) => {
  const p = PLANS.find((x) => x.department_id === req.params.department_id && x.month === req.params.month);
  if (!p) return notFound();
  Object.assign(p, { status: "pending_approval", waiting_on: "Management", route: routeAt(0), submitted_by: refKey(req.user!), submitted_at: new Date().toISOString() });
  return ok(planFor(p, req.user!));
});

route("POST /api/v1/performance/plans/:id/decide", (req) => {
  const p = PLANS.find((x) => x.performance_plan_id === req.params.id);
  if (!p) return notFound();
  if (req.body.decision === "return") Object.assign(p, { status: "returned", waiting_on: null });
  else {
    const at0 = STAGES.findIndex(([, name]) => name === p.waiting_on);
    if (at0 >= 2) Object.assign(p, { status: "active", waiting_on: null, route: routeAt("done"), approved_at: new Date().toISOString() });
    else Object.assign(p, { waiting_on: STAGES[at0 + 1][1], route: routeAt(at0 + 1) });
  }
  return ok(planFor(p, req.user!));
});

/* ───────────── Routes: KPIs ───────────── */

const scopeOf = (user: string) => {
  if (user === "ifeoma" || byKey(user)!.department === "Operations & People") return null;
  return new Set([byKey(user)!.employee_id, ...teamOf(user).map((p) => p.employee_id)]);
};
const visible = (user: string, k: Kpi) => {
  const s = scopeOf(user);
  return !s || s.has(k.employee.employee_id);
};
const withAbility = (k: Kpi, user: string): Kpi => ({ ...k, can_record_actual: k.progress_source === "manual" && k.status === "active" && (k.employee.employee_id === byKey(user)!.employee_id || k.set_by?.employee_id === byKey(user)!.employee_id) });

route("GET /api/v1/performance/kpis", (req) =>
  paged(KPIS.filter((k) => visible(req.user!, k)).map((k) => withAbility(k, req.user!)), req, {
    search: (k) => [k.title, k.employee.display_name],
    filters: {
      month: (k, v) => k.month === v,
      department_id: (k, v) => deptId(byId(k.employee.employee_id)!.department) === v,
      employee_id: (k, v) => k.employee.employee_id === v,
      status: (k, v) => k.status === v,
      progress_status: (k, v) => k.progress_status === v,
    },
    sort: { employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name), title: (a, b) => a.title.localeCompare(b.title), weight: (a, b) => Number(a.weight) - Number(b.weight) },
  }),
);

route("GET /api/v1/performance/kpis/summary", (req) => {
  const mine = KPIS.filter((k) => visible(req.user!, k) && (!req.query.department_id || deptId(byId(k.employee.employee_id)!.department) === req.query.department_id));
  const people = new Map<string, number>();
  for (const k of mine) people.set(k.employee.employee_id, (people.get(k.employee.employee_id) ?? 0) + Number(k.weight));
  const s = scopeOf(req.user!);
  return ok({
    month: req.query.month || MONTH,
    staff: s ? s.size : PEOPLE.length,
    with_kpis: people.size,
    weights_off: [...people.values()].filter((w) => w !== 100).length,
    on_track: mine.filter((k) => k.progress_status === "on_track" || k.progress_status === "met").length,
    behind_or_at_risk: mine.filter((k) => k.progress_status === "at_risk" || k.progress_status === "behind").length,
    sources: [
      { progress_source: "tasks", count: mine.filter((k) => k.progress_source === "tasks").length },
      { progress_source: "manual", count: mine.filter((k) => k.progress_source === "manual").length },
    ],
  });
});

function employeeKpis(employeeId: string, user: string): EmployeeKpis | null {
  const p = byId(employeeId);
  if (!p) return null;
  const items = KPIS.filter((k) => k.employee.employee_id === employeeId).map((k) => withAbility(k, user));
  const total = items.reduce((s, k) => s + Number(k.weight), 0);
  const counted = items.filter((k) => k.attainment !== null);
  const score = counted.length ? counted.reduce((s, k) => s + k.attainment! * Number(k.weight), 0) / 100 : null;
  const pl = PLANS.find((x) => x.department === p.department && x.month === MONTH);
  return {
    employee: ref(p)!,
    month: MONTH,
    items,
    total_weight: total.toFixed(2),
    kpi_score: score,
    targets: GOALS.filter((g) => g.level === "department" && g.department === p.department).map(goalRef),
    can_assign: employeeId !== byKey(user)!.employee_id && (!pl || pl.status === "draft" || pl.status === "returned") && (user === "ifeoma" || p.manager === user || byKey(user)!.job_title.startsWith("Head")),
  };
}

route("GET /api/v1/performance/kpis/employees/:id", (req) => {
  const e = employeeKpis(req.params.id, req.user!);
  return e ? ok(e) : notFound();
});

route("PUT /api/v1/performance/kpis/employees/:id", (req) => {
  const p = byId(req.params.id);
  if (!p) return notFound();
  const items = (req.body.items ?? []) as Array<{ organisational_goal_id: string; title: string; target_value: string; weight: string; progress_source: Kpi["progress_source"]; unit?: string }>;
  for (let i = KPIS.length - 1; i >= 0; i -= 1) if (KPIS[i].employee.employee_id === p.employee_id && KPIS[i].status === "draft") KPIS.splice(i, 1);
  for (const it of items) {
    const t = GOALS.find((g) => g.organisational_goal_id === it.organisational_goal_id);
    KPIS.push({ ...KPIS[0], employee_target_id: sid(`kpi:${p.user_key}:${it.title}:${Date.now()}`), employee: ref(p)!, title: it.title, target_value: it.target_value, actual_value: null, unit: it.unit ?? null, progress_source: it.progress_source, weight: Number(it.weight).toFixed(2), status: "draft", attainment: null, progress_status: null, set_by: refKey(req.user!), target: t ? goalRef(t) : null });
  }
  return ok(employeeKpis(p.employee_id, req.user!));
});

route("POST /api/v1/performance/kpis/:id/actual", (req) => {
  const k = KPIS.find((x) => x.employee_target_id === req.params.id);
  if (!k) return notFound();
  k.actual_value = String(req.body.actual_value);
  k.attainment = Math.min(1, Number(k.actual_value) / Number(k.target_value));
  k.progress_status = k.attainment >= 1 ? "met" : k.attainment >= 0.4 ? "on_track" : "at_risk";
  return ok(withAbility(k, req.user!));
});

route("GET /api/v1/performance/kpis/:id/trace", (req) => {
  const k = KPIS.find((x) => x.employee_target_id === req.params.id);
  if (!k || !k.target) return notFound();
  const chain: GoalRef[] = [];
  for (let g: GoalRef | null = k.target; g; ) {
    chain.push(g);
    g = GOALS.find((x) => x.organisational_goal_id === g!.organisational_goal_id)?.rolls_up_to ?? null;
  }
  return ok({ employee_target_id: k.employee_target_id, title: k.title, chain });
});

/* ───────────── Routes: cycles and reviews ───────────── */

route("GET /api/v1/performance/cycles", (req) =>
  paged(CYCLES, req, { filters: { status: (c, v) => c.status === v }, sort: { starts_on: (a, b) => b.starts_on.localeCompare(a.starts_on), name: (a, b) => a.name.localeCompare(b.name) } }),
);

route("POST /api/v1/performance/cycles", (req) => {
  const b = req.body as { name: string; starts_on: string; ends_on: string; opens_on: string; closes_on: string; questions?: string[] };
  const opens = b.opens_on <= todayIso();
  const c: Cycle = { performance_cycle_id: sid(`cycle:${b.name}`), name: b.name, starts_on: b.starts_on, ends_on: b.ends_on, status: opens ? "open" : "scheduled", self_review_opens_at: `${b.opens_on}T05:00:00.000Z`, closes_at: `${b.closes_on}T16:00:00.000Z`, questions: (b.questions?.length ? b.questions : QUESTIONS.map((q) => q.prompt)).map((prompt, i) => ({ performance_cycle_question_id: sid(`q:${b.name}:${i}`), position: i + 1, prompt })), reviews: 0, closed_reviews: 0, created_at: new Date().toISOString() };
  CYCLES.push(c);
  return created(c);
});

route("POST /api/v1/performance/cycles/:id/close", (req) => {
  const c = CYCLES.find((x) => x.performance_cycle_id === req.params.id);
  if (!c) return notFound();
  c.status = "closed";
  return ok(c);
});

const visibleReview = (user: string, r: Row) => {
  const s = scopeOf(user);
  return !s || s.has(byKey(r.employee)!.employee_id);
};

route("GET /api/v1/performance/reviews", (req) => {
  const rows = ROWS.filter((r) => visibleReview(req.user!, r) && (r.type !== "self" || !managerOf(r))).map((r) => toReview(r, req.user!));
  return paged(rows, req, {
    search: (r) => [r.employee.display_name],
    filters: { performance_cycle_id: (r, v) => r.performance_cycle_id === v, status: (r, v) => r.status === v, review_type: (r, v) => r.review_type === v },
    sort: { employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name), closes_at: (a, b) => String(a.closes_at).localeCompare(String(b.closes_at)), status: (a, b) => a.status.localeCompare(b.status) },
  });
});

route("GET /api/v1/performance/reviews/summary", (req) => {
  const c = current;
  const rows = ROWS.filter((r) => r.cycle === c && visibleReview(req.user!, r));
  const closed = rows.filter((r) => r.type !== "self" && r.status === "closed");
  return ok({
    cycle: c,
    last_cycle: past.name,
    average_rating: closed.length ? closed.reduce((s, r) => s + (r.overall ?? 0), 0) / closed.length : 4,
    self_done: rows.filter((r) => r.type === "self" && r.submitted).length,
    manager_done: rows.filter((r) => r.type !== "self" && r.submitted).length,
    closed: closed.length,
    total: rows.filter((r) => r.type === "self").length,
  });
});

route("GET /api/v1/performance/reviews/:id", (req) => {
  const r = ROWS.find((x) => x.id === req.params.id);
  const d = r && detail(r, req.user!);
  return d ? ok(d) : notFound();
});

function save(r: Row, body: Record<string, unknown>) {
  if (body.overall_score !== undefined) r.overall = body.overall_score as number | null;
  if (body.summary !== undefined) r.summary = body.summary as string | null;
  for (const i of (body.items ?? []) as Array<{ employee_target_id: string; score: number | null; comment: string | null }>) r.items[i.employee_target_id] = { score: i.score, comment: i.comment };
  for (const a of (body.answers ?? []) as Array<{ performance_cycle_question_id: string; answer_text: string | null }>) r.answers[a.performance_cycle_question_id] = a.answer_text;
}

function submit(r: Row) {
  if (!r.overall) return invalid({ overall_score: ["Required"] });
  r.submitted = true;
  r.status = r.type === "self" ? "submitted" : "second_level";
  return null;
}

route("PUT /api/v1/performance/reviews/:id", (req) => {
  const r = ROWS.find((x) => x.id === req.params.id);
  if (!r || r.reviewer !== req.user) return notFound();
  if (r.type !== "self" && !selfOf(r)?.submitted) return fail(409, "SELF_REVIEW_FIRST", "Waiting for the self review");
  save(r, req.body);
  return ok(detail(r, req.user!));
});

route("POST /api/v1/performance/reviews/:id/submit", (req) => {
  const r = ROWS.find((x) => x.id === req.params.id);
  if (!r || r.reviewer !== req.user) return notFound();
  return submit(r) ?? ok(detail(r, req.user!));
});

route("POST /api/v1/performance/reviews/:id/decide", (req) => {
  const r = ROWS.find((x) => x.id === req.params.id);
  if (!r) return notFound();
  if (req.body.decision === "return") r.status = "returned";
  else if (r.status === "second_level") r.status = "with_hr";
  else if (r.status === "with_hr") {
    r.status = "closed";
    const s = selfOf(r);
    if (s) s.status = "closed";
  }
  return ok(detail(r, req.user!));
});

route("GET /api/v1/performance/analytics", (req) => {
  const rows = ROWS.filter((r) => r.cycle === past && visibleReview(req.user!, r));
  const avg = (type: "self" | "manager") => {
    const xs = rows.filter((r) => (type === "self" ? r.type === "self" : r.type !== "self") && r.overall);
    return xs.length ? xs.reduce((s, r) => s + r.overall!, 0) / xs.length : null;
  };
  return ok({
    cycle: past.name,
    year: YEAR,
    goals_on_track: 2,
    goals_total: 3,
    reviews_completed: rows.filter((r) => r.type !== "self" && r.status === "closed").length,
    reviews_total: rows.filter((r) => r.type !== "self").length,
    average_self: avg("self"),
    average_manager: avg("manager"),
    completion: Array.from({ length: 12 }, (_, i) => {
      const m = `${YEAR}-${String(i + 1).padStart(2, "0")}`;
      return { month: m, attainment: m <= MONTH ? [0.52, 0.58, 0.61, 0.6, 0.66, 0.7, 0.68, 0.72, 0.75, 0.71, 0.74, 0.78][i] : null };
    }),
    by_department: [["Marketing & Sales", 0.72], ["Content", 0.68], ["Finance", 0.88], ["Engineering", 0.64], ["Studio", 0.7]].map(([d, a]) => ({ department_id: deptId(d as string), department: d as string, attainment: a as number })),
    gap: [["Marketing & Sales", 4.1, 3.8], ["Content", 3.9, 3.9], ["Finance", 4.2, 4.0], ["Engineering", 4.0, 3.6]].map(([d, s, m]) => ({ department_id: deptId(d as string), department: d as string, self: s as number, manager: m as number, gap: Math.round(((m as number) - (s as number)) * 10) / 10 })),
  });
});

/* ───────────── ESS · My Performance ───────────── */

const openSelf = (user: string) => ROWS.find((r) => r.employee === user && r.type === "self" && r.cycle.status === "open" && !r.submitted);

route("GET /api/v1/ess/performance", (req) => {
  const e = employeeKpis(byKey(req.user)!.employee_id, req.user!)!;
  const mine = ROWS.filter((r) => r.employee === req.user && (r.type !== "self" || !managerOf(r))).map((r) => toReview(r, req.user!));
  const last = ROWS.find((r) => r.employee === req.user && r.type !== "self" && r.status === "closed");
  const body: MyPerformance = {
    month: MONTH,
    set_by: e.items[0]?.set_by?.display_name ?? null,
    kpi_score: e.kpi_score,
    on_track: e.items.filter((k) => k.progress_status === "on_track" || k.progress_status === "met").length,
    kpi_count: e.items.length,
    weight_assigned: e.total_weight,
    last_review: last?.overall ?? null,
    next_cycle: current.status !== "closed" ? current : null,
    kpis: e.items,
    traces: e.items.filter((k) => k.target).map((k) => {
      const chain: GoalRef[] = [];
      for (let g: GoalRef | null = k.target; g; ) {
        chain.push(g);
        g = GOALS.find((x) => x.organisational_goal_id === g!.organisational_goal_id)?.rolls_up_to ?? null;
      }
      return { employee_target_id: k.employee_target_id, title: k.title, chain };
    }),
    reviews: mine,
    open_review_id: openSelf(req.user!)?.id ?? null,
  };
  return ok(body);
});

route("GET /api/v1/ess/performance/review", (req) => {
  const r = openSelf(req.user!);
  return r ? ok(detail(r, req.user!)) : fail(404, "NO_OPEN_REVIEW", "No review is open for you");
});

route("PUT /api/v1/ess/performance/review", (req) => {
  const r = openSelf(req.user!);
  if (!r) return fail(404, "NO_OPEN_REVIEW", "No review is open for you");
  save(r, req.body);
  return ok(detail(r, req.user!));
});

route("POST /api/v1/ess/performance/review/submit", (req) => {
  const r = openSelf(req.user!);
  if (!r) return fail(404, "NO_OPEN_REVIEW", "No review is open for you");
  return submit(r) ?? ok(detail(r, req.user!));
});
