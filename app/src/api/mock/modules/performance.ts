import { at, created, fail, invalid, noContent, notFound, ok, paged, route, sid, type Req } from "../core";
import { byId, byKey, DEPARTMENTS, managerOf, refKey, teamOf } from "../data/people";
import { me } from "./identity";
import type {
  AnalyticsPerson,
  ApprovalInstance,
  ApprovalWaiting,
  KeyResult,
  KeyResultDetail,
  KeyResultMonth,
  Kpi,
  KpiMonth,
  Objective,
  OrganisationalGoal,
  OrganisationalGoalTarget,
  PerformanceAnalytics,
  PerformanceApproval,
  PerformanceFunction,
  PerformancePeriod,
  Plan,
  PlanDetail,
  Scorecard,
  ScorecardDetail,
  ScorecardLine,
  TargetChange,
  TargetChangeDetail,
} from "@mycity/contract/contract.gen.ts";
import { exportFile } from "./shared";
import { CONTRIBUTIONS, DEPT, deptId, GRACE_CARD, KPIS as FUNCTION_KPIS, OBJECTIVES, ORG_GOALS, PERIOD, PLANS, SCORECARDS, TARGET_CHANGES } from "../data/performance";

/* ------------------------------------------------------------------ *
 * The contract's endpoints (docs/guides/performance.md §5), on the data in ../data/performance.ts.
 * The reviews' endpoints are in ./reviews.ts; Analytics is at the foot of this file. Each PR
 * wires the rest of the contract's endpoints as it lands.
 * ------------------------------------------------------------------ */

const PERIODS: PerformancePeriod[] = [PERIOD];
const currentPeriod = () => PERIODS.find((p) => p.status === "active") ?? PERIODS.find((p) => p.status === "planning");
const quarterName = (startsOn: string) => `Q${Math.floor((Number(startsOn.slice(5, 7)) - 1) / 3) + 1} ${startsOn.slice(0, 4)}`;
const addMonths = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
};

route("GET /api/v1/performance/periods", (req) =>
  paged(PERIODS, req, {
    filters: { status: (p, v) => p.status === v, plan_year: (p, v) => p.plan_year_starts_on.startsWith(String(v)) },
    search: (p) => [p.name],
    sort: { starts_on: (a, b) => a.starts_on.localeCompare(b.starts_on) },
  }),
);
route("GET /api/v1/performance/periods/current", () => {
  const p = currentPeriod();
  return p ? ok(p) : fail(404, "NO_QUARTER", "No quarter has been set up yet");
});
route("GET /api/v1/performance/periods/:id", (req) => {
  const p = PERIODS.find((x) => x.performance_period_id === req.params.id);
  return p ? ok(p) : notFound();
});
route("POST /api/v1/performance/periods", (req) => {
  const b = req.body as { starts_on?: string; name?: string; targets_lock_on?: string; live_from?: string; status?: "planning" | "active"; rules?: PerformancePeriod["rules"] };
  if (!b.starts_on || !/-(01|04|07|10)-01$/.test(b.starts_on)) return invalid({ starts_on: ["Pick a quarter start"] });
  if (PERIODS.some((p) => p.starts_on === b.starts_on)) return fail(409, "PERIOD_EXISTS", "That quarter is already set up", { starts_on: ["Already set up"] });
  if (b.status === "active" && PERIODS.some((p) => p.status === "active")) return fail(409, "PERIOD_ACTIVE_EXISTS", "Close the active quarter first", { status: ["Another is active"] });
  const last = [...PERIODS].sort((a, c) => c.starts_on.localeCompare(a.starts_on))[0];
  const p: PerformancePeriod = {
    ...last,
    performance_period_id: sid(`perf:period:${b.starts_on}`),
    name: b.name || quarterName(b.starts_on),
    starts_on: b.starts_on,
    ends_on: new Date(Date.parse(`${addMonths(b.starts_on, 3)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10),
    plan_year_starts_on: `${b.starts_on.slice(0, 4)}-01-01`,
    targets_lock_on: b.targets_lock_on || null,
    live_from: b.live_from || null,
    status: b.status ?? "planning",
    rules: b.rules ?? last.rules,
    months: [0, 1, 2].map((n) => addMonths(b.starts_on!, n)),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  PERIODS.push(p);
  return created(p);
});
route("PATCH /api/v1/performance/periods/:id", (req) => {
  const p = PERIODS.find((x) => x.performance_period_id === req.params.id);
  if (!p) return notFound();
  const b = req.body as Partial<PerformancePeriod>;
  if (b.status === "active" && PERIODS.some((x) => x !== p && x.status === "active")) return fail(409, "PERIOD_ACTIVE_EXISTS", "Close the active quarter first", { status: ["Another is active"] });
  Object.assign(p, b, { updated_at: new Date().toISOString() });
  return ok(p);
});

const now = () => new Date().toISOString();
/** A number for a new record's id: never the clock, which a test may hold still. */
let made = 0;
const fresh = () => (made += 1);
const meOf = (req: Req) => byKey(req.user);
const isCeo = (req: Req) => req.user === "ifeoma";
const planOf = (periodId: string, departmentId: string | null) => {
  let p = PLANS.find((x) => x.performance_period_id === periodId && x.department_id === departmentId);
  if (!p) {
    const period = PERIODS.find((x) => x.performance_period_id === periodId) ?? PERIOD;
    p = {
      performance_plan_id: sid(`perf:plan:${periodId}:${departmentId ?? "company"}`),
      performance_period_id: periodId,
      period_name: period.name,
      department_id: departmentId,
      department: departmentId ? (departmentId === deptId ? DEPT : "Function") : null,
      status: "draft",
      workflow_instance_id: null,
      submitted_by: null,
      submitted_at: null,
      returned_reason: null,
      binding_at: null,
      objective_count: 0,
      scorecard_count: 0,
      created_at: now(),
      updated_at: now(),
    };
    PLANS.push(p);
  }
  return p;
};
const open = (status: string) => status === "draft" || status === "returned";
const allKrs = () => OBJECTIVES.flatMap((o) => o.key_results);
const krById = (id: string) => allKrs().find((k) => k.okr_key_result_id === id);
const objectiveOf = (kr: KeyResult) => OBJECTIVES.find((o) => o.okr_objective_id === kr.okr_objective_id)!;
const fieldsOf = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k] === "" ? null : b[k]]));
const KR_KEYS = ["statement", "kr_type", "measure", "direction", "unit", "baseline_text", "target_value", "target_text", "target_provisional", "parts", "starts_on", "finishes_on", "accountable_note", "scored_from_key_result_id", "position"];
const objectiveScore = (o: Objective) => {
  const s = o.key_results.map((k) => k.latest?.score).filter((x): x is string => x !== null && x !== undefined).map(Number);
  return s.length ? String(Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 100) / 100) : null;
};
const traceOf = (kr: KeyResult) => {
  const o = objectiveOf(kr);
  const goal = ORG_GOALS.find((g) => g.organisational_goal_id === o.organisational_goal_id);
  return {
    steps: [
      { kind: "key_result" as const, id: kr.okr_key_result_id, code: kr.code, title: kr.statement },
      ...kr.linked_company_key_results.map((c) => ({ kind: "company_key_result" as const, id: c.okr_key_result_id, code: c.code, title: c.statement })),
      { kind: "objective" as const, id: o.okr_objective_id, code: o.code, title: o.title },
      ...(goal ? [{ kind: "organisational_goal" as const, id: goal.organisational_goal_id, code: goal.code, title: goal.title }] : []),
    ],
  };
};
/** Who may set a function's goals here: the CEO, or the demonstration function's head. */
const setsGoalsFor = (req: Req, departmentId: string | null) => isCeo(req) || (departmentId === deptId && meOf(req)?.user_key === "ngozi");
/** An objective as the reader gets it: may they edit it now (a draft or returned plan whose goals they set)? */
const withCan = (o: Objective, req: Req): Objective => ({ ...o, score: objectiveScore(o), can_edit: open(o.plan_status) && setsGoalsFor(req, o.department_id) });
/** A TBC target still open: provisional, not locked, its quarter's lock date not come (§6.7). */
const tbcOpen = (kr: KeyResult) => {
  const lock = (PERIODS.find((p) => p.performance_period_id === objectiveOf(kr).performance_period_id) ?? PERIOD).targets_lock_on;
  return kr.target_provisional && !kr.target_locked_at && (!lock || lock > new Date().toISOString().slice(0, 10));
};
const isOwner = (kr: KeyResult, req: Req) => Boolean(kr.accountable && kr.accountable.employee_id === meOf(req)?.employee_id);
/** The form's people and links, as a key result carries them. */
const krPeopleAndLinks = (b: Record<string, unknown>): Partial<KeyResult> => {
  const out: Partial<KeyResult> = {};
  const person = (id: unknown) => {
    const p = byId(typeof id === "string" && id ? id : undefined);
    return p ? refKey(p.user_key) : null;
  };
  if ("accountable_employee_id" in b) out.accountable = person(b.accountable_employee_id);
  if ("co_accountable_employee_id" in b) out.co_accountable = person(b.co_accountable_employee_id);
  if (Array.isArray(b.linked_company_key_result_ids))
    out.linked_company_key_results = (b.linked_company_key_result_ids as string[]).map(krById).filter((x): x is KeyResult => Boolean(x)).map((x) => ({ okr_key_result_id: x.okr_key_result_id, code: x.code, statement: x.statement }));
  return out;
};
const krDetail = (kr: KeyResult, req: Req): KeyResultDetail => {
  const o = objectiveOf(kr);
  return {
    ...kr,
    objective: { okr_objective_id: o.okr_objective_id, code: o.code, title: o.title },
    department_id: o.department_id,
    department: o.department,
    plan_status: o.plan_status,
    contributing: allKrs().filter((k) => k.linked_company_key_results.some((c) => c.okr_key_result_id === kr.okr_key_result_id)).map((k) => ({ okr_key_result_id: k.okr_key_result_id, code: k.code, statement: k.statement })),
    initiatives: [],
    months: kr.latest ? [kr.latest] : [],
    target_history: TARGET_CHANGES.filter((c) => c.okr_key_result_id === kr.okr_key_result_id),
    trace: traceOf(kr),
    performance_period_id: o.performance_period_id,
    can_change_target:
      o.plan_status === "binding" &&
      !tbcOpen(kr) &&
      !TARGET_CHANGES.some((c) => c.okr_key_result_id === kr.okr_key_result_id && c.status === "pending") &&
      (isOwner(kr, req) || setsGoalsFor(req, o.department_id)),
    can_edit: open(o.plan_status) && setsGoalsFor(req, o.department_id),
    can_set_target: o.plan_status === "binding" && tbcOpen(kr) && (isOwner(kr, req) || setsGoalsFor(req, o.department_id)),
  };
};

/* Organisational goals, and what each quarter of their year should reach */
const GOAL_TARGETS = new Map<string, OrganisationalGoalTarget[]>();
route("GET /api/v1/performance/goals", (req) =>
  paged(ORG_GOALS, req, {
    search: (g) => [g.code, g.title, g.strategic_theme],
    filters: { plan_year: (g, v) => (g.plan_year_starts_on ?? "").startsWith(v), status: (g, v) => g.status === v },
    sort: { code: (a, b) => (a.code ?? "").localeCompare(b.code ?? ""), title: (a, b) => a.title.localeCompare(b.title), ends_on: (a, b) => a.ends_on.localeCompare(b.ends_on) },
  }),
);
route("GET /api/v1/performance/goals/:id", (req) => {
  const g = ORG_GOALS.find((x) => x.organisational_goal_id === req.params.id);
  if (!g) return notFound();
  const objectives = OBJECTIVES.filter((o) => o.organisational_goal_id === g.organisational_goal_id);
  const scores = objectives.map((o) => o.score).filter((x): x is string => Boolean(x)).map(Number);
  return ok({ ...g, targets: GOAL_TARGETS.get(g.organisational_goal_id) ?? [], objectives: objectives.map((o) => ({ okr_objective_id: o.okr_objective_id, code: o.code, title: o.title })), progress: scores.length ? String(Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 100) / 100) : null });
});
route("POST /api/v1/performance/goals", (req) => {
  if (!isCeo(req)) return fail(403, "PERMISSION_DENIED", "Only the CEO sets organisational goals");
  const b = req.body as Record<string, string | undefined>;
  if (!b.title?.trim()) return invalid({ title: ["Required"] });
  const year = (b.plan_year_starts_on ?? `${new Date().getUTCFullYear()}-01-01`).slice(0, 4);
  // The ID is the next of its plan year, as Documents & Numbering gives it (ORG-2026-05); never typed.
  const taken = ORG_GOALS.map((x) => new RegExp(`^ORG-${year}-(\\d+)$`).exec(x.code ?? "")?.[1]).filter(Boolean).map(Number);
  const g: OrganisationalGoal = {
    organisational_goal_id: sid(`perf:goal:new:${fresh()}`),
    code: `ORG-${year}-${String(Math.max(0, ...taken) + 1).padStart(2, "0")}`,
    title: b.title.trim(),
    strategic_theme: b.strategic_theme || null,
    detail: b.detail || null,
    success_measure: b.success_measure || null,
    reference_target: b.reference_target || null,
    baseline: b.baseline || null,
    key_decisions: b.key_decisions || null,
    function_cascade: b.function_cascade || null,
    plan_year_starts_on: `${year}-01-01`,
    starts_on: `${year}-01-01`,
    ends_on: `${year}-12-31`,
    status: "active",
    owner: refKey("ifeoma"),
    created_at: now(),
    updated_at: now(),
  };
  ORG_GOALS.push(g);
  return created(g);
});
route("PATCH /api/v1/performance/goals/:id", (req) => {
  const g = ORG_GOALS.find((x) => x.organisational_goal_id === req.params.id);
  if (!g) return notFound();
  if (!isCeo(req)) return fail(403, "PERMISSION_DENIED", "Only the CEO changes organisational goals");
  const { targets, ...rest } = req.body as Record<string, unknown> & { targets?: Array<{ performance_period_id: string; target_text?: string; target_value?: string }> };
  if (typeof rest.title === "string" && !rest.title.trim()) return invalid({ title: ["Required"] });
  Object.assign(g, Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === "" ? null : v])), { updated_at: now() });
  if (targets) {
    const held = GOAL_TARGETS.get(g.organisational_goal_id) ?? [];
    for (const t of targets) {
      const period = PERIODS.find((p) => p.performance_period_id === t.performance_period_id);
      const row: OrganisationalGoalTarget = {
        organisational_goal_target_id: sid(`perf:goal-target:${g.organisational_goal_id}:${t.performance_period_id}`),
        performance_period_id: t.performance_period_id,
        period_name: period?.name ?? "",
        target_text: t.target_text || null,
        target_value: t.target_value || null,
      };
      const at = held.findIndex((x) => x.performance_period_id === t.performance_period_id);
      if (at >= 0) held[at] = row;
      else held.push(row);
    }
    GOAL_TARGETS.set(g.organisational_goal_id, held);
  }
  return ok(g);
});
route("DELETE /api/v1/performance/goals/:id", (req) => {
  const at = ORG_GOALS.findIndex((x) => x.organisational_goal_id === req.params.id);
  if (at < 0) return notFound();
  if (!isCeo(req)) return fail(403, "PERMISSION_DENIED", "Only the CEO removes organisational goals");
  if (OBJECTIVES.some((o) => o.department_id === null && o.organisational_goal_id === req.params.id)) return fail(409, "GOAL_IN_USE", "A company objective serves this goal");
  ORG_GOALS.splice(at, 1);
  GOAL_TARGETS.delete(req.params.id);
  return noContent();
});

/* Objectives and key results */
route("GET /api/v1/performance/okrs", (req) =>
  paged(
    OBJECTIVES.map((o) => withCan(o, req)),
    req,
    {
      search: (o) => [o.code, o.title, ...o.key_results.flatMap((k) => [k.code, k.statement])],
      filters: { period_id: (o, v) => o.performance_period_id === v, department_id: (o, v) => (v === "company" ? o.department_id === null : o.department_id === v), status: (o, v) => o.plan_status === v },
      sort: { position: (a, b) => (a.department ?? "").localeCompare(b.department ?? "") || a.position - b.position, code: (a, b) => a.code.localeCompare(b.code) },
    },
  ),
);
route("GET /api/v1/performance/okrs/summary", (req) => {
  const q = req.query as { period_id?: string; department_id?: string };
  const all = OBJECTIVES.filter((o) => o.performance_period_id === q.period_id);
  const company = all.filter((o) => o.department_id === null).map(objectiveScore).filter((x): x is string => x !== null).map(Number);
  const wanted = q.department_id === "company" ? all.filter((o) => o.department_id === null) : q.department_id ? all.filter((o) => o.department_id === q.department_id) : all;
  const krs = wanted.flatMap((o) => o.key_results);
  return ok({
    company_score: company.length ? String(Math.round((company.reduce((x, y) => x + y, 0) / company.length) * 100) / 100) : null,
    key_results: krs.length,
    on_track: krs.filter((k) => k.latest?.band === "good").length,
    in_recovery: krs.filter((k) => k.latest?.band === "recovery").length,
    awaiting_report: krs.filter((k) => !k.latest).length,
  });
});
route("POST /api/v1/performance/objectives", (req) => {
  const b = req.body as { performance_period_id?: string; department_id?: string; title?: string; organisational_goal_id?: string };
  if (!b.title?.trim()) return invalid({ title: ["Required"] });
  const periodId = b.performance_period_id || PERIOD.performance_period_id;
  const dept = b.department_id || null;
  const plan = planOf(periodId, dept);
  if (!open(plan.status))
    return fail(409, "PLAN_BINDING", "This plan is sent or binding: change a target instead", {
      department_id: [plan.status === "submitted" ? "Plan awaits approval" : "Plan is binding"],
    });
  const prefix = dept === null ? "CO" : dept === deptId ? "BM" : "FN";
  const used = new Set(OBJECTIVES.filter((o) => o.code.startsWith(`${prefix}-O`)).map((o) => Number(o.code.split("-O")[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  const o: Objective = {
    okr_objective_id: sid(`perf:obj:new:${fresh()}`),
    performance_period_id: periodId,
    performance_plan_id: plan.performance_plan_id,
    department_id: dept,
    department: plan.department,
    code: `${prefix}-O${n}`,
    title: b.title.trim(),
    organisational_goal_id: b.organisational_goal_id || null,
    position: OBJECTIVES.filter((x) => x.performance_plan_id === plan.performance_plan_id).length,
    plan_status: plan.status,
    score: null,
    key_results: [],
    can_edit: false,
  };
  OBJECTIVES.push(o);
  plan.objective_count += 1;
  return created(withCan(o, req));
});
route("GET /api/v1/performance/objectives/:id", (req) => {
  const o = OBJECTIVES.find((x) => x.okr_objective_id === req.params.id);
  return o ? ok(withCan(o, req)) : notFound();
});
route("PATCH /api/v1/performance/objectives/:id", (req) => {
  const o = OBJECTIVES.find((x) => x.okr_objective_id === req.params.id);
  if (!o) return notFound();
  if (!open(o.plan_status)) return fail(409, "PLAN_BINDING", "This plan is sent or binding: change a target instead");
  if (!setsGoalsFor(req, o.department_id)) return fail(403, "PERMISSION_DENIED", "Only the function's head sets its goals");
  Object.assign(o, fieldsOf(req.body, ["title", "organisational_goal_id", "position"]));
  return ok(withCan(o, req));
});
route("DELETE /api/v1/performance/objectives/:id", (req) => {
  const i = OBJECTIVES.findIndex((x) => x.okr_objective_id === req.params.id);
  if (i < 0) return notFound();
  if (!open(OBJECTIVES[i].plan_status)) return fail(409, "PLAN_BINDING", "This plan is sent or binding: change a target instead");
  if (!setsGoalsFor(req, OBJECTIVES[i].department_id)) return fail(403, "PERMISSION_DENIED", "Only the function's head sets its goals");
  const plan = PLANS.find((p) => p.performance_plan_id === OBJECTIVES[i].performance_plan_id);
  if (plan) plan.objective_count = Math.max(0, plan.objective_count - 1);
  OBJECTIVES.splice(i, 1);
  return noContent();
});
route("POST /api/v1/performance/key-results", (req) => {
  const b = req.body as Record<string, unknown>;
  const o = OBJECTIVES.find((x) => x.okr_objective_id === b.okr_objective_id);
  if (!o) return invalid({ okr_objective_id: ["Pick an objective"] });
  if (!String(b.statement ?? "").trim()) return invalid({ statement: ["Required"] });
  if (!open(o.plan_status)) return fail(409, "PLAN_NOT_OPEN", "The plan is sent or binding");
  if (o.key_results.length >= 4) return fail(422, "OBJECTIVE_TOO_MANY", "An objective holds at most 4 key results", { okr_objective_id: ["Already has 4"] });
  const used = new Set(o.key_results.map((k) => Number(k.code.split(".")[1])));
  let n = 1;
  while (used.has(n)) n += 1;
  const owner = byId(b.accountable_employee_id as string | undefined);
  const k: KeyResult = {
    okr_key_result_id: sid(`perf:kr:new:${fresh()}`),
    okr_objective_id: o.okr_objective_id,
    code: `${o.code.replace("-O", "-KR")}.${n}`,
    statement: String(b.statement).trim(),
    kr_type: null,
    measure: "numeric",
    direction: "higher",
    unit: null,
    baseline_text: null,
    target_value: null,
    target_text: null,
    target_provisional: false,
    target_locked_at: null,
    parts: null,
    starts_on: null,
    finishes_on: null,
    accountable: owner ? refKey(owner.user_key) : null,
    co_accountable: null,
    accountable_note: null,
    scored_from_key_result_id: null,
    linked_company_key_results: [],
    position: o.key_results.length,
    latest: null,
    ...(fieldsOf(b, KR_KEYS) as Partial<KeyResult>),
    ...krPeopleAndLinks(b),
  };
  o.key_results.push(k);
  return created(k);
});
route("GET /api/v1/performance/key-results", (req) => {
  const q = req.query as { period_id?: string; level?: string; department_id?: string };
  const refs = allKrs()
    .filter((k) => {
      const o = objectiveOf(k);
      return (!q.period_id || o.performance_period_id === q.period_id) && (!q.level || (q.level === "company") === (o.department_id === null)) && (!q.department_id || o.department_id === q.department_id);
    })
    .map((k) => ({ okr_key_result_id: k.okr_key_result_id, code: k.code, statement: k.statement }));
  // The filters are applied above, where each key result's objective is known.
  return paged(refs, req, { filters: { period_id: () => true, level: () => true, department_id: () => true }, search: (k) => [k.code, k.statement], sort: { code: (a, b) => a.code.localeCompare(b.code) } });
});
route("GET /api/v1/performance/key-results/:id", (req) => {
  const k = krById(req.params.id);
  return k ? ok(krDetail(k, req)) : notFound();
});
route("GET /api/v1/performance/key-results/:id/trace", (req) => {
  const k = krById(req.params.id);
  return k ? ok(traceOf(k)) : notFound();
});
route("PATCH /api/v1/performance/key-results/:id", (req) => {
  const k = krById(req.params.id);
  if (!k) return notFound();
  const o = objectiveOf(k);
  const b = req.body as Record<string, unknown>;
  if (open(o.plan_status)) {
    if (!setsGoalsFor(req, o.department_id)) return fail(403, "PERMISSION_DENIED", "Only the function's head sets its goals");
  } else {
    const onlyTarget = Object.keys(b).every((x) => ["target_value", "target_text", "target_provisional"].includes(x));
    if (!(tbcOpen(k) && onlyTarget && (isOwner(k, req) || setsGoalsFor(req, o.department_id)))) return fail(409, "KEY_RESULT_BINDING", "This key result is binding: change its target instead");
  }
  Object.assign(k, fieldsOf(b, KR_KEYS), krPeopleAndLinks(b));
  return ok(k);
});
route("DELETE /api/v1/performance/key-results/:id", (req) => {
  const k = krById(req.params.id);
  if (!k) return notFound();
  const o = objectiveOf(k);
  if (!open(o.plan_status)) return fail(409, "PLAN_BINDING", "This plan is sent or binding: change a target instead");
  if (!setsGoalsFor(req, o.department_id)) return fail(403, "PERMISSION_DENIED", "Only the function's head sets its goals");
  o.key_results = o.key_results.filter((x) => x !== k);
  return noContent();
});
route("POST /api/v1/performance/key-results/:id/confirm", (req) => {
  const k = krById(req.params.id);
  if (!k) return notFound();
  if (!isCeo(req)) return fail(403, "PERMISSION_DENIED", "Only the CEO confirms a score");
  const b = req.body as { month?: string; score?: string };
  if (!k.latest || k.latest.month !== b.month) return fail(409, "NOT_REPORTED", "That month is not reported yet");
  Object.assign(k.latest, { confirmed_score: b.score, score: b.score, confirmed_at: now(), confirmed: true });
  return ok(k.latest);
});

/* Report Month */
/** The score a report proposes, as the API works it out: none for a TBC target not yet locked. */
const proposedOf = (k: KeyResult, r: Record<string, string | undefined>) => {
  if (k.target_provisional && !k.target_locked_at) return null;
  if (k.measure === "numeric") {
    const target = Number(k.target_value);
    const actual = Number(r.actual_value);
    return target > 0 && r.actual_value && !Number.isNaN(actual) ? Math.min(1, Math.round((actual / target) * 10000) / 10000) : null;
  }
  return r.status === "done" ? 1 : r.status === "missed" ? 0 : null;
};
route("POST /api/v1/performance/reports", (req) => {
  const b = req.body as { month?: string; department_id?: string | null; key_results?: Array<Record<string, string | undefined>>; kpis?: Array<Record<string, string | undefined>> };
  if (!b.month) return invalid({ month: ["Pick the month"] });
  const rows = b.key_results ?? [];
  const krs = rows.map((r) => krById(r.okr_key_result_id ?? ""));
  if (krs.some((k) => !k || objectiveOf(k).department_id !== (b.department_id ?? null))) return invalid({ key_results: ["Not this function's"] });
  if (!setsGoalsFor(req, b.department_id ?? null)) return fail(403, "PERMISSION_DENIED", "Only the function's head reports its month");
  const missing = Object.fromEntries(
    rows.flatMap((r, i) => {
      const p = proposedOf(krs[i]!, r);
      return p !== null && p < PERIOD.rules.key_results.band_watch && (!r.recovery_employee_id || !r.recovery_due_on) ? [[`key_results.${i}.recovery_employee_id`, ["Name owner and date"]]] : [];
    }),
  );
  if (Object.keys(missing).length) return fail(422, "RECOVERY_REQUIRED", "A key result in Recovery needs an owner and date", missing);
  const months: KeyResultMonth[] = [];
  for (const [i, r] of rows.entries()) {
    const k = krs[i]!;
    const proposed = proposedOf(k, r);
    const score = proposed === null ? null : String(proposed);
    k.latest = {
      okr_key_result_month_id: sid(`perf:krm:${k.code}:${b.month}`),
      okr_key_result_id: k.okr_key_result_id,
      month: b.month,
      status: r.status as KeyResultMonth["status"],
      actual_value: r.actual_value || null,
      actual_text: r.actual_text || null,
      actual_source: r.actual_source || null,
      update_text: r.update_text || null,
      recovery_employee_id: r.recovery_employee_id || null,
      recovery_due_on: r.recovery_due_on || null,
      proposed_score: score,
      confirmed_score: null,
      confirmed_at: null,
      score,
      band: score === null ? null : Number(score) >= PERIOD.rules.key_results.band_good ? "good" : Number(score) >= PERIOD.rules.key_results.band_watch ? "watch" : "recovery",
      confirmed: false,
    };
    months.push(k.latest);
  }
  const kpiMonths: KpiMonth[] = [];
  for (const r of b.kpis ?? []) {
    const kpi = FUNCTION_KPIS.find((x) => x.kpi_definition_id === r.kpi_definition_id);
    if (kpi) kpiMonths.push(recordKpi(req, kpi, { ...r, month: b.month }));
  }
  return ok({ month: b.month, key_results: months, kpis: kpiMonths });
});

/* Plans */
const cardRow = ({ scope_text: _s, reviewer_reason: _r, disagree_reason: _d, results_weight: _a, kpis_weight: _b, accountability_weight: _c, lines: _l, weight_problems: _w, contributions: _x, can_edit: _e, can_agree: _g, can_send: _n, amendment_instance_id: _m, ...row }: ScorecardDetail): Scorecard => row;
const planProblems = (p: Plan) => {
  const objectives = OBJECTIVES.filter((o) => o.performance_plan_id === p.performance_plan_id);
  const out: PlanDetail["problems"] = [];
  if (!objectives.length) out.push({ code: "PLAN_EMPTY", message: "Set at least one objective", blocking: true });
  for (const o of objectives) if (o.key_results.length === 1) out.push({ code: "OBJECTIVE_ONE_RESULT", message: `${o.code} has one key result`, blocking: false });
  for (const c of SCORECARDS.filter((s) => s.department_id === p.department_id && s.performance_period_id === p.performance_period_id))
    if (weightProblems(c).length) out.push({ code: "WEIGHTS_NOT_100", message: `${c.employee.display_name}'s weights do not total 100`, blocking: true });
  return out;
};
const planDetail = (req: Req, p: Plan): PlanDetail => {
  // A sent plan was clear when it went; what is left to fix is worked out while it is open.
  const problems = open(p.status) ? planProblems(p) : [];
  const me = meOf(req);
  const head = p.department_id === deptId ? me?.user_key === "ngozi" : isCeo(req);
  return {
    ...p,
    objective_count: OBJECTIVES.filter((o) => o.performance_plan_id === p.performance_plan_id).length,
    objectives: OBJECTIVES.filter((o) => o.performance_plan_id === p.performance_plan_id).map((o) => ({ ...o, score: objectiveScore(o) })),
    kpis: FUNCTION_KPIS.filter((k) => k.department_id === p.department_id),
    scorecards: SCORECARDS.filter((s) => s.department_id === p.department_id && s.performance_period_id === p.performance_period_id).map(cardRow),
    contributions: CONTRIBUTIONS,
    problems,
    can_submit: open(p.status) && (head || isCeo(req)) && !problems.some((x) => x.blocking),
  };
};
route("GET /api/v1/performance/plans", (req) =>
  paged(PLANS, req, {
    filters: { period_id: (p, v) => p.performance_period_id === v, status: (p, v) => p.status === v, department_id: (p, v) => (v === "company" ? p.department_id === null : p.department_id === v) },
    sort: { department: (a, b) => (a.department ?? "").localeCompare(b.department ?? ""), status: (a, b) => a.status.localeCompare(b.status) },
  }),
);
/**
 * GET /performance/functions: the company first, then each function by name, whether the reader may
 * set its goals and KPIs as the API's goals.authority answers (the CEO everything; goals.company the
 * company's; goals.function with performance.manage, or as the function's head, a function's), and
 * its plan's status in the quarter asked for.
 */
route("GET /api/v1/performance/functions", (req) => {
  const caps = me(req.user ?? "").capabilities;
  const periodId = req.query.period_id || null;
  const maySet = (departmentId: string | null) =>
    isCeo(req) ||
    (departmentId === null ? caps.includes("goals.company") : caps.includes("goals.function") && (caps.includes("performance.manage") || setsGoalsFor(req, departmentId)));
  const statusOf = (departmentId: string | null) =>
    (periodId && PLANS.find((p) => p.performance_period_id === periodId && p.department_id === departmentId)?.status) || null;
  const rows: PerformanceFunction[] = [null, ...[...DEPARTMENTS].sort((a, b) => a.localeCompare(b))].map((name) => {
    const id = name === null ? null : sid(`dept:${name}`);
    return { department_id: id, name, may_set: maySet(id), plan_status: statusOf(id) };
  });
  // The quarter names each plan; it narrows nothing.
  return paged(rows, req, { filters: { period_id: () => true } });
});
route("GET /api/v1/performance/plans/:id", (req) => {
  const p = PLANS.find((x) => x.performance_plan_id === req.params.id);
  return p ? ok(planDetail(req, p)) : notFound();
});
route("POST /api/v1/performance/plans/:id/submit", (req) => {
  const p = PLANS.find((x) => x.performance_plan_id === req.params.id);
  if (!p) return notFound();
  const d = planDetail(req, p);
  if (!d.can_submit) return fail(409, "PLAN_NOT_READY", d.problems.find((x) => x.blocking)?.message ?? "The plan cannot be sent");
  const wid = sid(`perf:wf:plan:${p.performance_plan_id}:${fresh()}`);
  const sentBy = req.user!;
  FLOWS.push({ wid, planId: p.performance_plan_id, stages: stagesFor(p, sentBy), at: 0, by: sentBy, entered: now(), opened: now(), moves: [] });
  Object.assign(p, { status: "submitted", workflow_instance_id: wid, submitted_by: refKey(sentBy), submitted_at: now(), returned_reason: null, updated_at: now() });
  for (const o of OBJECTIVES) if (o.performance_plan_id === p.performance_plan_id) o.plan_status = "submitted";
  return ok(planDetail(req, p));
});
route("GET /api/v1/performance/contributions", (req) => paged(CONTRIBUTIONS, req, { filters: { plan_id: () => true, key_result_id: (c, v) => c.okr_key_result_id === v }, sort: { code: (a, b) => a.code.localeCompare(b.code) } }));

/* Target changes */
route("GET /api/v1/performance/target-changes", (req) =>
  paged(TARGET_CHANGES, req, {
    filters: { status: (c, v) => c.status === v, okr_key_result_id: (c, v) => c.okr_key_result_id === v, employee_target_id: (c, v) => c.employee_target_id === v },
    sort: { created_at: (a, b) => b.created_at.localeCompare(a.created_at) },
  }),
);
/** A scorecard line and its scorecard, by the line's id. */
const lineById = (id: string | null | undefined) => {
  for (const c of SCORECARDS) {
    const l = c.lines.find((x) => x.employee_target_id === id);
    if (l) return { card: c, line: l };
  }
  return null;
};
route("POST /api/v1/performance/target-changes", (req) => {
  const b = req.body as Record<string, string | undefined>;
  const k = b.okr_key_result_id ? krById(b.okr_key_result_id) : undefined;
  if (b.okr_key_result_id && !k) return invalid({ okr_key_result_id: ["Pick a key result"] });
  if (k && tbcOpen(k)) return fail(409, "TARGET_TBC", "Set this TBC target directly");
  const found = b.employee_target_id ? lineById(b.employee_target_id) : null;
  if (b.employee_target_id && !found) return notFound();
  // A line's target is changed by its scorecard's reviewer or the function's head, never its employee (§3.5).
  if (found && !mayChangeLine(req, found.card)) return fail(403, "PERMISSION_DENIED", "The reviewer or the function's head changes this target");
  if (!b.to_value && !b.to_text) return invalid({ to_value: ["Enter the new target"] });
  if (!b.reason?.trim()) return invalid({ reason: ["Required"] });
  if (TARGET_CHANGES.some((x) => x.status === "pending" && x.okr_key_result_id === (b.okr_key_result_id || null) && x.employee_target_id === (b.employee_target_id || null)))
    return fail(409, "CHANGE_PENDING", "A change to this target is already waiting for a decision");
  const c: TargetChange = {
    target_change_id: sid(`perf:change:${fresh()}`),
    okr_key_result_id: b.okr_key_result_id || null,
    employee_target_id: b.employee_target_id || null,
    from_value: k?.target_value ?? found?.line.target_value ?? null,
    from_text: k?.target_text ?? found?.line.target_text ?? null,
    to_value: b.to_value || null,
    to_text: b.to_text || null,
    from_month: b.from_month ?? PERIOD.months[0],
    reason: b.reason.trim(),
    status: "pending",
    workflow_instance_id: sid(`perf:wf:change:${fresh()}`),
    requested_by: meOf(req) ? refKey(req.user!) : null,
    decided_at: null,
    created_at: now(),
  };
  TARGET_CHANGES.unshift(c);
  return created(c);
});

route("GET /api/v1/performance/target-changes/:id", (req) => {
  const c = TARGET_CHANGES.find((x) => x.target_change_id === req.params.id);
  if (!c) return notFound();
  const k = c.okr_key_result_id ? krById(c.okr_key_result_id) : undefined;
  const found = lineById(c.employee_target_id);
  const detail: TargetChangeDetail = {
    ...c,
    key_result: k ? { okr_key_result_id: k.okr_key_result_id, code: k.code, statement: k.statement } : null,
    unit: k?.unit ?? found?.line.unit ?? null,
    line: found ? { employee_target_id: found.line.employee_target_id, title: found.line.title, employee: found.card.employee } : null,
    department: k ? objectiveOf(k).department : (found?.card.department ?? null),
    period_name: PERIOD.name,
  };
  return ok(detail);
});

/*
 * Approvals: a plan's stages and a target change's, decided through the workflow mock
 * (organisation.ts), as performance.plan and performance.target_change read. A function's plan
 * goes to its head's line manager unless that is the CEO, then to Operations & People unless they
 * sent it, then to the CEO; the company plan and every target change to the CEO, who may also
 * decide any stage. 72 hours a stage. A scorecard drafted after its plan bound goes through its
 * plan's stages on its own (§11): its flow names the scorecard; approved, it binds.
 */
type PlanStage = "line_manager" | "operations_people" | "ceo";
const STAGE_NAMES: Record<PlanStage, string> = { line_manager: "Line Manager", operations_people: "Operations & People", ceo: "CEO" };
const STAGE_HOURS = 72;
type Move = { stage: PlanStage; decision: "approve" | "reject"; by: string; reason: string | null; at: string };
type Flow = { wid: string; planId: string; scorecardId?: string; stages: PlanStage[]; at: number; by: string; entered: string; opened: string; moves: Move[] };
const FLOWS: Flow[] = [
  { wid: sid("perf:wf:plan:content"), planId: sid("perf:plan:content"), stages: ["operations_people", "ceo"], at: 0, by: "tolu", entered: at(1, "11:00"), opened: at(1, "11:00"), moves: [] },
  {
    wid: GRACE_CARD.amendment_instance_id!,
    planId: PLANS[0].performance_plan_id,
    scorecardId: GRACE_CARD.scorecard_id,
    stages: ["operations_people", "ceo"],
    at: 0,
    by: "ngozi",
    entered: at(2, "10:00"),
    opened: at(2, "10:00"),
    moves: [],
  },
];
const CHANGE_MOVES: Record<string, Move> = {};
const planById = (id: string) => PLANS.find((p) => p.performance_plan_id === id);
const headKeyOf = (p: Plan) => (p.department_id === deptId ? "ngozi" : p.department === "Content" ? "tolu" : null);
const keyOf = (ref: { employee_id: string } | null) => (ref ? byId(ref.employee_id)?.user_key ?? null : null);
function stagesFor(p: Plan, sentBy: string): PlanStage[] {
  if (!p.department_id) return ["ceo"];
  const head = headKeyOf(p);
  const manager = head ? byKey(head)?.manager : null;
  return [...(manager && manager !== "ifeoma" ? (["line_manager"] as const) : []), ...(sentBy === "cynthia" ? [] : (["operations_people"] as const)), "ceo"];
}
const approverOf = (f: Flow, stage: PlanStage) => {
  if (stage === "ceo") return "ifeoma";
  if (stage === "operations_people") return "cynthia";
  const p = planById(f.planId);
  return p ? byKey(headKeyOf(p) ?? "")?.manager ?? null : null;
};
const cardOfFlow = (f: Flow) => (f.scorecardId ? SCORECARDS.find((c) => c.scorecard_id === f.scorecardId) : undefined);
const pending = (f: Flow) =>
  f.scorecardId
    ? cardOfFlow(f)?.status === "draft" && AMENDMENTS.get(f.scorecardId) === f.wid
    : planById(f.planId)?.status === "submitted" && planById(f.planId)?.workflow_instance_id === f.wid;
const waitsOnPlan = (f: Flow, user: string) => pending(f) && f.by !== user && approverOf(f, f.stages[f.at]) === user;
const mayDecidePlan = (f: Flow, user: string) => pending(f) && (user === "ifeoma" || (f.by !== user && approverOf(f, f.stages[f.at]) === user));
const dueOf = (entered: string) => new Date(Date.parse(entered) + STAGE_HOURS * 3600000).toISOString();
const APPROVER_VIEW: Record<PlanStage, ApprovalInstance["route"][number]["approvers"][number]> = {
  line_manager: { type: "manager_of_subject", value: null, label: "Line Manager" },
  operations_people: { type: "role", value: "operations_people", label: "Operations & People" },
  ceo: { type: "ceo", value: null, label: "CEO" },
};
const decisionsOf = (wid: string, moves: Move[]): ApprovalInstance["decisions"] =>
  moves.map((m, i) => ({
    workflow_decision_id: sid(`${wid}:${i}`),
    stage_key: m.stage,
    stage_name: STAGE_NAMES[m.stage],
    actor_id: byKey(m.by)?.employee_id ?? null,
    actor_name: byKey(m.by)?.display_name ?? null,
    decision: m.decision,
    reason: m.reason,
    decided_at: m.at,
  }));

function planInstance(user: string, f: Flow): ApprovalInstance {
  const p = planById(f.planId)!;
  const head = byKey(headKeyOf(p) ?? "");
  const open = pending(f);
  const stateOf = (k: PlanStage): ApprovalInstance["route"][number]["state"] => {
    const i = f.stages.indexOf(k);
    if (i < 0) return "skipped";
    const move = f.moves.find((m) => m.stage === k);
    if (move) return move.decision === "approve" ? "done" : "stopped";
    return open ? (i === f.at ? "now" : "todo") : "skipped";
  };
  const state = open ? "pending" : f.moves.some((m) => m.decision === "reject") ? "rejected" : "approved";
  const card = cardOfFlow(f);
  return {
    workflow_instance_id: f.wid,
    definition_key: "performance.plan",
    definition_name: "Quarter Plan",
    version: 1,
    module_key: "performance",
    entity_type: card ? "scorecard" : "performance_plan",
    entity_id: card ? card.scorecard_id : p.performance_plan_id,
    subject_employee_id: head?.employee_id ?? null,
    subject_name: head?.display_name ?? null,
    state,
    current_stage: open ? f.stages[f.at] : null,
    stage_name: open ? STAGE_NAMES[f.stages[f.at]] : null,
    context: { head_reports_to_ceo: !f.stages.includes("line_manager"), by_operations_people: f.by === "cynthia", is_company: !p.department_id },
    stage_entered_at: f.entered,
    stage_due_at: open ? dueOf(f.entered) : null,
    opened_by: null,
    opened_by_name: byKey(f.by)?.display_name ?? null,
    opened_at: f.opened,
    completed_at: open ? null : (f.moves.at(-1)?.at ?? null),
    route: (["line_manager", "operations_people", "ceo"] as PlanStage[]).map((k) => ({ key: k, name: STAGE_NAMES[k], state: stateOf(k), approvers: [APPROVER_VIEW[k]] })),
    decisions: decisionsOf(f.wid, f.moves),
    can_decide: mayDecidePlan(f, user),
    can_withdraw: false,
    can_reassign: false,
    link: card ? `/performance?tab=targets&id=${card.scorecard_id}` : `/performance?tab=goals&plan=${p.performance_plan_id}`,
  };
}

function changeInstance(user: string, c: TargetChange): ApprovalInstance {
  const asker = byKey(keyOf(c.requested_by) ?? "");
  const move = CHANGE_MOVES[c.workflow_instance_id ?? ""];
  const open = c.status === "pending";
  return {
    workflow_instance_id: c.workflow_instance_id!,
    definition_key: "performance.target_change",
    definition_name: "Target Change",
    version: 1,
    module_key: "performance",
    entity_type: "target_change",
    entity_id: c.target_change_id,
    subject_employee_id: asker?.employee_id ?? null,
    subject_name: asker?.display_name ?? null,
    state: open ? "pending" : c.status === "approved" ? "approved" : "rejected",
    current_stage: open ? "ceo" : null,
    stage_name: open ? "CEO" : null,
    context: {},
    stage_entered_at: c.created_at,
    stage_due_at: open ? dueOf(c.created_at) : null,
    opened_by: null,
    opened_by_name: asker?.display_name ?? null,
    opened_at: c.created_at,
    completed_at: c.decided_at,
    route: [{ key: "ceo", name: "CEO", state: open ? "now" : move?.decision === "reject" ? "stopped" : "done", approvers: [APPROVER_VIEW.ceo] }],
    decisions: move ? decisionsOf(c.workflow_instance_id!, [move]) : [],
    can_decide: open && user === "ifeoma",
    can_withdraw: false,
    can_reassign: false,
    link: `/performance?tab=goals&change=${c.target_change_id}`,
  };
}

/** A plan's or a target change's request, or null when the instance is neither (the workflow mock passes it on). */
export function performanceInstance(user: string, wid: string): ApprovalInstance | null {
  const f = FLOWS.find((x) => x.wid === wid);
  if (f) return planInstance(user, f);
  const c = TARGET_CHANGES.find((x) => x.workflow_instance_id === wid);
  return c ? changeInstance(user, c) : null;
}

/** Decide a plan's stage, or null when the instance is not a plan's. Request Changes is a refusal: the plan comes back Returned. */
export function decidePlan(user: string, wid: string, approve: boolean, reason?: string | null) {
  const f = FLOWS.find((x) => x.wid === wid);
  if (!f) return null;
  const p = planById(f.planId);
  if (!p || !pending(f)) return fail(409, "WORKFLOW_CLOSED", "This approval is already decided");
  if (!mayDecidePlan(f, user)) return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  const why = String(reason ?? "").trim();
  if (!approve && !why) return invalid({ reason: ["is required"] });
  f.moves.push({ stage: f.stages[f.at], decision: approve ? "approve" : "reject", by: user, reason: why || null, at: now() });
  const card = cardOfFlow(f);
  if (card) {
    // A scorecard on its own: the last approval binds it; Request Changes leaves it a draft to change and send again.
    if (approve && f.at < f.stages.length - 1) {
      f.at += 1;
      f.entered = now();
    } else {
      AMENDMENTS.delete(card.scorecard_id);
      if (approve) Object.assign(card, { status: "binding", updated_at: now() });
    }
    return ok(planInstance(user, f));
  }
  const settle = (status: Plan["status"]) => {
    Object.assign(p, { status, updated_at: now(), ...(status === "binding" ? { binding_at: now() } : { returned_reason: why }) });
    for (const o of OBJECTIVES) if (o.performance_plan_id === p.performance_plan_id) o.plan_status = status;
  };
  if (!approve) settle("returned");
  else if (f.at < f.stages.length - 1) {
    f.at += 1;
    f.entered = now();
  } else settle("binding");
  return ok(planInstance(user, f));
}

/** Decide a target change, or null when the instance is not one: the CEO's alone. An approved change sets the key result's target. */
export function decideTargetChange(user: string, wid: string, approve: boolean, reason?: string | null) {
  const c = TARGET_CHANGES.find((x) => x.workflow_instance_id === wid);
  if (!c) return null;
  if (c.status !== "pending") return fail(409, "WORKFLOW_CLOSED", "This approval is already decided");
  if (user !== "ifeoma") return fail(403, "PERMISSION_DENIED", "You are not an approver for this stage");
  const why = String(reason ?? "").trim();
  if (!approve && !why) return invalid({ reason: ["is required"] });
  CHANGE_MOVES[wid] = { stage: "ceo", decision: approve ? "approve" : "reject", by: user, reason: why || null, at: now() };
  Object.assign(c, { status: approve ? "approved" : "rejected", decided_at: now() });
  const k = approve && c.okr_key_result_id ? krById(c.okr_key_result_id) : undefined;
  if (k) Object.assign(k, { target_value: c.to_value, target_text: c.to_text, target_provisional: false });
  const found = approve ? lineById(c.employee_target_id) : null;
  if (found) Object.assign(found.line, { target_value: c.to_value, target_text: c.to_text });
  return ok(changeInstance(user, c));
}

/** The approvals waiting on this login, oldest first: Goals · Waiting On You. */
function approvalsFor(user: string): PerformanceApproval[] {
  const plans = FLOWS.filter((f) => waitsOnPlan(f, user)).map((f): PerformanceApproval => {
    const p = planById(f.planId)!;
    const card = cardOfFlow(f);
    return {
      kind: card ? "scorecard" : "plan",
      record_id: card ? card.scorecard_id : p.performance_plan_id,
      workflow_instance_id: f.wid,
      period_name: p.period_name,
      department: p.department,
      key_result_code: null,
      line_title: null,
      employee: card ? card.employee : null,
      requested_by: refKey(f.by),
      stage_name: STAGE_NAMES[f.stages[f.at]],
      waiting_since: f.entered,
      overdue: Date.parse(dueOf(f.entered)) < Date.now(),
    };
  });
  const changes = user === "ifeoma"
    ? TARGET_CHANGES.filter((c) => c.status === "pending" && c.workflow_instance_id && keyOf(c.requested_by) !== user).map((c): PerformanceApproval => {
        const k = c.okr_key_result_id ? krById(c.okr_key_result_id) : undefined;
        const found = lineById(c.employee_target_id);
        return {
          kind: "target_change",
          record_id: c.target_change_id,
          workflow_instance_id: c.workflow_instance_id!,
          period_name: PERIOD.name,
          department: k ? objectiveOf(k).department : (found?.card.department ?? null),
          key_result_code: k?.code ?? null,
          line_title: found?.line.title ?? null,
          employee: found?.card.employee ?? null,
          requested_by: c.requested_by,
          stage_name: "CEO",
          waiting_since: c.created_at,
          overdue: Date.parse(dueOf(c.created_at)) < Date.now(),
        };
      })
    : [];
  return [...plans, ...changes].sort((a, b) => a.waiting_since.localeCompare(b.waiting_since));
}
route("GET /api/v1/performance/approvals", (req) =>
  paged(approvalsFor(req.user!), req, { search: (r) => [r.department ?? "Company", r.key_result_code, r.line_title, r.employee?.display_name, r.requested_by?.display_name] }),
);

/** The same requests as Home's Need You rows (GET /workflow/mine). */
export function performanceWaitingOn(user: string): ApprovalWaiting[] {
  return approvalsFor(user).map((r) => {
    const flow = r.kind !== "target_change" ? FLOWS.find((f) => f.wid === r.workflow_instance_id) : undefined;
    const plan = flow ? planById(flow.planId) : undefined;
    const head = plan ? byKey(headKeyOf(plan) ?? "") : undefined;
    const link =
      r.kind === "plan" ? `/performance?tab=goals&plan=${r.record_id}` : r.kind === "scorecard" ? `/performance?tab=targets&id=${r.record_id}` : `/performance?tab=goals&change=${r.record_id}`;
    return {
      workflow_instance_id: r.workflow_instance_id,
      definition_key: r.kind === "target_change" ? "performance.target_change" : "performance.plan",
      definition_name: r.kind === "target_change" ? "Target Change" : "Quarter Plan",
      module_key: "performance",
      entity_type: r.kind === "plan" ? "performance_plan" : r.kind === "scorecard" ? "scorecard" : "target_change",
      entity_id: r.record_id,
      subject_employee_id: plan ? (head?.employee_id ?? null) : (r.requested_by?.employee_id ?? null),
      subject_name: plan ? (head?.display_name ?? null) : (r.requested_by?.display_name ?? null),
      current_stage: flow ? flow.stages[flow.at] : "ceo",
      stage_name: r.stage_name,
      context: {},
      stage_entered_at: r.waiting_since,
      stage_due_at: dueOf(r.waiting_since),
      overdue: r.overdue,
      opened_by: null,
      opened_by_name: r.requested_by?.display_name ?? null,
      opened_at: r.waiting_since,
      link,
    };
  });
}

/* KPIs */
function recordKpi(req: Req, kpi: Kpi, b: Record<string, string | undefined>): KpiMonth {
  const m: KpiMonth = {
    kpi_month_id: sid(`perf:kpim:${kpi.code}:${b.month}`),
    kpi_definition_id: kpi.kpi_definition_id,
    month: b.month!,
    result: (b.result ?? "na") as KpiMonth["result"],
    actual_value: b.actual_value || null,
    actual_text: b.actual_text || null,
    comment: b.comment || null,
    recorded_by: meOf(req) ? refKey(req.user!) : null,
    recorded_at: now(),
  };
  const months = (KPI_MONTHS[kpi.kpi_definition_id] ??= kpi.latest ? [kpi.latest] : []);
  const i = months.findIndex((x) => x.month === m.month);
  if (i >= 0) months[i] = m;
  else months.push(m);
  months.sort((x, y) => x.month.localeCompare(y.month));
  kpi.latest = months.at(-1) ?? m;
  kpi.updated_at = now();
  return m;
}
const KPI_MONTHS: Record<string, KpiMonth[]> = {};
route("GET /api/v1/performance/kpis", (req) =>
  paged(FUNCTION_KPIS, req, {
    search: (k) => [k.code, k.name],
    filters: { department_id: (k, v) => k.department_id === v, period_id: () => true, active: (k, v) => String(k.active) === v },
    sort: { code: (a, b) => a.code.localeCompare(b.code), name: (a, b) => a.name.localeCompare(b.name) },
  }),
);
route("GET /api/v1/performance/kpis/summary", (req) => {
  const q = req.query as { department_id?: string; month?: string };
  const active = FUNCTION_KPIS.filter((k) => k.active && (!q.department_id || k.department_id === q.department_id));
  const of = (k: Kpi) => (KPI_MONTHS[k.kpi_definition_id] ?? (k.latest ? [k.latest] : [])).find((m) => m.month === q.month);
  return ok({
    kpis: active.length,
    met: active.filter((k) => of(k)?.result === "met").length,
    not_met: active.filter((k) => of(k)?.result === "not_met").length,
    awaiting: active.filter((k) => !of(k)).length,
  });
});
route("GET /api/v1/performance/kpis/:id", (req) => {
  const k = FUNCTION_KPIS.find((x) => x.kpi_definition_id === req.params.id);
  if (!k) return notFound();
  const lines = SCORECARDS.flatMap((c) => c.lines.filter((l) => l.kpi_definition_id === k.kpi_definition_id).map((l) => ({ employee_target_id: l.employee_target_id, scorecard_id: c.scorecard_id, employee: c.employee, title: l.title, weight: l.weight })));
  return ok({ ...k, months: KPI_MONTHS[k.kpi_definition_id] ?? (k.latest ? [k.latest] : []), lines, can_edit: setsGoalsFor(req, k.department_id) });
});
route("POST /api/v1/performance/kpis", (req) => {
  const b = req.body as Record<string, string | undefined>;
  if (!b.name?.trim()) return invalid({ name: ["Required"] });
  if (!b.department_id) return invalid({ department_id: ["Pick the function"] });
  const prefix = b.department_id === deptId ? "BM" : "FN";
  const n = FUNCTION_KPIS.filter((k) => k.code.startsWith(`${prefix}-K`)).length + 1;
  const k: Kpi = {
    kpi_definition_id: sid(`perf:kpi:new:${fresh()}`),
    code: `${prefix}-K${String(n).padStart(2, "0")}`,
    name: b.name.trim(),
    description: b.description || null,
    department_id: b.department_id,
    department: b.department_id === deptId ? DEPT : null,
    formula: b.formula || null,
    unit: b.unit || null,
    direction: (b.direction ?? "higher") as Kpi["direction"],
    target_text: b.target_text || null,
    target_value: b.target_value || null,
    frequency: (b.frequency ?? "monthly") as Kpi["frequency"],
    data_source: b.data_source || null,
    starts_period_id: b.starts_period_id || PERIOD.performance_period_id,
    active: true,
    latest: null,
    created_at: now(),
    updated_at: now(),
  };
  FUNCTION_KPIS.push(k);
  return created(k);
});
route("PATCH /api/v1/performance/kpis/:id", (req) => {
  const k = FUNCTION_KPIS.find((x) => x.kpi_definition_id === req.params.id);
  if (!k) return notFound();
  Object.assign(k, fieldsOf(req.body, ["name", "description", "formula", "unit", "direction", "target_text", "target_value", "frequency", "data_source", "active"]), { updated_at: now() });
  return ok(k);
});
route("POST /api/v1/performance/kpis/:id/actuals", (req) => {
  const k = FUNCTION_KPIS.find((x) => x.kpi_definition_id === req.params.id);
  if (!k) return notFound();
  const b = req.body as Record<string, string | undefined>;
  if (!b.month?.endsWith("-01")) return invalid({ month: ["Pick the month"] });
  if (!b.result) return invalid({ result: ["Pick the result"] });
  return created(recordKpi(req, k, b));
});

/* Scorecards */
const weightProblems = (c: ScorecardDetail) =>
  (["results", "kpis", "accountability"] as const)
    .map((section) => ({ section, total: c.lines.filter((l) => l.section === section).reduce((t, l) => t + Number(l.weight), 0), expected: c[`${section}_weight`] }))
    .filter((w) => Math.abs(w.total - w.expected) > 0.001);
const reviewerOf = (c: ScorecardDetail, req: Req) => c.reviewer?.employee_id === meOf(req)?.employee_id;
/** May the reader ask for a change to this scorecard's lines: its reviewer or the function's head, never its employee? */
const mayChangeLine = (req: Req, c: ScorecardDetail) => {
  const me = meOf(req);
  if (!me || c.employee.employee_id === me.employee_id || (c.status !== "binding" && c.status !== "agreed")) return false;
  const plan = PLANS.find((p) => p.performance_period_id === c.performance_period_id && p.department_id === c.department_id);
  return reviewerOf(c, req) || (plan ? headKeyOf(plan) === me.user_key : false);
};
const cardFor = (req: Req, c: ScorecardDetail): ScorecardDetail => {
  const me = meOf(req);
  const mine = c.employee.employee_id === me?.employee_id;
  const reviewer = reviewerOf(c, req);
  const plan = PLANS.find((p) => p.performance_period_id === c.performance_period_id && p.department_id === c.department_id);
  const agreeable = c.status === "binding" || c.status === "agreed";
  const amendment = AMENDMENTS.get(c.scorecard_id) ?? null;
  const canEdit = c.status === "draft" && (!plan || open(plan.status) || (plan.status === "binding" && !amendment)) && !mine && (isCeo(req) || reviewer);
  const changer = mayChangeLine(req, c);
  return {
    ...c,
    lines: c.lines.map((l) => {
      const waiting = TARGET_CHANGES.find((x) => x.status === "pending" && x.employee_target_id === l.employee_target_id);
      return {
        ...l,
        can_change_target: changer && !waiting,
        pending_change: waiting ? { target_change_id: waiting.target_change_id, to_value: waiting.to_value, to_text: waiting.to_text, from_month: waiting.from_month } : null,
      };
    }),
    line_count: c.lines.length,
    weight_problems: weightProblems(c),
    can_edit: canEdit,
    can_agree: agreeable && ((mine && !c.employee_agreed_at) || (reviewer && !c.reviewer_agreed_at)),
    can_send: canEdit && plan?.status === "binding" && !weightProblems(c).length,
    amendment_instance_id: amendment,
  };
};
/** Scorecards sent after their plan bound, waiting on the plan's flow: scorecard → its instance. Grace's waits from the start. */
const AMENDMENTS = new Map<string, string>([[GRACE_CARD.scorecard_id, GRACE_CARD.amendment_instance_id!]]);
/** The reader's scorecards: the CEO all; anyone else their own, those they review and their team's. */
const visibleCard = (req: Req, c: ScorecardDetail) => {
  const me = meOf(req);
  if (isCeo(req) || !me) return isCeo(req);
  return c.employee.employee_id === me.employee_id || reviewerOf(c, req) || teamOf(me.user_key).some((p) => p.employee_id === c.employee.employee_id);
};
route("GET /api/v1/performance/scorecards", (req) =>
  paged(
    SCORECARDS.filter((c) => visibleCard(req, c)).map((c) => cardRow(cardFor(req, c))),
    req,
    {
      search: (s) => [s.employee.display_name],
      filters: { period_id: (s, v) => s.performance_period_id === v, department_id: (s, v) => s.department_id === v, status: (s, v) => s.status === v, reviewer_id: (s, v) => s.reviewer?.employee_id === v, rating: (s, v) => s.rating === v },
      sort: { employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name), score_to_date: (a, b) => Number(a.score_to_date ?? 0) - Number(b.score_to_date ?? 0) },
    },
  ),
);
route("GET /api/v1/performance/scorecards/:id", (req) => {
  // A line's link opens its scorecard, as the API does.
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id || x.lines.some((l) => l.employee_target_id === req.params.id));
  return c && visibleCard(req, c) ? ok(cardFor(req, c)) : notFound();
});
route("POST /api/v1/performance/scorecards", (req) => {
  const b = req.body as { employee_id?: string; performance_period_id?: string; copy_from?: string };
  const p = byId(b.employee_id);
  if (!p) return invalid({ employee_id: ["Pick the person"] });
  if (p.user_key === req.user) return fail(403, "PERMISSION_DENIED", "Nobody drafts their own scorecard", { employee_id: ["Not your own"] });
  const periodId = b.performance_period_id || PERIOD.performance_period_id;
  if (SCORECARDS.some((c) => c.employee.employee_id === p.employee_id && c.performance_period_id === periodId)) return fail(409, "SCORECARD_EXISTS", "This person already has a scorecard this quarter", { employee_id: ["Already has one"] });
  const id = sid(`perf:card:new:${p.user_key}:${periodId}`);
  const reviewer = managerOf(p);
  const base = (n: number, title: string, weight: string, measure: ScorecardLine["measure"], source: ScorecardLine["source"], target: string | null): ScorecardLine => ({
    employee_target_id: sid(`perf:line:${id}:${n}`),
    scorecard_id: id,
    section: "accountability",
    position: n,
    title,
    measure,
    direction: "higher",
    unit: measure === "standard" ? "%" : null,
    target_value: target,
    target_text: null,
    milestone_due_on: null,
    due_on: null,
    frequency_text: "Monthly",
    weight,
    source,
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
  });
  const c: ScorecardDetail = {
    scorecard_id: id,
    performance_period_id: periodId,
    period_name: (PERIODS.find((x) => x.performance_period_id === periodId) ?? PERIOD).name,
    employee: refKey(p.user_key),
    department_id: sid(`dept:${p.department}`),
    department: p.department,
    status: "draft",
    reviewer: reviewer ? refKey(reviewer.user_key) : null,
    reviewer_role_code: null,
    reviewer_role: null,
    dotted: null,
    employee_agreed_at: null,
    reviewer_agreed_at: null,
    disagreed_at: null,
    score_to_date: null,
    rating: null,
    line_count: 2,
    created_at: now(),
    updated_at: now(),
    scope_text: p.job_title ?? null,
    reviewer_reason: null,
    disagree_reason: null,
    results_weight: 60,
    kpis_weight: 25,
    accountability_weight: 15,
    lines: [base(0, "On-time commitment delivery", "10", "standard", "commitments", "80"), base(1, "Monthly update on time", "5", "binary", "update_on_time", null)],
    weight_problems: [],
    contributions: [],
    can_edit: true,
    can_agree: false,
    can_send: false,
    amendment_instance_id: null,
  };
  SCORECARDS.push(c);
  const plan = planOf(periodId, c.department_id);
  plan.scorecard_count += 1;
  return created(cardFor(req, c));
});
route("PATCH /api/v1/performance/scorecards/:id", (req) => {
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id);
  if (!c) return notFound();
  const b = req.body as { scope_text?: string | null; reviewer_employee_id?: string | null; reviewer_reason?: string; dotted_employee_id?: string | null };
  if ("reviewer_employee_id" in b) {
    if (!b.reviewer_reason?.trim()) return invalid({ reviewer_reason: ["Give a reason"] });
    const r = byId(b.reviewer_employee_id);
    c.reviewer = r ? refKey(r.user_key) : null;
    c.reviewer_reason = b.reviewer_reason.trim();
  }
  if ("scope_text" in b) c.scope_text = b.scope_text ?? null;
  if ("dotted_employee_id" in b) {
    const d = byId(b.dotted_employee_id);
    c.dotted = d ? refKey(d.user_key) : null;
  }
  c.updated_at = now();
  return ok(cardFor(req, c));
});
route("PUT /api/v1/performance/scorecards/:id/lines", (req) => {
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id);
  if (!c) return notFound();
  if (!cardFor(req, c).can_edit) return fail(409, "SCORECARD_NOT_DRAFT", "Only a draft scorecard changes its lines");
  const lines = ((req.body as { lines?: Array<Record<string, unknown>> }).lines ?? []);
  // The checks the API makes on each line (§6.5), by field.
  const MEASURES: Record<string, string[]> = { results: ["numeric", "milestone"], kpis: ["standard", "binary"], accountability: ["standard", "binary"] };
  const problems: Record<string, string[]> = {};
  lines.forEach((l, i) => {
    const at = (k: string) => `lines.${i}.${k}`;
    if (!String(l.title ?? "").trim()) problems[at("title")] = ["Required"];
    if (!MEASURES[String(l.section)]?.includes(String(l.measure))) problems[at("measure")] = [`Pick ${MEASURES[String(l.section)]?.join(" or ") ?? "a measure"}`];
    if (!(Number(l.weight) > 0)) problems[at("weight")] = ["Above zero"];
    else if (Number(l.weight) > 100) problems[at("weight")] = ["At most 100"];
    if (l.source === "key_result" && !l.okr_key_result_id) problems[at("okr_key_result_id")] = ["Link a key result"];
    if (l.source === "function_kpi" && !l.kpi_definition_id) problems[at("kpi_definition_id")] = ["Link a KPI"];
    if (l.measure === "milestone" && !l.milestone_due_on) problems[at("milestone_due_on")] = ["Pick a date"];
  });
  if (Object.keys(problems).length) return invalid(problems);
  c.lines = lines.map((l, i) => {
    const kr = l.okr_key_result_id ? krById(String(l.okr_key_result_id)) : undefined;
    const kpi = l.kpi_definition_id ? FUNCTION_KPIS.find((k) => k.kpi_definition_id === l.kpi_definition_id) : undefined;
    const was = c.lines.find((x) => x.employee_target_id === l.employee_target_id);
    return {
      employee_target_id: was?.employee_target_id ?? sid(`perf:line:${c.scorecard_id}:${fresh()}:${i}`),
      scorecard_id: c.scorecard_id,
      section: l.section as ScorecardLine["section"],
      position: i,
      title: String(l.title).trim(),
      measure: (l.measure ?? "numeric") as ScorecardLine["measure"],
      direction: (l.direction ?? "higher") as ScorecardLine["direction"],
      unit: (l.unit as string) || null,
      target_value: (l.target_value as string) || null,
      target_text: (l.target_text as string) || null,
      milestone_due_on: (l.milestone_due_on as string) || null,
      due_on: (l.due_on as string) || null,
      frequency_text: (l.frequency_text as string) || null,
      weight: String(l.weight ?? "0"),
      source: (l.source ?? "own") as ScorecardLine["source"],
      okr_key_result_id: kr?.okr_key_result_id ?? null,
      key_result: kr ? { okr_key_result_id: kr.okr_key_result_id, code: kr.code, statement: kr.statement } : null,
      kpi_definition_id: kpi?.kpi_definition_id ?? null,
      kpi: kpi ? { kpi_definition_id: kpi.kpi_definition_id, code: kpi.code, name: kpi.name } : null,
      team_key_results: [],
      share_value: (l.share_value as string) || null,
      months: was?.months ?? [],
      score: was?.score ?? null,
      can_change_target: false,
      pending_change: null,
    };
  });
  c.updated_at = now();
  return ok(cardFor(req, c));
});
route("POST /api/v1/performance/scorecards/:id/agree", (req) => {
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id);
  if (!c) return notFound();
  if (c.status !== "binding" && c.status !== "agreed") return fail(409, "SCORECARD_NOT_BINDING", "The plan is not approved yet");
  const mine = c.employee.employee_id === meOf(req)?.employee_id;
  const reviewer = reviewerOf(c, req);
  if (!mine && !reviewer) return fail(403, "PERMISSION_DENIED", "Only the employee and the reviewer agree a scorecard");
  if (mine && !c.employee_agreed_at) c.employee_agreed_at = now();
  if (reviewer && !c.reviewer_agreed_at) c.reviewer_agreed_at = now();
  if (c.employee_agreed_at && c.reviewer_agreed_at) c.status = "agreed";
  c.disagreed_at = null;
  return ok(cardFor(req, c));
});
route("POST /api/v1/performance/scorecards/:id/disagree", (req) => {
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id);
  if (!c) return notFound();
  const reason = String((req.body as { disagree_reason?: string }).disagree_reason ?? "").trim();
  if (!reason) return invalid({ disagree_reason: ["Required"] });
  if (c.employee.employee_id !== meOf(req)?.employee_id) return fail(403, "PERMISSION_DENIED", "Only the employee disagrees");
  Object.assign(c, { status: "binding", employee_agreed_at: null, reviewer_agreed_at: null, disagreed_at: now(), disagree_reason: reason });
  return ok(cardFor(req, c));
});

/** Send Scorecard: a scorecard drafted after its plan bound goes through the plan's flow on its own (§6.4). */
route("POST /api/v1/performance/scorecards/:id/submit", (req) => {
  const c = SCORECARDS.find((x) => x.scorecard_id === req.params.id);
  if (!c) return notFound();
  const plan = PLANS.find((p) => p.performance_period_id === c.performance_period_id && p.department_id === c.department_id);
  if (!plan || plan.status !== "binding") return fail(409, "PLAN_NOT_BINDING", "Send the function's plan instead");
  const d = cardFor(req, c);
  if (!d.can_edit) return fail(409, "SCORECARD_LOCKED", "This scorecard is already sent");
  if (d.weight_problems.length) return fail(422, "WEIGHTS_NOT_100", "The weights do not total 100");
  const wid = sid(`perf:wf:amend:${c.scorecard_id}:${Date.now()}`);
  AMENDMENTS.set(c.scorecard_id, wid);
  FLOWS.push({ wid, planId: plan.performance_plan_id, scorecardId: c.scorecard_id, stages: stagesFor(plan, req.user!), at: 0, by: req.user!, entered: now(), opened: now(), moves: [] });
  c.updated_at = now();
  return ok(cardFor(req, c));
});

/* ------------------------------------------------------------------ *
 * Analytics (§6.21, PR 5): the quarter's figures from the data above, and the rounds, reviews and
 * commitments PRs 3 and 4 will write, invented here in the contract's shapes.
 * ------------------------------------------------------------------ */

const mean = (scores: Array<string | null>) => {
  const s = scores.filter((x): x is string => x !== null).map(Number);
  return s.length ? String(Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10000) / 10000) : null;
};

function analyticsOf(departmentId: string | undefined): PerformanceAnalytics {
  const months = PERIOD.months;
  const objectives = OBJECTIVES.filter((o) => !departmentId || o.department_id === null || o.department_id === departmentId);
  const functions = [...new Set(objectives.map((o) => o.department_id))].sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
  const scores = functions.map((d) => ({
    department_id: d,
    department: d === null ? null : objectives.find((o) => o.department_id === d)?.department ?? null,
    months: months.map((m, i) => ({ month: m, score: i === 0 ? mean(objectives.filter((o) => o.department_id === d).map((o) => o.score)) : null })),
  }));
  const krs = OBJECTIVES.filter((o) => !departmentId || o.department_id === departmentId).flatMap((o) => o.key_results);
  const status = (s: string) => krs.filter((k) => k.latest?.status === s).length;
  const company = OBJECTIVES.filter((o) => o.department_id === null).map((o) => o.score);
  const onTime = (due: number, on: number) => ({ due, on_time: on });
  return {
    period: { performance_period_id: PERIOD.performance_period_id, name: PERIOD.name, starts_on: PERIOD.starts_on, ends_on: PERIOD.ends_on },
    months,
    company_score: company.length ? mean(company) : mean(OBJECTIVES.map((o) => o.score)),
    scores,
    key_results: {
      key_results: krs.length,
      not_started: status("not_started"),
      on_track: status("on_track"),
      at_risk: status("at_risk"),
      off_track: status("off_track"),
      done: status("done"),
      missed: status("missed"),
      awaiting_report: krs.filter((k) => !k.latest).length,
      recovery: krs.filter((k) => k.latest?.band === "recovery").length,
    },
    ratings: {
      month: "2026-10-01",
      counts: (["exceeds", "meets", "partly_meets", "below"] as const).map((rating) => ({ rating, count: SCORECARDS.filter((c) => c.rating === rating).length })),
    },
    commitments: onTime(13, 10),
    commitments_by_function: [{ department_id: deptId, department: DEPT, months: [{ month: months[0], ...onTime(9, 7) }, { month: months[1], ...onTime(4, 3) }, { month: months[2], ...onTime(0, 0) }] }],
    check_ins: onTime(2, 2),
    check_ins_by_month: months.map((month, i) => ({ month, ...(i === 0 ? onTime(2, 2) : onTime(0, 0)) })),
    reviews_closed: onTime(2, 1),
    reviews_closed_by_month: months.map((month, i) => ({ month, ...(i === 0 ? onTime(2, 1) : onTime(0, 0)) })),
    self_against_final: [{ department_id: deptId, department: DEPT, gap: "0.06", lines: 10 }],
  };
}

route("GET /api/v1/performance/analytics", (req) => {
  if (req.query.period_id && req.query.period_id !== PERIOD.performance_period_id) return notFound();
  return ok(analyticsOf(req.query.department_id || undefined));
});

const analyticsPeople = (): AnalyticsPerson[] =>
  SCORECARDS.filter((c) => c.status !== "draft").map((c) => ({
    scorecard_id: c.scorecard_id,
    employee: c.employee,
    department: c.department,
    reviewer: c.reviewer,
    score_to_date: c.score_to_date,
    rating: c.rating,
    months_scored: c.rating ? 1 : 0,
  }));

route("GET /api/v1/performance/analytics/people", (req) =>
  paged(analyticsPeople(), req, {
    search: (p) => [p.employee.display_name],
    filters: {
      period_id: () => true,
      department_id: (p, v) => SCORECARDS.find((c) => c.scorecard_id === p.scorecard_id)?.department_id === v,
      rating: (p, v) => p.rating === v,
    },
    sort: {
      score_to_date: (a, b) => Number(a.score_to_date ?? -1) - Number(b.score_to_date ?? -1),
      employee: (a, b) => a.employee.display_name.localeCompare(b.employee.display_name),
    },
  }),
);

route("POST /api/v1/performance/analytics/people/export", (req) => exportFile(req.user!, "performance-people"));
